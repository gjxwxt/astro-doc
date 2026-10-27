# 架构说明

这份文档描述重构后的基础结构、数据流和扩展点。目标是：内容静态、工具可插拔、搜索和 AI 共用一份索引、MCP 不重复实现业务逻辑。

## 1. 分层

```text
浏览器
  ├─ 静态页面（门户 / 笔记 / 工具页 / 收藏 / 文档）
  ├─ 客户端交互（搜索、音乐、DevKit、标注、AI 面板）
  └─ fetch /api/*
        ├─ /api/search      站内检索
        ├─ /api/chat        AI 助手（SSE，可降级为检索）
        ├─ /api/tools/*     插件 action 统一入口
        └─ /api/health
              │
              ├─ 插件 registry + server actions
              ├─ src/lib/search.ts（同一套打分逻辑）
              ├─ search-index.json（构建时生成）
              └─ 外部服务（歌曲海 / 歌曲客 / 网易云 / AI / 媒体解析）
```

**静态优先**：Astro 的 `output: 'static'` + Node adapter。页面在构建时预渲染；只有显式 `prerender = false` 的 API 路由走 Node 服务端。`/search-index.json`、`/plugins.json`、`/notes/rss.xml` 都是预渲染的静态文件。

**为什么不用纯静态**：AI 助手需要隐藏 key，插件需要代理跨域/带密钥的请求，评论/标注将来需要服务端存储。把这些收在 `/api/*`，页面本身仍然可以 CDN 化。

## 2. 路由

| 路由 | 渲染 | 说明 |
| --- | --- | --- |
| `/` | 预渲染 | 门户首页，左轨 + 右栏 |
| `/docs/*` | 预渲染 | Starlight 文档 |
| `/notes/` | 预渲染 | 笔记列表、标签过滤 |
| `/notes/[slug]/` | 预渲染 | 笔记正文、TOC、划线、评论 |
| `/tools/` | 预渲染 | 插件目录 |
| `/tools/[plugin]/` | 预渲染 | 插件工作台 + API 说明 |
| `/bookmarks/` | 预渲染 | 收藏，客户端叠加本地修改 |
| `/search-index.json` | 预渲染 | 全站搜索索引 |
| `/plugins.json` | 预渲染 | MCP 读取的插件清单 |
| `/notes/rss.xml` | 预渲染 | 笔记 RSS |
| `/api/search` | 服务端 | 查询静态索引 |
| `/api/chat` | 服务端 | SSE，AI 或检索降级 |
| `/api/tools/[plugin]/[action]` | 服务端 | 校验、限流、调用插件 |
| `/api/health` | 服务端 | AI/解析服务是否配置 |

旧路由 `/learn/*`、`/guides/*`、`/tools/website` 在 `astro.config.mjs` 里 301 到新位置。`/tools/website` 会和插件路由冲突，所以用重定向而不是保留页面。

## 3. 内容模型

`src/content.config.ts` 定义三个集合：

| 集合 | Loader | 用途 |
| --- | --- | --- |
| `docs` | `docsLoader()` | Starlight 文档，额外扩展 `date` / `tags` |
| `notes` | `glob('**/*.md')` | 笔记，要求 `title` / `date`，可选 `description` / `updated` / `tags` / `draft` / `featured` / `source` |
| `bookmarks` | `file('./src/content/bookmarks.yaml')` | 一个 YAML 对象，key 是分类 id |

Starlight 文档放在 `src/content/docs/docs/`，所以 URL 是 `/docs/...`，不会和门户的 `/`、`/tools/` 冲突。

笔记的 `draft: true` 会在列表、路由和 RSS 中排除。`source` 是同步脚本写入的 Obsidian 相对路径，用于排查。

## 4. 搜索

构建时 `src/pages/search-index.json.ts` 把以下内容合并成一个数组：

- 笔记：标题、描述、标签、日期、正文纯文本（截断 6000 字）
- 文档：同上
- 工具：manifest 描述、action、说明
- 收藏：分类、名称、描述
- 静态页：关于、工具目录、笔记目录

运行时：

- `src/lib/search.ts` 是纯函数，负责分词、IDF 打分、摘要和高亮片段。
- 中文按 **bigram** 切分，英文按单词；查询会过滤停用词。
- 标题权重 12、标签 8、描述 4、正文 1；完整短语命中额外加分。
- 页面上的搜索（⌘K 和左轨）直接 fetch 静态索引，在浏览器里算。
- `/api/search` 在服务端用同一个函数，供 MCP 和其他调用方使用。
- `/api/chat` 和 MCP 的 `get_page` 也读这份索引。

没有引入 MiniSearch/Pagefind 作为统一搜索：索引很小，自己实现能控制中文分词和权重，也少一个依赖。Starlight 仍然保留 Pagefind 给文档头部搜索。

## 5. AI 助手

`/api/chat` 接收最近 10 条消息，取最后一条用户消息，检索 top 6 站内内容，然后：

- **没有 `AI_API_KEY`**：SSE 返回 `sources` + 一段按检索结果拼好的回答 + `done`。UI 标注“检索模式”。
- **有 key**：调用 `${AI_BASE_URL}/chat/completions`，`stream: true`，把上游 SSE 转成自己的 `sources` / `token` / `done` 事件。系统提示要求只根据资料回答、用中文、引用站内链接。

这样 key 缺失不会让助手整个不可用；也避免把 key 暴露到浏览器。

## 6. 插件

每个插件是 `src/plugins/<id>/`：

```text
manifest.ts   纯数据：id/name/tagline/status/actions/input schema/config
server.ts     可选：actions = { [id]: (input, ctx) => Promise<unknown | Response> }
Tool.astro    界面
```

- `src/plugins/registry.ts` 用 `import.meta.glob('./*/manifest.ts', { eager: true })` 自动发现，按 `order` 排序。
- `src/plugins/server.ts` 用 `import.meta.glob('./*/server.ts')` 自动发现 action。
- `/api/tools/[plugin]/[action]` 负责：Bearer token（可选）、限流、JSON 解析、输入校验、调用、错误映射。
- 输入 schema 是插件自己定义的 JSON Schema 子集；`toJsonSchema()` 同时给 MCP 用，所以没有第二份 schema。
- 返回 `Response` 时直接透传（音乐下载就是 MP3/zip 二进制）；返回普通对象时包成 `{ ok: true, data }`。
- 插件可以声明 `config.env`，工具页显示配置提示；真正的环境变量只在服务端读取。

**安全边界**：插件是站主自己写的代码，不是沙箱。不要在不信任的插件里 `eval` 或读取用户文件。`media` 的 URL 抓取做了私网地址拦截，但 DNS rebinding 这类边界没有彻底解决，详见部署文档。

## 7. MCP

`packages/mcp-server` 是一个独立的 stdio 进程：

```text
MCP client ──stdio──> portal-mcp ──HTTP──> 门户 /api/tools/*
                           ├─ /plugins.json（动态注册插件 tool）
                           └─ /search-index.json + /api/search
```

它不 import 站点代码，避免把 Astro/Node 依赖塞进 MCP 进程。插件新增后，MCP 服务端重启即可看到新 tool。

## 8. 浏览器端状态

| 数据 | 存储 | 说明 |
| --- | --- | --- |
| 主题 | `localStorage['starlight-theme']` | 和 Starlight 共用；支持系统主题 |
| 收藏修改 | `localStorage['portal-bookmarks:v1']` | 只存差异：hidden / custom / edits |
| 划线批注 | `localStorage['portal-annotations:v1:<path>']` | TextQuoteSelector 风格的 quote + prefix + suffix |
| 读后评分 | `localStorage['portal-rating:v1:<path>']` | 1–5 星 |
| AI 对话 | `sessionStorage['portal-assistant-history']` | 关闭标签页即清空 |

没有账号体系，所以这些数据不跨设备。要做跨设备同步时，应该先加认证和服务端存储，而不是把 localStorage 直接暴露成公共 API。

## 9. 样式

- `src/styles/tokens.css`：颜色、字体、字号、间距、圆角；亮/暗两套。
- `src/styles/base.css`：reset、按钮、标签、进入动效、可访问性。
- `src/styles/portal.css`：门户、阅读页、工具页、收藏、搜索、AI、标注。
- `src/styles/tools.css`：插件工作台内部。
- `src/styles/starlight.css`：把 Starlight 的变量映射到同一套 token。

没有 Tailwind。原因不是排斥工具，而是这个站的样式量不大，且 Starlight 自带设计系统；再叠一层 Tailwind + shadcn 会造成变量、reset、构建配置的重复。插件作者可以直接写 scoped CSS，也可以用任何 Astro 支持的框架（需要自己加集成）。

## 10. 已知取舍

- 搜索索引是构建时快照；改内容后要重新 build（dev 模式会实时生成）。
- 收藏的页面编辑只在本机；YAML 才是团队/多设备的真相。
- 评论依赖 Giscus（GitHub Discussions）；没有自建评论后端。
- 标注只在本机，且 CSS Custom Highlight API 不支持时只保存、不渲染高亮。
- 视频解析是“配置驱动”的：仓库不内置 scraper，避免接口失效和法律风险。
- 只有 Node 部署才有 API；纯静态托管只能看页面，工具/AI 会 404。
- 插件没有权限系统；新增插件前先审查代码。
