import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const PORTAL_URL = (process.env.PORTAL_URL ?? 'http://localhost:4321').replace(/\/+$/, '');
const PORTAL_API_TOKEN = process.env.PORTAL_API_TOKEN?.trim() ?? '';
const PRIVATE_API_TOKEN = process.env.PRIVATE_API_TOKEN?.trim() ?? '';

interface JsonField {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  items?: { type?: string };
  default?: unknown;
}

interface InputSchema {
  type?: string;
  properties?: Record<string, JsonField>;
  required?: string[];
}

interface ManifestAction {
  id: string;
  label: string;
  description: string;
  kind: 'server' | 'client';
  mcp: boolean;
  inputSchema?: InputSchema;
}

interface ManifestPlugin {
  id: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  status: string;
  config?: { env: string[]; hint: string };
  actions: ManifestAction[];
}

interface Manifest {
  version: number;
  api: { base: string };
  plugins: ManifestPlugin[];
}

interface SearchDoc {
  id: string;
  type: string;
  url: string;
  title: string;
  description?: string;
  body?: string;
}

interface SearchIndex {
  entries: SearchDoc[];
}

const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_TTL = 60_000;

function log(message: string): void {
  process.stderr.write(`[portal-mcp] ${message}\n`);
}

async function fetchPortal(path: string, init?: RequestInit, bearer = PORTAL_API_TOKEN): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (bearer) headers.set('authorization', `Bearer ${bearer}`);
  const response = await fetch(`${PORTAL_URL}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${response.status} ${detail.slice(0, 300)}`);
  }
  return response;
}

function fetchPrivatePortal(path: string, init?: RequestInit): Promise<Response> {
  return fetchPortal(path, init, PRIVATE_API_TOKEN);
}

async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value as T;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function loadManifest(): Promise<Manifest> {
  return cached('manifest', async () => {
    const response = await fetchPortal('/plugins.json');
    return (await response.json()) as Manifest;
  });
}

function loadIndex(): Promise<SearchIndex> {
  return cached('index', async () => {
    const response = await fetchPortal('/search-index.json');
    return (await response.json()) as SearchIndex;
  });
}

function textResult(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function schemaToZod(schema?: InputSchema): Record<string, z.ZodTypeAny> {
  if (!schema?.properties) return {};
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(schema.properties)) {
    let value: z.ZodTypeAny;

    if (field.type === 'number') {
      let numberSchema = z.number();
      if (typeof field.minimum === 'number') numberSchema = numberSchema.min(field.minimum);
      if (typeof field.maximum === 'number') numberSchema = numberSchema.max(field.maximum);
      value = numberSchema;
    } else if (field.type === 'boolean') {
      value = z.boolean();
    } else if (field.type === 'array') {
      value = z.array(z.string());
    } else if (field.enum && field.enum.length > 0) {
      value = z.enum(field.enum as [string, ...string[]]);
    } else {
      let stringSchema = z.string();
      if (typeof field.minLength === 'number') stringSchema = stringSchema.min(field.minLength);
      if (typeof field.maxLength === 'number') stringSchema = stringSchema.max(field.maxLength);
      value = stringSchema;
    }

    if (field.description) value = value.describe(field.description);
    if (!required.has(name)) value = value.optional();
    shape[name] = value;
  }

  return shape;
}

function normalizePath(value: string): string {
  try {
    const url = new URL(value, PORTAL_URL);
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return value;
  }
}

function registerPrivateTools(server: McpServer): void {
  server.registerTool(
    'inbox_list_fragments',
    {
      title: '列出 Inbox 碎片',
      description: '读取或筛选 Josh 私有 Inbox 里的碎片（支持关键词、标签、日期范围）。',
      inputSchema: {
        query: z.string().optional().describe('搜索原文、随想、标题或来源'),
        tag: z.string().optional().describe('按标签名筛选，不含 #'),
        status: z.enum(['inbox', 'archived']).optional().describe('状态筛选'),
        from: z.string().optional().describe('起始日期 YYYY-MM-DD'),
        to: z.string().optional().describe('截止日期 YYYY-MM-DD'),
        limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20'),
        offset: z.number().int().min(0).optional().describe('分页偏移，默认 0'),
      },
    },
    async ({ query, tag, status, from, to, limit, offset }) => {
      try {
        const params = new URLSearchParams();
        if (query) params.set('query', query);
        if (tag) params.set('tag', tag);
        if (status) params.set('status', status);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        params.set('limit', String(limit ?? 20));
        if (offset) params.set('offset', String(offset));
        const response = await fetchPrivatePortal(`/api/fragments?${params.toString()}`);
        return textResult(await response.json());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'inbox_get_fragment',
    {
      title: '读取单条 Inbox 碎片',
      description: '按 ID 读取一条私有碎片的完整原文、上下文、随想、标签与元数据。',
      inputSchema: {
        id: z.string().min(1).describe('碎片 UUID'),
      },
    },
    async ({ id }) => {
      try {
        const response = await fetchPrivatePortal(`/api/fragments/${encodeURIComponent(id)}`);
        return textResult(await response.json());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'inbox_save_fragment',
    {
      title: '保存碎片到 Inbox',
      description: '从本地客户端直接向 Josh Inbox 保存一段摘录、想法或网页链接。',
      inputSchema: {
        kind: z.enum(['quote', 'link']).optional().describe('quote 保存文字碎片，link 保存链接卡片'),
        quote: z.string().optional().describe('摘录或碎片正文（kind=quote 时必填）'),
        url: z.string().optional().describe('要保存为链接卡片的 URL，或摘录来源 URL'),
        note: z.string().optional().describe('个人随想或批注'),
        tags: z.array(z.string()).optional().describe('标签列表'),
        sourceTitle: z.string().optional().describe('来源标题'),
      },
    },
    async ({ kind, quote, url, note, tags, sourceTitle }) => {
      try {
        const isLink = kind === 'link' || (!quote?.trim() && Boolean(url?.trim()));
        if (isLink) {
          if (!url?.trim()) return errorResult('保存链接卡片需要提供 url。');
          const response = await fetchPrivatePortal('/api/fragments/link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: url.trim(), note: note ?? '', tags: tags ?? [] }),
          });
          return textResult(await response.json());
        }
        if (!quote?.trim()) return errorResult('保存文字碎片需要提供 quote。');
        const response = await fetchPrivatePortal('/api/fragments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'quote',
            quote: quote.trim(),
            note: note ?? '',
            sourceUrl: url?.trim() ?? '',
            sourceTitle: sourceTitle?.trim() ?? '',
            tags: tags ?? [],
          }),
        });
        return textResult(await response.json());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'inbox_update_fragment',
    {
      title: '更新 Inbox 碎片',
      description: '修改私有碎片的随想、标签或归档状态。',
      inputSchema: {
        id: z.string().min(1).describe('碎片 UUID'),
        note: z.string().optional().describe('新的随想内容'),
        tags: z.array(z.string()).optional().describe('更新后的完整标签列表'),
        status: z.enum(['inbox', 'archived']).optional().describe('状态：inbox 或 archived'),
      },
    },
    async ({ id, note, tags, status }) => {
      try {
        const response = await fetchPrivatePortal(`/api/fragments/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note, tags, status }),
        });
        return textResult(await response.json());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'drafts_list',
    {
      title: '列出合成草稿',
      description: '列出 Josh 私有草稿箱里的文章草稿。',
      inputSchema: {
        status: z.enum(['draft', 'exported', 'archived']).optional().describe('按草稿状态筛选'),
        limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20'),
        offset: z.number().int().min(0).optional().describe('分页偏移，默认 0'),
      },
    },
    async ({ status, limit, offset }) => {
      try {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        params.set('limit', String(limit ?? 20));
        if (offset) params.set('offset', String(offset));
        const response = await fetchPrivatePortal(`/api/drafts?${params.toString()}`);
        return textResult(await response.json());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'drafts_get',
    {
      title: '读取或导出合成草稿',
      description:
        '按 ID 读取一篇私有草稿。format=markdown 时直接返回带 frontmatter 与来源附录的完整 Markdown，便于直接写入本地 Obsidian。',
      inputSchema: {
        id: z.string().min(1).describe('草稿 UUID'),
        format: z
          .enum(['json', 'markdown'])
          .optional()
          .describe('json 返回结构化草稿与引用；markdown 返回可直接落盘的导出全文'),
      },
    },
    async ({ id, format }) => {
      try {
        if (format === 'markdown') {
          const response = await fetchPrivatePortal(
            `/api/drafts/${encodeURIComponent(id)}/export`,
            { headers: { accept: 'text/markdown' } },
          );
          return textResult(await response.text());
        }
        const response = await fetchPrivatePortal(`/api/drafts/${encodeURIComponent(id)}`);
        return textResult(await response.json());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'drafts_update',
    {
      title: '更新合成草稿',
      description: '在本地编辑或润色后，把标题、Markdown 正文或状态写回门户草稿箱。',
      inputSchema: {
        id: z.string().min(1).describe('草稿 UUID'),
        title: z.string().optional().describe('新标题'),
        markdown: z.string().optional().describe('更新后的 Markdown 正文'),
        status: z.enum(['draft', 'exported', 'archived']).optional().describe('草稿状态'),
      },
    },
    async ({ id, title, markdown, status }) => {
      try {
        const response = await fetchPrivatePortal(`/api/drafts/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, markdown, status }),
        });
        return textResult(await response.json());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  log('registered private inbox & drafts tools (7 tools)');
}

async function main(): Promise<void> {
  const server = new McpServer({ name: 'josh-portal', version: '0.1.0' });

  server.registerTool(
    'list_tools',
    {
      title: '列出门户工具',
      description: '列出 Josh 的个人门户里可用的插件、action、状态和配置项。',
    },
    async () => {
      try {
        const manifest = await loadManifest();
        return textResult({
          portal: PORTAL_URL,
          privateInboxEnabled: Boolean(PRIVATE_API_TOKEN),
          plugins: manifest.plugins.map((plugin) => ({
            id: plugin.id,
            name: plugin.name,
            tagline: plugin.tagline,
            status: plugin.status,
            tags: plugin.tags,
            config: plugin.config,
            actions: plugin.actions,
          })),
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'search_site',
    {
      title: '搜索站内内容',
      description: '搜索 Josh 个人门户里的文档、笔记、工具和收藏，返回标题、链接和相关片段。',
      inputSchema: {
        query: z.string().min(1).describe('搜索关键词，可以是中文或英文'),
        limit: z.number().int().min(1).max(20).optional().describe('返回条数，默认 8'),
      },
    },
    async ({ query, limit }) => {
      try {
        const response = await fetchPortal(
          `/api/search?q=${encodeURIComponent(query)}&limit=${limit ?? 8}`,
        );
        return textResult(await response.json());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'get_page',
    {
      title: '读取站内页面',
      description: '按 URL 读取一篇文档或笔记的正文，适合在搜索之后展开细节。',
      inputSchema: {
        url: z.string().describe('站内路径或完整 URL，例如 /notes/rebuild-the-portal/'),
      },
    },
    async ({ url }) => {
      try {
        const index = await loadIndex();
        const wanted = normalizePath(url);
        const entry = index.entries.find((candidate) => normalizePath(candidate.url) === wanted);
        if (!entry) {
          return errorResult(
            `没有找到 ${url}。可以先调用 search_site 搜索标题，再读取对应页面。`,
          );
        }
        return textResult({
          title: entry.title,
          url: entry.url,
          type: entry.type,
          description: entry.description ?? '',
          body: entry.body ?? '',
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  if (PRIVATE_API_TOKEN) {
    registerPrivateTools(server);
  }

  let manifest: Manifest | null = null;
  try {
    manifest = await loadManifest();
  } catch (error) {
    log(
      `没有连上门户 ${PORTAL_URL}，只注册搜索/读取工具。启动门户后重启 MCP 服务即可加载插件工具。${
        error instanceof Error ? ` (${error.message})` : ''
      }`,
    );
  }

  if (manifest) {
    for (const plugin of manifest.plugins) {
      for (const action of plugin.actions) {
        if (!action.mcp || action.kind !== 'server') continue;
        const toolName = `${plugin.id}_${action.id}`;
        const shape = schemaToZod(action.inputSchema);

        server.registerTool(
          toolName,
          {
            title: `${plugin.name} · ${action.label}`,
            description: `[${plugin.name}] ${action.label}：${action.description}`,
            inputSchema: shape,
          },
          async (args) => {
            try {
              const response = await fetchPortal(`/api/tools/${plugin.id}/${action.id}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(args ?? {}),
              });
              return textResult(await response.json());
            } catch (error) {
              return errorResult(error instanceof Error ? error.message : String(error));
            }
          },
        );
        log(`registered ${toolName}`);
      }
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`connected to ${PORTAL_URL} (${manifest?.plugins.length ?? 0} plugins)`);
}

main().catch((error) => {
  log(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
