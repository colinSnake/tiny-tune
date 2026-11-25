import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { BodyTooLarge, readBounded } from './response-body';
import { SongArchivePaths, songStem } from './song-archive';
import { parseLrc } from './lrc';
import { defaultLyricScript, formatLyricText, type LyricScript } from './lyric-script';
import { RequestQueue, UpstreamError } from './providers';
import { mp3Duration } from './song-mp3';
import { normalizeSearch, type SongAvailability, type SongCatalogStatus, type SongDetail, type SongSummary } from './song-types';

export { normalizeSearch } from './song-types';

const maxBytes = 32 * 1024 * 1024;
const maxLyrics = 48 * 1024;
export const songUserAgent = 'TinytuneLyricsWorkbench/0.1.0 (https://github.com/colinSnake/tiny-tune)';
export const isSongId = (id: string) => /^[1-9]\d{0,11}$/.test(id);

export class SongError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt?: number) { super(message); }
}

export const songAvailability: Record<SongAvailability, string> = {
  ready: '可下载整曲与歌词',
  'audio-only': '这版只有音频，可单独下载 MP3。',
  'stream-only': '这版录音没有允许下载的完整音频。',
  'missing-lyrics': '这版录音没有可用的同版本歌词。',
  review: '这版录音的打包授权、音频来源或歌词时码尚未核对。',
  'lyrics-only': '这是歌词资料，未关联可下载的同版本音频。',
};

export type SongRecord = { track: SongDetail; downloadUrl: URL | null };
export interface SongCatalog {
  status(): SongCatalogStatus;
  search(query: string, signal: AbortSignal): Promise<SongSummary[]>;
  detail(id: string, signal: AbortSignal): Promise<SongRecord>;
  audio(record: SongRecord, signal: AbortSignal): Promise<Buffer>;
}

type JamendoOptions = { clientId?: string; allowBundles?: boolean; approvedTrackHashes?: Record<string, string>; fetcher?: typeof fetch; spacing?: number };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const label = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 220) : '';

function trustedMediaUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const host = url.hostname;
    const trusted = host === 'storage.jamendo.com' || host === 'stream.jamendo.com' || host === 'mp3d.jamendo.com' ||
      /^[a-z0-9-]+\.storage\.jamendo\.com$/.test(host);
    return trusted && url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash ? url : null;
  } catch { return null; }
}

function licenseUrl(value: unknown) {
  if (typeof value !== 'string' || !/^https?:\/\/creativecommons\.org\/(?:licenses\/(?:by|by-sa|by-nc|by-nc-sa|by-nd|by-nc-nd)|publicdomain\/zero)\/[\d.]+(?:\/[a-z]{2})?\/?$/i.test(value)) return null;
  return value.replace(/^http:/i, 'https:');
}

export function parseLyrics(value: unknown, duration: number): { lyrics: SongDetail['lyrics']; conflict: boolean } {
  if (typeof value !== 'string' || value.length > maxLyrics) return { lyrics: null, conflict: false };
  const text = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text || /<\/?(?:html|body|script|div|p|br)\b/i.test(text)) return { lyrics: null, conflict: false };
  const { cues, plain } = parseLrc(text);
  const hasTiming = /^\s*\[\d{1,6}:\d{1,2}/m.test(text);
  const conflict = hasTiming && !cues.length || cues.some(cue => cue.ms > (duration + 0.5) * 1000);
  return { lyrics: conflict ? null : cues.length ? { kind: 'timed', text } : plain ? { kind: 'plain', text: plain } : null, conflict };
}

export function songRetryAt(response: Response) {
  const header = response.headers.get('retry-after')?.trim();
  const wait = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 2000;
  return Date.now() + (Number.isFinite(wait) ? Math.max(1000, wait) : 2000);
}

export class JamendoCatalog implements SongCatalog {
  private readonly fetcher: typeof fetch;
  private readonly queue: RequestQueue;
  private readonly approved: Map<string, string>;
  private readonly clientId: string;
  private mediaCooldown: SongError | undefined;
  private metadataCooldown: UpstreamError | undefined;
  private pendingQueries = 0;
  constructor(private readonly options: JamendoOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.queue = new RequestQueue(options.spacing ?? 1000, 'start');
    this.approved = new Map(Object.entries(options.approvedTrackHashes ?? {}).filter(([id, hash]) => isSongId(id) && /^[0-9a-f]{64}$/.test(hash)));
    this.clientId = options.clientId?.trim() ?? '';
  }

  status() { return { configured: !!this.clientId, bundlesEnabled: !!this.clientId && this.options.allowBundles === true && this.approved.size > 0 }; }

  private async query(params: Record<string, string>, signal: AbortSignal): Promise<unknown[]> {
    if (!this.clientId) throw new SongError('在线曲库尚未配置，请先在服务端设置 JAMENDO_CLIENT_ID。', 503);
    const url = new URL('https://api.jamendo.com/v3.0/tracks/');
    url.search = new URLSearchParams({ client_id: this.clientId, format: 'json', type: 'albumtrack+single',
      include: 'lyrics', audioformat: 'mp31', audiodlformat: 'mp32', ...params }).toString();
    if (this.pendingQueries >= 8) throw new SongError('曲库查询较多，请稍后再试。', 429, Date.now() + 3000);
    this.pendingQueries++;
    try {
      let response: Response | undefined;
      const data = object(await this.queue.json(async abort => {
        if (this.metadataCooldown?.retryAt && this.metadataCooldown.retryAt > Date.now()) throw this.metadataCooldown;
        response = await this.fetcher(url, { signal: abort, redirect: 'error', cache: 'no-store',
          headers: { 'User-Agent': songUserAgent, Accept: 'application/json' } });
        return response;
      }, signal, 2 * 1024 * 1024));
      const headers = object(data.headers);
      if (headers.code === 6) {
        // Jamendo can return a quota error inside a successful HTTP response.
        this.metadataCooldown = new UpstreamError('Jamendo 曲库限流，请稍后再试。',
          response?.headers.has('Retry-After') ? songRetryAt(response) : Date.now() + 10_000, 429);
        throw this.metadataCooldown;
      }
      if (!['success', 'succeed'].includes(String(headers.status)) || headers.code !== 0 || !Array.isArray(data.results)) {
        throw new SongError('Jamendo 曲库请求失败。请检查服务端配置或稍后重试。', 502);
      }
      return data.results.slice(0, 30);
    } finally { this.pendingQueries--; }
  }

  private record(input: unknown): SongRecord | null {
    const row = object(input);
    const { id, duration } = row;
    const title = label(row.name), artist = label(row.artist_name);
    if (typeof id !== 'string' || !isSongId(id) || !title || !artist || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null;
    const license = licenseUrl(row.license_ccurl);
    const downloadUrl = trustedMediaUrl(row.audiodownload);
    const previewUrl = trustedMediaUrl(row.audio)?.href ?? null;
    const { lyrics, conflict } = parseLyrics(row.lyrics, duration);
    const availability: SongAvailability = row.audiodownload_allowed !== true || !row.audiodownload ? 'stream-only'
      : conflict ? 'review' : !lyrics ? 'missing-lyrics'
        : !downloadUrl || !license || !this.options.allowBundles || !this.approved.has(id) ? 'review' : 'ready';
    const albumId = String(row.album_id ?? '');
    const releaseId = isSongId(albumId) ? albumId : undefined;
    return { track: { provider: 'jamendo', id, title, artist, album: label(row.album_name), releaseId, duration, previewUrl, lyrics,
      sourceUrl: `https://www.jamendo.com/track/${id}`, licenseUrl: license, availability }, downloadUrl };
  }

  async search(query: string, signal: AbortSignal) {
    const raw = await this.query({ search: query, order: 'relevance', limit: '30' }, signal);
    const needle = normalizeSearch(query);
    const tracks = new Map<string, SongSummary>();
    for (const input of raw) {
      const track = this.record(input)?.track;
      if (!track || !needle || ![track.title, track.artist, `${track.title} ${track.artist}`, `${track.artist} ${track.title}`]
        .some(text => normalizeSearch(text).includes(needle))) continue;
      const { provider, id, title, artist, album, releaseId, duration, availability } = track;
      if (!tracks.has(id)) tracks.set(id, { provider, id, title, artist, album, releaseId, duration, availability });
    }
    return [...tracks.values()];
  }

  async detail(id: string, signal: AbortSignal) {
    const rows = await this.query({ id, limit: '1' }, signal);
    const record = this.record(rows[0]);
    if (!record || record.track.id !== id) throw new SongError('这版录音已不存在或暂时无法核对。', 404);
    return record;
  }

  async audio(record: SongRecord, signal: AbortSignal) {
    const cooldown = this.mediaCooldown;
    if (cooldown?.retryAt && cooldown.retryAt > Date.now()) throw cooldown;
    try {
      const audio = await this.fetchAudio(record, signal);
      if (sha256(audio) !== this.approved.get(record.track.id)) {
        throw new SongError('下载到的音频与已核对的整曲不一致，没有生成下载包。', 502);
      }
      return audio;
    } catch (error) {
      if (error instanceof SongError && error.retryAt) this.mediaCooldown = error;
      throw error;
    }
  }

  private async fetchAudio(record: SongRecord, signal: AbortSignal) {
    let url = record.downloadUrl;
    for (let hop = 0; hop < 5 && url; hop++) {
      signal.throwIfAborted();
      const response = await this.fetcher(url, { signal, redirect: 'manual', cache: 'no-store',
        headers: { 'User-Agent': songUserAgent, Accept: 'audio/mpeg, application/octet-stream', 'Accept-Encoding': 'identity' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        try { url = location ? trustedMediaUrl(new URL(location, url).href) : null; }
        catch { url = null; }
        if (!url) throw new SongError('完整音频跳转到了未验证的来源。', 502);
        continue;
      }
      if (response.status === 429 || response.status === 503) {
        await response.body?.cancel();
        throw new SongError(response.status === 429 ? '音频来源限流，请稍后再试。' : '音频来源暂时不可用。', response.status, songRetryAt(response));
      }
      return readCompleteAudio(response, record.track, signal);
    }
    throw new SongError('无法从已验证的来源获取完整音频。', 502);
  }
}

export const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export async function readCompleteAudio(response: Response, track: Pick<SongDetail, 'duration' | 'lyrics'>, signal: AbortSignal) {
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const length = response.headers.get('content-length');
  const expected = length === null ? null : Number(length);
  if (response.status !== 200 || !response.body || response.headers.has('content-range') ||
    !['audio/mpeg', 'audio/mp3', 'audio/x-mpeg', 'application/octet-stream'].includes(mime ?? '') ||
    (expected !== null && (!/^\d+$/.test(length!) || !Number.isSafeInteger(expected) || expected <= 0))) {
    await response.body?.cancel();
    throw new SongError('来源没有返回完整的 MP3 音频。', 502);
  }
  if (expected !== null && expected > maxBytes) {
    await response.body.cancel();
    throw new SongError('整曲体积超过 32 MB，无法打包。', 413);
  }
  const audio = await readBounded(response, maxBytes, signal).catch(error => {
    if (error instanceof BodyTooLarge) throw new SongError('整曲体积超过 32 MB，无法打包。', 413);
    throw error;
  });
  if (expected !== null && expected !== audio.length) throw new SongError('音频在传输途中中断，没有生成下载包。', 502);
  const actual = mp3Duration(audio);
  const tolerance = Math.min(3, Math.max(1, track.duration * 0.005));
  if (actual === null || Math.abs(actual - track.duration) > tolerance) {
    throw new SongError('获取到的音频损坏，或与这版录音的整曲时长不符。', 502);
  }
  if (track.lyrics?.kind === 'timed' && parseLrc(track.lyrics.text).cues.some(cue => cue.ms > (actual + 0.25) * 1000)) {
    throw new SongError('歌词时码超过实际音频长度，未生成下载包。', 409);
  }
  return audio;
}

export async function songZip(catalog: SongCatalog, id: string, signal: AbortSignal, lyricScript: LyricScript = defaultLyricScript) {
  const record = await catalog.detail(id, signal);
  const { track } = record;
  if (track.availability !== 'ready' || !track.lyrics) throw new SongError(songAvailability[track.availability], 409);
  const audio = await catalog.audio(record, signal);
  signal.throwIfAborted();
  const stem = songStem(track);
  const { audio: mp3, lyrics: lrc } = new SongArchivePaths().add(track, stem);
  const zip = new JSZip();
  zip.file(mp3, audio);
  zip.file(lrc, `${formatLyricText(track.lyrics.text, lyricScript)}\n`);
  zip.file('manifest.json', JSON.stringify({ version: 2, title: track.title, artist: track.artist, album: track.album, releaseId: track.releaseId,
    duration: track.duration, source: { provider: track.provider, id, url: track.sourceUrl, license: track.licenseUrl, rights: track.rightsUrl, credits: track.credits },
    audio: { file: mp3, format: 'mp3' }, lyrics: { file: lrc, kind: track.lyrics.kind, source: track.lyricSourceUrl ?? track.sourceUrl } }, null, 2) + '\n');
  // JSZip's async progress callback cannot safely propagate a thrown abort. Finish bounded in-memory
  // generation, then discard the result on abort rather than letting an exception escape the worker.
  const body = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', streamFiles: true });
  signal.throwIfAborted();
  return { body, filename: `${stem}.zip` };
}

export function songSourceError(error: unknown) {
  if (error instanceof SongError) return error;
  if (error instanceof UpstreamError) return new SongError(error.message, error.status ?? 502, error.retryAt);
  return new SongError('音频或曲库连接中断，请检查网络后重试。', 502);
}
