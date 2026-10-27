---
title: 把这个站重做了一遍
description: 从 Astro 4 + Starlight 模板改成 Astro 7 的门户，顺便把工具、笔记和收藏拆成独立的部分。
date: 2026-10-27
tags: [astro, 重构, 记录]
featured: true
---

这个站最早是一个 Starlight 文档模板，后来在首页加了一份硬编码的网址导航。能跑，但几件事混在一起：文档是 Starlight，导航是一个 React 组件，样式一部分走 Tailwind，一部分是手写 CSS；数据写在 `index.astro` 里，编辑只存在 `localStorage`；首页还把 Starlight 的页面组件塞进了自定义 `<html>`。

这次没有继续打补丁，直接换了一套基础结构。

## 现在的结构

- **文档**继续用 Starlight，但整体移到 `/docs/`，和门户分开。
- **笔记**是独立的 content collection，可以从本地目录同步过来，也可以手写。
- **工具**是插件。每个插件有自己的 manifest、服务端 action 和界面，注册表自动发现。
- **收藏**从代码里搬到了 `src/content/bookmarks.yaml`，按分类维护。
- **搜索**在构建时生成一份全站索引，页面上的搜索、AI 助手和 MCP 共用同一份数据。

## 刻意删掉的东西

React、Tailwind、shadcn、Radix、GSAP、Vue 都去掉了。不是它们不好，而是这个站目前的交互用原生 TS 和 Astro 的 scoped CSS 就够了。少一层依赖，样式和状态都更好追。

## 服务端只做必须做的事

页面默认预渲染成静态 HTML；只有 `/api/chat` 和 `/api/tools/*` 走服务端。这样大部分页面还是可以直接静态托管，插件和 AI 助手需要 Node 运行时。

AI 助手不配置 key 也能用，会退化成站内检索；配置了就走 OpenAI 兼容接口。这个降级是刻意留的，不想让一个 key 决定整个站能不能用。
