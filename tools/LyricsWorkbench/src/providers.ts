import { matchLyrics } from './match';
import type { Artist, LyricCandidate, Track, TrackPage } from './types';

export class UpstreamError extends Error {
  constructor(message: string, readonly retryAt?: number) { super(message); }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const cancel = () => { clearTimeout(timer); reject(signal?.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
  signal?.addEventListener('abort', cancel, { once: true });
});
const defaultClock = { now: Date.now, sleep, random: Math.random };

export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private available = 0;
  constructor(private spacing: number, private from: 'start' | 'end', private clock = defaultClock) {}

  json(request: (signal: AbortSignal) => Promise<Response>, signal?: AbortSignal): Promise<unknown> {
    const execute = async () => {
      for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        const delay = this.available - this.clock.now();
        if (delay > 12_000) throw new UpstreamError('数据源限流，请稍后再试。', this.available);
        if (delay > 0) await this.clock.sleep(delay, signal);
        signal?.throwIfAborted();
        const started = this.clock.now();
        const timeout = AbortSignal.timeout(12_000);
        try {
          const response = await request(signal ? AbortSignal.any([signal, timeout]) : timeout);
          if (response.status === 429 || response.status === 503) {
            const header = response.headers.get('Retry-After');
            const wait = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - this.clock.now() : 2000;
            const base = Number.isFinite(wait) ? Math.max(1000, wait) : 2000;
            this.available = this.clock.now() + base + Math.ceil(base * 0.2 * this.clock.random());
            await response.body?.cancel();
            if (!attempt && base <= 10_000) continue;
            throw new UpstreamError('数据源繁忙或限流，请稍后再试。', this.available);
          }
          if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
            await response.body?.cancel();
            throw new UpstreamError(`数据源返回异常响应（HTTP ${response.status}）。`);
          }
          try { return await response.json(); }
          catch { throw new UpstreamError('数据源返回了无法解析的数据。'); }
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof UpstreamError) throw error;
          throw new UpstreamError(timeout.aborted ? '请求数据源超时。' : '无法连接数据源，请检查网络。');
        } finally {
          this.available = Math.max(this.available, (this.from === 'start' ? started : this.clock.now()) + this.spacing);
        }
      }
    };
    const job = this.tail.then(execute);
    this.tail = job.catch(() => undefined);
    return job;
  }
}

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value !== null && typeof value === 'object' ? value as Row : {};
const string = (value: unknown, max = 1024) => typeof value === 'string' ? value.slice(0, max) : '';
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const rows = (input: unknown, field: string): Row[] => {
  if (!Array.isArray(input)) throw new UpstreamError(`数据源缺少预期的 ${field} 列表。`);
  return input.map(object);
};
export const isMbid = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const agent = 'TinytuneLyricsWorkbench/0.1.0 (https://github.com/colinSnake/tiny-tune)';

export class MusicSources {
  private mb: RequestQueue;
  private lrc: RequestQueue;

  constructor(private request: typeof fetch = fetch, spacing = 1000) {
    this.mb = new RequestQueue(spacing, 'start');
    this.lrc = new RequestQueue(spacing, 'end');
  }

  private query(source: 'catalog' | 'lyrics', path: string, params: Record<string, string>, signal?: AbortSignal) {
    const url = new URL(path, source === 'catalog' ? 'https://musicbrainz.org' : 'https://lrclib.net');
    url.search = new URLSearchParams(params).toString();
    const headers: Record<string, string> = { 'User-Agent': agent, Accept: 'application/json' };
    const key = source === 'lyrics' ? process.env.LRCLIB_API_KEY : undefined;
    if (key) headers['Lrclib-Api-Key'] = key;
    return (source === 'catalog' ? this.mb : this.lrc).json(abort =>
      this.request(url, { signal: abort, headers, redirect: 'error', cache: 'no-store' }), signal);
  }

  async artists(name: string, signal?: AbortSignal): Promise<Artist[]> {
    const quoted = name.replace(/[\\"]/g, '\\$&');
    const data = object(await this.query('catalog', '/ws/2/artist', {
      query: `artist:"${quoted}" OR alias:"${quoted}"`, fmt: 'json', limit: '20',
    }, signal));
    return rows(data.artists, 'artists').map(row => ({
      id: string(row.id), name: string(row.name), hint: string(row.disambiguation),
      area: string(object(row.area).name) || string(row.country),
      aliases: [...new Set((Array.isArray(row.aliases) ? row.aliases : []).map(alias => string(object(alias).name)).filter(Boolean))],
    })).map(artist => {
      if (!artist.id || !artist.name) throw new UpstreamError('数据源返回了无效的歌手记录。');
      return artist;
    });
  }

  async artist(id: string, signal?: AbortSignal): Promise<Artist> {
    const row = object(await this.query('catalog', `/ws/2/artist/${encodeURIComponent(id)}`, { fmt: 'json' }, signal));
    const name = string(row.name);
    if (!name) throw new UpstreamError('找不到该歌手的署名。');
    return { id, name, hint: string(row.disambiguation), area: string(object(row.area).name) || string(row.country), aliases: [] };
  }

  async recordings(id: string, offset: number, limit: number, signal?: AbortSignal): Promise<TrackPage> {
    const data = object(await this.query('catalog', '/ws/2/recording', {
      artist: id, offset: String(offset), limit: String(limit), fmt: 'json', inc: 'artist-credits',
    }, signal));
    const results = rows(data.recordings, 'recordings');
    const tracks = new Map<string, Track>();
    for (const row of results) {
      const id = string(row.id), title = string(row.title), length = positive(row.length);
      if (!id || !title) throw new UpstreamError('数据源返回了无效的曲目记录。');
      if (tracks.has(id)) continue;
      const credit = Array.isArray(row['artist-credit']) ? row['artist-credit'] : [];
      const artist = credit.map(x => (string(object(x).name) || string(object(object(x).artist).name)) + string(object(x).joinphrase)).join('');
      const releases = Array.isArray(row.releases) ? row.releases : [];
      const albums = [...new Set(releases.map(x => string(object(x).title)).filter(Boolean))].slice(0, 24);
      tracks.set(id, { id, title, artist, albums, duration: length === null ? null : length / 1000 });
    }
    const total = data['recording-count'];
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || total < results.length) {
      throw new UpstreamError('数据源返回了无效的曲目计数。');
    }
    const consumed = offset + results.length;
    return { tracks: [...tracks.values()], next: results.length && consumed < total ? consumed : null, total };
  }

  async collect(track: Track, signal?: AbortSignal) {
    // MusicBrainz accepts `releases` on recording lookup, but not on recording browse.
    let full = track;
    if (!track.albums.length) {
      const row = object(await this.query('catalog', `/ws/2/recording/${encodeURIComponent(track.id)}`, { fmt: 'json', inc: 'releases' }, signal));
      if (row.id !== track.id) throw new UpstreamError('无法核对曲目的专辑信息。');
      const releases = Array.isArray(row.releases) ? row.releases : [];
      full = { ...track, albums: [...new Set(releases.map(x => string(object(x).title)).filter(Boolean))].slice(0, 24) };
    }
    return { track: full, result: await this.lyrics(full, signal) };
  }

  async lyrics(track: Track, signal?: AbortSignal) {
    const data = await this.query('lyrics', '/api/search', { track_name: track.title, artist_name: track.artist }, signal);
    const candidates: LyricCandidate[] = [];
    for (const row of rows(data, 'lyrics').slice(0, 20)) {
      const id = positive(row.id);
      const title = string(row.trackName) || string(row.name);
      const artist = string(row.artistName);
      const synced = string(row.syncedLyrics, 1_048_576);
      const plain = string(row.plainLyrics, 1_048_576);
      if (id === null || !title || !artist) throw new UpstreamError('数据源返回了无效的歌词记录。');
      candidates.push({ id, title, artist, album: string(row.albumName), duration: positive(row.duration),
        instrumental: row.instrumental === true, synced, plain });
    }
    return matchLyrics(track, candidates);
  }
}
