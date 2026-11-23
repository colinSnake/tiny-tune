import assert from 'node:assert/strict';
import test from 'node:test';
import { SongSearchRequest, type SourceResult } from '../app/song-requests';
import type { SongSummary } from '../src/song-types';

const studio: SongSummary = { provider: 'artist', id: '1', title: 'Code Monkey', artist: 'Jonathan Coulton', album: 'Thing a Week', duration: 184, availability: 'ready' };
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('先呈现快来源，慢来源失败可独立重试，不丢失已有结果', async () => {
  let snapshot: readonly SourceResult[] = [];
  const slow = deferred<Response>();
  let calls = 0;
  const request = new SongSearchRequest('Code Monkey', ['artist', 'lrclib'], state => { snapshot = state; }, async url => {
    const { searchParams } = new URL(url, 'http://localhost');
    assert.equal(searchParams.get('q'), 'Code Monkey');
    if (searchParams.get('source') === 'artist') return Response.json({ tracks: [studio] });
    if (++calls === 1) return slow.promise;
    return Response.json({ tracks: [] });
  });
  request.start();
  await tick();
  assert.deepEqual(snapshot, [{ provider: 'artist', state: 'done', tracks: [studio] }, { provider: 'lrclib', state: 'pending' }]);
  slow.resolve(Response.json({ error: '稍后再来', retryAt: 123 }, { status: 503 }));
  await tick();
  assert.deepEqual(snapshot[1], { provider: 'lrclib', state: 'failed', error: { message: '稍后再来', retryAt: 123 } });
  request.retry('lrclib');
  request.retry('lrclib');
  await tick();
  assert.deepEqual(snapshot, [{ provider: 'artist', state: 'done', tracks: [studio] }, { provider: 'lrclib', state: 'done', tracks: [] }]);
  assert.equal(calls, 2);
});

test('取消后不发布迟到结果，即使请求方未处理 abort', async () => {
  const late = deferred<Response>();
  let signal: AbortSignal | undefined;
  const snapshots: (readonly SourceResult[])[] = [];
  const request = new SongSearchRequest('旧搜索', ['artist'], state => snapshots.push(state), async (_url, init) => {
    signal = init.signal;
    return late.promise;
  });
  request.start();
  request.cancel();
  late.resolve(Response.json({ tracks: [studio] }));
  await tick();
  assert.equal(signal?.aborted, true);
  assert.deepEqual(snapshots, [[{ provider: 'artist', state: 'pending' }]]);
});

test('默认请求不把搜索实例作为原生 fetch 的接收者', async t => {
  t.mock.method(globalThis, 'fetch', async function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return Response.json({ tracks: [studio] });
  });
  const state = deferred<SourceResult>();
  const request = new SongSearchRequest('Code Monkey', ['artist'], results => {
    if (results[0].state !== 'pending') state.resolve(results[0]);
  });
  request.start();
  assert.deepEqual(await state.promise, { provider: 'artist', state: 'done', tracks: [studio] });
});

test('发现已配置的新曲库后补查，不重复查询已返回的来源', async () => {
  let snapshot: readonly SourceResult[] = [];
  const requested: string[] = [];
  const request = new SongSearchRequest('Code Monkey', ['artist'], results => { snapshot = results; }, async url => {
    requested.push(new URL(url, 'http://localhost').searchParams.get('source') ?? '');
    return Response.json({ tracks: requested.length === 1 ? [studio] : [] });
  });
  request.start();
  await tick();
  request.setProviders(['artist', 'jamendo']);
  assert.deepEqual(snapshot, [{ provider: 'artist', state: 'done', tracks: [studio] }, { provider: 'jamendo', state: 'pending' }]);
  await tick();
  assert.deepEqual(requested, ['artist', 'jamendo']);
  assert.deepEqual(snapshot[1], { provider: 'jamendo', state: 'done', tracks: [] });
});
