import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createArchive, exportEntries } from '../src/export';
import { activeIndex, parseLrc } from '../src/lrc';
import { prepareLyricPayload } from '../src/lyric-payload';
import { lyricCandidateIssue, lyricQualityIssue } from '../src/lyric-quality';
import { matchLyrics, plainCandidate } from '../src/match';
import { saveLyricsLocally, saveSongLocally } from '../src/song-local-save';
import { SongError, songZip, type SongCatalog } from '../src/songs';
import type { SongDetail } from '../src/song-types';
import type { LyricCandidate, Track } from '../src/types';
import { matchVideoLyrics } from '../src/video-lyrics';
import JSZip from 'jszip';

const track: Track = { id: 'example', title: '测试歌名', artist: '测试歌手', albums: [], duration: 8 };
const candidate: LyricCandidate = { id: 123, title: track.title, artist: track.artist, album: '', duration: track.duration,
  instrumental: false, synced: '', plain: '' };
const song: SongDetail = { ...track, provider: 'artist', album: '', duration: 8, availability: 'ready', sourceUrl: 'https://example.invalid',
  licenseUrl: null, previewUrl: null, lyrics: { kind: 'timed', text: '[00:01]第一句\n[00:06]第二句' } };
const frame = Buffer.alloc(417);
frame.set([0xff, 0xfb, 0x90, 0x64]);
const audio = Buffer.concat(Array.from({ length: 306 }, () => frame));

async function temporaryLibrary(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tinytune-lyric-flow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('a collapsed timeline cannot be downloaded or written next to a verified MP3', async t => {
  const synced = '[00:02]第一段\n[00:02]第二段\n[00:02]反复段\n[00:02]曲终';
  const invalid: SongDetail = { ...song, lyrics: { kind: 'timed', text: synced } };
  let audioRequests = 0;
  const catalog: SongCatalog = {
    status: () => ({ configured: true, bundlesEnabled: true }), search: async () => [],
    detail: async () => ({ track: invalid, downloadUrl: null }), audio: async () => { audioRequests++; return audio; },
  };
  await assert.rejects(songZip(catalog, song.id, AbortSignal.timeout(1000)), (e: unknown) => e instanceof SongError && e.status === 409);
  assert.equal(audioRequests, 0);
  const root = await temporaryLibrary(t);
  const saved = await saveSongLocally(root, invalid, audio);
  assert.equal(saved.status, 'saved');
  assert.equal(saved.lyrics, undefined);
  assert.equal(saved.lyricsIssue, 'unsynced');
  assert.deepEqual(await readFile(join(root, saved.audio!)), audio);
});

test('only distinct sung cues count, while one lyric or one bilingual pair is still valid', () => {
  assert.equal(lyricQualityIssue('[00:02]第一句\n[00:02]第二句\n[00:07]', 8), 'timing');
  assert.equal(lyricQualityIssue('[00:02]只有一句\n[00:07]'), undefined);
  assert.equal(lyricQualityIssue('[00:02]只有一句\n[00:02]Only one line'), undefined);
  assert.equal(lyricQualityIssue('[00:02]作詞：測試者\n[00:02]只有一句'), undefined);
});

test('same-record plain text exposes a missing repeat of an otherwise intact chorus', () => {
  const synced = '[00:01]开头\n[00:02]副歌甲\n[00:03]副歌乙\n[00:04]过渡\n[00:07]结尾';
  const plain = '开头\n副歌甲\n副歌乙\n过渡\n副歌甲\n副歌乙\n结尾';
  const incomplete = { ...candidate, synced, plain };
  assert.equal(lyricCandidateIssue(incomplete), 'incomplete');
  assert.equal(matchLyrics(track, [incomplete]).status, 'missing');
  assert.equal(plainCandidate(incomplete).plain, '');
  assert.equal(lyricCandidateIssue({ ...incomplete, synced: synced.replace('[00:07]', '[00:05]副歌甲\n[00:06]副歌乙\n[00:07]') }), undefined);
  assert.equal(lyricCandidateIssue({ ...incomplete, plain: '' }), undefined, 'gaps alone are not evidence of omission');
});

test('a spaced repeat tag is both validated and rendered as a separate cue', () => {
  const text = '[offset:+100]\r\n[00:01.00]\t [00:04.500] 同一句\r\n[00:07] 结尾';
  assert.equal(prepareLyricPayload(text, 8, 'original')?.text, text);
  const { cues } = parseLrc(text);
  assert.deepEqual(cues, [{ ms: 900, lines: ['同一句'] }, { ms: 4400, lines: ['同一句'] }, { ms: 6900, lines: ['结尾'] }]);
  assert.equal(activeIndex(cues, 4.5), 1);
  const annotated = '[00:01] [00:03]我喜欢你\n[00:01] [00:03]wǒ xǐ huān nǐ';
  assert.equal(lyricQualityIssue(annotated, 8), 'phonetic');
});

test('plain candidates preserve metadata, BOM, whitespace, and CRLF through selection and ZIP export', async () => {
  const plain = '\uFEFF[ti:測試歌名]\r\n[by:測試者]\r\n  繁體的第一行\r\n繁體的第二行  \r\n';
  const raw = { ...candidate, plain };
  const result = matchLyrics(track, [raw, { ...raw, id: 124, plain: '繁體的第一行\n繁體的第二行' }]);
  assert.equal(result.status, 'plain', 'formatting differences alone do not require a version choice');
  assert.equal(plainCandidate(raw).plain, plain);
  const video = matchVideoLyrics(track, [raw, { ...raw, id: 124, plain: '繁體的第一行\n繁體的第二行' }]);
  assert.equal(video.status, 'plain');
  if (video.status === 'plain') assert.equal(video.candidate.plain, plain);
  const data = exportEntries([{ track, result }], undefined, 'original');
  assert.equal(data.files[0].text, plain);
  const zip = await JSZip.loadAsync(await createArchive(data));
  assert.deepEqual(await zip.file(data.files[0].name)?.async('uint8array'), new TextEncoder().encode(plain));
  assert.equal(exportEntries([{ track, result }]).files[0].text, plain.replaceAll('繁體', '繁体'));
});

test('foreign-language evidence protects neighboring kanji lines without overriding explicitly Chinese lyrics', () => {
  const japanese = '[00:01]夢の中へ\n[00:03]東京電車\n[00:05]終点';
  assert.equal(prepareLyricPayload(japanese, 8)?.text, japanese);
  const languageTag = '[lang:ja-JP]\r\n[00:01]東京電車\r\n[00:05]終点';
  assert.equal(prepareLyricPayload(languageTag, 8)?.text, languageTag);
  const mixed = `${japanese}\n[00:06]我們牽著妳走`;
  assert.equal(prepareLyricPayload(mixed, 8)?.text, `${japanese}\n[00:06]我们牵着你走`);
  const chinese = '[lang:zh-Hant]\n[00:01]春風與大海\n[00:03]夢の中へ';
  assert.equal(prepareLyricPayload(chinese, 8)?.text, '[lang:zh-Hant]\n[00:01]春风与大海\n[00:03]夢の中へ');
});

test('simplified lyrics fix the known aspect, keep valid words, and flag unresolved 著', () => {
  const source = '[ti:原著]\r\n[00:01]我朝著海邊走\r\n[00:03]著作權顯著\r\n[00:05]凝視著遠方';
  assert.deepEqual(prepareLyricPayload(source, 8), { kind: 'timed', residualGlyphs: ['著'],
    text: '[ti:原著]\r\n[00:01]我朝着海边走\r\n[00:03]著作权显著\r\n[00:05]凝视著远方' });
  assert.deepEqual(prepareLyricPayload(source, 8, 'original'), { kind: 'timed', text: source });
});

test('repeat saves surface existing bad lyrics without fetching audio or altering existing files', async t => {
  const root = await temporaryLibrary(t);
  const saved = await saveSongLocally(root, song, audio);
  const audioPath = join(root, saved.audio!);
  const lyricPath = join(root, saved.lyrics!);
  for (const source of ['[00:99]坏时码', '[00:01]第一句\n[00:08]超过实际帧长', Buffer.from([0xff, 0xfe])]) {
    await writeFile(lyricPath, source);
    const result = await saveSongLocally(root, song, async () => assert.fail('existing pair must not fetch audio'));
    assert.deepEqual(result, { status: 'exists', audio: saved.audio, lyrics: saved.lyrics, lyricsKind: 'protected' });
    assert.deepEqual(await readFile(lyricPath), Buffer.from(source));
    assert.deepEqual(await readFile(audioPath), audio);
  }
  const standalone = await saveLyricsLocally(root, song, song.lyrics!.text);
  const invalid = '[00:99]坏时码';
  await writeFile(join(root, standalone.lyrics!), invalid);
  assert.deepEqual(await saveLyricsLocally(root, song, song.lyrics!.text),
    { status: 'exists', lyrics: standalone.lyrics, lyricsKind: 'protected' });
  assert.equal(await readFile(join(root, standalone.lyrics!), 'utf8'), invalid);
});
