---
title: 这是一篇react自学路径指南
description: A guide in react roadmap for self-study.
---


## 原则

> 原则1：一次只学一样不会的，不要多个不会的混在一起。

- 先学js，后学ts
- 先学会react，再考虑其他库，什么状态库、UI组件库，都不要急于使用
- 先学csr，后学ssr

> 原则2：先学基础，然后学大而全的空间

先学cra，然后next.js，会更好。直接next.js弯路会走的更多，容易有挫败感。

> 原则3：先别碰构建工具，无论Webpack还是Vite

按照长尾理论，我们经常会被周边的东西所吸引，继而脱离既定目标。

## 学习方式1：传统方式

入门就玩原始的（js）。对于html、js、css有经验最好，没有的话也问题不大。

- 从[cra](https://create-react-app.dev/)开始，学习官方的脚手架
- 熟悉React页面写法
- 学习React组件写法
  - 学习css，用tailwind，不要搞什么sass、less、postcss。麻烦的响应式，兼容大小屏幕。
- 学习React hooks（从useState、useEffect开始，后面的多多益善，比如useMemo等）
- 学习ahooks，能少写很多代码，里面也有很多最佳实践，比如限流，防抖，请求相关的都非常棒
- 还有表单管理，react hook form
- 还可以学习一点像dayjs、zod这样的小的常用模块

至此你基本上React没有什么难点了。当然你也可以换一下 umijs 玩玩。

进阶，学习原理，比较好的，专业的做法。

- 从createElement开始，学习一些基础api，顺便学一下dom diff原理
- 学习Fragment、Suspense用法
- 学习Concurrent Mode、Scheduler原理等
- 学习ui库，比如antd、shadcn/ui、nextui等
- 学习状态库，比如zustand、jotai、Valtio等，我不是很喜欢redux这种
- 学习react-admin、TanStack等开箱即用的
- 微前端，兼容老技术栈
- 学习ssr服务器端渲染，理解hydrate，最新的rsc也可以了解一点
- 学习Typescript向专业前端看齐


高阶：大而全的框架

- Next.js
- Remix

然后，去gihhub上找练手项目，积累自己的技术栈，比如我的一个朋友的选型

- UI 组件库：https://daisyui.com/
- Dashboard UI ：The React library to build dashboards fast
- 状态管理库：https://zustand-demo.pmnd.rs/
- 异步管理：TanStack Query, Solid Query, Svelte Query, Vue Query
- 数据模型：TypeScript-first schema validation with static type inference

## 学习方式2：在实践中学习

最佳的学习方法，可能还是直接learn by doing，如果能直接业务中落地去做 效率翻倍。

如果没法直接在业务中落地，可以按照以下方法。

1. 参考本repo，学习建站，博客，文档。
1. 学习 React + Tailwind 组件开发，满足自己的诉求。然后和上面差不多，react hooks、ahook基本上就够用了。
1. 然后参照方式1后面的进阶和高阶，就可以都差不多了。

## 书籍推荐

- 入门《React状态管理与同构实战》，作者侯策，颜海镜，每个点讲都不深，但比较容易理解。
- 原理《React 设计原理》，作者卡颂。相对较新，适合原理
