# 部署

站点需要一个 Node 运行时，因为 `/api/*` 和 AI 助手不是静态文件。页面本身仍然预渲染，可以直接被 CDN/反向代理缓存。

## 1. 服务器准备

- Node **>= 22.23.4**，推荐 24（`.nvmrc`）
- pnpm 11
- 一个可写的目录（Astro Node adapter 会启用 sessions 文件存储）

```bash
git clone <repo> /srv/portal
cd /srv/portal
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# 编辑 .env：SITE_URL、AI key、token、媒体解析
pnpm build
```

构建产物：

```text
dist/client/   静态资源
dist/server/   Node 入口和 API
```

## 2. 运行

```bash
HOST=0.0.0.0 PORT=4321 node dist/server/entry.mjs
```

或：

```bash
PORT=4321 pnpm start
```

`SITE_URL` 是**构建时**变量，影响 canonical、sitemap、RSS、MCP 里展示的地址，改了要重新 build。`AI_*`、`PORTAL_API_TOKEN`、`MEDIA_*` 是运行时变量，改完重启进程即可。

## 3. systemd

`/etc/systemd/system/portal.service`：

```ini
[Unit]
Description=Josh portal
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/srv/portal
EnvironmentFile=/srv/portal/.env
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=4321
ExecStart=/usr/bin/node /srv/portal/dist/server/entry.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now portal
sudo systemctl status portal
```

确保 `www-data` 对 `/srv/portal` 有读权限，并且能写 sessions 目录（adapter 默认会在项目目录下创建存储）。如果启动时报权限错误，把运行用户改成目录所有者，或显式配置 sessions 目录。

## 4. Nginx

下面用 `example.com` 占位，换成你的实际域名；证书路径也要一起换。

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # AI 助手是 SSE，关闭缓冲
    location /api/chat {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 120s;
    }

    # 静态资源可以单独缓存
    location /_astro/ {
        proxy_pass http://127.0.0.1:4321;
        proxy_cache_valid 200 7d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

站点没有使用 `Astro.session`，但 adapter 默认启用了 sessions 存储；如果不需要，可以在 `astro.config.mjs` 的 node adapter 选项里关掉（以当前 adapter 文档为准）。

## 5. Docker

仓库自带 `Dockerfile`：

```bash
docker build -t josh-portal .
docker run -d --name portal \
  --env-file .env \
  -e HOST=0.0.0.0 -e PORT=4321 \
  -p 4321:4321 \
  -v portal-data:/app/.astro \
  josh-portal
```

镜像里只保留 `dist`、生产依赖和 `package.json`。`.env` 不要打进镜像。

## 6. 反向代理之外

- **DNS / HTTPS**：`SITE_URL` 必须和实际域名一致，否则 canonical 和 sitemap 会指错。
- **缓存**：`/search-index.json`、`/plugins.json` 设置了 5 分钟缓存；内容更新后重新 build 并让 CDN 失效。
- **限流**：应用内有内存限流（搜索 60/分、聊天 12/分、工具 60/分/IP）。多实例部署时每个实例独立，必要时在 Nginx 层也加。
- **备份**：内容在 Git；`.env`、`content-sync.config.json`、`.content-sync-state.json` 单独备份。没有数据库。
- **健康检查**：`GET /api/health` 返回 `{ ok, ai, mediaResolver, time }`。
- **日志**：Node adapter 输出到 stdout/stderr，交给 systemd/journald 或容器日志。

## 7. 只做静态托管

如果部署到纯静态平台（GitHub Pages、Cloudflare Pages 静态模式等）：

- 页面、文档、笔记、RSS、搜索索引、`plugins.json` 都能正常生成。
- `/api/search`、`/api/chat`、`/api/tools/*` 不存在，页面内的搜索和工具调用会失败。
- 可以把 AI 助手和工具页隐藏，或者改造成纯客户端实现；当前代码没有做这个分支。

## 8. MCP

MCP 服务端和站点分开部署/运行：

```bash
pnpm mcp:build
PORTAL_URL=https://example.com PORTAL_API_TOKEN=... node packages/mcp-server/dist/index.js
```

它只需要能访问门户的 HTTP API。MCP 不占端口，通常由客户端以 stdio 方式拉起。

## 9. 发布检查

```bash
pnpm check        # astro check + MCP 类型 + 单元测试
pnpm build
pnpm mcp:build
curl -s https://你的域名/api/health
curl -s 'https://你的域名/api/search?q=astro&limit=1'
```

再手动看一遍：

- `/`、`/notes/`、`/tools/music/`、`/bookmarks/`、`/docs/`
- ⌘K 搜索
- 音乐多源搜索与下载（MP3/zip）
- 没有配置 AI key 时助手显示“检索模式”
- 旧 URL 301
