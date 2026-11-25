import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchDetail } from '../app/workbench-state';
import type { WorkbenchDetail } from '../app/workbench-state';
import type { WorkspaceRow } from '../src/workbench';

test('online audio becomes usable without waiting for a separate slow lyric request', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const row: WorkspaceRow = { kind: 'song', key: 'jamendo:12', versions: [], track: { provider: 'jamendo', id: '12', title: '歌', artist: '歌手', album: '发行', duration: 8, availability: 'stream-only' } };
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async input => {
    const lyrics = String(input).endsWith('/lyrics');
    if (lyrics) await gate;
    return new Response(JSON.stringify(lyrics ? { result: { status: 'missing' } } : { track: { ...row.track, previewUrl: '/fixture.mp3', sourceUrl: 'https://example.com', licenseUrl: null, lyrics: null } }), { headers: { 'content-type': 'application/json' } });
  };
  let initial: WorkbenchDetail | undefined;
  const work = fetchDetail(row, new AbortController().signal, undefined, detail => { initial = detail; });
  await new Promise(resolve => setTimeout(resolve, 20));
  try { assert.equal(initial?.song?.previewUrl, '/fixture.mp3'); assert.equal(initial?.result.status, 'running'); }
  finally { release(); await work; }
});

test('selecting a cleaned video result automatically requests lyrics while keeping the preview available', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const track = { provider: 'bilibili-video' as const, id: 'BV1xN411x76o-1', title: '句号', artist: '邓紫棋', album: '合集', duration: 236, availability: 'stream-only' as const };
  const row: WorkspaceRow = { kind: 'song', key: `${track.provider}:${track.id}`, versions: [], track };
  const history: string[] = [];
  const result = { status: 'plain', candidate: { id: 12, title: '句号 - Full Stop', artist: 'G.E.M.', album: '', duration: 236,
    instrumental: false, synced: '', plain: '原创歌词验收样例' } };
  globalThis.fetch = async (url, init) => {
    history.push(`${init?.method ?? 'GET'} ${url}`);
    return Response.json(String(url).endsWith('/lyrics') ? { result } : { track: { ...track, sourceUrl: 'https://example.com', lyrics: null } });
  };
  const ready: WorkbenchDetail[] = [];
  const data = await fetchDetail(row, new AbortController().signal, undefined, detail => ready.push(detail));
  assert.deepEqual(history, [`GET /api/songs/bilibili-video/${track.id}`, `POST /api/songs/bilibili-video/${track.id}/lyrics`]);
  assert.equal(ready[0]?.result.status, 'running');
  assert.equal(data.track.id, row.key);
  assert.deepEqual(data.result, result);
});

test('local detail uses the server’s current sidecar state instead of stale search metadata', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const track = { id: 'local-test', title: '测试歌曲', artist: '测试歌手', albums: [], duration: 8, file: '曲库/测试歌曲.mp3', hasLyrics: false };
  const row: WorkspaceRow = { kind: 'local', key: track.id, track };
  const updated = { ...track, hasLyrics: true, lyricsKind: 'plain' };
  globalThis.fetch = async () => Response.json({ track: updated, result: { status: 'missing' } });
  const detail = await fetchDetail(row, new AbortController().signal);
  assert.deepEqual(detail.local, updated);
});

test('a video with a lyric lookup identity automatically requests lyrics even when display artist is missing', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const track = { provider: 'bilibili-video' as const, id: 'BV1pdRTB8ESa-1', title: '《告白气球》周杰伦丨百万级录音棚试听', artist: '', album: '投稿', duration: 210, availability: 'audio-only' as const };
  const row: WorkspaceRow = { kind: 'song', key: `${track.provider}:${track.id}`, versions: [], track };
  const result = { status: 'plain', candidate: { id: 1, title: '告白气球', artist: '周杰伦', album: '', duration: 210,
    instrumental: false, synced: '', plain: '虚构验收词' } };
  globalThis.fetch = async url => Response.json(String(url).endsWith('/lyrics') ? { result } :
    { track: { ...track, lyricIdentity: { title: '告白气球', artist: '周杰伦' }, lyrics: null } });
  const detail = await fetchDetail(row, new AbortController().signal);
  assert.equal(detail.track.title, track.title);
  assert.deepEqual(detail.result, result);
});
