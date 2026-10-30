# Cloudflare AI Proxy

把门户的 OpenAI 兼容请求转发到 Gemini，避免在 Josh 服务器上直接暴露 Gemini key，也绕过服务器到 `generativelanguage.googleapis.com` 的网络问题。

当前生产地址：

```text
https://ai.gaojiaxiang.cn/v1/chat/completions
```

## 请求约束

- 只接受 `POST .../chat/completions`
- 必须带 `Authorization: Bearer <PROXY_TOKEN>`
- Worker 会注入自己的 `GEMINI_API_KEY`
- 不透传 Cookie、Cloudflare 头或任意上游路径

## Worker secrets

在 Cloudflare Worker 的 Settings → Variables and Secrets 中添加两个 **Secret**：

```text
GEMINI_API_KEY  Gemini API key
PROXY_TOKEN     给门户服务器用的随机口令
```

`PROXY_TOKEN` 可以用：

```bash
openssl rand -hex 32
```

不要把这两个值写进 `worker.js` 或 `wrangler.toml`。

## 部署

Dashboard 方式：

1. Workers & Pages → Create → Worker，名字 `josh-ai-proxy`
2. 粘贴 `worker.js`
3. 添加上述两个 Secret
4. Settings → Domains & Routes → Add → Custom Domain：`ai.gaojiaxiang.cn`

API 方式的关键点是 multipart 里的模块 part **必须带匹配的 filename**，否则 Cloudflare 会按 classic worker 编译：

```bash
curl --noproxy '*' -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/josh-ai-proxy" \
  -H "Authorization: Bearer $CLOUDFLARE_TOKEN" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2025-01-01","bindings":[]};type=application/json' \
  -F 'worker.js=@worker.js;filename=worker.js;type=application/javascript+module'
```

## 门户配置

```env
AI_ENABLED=1
AI_BASE_URL=https://ai.gaojiaxiang.cn/v1
AI_API_KEY=<PROXY_TOKEN>
AI_MODEL=gemini-3.8-flash
AI_REASONING_EFFORT=low
```

服务器只保存 `PROXY_TOKEN`，不保存 Gemini key。

## 验证

```bash
curl --noproxy '*' -i \
  https://ai.gaojiaxiang.cn/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H 'content-type: application/json' \
  --data '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"只回复 ok"}],"stream":false}'
```

预期 HTTP 200。401 是代理口令不对，404 是路径不对。

## 注意

- 不要给 `ai` 开 Cloudflare Access，服务器调用会被拦
- `PROXY_TOKEN` 泄露时在 Worker 里轮换，并同步更新服务器的 `AI_API_KEY`
- Worker 本身是公开端点，安全边界是 `PROXY_TOKEN`；门户已有自己的限流
