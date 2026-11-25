import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseLyrics, workspaceRows } from '../src/workbench';
import type { LocalTrack } from '../src/local-library-types';
import type { LyricCandidate } from '../src/types';

const local: LocalTrack = { id: 'local-a', title: '歌', artist: '歌手', albums: ['目录'], duration: 248, file: '歌手/目录/歌.mp3', hasLyrics: false };
const candidate: LyricCandidate = { id: 1, title: '歌', artist: '歌手', album: '版本', duration: 239, instrumental: false, synced: '[00:02]第一句\n[00:06]第二句', plain: '' };
test('a conflicting recording offers text without claiming synchronized lyrics', () => {
  const chosen = chooseLyrics({ status: 'review', candidates: [candidate] }, undefined, local);
  assert.equal(chosen?.result.status, 'plain');
  assert.equal(chosen?.mode, 'plain');
  assert.equal(chosen?.result.status === 'plain' && chosen.result.candidate.plain, '第一句\n第二句');
  assert.equal(chosen?.candidate.id, 1);
});
test('the first version is previewed without an extra confirmation screen; choosing another version is respected', () => {
  const matching = { ...candidate, id: 2, duration: 248 };
  assert.equal(chooseLyrics({ status: 'review', candidates: [matching, candidate] }, undefined, local)?.mode, 'original');
  assert.equal(chooseLyrics({ status: 'review', candidates: [matching, candidate] }, 1, local)?.mode, 'plain');
  assert.equal(chooseLyrics({ status: 'review', candidates: [matching] }, 999, local), undefined);
  assert.equal(chooseLyrics({ status: 'missing' }, undefined, local), undefined);
});
test('plain conversion preserves repeated lyrics but removes timestamps and metadata', () => {
  const repeated = { ...candidate, synced: '[ar:歌手]\n[00:02]副歌\n[00:06]副歌', plain: '' };
  const result = chooseLyrics({ status: 'review', candidates: [repeated] }, undefined, local)?.result;
  assert.equal(result?.status === 'plain' && result.candidate.plain, '副歌\n副歌');
});
test('one result list preserves local files and distinct recordings, deduplicating repeated lyric-only versions', () => {
  const lyric = { provider: 'lrclib' as const, id: '1', title: '另一首', artist: '歌手', album: '发行', duration: 239, availability: 'lyrics-only' as const };
  const rows = workspaceRows([local], [], [lyric, { ...lyric, id: '2', duration: 240 }], '歌手');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'local');
  assert.equal(rows[1].kind, 'song');
});

test('unrelated local lyric candidates require a deliberate choice rather than becoming the default', () => {
  const unrelated = { ...candidate, title: '另一首' };
  assert.equal(chooseLyrics({ status: 'review', candidates: [unrelated] }, undefined, local), undefined);
  assert.equal(chooseLyrics({ status: 'review', candidates: [unrelated] }, unrelated.id, local)?.mode, 'plain');
});

test('artist aliases are deduplicated and bounded to the local search API contract', async () => {
  const { localSearchTerms } = await import('../src/workbench');
  const names = ['验收歌手', ' 验收歌手 ', '', 'x'.repeat(121), ...Array.from({ length: 20 }, (_, i) => `别名${i}`)];
  const terms = localSearchTerms(names);
  assert.equal(terms.length, 12);
  assert.equal(terms[0], '验收歌手');
  assert.equal(new Set(terms).size, terms.length);
  assert.ok(terms.every(term => term.length <= 120 && term.trim()));
});

test('online recordings cannot silently adopt an unrelated review candidate even with identical duration', () => {
  const online = { ...local, id: 'online', duration: 239 };
  const unrelated = { ...candidate, title: '完全不同的歌', artist: '其他歌手' };
  assert.equal(chooseLyrics({ status: 'review', candidates: [unrelated] }, undefined, online), undefined);
  assert.equal(chooseLyrics({ status: 'review', candidates: [unrelated] }, unrelated.id, online)?.mode, 'plain');
});

test('local saves require compatible timecodes, version confirmation and explicit opt-in to plain upgrade', async () => {
  const { planLocalWrite } = await import('../src/workbench');
  const review = { status: 'review' as const, candidates: [candidate] };
  assert.equal(planLocalWrite(local, review, candidate.id).status, 'unsynced');
  const matching = { ...candidate, duration: local.duration };
  const ambiguous = { status: 'review' as const, candidates: [matching] };
  assert.equal(planLocalWrite(local, ambiguous).status, 'version-approval');
  assert.equal(planLocalWrite(local, ambiguous, matching.id).status, 'ready');
  const prior = { ...local, hasLyrics: true, lyricsKind: 'plain' as const };
  const timed = { status: 'timed' as const, candidate: matching };
  assert.equal(planLocalWrite(prior, timed).status, 'upgrade-approval');
  const upgrade = planLocalWrite(prior, timed, undefined, { candidateId: matching.id, mode: 'original' });
  assert.equal(upgrade.status, 'ready');
  assert.deepEqual(upgrade.status === 'ready' && upgrade.choice, { id: local.id, candidateId: matching.id, confirmed: true, mode: 'original', upgradePlain: true });
});

test('details can upgrade a search summary from review to a downloadable recording', () => {
  const summary = { provider: 'jamendo' as const, id: '12', title: '歌', artist: '歌手', album: '发行', duration: 8, availability: 'review' as const };
  const rows = workspaceRows([], [], [summary], '歌', new Map([['jamendo:12', 'ready' as const]]));
  assert.equal(rows[0].kind === 'song' && rows[0].track.availability, 'ready');
});

test('a matched video lyric version is readable by default but never supplies synchronized cues', () => {
  const video = { ...local, id: 'bilibili-video:BV1xN411x76o-1' };
  const chosen = chooseLyrics({ status: 'review', candidates: [candidate] }, undefined, video);
  assert.equal(chosen?.result.status, 'plain');
  assert.equal(chosen?.mode, 'plain');
});
