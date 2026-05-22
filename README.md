# pushgate

自托管多渠道消息推送中转（自用版的 Server酱）。部署在 Cloudflare Workers，免运维、免费、自带 HTTPS。

## 接口（兼容 Server酱）

```
POST https://<worker>/<PUSH_KEY>.send
body (form 或 json):
  title: 标题
  desp:  正文（支持 markdown 文本）
```

## 渠道

按 secret 配置自动启用，缺哪个跳过哪个，单渠道失败不影响其余：

| 渠道 | 所需 secret |
|---|---|
| Bark (iOS) | `BARK_URL` = `https://api.day.app/<devicekey>` |
| 钉钉群机器人 | `DINGTALK_WEBHOOK`（可选 `DINGTALK_SECRET` 加签） |
| 飞书群机器人 | `FEISHU_WEBHOOK`（可选 `FEISHU_SECRET` 加签） |
| 邮件（Resend）| `RESEND_API_KEY` + `MAIL_TO`（可选 `MAIL_FROM`） |

## 部署

```powershell
npm i
npx wrangler secret put PUSH_KEY        # 自己定一个强随机字符串
npx wrangler secret put BARK_URL        # 添加你想用的渠道
# ... 依此类推
npm run deploy
```

## 本地开发

```powershell
echo "PUSH_KEY=devsecret" > .dev.vars
npm run dev   # http://localhost:8788
```
