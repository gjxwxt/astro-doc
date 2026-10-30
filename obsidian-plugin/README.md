# Josh Media（Obsidian 插件）

把 Obsidian 里**新粘贴**的图片、图片 URL、本地图片路径上传到 Josh 私有媒体库，并插入 Markdown 链接。

存量图片不走这个插件，用根目录的迁移 CLI：

```bash
pnpm media:migrate --vault ~/Documents/Obsidian
```

## 安装

1. 把 `obsidian-plugin/josh-media` 整个目录复制到：

```text
<vault>/.obsidian/plugins/josh-media/
```

2. Obsidian → 设置 → 第三方插件 → 关闭安全模式 → 启用 **Josh Media**。

不需要构建，`main.js` 就是源码。

## 设置

- **门户地址**：`http://127.0.0.1:4400` 或你的服务器地址
- **图片公开地址**：写进 Markdown 的绝对前缀；留空则用门户地址
- **私有 API Token**：服务端 `.env` 的 `PRIVATE_API_TOKEN`
- **粘贴图片自动上传**：剪贴板里的图片文件
- **粘贴图片地址/路径自动上传**：单行、以图片扩展名结尾的 http(s) 地址或本地路径

手机端需要图片公开地址是手机能访问的地址；当前插件标记为桌面端。

## 行为

- 剪贴板图片 → `POST /api/media/upload` → `![alt](url)`
- `https://.../x.png` → 下载 → 上传 → `![x](url)`
- `/Users/.../x.png` 或 vault 内相对路径 → 读取 → 上传 → `![x](url)`
- 上传失败会保留原文本并弹 Notice
- 单张上限 20MB；支持 PNG/JPEG/WebP/GIF/AVIF；不支持 SVG
- 同一内容服务端会去重

## 和 Web Clipper 的关系

Obsidian Web Clipper 是 MIT 开源的网页剪藏扩展，适合网页正文/高亮；本插件只处理图片上传，不替代它。

## 已知限制

- 只处理“图片文件/图片地址/图片路径”，不处理 Markdown 图片语法
- 远程图片没有扩展名（如 `?id=123`）时不会自动识别
- 本地路径要求桌面版；移动端请直接粘贴图片
- 迁移 CLI 需要能访问门户 API；建议先 dry-run
