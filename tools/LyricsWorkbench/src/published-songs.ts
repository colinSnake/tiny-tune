import { readBounded } from './response-body';
import { normalizeSearch, readCompleteAudio, sha256, SongError, songRetryAt, songUserAgent, type SongCatalog, type SongRecord } from './songs';
import type { SongSummary } from './song-types';

type PublishedTrack = Omit<SongSummary, 'provider' | 'availability'> & {
  sourceUrl: string; rightsUrl: string; licenseUrl: string; lyricSourceUrl: string;
  audioUrl: string; lyricsUrl: string; audioHash: string; lyricHash: string;
};

// Original recording on the songwriter's site. The FAQ grants CC BY-NC for his own music and explicitly permits sharing.
// Pin the verified recording and transcription separately; an upstream replacement must be reviewed, not silently repackaged.
const codeMonkey: PublishedTrack = {
  id: '9172651910', title: 'Code Monkey', artist: 'Jonathan Coulton', album: 'Thing a Week Three', duration: 189.31,
  sourceUrl: 'https://www.jonathancoulton.com/2006/04/14/thing-a-week-29-code-monkey/',
  rightsUrl: 'https://www.jonathancoulton.com/faq/#can-i-use-a-song-in-my-student-filmpodcastawesome-dance-remix',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc/3.0/',
  lyricSourceUrl: 'https://joco.wiki.gg/wiki/Code_Monkey/Lyrics?oldid=5403',
  audioUrl: 'https://www.jonathancoulton.com/wp-content/uploads/encodes/Thing_a_Week_Three/mp3/03_Code_Monkey_mp3_118604e.mp3',
  lyricsUrl: 'https://joco.wiki.gg/api.php?action=query&prop=revisions&revids=5403&rvprop=content&rvslots=main&format=json&formatversion=2',
  audioHash: '3866a8aa2fba54bdc278e8b55b278d73f51c6cf0ad06bf1e9835c409c824d586',
  lyricHash: '051a4a2d1a053fad10b9accde8934ea3f992d04e2fc136ba6d630914a252d92a',
};

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
  constructor(private readonly entry: PublishedTrack = codeMonkey, private readonly request: typeof fetch = fetch) {}

  status() { return { configured: true, bundlesEnabled: true, featured: true }; }

  private summary(): SongSummary {
    const { id, title, artist, album, duration } = this.entry;
    return { id, title, artist, album, duration, provider: 'artist', availability: 'ready' };
  }

  async search(query: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const needle = normalizeSearch(query);
    const { title, artist } = this.entry;
    return needle && [`${title} ${artist}`, `${artist} ${title}`].some(value => normalizeSearch(value).includes(needle)) ? [this.summary()] : [];
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
    if (id !== this.entry.id) throw new SongError('这版录音不存在。', 404);
    const { audioUrl, sourceUrl, licenseUrl, rightsUrl, lyricSourceUrl, lyricsUrl, lyricHash } = this.entry;
    const response = await this.get(lyricsUrl, signal, 'application/json');
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new SongError('没有从作者曲库获取到这版歌词，请稍后重试。', 502);
    }
    let content: string;
    try { content = extractRevision(await readBounded(response, 48 * 1024, signal)); }
    catch {
      signal.throwIfAborted();
      throw new SongError('歌词来源没有返回已核对的版本。', 502);
    }
    const text = /<lyrics>([\s\S]+?)<\/lyrics>/.exec(content)?.[1].replace(/\r\n?/g, '\n').trim();
    if (sha256(content) !== lyricHash || !text) throw new SongError('歌词来源已变更，需要重新确认版本后才能打包。', 409);
    return { track: { ...this.summary(), previewUrl: audioUrl, sourceUrl, licenseUrl, rightsUrl, lyricSourceUrl,
      lyrics: { kind: 'plain', text } }, downloadUrl: new URL(audioUrl) };
  }

  async audio({ track }: SongRecord, signal: AbortSignal) {
    const response = await this.get(this.entry.audioUrl, signal, 'audio/mpeg, application/octet-stream');
    const audio = await readCompleteAudio(response, track, signal);
    if (sha256(audio) !== this.entry.audioHash) throw new SongError('来源音频已变更，需要重新核对整曲版本。', 502);
    return audio;
  }
}
