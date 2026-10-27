# Josh 的个人门户

文档、笔记、工具和收藏，一个入口。基于 Astro 7 + Starlight，静态优先，工具插件化。

- 门户：`/`
- 文档：`/docs/`（Starlight）
- 笔记：`/notes/`（可从 Obsidian 同步）
- 工具：`/tools/`（插件系统，HTTP API + MCP）
- 收藏：`/bookmarks/`（YAML 数据 + 浏览器本地修改）

## 技术栈

- **Astro 7**：页面、内容集合、API 路由
- **Starlight 0.42**：文档站
- **Node adapter**：只承载 `/api/*` 和需要运行时数据的路由；其余页面预渲染
- **原生 TypeScript + 手写 CSS**：没有 React、Vue、Tailwind、shadcn
- **MCP**：独立的 stdio 服务端，读取门户的 `/plugins.json` 和 `/search-index.json`

## 快速开始

需要 **Node >= 22.23.4**，仓库里固定的是 Node 24：

```bash
nvm use            # 读取 .nvmrc
pnpm install
pnpm dev           # http://localhost:3005
```

构建并启动生产服务器：

```bash
pnpm build
PORT=4321 HOST=0.0.0.0 pnpm start
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 开发服务器，端口 3005 |
| `pnpm build` | 构建静态页面 + Node 服务端 |
| `pnpm start` | 启动 `dist/server/entry.mjs` |
| `pnpm check` | `astro check` + MCP 类型检查 + 单元测试 |
| `pnpm test` | Vitest |
| `pnpm sync:notes` | 从 Obsidian 同步笔记 |
| `pnpm sync:notes --watch` | 监听 Obsidian 目录并持续同步 |
| `pnpm new:note "标题"` | 新建一篇手写笔记 |
| `pnpm mcp:build` | 构建 MCP 服务端 |
| `pnpm mcp` | 启动 MCP 服务端（stdio） |
| `pnpm build:all` | 构建站点 + MCP |

## 目录

```text
src/
├── config/site.ts           # 站点身份、导航、Giscus
├── content.config.ts        # docs / notes / bookmarks 三个集合
├── content/
│   ├── docs/                # Starlight 文档（URL /docs/...）
│   ├── notes/               # 笔记（URL /notes/...）
│   └── bookmarks.yaml       # 收藏数据
├── pages/
│   ├── index.astro          # 门户首页
│   ├── notes/               # 列表、详情、RSS
│   ├── tools/               # 工具目录、插件页
│   ├── bookmarks/           # 收藏页
│   ├── about.astro
│   ├── search-index.json.ts # 构建时生成全站搜索索引
│   ├── plugins.json.ts      # 给 MCP 的插件清单
│   └── api/                 # search / chat / tools / health
├── plugins/
│   ├── registry.ts          # manifest + UI 自动发现
│   ├── server.ts            # server action 自动发现
│   └── music|devkit|media/  # 每个插件：manifest + server + Tool.astro
├── lib/                     # 搜索、Markdown、AI、限流、校验、music 聚合源
├── layouts/                 # PortalLayout / NoteLayout
├── components/              # 门户、笔记、收藏、搜索、助手
└── styles/                  # tokens / base / portal / tools / starlight
scripts/
├── sync-content.ts          # Obsidian → src/content/notes
├── new-note.ts
└── lib/sync.ts              # 可测试的纯函数
packages/mcp-server/         # stdio MCP 服务端
docs/                        # 架构、插件、同步、MCP、部署
```

## 内容从哪来

- **文档**：`src/content/docs/docs/**.md(x)`，新增文件后在 `astro.config.mjs` 的 sidebar 里加分组或放进已有目录。
- **笔记**：直接写 `src/content/notes/*.md`，或用 `pnpm sync:notes` 从 Obsidian 同步。详见 [docs/CONTENT-SYNC.md](docs/CONTENT-SYNC.md)。
- **收藏**：改 `src/content/bookmarks.yaml`。页面上的编辑只存在浏览器，可导出/导入修改。

## 加一个工具

在 `src/plugins/<id>/` 放三个文件：

```text
manifest.ts   # 名称、说明、action、输入 schema（纯数据）
server.ts     # 可选：需要联网/密钥的 action
Tool.astro    # 界面
```

注册表会自动发现，`/tools` 和 `/api/tools/*` 自动出现；如果 action 标了 `mcp: true`，MCP 服务端启动时也会注册。完整说明见 [docs/PLUGIN-AUTHORING.md](docs/PLUGIN-AUTHORING.md)。

## 搜索、AI 和 MCP

- 构建时由 `src/pages/search-index.json.ts` 生成全站索引：笔记、文档、工具、收藏、静态页。
- 页面内的 ⌘K 搜索和左侧搜索框在浏览器里用同一份索引做检索。
- `/api/chat` 默认是“站内检索”模式；配置 `AI_API_KEY` 后切换成 OpenAI 兼容的生成式回答，检索结果作为来源。
- MCP 服务端不复制业务逻辑：它读取门户的 `/plugins.json`，把每个 `mcp: true` 的 action 注册成 tool，再转发到 `/api/tools/*`。详见 [docs/MCP.md](docs/MCP.md)。

## 环境变量

复制 `.env.example`：

```bash
cp .env.example .env
```

| 变量 | 用途 |
| --- | --- |
| `SITE_URL` | canonical、sitemap、RSS、MCP 使用的公开地址 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | OpenAI 兼容的对话接口；不填 key 时自动降级 |
| `PORTAL_API_TOKEN` | 可选，外部调用 `/api/*` 时的 Bearer Token |
| `MEDIA_RESOLVER_URL` / `MEDIA_RESOLVER_TOKEN` | 可选，视频解析服务 |

评论默认关闭。想开放评论时，在 `src/config/site.ts` 填 Giscus 的 `repo / repoId / categoryId`。

## 设计

视觉方向是“左右分栏的个人工作台”：左侧是固定的深色身份/搜索/导航，右侧是可滚动的索引式内容。配色为森林绿 + 酸橙 + 米白，标题用 Newsreader / 宋体，正文用系统无衬线。没有渐变、玻璃、阴影堆叠；动效只保留进入、悬停和左侧名字的轻微缩放。

## 从旧版本改了什么

旧站是 Astro 4 + Starlight 模板 + 首页硬编码的网址导航 + React 右键菜单 + 两套 Tailwind 配置。现在：

- 文档整体移到 `/docs/`，门户首页独立。
- 收藏从 `index.astro` 里搬进 YAML，去掉假的浏览量。
- 去掉 React、Tailwind、shadcn、Radix、GSAP、Vue 和无用的按钮组件。
- 去掉全局禁用右键、`StarlightPage` 套 `<html>`、重复安装 Tailwind 集成等问题。
- 新增插件系统、构建时搜索索引、AI 助手、划线批注、Obsidian 同步、MCP。
- 旧 URL（`/learn/*`、`/guides/*`、`/tools/website`）做了 301。

## 部署

需要 Node 运行时（API 和 AI 助手）。Nginx、systemd、Docker 示例见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 音乐下载（家庭自用）

`/tools/music/` 是服务端聚合搜索，不依赖浏览器插件：

- **顺序**：歌曲海 → 歌曲客 → 网易云，第一个有结果的源就停。
- **下载**：128kbps MP3；有 LRC 时打包成 zip（mp3 + lrc），没有歌词就只给 MP3。
- **入口**：家人打开门户，搜「歌名 歌手」，点下载即可。
- **歌曲宝**：有 Cloudflare 校验，暂不放进服务端主链路；需要时再单独加浏览器/Playwright 适配。
- **无损**：这两个站的直链接口只给 128kbps；无损通常要走夸克或其他源，不在这一版。
- **实现**：`src/lib/music/`，参考了 MusicDL 的源适配思路，代码在门户内重新实现。

音乐是短请求同步打包；视频这种长任务仍建议用独立服务（MeTube / yt-dlp），不要塞进 Astro 进程。

只用于家庭自用，不要做成公开下载站，也不要批量抓取。

## 说明

- 音乐源可能限流、改版或返回无歌词；失败时换一个结果，或稍后再试。
- 视频解析默认只读 Open Graph；真正的视频下载走独立的 yt-dlp 服务，仓库里不内置聚合站抓取逻辑。
- 自用下载器也要遵守来源站点的条款；不要把受版权保护的内容做成公开下载站。
- 划线和批注只存在当前浏览器；公开评论走 Giscus。
- 内容版权归原作者；工具和第三方接口的使用请遵守对应站点的条款。

## 进一步阅读

- [架构说明](docs/ARCHITECTURE.md)
- [写一个插件](docs/PLUGIN-AUTHORING.md)
- [Obsidian 同步](docs/CONTENT-SYNC.md)
- [MCP 接入](docs/MCP.md)
- [音乐下载](docs/MUSIC.md)
- [AI 助手](docs/AI-ASSISTANT.md)
- [评论与划线](docs/COMMENTS-AND-ANNOTATIONS.md)
- [部署](docs/DEPLOYMENT.md)
- [路线图](docs/ROADMAP.md)
- MCP 客户端配置示例：[mcp.example.json](mcp.example.json)
