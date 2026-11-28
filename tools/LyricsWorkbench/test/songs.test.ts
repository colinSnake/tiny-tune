import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublishedCatalog } from '../src/published-songs';
import { prepareSongBatch } from '../app/song-downloads';

import { test, type TestContext } from 'node:test';
import JSZip from 'jszip';
import { createServer } from '../src/server';
import { JamendoCatalog, songZip } from '../src/songs';
import { RequestQueue } from '../src/providers';

// An original synthetic MPEG-1 Layer III fixture: 115 silent 128 kbps frames at 44.1 kHz.
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const frame = Buffer.alloc(417);
frame.set([0xff, 0xfb, 0x90, 0x64]);
const audio = Buffer.concat(Array.from({ length: 115 }, () => frame));
const lyrics = '[00:00.10]第一句\n[00:02.20]最后一句';
const row = {
  id: '42', name: '光 / 原声', artist_name: '山谷', album_id: '19', album_name: '夜色', duration: 3,
  audio: 'https://prod-1.storage.jamendo.com/?trackid=42&format=mp31',
  audiodownload: 'https://prod-1.storage.jamendo.com/download/track/42/mp32/',
  audiodownload_allowed: true, lyrics, license_ccurl: 'http://creativecommons.org/licenses/by/3.0/',
};

function setup(t: TestContext, options: { permitted?: boolean; timeout?: number } = {}) {
  let requests = 0;
  let mediaRequests = 0;
  const ids: string[] = [];
  const state = {
    row: { ...row }, media: (_url: URL, _signal: AbortSignal | null | undefined) => new Response(new Uint8Array(audio), {
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(audio.length) },
    }) as Response | Promise<Response>,
    get requests() { return requests; }, get mediaRequests() { return mediaRequests; }, ids,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.jamendo.com') {
      requests++;
      assert.equal(url.searchParams.get('client_id'), 'test-key');
      assert.equal(url.searchParams.get('include'), 'lyrics');
      assert.equal(url.searchParams.get('audiodlformat'), 'mp32');
      const id = url.searchParams.get('id');
      if (id) ids.push(id);
      return Response.json({ headers: { status: 'success', code: 0 }, results: [state.row] });
    }
    mediaRequests++;
    return state.media(url, init?.signal);
  };
  return { state, async app() {
    const songs = new JamendoCatalog({ clientId: 'test-key', allowBundles: options.permitted ?? true,
      approvedTrackHashes: { '42': hash(audio) }, fetcher, spacing: 0 });
    const app = await createServer({ songs, songDownloadTimeout: options.timeout });
    t.after(() => app.close());
    return app;
  } };
}

const detailPath = '/api/songs/jamendo/42';
const downloadPath = `${detailPath}/download`;

test('搜索、试听详情、同版本歌词和完整 MP3 ZIP 都绑定曲目 ID', async t => {
  const { state, app } = setup(t);
  const server = await app();
  const search = await server.inject(`/api/songs?q=${encodeURIComponent('山谷')}`);
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(search.json().tracks[0].availability, 'ready');
  assert.equal(search.json().tracks[0].releaseId, '19');
  assert.ok(!search.body.includes('test-key') && !search.body.includes('audiodownload'));
  const detail = await server.inject(detailPath);
  assert.equal(detail.json().track.lyrics.text, lyrics);
  assert.equal(detail.json().track.lyrics.kind, 'timed');
  assert.equal(detail.json().track.previewUrl, row.audio);
  const response = await server.inject({ method: 'POST', url: downloadPath, payload: { url: 'http://127.0.0.1/' } });
  assert.equal(response.statusCode, 200, response.body.slice(0, 300));
  assert.match(String(response.headers['content-disposition']), /attachment.*filename\*=UTF-8/);
  const zip = await JSZip.loadAsync(response.rawPayload, { checkCRC32: true });
  const mp3 = Object.keys(zip.files).find(name => name.endsWith('.mp3'))!;
  assert.equal(mp3, '山谷/夜色/山谷 - 光 原声.mp3');
  assert.deepEqual(await zip.file(mp3)!.async('nodebuffer'), audio);
  assert.equal(await zip.file(mp3.replace(/mp3$/, 'lrc'))!.async('string'), lyrics);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.releaseId, '19');
  assert.equal(manifest.audio.file, mp3);
  assert.equal(manifest.lyrics.file, mp3.replace(/mp3$/, 'lrc'));
  assert.equal(manifest.source.id, '42');
  assert.equal(manifest.lyrics.kind, 'timed');
  assert.deepEqual(state.ids, ['42', '42']);
  assert.equal(state.mediaRequests, 1);
});

test('纯文本原样打包；下载前重新验证许可、歌词以及录音 ID', async t => {
  const { state, app } = setup(t);
  const server = await app();
  state.row.lyrics = '纯文本\r\n第二行';
  const plain = await server.inject({ method: 'POST', url: downloadPath });
  assert.equal(plain.statusCode, 200, plain.body.slice(0, 300));
  const zip = await JSZip.loadAsync(plain.rawPayload);
  const lrc = Object.keys(zip.files).find(name => name.endsWith('.lrc'))!;
  assert.equal(await zip.file(lrc)!.async('string'), '纯文本\r\n第二行');
  state.row.audiodownload_allowed = false;
  assert.equal((await server.inject(detailPath)).json().track.availability, 'stream-only');
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 409);
  state.row.audiodownload_allowed = true;
  state.row.lyrics = '[ti:不是有效歌词]';
  assert.equal((await server.inject(detailPath)).json().track.availability, 'missing-lyrics');
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 409);
  state.row.lyrics = '[00:55.00]另一录音';
  assert.equal((await server.inject(detailPath)).json().track.availability, 'review');
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 409);
  state.row.id = '43';
  assert.equal((await server.inject(detailPath)).statusCode, 404);
  assert.equal(state.mediaRequests, 1);
});

test('缺配置和未批准打包不冒充无结果或可下载', async t => {
  const empty = await createServer({ songs: new JamendoCatalog({}) });
  t.after(() => empty.close());
  assert.equal((await empty.inject('/api/songs/status')).json().configured, false);
  assert.equal((await empty.inject('/api/songs?q=hello')).statusCode, 503);
  const { state, app } = setup(t, { permitted: false });
  const server = await app();
  assert.equal((await server.inject(detailPath)).json().track.availability, 'review');
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 409);
  assert.equal(state.mediaRequests, 0);
});

test('不接受非白名单重定向、206、伪造音频或时长不足的文件', async t => {
  const { state, app } = setup(t);
  const server = await app();
  state.media = () => Response.redirect('https://127.0.0.1/file.mp3');
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 502);
  assert.equal(state.mediaRequests, 1);
  state.media = () => new Response(new Uint8Array(audio), { status: 206, headers: { 'content-type': 'audio/mpeg' } });
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 502);
  state.media = () => new Response('not an MP3', { headers: { 'content-type': 'audio/mpeg' } });
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 502);
  // 85 full frames: passes duration tolerance and includes the final cue, but is not the reviewed complete file.
  state.media = () => new Response(new Uint8Array(audio.subarray(0, frame.length * 85)), { headers: { 'content-type': 'audio/mpeg' } });
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 502);
});

test('下载的超时和上游限流返回明确错误且没有 ZIP', async t => {
  const { state, app } = setup(t, { timeout: 80 });
  const server = await app();
  state.media = () => new Response(null, { status: 429, headers: { 'retry-after': '30' } });
  const rate = await server.inject({ method: 'POST', url: downloadPath });
  assert.equal(rate.statusCode, 429);
  assert.equal(rate.headers['retry-after'], '30');
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 429);
  assert.equal(state.mediaRequests, 1);
});

test('超时会取消音频请求并且不返回残包', async t => {
  const { state, app } = setup(t, { timeout: 80 });
  const server = await app();
  // Use a real timer to keep the test active while the timeout signal completes.
  state.media = (_url, signal) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('did not cancel')), 1000);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
  assert.equal((await server.inject({ method: 'POST', url: downloadPath })).statusCode, 504);
});

test('作者授权目录无需 Jamendo 凭据，可下载整曲；不接受静默替换的歌词或音频', async t => {
  const lyricText = '<lyrics>我自己写的测试歌词\n下一句</lyrics>';
  let currentLyrics = lyricText;
  let currentAudio = audio;
  const catalog = new PublishedCatalog([{
    id: '123', title: '自制原声', artist: '测试作者', album: '自制专辑', duration: 3,
    sourceUrl: 'https://www.jonathancoulton.com/', licenseUrl: 'https://creativecommons.org/licenses/by-nc/3.0/',
    rightsUrl: 'https://www.jonathancoulton.com/faq/', lyricSourceUrl: 'https://joco.wiki.gg/wiki/Test',
    audioUrl: 'https://www.jonathancoulton.com/test.mp3', lyricsUrl: 'https://joco.wiki.gg/api.php?revids=1',
    audioHash: hash(audio), lyricHash: hash(lyricText),
  }], async input => String(input).includes('revids=1') ? Response.json({ query: { pages: [{ revisions: [{ slots: { main: { content: currentLyrics } } }] }] } }) :
    new Response(new Uint8Array(currentAudio), { headers: { 'content-type': 'audio/mpeg' } }));
  const server = await createServer({ songs: new JamendoCatalog({}), publishedSongs: catalog });
  t.after(() => server.close());
  assert.equal((await server.inject('/api/songs/status')).json().featured, true);
  const results = (await server.inject(`/api/songs?q=${encodeURIComponent('自制')}`)).json().tracks;
  assert.equal(results[0].provider, 'artist');
  const empty = (await server.inject('/api/songs?q=no-match')).json();
  assert.deepEqual(empty.tracks, []);
  assert.match(empty.warning, /Jamendo 尚未配置/);
  const url = '/api/songs/artist/123/download';
  const response = await server.inject({ method: 'POST', url });
  assert.equal(response.statusCode, 200, response.body.slice(0, 120));
  const zip = await JSZip.loadAsync(response.rawPayload);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(manifest.source.rights, 'https://www.jonathancoulton.com/faq/');
  assert.equal(manifest.lyrics.source, 'https://joco.wiki.gg/wiki/Test');
  assert.equal(await zip.file(manifest.lyrics.file)!.async('string'), '我自己写的测试歌词\n下一句');
  currentLyrics = '<lyrics>不是这首</lyrics>';
  assert.equal((await server.inject({ method: 'POST', url })).statusCode, 409);
  currentLyrics = lyricText;
  currentAudio = Buffer.from(audio);
  currentAudio[20] ^= 1;
  assert.equal((await server.inject({ method: 'POST', url })).statusCode, 502);
});


test('作者曲库按发行 ID 关联多个版本，简繁别名可搜，不跨版本打包歌词', async t => {
  const expected = Buffer.from('\uFEFF試唱原聲\r\n  第二句\r\n');
  const alternative = Buffer.from('混音版第一句\n');
  const license = 'https://creativecommons.org/licenses/by-nc-sa/2.0/tw/';
  const url = 'https://example.com/album';
  const initial = { id: '321', title: '測試曲', artist: '測試歌手', album: '同一專輯', releaseId: 'test-release', duration: 3,
    aliases: { titles: ['测试曲'], artists: ['测试歌手'] }, sourceUrl: url, lyricSourceUrl: `${url}/original.txt`,
    rightsUrl: url, licenseUrl: license, audioUrl: `${url}/original.mp3`, audioHash: hash(audio),
    lyricsFormat: 'text' as const, lyricsUrl: `${url}/original.txt`, lyricHash: hash(expected) };
  let wrong = false;
  const requested: string[] = [];
  const catalog = new PublishedCatalog([initial, { ...initial, id: '322', title: '測試曲 Remix',
    aliases: { titles: ['测试曲 Remix'], artists: ['测试歌手'] }, lyricSourceUrl: `${url}/remix.txt`,
    lyricsUrl: `${url}/remix.txt`, lyricHash: hash(alternative), audioUrl: `${url}/remix.mp3` }], async input => {
    const name = String(input).slice(url.length + 1);
    requested.push(name);
    if (name.endsWith('.mp3')) return new Response(new Uint8Array(audio), { headers: { 'content-type': 'audio/mpeg' } });
    return new Response(new Uint8Array(name === 'original.txt' || wrong ? expected : alternative), {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  });
  const server = await createServer({ publishedSongs: catalog });
  t.after(() => server.close());
  const query = async (q: string) => (await server.inject(`/api/songs?source=artist&q=${encodeURIComponent(q)}`)).json().tracks;
  assert.deepEqual((await query('测试歌手 测试曲')).map((row: { id: string }) => row.id), ['321', '322']);
  assert.deepEqual((await query('测试曲 Remix 测试歌手')).map((row: { id: string }) => row.id), ['322']);
  const download = async (id: string, lyricScript?: string) => server.inject({ method: 'POST', url: `/api/songs/artist/${id}/download`,
    ...(lyricScript ? { payload: { lyricScript } } : {}) });
  const result = await download('321');
  assert.equal(result.statusCode, 200, result.body);
  const zip = await JSZip.loadAsync(result.rawPayload);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(manifest.source.license, license);
  assert.equal(manifest.lyrics.source, `${url}/original.txt`);
  assert.equal(manifest.lyrics.kind, 'plain');
  assert.equal(await zip.file(manifest.lyrics.file)!.async('string'), '\uFEFF试唱原声\r\n  第二句\r\n');
  assert.deepEqual(await zip.file(manifest.audio.file)!.async('nodebuffer'), audio);
  assert.deepEqual(requested, ['original.txt', 'original.mp3']);
  const original = await download('321', 'original');
  assert.equal(original.statusCode, 200);
  assert.equal(await (await JSZip.loadAsync(original.rawPayload)).file(manifest.lyrics.file)!.async('string'), '\uFEFF試唱原聲\r\n  第二句\r\n');
  assert.equal((await download('322')).statusCode, 200);
  assert.deepEqual(requested.slice(-2), ['remix.txt', 'remix.mp3']);
  const batch = await prepareSongBatch(await query('测试歌手'), new AbortController().signal, () => {}, async (path, init) => {
    const response = await server.inject({ method: 'POST', url: path, headers: init.headers, payload: init.body });
    assert.equal(response.statusCode, 200);
    return new Response(new Uint8Array(response.rawPayload), { headers: { 'content-type': 'application/zip' } });
  }, undefined, 'original');
  assert.equal(batch.completed.length, 2, batch.error?.message);
  const archive = await JSZip.loadAsync(await batch.archive!.arrayBuffer(), { checkCRC32: true });
  const batchManifest = JSON.parse(await archive.file('manifest.json')!.async('string'));
  assert.deepEqual(batchManifest.tracks.map((entry: { audio: { file: string } }) => entry.audio.file),
    ['測試歌手/同一專輯/測試歌手 - 測試曲.mp3', '測試歌手/同一專輯/測試歌手 - 測試曲 Remix.mp3']);
  assert.equal(await archive.file(batchManifest.tracks[0].lyrics.file)!.async('string'), '\uFEFF試唱原聲\r\n  第二句\r\n');
  assert.equal(await archive.file(batchManifest.tracks[1].lyrics.file)!.async('string'), '混音版第一句\n');
  assert.equal(batchManifest.tracks[1].source.license, license);
  wrong = true;
  assert.equal((await download('322')).statusCode, 409);
  assert.equal(requested.at(-1), 'remix.txt');
});


test('队列等待中的请求立即响应取消，不会触发上游请求', async () => {
  const queue = new RequestQueue(0, 'start');
  let release!: () => void;
  const blocker = new Promise<void>(resolve => { release = resolve; });
  const first = queue.json(async () => { await blocker; return Response.json({ ok: true }); });
  const stop = new AbortController();
  let fetched = false;
  const canceled = queue.json(async () => { fetched = true; return Response.json(null); }, stop.signal);
  try {
    stop.abort();
    await assert.rejects(canceled, { name: 'AbortError' });
  } finally { release(); }
  await first;
  assert.equal(fetched, false);
});

test('Jamendo JSON 流即使没有 Content-Length 也有解析前的大小限制', async t => {
  let cancelled = false;
  const songs = new JamendoCatalog({ clientId: 'key', fetcher: async () => new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'application/json' } },
  ) });
  const server = await createServer({ songs });
  t.after(() => server.close());
  const result = await server.inject('/api/songs?q=光');
  assert.equal(result.statusCode, 502);
  assert.match(result.json().error, /超过大小上限/);
  assert.equal(cancelled, true);
});

test('压缩过程中取消只丢弃结果，不会抛出脱离请求处理的异常', async t => {
  const signal = new AbortController();
  const songs = new JamendoCatalog({ clientId: 'key', allowBundles: true, approvedTrackHashes: { '42': hash(audio) },
    fetcher: async input => new URL(String(input)).hostname === 'api.jamendo.com'
      ? Response.json({ headers: { status: 'success', code: 0 }, results: [row] })
      : new Response(new Uint8Array(audio), { headers: { 'content-type': 'audio/mpeg' } }),
  });
  const generate = JSZip.prototype.generateAsync;
  t.mock.method(JSZip.prototype, 'generateAsync', function (this: JSZip, ...args: Parameters<typeof generate>) {
    const result = generate.apply(this, args);
    setImmediate(() => signal.abort());
    return result;
  });
  await assert.rejects(songZip(songs, '42', signal.signal), { name: 'AbortError' });
});

test('Jamendo HTTP 200 内的配额错误也触发退避', async t => {
  let upstream = 0;
  const songs = new JamendoCatalog({ clientId: 'key', spacing: 0, fetcher: async () => {
    upstream++;
    return Response.json({ headers: { status: 'failed', code: 6 }, results: [] }, { headers: { 'Retry-After': '8' } });
  } });
  const server = await createServer({ songs });
  t.after(() => server.close());
  const first = await server.inject('/api/songs?q=光');
  assert.equal(first.statusCode, 429);
  assert.equal(first.headers['retry-after'], '8');
  assert.equal((await server.inject('/api/songs?q=山谷')).statusCode, 429);
  assert.equal(upstream, 1);
});


test('ZIP revalidates lyrics before fetching audio from a stale ready record', async () => {
  let calls = 0;
  for (const text of [`[00:01]我喜欢你
[00:01]wǒ xǐ huān nǐ`, `[00:01]词
[00:99]坏时码`, `[00:01]<b>词</b>`, `[00:01]�`]) {
    const catalog = {
      status: () => ({ configured: true, bundlesEnabled: true }),
      search: async () => [],
      detail: async () => ({ downloadUrl: null, track: { provider: 'artist' as const, id: '1', title: '歌', artist: '歌手', album: '', duration: 3, availability: 'ready' as const, sourceUrl: 'https://example.com', licenseUrl: null, previewUrl: null, lyrics: { kind: 'timed' as const, text } } }),
      audio: async () => { calls++; return audio; },
    };
    await assert.rejects(songZip(catalog, '1', new AbortController().signal));
  }
  assert.equal(calls, 0);
});

test('song ZIP checks actual MP3 duration at the packaging boundary even for a trusted catalog', async () => {
  const { SongError } = await import('../src/songs');
  let calls = 0;
  const catalog = {
    status: () => ({ configured: true, bundlesEnabled: true }),
    search: async () => [],
    detail: async () => ({ downloadUrl: null, track: { provider: 'artist' as const, id: '1', title: '歌', artist: '歌手', album: '', duration: 4,
      availability: 'ready' as const, sourceUrl: 'https://example.com', licenseUrl: null, previewUrl: null,
      lyrics: { kind: 'timed' as const, text: '[offset:-150]\n[00:01]开头\n[00:03.10]结尾' } } }),
    audio: async () => { calls++; return audio; },
  };
  await assert.rejects(songZip(catalog, '1', new AbortController().signal), (e: unknown) => e instanceof SongError && e.status === 409 && /实际音频/.test(e.message));
  assert.equal(calls, 1);
});

test('song ZIP and batch retain valid offset timing and include simplified glyph review in the manifest', async t => {
  const { state, app } = setup(t);
  const server = await app();
  const timed = '\ufeff[ar:測試]\r\n[offset:-150]\r\n[00:01]望著妳\r\n[00:02.70]作曲：顧嘉煇';
  state.row.lyrics = timed;
  const item = (await server.inject('/api/songs?q=光')).json().tracks[0];
  const response = await server.inject({ method: 'POST', url: downloadPath });
  assert.equal(response.statusCode, 200, response.body.slice(0, 120));
  const zip = await JSZip.loadAsync(response.rawPayload);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(manifest.lyrics.kind, 'timed');
  assert.deepEqual(manifest.lyrics.residualGlyphs, ['煇']);
  assert.equal(await zip.file(manifest.lyrics.file)!.async('string'), timed.replace('望著妳', '望着你').replace('顧嘉煇', '顾嘉煇'));
  const batch = await prepareSongBatch([item], new AbortController().signal, () => {}, async () =>
    new Response(new Uint8Array(response.rawPayload), { headers: { 'content-type': 'application/zip' } }));
  assert.equal(batch.completed.length, 1, batch.error?.message);
  assert.deepEqual(batch.residualGlyphs, ['煇']);
});
