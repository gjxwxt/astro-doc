# Josh Capture for Raycast

全局快捷键直接保存选中文字，不打开 Raycast 主窗口，只短暂显示 HUD。

## 安装

```bash
cd raycast-extension/josh-capture
npm install
npm run dev
```

Raycast 会打开开发中的扩展。命令名：**秒存到 Josh**。

## 配置

Raycast → 扩展 → Josh Capture → 秒存到 Josh：

- **门户地址**：`http://127.0.0.1:4400` 或服务器地址
- **私有 API Token**：服务端 `.env` 的 `PRIVATE_API_TOKEN`
- **可选标签**：一个标签，留空就不分类

## 全局快捷键

Raycast 搜索「秒存到 Josh」→ `⌘K` → **Configure Command** → **Record Hotkey**。

之后在任意应用选中文字，按快捷键即可：

- 文字 → quote
- URL → 链接卡片
- 图片 URL → 图片碎片
- 默认不打开编辑窗口，只显示一条 HUD

## 权限

Raycast 首次读取选中文字时，macOS 会要求给 Raycast 辅助功能权限（Accessibility / Device Control & Data Access）。

## 与 uTools 的关系

uTools 插件仍保留「收藏到 Josh」用于补标签/备注；Raycast 负责真正静默的全局快捷键。

## 构建

```bash
npm run build
```
