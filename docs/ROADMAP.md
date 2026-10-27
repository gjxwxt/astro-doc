# 路线图

记录已经完成的 v2 基础和接下来值得做的方向。优先级按“对日常使用的影响 / 维护成本”排，不按技术热度。

## 已完成（v2）

- Astro 7 + Starlight 0.42，文档迁到 `/docs/`
- 门户首页重做，独立笔记/工具/收藏
- 插件系统（manifest + server action + UI 自动发现）
- 音乐多源搜索/下载（歌曲海 → 歌曲客 → 网易云，MP3 + LRC）、DevKit、媒体链接预览
- 构建时全站搜索索引，⌘K + 左轨搜索
- AI 助手，无 key 自动降级为站内检索
- Obsidian 笔记同步（wikilink、图片、callout、冲突保护）
- 私人划线/批注/读后评分
- Giscus 公开评论的配置入口
- MCP stdio 服务端，动态注册插件 tool
- 单元测试、类型检查、CI、Docker

## 下一步

### 1. 账号与跨设备标注

现在划线只在本机。下一步：

- 一个极简账号（邮箱 magic link 或 GitHub OAuth）
- `annotations` 表：`user_id`, `page`, `quote`, `prefix`, `suffix`, `color`, `note`, `created_at`
- 读接口公开/私有可选；写接口必须登录
- 和 Giscus 评论分开：评论是公开讨论，标注是私人阅读痕迹

技术选择：Node 内置 `node:sqlite` 或 SQLite + Drizzle；先单机，不急着上 Postgres。

### 2. 插件权限

插件现在是“站主自己的代码”。如果以后接第三方插件，需要：

- manifest 声明能力：`network: ['itunes.apple.com']`、`env: [...]`、`fs: false`
- 服务端按能力注入受限的 `fetch`/env
- 每个插件独立的 rate limit 和超时
- 危险 action 需要显式确认
- 插件签名/版本锁定

### 3. 内容来源

- `scripts/import-rss.ts`：把 RSS 摘要变成 note
- GitHub Issue / Discussion 导入
- Notion 数据库导出
- 定时同步（GitHub Actions cron 或 VPS systemd timer）
- 为同步任务加“dry run + diff 预览”

### 4. 下载器

音乐第一版已经接进门户：`src/lib/music/` 里按 source adapter 隔离，顺序是歌曲海 → 歌曲客 → 网易云，返回 128kbps MP3 + LRC。接下来：

- **歌曲宝**：Cloudflare 是主要障碍。可选方案是独立的 Playwright/浏览器 worker，失败就跳过，不影响主链路
- **批量**：搜索结果勾选多首，队列 + 限速；先控制并发，不要一次几十首
- **无损**：夸克/其他源，需要 cookies 和更明确的版权边界
- **更多源**：QQ、酷狗、咪咕等，继续按 adapter 加；一个源坏了只坏一个模块
- **视频**：继续用独立 MeTube / yt-dlp 服务，门户只提交链接、显示任务状态
- 只绑定本机/内网，默认不做公开注册、配额和支付
- 明确“只处理用户有权保存的内容”；公开部署前加访问控制

### 5. 媒体解析（可选）

- 给视频链接提供独立的 `media-resolver` 示例（yt-dlp 包装），只在内网运行
- 与下载器分开：预览解析失败不应该影响下载任务
- 不把 scraper 塞进门户主进程

### 6. 搜索升级

- 现在是小索引暴力打分；内容多了以后可以换 Pagefind 或 SQLite FTS5
- 查询建议/历史
- 按类型、标签、时间过滤
- 为 AI 加 embedding 检索（可选，保留关键词兜底）

### 7. 阅读体验

- 笔记的“稍后读”队列
- 代码块复制按钮、目录滚动高亮
- 图片懒加载/压缩管线
- 移动端底部操作栏
- PWA / 离线阅读

### 8. 运维与质量

- Playwright 端到端：搜索、工具调用、标注、主题
- 视觉回归截图（首页/笔记/工具/收藏）
- 结构化日志、错误上报
- 反向代理层限流和缓存策略
- 备份脚本（Git + `.env` + sync state）

### 9. 多语言

- 目前是中文为主；文档/笔记可以加 `lang`
- 如果要英文版，先决定是路由前缀还是独立集合
- 不要为了 i18n 把内容模型复杂化；先有真实英文内容再动手

## 非目标

- 不做公开的任意版权内容下载站；自用下载器独立部署，并遵守来源站点的条款
- 不内置任意站点的抓取 scraper
- 不执行用户上传的任意插件代码
- 不把 AI key 或第三方 token 放到浏览器
- 不为“看起来像产品”而加假的统计、假的评论、假的在线人数
