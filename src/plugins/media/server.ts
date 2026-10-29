import { fetchLinkPreview, LinkPreviewError } from '@/lib/link-preview';
import { ActionError, type ActionHandler } from '../types';
import { assertPublicUrl } from '../validate';

const probe: ActionHandler = async (input, context) => {
  try {
    const preview = await fetchLinkPreview(String(input.url ?? ''), context.env);
    return {
      url: preview.url,
      finalUrl: preview.finalUrl,
      title: preview.title,
      description: preview.description,
      image: preview.image,
      video: preview.video,
      siteName: preview.siteName,
      author: preview.author,
      provider: preview.provider,
    };
  } catch (error) {
    if (error instanceof LinkPreviewError) {
      throw new ActionError(error.code, error.status, error.message);
    }
    throw new ActionError(
      'FETCH_FAILED',
      502,
      error instanceof Error ? error.message : '读取这个链接失败。',
    );
  }
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
