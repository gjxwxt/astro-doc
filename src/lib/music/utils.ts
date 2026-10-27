import type { MusicSourceId } from './types';

export const MUSIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export const MUSIC_HEADERS = {
  'user-agent': MUSIC_UA,
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const MAX_AUDIO_BYTES = 45 * 1024 * 1024;

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function cookieHeader(response: Response): string {
  const withCookies = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = withCookies.getSetCookie?.() ?? [];
  return values
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

export function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&nbsp;', ' ');
}

export function stripTags(value: string): string {
  const withBreaks = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeHtml(withBreaks)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeJsString(value: string): string {
  return decodeHtml(
    value
      .replaceAll('\\/', '/')
      .replaceAll("\\'", "'")
      .replaceAll('\\"', '"')
      .replaceAll('\\n', '\n')
      .replaceAll('\\r', ''),
  );
}

export function extractElementById(html: string, id: string): string {
  const pattern = new RegExp(`<div[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i');
  return html.match(pattern)?.[1] ?? '';
}

export function parseLrcBlock(html: string): string {
  const block = extractElementById(html, 'content-lrc2') || extractElementById(html, 'content-lrc');
  if (!block) return '';
  return stripTags(block)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join('\n');
}

export function sanitizeName(value: string, fallback = 'music'): string {
  const cleaned = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  return (cleaned || fallback).slice(0, 100);
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 3) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function isAllowedAudioHost(source: MusicSourceId, rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (source === 'gequhai' || source === 'gequke') {
    return host === 'kuwo.cn' || host.endsWith('.kuwo.cn');
  }
  return host === '126.net' || host.endsWith('.126.net') || host === 'music.163.com';
}

export async function fetchAudio(source: MusicSourceId, rawUrl: string): Promise<Uint8Array> {
  if (!isAllowedAudioHost(source, rawUrl)) {
    throw new Error('音频地址不在允许的来源域名内。');
  }

  const referer = source === 'netease' ? 'https://music.163.com/' : 'https://www.kuwo.cn/';
  const response = await fetchWithTimeout(
    rawUrl,
    {
      headers: {
        ...MUSIC_HEADERS,
        referer,
      },
      redirect: 'follow',
    },
    20_000,
  );

  if (!response.ok) {
    throw new Error(`音频文件返回 ${response.status}。`);
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_AUDIO_BYTES) {
    await response.body?.cancel();
    throw new Error('音频文件超过 45MB，已拒绝下载。');
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new Error('音频文件超过 45MB，已拒绝下载。');
  }
  if (!looksLikeMp3(bytes)) {
    throw new Error('上游返回的不是 MP3 文件。');
  }
  return bytes;
}
