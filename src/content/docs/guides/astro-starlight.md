---
title: astro建站
description: A page to show how to create a site quickly with astro
---
[语法](#语法相关)

首先创建项目：

```shell
npm create astro@latest -- --template starlight
```

启动：

```shell
npm run dev
```

对应的文件结构

+ 如果是做文档用，直接修改src/content/docs/以及astro.config.mjs即可
  + 此时docs目录下的index.mdx就是路由根路径页面/
  + 在docs下的文件都需要添加frontmatter，例如title和description
+ 如果需要定制化页面比较多，可以创建`src/layouts/`以及`src/pages/`
  + 此时，在pages下的index.xxx就是路由根路径页面/，404.xxx就是404页面，格式支持md，mdx，astro，js/ts，html
    + 写文档推荐用mdx，原因是它可以和react、vue组件集成更方便。
    + 写页面推荐用.js/.ts，原因是它react写的比较多。

想同时展示代码和效果如何做？单独写一个组件

如何使用react或者vue开发页面，支持props但是不支持事件，如何才能支持事件呢，只能自己写script

修改原来自带的header、footer和sider，修改layout.jsx

如何写css样式，全局生效

```js
import { defineLayout } from 'astro/layout';
import { StarlightLayout } from '@starlightpro/astro';
import { StarlightSidebar } from '@starlightpro/astro';
import { StarlightSearch } from '@starlightpro/astro';
import { StarlightFooter } from '@starlightpro/astro';
import { StarlightHeader } from '@starlightpro/astro';
import { StarlightLogo } from '@starlightpro/astro';

export default defineLayout(({ content }) => {
  return {
    Layout: StarlightLayout,
    Sidebar: StarlightSidebar,
    Search: StarlightSearch,
    Footer: StarlightFooter,
    Header: StarlightHeader,
    Logo: StarlightLogo,
  }
})
```

## Further reading

+ Read [about reference](https://docs.astro.build/en/getting-started/)

## 语法相关

:::tip[你知道吗？]
Astro 帮助你使用 [“群岛架构”](https://docs.astro.build/zh-cn/concepts/islands/) 构建更快的网站。
:::

```md
:::tip[你知道吗？]
Astro 帮助你使用 [“群岛架构”](https://docs.astro.build/zh-cn/concepts/islands/) 构建更快的网站。
:::
```

:::caution
如果你不确定是否想要一个很棒的文档网站，请在使用 [Starlight](/zh-cn/) 之前三思。
:::

```md
:::caution
如果你不确定是否想要一个很棒的文档网站，请在使用 [Starlight](/zh-cn/) 之前三思。
:::

```

:::danger
借助有用的 Starlight 功能，你的用户可能会提高工作效率，并发现你的产品更易于使用。
:::

```md
:::danger
借助有用的 Starlight 功能，你的用户可能会提高工作效率，并发现你的产品更易于使用。
:::
```

:::note
Starlight 是一个使用 [Astro](https://astro.build/) 构建的文档网站工具包。 你可以使用此命令开始：
:::

```md
:::note
Starlight 是一个使用 [Astro](https://astro.build/) 构建的文档网站工具包。 你可以使用此命令开始：
:::
```

+ 清晰的导航
+ 用户可配置的颜色主题
+ [i18n 支持](/zh-cn/guides/i18n/)

> 这是块引用，通常在引用其他人或文档时使用。
>
> 块引用以每行开头的 `>` 表示。

```md
> 这是块引用，通常在引用其他人或文档时使用。
>
> 块引用以每行开头的 `>` 表示。
```

```diff lang="js"
  function thisIsJavaScript() {
    // 这整个代码块都会被作为 JavaScript 高亮
    // 而且我们还可以给它添加 diff 标记！
-   console.log('旧的不去')
+   console.log('新的不来')
  }
```

```md
  ```diff lang="js"
    function thisIsJavaScript() {
      // 这整个代码块都会被作为 JavaScript 高亮
      // 而且我们还可以给它添加 diff 标记！
  -   console.log('旧的不去')
  +   console.log('新的不来')
    }```
```

```js "return true;" ins="插入" del="删除"
function demo() {
  console.log('这是插入以及删除类型的标记');
  // 返回语句使用默认标记类型
  return true;
}
```

```md
```js "return true;" ins="插入" del="删除"
function demo() {
  console.log('这是插入以及删除类型的标记');
  // 返回语句使用默认标记类型
  return true;
}
```

## 支付相关

stripe 可以个人收款，身份信息填护照，有港卡就能开通
paddle支持支付宝

## Supabase

+ NextUI这边后端用的Supabase

我的观点，
Supabase前期用很好的。等量起来的时候，自建server端，也来得及。

## other

+ Domain：CloudFlare： 这个最便宜，直接买了10年。而且本来就是做cdn出生，流量安全之类的生态体系有保障。
+ md编辑器： Craft， 免费，本地，体验非常好，我感觉不输语雀，飞书之类的。
+ newsletter： ConvertKit 暂时选这个，就他对新用户免费试用的流程最舒服。其他几个例如buttondown之类的免费版本连个api key都不给。
+ 评论系统：GISCUS 开源免费。
+ 网站流量分析： umami 开源免费，简单，支持自定义埋点。

+ 国外 next+nest 太多了
+ 国内创业电商这边是NextJs+NestJs
+ NextUI这边后端用的Supabase

<https://github.com/Innei/rc-modal> 这是超简单的react组件，可以学学
rc-modal.pages.dev
<https://craft.do/写的文档>
