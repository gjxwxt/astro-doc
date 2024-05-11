---
title: qiankun 微服务实战
description: A page to show how to use qiankun
tableOfContents:
  minHeadingLevel: 1
  maxHeadingLevel: 5
---

### 一、什么是微前端，产生背景

将一个大型的前端应用拆分成多个模块，每个微前端模块可以由不同的团队进行管理，并可以自主选择框架，并且有自己的仓库，可以独立部署上线。
一般微前端多应用于企业中的中后台项目中，因为企业内部的中后台项目存活时间都比较长，动辄三五年或者更多，最后演变成一个巨石应用的概率往往高于其他类型的 web 应用。这就带来了**技术栈落后**、**编译部署慢**两个问题。

### 二、微前端的好处

##### 团队自治

在公司里面，一般团队都是按照业务去划分的，在没有微前端的时候，如果几个团队维护一个项目肯定会遇到一些冲突，比如合并代码的冲突，上线时间的冲突等。应用了微前端之后，就可以将项目根据业务模块拆分成几个小的模块，每个模块都由不同的团队去维护，单独开发，单独部署上线，这样团队直接就能实现自治，减少甚至不会出现和其他团队冲突的情况。

##### 兼容老项目

如果公司中有故事中存在的古老的 jquery 或者其他巨石项目的话，但是又不想用旧的技术栈去维护，选择使用微前端的方式去拆分项目是一个很好的选择。

##### 跨技术栈

如果微前端系统中需要新增一个业务模块时，只需要单独的新建一个项目，至于项目采用什么技术栈，完全可以由团队自己去定义，即使和其他模块用的不同的技术栈也不会有任何的问题

### 三、现有的微前端方案

##### iframe

通过 iframe 实现的话就是每个子应用通过 iframe 标签来嵌入到父应用中，iframe 具有天然的隔离属性，各个子应用之间以及子应用和父应用之间都可以做到互不影响。
但是 iframe 也有很多缺点：

1.  url 不同步，如果刷新页面，iframe 中的页面的路由会丢失。
2.  全局上下文完全隔离，内存变量不共享。
3.  UI 不同步，比如 iframe 中的页面如果有带遮罩层的弹窗组件，则遮罩就不能覆盖整个浏览器，只能在 iframe 中生效。
4.  慢。每次子应用进入都是一次浏览器上下文重建、资源重新加载的过程。

##### single-spa

官网：[https://zh-hans.single-spa.js.org/docs/getting-started-overview](https://zh-hans.single-spa.js.org/docs/getting-started-overview)
single-spa 是最早的微前端框架，可以兼容很多技术栈。
single-spa 首先在基座中注册所有子应用的路由，当 URL 改变时就会去进行匹配，匹配到哪个子应用就会去加载对应的那个子应用。
相对于 iframe 的实现方案，single-spa 中基座和各个子应用之间共享着一个全局上下文，并且不存在 URL 不同步和 UI 不同步的情况，但是 single-spa 也有以下的缺点：

1. 没有实现 js 隔离和 css 隔离
2. 需要修改大量的配置，包括基座和子应用的，不能开箱即用

##### qiankun

qiankun 是阿里开源的一个微前端的框架，在阿里内部已经经过一批线上应用的充分检验及打磨了，所以可以放心使用。qiankun 有什么优势呢？

- 基于 single-spa 封装的，提供了更加开箱即用的 API
- 技术栈无关，任意技术栈的应用均可使用/接入，不论是 React/Vue/Angular/JQuery 还是其他等框架。
- HTML Entry 的方式接入，像使用 iframe 一样简单
- 实现了 single-spa 不具备的样式隔离和 js 隔离
- 资源预加载，在浏览器空闲时间预加载未打开的微应用资源，加速微应用打开速度。

### 四、基于 qiankun 的微前端实战

项目目录如下：

```less
├── micro-base      // 基座 react项目
├── sub-react       // react子应用，create-react-app创建的react应用，使用webpack打包
├── react-template  // vite创建的react 子应用
├── sub-vue         // vite创建的vue 子应用
└── sub-umi         // umi脚手架创建的子应用
```

- 基座（主应用）：主要负责集成所有的子应用，提供一个入口能够访问你所需要的子应用的展示，尽量不写复杂的业务逻辑
- 子应用：根据不同业务划分的模块，每个子应用都打包成`umd`模块的形式供基座（主应用）来加载

#### 基座

基座用的是`create-react-app`脚手架加上`antd`组件库搭建的项目，也可以选择 vue 或者其他框架，一般来说，基座只提供加载子应用的容器，尽量不写复杂的业务逻辑。

1. 安装 qiankun

```bash
// 安装qiankun
npm i qiankun // 或者 yarn add qiankun
```

2. 修改入口文件

```javascript
// 在src/index.tsx中增加如下代码
import { start, registerMicroApps } from "qiankun";

// 1. 要加载的子应用列表
const apps = [
  {
    name: "sub-react", // 子应用的名称
    entry: "//localhost:8080", // 默认会加载这个路径下的html，解析里面的js
    activeRule: "/sub-react", // 匹配的路由
    container: "#sub-app", // 加载的容器
  },
];

// 2. 注册子应用
registerMicroApps(apps, {
  beforeLoad: [async (app) => console.log("before load", app.name)],
  beforeMount: [async (app) => console.log("before mount", app.name)],
  afterMount: [async (app) => console.log("after mount", app.name)],
});

start(); // 3. 启动微服务
```

当微应用信息注册完之后，一旦浏览器的 url 发生变化，便会自动触发 qiankun 的匹配逻辑。 所有 activeRule 规则匹配上的微应用就会被插入到指定的 container 中，同时依次调用微应用暴露出的生命周期钩子。

- registerMicroApps(apps, lifeCycles?)
  注册所有子应用，qiankun 会根据 activeRule 去匹配对应的子应用并加载
- start(options?)
  启动 qiankun，可以进行预加载和沙箱设置

至此基座就改造完成，如果是老项目或者其他框架的项目想改成微前端的方式也是类似。

#### react 子应用（webpack）

使用`create-react-app`脚手架创建，`webpack`进行配置，为了不 eject 所有的 webpack 配置，我们选择用`react-app-rewired`工具来改造 webpack 配置。

1. 改造子应用的入口文件

```javascript
import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import "./public-path.js";

let root: any;
function render(props: any) {
  const { container } = props;
  const dom = container
    ? container.querySelector("#root")
    : document.getElementById("root");
  root = createRoot(dom);
  root.render(
    <BrowserRouter basename="/sub-react">
      <App />
    </BrowserRouter>
  );
}

// 判断是否在qiankun环境下，非qiankun环境下独立运行
if (!(window as any).__POWERED_BY_QIANKUN__) {
  render({});
}

// 各个生命周期
// bootstrap 只会在微应用初始化的时候调用一次，切换应用再切换回该微应用时会直接调用 mount 钩子，不会再重复触发 bootstrap。
export async function bootstrap() {
  console.log("react app bootstraped");
}

// 应用每次进入都会调用 mount 方法，通常我们在这里触发应用的渲染方法
export async function mount(props: any) {
  props.onGlobalStateChange((state, prev) => {
    // state: 变更后的状态; prev 变更前的状态
    console.log(state, prev);
    // 将这个state存储到我们子应用store
  });
  props.setGlobalState({ count: 2 });
  render(props);
}

// 应用每次 切出/卸载 会调用的方法，通常在这里我们会卸载微应用的应用实例
export async function unmount(props: any) {
  root.unmount();
}

```

2. 新增 public-path.js， 在入口文件进行引入

```javascript
if (window.__POWERED_BY_QIANKUN__) {
  // 动态设置 webpack publicPath，防止资源加载出错
  // eslint-disable-next-line no-undef
  __webpack_public_path__ = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__;
}
```

3. 修改 webpack 配置文件

```javascript
// 为了方便修改webpack配置，使用react-app-rewired
npm i react-app-rewired

// 修改package.json文件夹中的scripts命令

 "scripts": {
    "start": "react-app-rewired start",
    "build": "react-app-rewired build",
    "test": "react-app-rewired test",
    "eject": "react-app-rewired eject"
  },

// 在根目录下新增config-overrides.js文件并新增如下配置
const { name } = require("./package");

module.exports = {
  webpack: (config) => {
    config.output.library = `${name}-[name]`;
    config.output.libraryTarget = "umd";
    config.output.chunkLoadingGlobal = `webpackJsonp_${name}`;
    return config;
  }
};
```

#### vue 子应用（vite）

##### 创建子应用

```bash
# 创建子应用，选择vue3+vite
npm create vite@latest
```

##### 改造子应用

1. 安装`vite-plugin-qiankun`依赖包

```bash
npm i vite-plugin-qiankun # yarn add vite-plugin-qiankun
```

2. 修改 vite.config.js

```javascript
import qiankun from "vite-plugin-qiankun";

defineConfig({
  base: "/sub-vue", // 和基座中配置的activeRule一致
  server: {
    port: 3002,
    cors: true,
    origin: "http://localhost:3002",
  },
  plugins: [
    vue(),
    qiankun("sub-vue", {
      // 配置qiankun插件
      useDevMode: true,
    }),
  ],
});
```

3. 修改 main.ts

```javascript
import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import {
  renderWithQiankun,
  qiankunWindow,
} from "vite-plugin-qiankun/dist/helper";

let app: any;
if (!qiankunWindow.__POWERED_BY_QIANKUN__) {
  createApp(App).mount("#app");
} else {
  renderWithQiankun({
    // 子应用挂载
    mount(props) {
      app = createApp(App);
      app.mount(props.container.querySelector("#app"));
    },
    // 只有子应用第一次加载会触发
    bootstrap() {
      console.log("vue app bootstrap");
    },
    // 更新
    update() {
      console.log("vue app update");
    },
    // 卸载
    unmount() {
      console.log("vue app unmount");
      app?.unmount();
    },
  });
}
```

#### react 子应用（vite）

使用 vite 创建的 react 项目，以[https://github.com/gjxwxt/react-template](https://github.com/gjxwxt/react-template)为模板，和 webpack 一样，分环境区分 root 是谁。

1. 注意@vitejs/plugin-react 版本为^3.0.0，因为需要配置 fastRefresh: false
2. 安装 @vitejs/plugin-legacy 和 vite-plugin-legacy-qiankun

```javascript
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import viteEslint from "vite-plugin-eslint";
import legacy from "@vitejs/plugin-legacy";
import { legacyQiankun } from "vite-plugin-legacy-qiankun";
const envDir = path.resolve(process.cwd(), "./env");
// https://vitejs.dev/config/
export default defineConfig({
  envDir,
  envPrefix: "VITE_",
  base: "/react-template",
  resolve: {
    extensions: [".js", ".ts", ".tsx", ".scss", ".css"],
    alias: {
      "@": path.resolve(__dirname, "src"), // 源文件根目录
    },
  },
  plugins: [
    react({ fastRefresh: false }),
    legacy(),
    legacyQiankun({
      name: "react-template",
      devSandbox: true,
    }),
    viteEslint({
      failOnError: false,
    }),
  ],
  css: {
    // 预处理器配置项
    preprocessorOptions: {
      less: {
        math: "always",
        globalVars: {
          //配置全局变量
          test: "#1CC0FF",
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom", //提供浏览器API以模拟浏览器环境
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
  server: {
    open: true, // 自动打开浏览器
    port: 3004, // 服务端口
    proxy: {
      "/api": {
        target: "",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      }, // api代理路径
      "/mock": "", // mock代理路径,
    },
  },
});
```

3. 修改入口文件

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { createLifecyle, getMicroApp } from "vite-plugin-legacy-qiankun";
import App from "./App";
import pkg from "../package.json";

const render = (props?: any) => {
  const { container } = props || {};
  const root = container
    ? container.querySelector("#root")
    : document.getElementById("root");
  ReactDOM.createRoot(root!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

const microApp = getMicroApp(pkg.name);

if (microApp.__POWERED_BY_QIANKUN__) {
  createLifecyle(pkg.name, {
    mount(props) {
      render(props);
    },
    bootstrap() {
      console.log("bootstrap", pkg.name);
    },
    unmount() {
      console.log("unmount", pkg.name);
    },
  });
} else {
  render();
}
```

#### umi4 子应用

1. 安装插件

```bash
npm i @umijs/plugins
```

2. 配置.umirc.ts

```javascript
export default {
  base: "/sub-umi",
  npmClient: "npm",
  plugins: ["@umijs/plugins/dist/qiankun"],
  qiankun: {
    slave: {},
  },
};
```

完成上面两步就可以在基座中看到 umi 子应用的加载了。
如果想在 qiankun 的生命周期中做些处理，需要修改下入口文件 src/app.ts 修改

```javascript
export const qiankun = {
  async mount(props: any) {
    console.log(props);
  },
  async bootstrap() {
    console.log("umi app bootstraped");
  },
  async afterMount(props: any) {
    console.log("umi app afterMount", props);
  },
};
```

### 五、样式隔离

qiankun 实现了各个子应用之间的样式隔离，但是基座和子应用之间的样式隔离没有实现，所以基座和子应用之前的样式还会有冲突和覆盖的情况。qiankun 实现了子应用之间的样式隔离，但是基座和子应用之间还是存在着样式覆盖和冲突，在基座中定义的样式，会影响到子应用。
解决方法：

- 每个应用的样式使用固定的格式
- 通过`css-module`的方式给每个应用自动加上前缀

### 六、子应用间的跳转

- 主应用和微应用都是 `hash` 模式，主应用根据 `hash` 来判断微应用，则不用考虑这个问题。直接 window.history.hash="/sub-vue"
- `history`模式下微应用之间的跳转，或者微应用跳主应用页面，直接使用微应用的路由实例是不行的，原因是微应用的路由实例跳转都基于路由的 `base`。有两种办法可以跳转：
  1.  history.pushState()

```javascript
// 在要跳转的页面使用history.pushState()方法进行跳转
goVue(){
    window.history.pushState({},'','/sub-vue')
}
```

2.  将主应用的路由实例通过 `props` 传给微应用，微应用这个路由实例跳转。

具体方案：在基座中复写并监听`history.pushState()`方法并做相应的跳转逻辑，同时基座中监听 pushState 事件，因为基座和子应用共享同一个 window 对象，所以修改的是同一个 window

```javascript
// 基座的app.tsx文件中添加

// 重写pushState函数,当触发pushState时调用dispatchEvent将事件能够被监听到
const _wr = function (type: string) {
  const orig = (window as any).history[type]
  return function () {
    const rv = orig.apply(this, arguments)
    const e: any = new Event(type)
    e.arguments = arguments
    window.dispatchEvent(e)
    return rv
  }
}

window.history.pushState = _wr('pushState')

// 在这个函数中做跳转后的逻辑
const bindHistory = () => {
  const currentPath = window.location.pathname;
  setSelectedPath(
  	routes.find(item => currentPath.includes(item.key))?.key || ''
  )
}

// 绑定事件
window.addEventListener('pushState', bindHistory)
```

### 公共依赖加载

场景：如果主应用和子应用都使用了相同的库或者包(antd, axios 等)，就可以用`externals`的方式来引入，减少加载重复包导致资源浪费，就是一个项目使用后另一个项目不必再重复加载。

方式：

- 主应用：将所有公共依赖配置`webpack` 的`externals`，并且在`index.html`使用外链引入这些公共依赖
- 子应用：和主应用一样配置`webpack` 的`externals`，并且在`index.html`使用外链引入这些公共依赖，注意，还需要给子应用的公共依赖的加上 `ignore` 属性（这是自定义的属性，非标准属性），qiankun 在解析时如果发现`igonre`属性就会自动忽略

以 axios 为例：

```javascript
// 首先如果umi子应用中应用的axios，那么在.umirc.ts文件中添加headScripts，目的就是在生成的html文件中添加script链接
// 因为umi没有index.html文件，所以需要在.umirc.ts文件中配置，其他类型就需要在index.html文件中以及webpack/vite配置文件中添加externals，这样打包的时候就不会打包进去了

// 打包去除依赖，同时利用外链的形式去控制只加载一次

// .umirc.ts
export default {
  base: '/sub-umi',
  npmClient: 'npm',
  plugins: ['@umijs/plugins/dist/qiankun'],
  qiankun: {
    slave: {},
  },
  headScripts: [
    { src: 'https://unpkg.com/axios@1.1.2/dist/axios.min.js', ignore: true }, // ignore属性为true
  ],
};


// 修改基座中的 config-overrides.js，添加externals
const { override, addWebpackExternals } = require('customize-cra')

module.exports = override(
  addWebpackExternals ({
    axios: "axios",
  }),
)

// 在基座index.html文件中添加script外链
<!-- 注意：这里的公共依赖的版本必须一致 -->

<script ignore="true" src="https://unpkg.com/axios@1.1.2/dist/axios.min.js"></script>
```

### 全局状态管理

一般来说，各个子应用是通过业务来划分的，不同业务线应该降低耦合度，尽量去避免通信，但是如果涉及到一些公共的状态或者操作，qiankun 也是支持的。

qinkun 提供了一个全局的`GlobalState`来共享数据，基座初始化之后，子应用可以监听到这个数据的变化，也能提交这个数据。

基座：

```javascript
// 基座初始化一个全局状态state
import { initGlobalState } from "qiankun";

const state = { count: 1 };

const actions = initGlobalState(state);
// 主项目项目监听和修改
actions.onGlobalStateChange((state, prev) => {
  // state: 变更后的状态; prev 变更前的状态
  console.log(state, prev);
});
actions.setGlobalState(state);
```

子应用：

```javascript
// 子项目监听和修改，子项目生命周期中能拿到onGlobalStateChange事件，代表全局state变化了
export function mount(props) {
  props.onGlobalStateChange((state, prev) => {
    // state: 变更后的状态; prev 变更前的状态
    // 一般拿到state后存储到子应用自身的store中
    console.log(state, prev);
  });
  // 可以通过setGlobalState修改state
  props.setGlobalState(state);
}
```
