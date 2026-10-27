import type { APIRoute } from 'astro';

import { isAuthorized } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { getActionHandler } from '@/plugins/server';
import { getPlugin } from '@/plugins/registry';
import { ActionError } from '@/plugins/types';
import { validateInput } from '@/plugins/validate';

export const prerender = false;

function jsonError(status: number, code: string, message: string, extra?: unknown) {
  return Response.json({ ok: false, error: { code, message, ...(extra ? { extra } : {}) } }, { status });
}

export const POST: APIRoute = async ({ params, request }) => {
  const env = process.env;
  if (!isAuthorized(request, env)) return jsonError(401, 'UNAUTHORIZED', '未授权。');

  const pluginId = params.plugin ?? '';
  const actionId = params.action ?? '';
  const plugin = getPlugin(pluginId);
  const action = plugin?.actions.find((candidate) => candidate.id === actionId && candidate.kind === 'server');
  const handler = action ? getActionHandler(pluginId, actionId) : undefined;

  if (!plugin || !action || !handler) {
    return jsonError(404, 'NOT_FOUND', '找不到这个工具动作。');
  }

  const limit = rateLimit(clientKey(request, `tool:${pluginId}:${actionId}`), 60, 60_000);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: { code: 'RATE_LIMITED', message: '请求太频繁，稍后再试。' } },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    );
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256_000) return jsonError(413, 'BODY_TOO_LARGE', '请求体太大。');

  let body: unknown = {};
  if (request.headers.get('content-type')?.includes('application/json')) {
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', '请求体不是合法 JSON。');
    }
  }

  if (action.input) {
    const validated = validateInput(action.input, body);
    if (!validated.ok) {
      return jsonError(400, 'INVALID_INPUT', '输入不合法。', { fields: validated.errors });
    }
    body = validated.value;
  }

  try {
    const result = await handler(body as Record<string, unknown>, {
      request,
      env,
      clientAddress: request.headers.get('x-forwarded-for') ?? 'local',
    });

    if (result instanceof Response) return result;
    return Response.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof ActionError) {
      return jsonError(error.status, error.code, error.message, error.hint ? { hint: error.hint } : undefined);
    }
    console.error(`[tool:${pluginId}/${actionId}]`, error);
    return jsonError(500, 'INTERNAL_ERROR', '工具执行失败，请稍后再试。');
  }
};

export const GET: APIRoute = () =>
  Response.json(
    { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '请使用 POST。' } },
    { status: 405, headers: { allow: 'POST' } },
  );
