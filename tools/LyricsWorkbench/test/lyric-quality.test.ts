import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateResult, matchLyrics, plainCandidate } from '../src/match';
import { matchVideoLyrics } from '../src/video-lyrics';
import { LyricsCatalog } from '../src/lyrics-catalog';
import { parseLyrics, SongError } from '../src/songs';
import { chooseLyrics } from '../src/workbench';
import type { LyricCandidate, Track } from '../src/types';

const track: Track = { id: 'recording', title: '测试歌曲', artist: '测试歌手', albums: ['原专辑'], duration: 120 };
const clean: LyricCandidate = { id: 2, title: track.title, artist: track.artist, album: '其他发行', duration: 120,
  instrumental: false, synced: '[00:01.00]我喜欢你\n[00:05.00]我们一起唱歌', plain: '我喜欢你\n我们一起唱歌' };
const mixed: LyricCandidate = { ...clean, id: 1, album: '原专辑',
  synced: '[00:01.00]我喜欢你\n[00:01.00]wǒ xǐ huān nǐ\n[00:05.00]我们一起唱歌\n[00:05.00]wǒ men yì qǐ chàng gē' };

test('rejects an entire mixed Chinese/pinyin candidate, even when its plain field is clean', () => {
  assert.equal(candidateResult(mixed).status, 'missing');
  assert.equal(candidateResult(plainCandidate(mixed)).status, 'missing');
  assert.equal(chooseLyrics({ status: 'review', candidates: [mixed] }, mixed.id), undefined);
});

test('reselects a clean release instead of preferring the contaminated same-album result', () => {
  const result = matchLyrics(track, [mixed, { ...clean, album: track.albums[0] }]);
  assert.equal(result.status, 'timed');
  assert.equal('candidate' in result && result.candidate.id, clean.id);
  assert.deepEqual(matchLyrics(track, [mixed]), { status: 'missing' });
});

test('video text fallback never launders mixed pinyin through plainCandidate', () => {
  const result = matchVideoLyrics(track, [mixed, clean]);
  assert.equal(result.status, 'plain');
  assert.equal('candidate' in result && result.candidate.id, clean.id);
  assert.deepEqual(matchVideoLyrics(track, [mixed]), { status: 'missing' });
});

for (const [name, text] of Object.entries({
  'untimed paired lines': '我喜欢你\nwǒ xǐ huān nǐ\n我们一起唱歌\nwǒ men yì qǐ chàng gē',
  'unaccented syllables': '[00:01]我喜欢你\n[00:01]wo xi huan ni\n[00:05]我们一起唱歌\n[00:05]wo men yi qi chang ge',
  'numbered syllables': '[00:01]我喜欢你\n[00:01]wo3 xi3 huan1 ni3',
  'decomposed diacritics': mixed.synced.normalize('NFD'),
  'inline annotations': '[00:01]我喜欢你 (wǒ xǐ huān nǐ)\n[00:05]我们一起唱歌 (wǒ men yì qǐ chàng gē)',
  'inline word annotations': '[00:01]我(wǒ)喜欢(xǐ huān)你(nǐ)',
})) {
  test(`rejects ${name} at parsing and candidate boundaries`, () => {
    assert.equal(parseLyrics(text, 120).lyrics, null);
    assert.equal(candidateResult({ ...clean, synced: text, plain: '' }).status, 'missing');
    assert.equal(candidateResult({ ...clean, synced: '', plain: text }).status, 'missing');
  });
}

for (const [name, text] of Object.entries({
  'Chinese with sung English': '[00:01]我喜欢你\n[00:01]I love you\n[00:05]我们一起唱歌\n[00:05]Baby stay with me',
  'non-pinyin accented language': '[00:01]我喜欢你\n[00:01]Café au lait, déjà vu',
  'repeated vocables': '[00:01]我们一起唱歌\n[00:01]La la la\n[00:05]你的声音\n[00:05]Na na na',
  'Korean with English': '[00:01]사랑해\n[00:05]I love you',
  'mixed vocables': '[00:01]我们一起唱歌\n[00:01]La la na na\n[00:05]你的声音\n[00:05]Sha la la la',
  'ordinary Chinese': clean.synced,
})) {
  test(`preserves ${name}`, () => {
    assert.equal(candidateResult({ ...clean, synced: text, plain: '' }).status, 'timed');
    assert.equal(parseLyrics(text, 120).lyrics?.kind, 'timed');
  });
}

test('lyric catalog omits contaminated search results and rejects direct detail bypass', async () => {
  const catalog = new LyricsCatalog({ searchLyrics: async () => [mixed, clean], lyricRecord: async () => mixed });
  assert.deepEqual((await catalog.search('测试歌曲 测试歌手', new AbortController().signal)).map(row => row.id), ['2']);
  await assert.rejects(catalog.detail('1', new AbortController().signal), (error: unknown) => error instanceof SongError && error.status === 404);
});

test('a clean candidate from a different album still requires recording review', () => {
  assert.deepEqual(matchLyrics(track, [mixed, clean]), { status: 'review', candidates: [clean] });
});

test('export refuses stale timed and plain states that contain phonetic annotations', async () => {
  const { lyricText, exportEntries } = await import('../src/export');
  for (const status of ['timed', 'plain'] as const) {
    const result = { status, candidate: mixed };
    assert.equal(lyricText(result), null);
    assert.deepEqual(exportEntries([{ track, result }]).files, []);
  }
});


for (const [name, text] of Object.entries({
  'mixed valid and malformed timing': `[00:01]我喜欢你
[00:99]我们一起唱歌`,
  'malformed second tag': `[00:01][00:99]我喜欢你`,
  'HTML inside timed text': `[00:01]<span>我喜欢你</span>`,
  'replacement characters': `[00:01]我喜欢�`,
  'NUL bytes': `[00:01]我喜欢${String.fromCharCode(0)}你`,
  'invalid offset': `[offset:later]
[00:01]我喜欢你`,
  'out of range timeline': '[02:02]我喜欢你',
})) {
  test(`rejects ${name} without laundering via plain fallback`, async () => {
    const bad = { ...clean, synced: text };
    assert.equal(candidateResult(bad).status, 'missing');
    assert.equal(candidateResult({ ...clean, plain: text }).status, 'missing');
    assert.equal(candidateResult(plainCandidate(bad)).status, 'missing');
    assert.equal(parseLyrics(text, 120).lyrics, null);
    const { lyricText } = await import('../src/export');
    assert.equal(lyricText({ status: 'timed', candidate: bad }), null);
    const catalog = new LyricsCatalog({ searchLyrics: async () => [bad, clean], lyricRecord: async () => bad });
    assert.deepEqual((await catalog.search('测试歌曲', new AbortController().signal)).map(row => row.id), ['2']);
    await assert.rejects(catalog.detail('2', new AbortController().signal));
  });
}

test('rejects pinyin split across synced and plain fields', () => {
  const bad = { ...clean, plain: `wǒ xǐ huān nǐ
wǒ men yì qǐ chàng gē` };
  assert.equal(candidateResult(bad).status, 'missing');
  assert.equal(candidateResult({ ...bad, synced: bad.plain, plain: clean.plain }).status, 'missing');
});

test('preserves valid offsets, metadata, repeated timestamps, blank cues and millisecond tolerance', () => {
  const text = `[ti:测试歌曲]
[offset:100]
[00:01.10][00:04.10]我喜欢你
[00:05]
[02:00.50]我们一起唱歌`;
  assert.equal(candidateResult({ ...clean, synced: text }).status, 'timed');
  assert.equal(parseLyrics(text, 120).lyrics?.kind, 'timed');
});


test('preserves distinct Chinese and sung English or vocables across lyric fields', () => {
  for (const text of ['I love you', 'La la na na', 'Sha la la la']) {
    assert.equal(candidateResult({ ...clean, synced: '[00:01]我喜欢你', plain: text }).status, 'timed');
    assert.equal(candidateResult({ ...clean, synced: text, plain: '我喜欢你' }).status, 'plain');
  }
});

test('sidecar reader protects malformed or annotated existing files without changing bytes', async t => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSidecar } = await import('../src/lrc-sidecar');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-protected-lyrics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    '[00:01]我喜欢你' + String.fromCharCode(10) + '[00:99]坏时码',
    '[00:01]我喜欢你' + String.fromCharCode(10) + '[00:01]wǒ xǐ huān nǐ',
    '<div>我喜欢你</div>',
    '我喜欢�你',
    '我喜欢' + String.fromCharCode(0) + '你',
  ];
  for (const [i, text] of cases.entries()) {
    const path = join(root, `${i}.lrc`);
    await writeFile(path, text);
    assert.equal((await readSidecar(path))?.kind, 'protected');
    assert.equal(await readFile(path, 'utf8'), text);
  }
  const path = join(root, 'clean.lrc');
  await writeFile(path, clean.synced);
  assert.equal((await readSidecar(path))?.kind, 'timed');
});


test('standalone lyric save rejects invalid content before creating directories', async t => {
  const { mkdtemp, readdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { saveLyricsLocally } = await import('../src/song-local-save');
  const root = await mkdtemp(join(tmpdir(), 'tinytune-standalone-quality-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const text of [mixed.synced, '[00:01]词' + String.fromCharCode(10) + '[00:99]坏时码', '<b>词</b>', '损坏�', '[ti:没有歌词]', '[02:02]超时']) {
    await assert.rejects(saveLyricsLocally(root, track, text), (e: unknown) => e instanceof SongError && e.status === 409);
  }
  assert.deepEqual(await readdir(root), []);
  const result = await saveLyricsLocally(root, track, clean.synced);
  assert.equal(result.status, 'lyrics-saved');
});

test('rejects mixed timed and untimed lyric lines as a whole, even with a clean fallback', async () => {
  const text = '[ar:测试歌手]\n[00:01]开头\n漏打时码的正文\n[00:05]结尾';
  const bad = { ...clean, synced: text };
  assert.deepEqual(parseLyrics(text, 120), { lyrics: null, conflict: true });
  assert.equal(candidateResult(bad).status, 'missing');
  assert.equal(candidateResult({ ...clean, plain: text }).status, 'missing');
  assert.equal(matchVideoLyrics(track, [bad]).status, 'missing');
  const { exportEntries } = await import('../src/export');
  const data = exportEntries([{ track, result: { status: 'timed', candidate: bad } }]);
  assert.deepEqual(data.files, []);
  assert.equal(data.manifest.tracks[0].status, 'review');
});

test('flags skipped verses corroborated by the same record’s full text, not instrumental gaps', () => {
  const synced = '[00:30]开头第一句\n[00:33]开头第二句\n[01:33]最后一句';
  const candidate = { ...clean, synced, plain: '开头第一句\n开头第二句\n中段第一句\n中段第二句\n最后一句' };
  assert.equal(candidateResult(candidate).status, 'missing');
  assert.equal(candidateResult({ ...candidate, plain: '开头第一句\n开头第二句\n最后一句' }).status, 'timed');
});

test('rejects conflicting offsets and offsets that collapse otherwise distinct sung cues before zero', () => {
  for (const offset of ['[offset:0]\n[offset:500]', '[offset:4000]']) {
    assert.equal(parseLyrics(`${offset}\n[00:01]第一句\n[00:02]第二句`, 120).conflict, true);
  }
  assert.equal(parseLyrics('[offset:1100]\n[00:01]第一句\n[00:02]第二句', 120).lyrics?.kind, 'timed');
});

test('rejects Cantonese number-tone annotations and lyric ads without corrupting legitimate lyrics', () => {
  const bad = { ...clean, synced: '[00:01]我鍾意你\n[00:01]ngo5 zung1 ji3 nei5' };
  assert.equal(candidateResult(bad).status, 'missing');
  assert.equal(candidateResult({ ...bad, synced: '[00:01]我鍾意你', plain: 'ngo5 zung1 ji3 nei5' }).status, 'missing');
  assert.equal(parseLyrics('[00:01]第一句\n[00:02]关注公众号获取更多歌曲', 120).lyrics, null);
  assert.equal(parseLyrics('作词：测试\n[00:01]Someone in 2026\n[00:05]我鍾意你', 120).lyrics?.kind, 'timed');
});

test('a one-line synchronized fragment cannot pass when the same record corroborates a longer lyric', () => {
  const fragment = { ...clean, synced: '[00:05]我们一起唱歌' };
  assert.equal(candidateResult(fragment).status, 'missing');
});

test('actual recording overrun is not silently presented as a plain fallback for the same version', () => {
  const synced = '[offset:-800]\n[00:02]开头\n[01:59.50]结尾';
  const candidate = { ...clean, duration: 121, album: track.albums[0], synced };
  const state = matchLyrics(track, [candidate]);
  assert.equal(state.status, 'review');
  assert.equal(chooseLyrics(state, candidate.id, track), undefined);
});
