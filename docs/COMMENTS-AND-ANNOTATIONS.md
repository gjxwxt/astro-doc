# 评论与划线

两件事，两套存储。

## 公开评论：Giscus

评论落在 GitHub Discussions，不经过本站服务端，也不需要在数据库里存用户数据。

配置步骤：

1. 建一个公开仓库（或直接用现有的 `astro-doc`）。
2. 在仓库 Settings → General → Features 里打开 **Discussions**。
3. 安装 [giscus app](https://github.com/apps/giscus)，授权这个仓库。
4. 打开 [giscus.app/zh-CN](https://giscus.app/zh-CN)，填入仓库，选择 Discussion 分类（例如 `Announcements`），拿到 `repoId` 和 `categoryId`。
5. 填到 `src/config/site.ts`：

```ts
giscus: {
  repo: 'gjxwxt/astro-doc',
  repoId: 'R_xxx',
  category: 'Announcements',
  categoryId: 'DIC_xxx',
  mapping: 'pathname',
  strict: false,
  reactionsEnabled: true,
  inputPosition: 'top',
  lang: 'zh-CN',
},
```

6. 重新 build。

没填 `repoId` / `categoryId` 时，生产环境不渲染评论区；开发环境会显示一段配置提示。评论主题跟随系统（`preferred_color_scheme`）。

## 私人划线：只在本机

笔记正文（`[data-annotatable]`）支持：

- 选中文字 → 浮动工具栏 → 黄/绿/粉高亮
- “写批注” → 输入备注
- 右侧栏列出本页所有标记，点击跳回原文，可删除
- 读后评分 1–5 星
- 导出 JSON、清空本页

存储：

| Key | 内容 |
| --- | --- |
| `portal-annotations:v1:<pathname>` | `{ id, quote, prefix, suffix, color, note, createdAt }[]` |
| `portal-rating:v1:<pathname>` | `0`–`5` |

定位方式参考 TextQuoteSelector：保存原文、前 40 字、后 40 字。文章改动后会在全文里找最匹配的位置；找不到就不渲染高亮，但数据还在。

高亮用 CSS Custom Highlight API（`CSS.highlights` + `::highlight()`），不改 DOM，所以复制、代码块和链接都正常。浏览器不支持时只保存数据，不显示高亮。

### 局限

- 只在当前浏览器，不跨设备、不跨浏览器。
- 无痕窗口关闭后数据消失。
- 同一段文字多次标注会重叠，当前不做合并。
- 不处理跨页、跨文章引用。
- 没有公开分享标注的入口。

### 以后要跨设备

需要：账号、`annotations` 表、读写 API、冲突策略（按 `updated_at` 或最后写入）。公开评论和私人标注继续分开：评论是讨论，标注是阅读痕迹。

## 数据导出

“导出”按钮下载当前页的 `annotations-<page>.json`，格式：

```json
{
  "page": "/notes/rebuild-the-portal/",
  "annotations": [
    {
      "id": "1761520000000-ab12c",
      "quote": "文档、导航和样式混在一起",
      "prefix": "后来加了一个硬编码的网址导航。",
      "suffix": "，改起来越来越费劲",
      "color": "green",
      "note": "这就是重构的起点",
      "createdAt": "2026-10-27T03:00:00.000Z"
    }
  ]
}
```

目前没有导入按钮；需要迁移时可以直接写回 `localStorage` 对应的 key。
