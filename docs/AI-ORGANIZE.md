# AI 整理与每周回顾

入口：

```text
https://<portal>/organize
```

页面分两块：

1. **本周回顾**：近 7 天新增、待整理、归档、媒体数量，高频标签和来源；可以生成一段回顾文字。
2. **待整理**：最近 12 条 Inbox 碎片，每条给出摘要建议、标签建议和重复检测。

## 原则

- AI 只给建议，不会自动改标签、备注或归档状态
- 「应用建议标签」是**追加**，不会覆盖已有标签
- 没有 AI key、或 `AI_ENABLED=0` 时完整降级为规则模式
- 规则模式仍然会做摘要、关键词标签和文本相似度去重

## AI 配置

```env
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=...
AI_MODEL=gpt-4o-mini
AI_ENABLED=1
```

也可以使用 Gemini 的 OpenAI 兼容层：

```env
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_API_KEY=...
AI_MODEL=gemini-3.8-flash
AI_ENABLED=1
```

如果服务器网络暂时访问不了模型端点，设：

```env
AI_ENABLED=0
```

这样公开助手、整理台和合成都会直接走规则/检索，不会卡在超时上。网络恢复后改回 `1` 并重启。

## API

单条建议：

```http
POST /api/organize
Content-Type: application/json

{"fragmentId":"<id>"}
```

返回：

```json
{
  "mode": "ai",
  "summary": "...",
  "tags": ["..."],
  "duplicates": [{"id":"...","quote":"...","score":0.92,"reason":"内容几乎相同"}]
}
```

周回顾：

```http
POST /api/review
```

返回 `{ mode, text, notice? }`。

## 重复检测

- 先按同一图片地址、同一来源页面判断
- 再用归一化文本的字符 bigram Jaccard 相似度
- 阈值为 0.58，最多返回 3 条
- 只展示，不自动合并；是否处理由人决定
