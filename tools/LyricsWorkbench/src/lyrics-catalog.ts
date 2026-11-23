import type { MusicSources } from './providers';
import { normalizeSearch, rankSongs, songMatchScore, type SongDetail, type SongSummary } from './song-types';
import { isSongId, parseLyrics, SongError, type SongCatalog, type SongRecord } from './songs';
import type { LyricCandidate } from './types';

const ttl = 2 * 60_000;
const maxEntries = 48;
const sourceUrl = 'https://lrclib.net/';

function preview(candidate: LyricCandidate): SongDetail | undefined {
  const { title, artist, album, duration } = candidate;
  const id = String(candidate.id);
  if (!isSongId(id) || candidate.instrumental || duration === null) return;
  const timed = parseLyrics(candidate.synced, duration).lyrics;
  const lyrics = timed?.kind === 'timed' ? timed : parseLyrics(candidate.plain, duration).lyrics ?? timed;
  if (!lyrics) return;
  return { provider: 'lrclib', id, title, artist, album, duration, availability: 'lyrics-only', previewUrl: null,
    sourceUrl, lyricSourceUrl: sourceUrl, licenseUrl: null, lyrics };
}

export class LyricsCatalog implements SongCatalog {
  private cache = new Map<string, { until: number; tracks: SongSummary[] }>();
  private active = 0;
  constructor(private readonly source: Pick<MusicSources, 'searchLyrics' | 'lyricRecord'>) {}

  status() { return { configured: true, bundlesEnabled: false }; }

  private async query<T>(run: () => Promise<T>) {
    if (this.active >= 8) throw new SongError('歌词查询队列暂满，请稍后重试。', 429, Date.now() + 2000);
    this.active++;
    try { return await run(); }
    finally { this.active--; }
  }

  async search(query: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const key = query.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.tracks;
    this.cache.delete(key);
    const candidates = await this.query(() => this.source.searchLyrics(query, signal));
    signal.throwIfAborted();
    const found = new Map<string, SongSummary>();
    const duplicates = new Set<string>();
    for (const candidate of candidates) {
      const result = preview(candidate);
      if (!result?.lyrics || !songMatchScore(result, query) || found.has(result.id)) continue;
      const { provider, id, title, artist, album, duration, availability } = result;
      // Drop identical supplier duplicates, not near matches with different lyrics, timing or release labels.
      const key = JSON.stringify([normalizeSearch(title), normalizeSearch(artist), normalizeSearch(album), duration, result.lyrics]);
      if (duplicates.has(key)) continue;
      duplicates.add(key);
      found.set(id, { provider, id, title, artist, album, duration, availability });
    }
    const tracks = rankSongs([...found.values()], query);
    this.cache.set(key, { until: Date.now() + ttl, tracks });
    const oldest = this.cache.size > maxEntries ? this.cache.keys().next().value : undefined;
    if (oldest !== undefined) this.cache.delete(oldest);
    return tracks;
  }

  async detail(id: string, signal: AbortSignal): Promise<SongRecord> {
    const candidate = await this.query(() => this.source.lyricRecord(id, signal));
    signal.throwIfAborted();
    const track = preview(candidate);
    if (!track || track.id !== id) throw new SongError('没有这版可显示的歌词。', 404);
    return { track, downloadUrl: null };
  }

  async audio(): Promise<Buffer> {
    throw new SongError('歌词来源不提供可下载的音频。', 409);
  }
}
