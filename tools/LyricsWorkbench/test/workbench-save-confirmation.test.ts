import assert from 'node:assert/strict';
import test from 'node:test';
import { uncreditedVideoSavePayload } from '../app/workbench-save-confirmation';
import type { WorkspaceRow } from '../src/workbench';

const videoRow = (id: string, title: string, artist = ''): WorkspaceRow => ({
  kind: 'song', key: `bilibili-video:${id}`,
  track: { provider: 'bilibili-video', id, title, artist, album: '', duration: 200, availability: 'audio-only' },
  versions: [],
});

test('uncredited saves use the search artist without a consent flag or dialog', () => {
  const row = videoRow('BV1xN411x76o-1', 'Believer');
  assert.deepEqual(uncreditedVideoSavePayload(row, '梦龙乐队'), { saveArtistHint: 'Imagine Dragons' });
  assert.deepEqual(uncreditedVideoSavePayload(row, 'Imagine Dragons'), { saveArtistHint: 'Imagine Dragons' });
});

test('Eason searches carry the artist directory for every uncredited selected song', () => {
  for (const title of ['爱情转移', '富士山下', '红玫瑰']) {
    assert.deepEqual(uncreditedVideoSavePayload(videoRow('BV1xN411x76o-1', title), '陈奕迅'), { saveArtistHint: '陈奕迅' });
  }
  assert.deepEqual(uncreditedVideoSavePayload(videoRow('BV1xN411x76o-1', '爱情转移'), '陳奕迅'), { saveArtistHint: '陈奕迅' });
});

test('search hints never override source credits or apply to other providers', () => {
  assert.deepEqual(uncreditedVideoSavePayload(videoRow('BV1xN411x76o-1', 'Believer', 'Another Artist'), '梦龙乐队'), {});
  const row: WorkspaceRow = { kind: 'song', key: 'jamendo:1', track: {
    provider: 'jamendo', id: '1', title: 'Believer', artist: '', album: '', duration: 200, availability: 'ready',
  }, versions: [] };
  assert.deepEqual(uncreditedVideoSavePayload(row, '梦龙乐队'), {});
});

test('empty, unknown or song-specific queries do not become artist folders', () => {
  const row = videoRow('BV1xN411x76o-1', 'Believer');
  for (const query of [undefined, '', '任意歌手', '梦龙乐队 Believer', '../陈奕迅']) {
    assert.deepEqual(uncreditedVideoSavePayload(row, query), {});
  }
});
