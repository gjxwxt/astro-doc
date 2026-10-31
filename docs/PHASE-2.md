# Phase 2 计划：碎片 → 新文章草稿

> 状态：2A、2B、2C、2D 本地实现完成（待验收）。部署前再处理私有入口。  
> 目标不是“再做一个笔记应用”，而是把零散想法稳定地变成一篇可发布的文章草稿。  
> Phase 2 不自动改旧文章，不自动发布，不写回 Obsidian。

## 0. 先解释 `/library/`

`/library/` 是**公开知识库**，和 `/docs/`、`/notes/` 是三件事：

| 路由 | 内容 | 谁维护 | 更新方式 |
| --- | --- | --- | --- |
| `/docs/` | 手写长文、教程、项目文档 | 人 | 直接改 Markdown |
| `/notes/` | 较短的随笔、阶段性记录 | 人 | 直接写或同步 |
| `/library/` | Obsidian 里已经整理好的概念、来源、实体、文章 | Obsidian + LLM | `publish: true` 后自动同步 |

它解决的问题：

- 不把 Wiki 里的概念页塞进按时间排列的 `/notes/`。
- 不把自动同步的内容混进手写文档的导航。
- 给 `[[wikilink]]` 一个稳定的公开落点，例如 `/library/knowledge/memex/`。
- 让公开内容可被全站搜索和以后的 AI 检索使用。
- 只发布明确标了 `publish: true` 的页面，文件夹只决定分区和标签，不决定权限。

现在线上 7 篇是测试样本；以后你在 Obsidian 里加 `publish: true`，push 后就会出现在这里。

---

## 1. Phase 2 的目标

把这条链路跑通：

```text
浏览器选中一段话
  → 带上来源、上下文、随想、标签存入 Inbox
  → 在 Inbox / 日历里整理、筛选、选中
  → 点击“合成文章”
  → 弹窗里真实展示：去重 → 聚类 → 关联旧文 → 大纲 → 分段成文 → 引用检查
  → 保存为草稿
  → 导出 Markdown
```

**完成标准：** 选 5 到 10 条真实碎片，能生成一篇结构完整、每段都能追溯到来源的草稿，而不是一段泛泛的 AI 总结。

Phase 2 只生成**新文章**。改旧文章、insert-only diff、自动开 PR，放到 Phase 3。

---

## 2. Phase 2 检查点

每个检查点都停下来给你看，不一口气做完。

### 2.0 前置：私有入口

碎片是私人数据，**不能放在当前 `http://IP:443` 的明文入口后面**。

生产前二选一：

- **正式域名 + HTTPS**：Nginx / Caddy + Let's Encrypt，推荐。
- **Tailscale / Cloudflare Tunnel**：只让私有网络访问 `/inbox`、`/drafts` 和私有 API。

在 HTTPS 就绪前，2A–2D 只在本地或内网验收，不把碎片数据放到公网。

### 2A. 数据层 + 登录 + 采集 API（本地实现完成）

交付：

- SQLite 初始化和迁移
- 单用户登录（ADMIN_PASSWORD + HMAC cookie）
- 静态 `PRIVATE_API_TOKEN` 供插件 / curl 使用
- 碎片 CRUD + 搜索 + 去重 + 软删除
- `/login` 和基础 `/inbox` 列表
- 用 curl / 脚本能完整走一遍

验收：

- 重启服务后数据还在
- 未登录访问私有 API 返回 401
- 同一段文字重复采集会被识别为重复
- 私有碎片不出现在 `search-index.json`、sitemap、公开 MCP
- `/inbox` 的 HTML 不内联碎片正文

### 2B. 浏览器插件 + Inbox 完善

交付：

- Chrome / Edge Manifest V3 插件
- 选中文字 → 弹窗 → 写随想 / 标签 → 保存
- 没选中文字 → 保存当前页链接，服务端生成链接卡片
- 选中文字右键 → 二级标签菜单 → 直接保存并弹出页面顶部非侵入式小气泡
- 右键链接 → 直接保存链接并显示非侵入式小气泡，不打开 Inbox
- 右键图片 → 保存远程图片 URL / alt / 来源页，生成挂钉/磁力贴相纸卡片；鼠标移入显示底部液态玻璃栏（放大 / 下载 / 编辑 / 长按删除），点击进入灯箱查看大图
- `/inbox` 筛选、编辑、删除、多选
- 图片默认保存远程 URL，下载通过服务端同源受控代理 `/api/fragments/[id]/image` 校验 content-type 与大小后输出附件流
- 批量标注：右键“批量标注此页” → 连续加入多段 → 共用 `groupId` 保存；Inbox 收成一张“同页”组卡片，可展开、整组选择
- 多选后出现“合成文章”入口
- 本地 MCP：在 `packages/mcp-server` 配置 `PRIVATE_API_TOKEN` 后，向本地 AI 客户端开放 `inbox_*` 与 `drafts_*` 私有工具

验收：

- 在真实网页上选中一段话，10 秒内进入 Inbox
- 右键菜单能看到已有标签，点标签后直接保存
- 重复保存有明确提示
- X / 抖音链接能出现来源和卡片；抖音没有预览时不空白，明确说明原因
- 改 `PRIVATE_API_TOKEN` 并重启后，旧 Token 立即失败
- 标签 / 日期筛选与搜索可以组合使用
- 单条编辑随想和标签后，列表与筛选结果同步更新
- 多选后底部出现“合成文章”入口；已接入 2C 工作台
- 批量标注可把同一页的 3 段文字保存成一组；Inbox 默认显示第一段，展开后能看到全部，点“查看整组”可在弹窗里通读，点“选择整组”能一次加入合成
- 长引用在列表里不超过一屏；点卡片或“点击查看全文”能看到未截断的全文
- 图片卡点图能放大；底部来源行可单独跳到来源页
- link 卡点封面不会离开 Inbox，点标题/摘要才离开
- 组卡片的牌堆在桌面可横向移动查看不同成员，卡面位置不抖动；组弹窗里成员按两列铺开，不重复页面元信息
- 手机宽度下 Inbox 可用

> `/calendar` 已砍：个人碎片量不需要月历，日期筛选在 Inbox 里解决。

### 2C. 合成流水线 + 过程弹窗（本地实现完成）

交付：

- 创建合成任务、SSE 事件流、取消 / 重试
- 去重、聚类、大纲、分段成文、humanizer-zh 润色、引用检查
- 全屏“合成工作台”弹窗
- 没有 AI key 时的结构化降级

已落地：

- `POST /api/synthesis` 创建任务；`GET /api/synthesis/[id]/stream` 回放 + 实时推送 `stage / plan / section.* / citation.check / run.*` 事件
- `synthesis_runs` / `synthesis_events` 持久化；浏览器断开或关闭弹窗不会中断任务
- 同一 owner 同时只允许一个 queued/running 任务；第二个请求返回 409 和可恢复的 runId
- AI 规划一次 JSON 调用；按大纲逐节流式成文；润色一次调用；润色前后引用集合不一致时回退成文稿
- 没有 key、AI 规划失败、成文失败时降级为结构草稿，并在工作台里显示警告；不会伪装成 AI 文章
- 取消会把状态写成 `cancelled`，不保存 `result_markdown`；重试创建新 run，保留原 `fragment_ids`
- 工作台：左侧聚类/碎片（点开原文和来源），右侧大纲/流式正文；顶部 6 段阶段条由 SSE 驱动；底部取消/重试/保存草稿
- 结果区显示标题和来源 chips；点 chip 回跳左侧碎片
- 关闭弹窗后任务继续；重新点“合成文章”会接回运行中的 run
- 移动端单列；阶段条横向滚动；窄屏无横向溢出

第一版边界：

- 没做站内 `library/docs/notes` 关联检索，留到下一轮；阶段条是 `收集 → 聚类 → 大纲 → 成文 → 润色 → 校验` 六段
- “改提示词 / 只重写本节 / 重聚类”未做成按钮；API 已支持 `prompt`，重试会沿用原提示词
- 失败重试是整篇重跑，不是从失败阶段续跑

验收：

- [x] 弹窗里的阶段由真实 SSE 驱动，不是定时器假动画
- [x] 每条聚类能点回原始碎片
- [x] 草稿每段有来源编号；无法追溯的段落会被标出来
- [x] 润色前后 `[fN]` 集合一致；新增、丢失或无效引用时自动回退成文稿
- [x] 中途取消不会留下“半篇假完成”
- [x] 失败后可重试，不丢已选碎片
- [x] 没有 AI key 时显示“结构草稿”并保留原始碎片

### 2D. 草稿、导出、备份（本地实现完成）

交付：

- `/drafts` 列表
- `/drafts/[id]` 编辑和预览
- 导出单个 `.md`（含 frontmatter 和来源附录）
- SQLite 备份脚本
- 文档和测试

已落地：

- `/drafts`：标题、状态、来源数、更新时间；进入编辑页；删除后 3 秒内可撤销
- `/drafts/[id]`：标题、状态、Markdown 编辑、实时预览、来源侧栏；⌘/Ctrl+S 保存
- 删除是软删除（`drafts.deleted_at`），撤销会恢复同一篇草稿，不碰原始碎片
- 导出 `text/markdown`，带 `title / date / tags / status` frontmatter，并在正文后追加 `## 来源`
- 备份：`pnpm db:backup` 用 `VACUUM INTO` 生成数据库快照，并把 `media/` 打包到同一份备份目录；服务器每天 04:15 自动运行
- 恢复：`pnpm db:restore <backup-dir> [--include-media]`；恢复前先停服务，脚本会先保存当前库快照

验收：

- [x] 导出的 Markdown 能直接放进 Obsidian
- [x] 草稿重开后仍能看到来源映射
- [x] 备份可以在空数据库上恢复
- [x] 删除草稿不会删除原始碎片
- [x] 删除后 3 秒内可撤销

---

## 3. 数据模型

SQLite 文件放在服务器的持久目录，例如：

```text
/opt/josh-portal/data/portal.sqlite
```

**不能**放在 `releases/<sha>/` 里，否则每次部署都会换掉。

### 3.1 表

```sql
-- 不建 users / api_tokens：第一版固定 owner_id = 'local'
-- 插件和 curl 用服务端静态 PRIVATE_API_TOKEN，改 env 并重启即撤销。

fragments
  id, owner_id, kind, quote, note,
  source_url, source_title, source_site,
  context_before, context_after,
  captured_at, status, content_hash,
  metadata_json, created_at, updated_at, deleted_at

fragment_tags
  fragment_id, tag

synthesis_runs
  id, owner_id, status, prompt, model,
  fragment_ids_json, outline_json,
  result_markdown, citations_json,
  error, created_at, started_at, completed_at

synthesis_events
  id, run_id, seq, type, payload_json, created_at

drafts
  id, owner_id, synthesis_run_id, title, slug,
  markdown, citations_json, status,
  created_at, updated_at
```

### 3.2 约定

- 所有业务表都有 `owner_id`；第一版固定 `local`，但 schema 不锁死单用户。
- 第一版不建用户表、Token 表；登录只认 `ADMIN_PASSWORD`，插件只认静态 `PRIVATE_API_TOKEN`。
- ID 用 `crypto.randomUUID()`。
- 时间统一 UTC ISO 字符串。
- 软删除用 `deleted_at`，草稿和碎片分开删除。
- `content_hash` 用于精确去重；近似重复检测留到以后。
- 标签规范化后存 `fragment_tags`，不把标签塞进 JSON。
- `synthesis_events` 保存过程，支持弹窗重开和断线重连。
- 第一版用 `LIKE` 搜中文（FTS5 的默认分词对中文不友好，trigram 又要求至少 3 个字符）；英文量变大后再加 FTS5。

### 3.3 迁移

- `src/lib/db/migrations/001_init.sql`
- `schema_migrations` 记录版本
- 启动时自动迁移；迁移前自动备份
- 连接使用 WAL、`busy_timeout`，单进程写入

---

## 4. 采集：只采碎片，不采整页

浏览器插件不做“网页全文剪藏”，全文仍然走现有流程进 Obsidian。

### 4.1 插件交互

选中文字后：

- 快捷键或右键“存到半亩 Inbox”；右键二级菜单列出已有标签
- 没选中文字时，保存当前页链接，交给服务端生成卡片
- 弹窗里显示：
  - 选中的文字
  - 页面标题、URL、站点
  - 前后各 300–500 字上下文
  - 随想输入框
  - 标签选择 / 新建
- 保存后 toast：“已进入 Inbox”；重复时提示“这条已经有了”

### 4.2 技术边界

- Manifest V3，Chrome / Edge 优先；Safari / Firefox 后置
- 权限只开 `activeTab`、`scripting`、`storage`、`contextMenus`
- API 地址和 Token 存在 `chrome.storage.local`
- 请求只用 Bearer Token，不把 Token 注入页面
- 批量面板用 Shadow DOM 注入页面；页面侧只收集选段文本、上下文和来源，保存由 service worker 带 Token 发送
- 同一批碎片共用 `groupId`，单批最多 50 段；Inbox 只按 `groupId` 折叠展示，不改碎片本身的编辑/删除语义
- 采集正文长度上限 20,000 字符；上下文各 500 字符
- 图片不下载、不转存；链接卡片只引用目标页提供的图片 URL
- 图片碎片的 `kind` 是 `image`，`metadata.image.src` 只接受 http(s) 远程 URL；没有本地图床前不提供真实下载按钮
- X 先走官方 oEmbed 拿作者和帖子正文，再读页面的 `og:title` / `article:published_time`：文章卡片显示真实文章名、作者和发布日期；普通帖子不显示“某人在 X”的空标题，直接以正文为主，作者留在上方 byline
- 抖音页面有反爬时保存为“抖音链接”卡片，配置 `MEDIA_RESOLVER_URL` 后补标题/封面
- 知乎页面通常返回 403；配置 `LINK_READER_URL`（例如 `https://r.jina.ai/`）后通过文字 Reader 补标题和摘要，未配置时显示明确 fallback，不留白
- 普通网页如果是 JS 空壳（`<title>` 为空或只有站点名），也会走 Reader；卡片优先展示标题和前两段正文，鼠标悬停在被截断的正文上可看全文
- Reader 会把目标 URL 发送到该服务；只想用本地直连时把 `LINK_READER_URL` 留空
- 链接预览抓取只允许公网 http(s)，重定向逐跳校验
- 重复粘贴同一链接会刷新旧卡片的预览（保留随想和标签），不会静默覆盖成 fallback
- 调研过 `unfurl.js`、`open-graph-scraper`、`link-preview-js`、`metascraper`，没有引入重依赖：X 用官方 oEmbed + 页面元数据，通用 OG 复用 media 插件解析，抖音保留可选 resolver / 明确 fallback

---

## 5. Inbox 和日历

### 5.1 `/inbox`

- 默认按捕获时间倒序，可切换最早优先
- 标签用 chips 展示并显示数量，点击即可筛选
- 日期只有一个入口：支持单日和范围，带今天/近 7 天/近 30 天预设
- 日期网格用 Cally（MIT，约 9.5KB gzip），保留自定义弹层和纸片主题；桌面范围显示两个月，窄屏一个月；范围端点用方块，不用半圆胶囊
- 布局支持 1 / 2 / 3 列，选择会保存在本地；窄屏强制单列
- 列表使用最短列瀑布流：卡片保持自然高度，短卡片不会被长卡片撑高；切换列数用 FLIP 位移动画，`prefers-reduced-motion` 下关闭
- 图片沿用 `loading="lazy"` 并加 `decoding="async"`，不额外引入 Masonry 库
- 搜索：原文、随想、标题、来源；标签单独筛选，可与搜索组合
- 单条显示：原文、随想、来源、上下文（展开/归档后续再加）
- 编辑：随想、标签
- 删除：软删除；删除按钮改为长按 1 秒，红色边框从右下角沿纸片圆角顺时针闭合（不再用悬浮圆环/小火苗），闭合后纸片从底部碳化/收缩约 1 秒（`1.05s`），再重新排布，保持当前滚动位置；`prefers-reduced-motion` 下直接移除
- 工具栏增加「刷新」；窗口重新获得焦点/从后台回到前台时自动重读，编辑/选择/删除动画期间不打扰；避免插件采集后页面一直显示旧列表
- 卡片使用纸片质感：轻微旋转/错位、纸纹、胶带、非对称圆角
- 正文有最大高度：桌面 20rem、窄屏 17rem，超出做底部渐隐并显示“点击查看全文”；点 quote 卡片打开全文弹窗
- 图片碎片图优先：图片本身打开灯箱，底部只留一行 `时间 · 来源`，来源行才跳转；不再单独铺 alt/说明
- 带封面的 link 卡：封面图点击进灯箱，标题/摘要/底部仍跳源；图片只有在存成 image 碎片时才走纯图片卡
- 同页组卡片默认是最多 4 张的错位牌堆；每张卡位置固定，只通过透明度/阴影“浮现”，鼠标横向移动不会让卡面位移抖动
- 牌堆错开距离随组内数量反向变化：2 条约 20px，4 条约 8px，10 条约 4px；组越大越紧凑
- 点牌堆打开“查看整组”弹窗；鼠标悬停只切换当前预览，不改变布局
- 组卡片头部的来源、日期、数量只出现一次；组内子卡不重复来源/时间；组弹窗按两列卡片铺开，底部再给一次来源入口
- 组卡片头部提供“查看整组”，弹窗一次展示全部成员；内联“展开”仍保留，用于直接编辑/删除
- 多选：进入“选择”模式后点卡片切换；Shift 连选；拖拽矩形框选；全选；组卡片可“选择整组”或从组弹窗一次加入
- 底部操作条显示“已选 N 条 / 合成文章”
- 左侧日期 rail 暂缓：当前数据量下会重复卡片元数据并挤压瀑布流；等按日期排序的碎片超过 30 条再做 sticky 年/月索引和 scroll spy，不做成筛选器
- 键盘 `j/k`、`x`、`e`、`/` 快捷键后续再加

### 5.2 日期筛选

`/calendar` 已砍。Inbox 用 `from` / `to` 筛选日期；不显示虚假的“连续打卡”或在线人数。

### 5.3 公开边界

- `/inbox`、`/drafts` 全部 `noindex`
- 不进 sitemap、不进搜索索引、不进公开 MCP
- 未登录直接 401 或跳转 `/login`
- `robots.txt` 和 sitemap 都不列私有路由
- 页面 HTML 不内联碎片正文；数据通过同源 API 取

---

## 6. 合成流水线

### 6.1 阶段

```text
1. 收集     校验、加载、去重
2. 聚类     按主题/标签/来源分组
3. 大纲     每组对应文章哪一节
4. 成文     按节生成，带来源编号
5. 润色     按 humanizer-zh 约束只改表达，不改事实和引用
6. 校验     检查无来源段落、空引用、重复
7. 草稿     用户点“保存草稿”后才写入 drafts

> 站内 `library/docs/notes` 关联检索不在第一版链路里；等基础合成稳定后再加，避免把公开内容混进私人碎片上下文。
```

### 6.2 提示词策略

第一版用两段式，避免一次塞太多：

**第一段：结构化规划**

```json
{
  "clusters": [
    { "id": "c1", "title": "...", "fragment_ids": ["f1", "f2"], "angle": "..." }
  ],
  "outline": [
    { "heading": "...", "intent": "...", "fragment_ids": ["f1"] }
  ]
}
```

**第二段：按节写**

- 每节只拿相关碎片 + 站内关联资料
- 输出正文 + 引用编号
- 不允许编造新的来源
- 统一用中文，保留作者原来的判断和语气

**第三段：humanize-zh 润色（默认开，可关）**

- 只输入当前节正文和来源编号，不输入新资料
- 只改表达：删空话、重复、模板句；保留判断、语气、限定和正式程度
- 不新增事实、数字、人名、日期、来源；不删除 `[fN]`
- 保留标题层级、代码块、行内代码、URL、frontmatter
- `temperature: 0.4`，`low` 思考，一次 pass
- 润色前后提取 `[fN]` 集合，必须完全一致；否则丢弃润色稿，回退原文
- 规则来源是 `humanizer-zh` skill，运行时读仓库内固化 prompt，不依赖 `~/.pi`

### 6.3 引用校验

- 每个生成段落必须带 `[f1]` 这类来源编号
- 润色后再跑一遍引用校验，不能只校验成文稿
- 没有来源的段落标记 `needs_source`
- 引用了不存在的碎片直接丢弃
- 最终草稿附“来源”一节，列出碎片原文和 URL
- 校验结果进入 `citations_json`，不只放在正文里

### 6.4 无 AI key 的降级

没有配置 `AI_API_KEY` 时仍然可用：

- 按标签 / 日期 / 来源做确定性聚类
- 生成大纲模板
- 把碎片原文按组拼成“结构化草稿”
- 页面明确写“未配置 AI，这是结构草稿”，不伪装成生成文章

### 6.5 失败和取消

- 失败保存失败阶段和错误信息
- 支持从失败阶段重试
- 取消后状态为 `cancelled`，不产生半篇 completed 草稿
- 同一 owner 同一时间只允许 1 个运行中的合成任务
- 上游 429 / 超时只重试一次，避免费用失控
- 月度预算上限由 AI Studio 项目月上限、Cloud Billing spend cap 和应用层 `AI_MONTHLY_BUDGET_USD` 三层兜住

### 6.6 第一版实现入口

```text
src/lib/synthesis/ai.ts        OpenAI 兼容调用、JSON/流式、429/5xx 单次重试
src/lib/synthesis/plan.ts      去重、局部聚类、AI 计划归一化、引用校验、结构稿
src/lib/synthesis/events.ts    进程内事件总线
src/lib/synthesis/runner.ts    阶段机、取消、降级、持久化
src/lib/db/syntheses.ts        run / event / draft 读写
src/pages/api/synthesis/       create / status / stream / cancel / retry / save
```

---

## 7. 合成工作台弹窗

这是 Phase 2 的重点体验，不是普通表单弹窗。

### 7.1 布局

全屏工作台，双栏（不做连线画布）：

```text
┌────────────────────────────────────────────────────┐
│ 阶段条：收集 → 聚类 → 关联 → 大纲 → 成文 → 润色 → 校验 │
├──────────────────────┬─────────────────────────────┤
│ 碎片卡片 + 聚类       │ 大纲 / 正文                  │
│ 可点开原文            │ 实时 Markdown                │
├──────────────────────┴─────────────────────────────┤
│ 取消 / 重聚类 / 改提示词 / 只重写本节 / 保存草稿     │
└────────────────────────────────────────────────────┘
```

### 7.2 动效原则

- 只用 `transform` / `opacity`
- 尊重 `prefers-reduced-motion`
- 动效由真实事件驱动：聚类完成才连线，大纲返回才展开章节
- AI 慢的时候显示真实等待状态，不伪造百分比
- 关闭弹窗后任务可继续；重新打开能回放过程
- 选中的碎片从页面位置汇聚到工作台中心，纸片边缘/裂纹随聚类接近而闭合
- 结果弹窗先出文章名列表；每篇文章下方挂关键词来源 chips，可拖出、长按移除，确认后才生成草稿

### 7.3 交互

- 点碎片卡片 → 看原文、来源、标签
- 点聚类 → 高亮所属碎片和对应章节
- 点正文里的 `[f3]` → 定位到碎片
- “重聚类”保留已选碎片
- “改提示词”只影响本次运行
- “只重写本节”不重新生成全文
- “保存草稿”后才进入 `/drafts`

---

## 8. 草稿与导出

### 8.1 `/drafts`

- 列表：标题、状态、来源数量、更新时间
- 打开：Markdown 编辑 + 预览 + 来源侧栏
- 状态：`draft` / `exported` / `archived`

### 8.2 导出

第一版导出**单个 `.md`**，不做 zip：

```markdown
---
title: "..."
date: 2026-...
tags: [...]
status: draft
---

正文

## 来源

1. [f1] 原文… — URL
```

- 可选复制到剪贴板
- 不直接写回 Obsidian
- 不自动加 `publish: true`
- 以后再加“导出到 Obsidian / 创建 PR”

### 8.3 备份与恢复

```bash
pnpm db:backup
# ✓ data/backups/20261031-005230/{portal.sqlite,media.tar.gz,manifest.json}

# 先停 josh-portal
pnpm db:restore data/backups/20261031-005230 --include-media
```

- 备份用 SQLite `VACUUM INTO`，WAL 模式下也是一致快照；媒体单独打成 `media.tar.gz`
- 服务器已装 `josh-portal-backup.timer`，每天 04:15 备份，默认保留 14 份
- Mac 侧可用 `HALFMU_HOST=... pnpm db:pull` 拉一份异地副本
- 恢复前脚本会把当前库复制成 `portal.before-restore-...sqlite`；`--include-media` 才会覆盖媒体
- 备份文件含私人碎片，不要提交、不要上传公开网盘

完整说明见 [备份与恢复](./BACKUP.md)。

---

## 9. 登录、权限和隐私

### 9.1 登录

第一版不做邮箱注册，也不做 GitHub OAuth：

- `ADMIN_PASSWORD` 环境变量
- `POST /api/auth/login` 设置 HMAC 签名的 HttpOnly cookie
- `SESSION_SECRET` 签名
- HTTPS 下 cookie 加 `Secure`；本地 HTTP 开发除外

### 9.2 Token

- 浏览器插件和 curl 用服务端静态 `PRIVATE_API_TOKEN`
- 不做 Token 表、不做 scopes、不做撤销页
- 轮换方式：改环境变量 → 重启服务；旧 Token 立即失效

### 9.3 私有数据规则

- 碎片、草稿、合成事件绝不进公开搜索索引
- 私有 API 不返回给未授权请求
- 不把碎片塞进公开 MCP
- 不在日志里打印碎片正文和 Token
- 日志只记录 ID、阶段、耗时、错误码

### 9.4 AI 数据

- 碎片会发送给配置的 AI 服务商
- 使用哪个 provider / model 必须可见
- 支持 `AI_BASE_URL` 指向本地或自建模型
- 不把 AI key 发到浏览器
- 第一版不做 embedding，避免额外数据外流

---

## 10. 代码结构

```text
src/lib/db/
  client.ts
  migrate.ts
  fragments.ts
  drafts.ts

src/lib/synthesis/
  pipeline.ts
  cluster.ts
  prompts.ts
  humanize.ts
  citations.ts
  fallback.ts
  budget.ts

src/lib/
  private-auth.ts
  private-http.ts

src/pages/api/
  auth/login.ts
  auth/logout.ts
  fragments/index.ts
  fragments/[id].ts
  synthesis/runs.ts
  synthesis/runs/[id]/events.ts
  synthesis/runs/[id]/cancel.ts
  drafts/index.ts
  drafts/[id].ts
  drafts/[id]/export.md.ts

src/pages/
  login.astro
  inbox.astro
  drafts/index.astro
  drafts/[id].astro

src/components/synthesis/
  Workbench.astro
  Timeline.astro
  FragmentCard.astro
  SourcePanel.astro

src/scripts/
  synthesis-client.ts

extension/
  manifest.json
  background.js
  popup.html
  popup.css
  popup.js
  README.md
```

原则：

- 不引入 React / Tailwind；沿用 Astro + 原生 TS + 现有 token。
- 数据库只在服务端 import，构建静态页面时不打开连接。
- 合成长任务不塞进 Astro 页面渲染；API 独立处理。
- 复用现有 `AI_*` 配置和 `retrieve()`，不再造一套搜索。
- 现有 `bookmarks`、`library`、`notes` 的数据源不变。

---

## 11. 部署与运维

- systemd 增加 `PORTAL_DATA_DIR=/opt/josh-portal/data`
- `data/` 和 `.env` 不随 release 覆盖
- 部署只替换 `dist`，不碰数据库
- 迁移前备份：`pnpm db:backup`（或让 `josh-portal-backup.timer` 先跑一次），确认 `/opt/josh-portal/backups/<时间>/portal.sqlite` 存在
- 每日备份 + 保留 7 天
- 健康检查增加数据库可读状态
- GitHub Action 部署前跑 `pnpm check`
- 私有路由不进入 sitemap；Nginx 增加 `X-Robots-Tag: noindex`

---

## 12. 测试

### 单元

- 迁移幂等
- 碎片去重
- 标签规范化
- 聚类 fallback
- 引用提取和校验
- 草稿导出格式
- 链接预览解析（X oEmbed / X Article 标题 / 抖音 fallback / 私网 URL 拒绝）
- Token hash / scope

### 集成

- 未登录 401
- 登录后 CRUD
- 并发合成限制
- SSE 取消 / 重连
- 数据库重启持久化

### 手工

- 真实网页采集
- 手机宽度 Inbox
- 5 条真实碎片生成
- 导出到 Obsidian 打开
- 无 AI key 降级
- `prefers-reduced-motion`

---

## 13. 非目标

Phase 2 明确不做：

- 自动修改旧文章
- 自动发布 / 自动加 `publish: true`
- 自动写回 Obsidian
- 图片抓取、压缩（本地媒体库已在 P2.0 补上；对象存储后置）
- 全文网页剪藏（仍走现有流程）
- 公开碎片页
- 多用户注册和权限管理 UI
- embedding / 向量数据库
- 假的进度、假的统计、假的在线人数
- 用 React / Tailwind 重做前端

---

## 14. 需要你评审的决策

已定：

1. **私有入口**：本地先用 `localhost`；部署前再上域名 + HTTPS 或 Tailscale。
2. **插件范围**：只做 Chrome / Edge。
3. **登录**：ADMIN_PASSWORD + HMAC cookie；插件用静态 `PRIVATE_API_TOKEN`。
4. **AI 预算**：`$5/月`；公开助手和私人合成共用一把 `GEMINI_API_KEY`。
5. **合成范围**：只用手选碎片；`/library/` 只作为可选的关联资料，不自动扩大范围。
6. **导出格式**：单个 `.md`。
7. **工作台**：包含，双栏 + 顶部阶段条，不做画布。
8. **草稿位置**：只存 SQLite；不直接写回 Obsidian。

---

## 15. 建议的实施顺序

```text
2.0 私有入口
  ↓
2A SQLite + 登录 + 采集 API（本地实现完成）
  ↓ 停下来验收
2B 插件 + Inbox 完善（本地实现完成）
  ↓ 停下来验收
2C 合成流水线 + 工作台弹窗
  ↓ 停下来验收
2D 草稿编辑 + 导出 + 备份
  ↓ 停下来验收
2E 公开溯源（可选，Phase 2.5）
  ↓
Phase 3 旧文章 insert-only 更新
```

Phase 2 完成后，你得到的是：**一个能持续收集、整理、生成、导出的内容工作台**，而不是一个“AI 写作按钮”。
