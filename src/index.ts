/**
 * pushgate —— 自托管的多渠道消息推送中转（自己用版的 Server酱）。
 *
 * 调用（兼容 Server酱格式，便于无缝替换）：
 *   POST https://<worker>/<PUSH_KEY>.send   body: title=&desp=（form 或 json）
 *   GET  https://<worker>/<PUSH_KEY>.send?title=标题&desp=内容
 *
 * 渠道按 secret 是否配置自动启用，缺哪个跳过哪个；单渠道失败不影响其余。
 */

interface Env {
  PUSH_KEY?: string;
  BARK_URL?: string; // https://api.day.app/<devicekey>
  DINGTALK_WEBHOOK?: string;
  DINGTALK_SECRET?: string;
  FEISHU_WEBHOOK?: string;
  FEISHU_SECRET?: string;
  RESEND_API_KEY?: string;
  MAIL_TO?: string;
  MAIL_FROM?: string;
}

type ChannelResult = { channel: string; ok: boolean; detail: string };

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json;charset=utf-8" },
  });

const text = (s: string, status = 200) =>
  new Response(s, { status, headers: { "content-type": "text/plain;charset=utf-8" } });

// 从路径 /<key>.send 或 /<key>/send 提取 key；否则取 ?key=
function extractKey(url: URL): string {
  const m = url.pathname.match(/^\/([^/]+?)(?:\.send|\/send)\/?$/);
  if (m) return decodeURIComponent(m[1]);
  return url.searchParams.get("key") || "";
}

async function readParams(
  request: Request,
  url: URL
): Promise<{ title: string; content: string }> {
  let title = url.searchParams.get("title") || "";
  let content =
    url.searchParams.get("desp") ||
    url.searchParams.get("content") ||
    url.searchParams.get("body") ||
    "";
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    try {
      if (ct.includes("application/json")) {
        const b = (await request.json()) as Record<string, unknown>;
        title = (b.title as string) ?? title;
        content = (b.desp as string) ?? (b.content as string) ?? (b.body as string) ?? content;
      } else {
        const form = await request.formData();
        title = (form.get("title") as string) ?? title;
        content =
          (form.get("desp") as string) ??
          (form.get("content") as string) ??
          (form.get("body") as string) ??
          content;
      }
    } catch {
      /* body 解析失败就用 query 兜底 */
    }
  }
  return { title: String(title || ""), content: String(content || "") };
}

// HMAC-SHA256 → base64（钉钉/飞书加签共用）
async function hmacB64(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function sendBark(barkUrl: string, title: string, content: string): Promise<string> {
  const r = await fetch(barkUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, body: content }),
  });
  const d = (await r.json().catch(() => ({}))) as { code?: number; message?: string };
  if (d.code && d.code !== 200) throw new Error(`bark ${d.code} ${d.message || ""}`);
  if (!r.ok && !d.code) throw new Error(`bark http ${r.status}`);
  return "sent";
}

async function sendDingtalk(
  webhook: string,
  secret: string | undefined,
  title: string,
  content: string
): Promise<string> {
  let url = webhook;
  if (secret) {
    const ts = Date.now().toString();
    const sign = await hmacB64(secret, `${ts}\n${secret}`);
    url += `${webhook.includes("?") ? "&" : "?"}timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
  }
  const body = {
    msgtype: "markdown",
    markdown: { title, text: `## ${title}\n\n${content}` },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = (await r.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
  if (d.errcode && d.errcode !== 0) throw new Error(`dingtalk ${d.errcode} ${d.errmsg || ""}`);
  return "sent";
}

async function sendFeishu(
  webhook: string,
  secret: string | undefined,
  title: string,
  content: string
): Promise<string> {
  const body: Record<string, unknown> = {
    msg_type: "text",
    content: { text: `${title}\n${content}` },
  };
  if (secret) {
    const ts = Math.floor(Date.now() / 1000).toString();
    body.timestamp = ts;
    body.sign = await hmacB64(`${ts}\n${secret}`, "");
  }
  const r = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = (await r.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    StatusCode?: number;
  };
  if ((d.code && d.code !== 0) || (d.StatusCode && d.StatusCode !== 0))
    throw new Error(`feishu ${d.code ?? d.StatusCode} ${d.msg || ""}`);
  return "sent";
}

async function sendEmail(env: Env, title: string, content: string): Promise<string> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || "pushgate <onboarding@resend.dev>",
      to: env.MAIL_TO,
      subject: title,
      text: content,
    }),
  });
  const d = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok) throw new Error(`resend http ${r.status} ${d.message || ""}`);
  return d.id || "sent";
}

async function wrap(channel: string, p: Promise<string>): Promise<ChannelResult> {
  try {
    return { channel, ok: true, detail: await p };
  } catch (e) {
    return { channel, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function dispatch(env: Env, title: string, content: string): Promise<ChannelResult[]> {
  const tasks: Promise<ChannelResult>[] = [];
  if (env.BARK_URL) tasks.push(wrap("bark", sendBark(env.BARK_URL, title, content)));
  if (env.DINGTALK_WEBHOOK)
    tasks.push(wrap("dingtalk", sendDingtalk(env.DINGTALK_WEBHOOK, env.DINGTALK_SECRET, title, content)));
  if (env.FEISHU_WEBHOOK)
    tasks.push(wrap("feishu", sendFeishu(env.FEISHU_WEBHOOK, env.FEISHU_SECRET, title, content)));
  if (env.RESEND_API_KEY && env.MAIL_TO)
    tasks.push(wrap("email", sendEmail(env, title, content)));
  if (tasks.length === 0)
    return [{ channel: "none", ok: false, detail: "未配置任何渠道（BARK_URL/DINGTALK_WEBHOOK/FEISHU_WEBHOOK/RESEND_API_KEY）" }];
  return Promise.all(tasks);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 健康检查 / 说明
    if (url.pathname === "/" && request.method === "GET") {
      return text("pushgate ✓\n用法：POST /<PUSH_KEY>.send  body: title=&desp=");
    }

    if (!env.PUSH_KEY) return json({ code: 500, message: "服务未配置 PUSH_KEY" }, 500);

    const key = extractKey(url);
    if (key !== env.PUSH_KEY) return json({ code: 401, message: "invalid key" }, 401);

    const { title, content } = await readParams(request, url);
    if (!title && !content) return json({ code: 400, message: "缺少 title/desp" }, 400);

    const results = await dispatch(env, title || "(无标题)", content);
    const ok = results.some((r) => r.ok);
    return json({ code: ok ? 0 : 1, message: ok ? "" : "all channels failed", data: { results } });
  },
} satisfies ExportedHandler<Env>;
