export interface JsonErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

const MAX_JSON_BYTES = 256_000;

export function corsHeaders(): HeadersInit {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
  };
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body: JsonErrorBody = {
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
  return Response.json(body, { status, headers: corsHeaders() });
}

export function jsonOk(data: unknown, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: corsHeaders() });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function readJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {
      ok: false,
      response: jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', '请用 application/json。'),
    };
  }

  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
    return { ok: false, response: jsonError(413, 'BODY_TOO_LARGE', '请求体太大。') };
  }

  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) {
    return { ok: false, response: jsonError(413, 'BODY_TOO_LARGE', '请求体太大。') };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonError(400, 'INVALID_JSON', '请求体不是合法 JSON。') };
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
