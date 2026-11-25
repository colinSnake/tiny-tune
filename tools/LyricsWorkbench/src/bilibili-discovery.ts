import { BilibiliMedia, bilibiliReleases } from './bilibili-songs';
import { RequestQueue } from './providers';
import { SongError, songUserAgent, type SongCatalog, type SongRecord } from './songs';
import { songMatchScore, type SongSummary } from './song-types';
import { readBounded } from './response-body';
import { bilibiliCoverUrl, tagSongMp3, type SongCover } from './song-metadata';
import { videoPostLyricIdentity, videoSongIdentity } from './video-lyrics';

const host = 'https://api.bilibili.com';
const bv = /^BV[0-9A-Za-z]{10}$/;
const idPattern = /^(BV[0-9A-Za-z]{10})-([1-9]\d{0,2})$/;
export const isBilibiliVideoId = (id: string) => idPattern.test(id);
const videoUrl = (bvid: string, page: number) => `https://www.bilibili.com/video/${bvid}/${page === 1 ? '' : `?p=${page}`}`;
const sections = new Set(['MV', '音乐现场', '音乐综合', '电台', '综艺']);
const unwanted = /翻唱|伴奏|\bcover\b|卡拉\s*ok|動態鼓譜|动态鼓谱|教程|教學/i;
const collectionTitle = /合[集輯]|歌[单單]|[精选選]集|\d+\s*首/;
const namedParts = /《[^》]+》.*《[^》]+》|分[集PＰ]/i;
const maxResults = 28;
const maxSongSeconds = 15 * 60;
const downloadingForbidden = /不(?:提供|支持|允许|允許|开放|開放)[^\n。！]{0,20}(?:下载|下載)|(?:禁止|拒绝|拒絕|谢绝|謝絕)[^\n。！]{0,16}(?:下载|下載)|仅供在线播放|僅供線上播放/i;

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {};
const str = (value: unknown) => typeof value === 'string' ? value : '';
const text = (value: unknown) => str(value).slice(0, 2048).replace(/<[^>]*>/g, '').replace(/&(amp|quot|apos|lt|gt|nbsp|#39);/g,
  (_, entity) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'" }[entity as string] ?? '')).trim().slice(0, 160);
const int = (value: unknown, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max ? value : 0;
const length = (value: unknown) => /^\d{1,4}(?::\d{1,2}){1,2}$/.test(str(value))
  ? str(value).split(':').reduce((secs, n) => secs * 60 + Number(n), 0) : 0;

type Approval = { cid: number; hash: string };
type Part = { cid: number; page: number; title: string; duration: number };
type Video = { bvid: string; title: string; uploader: string; parts: Part[]; exportEligible: boolean; coverUrl?: string };
type Hit = { bvid: string; title: string; uploader: string; category: string; duration: number; collection: boolean };

function audioApprovals(raw: string) {
  const approvals = new Map<string, Approval>();
  for (const item of raw.split(',')) {
    const match = /^(BV[0-9A-Za-z]{10}):([1-9]\d{0,2}):([1-9]\d{0,14}):([a-f0-9]{64})$/.exec(item.trim());
    if (match) approvals.set(`${match[1]}-${match[2]}`, { cid: Number(match[3]), hash: match[4] });
  }
  return approvals;
}

export class BilibiliDiscovery implements SongCatalog {
  private readonly approvals: ReadonlyMap<string, Approval>;
  private readonly approvedVideos: ReadonlySet<string>;
  private readonly queue: RequestQueue;
  private pausedUntil = 0;
  private readonly curated = new Set(bilibiliReleases.map(entry => entry.bvid));
  private readonly media: Pick<BilibiliMedia, 'available' | 'audio'>;
  private readonly request: typeof fetch;

  constructor({ request = fetch, media = new BilibiliMedia(), approved = '', spacing = 350 }:
    { request?: typeof fetch; media?: Pick<BilibiliMedia, 'available' | 'audio'>; approved?: string; spacing?: number } = {}) {
    this.request = request;
    this.media = media;
    this.approvals = audioApprovals(approved);
    this.approvedVideos = new Set([...this.approvals.keys()].map(id => id.split('-')[0]));
    this.queue = new RequestQueue(spacing, 'start');
  }

  status() { return { configured: true, bundlesEnabled: false }; }

  private async get(path: string, params: Record<string, string>, signal: AbortSignal, maxBytes = 512 * 1024) {
    signal.throwIfAborted();
    if (this.pausedUntil > Date.now()) throw new SongError('B 站暂时限制请求，请稍后重试。', 429, this.pausedUntil);
    const url = new URL(path, host);
    url.search = new URLSearchParams(params).toString();
    const body = object(await this.queue.json(async abort => {
      // Treat the upstream precondition response as a cooldown, without scraping or rotating identities.
      const res = await this.request(url, { headers: { Accept: 'application/json', 'User-Agent': songUserAgent }, redirect: 'error', signal: abort });
      if (res.status !== 412) return res;
      await res.body?.cancel();
      return new Response(null, { status: 429, headers: { 'Retry-After': '30' } });
    }, signal, maxBytes));
    if (body.code === -412 || body.code === -352 || body.code === -429) {
      this.pausedUntil = Date.now() + 30_000;
      throw new SongError('B 站暂时限制请求，请稍后重试。', 429, this.pausedUntil);
    }
    if (body.code === -404 || body.code === 62002 || body.code === 62004) throw new SongError('B 站投稿不存在或已不可见。', 404);
    if (body.code !== 0 || !body.data || typeof body.data !== 'object') throw new SongError('B 站没有返回可用的视频数据。', 502);
    return object(body.data);
  }

  private async view(bvid: string, signal: AbortSignal): Promise<Video> {
    // The view endpoint can include series-wide metadata much larger than the selected video's pages.
    const data = await this.get('/x/web-interface/view', { bvid }, signal, 2 * 1024 * 1024);
    if (data.bvid !== bvid || !Array.isArray(data.pages)) throw new SongError('B 站返回了不同的投稿或未返回分集。', 502);
    const rights = object(data.rights);
    // These are technical eligibility checks, not a license to redistribute the recording.
    const exportEligible = data.state === 0 && rights.download === 1 &&
      !rights.pay && !rights.ugc_pay && !rights.ugc_pay_preview && !rights.arc_pay && !rights.is_stein_gate &&
      !data.is_chargeable_season && !data.is_upower_exclusive && !data.is_upower_exclusive_with_qa && !data.is_upower_preview &&
      !data.redirect_url && !downloadingForbidden.test(str(data.desc).slice(0, 16_384));
    const parts = data.pages.slice(0, 999).flatMap(value => {
      const row = object(value);
      const page = int(row.page, 999), cid = int(row.cid), duration = int(row.duration), title = text(row.part);
      return page && cid && duration ? [{ page, cid, duration, title }] : [];
    });
    return { bvid, title: text(data.title), uploader: text(object(data.owner).name), parts, exportEligible, coverUrl: bilibiliCoverUrl(data.pic) };
  }

  private audioBlock(video: Video, part: Part) {
    const pin = this.approvals.get(`${video.bvid}-${part.page}`);
    if (!video.exportEligible) return new SongError('这条 B 站投稿未开放下载、明确禁止下载或需要额外权限。', 409);
    if (part.duration > maxSongSeconds) return new SongError('这段投稿超过 15 分钟，暂不支持转成单曲 MP3。请选具体歌曲分集。', 409);
    if (pin && pin.cid !== part.cid) return new SongError('这版投稿的分集已变更，不能导出固定版本的 MP3。', 409);
    if (!this.media.available) return new SongError('下载 MP3 需要安装 yt-dlp 和 FFmpeg，安装后请重启服务。', 503);
    return null;
  }

  private sourceTitle(video: Video, part: Part) {
    return (video.parts.length > 1 ? part.title : video.title) || part.title || video.title;
  }

  private summary(video: Video, part: Part): SongSummary {
    const multi = video.parts.length > 1;
    const album = [multi ? '合集' : '单曲投稿', multi ? `第 ${part.page} P` : '', video.uploader && `投稿：${video.uploader}`].filter(Boolean).join(' · ');
    const title = this.sourceTitle(video, part);
    return { provider: 'bilibili-video', id: `${video.bvid}-${part.page}`, ...videoSongIdentity(title, multi ? video.title : undefined),
      duration: part.duration, album, availability: this.audioBlock(video, part) ? 'stream-only' : 'audio-only' };
  }

  async search(query: string, signal: AbortSignal) {
    const data = await this.get('/x/web-interface/search/all/v2', { keyword: query, page: '1' }, signal);
    if (!Array.isArray(data.result)) throw new SongError('B 站没有返回有效的搜索列表。', 502);
    const group = data.result.map(object).find(item => item.result_type === 'video');
    if ('data' in (group ?? {}) && !Array.isArray(group?.data)) throw new SongError('B 站没有返回有效的投稿列表。', 502);
    const hits = new Map<string, Hit>();
    for (const value of (Array.isArray(group?.data) ? group.data : []).slice(0, 30)) {
      const row = object(value);
      const bvid = str(row.bvid), title = text(row.title), category = text(row.typename), duration = length(row.duration);
      if (!bv.test(bvid) || this.curated.has(bvid) && !this.approvedVideos.has(bvid) || hits.has(bvid) || !sections.has(category) || !title || !duration || unwanted.test(title)) continue;
      hits.set(bvid, { bvid, title, category, duration, uploader: text(row.author), collection: duration > 600 || collectionTitle.test(title) });
    }

    const ordered = [...hits.values()].slice(0, maxResults);
    const views = new Map<string, Video>();
    const expansionScore = (hit: Hit) => this.approvedVideos.has(hit.bvid) ? 3 : !hit.collection ? 0 : namedParts.test(hit.title) ? 2 : 1;
    const expanded = ordered.filter(hit => expansionScore(hit) > 0)
      .sort((a, b) => expansionScore(b) - expansionScore(a)).slice(0, 3);
    // A failed or slow optional expansion must not discard independent hits from the search.
    const budget = AbortSignal.any([signal, AbortSignal.timeout(4500)]);
    await Promise.allSettled(expanded.map(async hit => views.set(hit.bvid, await this.view(hit.bvid, budget))));
    signal.throwIfAborted();
    const groups = ordered.map((hit): SongSummary[] => {
      const video = views.get(hit.bvid);
      if (video?.parts.length) {
        const parts = video.parts.filter(part => !unwanted.test(part.title));
        const summaries = parts.map(part => this.summary(video, part));
        // Match all parts before taking the display limit: a requested song may be the 50th part.
        const matching = summaries.filter(part => songMatchScore(part, query) > 0);
        const selected = matching.length ? matching : summaries;
        return [...selected.filter(part => part.availability === 'audio-only'), ...selected.filter(part => part.availability !== 'audio-only')].slice(0, 8);
      }
      const album = [hit.collection ? '合集投稿' : hit.category, hit.uploader && `投稿：${hit.uploader}`].filter(Boolean).join(' · ');
      return [{ provider: 'bilibili-video', id: `${hit.bvid}-1`, ...(hit.collection ? { title: hit.title, artist: '' } : videoSongIdentity(hit.title)), album,
        duration: hit.duration, availability: 'review' }];
    }).filter(group => group.length > 0);
    // Keep each post represented; share the remaining slots between expanded collections.
    let remaining = maxResults - groups.length;
    const limit = groups.map(() => 1);
    for (let part = 1; part < 8 && remaining > 0; part++) {
      for (let index = 0; index < groups.length && remaining > 0; index++) {
        if (groups[index].length > part) { limit[index]++; remaining--; }
      }
    }
    return groups.flatMap((group, index) => group.slice(0, limit[index]));
  }

  private async selected(id: string, signal: AbortSignal) {
    const match = idPattern.exec(id);
    if (!match) throw new SongError('无效的 B 站分集 ID。', 400);
    const video = await this.view(match[1], signal);
    const part = video.parts.find(part => part.page === Number(match[2]));
    if (!part) throw new SongError('B 站投稿中没有这个分集。', 404);
    return { video, part };
  }

  private record(video: Video, part: Part): SongRecord {
    const summary = this.summary(video, part);
    const hint = videoPostLyricIdentity(this.sourceTitle(video, part), summary.artist);
    const lyricIdentity = hint && (hint.title !== summary.title || hint.artist !== summary.artist) ? hint : undefined;
    const track = { ...summary, ...(lyricIdentity ? { lyricIdentity } : {}), sourceUrl: videoUrl(video.bvid, part.page), previewUrl: null,
      licenseUrl: null, bilibiliVideoId: video.bvid, bilibiliPage: part.page, lyrics: null,
      downloadNote: this.audioBlock(video, part)?.message };
    return { track, downloadUrl: null };
  }

  async detail(id: string, signal: AbortSignal) {
    const { video, part } = await this.selected(id, signal);
    return this.record(video, part);
  }

  async mp3Source(id: string, signal: AbortSignal) {
    const { video, part } = await this.selected(id, signal);
    const blocked = this.audioBlock(video, part);
    if (blocked) throw blocked;
    const source = this.record(video, part).track;
    const track = source.lyricIdentity ? { ...source, ...source.lyricIdentity } : source;
    // Keep the raw post title only for recognizing existing legacy files.
    const downloadTitle = this.sourceTitle(video, part);
    const url = `https://www.bilibili.com/video/${video.bvid}/?p=${part.page}`;
    let coverIssue: 'missing' | 'unavailable' | undefined = video.coverUrl ? undefined : 'missing';
    const cover = async (): Promise<SongCover | undefined> => {
      if (!video.coverUrl) return;
      try {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
        const response = await this.request(video.coverUrl, { redirect: 'error', signal: deadline, headers: { 'User-Agent': songUserAgent, Accept: 'image/jpeg, image/png' } });
        if (response.status !== 200) { await response.body?.cancel(); throw new Error('Cover unavailable'); }
        const data = await readBounded(response, 2 * 1024 * 1024, deadline);
        const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (type === 'image/jpeg' && data[0] === 255 && data[1] === 216 && data[2] === 255) return { mime: type, data };
        if (type === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: type, data };
        throw new Error('Invalid cover image');
      } catch { signal.throwIfAborted(); coverIssue = 'unavailable'; }
    };
    return { track, downloadTitle, get coverIssue() { return coverIssue; }, audio: async () => {
      const [bytes, picture] = await Promise.all([this.media.audio(url, part.duration, this.approvals.get(id)?.hash, signal), cover()]);
      return tagSongMp3(bytes, track, picture);
    } };
  }

  async mp3(id: string, signal: AbortSignal) {
    const { track, downloadTitle, audio } = await this.mp3Source(id, signal);
    return { track, downloadTitle, body: await audio() };
  }

  async audio(): Promise<never> { throw new SongError('没有同版本歌词，不能打包 ZIP。', 409); }
}
