import { readBounded } from './response-body';
import { isSongId, parseLyrics, readCompleteAudio, sha256, SongError, songRetryAt, songUserAgent, type SongCatalog, type SongRecord } from './songs';
import { songMatchScore, type SongSummary } from './song-types';
import { publishedTracks, type PublishedTrack } from './published-releases';

type WikiRevision = { slots?: { main?: { content?: unknown } } };
type WikiResponse = { query?: { pages?: { revisions?: WikiRevision[] }[] } };
function extractRevision(bytes: Buffer) {
  const data = JSON.parse(bytes.toString('utf8')) as WikiResponse | null;
  const revision = data?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content;
  if (typeof revision !== 'string') throw new Error('Missing revision');
  return revision;
}

export class PublishedCatalog implements SongCatalog {
  private cooldown: SongError | undefined;
  private readonly entries: ReadonlyMap<string, PublishedTrack>;
  constructor(entries: readonly PublishedTrack[] = publishedTracks, private readonly request: typeof fetch = fetch) {
    this.entries = new Map(entries.map(entry => [entry.id, entry]));
    if (this.entries.size !== entries.length || entries.some(entry => !isSongId(entry.id))) {
      throw new Error('Invalid or duplicate published recording IDs');
    }
  }

  status() { return { configured: this.entries.size > 0, bundlesEnabled: this.entries.size > 0 }; }

  private summary(entry: PublishedTrack): SongSummary {
    const { id, title, artist, album, releaseId, duration, aliases } = entry;
    return { id, title, artist, album, releaseId, duration, aliases, provider: 'artist', availability: 'ready' };
  }

  async search(query: string, signal: AbortSignal) {
    signal.throwIfAborted();
    return [...this.entries.values()].filter(entry => songMatchScore(entry, query) > 0).map(entry => this.summary(entry));
  }

  private entry(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new SongError('这版录音不存在。', 404);
    return entry;
  }

  private async get(url: string, signal: AbortSignal, accept: string) {
    if (this.cooldown?.retryAt && this.cooldown.retryAt > Date.now()) throw this.cooldown;
    // Configured compile-time URLs only. This adapter does not follow redirects.
    const response = await this.request(url, { signal, cache: 'no-store', redirect: 'error',
      headers: { 'User-Agent': songUserAgent, Accept: accept, 'Accept-Encoding': 'identity' } });
    if (response.status === 429 || response.status === 503) {
      await response.body?.cancel();
      this.cooldown = new SongError('作者曲库暂时忙，请稍后再试。', response.status, songRetryAt(response));
      throw this.cooldown;
    }
    return response;
  }

  async detail(id: string, signal: AbortSignal): Promise<SongRecord> {
    const entry = this.entry(id);
    const { audioUrl, sourceUrl, licenseUrl, rightsUrl, lyricSourceUrl, lyricsUrl, lyricHash, lyricsFormat } = entry;
    const response = await this.get(lyricsUrl, signal, lyricsFormat === 'text' ? 'text/plain' : 'application/json');
    if (response.status !== 200 || !response.body || (lyricsFormat === 'text' && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/plain')) {
      await response.body?.cancel();
      throw new SongError('没有从作者曲库获取到这版歌词，请稍后重试。', 502);
    }
    let content: string;
    let actualHash: string;
    try {
      const bytes = await readBounded(response, 48 * 1024, signal);
      content = lyricsFormat === 'text' ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : extractRevision(bytes);
      actualHash = sha256(lyricsFormat === 'text' ? bytes : content);
    } catch {
      signal.throwIfAborted();
      throw new SongError('歌词来源没有返回已核对的版本。', 502);
    }
    if (actualHash !== lyricHash) throw new SongError('歌词来源已变更，需要重新确认版本后才能打包。', 409);
    const text = (lyricsFormat === 'text' ? content : /<lyrics>([\s\S]+?)<\/lyrics>/.exec(content)?.[1] ?? '').replace(/\r\n?/g, '\n').trim();
    const { lyrics } = parseLyrics(text, entry.duration);
    if (!lyrics) throw new SongError('没有可打包的同版本歌词。', 409);
    return { track: { ...this.summary(entry), previewUrl: audioUrl, sourceUrl, licenseUrl, rightsUrl, lyricSourceUrl,
      lyrics: lyrics.kind === 'plain' ? { kind: 'plain', text } : lyrics }, downloadUrl: new URL(audioUrl) };
  }

  async audio({ track }: SongRecord, signal: AbortSignal) {
    const { audioUrl, audioHash } = this.entry(track.id);
    const response = await this.get(audioUrl, signal, 'audio/mpeg, application/octet-stream');
    const audio = await readCompleteAudio(response, track, signal);
    if (sha256(audio) !== audioHash) throw new SongError('来源音频已变更，需要重新核对整曲版本。', 502);
    return audio;
  }
}
