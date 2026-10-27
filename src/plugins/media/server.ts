import { ActionError, type ActionHandler } from '../types';
import { assertPublicUrl } from '../validate';

const USER_AGENT = 'josh-portal/2.0';
const MAX_HTML_BYTES = 600_000;

function decodeEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function parsePage(html: string) {
  const meta = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag[0]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content) meta.set(key, attrs.content.trim());
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const descriptionTag = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  )?.[1];

  return {
    title: meta.get('og:title') || meta.get('twitter:title') || decodeEntities(titleTag).trim(),
    description:
      meta.get('og:description') ||
      meta.get('twitter:description') ||
      (descriptionTag ? decodeEntities(descriptionTag) : '') ||
      meta.get('description') ||
      '',
    image: meta.get('og:image') || meta.get('twitter:image') || '',
    video: meta.get('og:video:url') || meta.get('og:video') || meta.get('twitter:player:stream') || '',
    siteName: meta.get('og:site_name') || '',
  };
}

const probe: ActionHandler = async (input) => {
  let target: URL;
  try {
    target = assertPublicUrl(String(input.url ?? ''));
  } catch (error) {
    throw new ActionError('INVALID_URL', 400, error instanceof Error ? error.message : '链接不合法。');
  }

  let response: Response;
  try {
    response = await fetch(target, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(9_000),
    });
  } catch {
    throw new ActionError('FETCH_FAILED', 504, '读取这个链接超时，或对方拒绝了请求。');
  }

  if (!response.ok) {
    throw new ActionError('FETCH_FAILED', 502, `目标页面返回 ${response.status}。`);
  }

  const finalUrl = assertPublicUrl(response.url);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new ActionError('NOT_HTML', 415, '这个链接不是网页，无法读取预览信息。');
  }

  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_HTML_BYTES) {
    throw new ActionError('PAGE_TOO_LARGE', 413, '页面太大，已停止读取。');
  }

  const html = (await response.text()).slice(0, MAX_HTML_BYTES);
  const info = parsePage(html);

  return {
    url: target.href,
    finalUrl: finalUrl.href,
    ...info,
  };
};

const resolve: ActionHandler = async (input, context) => {
  const endpoint = context.env.MEDIA_RESOLVER_URL?.trim();
  if (!endpoint) {
    throw new ActionError(
      'NOT_CONFIGURED',
      503,
      '还没有配置视频解析服务。',
      '在 .env 里设置 MEDIA_RESOLVER_URL（约定：POST { url }，返回 { videoUrl }）。',
    );
  }

  let target: URL;
  try {
    target = assertPublicUrl(String(input.url ?? ''));
  } catch (error) {
    throw new ActionError('INVALID_URL', 400, error instanceof Error ? error.message : '链接不合法。');
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(context.env.MEDIA_RESOLVER_TOKEN
          ? { authorization: `Bearer ${context.env.MEDIA_RESOLVER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ url: target.href }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ActionError('RESOLVER_TIMEOUT', 504, '解析服务超时，请稍后再试。');
  }

  if (!response.ok) {
    throw new ActionError('RESOLVER_ERROR', 502, `解析服务返回 ${response.status}。`);
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ActionError('RESOLVER_INVALID', 502, '解析服务没有返回合法 JSON。');
  }

  const nested =
    data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : {};
  const pick = (...values: unknown[]): string => {
    for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
    return '';
  };

  const videoUrl = pick(
    data.videoUrl,
    data.video,
    data.url,
    data.playUrl,
    nested.videoUrl,
    nested.video,
    nested.url,
    nested.playUrl,
  );

  if (!videoUrl) {
    throw new ActionError('NO_VIDEO', 502, '解析服务没有返回视频地址。');
  }

  let absoluteVideo: string;
  try {
    absoluteVideo = new URL(videoUrl, endpoint).href;
  } catch {
    throw new ActionError('RESOLVER_INVALID', 502, '解析服务返回的视频地址不合法。');
  }

  return {
    source: 'resolver',
    title: pick(data.title, nested.title),
    author: pick(data.author, data.nickname, nested.author, nested.nickname),
    cover: pick(data.cover, data.thumbnail, nested.cover, nested.thumbnail),
    videoUrl: absoluteVideo,
    images: Array.isArray(data.images) ? data.images.slice(0, 20) : [],
  };
};

export const actions: Record<string, ActionHandler> = { probe, resolve };
