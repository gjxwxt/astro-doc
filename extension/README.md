# Josh Inbox 扩展

Chrome / Edge Manifest V3 的最小采集插件。选中文字时保存引用，没选中文字时保存当前页链接。

## 本地安装

1. 打开 `chrome://extensions`，开启“开发者模式”。
2. 点“加载已解压的扩展程序”，选择本目录 `extension/`。
3. 点扩展图标 → 右上角齿轮：
   - API 地址：`http://localhost:4400`
   - Token：本地 `.env.local` 里的 `PRIVATE_API_TOKEN`
4. 打开任意网页，选中一段话，再点扩展图标；或者不选中直接点，保存当前页链接。
5. 选中文字后也可以直接右键：**存到 Josh Inbox → #标签 / 不分类**。标签菜单从 Inbox 的标签读取；第一次配置 Token 后会自动刷新。
6. 右键链接：**保存链接到 Josh Inbox**，直接生成链接卡片，不再需要打开 Inbox。
7. 右键图片：**保存图片到 Josh Inbox**，保存远程图片 URL 和来源，不下载图片文件。
8. 右键页面或选中文字：**批量标注此页（多段一组）**，右下角出现批量面板；之后每次选中文字，选区上方出现“+ 加入组”，可连续加入多段，最后选标签并“保存为组”。
9. 右键页面：**页面大爆炸（预览后保存）**，用 Defuddle 抽取正文，点选段落，保存为同页组或下载 Markdown。

## 行为

- 选中文字：`POST /api/fragments`，保存原文、前后各 500 字上下文、标题、URL、站点、随想和标签。
- 选中文字右键：直接按标签保存，不打开弹窗；保存结果用页面顶部小气泡提示，标签来自 Inbox 已有标签。
- 右键链接：`POST /api/fragments/link`，服务端生成链接卡片；保存结果用页面顶部的小气泡提示，失败时退回扩展 badge。
- 右键图片：`POST /api/fragments`，`kind: 'image'`，只保存远程 `src`、来源页和 alt；图片不下载、不转存。
- 批量标注：扩展在页面注入一个 Shadow DOM 面板，只收集 `quote` / 上下文 / 标题 / URL / 站点；保存时后台按同一 `groupId` 逐条 `POST /api/fragments`，Inbox 会把它们收成一张“同页”组卡片。单次最多 50 段，每段正文上限 20,000 字符。
- 没选中文字：`POST /api/fragments/link`，服务端抓取标题 / 描述 / 封面，生成链接卡片。
- X：使用官方 oEmbed；抖音：页面有反爬时保存为“抖音链接”卡片，配置 `MEDIA_RESOLVER_URL` 后可以补上标题和封面。
- 页面大爆炸：右键页面 → 注入 `explosion.bundle.js`，用 Defuddle 抽正文、DOMPurify 清洗，段落点选后按同一 `groupId` 逐条保存；单次最多 100 段，可下载 Markdown。
- 重复保存返回 409，扩展会提示“已经在 Inbox 里了”。

## 部署后

扩展的 `host_permissions` 目前只包含本地 `localhost:4400`。部署到正式域名后，把域名加进 `manifest.json` 的 `host_permissions`，重新加载扩展，并在设置里改 API 地址。

## 构建页面大爆炸

`explosion.bundle.js` 已经提交，正常加载不需要构建。改了 `extension/src/explosion.js` 后：

```bash
pnpm extension:build
```

依赖 `defuddle`、`dompurify` 和 `esbuild`；第三方许可见 [`THIRD_PARTY.md`](./THIRD_PARTY.md)。

Token 只保存在 `chrome.storage.local`，不注入页面；批量面板不接触 Token，保存请求由扩展的 service worker 发出。
