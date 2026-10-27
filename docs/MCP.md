# MCP：把门户接进 AI 客户端

MCP 服务端是一个独立的 Node 进程，通过 stdio 和客户端通信。它不复制业务逻辑，只调用门户的 HTTP API。

```text
Claude Code / Cursor / 其他 MCP 客户端
        │ stdio
        ▼
packages/mcp-server  ──HTTP──▶  门户 /api/search、/api/tools/*
        │
        └── 启动时读取 /plugins.json，动态注册插件 action
```

## 1. 构建

```bash
pnpm mcp:build
```

产物：`packages/mcp-server/dist/index.js`。

## 2. 启动门户

开发：

```bash
pnpm dev          # http://localhost:3005
```

生产：

```bash
pnpm build
PORT=4321 HOST=0.0.0.0 pnpm start
```

MCP 服务端只能调用一个运行中的门户。门户没启动时，MCP 仍会启动，但只保留内置的 `search_site` / `get_page` / `list_tools`，调用会报连接错误。

## 3. 配置 MCP 客户端

以 Claude Code 的 `.mcp.json` 为例（路径换成你的绝对路径）：

```json
{
  "mcpServers": {
    "josh-portal": {
      "command": "node",
      "args": ["/Users/imac/Documents/code/astro-doc/packages/mcp-server/dist/index.js"],
      "env": {
        "PORTAL_URL": "http://localhost:3005",
        "PORTAL_API_TOKEN": ""
      }
    }
  }
}
```

Cursor、Windsurf、opencode 等客户端的配置形状类似：命令 `node`，参数指向 `dist/index.js`，环境变量按需填写。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORTAL_URL` | `http://localhost:4321` | 门户地址；开发时设成 `http://localhost:3005` |
| `PORTAL_API_TOKEN` | 空 | 和站点 `.env` 的 `PORTAL_API_TOKEN` 一致；站点没设就不需要 |

如果站点设置了 `PORTAL_API_TOKEN`，MCP 请求必须带 Bearer；浏览器里的工具 UI 通过 `Sec-Fetch-Site` 放行，不需要 token。

## 4. 工具列表

无论插件清单是否加载成功，都会注册：

| Tool | 作用 |
| --- | --- |
| `list_tools` | 列出门户里的插件、action、状态、配置项 |
| `search_site` | 搜索文档、笔记、工具、收藏；参数 `query`、`limit` |
| `get_page` | 按站内 URL 读取页面正文；参数 `url` |

插件里 `mcp: true` 的 server action 会以 `<pluginId>_<actionId>` 注册：

| Tool | 对应 API |
| --- | --- |
| `music_search` | `POST /api/tools/music/search`（歌曲海 → 歌曲客 → 网易云） |
| `devkit_hash` | `POST /api/tools/devkit/hash` |
| `media_probe` | `POST /api/tools/media/probe` |
| `media_resolve` | `POST /api/tools/media/resolve` |

`music_download` 没有标 `mcp: true`：它返回二进制流，不适合作为 MCP 的文本结果；需要下载时在网页里用。

新增插件后：

1. 重新 `pnpm build`（让 `/plugins.json` 更新）；
2. 重启 MCP 服务端（manifest 有 60 秒缓存）。

## 5. 调试

先确认门户本身可用：

```bash
curl http://localhost:3005/api/health
curl 'http://localhost:3005/api/search?q=%E9%9F%B3%E4%B9%90&limit=3'
```

再单独跑 MCP：

```bash
PORTAL_URL=http://localhost:3005 node packages/mcp-server/dist/index.js
```

stderr 会输出注册了哪些 tool；stdout 是 MCP 协议，不要往 stdout 打日志。

可以用 MCP Inspector：

```bash
npx @modelcontextprotocol/inspector node packages/mcp-server/dist/index.js
```

## 6. 安全

- MCP 服务端只应运行在你信任的机器上。
- `PORTAL_API_TOKEN` 是轻量门禁，不是强认证；如果门户暴露在公网，至少设置 token，并在反向代理层加限流/IP 限制。
- `search_site` / `get_page` 读取的是公开内容；`media_resolve` 会把链接发给配置的解析服务，注意隐私和条款。
- 不要把 `AI_API_KEY`、`MEDIA_RESOLVER_TOKEN` 放进 MCP 配置；它们只属于门户服务端。
