export type MusicSourceId = 'gequhai' | 'gequke' | 'netease';

export interface MusicTrack {
  source: MusicSourceId;
  sourceLabel: string;
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  cover?: string;
}

export interface SourceAttempt {
  source: MusicSourceId;
  label: string;
  status: 'found' | 'empty' | 'error';
  count: number;
  message?: string;
}

export interface MusicSearchResult {
  query: string;
  source: MusicSourceId | null;
  sourceLabel: string | null;
  results: MusicTrack[];
  attempts: SourceAttempt[];
}

export interface ResolvedTrack {
  url: string;
  title: string;
  artist: string;
  cover?: string;
  lyrics?: string;
}

export interface DownloadInput {
  source: MusicSourceId;
  id: string;
  title?: string;
  artist?: string;
  includeLyrics?: boolean;
}
