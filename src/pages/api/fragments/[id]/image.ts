import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import { getFragment } from '@/lib/db/fragments';
import { authenticate } from '@/lib/private-auth';
import { jsonError, preflight } from '@/lib/private-http';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { assertPublicUrl } from '@/plugins/validate';

export const prerender = false;

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 JoshPortal/2.0';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
};

function extractImageSrc(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';
  const image = metadata.image;
  if (image && typeof image === 'object' && !Array.isArray(image)) {
    const src = (image as Record<string, unknown>).src;
    if (typeof src === 'string' && src.trim()) return src.trim();
  }
  const preview = metadata.preview;
  if (preview && typeof preview === 'object' && !Array.isArray(preview)) {
    const src = (preview as Record<string, unknown>).image;
    if (typeof src === 'string' && src.trim()) return src.trim();
  }
  return '';
}

function buildFilename(id: string, url: URL, mime: string): string {
  const ext = MIME_EXTENSIONS[mime] ?? '.jpg';
  const rawName = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const stem = rawName.replace(/\.[a-z0-9]{2,5}$/i, '') || `fragment-${id.slice(0, 8)}`;
  return `${stem}${ext}`;
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const lengthHeader = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(lengthHeader) && lengthHeader > maxBytes) {
    throw new Error('图片体积超过上限（20MB）。');
  }
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error('图片体积超过上限（20MB）。');
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error('图片体积超过上限（20MB）。');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export const GET: APIRoute = async ({ request, params }) => {
  const auth = authenticate(request, process.env);
  if (!auth) {
    return jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。');
  }

  const limit = rateLimit(clientKey(request, 'fragments:image-download'), 30, 60_000);
  if (!limit.ok) {
    return jsonError(429, 'RATE_LIMITED', '下载太频繁，稍后再试。');
  }

  const id = params.id?.trim() ?? '';
  if (!id) return jsonError(400, 'INVALID_ID', '缺少碎片 ID。');

  const fragment = getFragment(getDatabase(), auth.ownerId, id);
  if (!fragment) return jsonError(404, 'NOT_FOUND', '找不到这条碎片。');

  const rawSrc = extractImageSrc(fragment.metadata);
  if (!rawSrc) return jsonError(404, 'NO_IMAGE', '这条碎片没有关联图片。');

  let current: URL;
  try {
    current = assertPublicUrl(rawSrc);
  } catch {
    return jsonError(400, 'INVALID_URL', '图片地址不合法。');
  }

  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      response = await fetch(current, {
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'user-agent': USER_AGENT,
        },
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return jsonError(504, 'FETCH_TIMEOUT', '读取远程图片超时。');
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return jsonError(502, 'FETCH_FAILED', '远程图片重定向失败。');
      try {
        current = assertPublicUrl(new URL(location, current).href);
      } catch {
        return jsonError(400, 'INVALID_REDIRECT', '远程图片重定向到了不允许的地址。');
      }
      continue;
    }
    break;
  }

  if (!response || !response.ok) {
    return jsonError(502, 'FETCH_FAILED', `远程图片返回 ${response?.status ?? 502}。`);
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!contentType.startsWith('image/')) {
    return jsonError(502, 'INVALID_CONTENT_TYPE', '远程地址返回的不是图片。');
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBytes(response, MAX_IMAGE_BYTES);
  } catch (error) {
    return jsonError(413, 'IMAGE_TOO_LARGE', error instanceof Error ? error.message : '图片过大。');
  }

  const filename = buildFilename(fragment.id, current, contentType);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '-');

  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(bytes.byteLength),
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=3600',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
};

export const OPTIONS: APIRoute = () => preflight();
