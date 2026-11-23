export const songProviders = ['artist', 'jamendo', 'lrclib'] as const;
export type SongProvider = typeof songProviders[number];
export const songProviderLabels: Record<SongProvider, string> = { artist: '作者曲库', jamendo: 'Jamendo', lrclib: 'LRCLIB' };
export type SongAvailability = 'ready' | 'stream-only' | 'missing-lyrics' | 'review' | 'lyrics-only';
export type SongSummary = {
  provider: SongProvider; id: string; title: string; artist: string; album: string; duration: number;
  availability: SongAvailability;
};
export type SongDetail = SongSummary & {
  sourceUrl: string; licenseUrl: string | null; previewUrl: string | null;
  rightsUrl?: string; lyricSourceUrl?: string;
  lyrics: { kind: 'timed' | 'plain'; text: string } | null;
};
export type SongCatalogStatus = { configured: boolean; bundlesEnabled: boolean; featured?: boolean; sources?: SongProvider[] };

export const normalizeSearch = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const compact = (track: Pick<SongSummary, 'title' | 'artist'>) => [normalizeSearch(track.title), normalizeSearch(track.artist)];

export function songMatchScore(track: Pick<SongSummary, 'title' | 'artist'>, query: string) {
  const needle = normalizeSearch(query);
  if (!needle) return 0;
  const [title, artist] = compact(track);
  if (needle === title + artist || needle === artist + title) return 4;
  if (needle === title) return 3;
  if (needle === artist) return 2;
  return (title + artist).includes(needle) || (artist + title).includes(needle) ? 1 : 0;
}

const priority: Record<SongAvailability, number> = { ready: 0, 'missing-lyrics': 1, 'lyrics-only': 2, 'stream-only': 3, review: 4 };
export function rankSongs(tracks: readonly SongSummary[], query: string) {
  return [...tracks].sort((a, b) => priority[a.availability] - priority[b.availability] || songMatchScore(b, query) - songMatchScore(a, query));
}

export function pickAutomaticSong(tracks: readonly SongSummary[], query: string) {
  const exact = tracks.filter(track => songMatchScore(track, query) >= 3);
  if (exact.length === 1) return exact[0];
  const recordings = exact.filter(track => track.availability !== 'lyrics-only');
  if (recordings.length !== 1) return undefined;
  const [recording] = recordings;
  const album = normalizeSearch(recording.album);
  const [title, artist] = compact(recording);
  // A parallel lyric listing for the same named release is not another playable recording.
  // This only decides what to open, never which lyrics may be bound to the audio or ZIP.
  return album && exact.every(track => track === recording || (normalizeSearch(track.title) === title && normalizeSearch(track.artist) === artist &&
    normalizeSearch(track.album) === album && Math.abs(track.duration - recording.duration) <= 2)) ? recording : undefined;
}
