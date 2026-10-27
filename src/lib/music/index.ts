import { zipSync } from 'fflate';

import { ActionError } from '../../plugins/types';
import { resolveGequ, searchGequ } from './gequ';
import { resolveNetease, searchNetease } from './netease';
import type {
  DownloadInput,
  MusicSearchResult,
  MusicSourceId,
  MusicTrack,
  ResolvedTrack,
  SourceAttempt,
} from './types';
import { contentDisposition, fetchAudio, sanitizeName, toArrayBuffer } from './utils';

interface SourceDefinition {
  id: MusicSourceId;
  label: string;
  search: (query: string, limit: number) => Promise<MusicTrack[]>;
  resolve: (id: string, fallback: { title?: string; artist?: string }) => Promise<ResolvedTrack>;
}

const SOURCES: SourceDefinition[] = [
  {
    id: 'gequhai',
    label: '歌曲海',
    search: (query, limit) => searchGequ('gequhai', query, limit),
    resolve: (id) => resolveGequ('gequhai', id),
  },
  {
    id: 'gequke',
    label: '歌曲客',
    search: (query, limit) => searchGequ('gequke', query, limit),
    resolve: (id) => resolveGequ('gequke', id),
  },
  {
    id: 'netease',
    label: '网易云',
    search: searchNetease,
    resolve: (id, fallback) => resolveNetease(id, fallback),
  },
];

const SEARCH_CACHE_TTL = 2 * 60 * 1000;
const SEARCH_CACHE_LIMIT = 100;
const searchCache = new Map<string, { at: number; value: MusicSearchResult }>();

function getCachedSearch(key: string): MusicSearchResult | undefined {
  const hit = searchCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > SEARCH_CACHE_TTL) {
    searchCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSearch(key: string, value: MusicSearchResult): void {
  if (searchCache.size >= SEARCH_CACHE_LIMIT) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
  searchCache.set(key, { at: Date.now(), value });
}

export const MUSIC_SOURCE_LABELS = SOURCES.map((source) => source.label);

export async function searchMusic(query: string, limit = 12): Promise<MusicSearchResult> {
  const cleanQuery = query.trim().replace(/\s+/g, ' ');
  if (!cleanQuery) {
    throw new ActionError('INVALID_QUERY', 400, '输入歌名或歌手再搜索。');
  }
  if (cleanQuery.length > 80) {
    throw new ActionError('QUERY_TOO_LONG', 400, '关键词太长了，最多 80 个字符。');
  }

  const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
  const cacheKey = `${cleanQuery.toLowerCase()}:${safeLimit}`;
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  const attempts: SourceAttempt[] = [];

  for (const source of SOURCES) {
    try {
      const results = await source.search(cleanQuery, safeLimit);
      attempts.push({
        source: source.id,
        label: source.label,
        status: results.length > 0 ? 'found' : 'empty',
        count: results.length,
      });

      if (results.length > 0) {
        const payload: MusicSearchResult = {
          query: cleanQuery,
          source: source.id,
          sourceLabel: source.label,
          results,
          attempts,
        };
        cacheSearch(cacheKey, payload);
        return payload;
      }
    } catch (error) {
      attempts.push({
        source: source.id,
        label: source.label,
        status: 'error',
        count: 0,
        message: error instanceof Error ? error.message : '这个源暂时不可用。',
      });
    }
  }

  const payload: MusicSearchResult = {
    query: cleanQuery,
    source: null,
    sourceLabel: null,
    results: [],
    attempts,
  };
  cacheSearch(cacheKey, payload);
  return payload;
}

function findSource(source: MusicSourceId): SourceDefinition {
  const found = SOURCES.find((candidate) => candidate.id === source);
  if (!found) {
    throw new ActionError('INVALID_SOURCE', 400, '不认识的音乐来源。');
  }
  return found;
}

export async function downloadMusic(input: DownloadInput): Promise<Response> {
  if (!/^\d+$/.test(input.id)) {
    throw new ActionError('INVALID_ID', 400, '歌曲编号不合法。');
  }

  const source = findSource(input.source);
  let track: ResolvedTrack;
  try {
    track = await source.resolve(input.id, {
      title: input.title,
      artist: input.artist,
    });
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(
      'SOURCE_RESOLVE_FAILED',
      502,
      `${source.label}没有解析出这首歌。`,
      '换一个结果，或稍后再试。',
    );
  }

  let audio: Uint8Array;
  try {
    audio = await fetchAudio(source.id, track.url);
  } catch (error) {
    throw new ActionError(
      'AUDIO_FETCH_FAILED',
      502,
      error instanceof Error ? error.message : '音频下载失败。',
      '换一个来源或稍后再试。',
    );
  }

  const base = sanitizeName(
    `${track.artist || input.artist || ''} - ${track.title || input.title || ''}`,
    'music',
  );
  const includeLyrics = input.includeLyrics !== false;
  const hasLyrics = Boolean(track.lyrics?.trim());
  const commonHeaders = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-music-lyrics': includeLyrics ? (hasLyrics ? 'included' : 'none') : 'skipped',
  };

  if (includeLyrics && hasLyrics) {
    const archive = zipSync(
      {
        [`${base}.mp3`]: audio,
        [`${base}.lrc`]: new TextEncoder().encode(track.lyrics?.trim() ?? ''),
      },
      { level: 0 },
    );
    return new Response(new Blob([toArrayBuffer(archive)], { type: 'application/zip' }), {
      headers: {
        ...commonHeaders,
        'content-type': 'application/zip',
        'content-disposition': contentDisposition(`${base}.zip`),
      },
    });
  }

  return new Response(new Blob([toArrayBuffer(audio)], { type: 'audio/mpeg' }), {
    headers: {
      ...commonHeaders,
      'content-type': 'audio/mpeg',
      'content-disposition': contentDisposition(`${base}.mp3`),
    },
  });
}
