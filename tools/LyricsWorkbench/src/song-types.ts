export const songProviders = ['artist', 'bilibili', 'bilibili-video', 'jamendo', 'lrclib'] as const;
export type SongProvider = typeof songProviders[number];
export const songProviderLabels: Record<SongProvider, string> = { artist: '作者曲库', bilibili: 'B 站授权曲库', 'bilibili-video': 'B 站搜索', jamendo: 'Jamendo', lrclib: 'LRCLIB' };
export type SongAvailability = 'ready' | 'audio-only' | 'stream-only' | 'missing-lyrics' | 'review' | 'lyrics-only';
export type SongSummary = {
  provider: SongProvider; id: string; title: string; artist: string; album: string; duration: number;
  availability: SongAvailability;
  /** Catalog-scoped ID of the verified release, not a video collection or a display label. */
  releaseId?: string;
  aliases?: { titles?: readonly string[]; artists?: readonly string[] };
};
export type SongDetail = SongSummary & {
  sourceUrl: string; licenseUrl: string | null; previewUrl: string | null;
  rightsUrl?: string; lyricSourceUrl?: string; credits?: string; bilibiliVideoId?: string; bilibiliPage?: number; downloadNote?: string;
  /** Unambiguous credits read from the source post, never a search query or uploader name. */
  lyricIdentity?: { title: string; artist: string };
  lyrics: { kind: 'timed' | 'plain'; text: string } | null;
};
export type SongCatalogStatus = { configured: boolean; bundlesEnabled: boolean; featured?: boolean; sources?: SongProvider[] };

export const normalizeSearch = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const compact = (track: Pick<SongSummary, 'title' | 'artist'>) => [normalizeSearch(track.title), normalizeSearch(track.artist)];

export function songMatchScore(track: Pick<SongSummary, 'title' | 'artist' | 'aliases'>, query: string) {
  const needle = normalizeSearch(query);
  if (!needle) return 0;
  const titles = [track.title, ...(track.aliases?.titles ?? [])].map(normalizeSearch);
  const artists = [track.artist, ...(track.aliases?.artists ?? [])].map(normalizeSearch);
  const combined = titles.flatMap(title => artists.flatMap(artist => [title + artist, artist + title]));
  if (combined.includes(needle)) return 4;
  if (titles.includes(needle)) return 3;
  if (artists.includes(needle)) return 2;
  const terms = query.trim().split(/\s+/u).map(normalizeSearch).filter(Boolean);
  return combined.some(credit => credit.includes(needle) || terms.length > 1 && terms.every(term => credit.includes(term))) ? 1 : 0;
}

const priority: Record<SongAvailability, number> = { ready: 0, 'audio-only': 1, 'missing-lyrics': 2, 'lyrics-only': 4, 'stream-only': 5, review: 6 };
export function rankSongs(tracks: readonly SongSummary[], query: string) {
  const position = (track: SongSummary) => track.provider === 'bilibili-video' && (track.availability === 'stream-only' || track.availability === 'review') ? 3 : priority[track.availability];
  return [...tracks].sort((a, b) => position(a) - position(b) || songMatchScore(b, query) - songMatchScore(a, query));
}

export function pickAutomaticSong(tracks: readonly SongSummary[], query: string) {
  const exact = tracks.filter(track => songMatchScore(track, query) >= 3);
  if (exact.some(track => track.provider === 'bilibili-video')) return undefined;
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
