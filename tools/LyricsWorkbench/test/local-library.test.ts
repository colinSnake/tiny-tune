import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createServer } from '../src/server';
import { activeIndex, parseLrc } from '../src/lrc';
import type { LyricCandidate } from '../src/types';

const headers = { host: '127.0.0.1:9120', origin: 'http://127.0.0.1:9120' };
const text = '[00:01.25]Original fixture line\n[00:06.00]Second fixture line';
const candidate: LyricCandidate = { id: 1001, title: 'Local Song', artist: 'Local Singer', album: 'Internal Tag', duration: 8, instrumental: false, synced: text, plain: '' };

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(type), len, data, Buffer.alloc(data.length % 2)]);
}

function wav(title: string, artist = candidate.artist, album = candidate.album, encoding: BufferEncoding = 'utf8') {
  const fmt = Buffer.from('01000100401f0000803e000002001000', 'hex');
  const tag = (key: string, value: string) => chunk(key, Buffer.from(value + '\0', encoding));
  return chunk('RIFF', Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt),
    chunk('LIST', Buffer.concat([Buffer.from('INFO'), tag('INAM', title), tag('IART', artist), tag('IPRD', album)])),
    chunk('data', Buffer.alloc(8000 * 2 * 8))]));
}

async function fixture(t: TestContext, options: { online?: LyricCandidate[]; offline?: boolean; extra?: (dir: string) => Promise<void> } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'tinytune-local-'));
  const root = join(parent, 'library');
  const dir = join(root, '真实歌手', '实际专辑');
  await mkdir(dir, { recursive: true });
  t.after(() => rm(parent, { recursive: true, force: true }));
  const audio = wav(candidate.title);
  const file = join(dir, '01 原文件名.wav');
  const lyrics = join(dir, '01 原文件名.lrc');
  await writeFile(file, audio);
  await options.extra?.(dir);
  // Outside the workbench's configured root, even if it looks like a valid recording.
  await writeFile(join(parent, 'outside.wav'), audio);
  await symlink(join(parent, 'outside.wav'), join(root, 'outside.wav'));
  const searches: string[] = [];
  const app = await createServer({ localLibraryRoot: root, localLyricSearch: async q => {
    searches.push(q);
    if (options.offline) throw new Error('Fixture upstream unavailable');
    return options.online ?? [candidate];
  } });
  t.after(() => app.close());
  const search = (q = 'Local Singer') => app.inject({ method: 'GET', url: `/api/local-library?q=${encodeURIComponent(q)}`, headers });
  const lookup = (id: string, searchTiming?: boolean) => app.inject({ method: 'POST', url: `/api/local-library/${id}/lyrics`, headers,
    payload: searchTiming ? { searchTiming } : {} });
  const save = (id: string, candidateId: number, confirmed = false) => app.inject({ method: 'POST', url: '/api/local-library/save', headers,
    payload: { tracks: [{ id, candidateId, confirmed }] } });
  return { app, root, dir, file, lyrics, audio, search, lookup, save, searches };
}

test('local artist search reads real audio tags but reports the actual directory; verified LRC saves next to the untouched audio', async t => {
  const f = await fixture(t);
  const res = await f.search();
  assert.equal(res.statusCode, 200);
  const { enabled, tracks } = res.json();
  assert.equal(enabled, true);
  assert.equal(tracks.length, 1);
  const [track] = tracks;
  assert.equal(track.title, candidate.title);
  assert.equal(track.duration, 8);
  assert.equal(track.file, '真实歌手/实际专辑/01 原文件名.wav');
  assert.deepEqual((await f.search('another singer')).json().tracks, []);
  const match = await f.lookup(track.id);
  assert.equal(match.statusCode, 200);
  assert.equal(match.json().result.status, 'timed');
  assert.deepEqual(f.searches, ['Local Song Local Singer']);
  const saved = await f.save(track.id, candidate.id);
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().results, [{ id: track.id, status: 'saved', file: '真实歌手/实际专辑/01 原文件名.lrc' }]);
  assert.equal((await readFile(f.lyrics, 'utf8')).trim(), text);
  assert.deepEqual(await readFile(f.file), f.audio);
  await writeFile(f.lyrics, 'keep me');
  assert.equal((await f.save(track.id, candidate.id)).json().results[0].status, 'exists');
  assert.equal(await readFile(f.lyrics, 'utf8'), 'keep me');
});

test('needs a fresh real candidate and explicit confirmation for a version mismatch; mismatched durations cannot be saved', async t => {
  const manual = { ...candidate, album: 'Compilation' };
  const wrong = { ...candidate, id: 1002, duration: 43 };
  const f = await fixture(t, { online: [manual, wrong] });
  const [{ id }] = (await f.search()).json().tracks;
  assert.equal((await f.save(id, candidate.id, true)).json().results[0].status, 'review');
  assert.equal((await f.lookup(id)).json().result.status, 'review');
  for (const [choice, confirmed] of [[candidate.id, false], [999, true], [wrong.id, true]] as const) {
    assert.equal((await f.save(id, choice, confirmed)).json().results[0].status, 'review');
  }
  await assert.rejects(readFile(f.lyrics), { code: 'ENOENT' });
  assert.equal((await f.save(id, manual.id, true)).json().results[0].status, 'saved');
});

test('local-only routes enforce same-origin, serve bounded audio ranges, and reject a replaced recording', async t => {
  const f = await fixture(t);
  assert.equal((await f.app.inject({ url: '/api/local-library?q=x', headers: { host: 'untrusted.example' } })).statusCode, 403);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/local-library/save', headers: { ...headers, origin: 'http://localhost:9999' }, payload: {} })).statusCode, 403);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/local-library/save', headers: { host: headers.host }, payload: {} })).statusCode, 403);
  const [{ id }] = (await f.search()).json().tracks;
  const audio = `/api/local-library/${id}/audio`;
  const range = await f.app.inject({ url: audio, headers: { ...headers, range: 'bytes=2-9' } });
  assert.equal(range.statusCode, 206);
  assert.deepEqual(range.rawPayload, f.audio.subarray(2, 10));
  assert.equal(range.headers['content-range'], `bytes 2-9/${f.audio.length}`);
  assert.equal((await f.app.inject({ url: audio, headers: { ...headers, range: 'bytes=9999999-' } })).statusCode, 416);
  assert.equal((await f.app.inject({ url: audio, headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
  await f.lookup(id);
  await rename(f.file, f.file + '.old');
  await writeFile(f.file, wav('replacement'));
  assert.equal((await f.app.inject({ url: audio, headers })).statusCode, 404);
  assert.equal((await f.save(id, candidate.id)).json().results[0].status, 'changed');
  await assert.rejects(readFile(f.lyrics), { code: 'ENOENT' });
});

test('refuses ambiguous sibling audio names, respects uppercase existing lyrics and reports partial batch successes', async t => {
  const f = await fixture(t, { extra: async dir => {
    await writeFile(join(dir, '01 原文件名.flac'), 'not actually music');
    await writeFile(join(dir, '02 已有.wav'), wav(candidate.title));
    await writeFile(join(dir, '02 已有.LRC'), 'existing upper case');
    await writeFile(join(dir, '03 可写.wav'), wav(candidate.title));
  } });
  const { tracks } = (await f.search()).json();
  assert.equal(tracks.length, 3);
  for (const track of tracks) await f.lookup(track.id);
  const res = await f.app.inject({ method: 'POST', url: '/api/local-library/save', headers,
    payload: { tracks: tracks.map(({ id }: { id: string }) => ({ id, candidateId: candidate.id, confirmed: false })) } });
  assert.equal(res.statusCode, 200);
  const statuses = Object.fromEntries(res.json().results.map((row: { id: string; status: string }) => [row.id, row.status]));
  // No explicit timing request was made for the existing plain file, so no write was approved.
  for (const track of tracks) assert.equal(statuses[track.id], track.file.includes('01 ') ? 'ambiguous' : track.file.includes('02 ') ? 'review' : 'saved');
  assert.equal(await readFile(join(f.dir, '02 已有.LRC'), 'utf8'), 'existing upper case');
  assert.equal((await readFile(join(f.dir, '03 可写.lrc'), 'utf8')).trim(), text);
  await assert.rejects(readFile(f.lyrics), { code: 'ENOENT' });
});


test('recovers reversible UTF-8 WAV tags while preserving genuine Latin-1 and original audio', async t => {
  const f = await fixture(t, { extra: async dir => {
    await writeFile(join(dir, '02 中文原名.wav'), wav('需要对时', '实测歌手', '原标签'));
    await writeFile(join(dir, '03 Latin.wav'), wav('Beyoncé – Déjà Vu'));
    await writeFile(join(dir, '04 Latin1.wav'), wav('Beyoncé', candidate.artist, candidate.album, 'latin1'));
  } });
  const result = await f.search('实测歌手');
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().tracks.length, 1);
  const [track] = result.json().tracks;
  assert.equal(track.title, '需要对时');
  assert.equal(track.artist, '实测歌手');
  assert.deepEqual(track.albums, ['原标签']);
  assert.equal(track.file, '真实歌手/实际专辑/02 中文原名.wav');
  const latin = (await f.search()).json().tracks;
  assert.equal(latin.find((row: { file: string }) => row.file.endsWith('03 Latin.wav')).title, 'Beyoncé – Déjà Vu');
  assert.equal(latin.find((row: { file: string }) => row.file.endsWith('04 Latin1.wav')).title, 'Beyoncé');
  assert.deepEqual(await readFile(join(f.dir, '02 中文原名.wav')), wav('需要对时', '实测歌手', '原标签'));
});

test('ranks a compatible local version ahead of the first twenty incompatible results without auto-confirming', async t => {
  const wrong = Array.from({ length: 30 }, (_, i) => ({ ...candidate, id: i + 2000, duration: 180 }));
  const manual = { ...candidate, album: 'Different release' };
  const f = await fixture(t, { online: [...wrong, manual] });
  const [{ id }] = (await f.search()).json().tracks;
  const { result } = (await f.lookup(id)).json();
  assert.equal(result.status, 'review');
  assert.equal(result.candidates.length, 20);
  assert.equal(result.candidates[0].id, candidate.id);
  assert.equal((await f.save(id, candidate.id)).json().results[0].status, 'review');
});

test('a mismatched timeline cannot be attached to local audio, even when explicitly opting into plain text', async t => {
  const wrong = { ...candidate, duration: 43 };
  const f = await fixture(t, { online: [wrong] });
  const [{ id }] = (await f.search()).json().tracks;
  await f.lookup(id);
  const save = (mode: string, confirmed: boolean) => f.app.inject({ method: 'POST', url: '/api/local-library/save', headers,
    payload: { tracks: [{ id, candidateId: candidate.id, confirmed, mode }] } });
  assert.equal((await save('plain', false)).json().results[0].status, 'review');
  assert.equal((await save('original', true)).json().results[0].status, 'review');
  assert.equal((await save('surprise', true)).statusCode, 400);
  assert.equal((await save('plain', true)).json().results[0].status, 'unsynced');
  await assert.rejects(readFile(f.lyrics), { code: 'ENOENT' });
  assert.deepEqual(await readFile(f.file), f.audio);
});

test('local plain lyrics are readable without consulting the provider, including when timing search later fails', async t => {
  const f = await fixture(t, { offline: true });
  const original = '用户保留的正文\nSecond fixture line';
  await writeFile(f.lyrics, original);
  const [{ id }] = (await f.search()).json().tracks;
  const local = await f.lookup(id);
  assert.equal(local.statusCode, 200, local.body);
  assert.equal(local.json().track.lyricsKind, 'plain');
  assert.equal(local.json().result.status, 'plain');
  assert.equal(local.json().result.candidate.plain, original);
  assert.deepEqual(f.searches, []);
  const timing = await f.lookup(id, true);
  assert.equal(timing.statusCode, 200, timing.body);
  assert.equal(timing.json().timing.status, 'error');
  assert.equal(timing.json().result.candidate.plain, original);
  assert.equal(f.searches.length, 1);
  assert.equal(await readFile(f.lyrics, 'utf8'), original);
});

test('a timing search with no matching cues keeps displaying the local lyrics', async t => {
  const f = await fixture(t, { online: [{ ...candidate, title: 'Unrelated song' }, { ...candidate, synced: '', plain: 'no timing' }] });
  const original = '已保存的歌词';
  await writeFile(f.lyrics, original);
  const [{ id }] = (await f.search()).json().tracks;
  const response = await f.lookup(id, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().timing.status, 'missing');
  assert.equal(response.json().result.candidate.plain, original);
});

test('untagged Workbench MP3 names require explicit confirmation and can upgrade matching plain lyrics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-canonical-mp3-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, candidate.artist);
  const filename = `${candidate.artist} - ${candidate.title}`;
  await mkdir(folder);
  const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0x64]);
  const mp3 = Buffer.concat(Array.from({ length: 306 }, () => frame));
  await writeFile(join(folder, `${filename}.mp3`), mp3);
  const sidecar = join(folder, `${filename}.LRC`);
  const plain = '繁体测试\nSecond fixture line';
  const timed = { ...candidate, synced: '[00:01.25]繁體測試\n[00:06.00]Second fixture line' };
  await writeFile(sidecar, plain);
  const app = await createServer({ localLibraryRoot: root, localLyricSearch: async q => {
    assert.equal(q, 'Local Song Local Singer');
    return [{ ...candidate, id: 3, synced: '', plain }, timed, { ...candidate, id: 2, title: 'Another Song' }];
  } });
  t.after(() => app.close());
  const search = await app.inject({ url: '/api/local-library?q=Local%20Singer', headers });
  const [track] = search.json().tracks;
  assert.equal(track.title, candidate.title);
  const lookup = await app.inject({ method: 'POST', url: `/api/local-library/${track.id}/lyrics`, headers, payload: { searchTiming: true } });
  assert.equal(lookup.json().track.lyricsKind, 'plain');
  assert.equal(lookup.json().result.candidate.plain, plain);
  assert.equal(lookup.json().timing.status, 'review');
  assert.deepEqual(lookup.json().timing.candidates.map((row: LyricCandidate) => row.id), [candidate.id]);
  const save = (confirmed: boolean, upgradePlain = false, candidateId = candidate.id) => app.inject({ method: 'POST', url: '/api/local-library/save', headers,
    payload: { tracks: [{ id: track.id, candidateId, confirmed, upgradePlain }] } });
  assert.equal((await save(false, true)).json().results[0].status, 'review');
  assert.equal((await save(true)).json().results[0].status, 'exists');
  assert.equal((await save(true, true, 2)).json().results[0].status, 'review');
  assert.equal(await readFile(sidecar, 'utf8'), plain);
  assert.equal((await save(true, true)).json().results[0].status, 'saved');
  const saved = await readFile(sidecar, 'utf8');
  assert.equal(saved, '[00:01.25]繁体测试\n[00:06.00]Second fixture line');
  const { cues } = parseLrc(saved);
  assert.deepEqual([0, 2, 7].map(time => activeIndex(cues, time)), [-1, 0, 1]);
  assert.equal((await save(true, true)).json().results[0].status, 'exists');
  const reread = (await app.inject({ method: 'POST', url: `/api/local-library/${track.id}/lyrics`, headers, payload: {} })).json();
  assert.equal(reread.track.lyricsKind, 'timed');
  assert.equal(reread.result.candidate.synced, saved);
  assert.deepEqual(await readFile(join(folder, `${filename}.mp3`)), mp3);
});

test('plain-only and wrong-song candidates cannot be attached, and an existing different transcript is preserved', async t => {
  const plain = { ...candidate, synced: '', plain: 'Original fixture line\nSecond fixture line' };
  const wrong = { ...candidate, id: 93, title: 'Wrong song' };
  const f = await fixture(t, { online: [plain, wrong] });
  const [{ id }] = (await f.search()).json().tracks;
  await f.lookup(id);
  assert.equal((await f.save(id, plain.id, true)).json().results[0].status, 'unsynced');
  assert.equal((await f.save(id, wrong.id, true)).json().results[0].status, 'review');
  await assert.rejects(readFile(f.lyrics), { code: 'ENOENT' });
});

test('explicit upgrade does not replace a different transcript or follow a symlink', async t => {
  const f = await fixture(t);
  const [{ id }] = (await f.search()).json().tracks;
  await writeFile(f.lyrics, 'Custom different words');
  await f.lookup(id, true);
  const save = () => f.app.inject({ method: 'POST', url: '/api/local-library/save', headers,
    payload: { tracks: [{ id, candidateId: candidate.id, confirmed: true, upgradePlain: true }] } });
  assert.equal((await save()).json().results[0].status, 'different-lyrics');
  assert.equal(await readFile(f.lyrics, 'utf8'), 'Custom different words');
  await rename(f.lyrics, f.lyrics + '.other');
  await symlink(f.lyrics + '.other', f.lyrics);
  assert.equal((await save()).json().results[0].status, 'exists');
  assert.equal(await readFile(f.lyrics + '.other', 'utf8'), 'Custom different words');
});

test('local search finds a specific title, alone or combined with its artist', async t => {
  const f = await fixture(t, { extra: dir => writeFile(join(dir, 'other.wav'), wav('Different Recording')) });
  for (const term of ['Local Song', 'Local Singer Local Song', 'Song Local Singer']) {
    const response = await f.search(term);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().tracks.map((track: { title: string }) => track.title), [candidate.title]);
  }
  assert.equal((await f.search('Local Singer')).json().tracks.length, 2);
});
