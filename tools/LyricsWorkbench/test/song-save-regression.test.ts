import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { videoSongIdentity } from '../src/video-lyrics';
import { saveSongLocally } from '../src/song-local-save';
import { tagSongMp3 } from '../src/song-metadata';
import { BilibiliDiscovery } from '../src/bilibili-discovery';
import { createServer } from '../src/server';
import type { SongDetail } from '../src/song-types';
const recording: SongDetail = { provider: 'bilibili-video', id: 'BV1FPjy6TEiE-1', title: '晴天', artist: '周杰伦', album: '合集 · 第 1 P', duration: 270,
  availability: 'audio-only', sourceUrl: 'https://www.bilibili.com/video/BV1FPjy6TEiE/', licenseUrl: null, previewUrl: null, lyrics: null };
test('real Jay Chou numbered posts keep performer and song separate', () => {
  assert.deepEqual(videoSongIdentity('001.周杰伦-晴天', '【周杰伦】50首精选合集/后台播放/无损音质'), { title: '晴天', artist: '周杰伦' });
  assert.deepEqual(videoSongIdentity('1.兰亭序', '【4K Hi-Res】周杰伦无损音质动态歌词合集'), { title: '兰亭序', artist: '周杰伦' });
  assert.deepEqual(videoSongIdentity('周杰倫-七里香'), { title: '七里香', artist: '周杰伦' });
});
test('mixed collections never invent one performer', () => {
  assert.deepEqual(videoSongIdentity('1.兰亭序', '【周杰伦、林俊杰合集】'), { title: '兰亭序', artist: '' });
});
test('an explicitly matched video lyric is saved as plain text without pretending to be synchronized', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-regression-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await saveSongLocally(root, { ...recording, lyrics: { kind: 'plain', text: `測試歌詞
第二行` } }, Buffer.from('fixture-recording'));
  assert.equal(result.audio, '周杰伦/晴天.mp3');
  assert.equal(result.lyrics, '周杰伦/晴天.lrc');
  assert.equal(result.lyricsIssue, undefined);
  assert.equal(await readFile(join(root, result.lyrics!), 'utf8'), `测试歌词
第二行`);
});
test('manually arranged audio remains byte-identical on same-name conflicts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-manual-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '周杰伦'));
  await writeFile(join(root, '周杰伦/周杰伦 - 晴天.mp3'), 'my different recording');
  const result = await saveSongLocally(root, { ...recording, lyrics: { kind: 'plain', text: 'matched words' } }, Buffer.from('provider recording'));
  assert.equal(result.status, 'conflict');
  assert.equal(await readFile(join(root, '周杰伦/周杰伦 - 晴天.mp3'), 'utf8'), 'my different recording');
  assert.deepEqual(await readdir(join(root, '周杰伦')), ['周杰伦 - 晴天.mp3']);
});

async function videoSaveFixture(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-video-dedupe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const audio = (marker: number) => Buffer.concat(Array.from({ length: 306 }, () => {
    const frame = Buffer.alloc(417); frame.set([255, 251, 144, 100]); frame[50] = marker; return frame;
  }));
  const current = audio(1), different = audio(2);
  const track = { provider: 'bilibili-video', id: 'BV1WCdhYgEmm-1', title: '天后', artist: '陈势安' } as const;
  let fetches = 0;
  const bilibiliVideos = new BilibiliDiscovery({ spacing: 0, media: { available: true, audio: async () => { fetches++; return current; } },
    request: async () => Response.json({ code: 0, data: { bvid: 'BV1WCdhYgEmm',
      title: '精选【陈势安】经典歌曲合集！分集播放，带歌词，无损音质，推荐收藏！！！',
      state: 0, rights: { download: 1 }, pages: [{ page: 1, cid: 31, part: '天后-陈势安', duration: 8 },
        { page: 2, cid: 32, part: '心之所往-陈势安', duration: 8 }] } }) });
  const app = await createServer({ bilibiliVideos, localLibraryRoot: root, localLyricSearch: async () => [] });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1:9120', origin: 'http://127.0.0.1:9120' };
  const place = async (folder: string, name: string, bytes: Buffer) => {
    const dir = join(root, folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.mp3`), bytes);
    await writeFile(join(dir, `${name}.lrc`), '测试原歌词');
  };
  const save = async () => {
    const res = await app.inject({ method: 'POST', url: `/api/songs/${track.provider}/${track.id}/save`, headers, payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  };
  return { root, track, current, different, place, save, fetches: () => fetches };
}

test('a source-tagged video with wrong legacy title and artist is reused at its actual location', async t => {
  const f = await videoSaveFixture(t);
  const old = tagSongMp3(f.current, { ...f.track, title: '天后-陈势安', artist: '经典' });
  await f.place('旧分类', '我改过的文件名', old);
  assert.deepEqual(await f.save(), { status: 'exists', audio: '旧分类/我改过的文件名.mp3', lyrics: '旧分类/我改过的文件名.lrc', lyricsKind: 'plain' });
  assert.equal(f.fetches(), 0);
  assert.deepEqual(await readdir(f.root), ['旧分类']);
  assert.deepEqual(await readFile(join(f.root, '旧分类/我改过的文件名.mp3')), old);
});

test('multiple copies with the same source ID are flagged without writing or choosing a path', async t => {
  const f = await videoSaveFixture(t);
  const old = tagSongMp3(f.current, { ...f.track, artist: '旧署名' });
  await f.place('旧目录一', '文件一', old);
  await f.place('旧目录二', '文件二', old);
  assert.deepEqual(await f.save(), { status: 'conflict' });
  assert.equal(f.fetches(), 0);
  assert.deepEqual((await readdir(f.root)).sort(), ['旧目录一', '旧目录二']);
});

test('an equally long recording from a different video is not mistaken for the requested video', async t => {
  const f = await videoSaveFixture(t);
  const other = tagSongMp3(f.different, { ...f.track, id: 'BV1FPjy6TEiE-1' });
  await f.place('收藏', '另一个版本', other);
  const result = await f.save();
  assert.equal(result.status, 'saved');
  assert.equal(result.audio, '陈势安/天后.mp3');
  assert.equal(f.fetches(), 1);
  assert.deepEqual(await readFile(join(f.root, '收藏/另一个版本.mp3')), other);
});

test('a different recording in the intended slot is a conflict even if it already has a sidecar', async t => {
  const f = await videoSaveFixture(t);
  const other = tagSongMp3(f.different, { title: f.track.title, artist: f.track.artist });
  await f.place('陈势安', '天后', other);
  assert.deepEqual(await f.save(), { status: 'conflict' });
  assert.equal(f.fetches(), 1);
  assert.deepEqual(await readFile(join(f.root, '陈势安/天后.mp3')), other);
  assert.equal(await readFile(join(f.root, '陈势安/天后.lrc'), 'utf8'), '测试原歌词');
});

test('an untagged copy moved by the user is reused only after comparing its MP3 audio', async t => {
  const f = await videoSaveFixture(t);
  const metadata = { title: f.track.title, artist: f.track.artist };
  await f.place('收藏', '一个副本', tagSongMp3(f.current, metadata));
  await f.place('收藏', '另一录音', tagSongMp3(f.different, metadata));
  assert.deepEqual(await f.save(), { status: 'exists', audio: '收藏/一个副本.mp3', lyrics: '收藏/一个副本.lrc', lyricsKind: 'plain' });
  assert.equal(f.fetches(), 1);
  assert.deepEqual(await readdir(f.root), ['收藏']);
});

test('a real video save embeds title, artist and post cover and follows a manually renamed copy', async t => {
  const { BilibiliDiscovery } = await import('../src/bilibili-discovery');
  const { createServer } = await import('../src/server');
  const { parseBuffer } = await import('music-metadata');
  const { rename } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const frame = Buffer.alloc(417); frame.set([255, 251, 144, 100]);
  const audio = Buffer.concat(Array.from({ length: 306 }, () => frame));
  const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/c2kAAAAASUVORK5CYII=', 'base64');
  let audioRequests = 0;
  const discovery = new BilibiliDiscovery({ spacing: 0, media: { available: true, audio: async () => { audioRequests++; return audio; } },
    request: async input => {
      const url = new URL(String(input));
      if (url.hostname === 'i0.hdslb.com') return new Response(new Uint8Array(cover), { headers: { 'content-type': 'image/png' } });
      return Response.json({ code: 0, data: { bvid: 'BV1FPjy6TEiE', title: '周杰伦-晴天', pic: 'http://i0.hdslb.com/bfs/archive/test.png',
        state: 0, rights: { download: 1 }, pages: [{ page: 1, cid: 31, part: '周杰伦-晴天', duration: 8 }] } });
    } });
  const app = await createServer({ bilibiliVideos: discovery, localLibraryRoot: root,
    localLyricSearch: async () => [{ id: 101, title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 8, instrumental: false, synced: '[00:01]測試歌詞', plain: '' }] });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1:9120', origin: 'http://127.0.0.1:9120' };
  const save = () => app.inject({ method: 'POST', url: '/api/songs/bilibili-video/BV1FPjy6TEiE-1/save', headers, payload: {} });
  const response = await save();
  assert.equal(response.statusCode, 200, response.body);
  const saved = response.json();
  assert.equal(saved.audio, '周杰伦/晴天.mp3');
  assert.equal(saved.lyrics, '周杰伦/晴天.lrc');
  assert.equal(saved.lyricsKind, 'plain');
  assert.equal(await readFile(join(root, saved.lyrics), 'utf8'), '测试歌词');
  const { LocalMusicLibrary } = await import('../src/local-library');
  const library = new LocalMusicLibrary(root, async () => []);
  const scanned = await library.search(['周杰伦']);
  assert.equal(scanned.tracks[0].confirmTiming, true, 'tagged video downloads must retain the unverified-timing safety boundary');
  const bytes = await readFile(join(root, saved.audio));
  const metadata = await parseBuffer(bytes, { mimeType: 'audio/mpeg' });
  assert.equal(metadata.common.title, '晴天');
  assert.equal(metadata.common.artist, '周杰伦');
  assert.equal(metadata.common.picture?.[0].format, 'image/png');
  assert.deepEqual(metadata.common.picture?.[0].data, new Uint8Array(cover));
  await mkdir(join(root, '周杰伦/我的收藏'));
  await rename(join(root, saved.audio), join(root, '周杰伦/我的收藏/晴天（自定义）.mp3'));
  await rename(join(root, saved.lyrics), join(root, '周杰伦/我的收藏/晴天（自定义）.lrc'));
  const again = await save();
  assert.equal(again.json().status, 'exists', again.body);
  assert.equal(again.json().audio, '周杰伦/我的收藏/晴天（自定义）.mp3');
  assert.deepEqual(await readFile(join(root, again.json().audio)), bytes);
  assert.equal(audioRequests, 1, 'a renamed complete recording must not be downloaded again');
});

test('unidentified video performers are rejected instead of creating an unknown artist folder', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-unknown-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(saveSongLocally(root, { ...recording, artist: '' }, Buffer.from('audio')), /歌手/);
  assert.deepEqual(await readdir(root), []);
});

test('an explicitly credited decorated single uses song credits rather than the upload headline for saving', async () => {
  const { BilibiliDiscovery } = await import('../src/bilibili-discovery');
  const discovery = new BilibiliDiscovery({ spacing: 0, media: { available: true, audio: async () => Buffer.from('audio') },
    request: async () => Response.json({ code: 0, data: { bvid: 'BV1FPjy6TEiE', title: '【4K Hi-Res】《告白气球》——周杰伦',
      state: 0, rights: { download: 1 }, pages: [{ page: 1, cid: 31, part: '告白气球', duration: 214 }] } }) });
  const { track } = await discovery.mp3Source('BV1FPjy6TEiE-1', new AbortController().signal);
  assert.equal(track.artist, '周杰伦');
  assert.equal(track.title, '告白气球');
});

test('cover URLs cannot reach arbitrary hosts, local addresses or redirects', async () => {
  const { bilibiliCoverUrl } = await import('../src/song-metadata');
  for (const url of ['http://127.0.0.1/private.jpg', 'https://evil.example/a.png', 'https://i0.hdslb.com@evil.example/bfs/a.jpg',
    'https://i0.hdslb.com:9443/bfs/a.jpg', 'file:///etc/passwd']) assert.equal(bilibiliCoverUrl(url), undefined);
  assert.equal(bilibiliCoverUrl('http://i0.hdslb.com/bfs/archive/a.jpg'), 'https://i0.hdslb.com/bfs/archive/a.jpg');
});

test('legacy untagged artist-prefixed filenames remain discoverable after manual moves', async t => {
  const { LocalMusicLibrary } = await import('../src/local-library');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-legacy-moved-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '周杰伦/我的收藏'), { recursive: true });
  const frame = Buffer.alloc(417); frame.set([255, 251, 144, 100]);
  await writeFile(join(root, '周杰伦/我的收藏/周杰伦-七里香.mp3'), Buffer.concat(Array.from({ length: 306 }, () => frame)));
  const scanned = await new LocalMusicLibrary(root, async () => []).search(['周杰伦']);
  assert.equal(scanned.tracks[0].title, '七里香');
  assert.equal(scanned.tracks[0].file, '周杰伦/我的收藏/周杰伦-七里香.mp3');
  assert.equal(scanned.tracks[0].confirmTiming, true);
});

test('an invalid or unavailable post cover does not prevent tagged audio or write invalid pictures', async () => {
  const { BilibiliDiscovery } = await import('../src/bilibili-discovery');
  const { parseBuffer } = await import('music-metadata');
  for (const mode of ['invalid', 'unavailable', 'untrusted']) {
    let coverRequests = 0;
    const frame = Buffer.alloc(417); frame.set([255, 251, 144, 100]);
    const bytes = Buffer.concat(Array.from({ length: 306 }, () => frame));
    const discovery = new BilibiliDiscovery({ spacing: 0, media: { available: true, audio: async () => bytes }, request: async input => {
      const url = new URL(String(input));
      if (url.pathname.startsWith('/bfs/')) {
        coverRequests++;
        return mode === 'invalid' ? new Response('html, not an image', { headers: { 'content-type': 'image/jpeg' } }) : new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
      }
      return Response.json({ code: 0, data: { bvid: 'BV1FPjy6TEiE', title: '周杰伦-晴天', pic: mode === 'untrusted' ? 'http://127.0.0.1/bfs/a.jpg' : 'https://i0.hdslb.com/bfs/a.jpg',
        state: 0, rights: { download: 1 }, pages: [{ page: 1, cid: 31, part: '晴天', duration: 8 }] } });
    } });
    const source = await discovery.mp3Source('BV1FPjy6TEiE-1', new AbortController().signal);
    const metadata = await parseBuffer(await source.audio(), { mimeType: 'audio/mpeg' });
    assert.equal(metadata.common.artist, '周杰伦');
    assert.equal(metadata.common.picture?.length ?? 0, 0);
    assert.equal(source.coverIssue, mode === 'untrusted' ? 'missing' : 'unavailable');
    assert.equal(coverRequests, mode === 'untrusted' ? 0 : 1);
  }
});

test('a credited 许嵩 collection saves 素颜 by title and recognizes the old tagged filename', async t => {
  const { BilibiliDiscovery } = await import('../src/bilibili-discovery');
  const { createServer } = await import('../src/server');
  const { tagSongMp3 } = await import('../src/song-metadata');
  const { parseBuffer } = await import('music-metadata');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-duet-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const frame = Buffer.alloc(417); frame.set([255, 251, 144, 100]);
  const bytes = Buffer.concat(Array.from({ length: 306 }, () => frame));
  const bvid = 'BV1k3411f7mX', id = `${bvid}-3`;
  let downloads = 0;
  const discovery = new BilibiliDiscovery({ spacing: 0, media: { available: true, audio: async () => { downloads++; return bytes; } },
    request: async () => Response.json({ code: 0, data: { bvid, title: '许嵩经典歌曲合集', state: 0, rights: { download: 1 },
      pages: [{ page: 1, cid: 1, part: '灰色头像', duration: 8 }, { page: 3, cid: 3, part: '素颜-许嵩/何曼婷', duration: 8 }] } }) });
  const app = await createServer({ bilibiliVideos: discovery, localLibraryRoot: root,
    localLyricSearch: async () => [{ id: 31, title: '素颜', artist: '许嵩', album: '', duration: 8, instrumental: false, synced: '', plain: '合成测试唱词' }] });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1:9120', origin: 'http://127.0.0.1:9120' };
  const request = (mode: string) => app.inject({ method: 'POST', url: `/api/songs/bilibili-video/${id}/${mode}`, headers, payload: {} });
  const detail = await app.inject({ url: `/api/songs/bilibili-video/${id}` });
  assert.equal(detail.json().track.title, '素颜');
  const result = await request('save');
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().audio, '许嵩/素颜.mp3');
  assert.equal(result.json().lyrics, '许嵩/素颜.lrc');
  assert.equal(await readFile(join(root, '许嵩/素颜.lrc'), 'utf8'), '合成测试唱词');
  const embedded = await parseBuffer(await readFile(join(root, '许嵩/素颜.mp3')), { mimeType: 'audio/mpeg' });
  assert.equal(embedded.common.title, '素颜');
  assert.equal(embedded.common.artist, '许嵩');
  const attachment = await request('mp3');
  assert.equal(attachment.statusCode, 200, attachment.body);
  assert.match(decodeURIComponent(String(attachment.headers['content-disposition'])), /filename\*=UTF-8''素颜\.mp3$/);

  await rm(join(root, '许嵩/素颜.mp3'));
  await rm(join(root, '许嵩/素颜.lrc'));
  const legacyStem = '许嵩/收藏/许嵩 - 素颜-许嵩 何曼婷';
  await mkdir(join(root, '许嵩/收藏'));
  await writeFile(join(root, `${legacyStem}.mp3`), tagSongMp3(bytes, { title: '素颜-许嵩/何曼婷', artist: '许嵩', id, provider: 'bilibili-video' }));
  await writeFile(join(root, `${legacyStem}.lrc`), '已有歌词');
  const again = (await request('save')).json();
  assert.equal(again.status, 'exists');
  assert.equal(again.audio, `${legacyStem}.mp3`);
  assert.equal(await readFile(join(root, again.lyrics), 'utf8'), '已有歌词');
  assert.equal(downloads, 2, 'one local save and one browser attachment; no download for the existing copy');
  assert.deepEqual(await readdir(join(root, '许嵩')), ['收藏']);
});

test('credit parsing leaves an uncredited slash title and a recording version intact', async () => {
  const { videoSongIdentity } = await import('../src/video-lyrics');
  const album = '许嵩经典歌曲合集';
  assert.deepEqual(videoSongIdentity('黑/白 - 许嵩', album), { title: '黑/白', artist: '许嵩' });
  assert.deepEqual(videoSongIdentity('许嵩/何曼婷 - 素颜（Live）', album), { title: '素颜（Live）', artist: '许嵩' });
  assert.deepEqual(videoSongIdentity('灰色头像 - 无损/高清', album), { title: '灰色头像 - 无损/高清', artist: '许嵩' });
});

test('the 陈势安 collection saves 天后 under the credited artist, not the tag 经典', async t => {
  const { BilibiliDiscovery } = await import('../src/bilibili-discovery');
  const { createServer } = await import('../src/server');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-chen-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bvid = 'BV1WCdhYgEmm';
  const discovery = new BilibiliDiscovery({ spacing: 0, media: { available: true, audio: async () => Buffer.from('test MP3 payload') },
    request: async () => Response.json({ code: 0, data: { bvid, state: 0, rights: { download: 1 },
      title: '精选【陈势安】经典歌曲合集！分集播放，带歌词，无损音质，推荐收藏！！！',
      pages: [{ page: 1, cid: 11, part: '天后-陈势安', duration: 291 }, { page: 2, cid: 12, part: '心之所往 - 陈势安-', duration: 184 }] } }) });
  const app = await createServer({ bilibiliVideos: discovery, localLibraryRoot: root, localLyricSearch: async () => [] });
  t.after(() => app.close());
  const result = await app.inject({ method: 'POST', url: `/api/songs/bilibili-video/${bvid}-1/save`,
    headers: { host: '127.0.0.1:9120', origin: 'http://127.0.0.1:9120' }, payload: {} });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().audio, '陈势安/天后.mp3');
  assert.deepEqual(await readdir(root), ['陈势安']);
  assert.deepEqual(await readdir(join(root, '陈势安')), ['天后.mp3']);
});

test('a Zhang Jie part credit is not overwritten by a song name in the collection title', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-zhangjie-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bvid = 'BV1zJieTes01';
  const frame = Buffer.alloc(417); frame.set([255, 251, 144, 100]);
  const bytes = Buffer.concat(Array.from({ length: 306 }, () => frame));
  const discovery = new BilibiliDiscovery({ spacing: 0, media: { available: true, audio: async () => bytes },
    request: async () => Response.json({ code: 0, data: { bvid, title: '铭记华语歌曲合集', state: 0, rights: { download: 1 },
      pages: [{ page: 1, cid: 31, part: '张杰 - 铭记', duration: 250 }, { page: 2, cid: 32, part: '张杰 - 天下', duration: 219 }] } }) });
  const app = await createServer({ bilibiliVideos: discovery, localLibraryRoot: root, localLyricSearch: async () => [] });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1:9120', origin: 'http://127.0.0.1:9120' };
  const detail = await app.inject({ url: `/api/songs/bilibili-video/${bvid}-1` });
  assert.equal(detail.json().track.title, '铭记');
  assert.equal(detail.json().track.artist, '张杰');
  const saved = await app.inject({ method: 'POST', url: `/api/songs/bilibili-video/${bvid}-1/save`, headers, payload: {} });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().audio, '张杰/铭记.mp3');
  const { parseBuffer } = await import('music-metadata');
  const metadata = await parseBuffer(await readFile(join(root, '张杰/铭记.mp3')), { mimeType: 'audio/mpeg' });
  assert.equal(metadata.common.title, '铭记');
  assert.equal(metadata.common.artist, '张杰');
});

test('an unspaced Wang Leehom single credit is recognized and saved under the artist folder', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-wang-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bvid = 'BV1WangLiHon';
  const discovery = new BilibiliDiscovery({ spacing: 0, media: { available: true, audio: async () => Buffer.from('test MP3 payload') },
    request: async input => new URL(String(input)).pathname === '/x/web-interface/search/all/v2'
      ? Response.json({ code: 0, data: { result: [{ result_type: 'video', data: [{ bvid, title: '天地龙鳞-王力宏', typename: '音乐综合', duration: '3:37', author: '测试投稿者' }] }] } })
      : Response.json({ code: 0, data: { bvid, state: 0, rights: { download: 1 }, title: '天地龙鳞-王力宏',
        pages: [{ page: 1, cid: 11, part: '天地龙鳞-王力宏', duration: 217 }] } }) });
  const app = await createServer({ bilibiliVideos: discovery, localLibraryRoot: root, localLyricSearch: async () => [] });
  t.after(() => app.close());
  const search = await app.inject(`/api/songs?source=bilibili-video&q=${encodeURIComponent('天地龙鳞-王力宏')}`);
  assert.equal(search.json().tracks[0].title, '天地龙鳞');
  assert.equal(search.json().tracks[0].artist, '王力宏');
  const headers = { host: '127.0.0.1:9120', origin: 'http://127.0.0.1:9120' };
  const detail = await app.inject({ url: `/api/songs/bilibili-video/${bvid}-1` });
  assert.equal(detail.json().track.title, '天地龙鳞');
  assert.equal(detail.json().track.artist, '王力宏');
  const saved = await app.inject({ method: 'POST', url: `/api/songs/bilibili-video/${bvid}-1/save`, headers, payload: {} });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().audio, '王力宏/天地龙鳞.mp3');
  assert.deepEqual(await readdir(root), ['王力宏']);
});

test('an uncredited Bilibili source saves to the confirmed artist folder without changing source credit', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-save-hinted-artist-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bvid = 'BV1FPjy6TEiE';
  const frame = Buffer.alloc(417); frame.set([255, 251, 144, 100]);
  const audio = Buffer.concat(Array.from({ length: 306 }, () => frame));
  let audioCalls = 0;
  let lyricsAvailable = false;
  const lyricQueries: string[] = [];
  const discovery = new BilibiliDiscovery({ spacing: 0,
    media: { available: true, audio: async () => { audioCalls++; return audio; } },
    request: async () => Response.json({ code: 0, data: { bvid, title: 'Believer', state: 0, rights: { download: 1 },
      pages: [{ page: 1, cid: 31, part: 'Believer', duration: 204 }] } }),
  });
  const app = await createServer({ bilibiliVideos: discovery, localLibraryRoot: root,
    localLyricSearch: async query => {
      lyricQueries.push(query);
      return lyricsAvailable ? [{ id: 101, title: 'Believer', artist: 'Imagine Dragons', album: 'Night Visions', duration: 204,
        instrumental: false, synced: '', plain: 'First line\nSecond line' }] : [];
    } });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1:9120', origin: 'http://127.0.0.1:9120' };
  const save = (payload: { saveArtistHint?: string; confirmUncreditedSave?: boolean }) => app.inject({ method: 'POST', url: `/api/songs/bilibili-video/${bvid}-1/save`, headers, payload });

  const unconfirmed = await save({ saveArtistHint: 'Imagine Dragons' });
  assert.equal(unconfirmed.statusCode, 409);
  assert.equal(audioCalls, 0, 'unconfirmed saves must not fetch audio');
  assert.deepEqual(await readdir(root), []);

  const arbitrary = await save({ saveArtistHint: 'Other Artist', confirmUncreditedSave: true });
  assert.equal(arbitrary.statusCode, 409, 'only an allowlisted search alias can select the destination');
  assert.equal(audioCalls, 0);

  const noLyrics = await save({ saveArtistHint: 'Imagine Dragons', confirmUncreditedSave: true });
  assert.equal(noLyrics.statusCode, 409, 'an uncredited save must not leave an audio-only partial library entry');
  assert.equal(audioCalls, 0);
  assert.deepEqual(await readdir(root), []);

  lyricsAvailable = true;
  const saved = await save({ saveArtistHint: 'Imagine Dragons', confirmUncreditedSave: true });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().audio, 'Imagine Dragons/Believer.mp3');
  assert.equal(saved.json().lyrics, 'Imagine Dragons/Believer.lrc');
  assert.equal(saved.json().lyricsKind, 'plain');
  assert.equal(await readFile(join(root, saved.json().lyrics), 'utf8'), 'First line\nSecond line');
  assert.equal(audioCalls, 1);
  assert.deepEqual(lyricQueries, ['Believer Imagine Dragons', 'Believer Imagine Dragons']);
  const { track: sourceTrack } = await discovery.detail(`${bvid}-1`, new AbortController().signal);
  assert.equal(sourceTrack.artist, '', 'the search hint must not become the source recording credit');
  assert.deepEqual(await readdir(join(root, 'Imagine Dragons')), ['Believer.lrc', 'Believer.mp3']);
});
