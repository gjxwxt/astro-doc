# 项目约定

给后续接手这个仓库的 agent / 未来的自己。

## 环境

- Node **>= 22.23.4**，仓库 `.nvmrc` 是 24。Astro 7 在 Node 22.23.2 上会直接拒绝启动。
- 包管理器：pnpm 11（`packageManager` 字段已锁定）。
- 先 `nvm use`，再 `pnpm install`。

## 验证

改完必须跑：

```bash
pnpm check        # astro check + MCP tsc --noEmit + vitest
pnpm build        # 预渲染、API、sitemap、Pagefind
pnpm mcp:build    # 改了插件/manifest 或 MCP 时
```

涉及 UI 时再手动看 `/`、`/notes/`、`/tools/music/`、`/bookmarks/`、`/docs/`，并试 ⌘K 和 AI 面板。

## 内容

- 文档：`src/content/docs/docs/**.md(x)`，URL 是 `/docs/...`。
- 笔记：`src/content/notes/*.md`，或 `pnpm sync:notes`。
- 收藏：只改 `src/content/bookmarks.yaml`；页面编辑是本地覆盖，不是数据源。
- 旧 URL 用 `astro.config.mjs` 的 `redirects` 保住，不要留下会 404 的入口。

## 架构规则

- **静态优先**：新增页面默认预渲染；只有确实需要隐藏密钥、代理跨域或读运行时数据时才加 `prerender = false` 的 API。
- **搜索只有一份逻辑**：`src/lib/search.ts`。页面、`/api/search`、AI 检索都复用它，不要另起一套。
- **插件只有一份 schema**：manifest 的 `input` 同时给 API 校验和 MCP；不要在 MCP 里复制字段定义。
- **插件目录名 = manifest.id**；server action 只在 `server.ts`，manifest 保持纯数据。
- **MCP 不 import 站点代码**：它通过 HTTP 调门户，避免把 Astro/Node 依赖带进去。
- **AI key 只在服务端**：浏览器只调 `/api/chat`；没有 key 时必须保持“检索模式”可用。
- **音乐源一个源一个 adapter**：放在 `src/lib/music/`，`index.ts` 只负责顺序、缓存和打包；不要在 action 里写页面解析。搜索结果只传 `source` + 数字 `id`，不要接受任意音频 URL。
- **gequbao 不塞主链路**：Cloudflare 场景留给独立的浏览器 worker；服务端主链路保持歌曲海/歌曲客/网易云，失败就跳下一个源。
- **公开接口不暴露音乐源**：搜索结果只返回加密 `token`，下载时用 `verifyMusicToken` 还原 `source`/`id`；不要在前端或 manifest 里重新加源名称。

## 样式

- 先改 `src/styles/tokens.css`，不要在组件里硬编码颜色/字号。
- 门户样式在 `portal.css`，插件工作台在 `tools.css`，文档映射在 `starlight.css`。
- 不要重新引入 Tailwind/React/shadcn，除非有明确理由并愿意承担两套 reset/变量的冲突。
- 动效只做 transform/opacity，必须有 `prefers-reduced-motion` 兜底。
- 文案用中文；不要加假的统计、评论、在线人数。

## 数据与安全

- `.env`、`content-sync.config.json`、`.content-sync-state.json` 不提交。
- 同步脚本默认不覆盖手改过的目标文件；`--force` 才会覆盖。
- `media` 的 URL 抓取只允许公网 http(s)，但 DNS rebinding 没有彻底解决；不要把它当成通用 SSRF 代理。
- `PORTAL_API_TOKEN` 是轻量门禁，不是强认证；公网部署还要在反代层限流。
- 外部请求一律加超时；返回二进制时检查 content-type 和大小。

## 常见坑

- Astro 7 的 `compressHTML` 默认按 JSX 规则处理空白，纯文本里需要显式空格时用 `{' '}`。
- Starlight 的 `social` 是数组（不是对象），`editLink` 是 `{ baseUrl }`。
- `file()` loader 的路径相对项目根，不是相对 `src/content`。
- 新增插件后 MCP 要重启才会看到；`/plugins.json` 有 60 秒缓存。
- `pnpm` 的构建脚本审批在 `pnpm-workspace.yaml` 的 `allowBuilds` 里；新增原生依赖时把包名加进去，不要为此删依赖。
