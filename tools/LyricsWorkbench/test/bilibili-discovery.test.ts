import { mp3Payload } from '../src/song-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { BilibiliDiscovery } from '../src/bilibili-discovery';
import type { BilibiliMedia } from '../src/bilibili-songs';
import { createServer } from '../src/server';
import { JamendoCatalog } from '../src/songs';
import type { SongSummary } from '../src/song-types';

const collection = 'BV1J9oNYhEYT';
const single = 'BV1nqTjzmEq4';
const cover = 'BV1UX4y1E72c';
const address = `/api/songs/bilibili-video/${collection}-2`;
const frame = Buffer.alloc(417);
frame.set([0xff, 0xfb, 0x90, 0x64]);
const mp3 = Buffer.concat(Array.from({ length: 115 }, () => frame));
const hash = 'a'.repeat(64);

type Fixture = { allow?: boolean; noDownload?: boolean; paid?: boolean; limit?: boolean; wrongCid?: boolean; brokenCollection?: boolean;
  disabledDownload?: boolean; privatePost?: boolean; supporterOnly?: boolean; missingTools?: boolean; singleAllowed?: boolean; longPart?: boolean; };
async function fixture(t: TestContext, options: Fixture = {}) {
  const calls: string[] = [], mediaCalls: unknown[] = [];
  const request: typeof fetch = async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.origin, 'https://api.bilibili.com');
    assert.equal(init?.redirect, 'error');
    calls.push(u.pathname);
    if (u.pathname.endsWith('/all/v2')) {
      assert.equal(u.searchParams.get('keyword'), '李克勤');
      if (options.limit) return new Response(null, { status: 412 });
      return Response.json({ code: 0, data: { result: [{ result_type: 'video', data: [
        { bvid: collection, typename: '音乐综合', title: '<em class="keyword">李克勤</em> &amp; 合集', author: '投稿者甲', duration: '36:49' },
        { bvid: single, typename: '电台', title: '红日 - <em class="keyword">李克勤</em>', author: '投稿者乙', duration: '4:58' },
        { bvid: cover, typename: '翻唱', title: '李克勤 / 翻唱', author: '别的歌手', duration: '3:25' },
        { bvid: 'http://localhost', typename: 'MV', title: '其他', duration: '4:12' },
      ] }] } });
    }
    assert.equal(u.pathname, '/x/web-interface/view');
    if (u.searchParams.get('bvid') === single) return Response.json({ code: 0, data: { bvid: single, title: '红日 - 李克勤', state: 0,
      desc: options.singleAllowed ? '' : '不提供任何音源下载', rights: { download: 1 }, pages: [{ page: 1, cid: 123, part: '红日', duration: 298 }] } });
    assert.equal(u.searchParams.get('bvid'), collection);
    if (options.brokenCollection) return new Response(null, { status: 500 });
    return Response.json({ code: 0, data: { bvid: collection, title: '李克勤 & 合集', owner: { name: '投稿者甲' },
      state: options.privatePost ? -4 : 0, is_upower_exclusive: !!options.supporterOnly,
      desc: options.noDownload ? '声明：不提供任何音源下载' : '', rights: { download: options.disabledDownload ? 0 : 1, pay: options.paid ? 1 : 0 },
      pages: [{ page: 1, cid: 19, part: '红日', duration: 280 }, { page: 2, cid: options.wrongCid ? 21 : 20, part: '月半小夜曲', duration: options.longPart ? 901 : 3 }] } });
  };
  const media = { available: !options.missingTools, async audio(...args: Parameters<BilibiliMedia['audio']>) { mediaCalls.push(args.slice(0, 3)); return mp3; } };
  const discovery = new BilibiliDiscovery({ request, media, spacing: 0, approved: options.allow ? `${collection}:2:20:${hash}` : '' });
  const app = await createServer({ songs: new JamendoCatalog({}), bilibiliVideos: discovery });
  t.after(() => app.close());
  return { app, calls, mediaCalls };
}

const searchPath = `/api/songs?source=bilibili-video&q=${encodeURIComponent('李克勤')}`;

test('搜李克勤时展开可下载的合集分集，未检查的单曲点开后才确认状态', async t => {
  const { app, calls } = await fixture(t);
  assert.deepEqual((await app.inject('/api/songs/status')).json().sources, ['bilibili-video']);
  const search = await app.inject(searchPath);
  assert.equal(search.statusCode, 200, search.body);
  const tracks: SongSummary[] = search.json().tracks;
  assert.deepEqual(tracks.map(({ id, title, artist, availability }) => [id, title, artist, availability]), [
    [`${collection}-1`, '红日', '', 'audio-only'],
    [`${collection}-2`, '月半小夜曲', '', 'audio-only'],
    [`${single}-1`, '红日', '李克勤', 'review'],
  ]);
  assert.equal(tracks[1].album, '合集 · 第 2 P · 投稿：投稿者甲');
  const detail = await app.inject(address);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().track.sourceUrl, `https://www.bilibili.com/video/${collection}/?p=2`);
  assert.equal(detail.json().track.bilibiliPage, 2);
  assert.equal(detail.json().track.lyrics, null);
  const singleAddress = `/api/songs/bilibili-video/${single}-1`;
  const restricted = (await app.inject(singleAddress)).json().track;
  assert.equal(restricted.availability, 'stream-only');
  assert.match(restricted.downloadNote, /禁止下载/);
  assert.equal((await app.inject({ method: 'POST', url: `${singleAddress}/mp3` })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: `${address}/download` })).statusCode, 409);
  const previousCalls = calls.length;
  assert.equal((await app.inject('/api/songs/bilibili-video/http:%2F%2F127.0.0.1')).statusCode, 400);
  assert.equal(calls.length, previousCalls);
});

test('普通公开分集无需手动配置摘要就能单独返回 MP3，且不能冒充 ZIP', async t => {
  const { app, mediaCalls } = await fixture(t);
  const search = await app.inject(searchPath);
  assert.equal(search.json().tracks.find((item: SongSummary) => item.id === `${collection}-2`).availability, 'audio-only');
  const response = await app.inject({ method: 'POST', url: `${address}/mp3`, payload: { url: 'https://localhost/other' } });
  assert.equal(response.statusCode, 200, response.body.slice(0, 300));
  assert.equal(response.headers['content-type'], 'audio/mpeg');
  assert.match(String(response.headers['content-disposition']), /attachment;.*filename\*=UTF-8/);
  assert.deepEqual(mp3Payload(response.rawPayload), mp3);
  assert.deepEqual(mediaCalls, [[`https://www.bilibili.com/video/${collection}/?p=2`, 3, undefined]]);
  assert.equal((await app.inject({ method: 'POST', url: `${address}/download` })).statusCode, 409);
});

test('未预检的单曲点开后可下载，同样使用明确的 P1', async t => {
  const { app, mediaCalls } = await fixture(t, { singleAllowed: true });
  const path = `/api/songs/bilibili-video/${single}-1`;
  assert.equal((await app.inject(path)).json().track.availability, 'audio-only');
  assert.equal((await app.inject({ method: 'POST', url: `${path}/mp3` })).statusCode, 200);
  assert.deepEqual(mediaCalls, [[`https://www.bilibili.com/video/${single}/?p=1`, 298, undefined]]);
});

test('付费、充电专属、非公开、明确不允许下载的投稿或超长节目不调用媒体工具', async t => {
  for (const opt of [{ noDownload: true }, { disabledDownload: true }, { paid: true }, { supporterOnly: true }, { privatePost: true }, { longPart: true }]) {
    const rejected = await fixture(t, opt);
    assert.equal((await rejected.app.inject({ method: 'POST', url: `${address}/mp3` })).statusCode, 409);
    assert.equal(rejected.mediaCalls.length, 0);
  }
});

test('可选摘要继续锁定具体 CID；缺下载工具时仍可搜索并返回明确错误', async t => {
  const pinned = await fixture(t, { allow: true });
  assert.equal((await pinned.app.inject({ method: 'POST', url: `${address}/mp3` })).statusCode, 200);
  assert.deepEqual(pinned.mediaCalls, [[`https://www.bilibili.com/video/${collection}/?p=2`, 3, hash]]);
  const changed = await fixture(t, { allow: true, wrongCid: true });
  assert.equal((await changed.app.inject({ method: 'POST', url: `${address}/mp3` })).statusCode, 409);
  assert.equal(changed.mediaCalls.length, 0);
  const disabled = await fixture(t, { missingTools: true });
  assert.equal((await disabled.app.inject(searchPath)).statusCode, 200);
  assert.equal((await disabled.app.inject({ method: 'POST', url: `${address}/mp3` })).statusCode, 503);
  assert.equal(disabled.mediaCalls.length, 0);
});

test('只有限流显示重试；展开合集失败仍能看到单曲和原投稿', async t => {
  const limited = await fixture(t, { limit: true });
  const first = await limited.app.inject(searchPath);
  assert.equal(first.statusCode, 429);
  assert.ok(Number(first.headers['retry-after']) > 0);
  await limited.app.inject(searchPath);
  assert.equal(limited.calls.length, 1);
  const fallback = await fixture(t, { brokenCollection: true });
  const res = await fallback.app.inject(searchPath);
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(res.json().tracks.some((item: SongSummary) => item.id === `${single}-1`));
  assert.ok(res.json().tracks.some((item: SongSummary) => item.id === `${collection}-1`));
});

test('优先展开列出具体曲名的合集，即使附带较大的系列元数据也保留单曲结果', async () => {
  const generic = Array.from({ length: 3 }, (_, i) => ({ bvid: `BV8a8765432${i}`, typename: '音乐综合',
    title: `李克勤演唱会 ${i + 1}`, duration: '90:00' }));
  const singles = Array.from({ length: 16 }, (_, i) => ({ bvid: `BV7a876543${String(i).padStart(2, '0')}`, typename: 'MV',
    title: `李克勤单曲 ${i + 1}`, duration: '4:32' }));
  const wanted = { bvid: collection, typename: '音乐综合', title: '李克勤合集：《红日》《月半小夜曲》', duration: '39:48' };
  const request: typeof fetch = async url => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/all/v2')) return Response.json({ code: 0, data: { result: [
      { result_type: 'video', data: [...generic, wanted, ...singles] },
    ] } });
    const bvid = u.searchParams.get('bvid');
    return Response.json({ code: 0, data: { bvid, title: '合集', ugc_season: bvid === collection ? { metadata: 'x'.repeat(820_000) } : {},
      pages: Array.from({ length: 8 }, (_, i) => ({ page: i + 1, cid: i + 100, duration: 293,
        part: i === 1 && bvid === collection ? '月半小夜曲' : `歌曲 ${i + 1}` })) } });
  };
  const discovery = new BilibiliDiscovery({ request, spacing: 0 });
  const tracks = await discovery.search('李克勤', new AbortController().signal);
  assert.ok(tracks.some(track => track.id === `${collection}-2` && track.title === '月半小夜曲'));
  assert.ok(singles.every(row => tracks.some(track => track.id === `${row.bvid}-1`)));
  assert.ok(tracks.length <= 28);
});

test('分集查词：拆分邓紫棋署名、处理编号，从双语歌词标题中匹配纯文本，不自动附带同版时码', async t => {
  const video = 'BV1xN411x76o';
  const data = { bvid: video, title: '【Hi-Res】G.E.M.鄧紫棋歌曲精选！', state: 0, rights: { download: 1 }, pages: [
    { page: 1, cid: 1, part: '句号-G.E.M.邓紫棋', duration: 236 },
    { page: 2, cid: 2, part: '2.泡沫', duration: 260 },
    { page: 3, cid: 3, part: '11-G.E.M.邓紫棋', duration: 230 },
  ] };
  const request: typeof fetch = async url => new URL(String(url)).pathname.endsWith('/all/v2')
    ? Response.json({ code: 0, data: { result: [{ result_type: 'video', data: [{ bvid: video, typename: '音乐综合', title: data.title, duration: '30:00' }] }] } })
    : Response.json({ code: 0, data });
  const queries: string[] = [];
  const lyric = { id: 1, title: '句号 - Full Stop', artist: 'G.E.M.', album: '发行', duration: 236,
    instrumental: false, synced: '[00:03]原创验收词', plain: '' };
  const app = await createServer({ bilibiliVideos: new BilibiliDiscovery({ request, spacing: 0 }),
    localLyricSearch: async query => { queries.push(query); return [{ ...lyric, id: 2, artist: '另一位歌手' },
      { ...lyric, id: 3, title: '句号 - Live' }, lyric]; } });
  t.after(() => app.close());
  const search = await app.inject(`/api/songs?source=bilibili-video&q=${encodeURIComponent('邓紫棋')}`);
  assert.equal(search.statusCode, 200, search.body);
  assert.deepEqual(search.json().tracks.sort((a: SongSummary, b: SongSummary) => a.id.localeCompare(b.id)).map(({ title, artist }: SongSummary) => [title, artist]), [['句号', '邓紫棋'], ['泡沫', '邓紫棋'], ['11', '邓紫棋']]);
  const detailPath = `/api/songs/bilibili-video/${video}-1`;
  const detail = (await app.inject(detailPath)).json().track;
  assert.equal(detail.lyrics, null, '查词预览不可写回未核对的音频');
  const response = await app.inject({ method: 'POST', url: `${detailPath}/lyrics`, payload: {} });
  assert.equal(response.statusCode, 200, response.body);
  const { result } = response.json();
  assert.equal(result.status, 'plain');
  assert.equal(result.candidate.id, 1);
  assert.equal(result.candidate.synced, '');
  assert.equal(result.candidate.plain, '原创验收词');
  assert.deepEqual(queries, ['句号 G.E.M.']);
});

test('specific song search finds the matching collection part even beyond the first eight tracks', async () => {
  const data = { bvid: collection, title: '【伍佰合集】100首伍佰歌曲合集', state: 0, rights: { download: 1 },
    pages: Array.from({ length: 12 }, (_, index) => ({ page: index + 1, cid: 200 + index, part: index === 10 ? '11. 挪威的森林' : `${index + 1}. 其他歌曲${index}`, duration: 240 })) };
  const request: typeof fetch = async url => new URL(String(url)).pathname.endsWith('/all/v2')
    ? Response.json({ code: 0, data: { result: [{ result_type: 'video', data: [{ bvid: collection, typename: '音乐综合', title: data.title, duration: '48:00' }] }] } })
    : Response.json({ code: 0, data });
  const discovery = new BilibiliDiscovery({ request, media: { available: true, audio: async () => mp3 }, spacing: 0 });
  for (const query of ['挪威的森林', '伍佰 森林', '森林 伍佰']) {
    const results = await discovery.search(query, new AbortController().signal);
    assert.deepEqual(results.map(({ title, artist }) => [title, artist]), [['挪威的森林', '伍佰']]);
  }
  assert.equal((await discovery.search('伍佰', new AbortController().signal)).length, 8, 'artist search must retain the collection selection');
});

test('直接按歌名搜索时，用投稿署名匹配纯文本，保留来源标题与无歌词的音频状态', async t => {
  const video = 'BV1pdRTB8ESa', raw = '《告白气球》周杰伦丨百万级录音棚试听丨【Hi-Res无损】';
  const data = { bvid: video, title: raw, state: 0, rights: { download: 1 }, pages: [{ page: 1, cid: 1, part: raw, duration: 210 }] };
  const request: typeof fetch = async url => new URL(String(url)).pathname.endsWith('/all/v2')
    ? Response.json({ code: 0, data: { result: [{ result_type: 'video', data: [{ bvid: video, typename: '音乐综合', title: raw, duration: '3:30' }] }] } })
    : Response.json({ code: 0, data });
  const queries: string[] = [];
  const lyric = { id: 1, title: '告白气球', artist: '周杰倫', album: '发行', duration: 210,
    instrumental: false, synced: '[00:03]虚构验收词', plain: '' };
  const app = await createServer({ bilibiliVideos: new BilibiliDiscovery({ request, spacing: 0 }),
    localLyricSearch: async query => { queries.push(query); return [{ ...lyric, id: 2, artist: '另一位歌手' }, lyric]; } });
  t.after(() => app.close());
  const search = await app.inject(`/api/songs?source=bilibili-video&q=${encodeURIComponent('告白气球')}`);
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(search.json().tracks[0].title, raw);
  const address = `/api/songs/bilibili-video/${video}-1`;
  const detail = (await app.inject(address)).json().track;
  assert.equal(detail.title, raw);
  assert.equal(detail.lyrics, null);
  assert.deepEqual(detail.lyricIdentity, { title: '告白气球', artist: '周杰伦' });
  const response = await app.inject({ method: 'POST', url: `${address}/lyrics`, payload: {} });
  assert.equal(response.statusCode, 200, response.body);
  const { result } = response.json();
  assert.equal(result.status, 'plain');
  assert.equal(result.candidate.id, 1);
  assert.equal(result.candidate.synced, '');
  assert.equal(result.candidate.plain, '虚构验收词');
  assert.deepEqual(queries, ['告白气球 周杰伦']);
});
