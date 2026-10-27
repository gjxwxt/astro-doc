import { ActionError } from '../../plugins/types';
import type { MusicTrack, ResolvedTrack } from './types';
import { MUSIC_HEADERS, fetchWithTimeout } from './utils';

interface NeteaseSong {
  id?: number;
  name?: string;
  duration?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; picUrl?: string };
}

interface NeteaseSearchPayload {
  result?: { songs?: NeteaseSong[] };
}

export function parseNeteaseSearch(payload: NeteaseSearchPayload, limit = 12): MusicTrack[] {
  const songs = payload.result?.songs ?? [];
  return songs
    .filter((song) => Number.isFinite(song.id) && Boolean(song.name))
    .slice(0, limit)
    .map((song) => ({
      source: 'netease' as const,
      sourceLabel: '网易云',
      id: String(song.id),
      title: song.name ?? '',
      artist: (song.artists ?? []).map((artist) => artist.name).filter(Boolean).join(' / ') || '未知歌手',
      album: song.album?.name,
      duration: song.duration ? Math.round(song.duration / 1000) : undefined,
      cover: song.album?.picUrl?.replace(/^http:/, 'https:'),
    }));
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function filterNeteaseRelevance(tracks: MusicTrack[], query: string): MusicTrack[] {
  const normalizedQuery = normalizeForMatch(query);
  const latinTokens = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const chineseChunks = query.match(/[\u4e00-\u9fff]{2,}/g) ?? [];

  return tracks.filter((track) => {
    const haystack = normalizeForMatch(`${track.title}${track.artist}`);
    if (!haystack || !normalizedQuery) return false;
    if (haystack.includes(normalizedQuery) || normalizedQuery.includes(haystack)) return true;
    if (latinTokens.length > 0) return latinTokens.some((token) => haystack.includes(token));
    return chineseChunks.some((chunk) => haystack.includes(chunk.slice(0, 2)));
  });
}

function rankByQuery(tracks: MusicTrack[], query: string): MusicTrack[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return tracks;
  return tracks
    .map((track, index) => {
      const title = track.title.toLowerCase();
      const artist = track.artist.toLowerCase();
      let matched = 0;
      let exact = 0;
      for (const token of tokens) {
        const inTitle = title.includes(token);
        const inArtist = artist.includes(token);
        if (inTitle || inArtist) matched += 1;
        if (title === token) exact += 1;
      }
      return { track, index, score: matched * 10 + exact * 2 };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ track }) => track);
}

export async function searchNetease(query: string, limit = 12): Promise<MusicTrack[]> {
  const url = new URL('https://music.163.com/api/search/get/web');
  url.searchParams.set('s', query);
  url.searchParams.set('type', '1');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', '0');

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        headers: {
          ...MUSIC_HEADERS,
          referer: 'https://music.163.com/',
        },
      },
      9_000,
    );
  } catch {
    throw new ActionError('SOURCE_TIMEOUT', 504, '网易云搜索超时。');
  }

  if (!response.ok) {
    throw new ActionError('SOURCE_ERROR', 502, `网易云搜索返回 ${response.status}。`);
  }

  const payload = (await response.json().catch(() => null)) as NeteaseSearchPayload | null;
  if (!payload) throw new ActionError('SOURCE_PARSE_FAILED', 502, '网易云返回了无法解析的结果。');

  return rankByQuery(filterNeteaseRelevance(parseNeteaseSearch(payload, limit), query), query);
}

interface NeteaseSongUrlPayload {
  data?: Array<{ url?: string | null }>;
}

interface NeteaseLyricPayload {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
}

export async function resolveNetease(
  id: string,
  fallback: { title?: string; artist?: string } = {},
): Promise<ResolvedTrack> {
  const lookup = new URL('https://music.163.com/api/song/enhance/player/url');
  lookup.searchParams.set('ids', JSON.stringify([Number(id)]));
  lookup.searchParams.set('br', '128000');

  let response: Response;
  try {
    response = await fetchWithTimeout(
      lookup,
      {
        headers: {
          ...MUSIC_HEADERS,
          referer: 'https://music.163.com/',
        },
      },
      10_000,
    );
  } catch {
    throw new ActionError('SOURCE_TIMEOUT', 504, '网易云获取音频地址超时。');
  }

  if (!response.ok) {
    throw new ActionError('SOURCE_ERROR', 502, `网易云音频接口返回 ${response.status}。`);
  }

  const payload = (await response.json().catch(() => null)) as NeteaseSongUrlPayload | null;
  let url = payload?.data?.[0]?.url ?? '';
  if (!url) {
    url = `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(id)}.mp3`;
  }

  let lyrics = '';
  try {
    const lyricResponse = await fetchWithTimeout(
      `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&kv=1&tv=-1`,
      {
        headers: {
          ...MUSIC_HEADERS,
          referer: 'https://music.163.com/',
        },
      },
      8_000,
    );
    if (lyricResponse.ok) {
      const lyricPayload = (await lyricResponse.json()) as NeteaseLyricPayload;
      lyrics = lyricPayload.lrc?.lyric || lyricPayload.tlyric?.lyric || '';
    }
  } catch {
    // A missing lyric should not block the song download.
  }

  return {
    url,
    title: fallback.title || id,
    artist: fallback.artist || '未知歌手',
    lyrics: lyrics.trim() || undefined,
  };
}
