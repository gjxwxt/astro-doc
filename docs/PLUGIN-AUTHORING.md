# 写一个插件

插件目录：`src/plugins/<id>/`。目录名就是插件 id，必须和 `manifest.id` 一致。

一个插件最多三个文件：

```text
src/plugins/demo/
├── manifest.ts   # 必须：纯数据，页面和 API 都读它
├── server.ts     # 可选：需要联网、密钥或 Node 能力的 action
└── Tool.astro    # 可选：工具页界面；没有就显示 API 说明
```

不需要改路由、注册表、API 分发器或 MCP 服务端。

## 1. manifest

```ts
import type { PluginManifest } from '../types';

const manifest: PluginManifest = {
  id: 'demo',
  name: '示例工具',
  tagline: '一句话说明它解决什么问题。',
  description: '稍微完整一点的介绍，会出现在工具页和搜索结果里。',
  icon: 'code',              // Icon.astro 里的图标名
  status: 'stable',          // stable | beta | experimental | needs-config
  tags: ['示例', '文本'],
  order: 40,                 // 越小越靠前
  actions: [
    {
      id: 'echo',
      label: '回显文本',
      description: '把输入原样返回，用来验证链路。',
      kind: 'server',
      mcp: true,             // 是否暴露给 MCP
      input: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            title: '文本',
            description: '要回显的内容',
            required: true,
            minLength: 1,
            maxLength: 200,
          },
        },
        required: ['text'],
      },
    },
  ],
  // 可选：工具页会显示配置提示
  // config: {
  //   env: ['DEMO_API_KEY'],
  //   hint: '在 .env 里配置 DEMO_API_KEY。',
  // },
  notes: ['这个工具的输入不会离开浏览器。'],
};

export default manifest;
```

### 支持的输入字段

`input` 是一个很小的 JSON Schema 子集，服务端校验和 MCP schema 共用它：

| 字段 | 说明 |
| --- | --- |
| `type` | `string` / `number` / `boolean` / `array` |
| `title` / `description` | 展示和 MCP 用 |
| `required` | 字段级必填；也可以放在 `input.required` 数组里 |
| `default` | 缺省值 |
| `enum` | 字符串枚举 |
| `format: 'url'` | 校验为公网 http(s) URL（会拒绝私网地址） |
| `minLength` / `maxLength` | 字符串长度 |
| `minimum` / `maximum` | 数字范围 |
| `maxItems` / `items` | 数组长度和字符串元素 |

未知字段会被丢弃，不会传给 action。

## 2. server action

`server.ts` 导出 `actions` 对象。只有 `kind: 'server'` 的 action 会进这里；`kind: 'client'` 的动作在 `Tool.astro` 里自己实现。

```ts
import { ActionError, type ActionHandler } from '../types';

const echo: ActionHandler = async (input, context) => {
  const text = String(input.text ?? '');

  if (text.includes('forbidden')) {
    throw new ActionError('FORBIDDEN_TEXT', 400, '这个文本不允许。', '换一段试试。');
  }

  // context.env 是服务端环境变量
  // context.request 可以用来读 header
  return { echoed: text, node: process.version, hasKey: Boolean(context.env.DEMO_API_KEY) };
};

export const actions: Record<string, ActionHandler> = { echo };
```

约定：

- 输入已经过 manifest 校验，可以直接用。
- 返回普通对象 → API 包成 `{ ok: true, data }`。
- 返回 `Response` → 原样透传，适合二进制下载或自定义 header。
- 抛 `ActionError` → 映射成 `{ ok: false, error: { code, message, extra } }` 和对应 HTTP 状态。
- 其他异常 → 500，服务端日志记录，客户端只看到通用错误。
- 不要在 action 里读用户文件或执行任意命令；插件是站主自己的代码，不是沙箱。

如果 action 需要外部服务，把超时、域名白名单、响应大小限制写清楚。可以参考：

- `src/plugins/music/server.ts`：多源音乐搜索 + MP3/LRC 打包（域名白名单、大小限制）
- `src/plugins/media/server.ts`：Open Graph 抓取 + 可配置解析服务（私网拦截）
- `src/plugins/devkit/server.ts`：Node `crypto` 哈希

## 3. 界面（可选）

`Tool.astro` 会出现在 `/tools/<id>/` 的工作台里。它可以：

- 写 scoped `<style>`，或复用 `src/styles/tools.css` 的类；
- 写原生 `<script>`（Astro 会打包）；
- 调用 `/api/tools/<id>/<action>`；
- 用 `?q=` 之类的 query 参数做可分享的初始状态（音乐工具就这么做）。

```astro
---
import '@/styles/tools.css';
---

<div class="tool-ui" data-demo>
  <form class="tool-form" data-demo-form>
    <input class="tool-input" data-demo-input placeholder="输入文本" />
    <button class="button" type="submit">回显</button>
  </form>
  <pre class="tool-output" data-demo-output></pre>
</div>

<script>
  const root = document.querySelector<HTMLElement>('[data-demo]');
  const form = root?.querySelector<HTMLFormElement>('[data-demo-form]');
  const input = root?.querySelector<HTMLInputElement>('[data-demo-input]');
  const output = root?.querySelector<HTMLElement>('[data-demo-output]');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch('/api/tools/demo/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: input?.value ?? '' }),
    });
    const payload = await response.json();
    if (output) output.textContent = JSON.stringify(payload, null, 2);
  });
</script>
```

没有 `Tool.astro` 也能工作：工具页会显示 action 列表和 API 示例。只有纯客户端动作时，也可以不写 `server.ts`。

## 4. 页面和 MCP 怎么发现

- `src/plugins/registry.ts` 用 `import.meta.glob('./*/manifest.ts', { eager: true })` 自动收集 manifest，按 `order` 排序。
- `/tools` 列出所有插件；`/tools/<id>/` 根据 manifest 生成。
- `/plugins.json` 输出 manifest + `inputSchema`，MCP 服务端启动时读取。
- `src/plugins/server.ts` 用 `import.meta.glob('./*/server.ts')` 自动收集 action；API 分发器只认 manifest 里存在且 `kind === 'server'` 的 action。
- `/api/tools/<id>/<action>` 自动做鉴权（可选）、限流、校验、错误映射。

所以新增插件后：

1. `pnpm dev` 会立即出现（内容/路由会热更新）。
2. 生产环境重新 `pnpm build`。
3. MCP 服务端重启后才会注册新的 tool（manifest 有 60 秒缓存）。

## 5. 测试

纯逻辑尽量放到 `src/lib/` 或 `scripts/lib/`，用 Vitest 覆盖。插件 action 如果要测，可以把核心函数导出，避免直接测 HTTP。现有测试：

```bash
pnpm test
```

## 6. 常见坑

- **id 不一致**：目录名和 `manifest.id` 必须一致，否则 API 找不到 handler。
- **把 server 代码 import 进客户端**：`manifest.ts` 要保持纯数据；Node 模块只放 `server.ts`。
- **忘了 `mcp: true`**：action 还是能通过 HTTP 用，但不会出现在 MCP。
- **在客户端硬编码 API key**：所有密钥只放服务端环境变量。
- **没有处理外部超时**：用 `AbortSignal.timeout()`，并给用户可读的错误。
- **返回 `Response` 后又被包装**：分发器会检查 `instanceof Response`，不会包 JSON。
