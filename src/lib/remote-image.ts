import { assertPublicUrl } from '@/plugins/validate';

export const REMOTE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 JoshPortal/2.0';

export interface RemoteImage {
  bytes: Uint8Array;
  mime: string;
  finalUrl: URL;
  filename: string;
}

export class RemoteImageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'RemoteImageError';
  }
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const lengthHeader = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(lengthHeader) && lengthHeader > maxBytes) {
    throw new RemoteImageError('IMAGE_TOO_LARGE', '图片体积超过 20MB。', 413);
  }
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new RemoteImageError('IMAGE_TOO_LARGE', '图片体积超过 20MB。', 413);
    }
    return buffer;
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
          throw new RemoteImageError('IMAGE_TOO_LARGE', '图片体积超过 20MB。', 413);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function filenameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    /* keep encoded name */
  }
  return (
    decoded
      .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'remote-image'
  );
}

export async function downloadRemoteImage(rawUrl: string): Promise<RemoteImage> {
  let current: URL;
  try {
    current = assertPublicUrl(rawUrl.trim());
  } catch {
    throw new RemoteImageError('INVALID_URL', '图片地址不合法，只支持公网 http(s)。', 400);
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
      throw new RemoteImageError('FETCH_TIMEOUT', '读取远程图片超时。', 504);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new RemoteImageError('FETCH_FAILED', '远程图片重定向失败。');
      try {
        current = assertPublicUrl(new URL(location, current).href);
      } catch {
        throw new RemoteImageError('INVALID_REDIRECT', '远程图片重定向到了不允许的地址。', 400);
      }
      continue;
    }
    break;
  }

  if (!response || !response.ok) {
    throw new RemoteImageError(
      'FETCH_FAILED',
      `远程图片返回 ${response?.status ?? 502}。`,
    );
  }

  const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mime.startsWith('image/')) {
    throw new RemoteImageError('INVALID_CONTENT_TYPE', '远程地址返回的不是图片。');
  }

  const bytes = await readBoundedBytes(response, REMOTE_IMAGE_MAX_BYTES);
  return { bytes, mime, finalUrl: current, filename: filenameFromUrl(current) };
}
