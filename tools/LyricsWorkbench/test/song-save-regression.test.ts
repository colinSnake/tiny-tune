import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { videoSongIdentity } from '../src/video-lyrics';
import { saveSongLocally } from '../src/song-local-save';
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
  assert.equal(result.audio, '周杰伦/周杰伦 - 晴天.mp3');
  assert.equal(result.lyrics, '周杰伦/周杰伦 - 晴天.lrc');
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
  assert.equal(saved.audio, '周杰伦/周杰伦 - 晴天.mp3');
  assert.equal(saved.lyrics, '周杰伦/周杰伦 - 晴天.lrc');
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
