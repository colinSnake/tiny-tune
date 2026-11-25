import assert from 'node:assert/strict';
import test from 'node:test';
import * as collection from '../src/collection';
import type { Artist, CollectionItem, LyricCandidate, Track } from '../src/types';
import type { LocalTrack } from '../src/local-library-types';

const artist: Artist = { id: 'gem', name: 'G.E.M. 鄧紫棋', aliases: ['邓紫棋'], hint: '', area: '' };
const other: Artist = { id: 'other', name: 'Gem Boy', aliases: ['Gem-Boy'], hint: '', area: '' };
const track: Track = { id: 'online-song', title: '歌', artist: '歌手', duration: 8, albums: ['专辑'] };
const local: LocalTrack = { ...track, id: 'local-recording', file: '真实目录/歌曲.wav', hasLyrics: false };
const candidate: LyricCandidate = { id: 1, title: '歌', artist: '歌手', album: '专辑', duration: 8, instrumental: false, synced: '[00:02]词', plain: '' };
const item = (track: Track, status: 'pending' | 'running' | 'timed' | 'review' = 'pending'): CollectionItem => ({
  track, result: status === 'timed' ? { status, candidate } : status === 'review' ? { status, candidates: [candidate] } : { status },
});

test('a unique exact artist or alias opens recordings even with unrelated search results', () => {
  assert.equal(collection.exactArtist('邓紫棋', [other, artist]), artist);
  assert.equal(collection.exactArtist('Gem', [other, artist]), undefined);
  assert.equal(collection.exactArtist('邓紫棋', [artist, { ...other, aliases: ['邓紫棋'] }]), undefined);
});

test('query current visible pending tracks before selecting, or only the checked ones if present', () => {
  const items = [item(track), item(local)];
  assert.deepEqual(collection.lyricQueryTargets(items, items, []), [track, local]);
  assert.deepEqual(collection.lyricQueryTargets(items, items.slice(1), []), [local]);
  assert.deepEqual(collection.lyricQueryTargets(items, items.slice(1), items.slice(0, 1)), [track]);
  assert.deepEqual(collection.lyricQueryTargets([item(track, 'timed'), item(local, 'running')], items, []), []);
});

test('direct save excludes web-only, existing, unconfirmed and duration-conflicting items', () => {
  const ambiguous = { ...local, id: 'unverified' };
  const existing = { ...local, id: 'already', hasLyrics: true };
  const manual = { ...local, id: 'manual' };
  const conflict = { ...local, id: 'conflict', duration: 40 };
  const items = [item(track, 'timed'), item(local, 'timed'), item(ambiguous, 'review'), item(existing, 'timed'), item(manual, 'timed'), item(conflict, 'timed')];
  const chosen = collection.localSavePlan(items, new Map([local, ambiguous, existing, manual, conflict].map(t => [t.id, t])), new Set([manual.id, conflict.id]));
  assert.deepEqual(chosen.ready.map(r => r.choice), [
    { id: local.id, confirmed: false, candidateId: 1 }, { id: manual.id, confirmed: true, candidateId: 1 },
  ]);
  assert.deepEqual(chosen.skipped.map(r => r.reason), ['not-local', 'review', 'exists', 'review']);
});

test('optional structured ZIP export preserves real local subfolders and groups online lyrics by artist', async () => {
  const { exportEntries } = await import('../src/export');
  const data = exportEntries([item(local, 'timed'), item(track, 'timed')], new Map([[local.id, local]]));
  assert.deepEqual(data.files.map(f => f.name), ['真实目录/歌曲.lrc', '歌手/专辑/歌.lrc']);
  assert.deepEqual(data.manifest.tracks.map(row => row.lyricSource?.id), [1, 1]);
});
