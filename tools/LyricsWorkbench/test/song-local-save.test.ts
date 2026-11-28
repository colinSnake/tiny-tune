import { mp3Payload } from '../src/song-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { saveSongLocally } from '../src/song-local-save';
import type { SongDetail } from '../src/song-types';

const track: SongDetail = { provider: 'artist', id: '12', title: '原创歌', artist: '原创歌手', album: '真实发行', releaseId: 'release-1', duration: 8, availability: 'ready', sourceUrl: 'https://example.com/song', licenseUrl: null, previewUrl: null, lyrics: { kind: 'timed', text: '[00:01]原创词' } };
const frame = Buffer.alloc(417);
frame.set([0xff, 0xfb, 0x90, 0x64]);
const audio = Buffer.concat(Array.from({ length: 306 }, () => frame));
test('local download preserves artist and verified release folders and never overwrites existing audio or lyrics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-song-save-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await saveSongLocally(root, track, audio);
  assert.equal(result.status, 'saved');
  assert.equal(result.audio, '原创歌手/真实发行/原创歌.mp3');
  assert.deepEqual(await readFile(join(root, result.audio!)), audio);
  assert.equal(await readFile(join(root, result.lyrics!), 'utf8'), track.lyrics!.text);
  assert.equal((await saveSongLocally(root, track, Buffer.from('changed'))).status, 'exists');
  assert.deepEqual(await readFile(join(root, result.audio!)), audio);
  assert.ok(!(await readdir(join(root, '原创歌手/真实发行'))).some(file => file.endsWith('.tmp')));
});
test('local download rejects symlink destinations and unverified recordings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-song-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'outside'));
  await symlink(join(root, 'outside'), join(root, track.artist));
  await assert.rejects(saveSongLocally(root, track, audio));
  assert.deepEqual(await readdir(join(root, 'outside')), []);
  await assert.rejects(saveSongLocally(root, { ...track, availability: 'stream-only' }, audio));
});

test('the local song API requires same-origin loopback, rechecks source permissions and exposes server-owned lyric search', async t => {
  const { createServer } = await import('../src/server');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-api-song-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = { ...track, provider: 'jamendo' as const, lyrics: { kind: 'timed' as const, text: '[00:01]原創詞' } };
  let available = true, audioRequests = 0;
  const app = await createServer({ localLibraryRoot: root,
    songs: { status: () => ({ configured: true, bundlesEnabled: true }), search: async () => [record],
      detail: async () => ({ track: { ...record, availability: available ? 'ready' : 'stream-only' }, downloadUrl: null }),
      audio: async () => { audioRequests++; return audio; } },
    localLyricSearch: async () => [{ id: 17, title: track.title, artist: track.artist, album: track.album, duration: 8, instrumental: false, synced: '[00:01]原创查询词', plain: '' }],
  });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1:9120', origin: 'http://127.0.0.1:9120' };
  const call = (suffix: string, h = headers) => app.inject({ method: 'POST', url: `/api/songs/jamendo/12/${suffix}`, headers: h, payload: {} });
  assert.equal((await call('save', { host: headers.host, origin: 'https://outside.example' })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/songs/jamendo/12/save', headers: { host: headers.host } })).statusCode, 403);
  const lyrics = await call('lyrics');
  assert.equal(lyrics.statusCode, 200);
  assert.equal(lyrics.json().result.status, 'timed');
  available = false;
  assert.equal((await call('save')).statusCode, 409);
  assert.equal(audioRequests, 0);
  available = true;
  const saved = await call('save');
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().status, 'saved');
  assert.equal(await readFile(join(root, saved.json().lyrics), 'utf8'), '[00:01]原创词');
  assert.equal((await call('save')).json().status, 'exists');
  assert.equal(audioRequests, 1, 'a complete existing save does not fetch audio again');
  assert.deepEqual(await readFile(join(root, saved.json().audio)), audio);
});

test('songs without a verified album use the artist folder and leave legacy downloads in place', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-song-artist-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const video: SongDetail = { ...track, provider: 'bilibili-video', title: '新原创曲', album: '合集 · 投稿：某账号', availability: 'audio-only', lyrics: null };
  const saved = await saveSongLocally(root, video, audio, '001. 新原创曲-原创歌手');
  assert.equal(saved.audio, '原创歌手/新原创曲.mp3');
  await mkdir(join(root, '未归档歌曲'));
  const legacy = '未归档歌曲/003. 已下载原创曲-原创歌手.mp3';
  await writeFile(join(root, legacy), audio);
  assert.deepEqual(await saveSongLocally(root, { ...video, title: '已下载原创曲' }, async () => audio, '003. 已下载原创曲-原创歌手'),
    { status: 'exists', audio: legacy });
  assert.deepEqual(await readdir(join(root, '原创歌手')), ['新原创曲.mp3']);
});

test('only identical audio can receive its verified missing sidecar, including in the old directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-song-sidecar-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const single = { ...track, releaseId: undefined };
  const legacy = '未归档歌曲/原创歌手 - 原创歌';
  await mkdir(join(root, '未归档歌曲'));
  await writeFile(join(root, `${legacy}.mp3`), audio);
  assert.equal((await saveSongLocally(root, single, Buffer.from('other recording'))).status, 'conflict');
  assert.deepEqual(await readdir(join(root, '未归档歌曲')), ['原创歌手 - 原创歌.mp3']);
  assert.deepEqual(await saveSongLocally(root, single, audio), { status: 'lyrics-added', audio: `${legacy}.mp3`, lyrics: `${legacy}.lrc` });
  assert.equal(await readFile(join(root, `${legacy}.lrc`), 'utf8'), track.lyrics!.text);
  assert.deepEqual(await readFile(join(root, `${legacy}.mp3`)), audio);
  assert.deepEqual(await readdir(root), ['未归档歌曲']);
});

test('only-lyrics entries can save under the artist without creating audio, and already-saved lyrics are not overwritten', async t => {
  const { createServer } = await import('../src/server');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-only-lyrics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let text = '[00:01]原創 Intro';
  const intro = { ...track, title: 'Intro', provider: 'lrclib' as const, availability: 'lyrics-only' as const };
  const app = await createServer({ localLibraryRoot: root,
    lyricSongs: { status: () => ({ configured: true, bundlesEnabled: false }), search: async () => [intro],
      detail: async () => ({ track: { ...intro, lyrics: { kind: 'timed', text } }, downloadUrl: null }),
      audio: async () => assert.fail('a lyric-only item should not request audio') },
  });
  t.after(() => app.close());
  const host = '127.0.0.1:9120';
  const call = (origin: string, lyricScript?: string) => app.inject({ method: 'POST', url: '/api/songs/lrclib/12/save', headers: { host, origin }, payload: { lyricScript } });
  assert.equal((await call('https://outside.example')).statusCode, 403);
  assert.equal((await call(`http://${host}`, 'other')).statusCode, 400);
  const saved = await call(`http://${host}`, 'original');
  assert.equal(saved.statusCode, 200);
  const lyrics = '原创歌手/独立歌词/Intro.lrc';
  assert.deepEqual(saved.json(), { status: 'lyrics-saved', lyrics });
  assert.deepEqual(await readdir(join(root, '原创歌手', '独立歌词')), ['Intro.lrc']);
  text = '[00:01]不应覆盖';
  assert.deepEqual((await call(`http://${host}`)).json(), { status: 'exists', lyrics });
  assert.equal(await readFile(join(root, lyrics), 'utf8'), '[00:01]原創 Intro');
});

test('a lone lyric file or an ambiguous sibling audio extension cannot be silently paired or marked downloaded', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-song-conflict-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '原创歌手', '真实发行');
  await mkdir(directory, { recursive: true });
  const stem = join(directory, '原创歌手 - 原创歌');
  await writeFile(`${stem}.lrc`, 'pre-existing words');
  assert.equal((await saveSongLocally(root, track, audio)).status, 'conflict');
  await rm(`${stem}.lrc`);
  await writeFile(`${stem}.mp3`, audio);
  await writeFile(`${stem}.wav`, 'different recording');
  assert.equal((await saveSongLocally(root, track, audio)).status, 'conflict');
  assert.equal(await readFile(`${stem}.wav`, 'utf8'), 'different recording');
});

test('catalog-only items save a vetted lyric without needing a local recording', async t => {
  const { createServer } = await import('../src/server');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-catalog-lyrics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const intro = { id: '21111111-2222-3333-4444-555555555555', title: 'Intro', artist: track.artist, albums: [track.album], duration: 8 };
  const candidate = { id: 99, title: intro.title, artist: intro.artist, album: track.album, duration: 8, instrumental: false, synced: '[00:01]原創 Intro', plain: '' };
  const app = await createServer({ localLibraryRoot: root,
    sources: { artists: async () => [], recordings: async () => ({ tracks: [], total: 0, next: null }),
      collect: async track => ({ track, result: { status: 'review', candidates: [candidate, { ...candidate, id: 100, artist: '另一位歌手' }] } }),
    },
  });
  t.after(() => app.close());
  const host = '127.0.0.1:9120';
  const call = (candidateId?: number) => app.inject({ method: 'POST', url: '/api/local-library/lyrics-only', headers: { host, origin: `http://${host}` }, payload: { track: intro, candidateId } });
  assert.equal((await call()).statusCode, 409);
  assert.equal((await call(100)).statusCode, 409);
  assert.deepEqual(await readdir(root), []);
  const saved = await call(99);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().status, 'lyrics-saved');
  assert.equal(await readFile(join(root, saved.json().lyrics), 'utf8'), '[00:01]原创 Intro');
  assert.equal((await call(99)).json().status, 'exists');
});

test('Bilibili local save requires a deliberate lyric choice when ambiguous and never invents synchronized timing', async t => {
  const { createServer } = await import('../src/server');
  const { BilibiliDiscovery } = await import('../src/bilibili-discovery');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-video-local-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = 'BV1J9oNYhEYT';
  const details = { bvid: id, title: '原创歌手歌曲精选', state: 0, rights: { download: 1 }, pages: [
    { page: 1, cid: 31, part: '01. 晴天-原创歌手', duration: 8 }, { page: 2, cid: 32, part: '02. 雨天-原创歌手', duration: 8 },
    { page: 3, cid: 33, part: '03. 阴天-原创歌手', duration: 8 }, { page: 4, cid: 34, part: '04. 雪天-原创歌手', duration: 8 },
  ] };
  const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0x64]);
  const mp3 = Buffer.concat(Array.from({ length: 306 }, () => frame));
  let audioCalls = 0;
  const bilibiliVideos = new BilibiliDiscovery({ spacing: 0,
    request: async () => Response.json({ code: 0, data: details }),
    media: { available: true, audio: async () => { audioCalls++; return mp3; } },
  });
  const app = await createServer({ bilibiliVideos, localLibraryRoot: root, localLyricSearch: async query => {
    const title = query.split(' ')[0];
    if (title === '阴天') throw new Error('fixture lyric provider unavailable');
    const c = { id: 101, title, artist: track.artist, album: '甲', duration: 8, instrumental: false, synced: '[00:01]原创甲词', plain: '' };
    if (title === '雪天') return [c];
    return [{ ...c, id: 103, artist: '错误歌手' }, c, { ...c, id: 102, album: '乙', duration: 12, synced: '[00:01]原创乙词' }];
  } });
  t.after(() => app.close());
  const host = '127.0.0.1:9120';
  const call = (page: number, candidateId?: number) => app.inject({ method: 'POST', url: `/api/songs/bilibili-video/${id}-${page}/save`,
    headers: { host, origin: `http://${host}` }, payload: { candidateId } });
  const first = await call(1);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().lyricsIssue, 'review');
  assert.equal(first.json().lyrics, undefined);
  assert.equal(audioCalls, 1);
  const existing = await call(1, 102);
  assert.equal(existing.statusCode, 200, existing.body);
  assert.equal(existing.json().status, 'lyrics-added');
  assert.equal(existing.json().lyricsIssue, undefined);
  assert.equal(existing.json().lyricsKind, 'plain');
  assert.equal(await readFile(join(root, existing.json().lyrics), 'utf8'), '原创乙词');
  assert.deepEqual(mp3Payload(await readFile(join(root, existing.json().audio))), mp3);
  assert.equal(audioCalls, 2, 'adding words verifies encoded audio before writing beside a local file');
  const repeated = (await call(1, 102)).json();
  assert.equal(repeated.status, 'exists');
  assert.equal(repeated.lyricsKind, 'plain', 'an existing text-only sidecar must not be reported like a timed one');
  assert.equal(audioCalls, 2, 'complete existing files are never downloaded again');
  assert.deepEqual(await readdir(join(root, '原创歌手')), ['晴天.lrc', '晴天.mp3']);
  const partial = await call(3);
  assert.equal(partial.json().status, 'saved');
  assert.equal(partial.json().lyricsIssue, 'unavailable');
  assert.equal(partial.json().lyrics, undefined);
  const pair = await call(4);
  assert.equal(pair.json().status, 'saved');
  assert.equal(pair.json().lyricsIssue, undefined);
  assert.equal(pair.json().lyricsKind, 'plain');
  assert.equal(await readFile(join(root, pair.json().lyrics), 'utf8'), '原创甲词');
});

test('verified audio with plain source lyrics saves a plain sidecar without inventing timing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-song-plain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await saveSongLocally(root, { ...track, lyrics: { kind: 'plain', text: 'Original words' } }, audio);
  assert.equal(result.status, 'saved');
  assert.equal(result.lyricsIssue, undefined);
  assert.equal(result.lyricsKind, 'plain');
  assert.equal(await readFile(join(root, result.lyrics!), 'utf8'), 'Original words');
  assert.deepEqual(await readdir(join(root, '原创歌手/真实发行')), ['原创歌.lrc', '原创歌.mp3']);
});


test('local save refuses timing markers in a plain lyric payload', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-song-fake-timing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [i, text] of ['[00:01]Unverified timing', 'Words\u2028[00:99]Malformed timing'].entries()) {
    const result = await saveSongLocally(root, { ...track, title: `曲目${i}`, availability: 'audio-only', lyrics: { kind: 'plain', text } }, audio);
    assert.equal(result.status, 'saved');
    assert.equal(result.lyrics, undefined);
    assert.equal(result.lyricsIssue, 'unsynced');
  }
});


test('local save revalidates corrupted or annotated lyric payloads before writing sidecars', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-final-lyric-quality-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    `[00:01]我喜欢你
[00:01]wǒ xǐ huān nǐ`,
    `[00:01]我喜欢你
[00:99]我们一起唱歌`,
    `[00:01]<span>我喜欢你</span>`,
    `[00:01]我喜欢�你`,
    `[00:01]我喜欢${String.fromCharCode(0)}你`,
    `[00:01]` + '词'.repeat(256 * 1024),
  ];
  for (const [i, text] of cases.entries()) {
    const result = await saveSongLocally(root, { ...track, title: `校验${i}`, lyrics: { kind: 'timed', text } }, audio);
    assert.equal(result.status, 'saved');
    assert.equal(result.lyrics, undefined);
    assert.equal(result.lyricsIssue, 'unsynced');
    assert.deepEqual(await readFile(join(root, result.audio!)), audio);
  }
  const plain = await saveSongLocally(root, { ...track, title: '纯文本注音', lyrics: { kind: 'plain', text: `我喜欢你
wǒ xǐ huān nǐ` } }, audio);
  assert.equal(plain.lyrics, undefined);
  assert.equal(plain.lyricsIssue, 'unsynced');
});

test('saving verified MP3 omits a sidecar whose offset-adjusted cues exceed the actual recording', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-offset-save-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  const bytes = Buffer.concat(Array.from({ length: 275 }, () => frame)); // ~7.18 seconds, not the listed 8
  const checked = { ...track, lyrics: { kind: 'timed' as const, text: '[offset:-500]\n[00:01]第一句\n[00:07]第二句' } };
  for (const existing of [false, true]) {
    const song = { ...checked, title: existing ? '已有音频' : '新音频' };
    if (existing) await saveSongLocally(root, { ...song, availability: 'audio-only', lyrics: null }, bytes);
    const result = await saveSongLocally(root, song, async () => bytes);
    assert.equal(result.status, existing ? 'exists' : 'saved');
    assert.equal(result.lyrics, undefined);
    assert.equal(result.lyricsIssue, 'unsynced');
    assert.deepEqual(await readFile(join(root, result.audio!)), bytes);
  }
});
