# 笔记同步：Obsidian → `/notes`

## 0. 资料库：公开发布 Obsidian 笔记

`/library/` 和 `/notes/` 是两条独立的同步链路。资料库用于把 Obsidian 里**明确公开**的 Wiki / 文章同步成独立分区，不影响手写文档和随手笔记。

配置放在 **Obsidian 仓库根目录** 的 `site.config.yml`：

```yaml
version: 1

sections:
  knowledge:
    title: 知识库
    order: 10
  frontend:
    title: 前端
    order: 20

folders:
  "wiki/concepts":
    section: knowledge
    tag: concept
  "raw/articles/前端":
    section: frontend
    tag: 前端
```

- `sections` 控制分区标题和顺序；未注册的 section 会自动追加到末尾。
- `folders` 的 key 是相对 Obsidian 根目录的文件夹；子目录自动继承。
- 文件夹只负责 **section + 一个 tag**，不负责权限。
- 只有 frontmatter 里 `publish: true` 的文件才会同步；`status` 不是发布闸门。
- 图片第一版不复制：本地图片会变成 `[图片：名称]` 占位，远程图片保留。

命令：

```bash
pnpm sync:library --source ~/Documents/write-space
pnpm sync:library --source ~/Documents/write-space --dry
```

生成到 `src/content/library/`，这个目录不入库；构建前先同步。


目标：在 Obsidian 里写，跑一条命令，Markdown 出现在站点的 `/notes/`。不依赖 Obsidian 插件，不需要打开 Obsidian。

## 1. 配置

复制示例：

```bash
cp content-sync.config.example.json content-sync.config.json
```

```json
{
  "vault": "~/Documents/Obsidian",
  "folders": ["Notes"],
  "target": "src/content/notes",
  "assets": "public/notes-assets",
  "exclude": ["**/Templates/**", "**/*.excalidraw.md", "**/.obsidian/**", "**/.trash/**"],
  "defaultTags": []
}
```

| 字段 | 说明 |
| --- | --- |
| `vault` | Obsidian vault 根目录，支持 `~` |
| `folders` | 要同步的目录，相对 vault；可以多个 |
| `target` | 同步到仓库里的目录，默认 `src/content/notes` |
| `assets` | 图片输出目录，默认 `public/notes-assets` |
| `exclude` | 简单 glob；支持 `**` / `*` / `?` |
| `defaultTags` | 给所有同步笔记追加的标签 |

`content-sync.config.json` 和 `.content-sync-state.json` 都在 `.gitignore` 里，不会把本机路径提交上去。

## 2. 命令

```bash
pnpm sync:notes                # 同步一次
pnpm sync:notes --dry          # 只看会做什么，不写文件
pnpm sync:notes --force        # 覆盖有本地修改的目标文件
pnpm sync:notes --watch        # 监听并持续同步
pnpm sync:notes -v             # 输出每篇的警告（找不到图片、链接目标不在同步范围等）
```

同步后运行 `pnpm dev` 或 `pnpm build`，Astro 会重新生成内容类型。

## 3. frontmatter 映射

Obsidian 的 frontmatter 会被读取，站点需要的字段：

| 站点字段 | 来源 |
| --- | --- |
| `title` | `frontmatter.title` → 第一个 H1 → 文件名 |
| `description` | `frontmatter.description` → 正文第一段（跳过标题、引用、列表、图片） |
| `date` | `frontmatter.date` / `created` → 文件创建时间 |
| `updated` | `frontmatter.updated` → 文件修改时间；和 `date` 相同则省略 |
| `tags` | `frontmatter.tags`（字符串或数组）+ `defaultTags` |
| `draft` | `frontmatter.draft` 为 `true` / `"true"` / `1` |
| `featured` | 同上 |
| `source` | 相对 vault 的路径，用于排查 |
| `slug` | `frontmatter.slug` → 文件名；中文保留 |

输出示例：

```yaml
---
title: "把站点重做了一遍"
description: "从 Astro 4 + Starlight 模板改成 Astro 7 的门户。"
date: 2026-10-27
updated: 2026-10-28
tags: ["astro","重构"]
source: "Notes/把站点重做了一遍.md"
---
```

## 4. 会转换什么

### Wikilink

```markdown
[[第二篇]]
[[第二篇|别名]]
[[第二篇#小标题]]
```

→

```markdown
[第二篇](/notes/第二篇/)
[别名](/notes/第二篇/)
[第二篇](/notes/第二篇/#小标题)
```

只有在本次同步范围内的目标才能解析；不在范围时保留别名文本，并在 `-v` 下警告。

### 图片

```markdown
![[pic.png]]
![[pic.png|300]]
![本地图](attachments/pic.png)
```

会按以下顺序找文件：

1. 相对当前笔记的路径；
2. vault 里同名附件（按 basename 建索引）。

找到后复制到 `public/notes-assets/<slug>/<文件名>`，并改写成站点路径。找不到就保留原文并警告。

> 同名附件有歧义时会取索引里的第一个。建议 Obsidian 设置“附件放到固定目录”，并保持文件名唯一。

### Callout / 注释

```markdown
> [!note] 小提示
> 正文
```

→

```markdown
> **小提示**
> 正文
```

`%%这种 Obsidian 注释%%` 会被删除。

### 标题

如果正文第一行是 `# 和 frontmatter.title 相同`，会删掉，避免页面出现两个标题。

## 5. 冲突和状态

`.content-sync-state.json` 记录每个目标文件的来源、内容 hash 和同步时间。

- 目标文件不存在 → 写入。
- 目标文件存在，内容 hash 和这次生成的一致 → 跳过。
- 目标文件存在，但 hash 和上次同步记录不一致 → 认为你在站点里手改过，**跳过**并提示；确认要覆盖时加 `--force`。
- 目标文件存在但不在状态里 → 也视为手动文件，默认跳过，避免覆盖同名手写笔记。

同步脚本**不会删除**目标目录里多余的笔记。要删除，手动删 `src/content/notes/` 里的文件。

## 6. 手写笔记

不经过 Obsidian 的笔记直接放 `src/content/notes/*.md` 即可，最小 frontmatter：

```yaml
---
title: 标题
date: 2026-10-27
---
```

或者：

```bash
pnpm new:note "今天的想法"
```

会生成 `src/content/notes/今天的想法.md`。

## 7. 同步其他来源

脚本只认 Markdown。博客导出、Notion 导出、其他编辑器写的 `.md` 都可以：

1. 放进 vault 的某个目录，或者把 `vault` 指向那个目录；
2. 在 `folders` 里加上；
3. 确保 frontmatter 至少有 `title`，没有就用文件名。

如果以后要接 RSS、GitHub Issue 或 Notion API，建议新增一个 `scripts/import-*.ts`，把内容规范成同样的 frontmatter，再复用这里的清洗逻辑（`scripts/lib/sync.ts`）。

## 8. 限制

- `.excalidraw.md` 会被跳过。
- Obsidian 的块引用 `^block-id`、Dataview 查询、Canvas 不会转换。
- 标题锚点用简单的空格→连字符近似，复杂标题可能和 Astro 生成的 slug 不完全一致。
- 不处理 Obsidian 的 `aliases`、`cssclasses` 等展示字段。
- 图片只复制，不做压缩；需要的话在 `public/notes-assets/` 上跑单独的优化流程。
