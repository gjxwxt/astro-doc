import { plugins } from '@/plugins/registry';
import { toJsonSchema } from '@/plugins/validate';

export const prerender = true;

export function GET() {
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    api: { base: '/api/tools' },
    plugins: plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      tagline: plugin.tagline,
      description: plugin.description,
      tags: plugin.tags,
      status: plugin.status,
      config: plugin.config,
      actions: plugin.actions.map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        kind: action.kind,
        mcp: Boolean(action.mcp),
        inputSchema: action.input ? toJsonSchema(action.input) : undefined,
      })),
    })),
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
