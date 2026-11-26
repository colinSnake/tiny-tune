import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveUncreditedVideoSaveArtist, uncreditedVideoSavePayload } from '../app/workbench-save-confirmation';
import type { WorkspaceRow } from '../src/workbench';

const videoRow = (id: string, title: string, artist = ''): WorkspaceRow => ({
  kind: 'song', key: `bilibili-video:${id}`,
  track: { provider: 'bilibili-video', id, title, artist, album: '', duration: 200, availability: 'audio-only' },
  versions: [],
});

test('uncredited Bilibili save uses an artist destination only after identity and permission confirmation', () => {
  let prompted = '';
  const result = resolveUncreditedVideoSaveArtist([videoRow('BV1xN411x76o-1', 'Believer')], '梦龙乐队', message => {
    prompted = message;
    return true;
  });
  assert.deepEqual(result, { status: 'confirmed', artistHint: 'Imagine Dragons' });
  assert.match(prompted, /保存到“Imagine Dragons”目录/);
  assert.match(prompted, /确属 Imagine Dragons/);
  assert.match(prompted, /有权保存完整音频/);
  assert.match(prompted, /不会把搜索词写成投稿署名/);
  assert.match(prompted, /Believer/);
});

test('declining or lacking an allowlisted hint never authorizes an uncredited save', () => {
  const row = videoRow('BV1xN411x76o-1', 'Believer');
  const declined = resolveUncreditedVideoSaveArtist([row], '梦龙乐队', () => false);
  assert.deepEqual(declined, { status: 'cancelled' });
  assert.deepEqual(resolveUncreditedVideoSaveArtist([row], '任意歌手', () => assert.fail('must not prompt')), { status: 'not-needed' });
  assert.deepEqual(resolveUncreditedVideoSaveArtist([videoRow('BV1xN411x76o-1', 'Believer', 'Imagine Dragons')], '梦龙乐队', () => assert.fail('must not prompt')),
    { status: 'not-needed' });
  assert.deepEqual(resolveUncreditedVideoSaveArtist([{ kind: 'song', key: 'jamendo:1', track: {
    provider: 'jamendo', id: '1', title: 'Believer', artist: '', album: '', duration: 200, availability: 'ready',
  }, versions: [] }], '梦龙乐队', () => assert.fail('must not prompt')), { status: 'not-needed' });
});


test('only a confirmed uncredited Bilibili row receives the artist-directory save payload', () => {
  const row = videoRow('BV1xN411x76o-1', 'Believer');
  assert.deepEqual(uncreditedVideoSavePayload(row, 'Imagine Dragons'), {
    saveArtistHint: 'Imagine Dragons', confirmUncreditedSave: true,
  });
  assert.deepEqual(uncreditedVideoSavePayload(row), {});
  assert.deepEqual(uncreditedVideoSavePayload(videoRow('BV1xN411x76o-1', 'Believer', 'Imagine Dragons'), 'Imagine Dragons'), {});
});
