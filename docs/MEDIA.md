# 本地媒体库

当前先使用云服务器本地盘，后续可以换 S3/R2，不改变 Obsidian 里的 URL 形态。

## 存储

```text
PORTAL_DATA_DIR/media/<sha256>.<ext>
```

- 内容寻址：相同文件只存一份
- 只接受 PNG / JPEG / WebP / GIF / AVIF
- 单张上限 20MB
- 不收 SVG（公开路由直接打开 SVG 有脚本执行风险）
- 文件权限 `0600`，目录权限 `0700`

## 配置

```env
MEDIA_DRIVER=local
PORTAL_DATA_DIR=./data
MEDIA_PUBLIC_BASE_URL=https://portal.example.com
```

`MEDIA_PUBLIC_BASE_URL` 是给 Obsidian/浏览器用的绝对基础地址。留空时 API 返回 `/media/<hash>.<ext>`，适合同源页面；Obsidian 必须配置绝对地址。

## API

```http
POST /api/media/upload
Authorization: Bearer <PRIVATE_API_TOKEN>
Content-Type: multipart/form-data

file=<binary>
```

成功：

```json
{
  "ok": true,
  "data": {
    "id": "...",
    "url": "https://portal.example.com/media/<hash>.png",
    "hash": "...",
    "mime": "image/png",
    "bytes": 12345,
    "deduped": false
  }
}
```

相同内容再次上传返回 `deduped: true` 和已有 URL。

公开读取：

```text
GET /media/<hash>.<ext>
Cache-Control: public, max-age=31536000, immutable
```

## 后续迁移

`media` 表保留 `storage_driver`、`storage_key`、`public_url`。换对象存储时：

1. 上传原文件到对象存储
2. 更新记录的 driver/key/url
3. 按 `original_url -> new_url` 重写 Obsidian/站点引用

如果继续由门户代理 `/media/...`，Obsidian 链接可以完全不动。

## 备份

`data/media/` 必须和 `data/portal.sqlite` 一起备份；不要只备份数据库。

## Obsidian 存量图片迁移

先只读盘点：

```bash
pnpm media:migrate --vault ~/Documents/Obsidian
```

确认数量后上传并改写：

```bash
PRIVATE_API_TOKEN=... pnpm media:migrate \
  --vault ~/Documents/Obsidian \
  --base-url http://<server-ip>:4400 \
  --write
```

行为：

- 只处理 `![[image.png]]`、`![[image.png|300]]`、`![](local/path.png)` 这类本地图片引用
- 远程图片、找不到的路径保持原样
- 改写前把原 `.md` 备份到 `<vault>/.josh-media-backup/<时间>/`
- `![[image.png|300]]` 改写为 `<img ... width="300">`，避免丢宽度
- SVG 不支持上传，保持原样
- 相同文件只上传一次，服务端按 SHA-256 去重

## Obsidian 新图片粘贴

见 [`obsidian-plugin/README.md`](../obsidian-plugin/README.md)。插件只负责新粘贴；存量用上面的 CLI。

## 后续对象存储

本地盘先跑通。以后切换 S3/R2 时，`media` 表的 `storage_driver` / `storage_key` / `public_url` 用于迁移；如果继续由门户提供 `/media/...`，Obsidian 链接可以不变。
