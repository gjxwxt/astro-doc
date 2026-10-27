import { ActionError } from '../../plugins/types';
import type { MusicSourceId, MusicTrack, ResolvedTrack } from './types';
import {
  MUSIC_HEADERS,
  cookieHeader,
  decodeJsString,
  fetchWithTimeout,
  parseLrcBlock,
  stripTags,
} from './utils';

type GequSourceId = Extract<MusicSourceId, 'gequhai' | 'gequke'>;

interface GequSite {
  id: GequSourceId;
  label: string;
  base: string;
  detailPath: string;
}

const SITES: Record<GequSourceId, GequSite> = {
  gequhai: {
    id: 'gequhai',
    label: '歌曲海',
    base: 'https://www.gequhai.com',
    detailPath: '/play/',
  },
  gequke: {
    id: 'gequke',
    label: '歌曲客',
    base: 'https://www.gequke.com',
    detailPath: '/song/',
  },
};

export function parseGequSearch(
  html: string,
  source: GequSourceId,
  limit = 12,
): MusicTrack[] {
  const site = SITES[source];
  const table = html.match(/<table[^>]*id=["']myTables["'][\s\S]*?<\/table>/i)?.[0] ?? html;
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const tracks: MusicTrack[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (tracks.length >= limit) break;
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 3) continue;

    const link = row[1].match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;

    const id = link[1].match(/\/(?:play|song)\/(\d+)/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const title = stripTags(link[2]) || stripTags(cells[1]);
    if (!title) continue;

    tracks.push({
      source,
      sourceLabel: site.label,
      id,
      title,
      artist: stripTags(cells[2]) || '未知歌手',
    });
  }

  return tracks;
}

interface GequPage {
  playId: string;
  type: number;
  title: string;
  artist: string;
  cover?: string;
  lyrics: string;
}

export function parseGequPage(html: string): GequPage {
  const read = (name: string): string => {
    const match = html.match(new RegExp(`window\\.${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`));
    return match ? decodeJsString(match[2]) : '';
  };
  const type = Number(html.match(/window\.mp3_type\s*=\s*(\d+)/)?.[1] ?? 0);

  return {
    playId: read('play_id'),
    type: Number.isFinite(type) ? type : 0,
    title: read('mp3_title'),
    artist: read('mp3_author'),
    cover: read('mp3_cover') || undefined,
    lyrics: parseLrcBlock(html),
  };
}

export async function searchGequ(
  source: GequSourceId,
  query: string,
  limit = 12,
): Promise<MusicTrack[]> {
  const site = SITES[source];
  const url = `${site.base}/search?s=${encodeURIComponent(query)}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        headers: {
          ...MUSIC_HEADERS,
          referer: `${site.base}/`,
        },
        redirect: 'follow',
      },
      9_000,
    );
  } catch {
    throw new ActionError('SOURCE_TIMEOUT', 504, `${site.label}搜索超时。`);
  }

  if (!response.ok) {
    throw new ActionError('SOURCE_ERROR', 502, `${site.label}搜索返回 ${response.status}。`);
  }

  return parseGequSearch(await response.text(), source, limit);
}

export async function resolveGequ(source: GequSourceId, id: string): Promise<ResolvedTrack> {
  const site = SITES[source];
  const detailUrl = `${site.base}${site.detailPath}${encodeURIComponent(id)}`;

  let pageResponse: Response;
  try {
    pageResponse = await fetchWithTimeout(
      detailUrl,
      {
        headers: {
          ...MUSIC_HEADERS,
          referer: `${site.base}/`,
        },
        redirect: 'follow',
      },
      12_000,
    );
  } catch {
    throw new ActionError('SOURCE_TIMEOUT', 504, `${site.label}详情页超时。`);
  }

  if (!pageResponse.ok) {
    throw new ActionError('SOURCE_ERROR', 502, `${site.label}详情页返回 ${pageResponse.status}。`);
  }

  const cookie = cookieHeader(pageResponse);
  const page = parseGequPage(await pageResponse.text());
  if (!page.playId) {
    throw new ActionError('SOURCE_PARSE_FAILED', 502, `${site.label}没有返回播放凭证。`);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${site.base}/api/music`,
      {
        method: 'POST',
        headers: {
          ...MUSIC_HEADERS,
          accept: 'application/json, text/javascript, */*; q=0.01',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'x-requested-with': 'Http',
          'x-custom-header': 'Key',
          origin: site.base,
          referer: detailUrl,
          ...(cookie ? { cookie } : {}),
        },
        body: new URLSearchParams({ id: page.playId, type: String(page.type) }).toString(),
        redirect: 'follow',
      },
      12_000,
    );
  } catch {
    throw new ActionError('SOURCE_TIMEOUT', 504, `${site.label}解析音源超时。`);
  }

  const payload = (await response.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: { url?: string } }
    | null;

  if (!payload || payload.code !== 200 || !payload.data?.url) {
    const message =
      payload?.code === 429
        ? '请求太频繁，等一会儿再试。'
        : payload?.msg || `${site.label}没有返回可下载的音频。`;
    throw new ActionError('SOURCE_NO_AUDIO', payload?.code === 429 ? 429 : 502, message);
  }

  return {
    url: payload.data.url.replaceAll('\\/', '/'),
    title: page.title || id,
    artist: page.artist || '未知歌手',
    cover: page.cover,
    lyrics: page.lyrics || undefined,
  };
}
