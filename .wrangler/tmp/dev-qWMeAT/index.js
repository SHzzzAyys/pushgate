var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var json = /* @__PURE__ */ __name((obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "content-type": "application/json;charset=utf-8" }
}), "json");
var text = /* @__PURE__ */ __name((s, status = 200) => new Response(s, { status, headers: { "content-type": "text/plain;charset=utf-8" } }), "text");
function extractKey(url) {
  const m = url.pathname.match(/^\/([^/]+?)(?:\.send|\/send)\/?$/);
  if (m) return decodeURIComponent(m[1]);
  return url.searchParams.get("key") || "";
}
__name(extractKey, "extractKey");
async function readParams(request, url) {
  let title = url.searchParams.get("title") || "";
  let content = url.searchParams.get("desp") || url.searchParams.get("content") || url.searchParams.get("body") || "";
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    try {
      if (ct.includes("application/json")) {
        const b = await request.json();
        title = b.title ?? title;
        content = b.desp ?? b.content ?? b.body ?? content;
      } else {
        const form = await request.formData();
        title = form.get("title") ?? title;
        content = form.get("desp") ?? form.get("content") ?? form.get("body") ?? content;
      }
    } catch {
    }
  }
  return { title: String(title || ""), content: String(content || "") };
}
__name(readParams, "readParams");
async function hmacB64(key, message) {
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
__name(hmacB64, "hmacB64");
async function sendBark(barkUrl, title, content) {
  const r = await fetch(barkUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, body: content })
  });
  const d = await r.json().catch(() => ({}));
  if (d.code && d.code !== 200) throw new Error(`bark ${d.code} ${d.message || ""}`);
  if (!r.ok && !d.code) throw new Error(`bark http ${r.status}`);
  return "sent";
}
__name(sendBark, "sendBark");
async function sendDingtalk(webhook, secret, title, content) {
  let url = webhook;
  if (secret) {
    const ts = Date.now().toString();
    const sign = await hmacB64(secret, `${ts}
${secret}`);
    url += `${webhook.includes("?") ? "&" : "?"}timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
  }
  const body = {
    msgtype: "markdown",
    markdown: { title, text: `## ${title}

${content}` }
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  if (d.errcode && d.errcode !== 0) throw new Error(`dingtalk ${d.errcode} ${d.errmsg || ""}`);
  return "sent";
}
__name(sendDingtalk, "sendDingtalk");
async function sendFeishu(webhook, secret, title, content) {
  const body = {
    msg_type: "text",
    content: { text: `${title}
${content}` }
  };
  if (secret) {
    const ts = Math.floor(Date.now() / 1e3).toString();
    body.timestamp = ts;
    body.sign = await hmacB64(`${ts}
${secret}`, "");
  }
  const r = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  if (d.code && d.code !== 0 || d.StatusCode && d.StatusCode !== 0)
    throw new Error(`feishu ${d.code ?? d.StatusCode} ${d.msg || ""}`);
  return "sent";
}
__name(sendFeishu, "sendFeishu");
async function sendEmail(env, title, content) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || "pushgate <onboarding@resend.dev>",
      to: env.MAIL_TO,
      subject: title,
      text: content
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`resend http ${r.status} ${d.message || ""}`);
  return d.id || "sent";
}
__name(sendEmail, "sendEmail");
async function wrap(channel, p) {
  try {
    return { channel, ok: true, detail: await p };
  } catch (e) {
    return { channel, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
__name(wrap, "wrap");
async function dispatch(env, title, content) {
  const tasks = [];
  if (env.BARK_URL) tasks.push(wrap("bark", sendBark(env.BARK_URL, title, content)));
  if (env.DINGTALK_WEBHOOK)
    tasks.push(wrap("dingtalk", sendDingtalk(env.DINGTALK_WEBHOOK, env.DINGTALK_SECRET, title, content)));
  if (env.FEISHU_WEBHOOK)
    tasks.push(wrap("feishu", sendFeishu(env.FEISHU_WEBHOOK, env.FEISHU_SECRET, title, content)));
  if (env.RESEND_API_KEY && env.MAIL_TO)
    tasks.push(wrap("email", sendEmail(env, title, content)));
  if (tasks.length === 0)
    return [{ channel: "none", ok: false, detail: "\u672A\u914D\u7F6E\u4EFB\u4F55\u6E20\u9053\uFF08BARK_URL/DINGTALK_WEBHOOK/FEISHU_WEBHOOK/RESEND_API_KEY\uFF09" }];
  return Promise.all(tasks);
}
__name(dispatch, "dispatch");
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return text("pushgate \u2713\n\u7528\u6CD5\uFF1APOST /<PUSH_KEY>.send  body: title=&desp=");
    }
    if (!env.PUSH_KEY) return json({ code: 500, message: "\u670D\u52A1\u672A\u914D\u7F6E PUSH_KEY" }, 500);
    const key = extractKey(url);
    if (key !== env.PUSH_KEY) return json({ code: 401, message: "invalid key" }, 401);
    const { title, content } = await readParams(request, url);
    if (!title && !content) return json({ code: 400, message: "\u7F3A\u5C11 title/desp" }, 400);
    const results = await dispatch(env, title || "(\u65E0\u6807\u9898)", content);
    const ok = results.some((r) => r.ok);
    return json({ code: ok ? 0 : 1, message: ok ? "" : "all channels failed", data: { results } });
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-SL4qwI/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch2, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch: dispatch2,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch2, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch2, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch2, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-SL4qwI/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
