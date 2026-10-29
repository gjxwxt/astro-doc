# AI Provider 调研：Gemini 免费额度与 Phase 2 接入方案

> 状态：方案已定；公开助手的原生低思考和 Gemini 兼容层已在本地实测通过。  
> 不在本文记录任何真实 key。  
> 关键结论：**免费额度可以做公开 Demo，不适合直接处理私人碎片。**

## 1. 实测结果

用当前 key 调用了 Gemini API：

- `GET /v1beta/models` 成功，key 本身可用
- 当前账号可看到：
  - `gemini-3.8-flash`
  - `gemini-3.8-flash-lite`（列表可见，但当前 key 下 `GET` 返回空，先不用）
  - `gemini-4-argon`
  - `gemini-flash-latest`
  - 以及若干 preview / image / TTS 模型
- `gemini-flash-latest:generateContent` 返回：

```json
{
  "code": 402,
  "status": "RESOURCE_EXHAUSTED",
  "message": "Your prepayment credits are depleted..."
}
```

- `gemini-3.8-flash` 同样返回 402
- `gemini-2.5-flash` 返回 404：该模型已不对新用户开放，建议使用 `gemini-3.8-flash`

**判断：**

这不是限流，也不是 key 无效，而是**当前项目没有可用额度 / 预付款已耗尽**。  
要么给该项目充值，要么在 AI Studio 新建一个真正处于 Free Tier 的项目并生成新 key。

### 1.1 2026-10-28 本地实测（付费 key）

- 原生 `generateContent` + `thinkingLevel: "LOW"`：200，`thought=0`
- OpenAI 兼容层 + `reasoning_effort: "low"`：200，流式返回正常
- 本地 `PORT=4400 node dist/server/entry.mjs` + `/api/chat`：HTTP 200，SSE `mode: ai`，无 error 事件

结论：低思考参数和公开助手链路都能用；下一步是把同一套配置换到服务器。

---

## 2. 免费额度到底能不能用

### 能用，但有三个限制

1. **不是所有模型都免费**
   - `gemini-3.8-flash` 有 Free Tier
   - `gemini-4-argon` 明确不提供 Free Tier
   - 旧的 `gemini-2.5-flash` 已不对新用户开放

2. **免费层会使用你的内容改进产品**
   Google 的 Gemini API 条款写明：未付费服务（包括 AI Studio 和 Gemini API 的 unpaid quota）提交的内容和生成结果，会用于提供、改进和开发 Google 产品与机器学习技术。
   为了质量，**人工审核员可能阅读、标注和处理 API 输入输出**。

3. **条款明确要求不要提交敏感信息**
   原文大意：

   > Do not submit sensitive, confidential, or personal information to the Unpaid Services.

   你的碎片、日记、私人阅读笔记、未发布文章，都属于这一类。

### 结论

- **公开文章、公开网页摘录、Demo 数据**：可以用免费额度
- **私人碎片、草稿、日记、未发布内容**：不要用免费额度
- 如果 Phase 2 要处理私人碎片，应该用：
  - 付费 Gemini key，或
  - 本地模型 / 自建模型，或
  - 明确接受风险并使用免费额度（不推荐）

---

## 3. 价格判断

以当前文档里的 Gemini 3.8 Flash 标准付费价格为例（2026 年内）：

- 输入：约 `$0.75 / 1M tokens`
- 输出：约 `$3.75 / 1M tokens`

一次个人合成的大致量级：

- 10 条碎片 + 站内资料：约 8k–20k 输入 tokens
- 大纲 + 正文：约 2k–6k 输出 tokens

单次成本大约 **2–5 美分**。  
个人使用一个月几十次，通常是个位数美元，远低于“为了省几美元把私人内容交给免费层”的风险。

具体价格以 Google 当前页面为准，不在这里写死。

---

## 4. 推荐的接入架构

### 4.1 两把 key，按用途隔离

```text
GEMINI_PUBLIC_API_KEY   # 只给公开 AI 助手 / Demo
GEMINI_PRIVATE_API_KEY  # 只给碎片合成 / 草稿，付费项目
```

如果只用一个付费 key，也可以先合并；但**不要**让公开聊天和私人合成共用一把免费 key。

### 4.2 服务端配置

```dotenv
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
GEMINI_PRIVATE_API_KEY=...
GEMINI_PUBLIC_API_KEY=...
# 可选
AI_FALLBACK_MODEL=gemini-3.5-flash-lite
```

放在：

```text
/opt/josh-portal/.env
```

权限：

```bash
chmod 600 /opt/josh-portal/.env
```

systemd：

```ini
EnvironmentFile=/opt/josh-portal/.env
```

### 4.3 key 绝对不能出现的位置

- 不能提交到 GitHub
- 不能写进 Astro 客户端代码
- 不能写进 `NEXT_PUBLIC_*` / `PUBLIC_*` 这类前端变量
- 不能作为 Docker build arg 或镜像层 `ENV`
- 不能出现在 URL query 里（`?key=` 会进访问日志）
- 不能出现在 GitHub Actions 日志、构建产物、错误堆栈
- 不能写进文档、截图、Issue、聊天记录

**这次 key 已经出现在对话里，建议用完立即在 AI Studio 撤销并重新生成。**

### 4.4 GitHub Actions 怎么处理

部署 Action 只构建代码，不需要 AI key：

- 不把 key 加进 GitHub Secrets 给 build 用
- 不把 key 注入 `pnpm build`
- 服务器上的 `.env` 独立存在，Action 只替换 `dist`
- 如果以后要在 CI 里跑真实 AI 测试，用单独的测试 key + 预算上限，且不要打印请求

---

## 5. 代码层方案

### 5.1 为什么不直接用现有 OpenAI 兼容层

Gemini 提供 OpenAI 兼容接口：

```text
https://generativelanguage.googleapis.com/v1beta/openai/
```

现有 `src/lib/ai.ts` 是 OpenAI `/chat/completions` 风格，理论上改 `baseUrl` 和 key 就能跑。  
但 Phase 2 需要：

- JSON Schema 结构化输出
- SSE 流式正文
- usage / finishReason / safety 信息
- 更细的错误码处理

所以建议做一层 provider 抽象：

```text
src/lib/ai/
  provider.ts       # 统一接口
  openai.ts         # 现有 chat
  gemini.ts         # 原生 Gemini
  errors.ts         # 402/429/403/404 归一化
```

统一接口：

```ts
interface AiProvider {
  generateObject<T>(input: {
    model: string;
    system: string;
    prompt: string;
    schema: unknown;
    maxOutputTokens: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{ data: T; usage?: Usage }>;

  streamText(input: {
    model: string;
    system: string;
    prompt: string;
    maxOutputTokens: number;
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncIterable<string>;
}
```

### 5.2 Gemini 原生调用

非流式：

```text
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
X-goog-api-key: <server-only-key>
```

流式：

```text
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse
```

结构化输出：

```json
{
  "generationConfig": {
    "responseMimeType": "application/json",
    "responseSchema": { "...": "..." },
    "temperature": 0.2,
    "maxOutputTokens": 4096,
    "thinkingConfig": {
      "thinkingLevel": "LOW",
      "includeThoughts": false
    }
  }
}
```

### 5.3 Phase 2 两段式调用

**第一段：规划 JSON**

- 输入：选中的碎片、标签、来源、站内检索结果
- 输出：聚类 + 大纲
- `temperature: 0.2`
- 强制 JSON schema
- 失败时用确定性 fallback 聚类

**第二段：按节写**

- 输入：当前节相关碎片 + 已生成大纲 + 已有关联资料
- 输出：正文 + `[f1]` 引用
- 流式返回
- `temperature: 0.5–0.7`
- 每节独立，避免一次生成整篇导致引用漂移

### 5.4 错误处理

| 状态 | 含义 | 处理 |
| --- | --- | --- |
| 402 | 预付款/额度耗尽 | 不重试，提示“AI 额度不足”，保存未生成状态 |
| 429 | 限流 | 读取 `Retry-After`，最多重试一次 |
| 403 | key 无效/无权限 | 不重试，服务端告警 |
| 404 | 模型已下线 | 切 fallback 模型，记录日志 |
| 5xx | 上游故障 | 重试一次，再失败则降级 |

错误日志只记录：

- 模型名
- 状态码
- 请求 ID
- 耗时
- token 数

不记录碎片正文、prompt 全文、key。

---

## 6. 免费额度的使用边界

### 可以

- 公开文章摘要
- 公开 `/library/` 内容的检索问答
- 合成流程的公开 Demo / 假数据
- 你自己明确不介意的实验文本

### 不可以

- 日记
- 私人阅读笔记
- 未发布草稿
- 含个人信息、公司信息、客户信息的碎片
- 付费/受版权保护的全文内容

如果一定要用免费额度处理私人碎片，必须在 UI 上明确提示：

> 当前使用免费 AI 额度，提交内容可能被用于改进 Google 产品，并可能被人工审核。不要提交敏感内容。

默认应该是关闭，而不是默认同意。

---

## 7. 对 Phase 2 计划的影响

原 Phase 2 计划里的 AI 部分需要改成：

1. **AI provider 抽象**，不把 Gemini 写死
2. **两把 key**：public / private
3. **私有合成默认走付费 key**；没有付费 key 时，只用确定性 fallback，不偷偷用免费 key
4. **错误码细分**：402/429/403/404 都要有明确 UI
5. **额度保护**：
   - 单次最大输入 / 输出 token
   - 每用户每日合成次数
   - 同一时间只跑一个任务
   - 失败不自动无限重试
6. **公开助手与私有合成隔离**，防止公开页面烧掉私人额度
7. **key 轮换流程**写进运维文档

---

## 8. 本轮建议（2026-10）

> 方向：付费 key + `gemini-3.8-flash` 低思考 + `humanizer-zh` 约束。  
> key 充值后先跑一次 200，再改代码。

### 8.1 月度额度限制在哪里配

分三层，前两层是硬闸，第三层管体验和公开侧。

**1. AI Studio 项目月上限（最直接）**

- AI Studio → Billing → Spend → **Monthly spend cap** → Edit spend cap
- 选项目，填 `$5/月`
- 这是 Gemini API 的项目级月度上限；官方标注 experimental，计费约有 10 分钟延迟，可能有一点点超量

**2. Cloud Billing 支出上限预算（第二道闸）**

- Cloud Console → Billing → Budgets & alerts → Create budget
- 范围：项目 + 服务 **Gemini API**
- 预算类型选 **Spend cap budget**，不要选 alerts-only
- 金额 `$5/月`；50/80/100% 告警
- 100% 后暂停该服务的新请求，下个周期自动恢复
- 执行不是瞬时的：in-flight 请求会跑完，延迟期间可能计费

**3. 应用层预算（体验和公开侧）**

- `AI_MONTHLY_BUDGET_USD=5`
- 用响应里的 `usageMetadata` 记 token/成本；80% 提醒，100% 停止并返回“额度不足”
- 公开助手单独设日请求上限；AI 失败时降级到站内检索

补充：

- 如果走 **Prepay**：AI Studio Billing → Manage auto-reload → Monthly Limit。它限制的是**自动充值金额**，不是已充值余额的消费；当前 402 就是 Prepay 余额为 0。
- **Google AI Pro 的 $10/月不是 AI Studio 免费额度**，而是 Google Developer Program 的 Google Cloud credits。需要先把 AI Pro 绑定到 Google Developer profile，再在 My Benefits 里把 credit 应用到 Gemini API 用的 Cloud Billing 账户；可以勾选 “Always use this billing account” 让每月 credit 自动应用。它是月度的，未用通常不滚存；Prepay 账户仍需先充值激活，最终以 AI Studio Billing 的 Available credits 为准。
- **alerts-only budget 不会停服务**，只发邮件。
- Gemini 的每分钟 rate limit 管并发，不管月账单；不要拿它当月度上限。

### 8.2 模型和思考强度

固定版本，不跟 `latest` 别名：

| 用途 | 模型 | 备注 |
| --- | --- | --- |
| 主模型 | `gemini-3.8-flash` | 公开助手和私人合成共用 |
| fallback | `gemini-3.5-flash-lite` | 支持 `minimal/low/medium/high`，便宜 |
| 可选深任务 | `gemini-4-argon` | 仅付费，不用于默认/公开 |

不要用：

- `gemini-flash-latest`：浮动别名，随时换模型
- `gemini-2.5-flash`：新项目 404
- `gemini-3.8-flash-lite`：模型列表可见，但 `GET /v1beta/models/gemini-3.8-flash-lite` 返回空，先不用

默认 `low`。原生 `generateContent` 的 REST 写法：

```json
{
  "generationConfig": {
    "thinkingConfig": {
      "thinkingLevel": "LOW",
      "includeThoughts": false
    },
    "maxOutputTokens": 4096
  }
}
```

如果以后换 Interactions API，参数名和大小写不同：

```json
{
  "generation_config": {
    "thinking_level": "low"
  }
}
```

`gemini-3.8-flash` 支持 `low/medium/high`；`gemini-3.5-flash-lite` 支持 `minimal/low/medium/high`。  
规划阶段如果发现聚类质量不够，只把这一阶段临时调到 `medium`，不全局调高。

### 8.3 humanizer-zh 放在哪

`humanizer-zh` 是“编辑已有文本”的 skill，不是生成器。用它做**成文后的独立润色 pass**：

```text
规划 JSON → 按节成文 → humanize → 引用校验 → 保存草稿
```

实现约束：

- 把 skill 的核心规则固化成一个仓库内 prompt（例如 `src/lib/synthesis/prompts/humanize-zh.md`），不要运行时读 `~/.pi/agent/skills`；服务器上没有这个目录
- 只用于私人合成，不套在公开聊天上
- 只改表达：删空话、重复、模板句；保留作者判断、语气、限定和正式程度
- 不新增事实、数字、人名、日期、来源；不删除 `[fN]`
- 保留标题层级、代码块、行内代码、URL、frontmatter
- 润色前后提取 `[fN]` 集合，必须完全一致；新增、丢失或无效引用 → 丢弃润色稿，回退成文稿
- 一次 pass，`temperature: 0.4`，`low`；不追求“过 AI 检测”，只求读起来自然
- 配置开关：`AI_HUMANIZE=1`

### 8.4 公开 AI 助手

- 同模型：`gemini-3.8-flash` + `low`
- 目标失败顺序：主模型 → `gemini-3.5-flash-lite` → 站内检索
- 现状：公开助手已经能走 Gemini 的 OpenAI 兼容层，并用 `AI_REASONING_EFFORT=low` 控制思考；上游返回非 2xx 时会**降级到站内检索**，并在回答开头说明状态码
- 还没实现的是**模型 fallback**（自动切到 `gemini-3.5-flash-lite`）；这个留给 Phase 2 的 provider 层
- 公开侧单独限流（IP + 日请求数）；不套 humanizer
- 已决定共用一把 key：`GEMINI_API_KEY`。公开助手和私人合成共享项目预算；公开侧被刷会吃掉合成额度，所以限流必须保留
- 以后如果公开流量变大，再拆成 public/private 两把，不需要现在增加配置复杂度

### 8.5 环境变量现状

公开助手已经支持 OpenAI 兼容层，今天就可以先用这套：

```dotenv
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_API_KEY=<付费 Gemini key>
AI_MODEL=gemini-3.8-flash
AI_REASONING_EFFORT=low
```

公开助手会优先读 `AI_API_KEY`，没有再读 `GEMINI_API_KEY`；一把 key 时只填后者即可。

本地实测：

```bash
# 先手动创建 .env.local，写入 GEMINI_API_KEY=...；.env.local 已被 gitignore
pnpm test:gemini
```

脚本会分别调用原生 `generateContent`（`thinkingLevel=LOW`）和 OpenAI 兼容层（`reasoning_effort=low`），只打印状态、耗时和文本，不打印 key。

Phase 2 的私人合成需要原生 Gemini 能力（JSON schema、usage、引用流），provider 落地后再加：

```dotenv
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
AI_FALLBACK_MODEL=gemini-3.5-flash-lite
AI_THINKING_LEVEL=low
AI_HUMANIZE=1
AI_MONTHLY_BUDGET_USD=5
GEMINI_API_KEY=<同一把 key>
```

不要把 `AI_REASONING_EFFORT` 和原生 `thinking_level` 同时发给同一个接口；兼容层和原生层二选一。

### 8.6 待确认

1. `low` 的成文质量要等合成管线落地后再看；如果只有规划阶段不够，是否允许该阶段单独用 `medium`？
2. 一把 key 已确认，公开侧继续用现有 12 次/分钟/IP 限流，够不够？

## 9. 参考

- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- API keys: https://ai.google.dev/gemini-api/docs/api-key
- Streaming: https://ai.google.dev/gemini-api/docs/streaming
- Structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Thinking levels: https://ai.google.dev/gemini-api/docs/thinking
- Cloud Billing spend caps: https://cloud.google.com/billing/docs/how-to/budgets-spend-caps
- Google AI Pro benefits: https://support.google.com/googleone/answer/14534406
- Google Developer Program credits FAQ: https://developers.google.com/profile/help/benefits#premium-benefits
- OpenAI compatibility + reasoning_effort: https://ai.google.dev/gemini-api/docs/openai
- OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai
- Additional Terms (unpaid data use): https://ai.google.dev/gemini-api/terms
