import { downloadMusic, searchMusic } from '@/lib/music';
import { signMusicToken, verifyMusicToken } from '@/lib/music/token';
import { ActionError, type ActionHandler } from '../types';

const search: ActionHandler = async (input) => {
  const query = String(input.query ?? '');
  const limit = Number(input.limit ?? 12);
  const result = await searchMusic(query, limit);

  return {
    query: result.query,
    count: result.results.length,
    results: result.results.map((track) => ({
      token: signMusicToken(track.source, track.id),
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      cover: track.cover,
    })),
  };
};

const download: ActionHandler = async (input) => {
  const resolved = verifyMusicToken(String(input.token ?? ''));
  if (!resolved) {
    throw new ActionError('MUSIC_RESULT_EXPIRED', 400, '搜索结果已过期，请重新搜索。');
  }

  try {
    return await downloadMusic({
      source: resolved.source,
      id: resolved.id,
      title: typeof input.title === 'string' ? input.title : undefined,
      artist: typeof input.artist === 'string' ? input.artist : undefined,
      includeLyrics: input.includeLyrics !== false,
    });
  } catch (error) {
    console.error('[music] download failed', error);
    throw new ActionError('MUSIC_DOWNLOAD_FAILED', 502, '这首歌暂时下载不了，换一首试试。');
  }
};

export const actions: Record<string, ActionHandler> = { search, download };
