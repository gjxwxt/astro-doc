# AI 助手

右下角的助手是一个很薄的 RAG：

```text
用户问题
  → 最后一次用户消息
  → 站内检索 top 6
  → 有 key：OpenAI 兼容 chat/completions（stream）
  → 没 key：按检索结果拼一段回答
  → SSE: sources / token / done
```

## 配置

```bash
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
```

`AI_BASE_URL` 只需要兼容 `POST /chat/completions` 和 `stream: true`。常见组合：

| 服务 | BASE_URL | 备注 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | 默认 |
| OpenRouter | `https://openrouter.ai/api/v1` | 模型名按供应商写 |
| DeepSeek | `https://api.deepseek.com/v1` | `AI_MODEL` 用它的模型名 |
| Ollama | `http://localhost:11434/v1` | 本地模型；注意服务器内存 |
| 自建网关 | 你的网关 `/v1` | 需要支持 SSE |

没有 `AI_API_KEY` 时不会报错：助手返回检索结果，并在头部显示“检索模式”。

## 提示词

系统提示在 `src/lib/ai.ts`：

- 只根据站内资料回答
- 资料不足就说不知道，并建议打开工具/笔记
- 中文、简洁、最多 5 句
- 站内引用用 Markdown 链接
- 不编造资料里没有的事实

每次请求最多带 6 条检索结果，每条正文截断 1600 字。用户消息只保留最近 10 条，每条最多 2000 字。

## 安全与限流

- key 只在服务端读取，浏览器拿不到。
- `/api/chat` 默认限流 12 次/分钟/IP；请求体上限 64KB。
- 设置 `PORTAL_API_TOKEN` 后，外部调用需要 Bearer；本站 UI 通过 `Sec-Fetch-Site` 放行。
- 不发送任何用户文件、IP 之外的隐私数据；问题会发给配置的模型服务。
- AI 输出在前端用 `textContent`/转义后的 Markdown 渲染，不直接执行 HTML。

## 调试

没有 key：

```bash
curl -N -X POST http://localhost:3005/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"这个站有哪些工具？"}]}'
```

应看到：

```text
event: sources
data: {"mode":"search","sources":[...]}

event: token
data: {"text":"当前没有配置 AI key..."}

event: done
data: {"mode":"search"}
```

有 key 时 `mode` 是 `ai`，token 来自上游流。

## 已知限制

- 检索是关键词 + bigram，不是向量检索；同义改写可能召回不到。
- 上下文只有 6 条、每条 1600 字，长文档会被截断。
- 没有多轮记忆持久化，关闭标签页就清空。
- 不处理图片、附件和表格结构。
- 上游模型/网关的流式格式必须兼容 OpenAI SSE；不兼容时会在 `error` 事件里返回提示。
- 没有 token 计费统计；需要的话在 `createChatResponse` 里记录 usage 或在上游网关做。
