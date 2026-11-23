import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Artist, Track } from '../src/types';
import { MusicSources, UpstreamError } from '../src/providers';
import { createServer } from '../src/server';

const artistId = '12345678-1234-1234-1234-123456789abc';
const trackId = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
const artist: Artist = { id: artistId, name: '测试歌手', area: '中国', hint: '', aliases: [] };
const track: Track = { id: trackId, title: '测试歌曲', artist: artist.name, albums: ['测试专辑'], duration: 192 };

type Sources = Pick<MusicSources, 'artists' | 'recordings' | 'collect'>;

function testSources(overrides: Partial<Sources> = {}) {
  const calls: unknown[][] = [];
  return {
    calls,
    sources: {
      artists: async (name: string, signal?: AbortSignal) => {
        calls.push(['artists', name, signal]);
        return [artist];
      },
      recordings: async (id: string, offset: number, limit: number, signal?: AbortSignal) => {
        calls.push(['recordings', id, offset, limit, signal]);
        return { tracks: [track], next: 51, total: 100 };
      },
      collect: async (item: Track, signal?: AbortSignal) => {
        calls.push(['collect', item, signal]);
        return { track: item, result: { status: 'missing' as const } };
      },
      ...overrides,
    },
  };
}

test('Fastify serves artist search and recording pagination through the catalog API', async () => {
  const fixture = testSources();
  const server = await createServer({ sources: fixture.sources });
  try {
    const artists = await server.inject({ method: 'GET', url: '/api/catalog?q=%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%89%8B' });
    assert.equal(artists.statusCode, 200);
    assert.deepEqual(artists.json(), { artists: [artist] });
    assert.deepEqual(fixture.calls[0]?.slice(0, 2), ['artists', '测试歌手']);

    const recordings = await server.inject({ method: 'GET', url: `/api/catalog?artist=${artistId}&offset=50` });
    assert.equal(recordings.statusCode, 200);
    assert.deepEqual(recordings.json(), { tracks: [track], next: 51, total: 100 });
    assert.deepEqual(fixture.calls[1]?.slice(0, 4), ['recordings', artistId, 50, 50]);
  } finally {
    await server.close();
  }
});

test('Fastify rejects malformed catalog parameters with a client error', async () => {
  const server = await createServer({ sources: testSources().sources });
  try {
    for (const url of ['/api/catalog', '/api/catalog?q=bad&artist=bad', '/api/catalog?artist=bad', `/api/catalog?artist=${artistId}&offset=1x`]) {
      const response = await server.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 400, url);
      assert.equal(typeof response.json().error, 'string');
    }
  } finally {
    await server.close();
  }
});

test('Fastify validates lyric requests and blocks cross-origin posts', async () => {
  const fixture = testSources();
  const server = await createServer({ sources: fixture.sources });
  try {
    const crossOrigin = await server.inject({ method: 'POST', url: '/api/lyrics', headers: {
      origin: 'https://example.invalid', 'content-type': 'application/json',
    }, payload: track });
    assert.equal(crossOrigin.statusCode, 403);

    const wrongType = await server.inject({ method: 'POST', url: '/api/lyrics', headers: {
      'content-type': 'text/plain',
    }, payload: JSON.stringify(track) });
    assert.equal(wrongType.statusCode, 400);

    const invalidTrack = await server.inject({ method: 'POST', url: '/api/lyrics', headers: {
      'content-type': 'application/json',
    }, payload: { ...track, id: 'invalid' } });
    assert.equal(invalidTrack.statusCode, 400);

    const match = await server.inject({ method: 'POST', url: '/api/lyrics', headers: {
      'content-type': 'application/json',
    }, payload: track });
    assert.equal(match.statusCode, 200);
    assert.deepEqual(match.json(), { track, result: { status: 'missing' } });
    assert.equal(fixture.calls.filter(call => call[0] === 'collect').length, 1);
  } finally {
    await server.close();
  }
});

test('Fastify preserves retry timing and upstream failures', async () => {
  const retryAt = Date.now() + 60_000;
  const fixture = testSources({ collect: async () => { throw new UpstreamError('数据源限流', retryAt); } });
  const server = await createServer({ sources: fixture.sources });
  try {
    const response = await server.inject({ method: 'POST', url: '/api/lyrics', headers: {
      'content-type': 'application/json',
    }, payload: track });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers['retry-after'], '60');
    assert.deepEqual(response.json(), { error: '数据源限流', retryAt });
  } finally {
    await server.close();
  }
});


test('Fastify serves Vite modules and the API on the same development origin', async (t) => {
  const fixture = testSources();
  const server = await createServer({
    sources: fixture.sources,
    developmentRoot: fileURLToPath(new URL('..', import.meta.url)),
  });
  t.after(() => server.close());
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const request = (pathname: string, init?: RequestInit) => fetch(new URL(pathname, origin), {
    ...init, signal: AbortSignal.timeout(5_000),
  });

  const page = await request('/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /\/@vite\/client/);
  assert.match(html, /\/@react-refresh/);

  const entry = await request('/app/main.tsx');
  assert.equal(entry.status, 200);
  assert.match(entry.headers.get('content-type') ?? '', /javascript/);
  assert.match(await entry.text(), /createRoot/);

  const icon = await request('/icon.svg');
  assert.equal(icon.status, 200);
  assert.match(await icon.text(), /<svg/);

  for (const path of ['/api/catalog?q=fixture', '/%61pi/catalog?q=fixture']) {
    const catalog = await request(path);
    assert.equal(catalog.status, 200, path);
    assert.deepEqual(await catalog.json(), { artists: [artist] });
  }

  const lyrics = await request('/api/lyrics', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(track),
  });
  assert.equal(lyrics.status, 200);
  assert.deepEqual(await lyrics.json(), { track, result: { status: 'missing' } });

  const unknownApi = await request('/api/unknown', { headers: { accept: 'text/html' } });
  assert.equal(unknownApi.status, 404);
  assert.match(unknownApi.headers.get('content-type') ?? '', /application\/json/);
  await unknownApi.arrayBuffer();
});

test('artist search reuses a recent success but refreshes it after expiry', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fixture = testSources();
  const server = await createServer({ sources: fixture.sources });
  t.after(() => server.close());
  const query = `/api/catalog?q=${encodeURIComponent(artist.name)}`;
  assert.equal((await server.inject(query)).statusCode, 200);
  assert.deepEqual((await server.inject(`${query}%20`)).json(), { artists: [artist] });
  assert.equal(fixture.calls.length, 1, 'same query should not reach upstream again');
  t.mock.timers.tick(30 * 60_000);
  assert.equal((await server.inject(query)).statusCode, 200);
  assert.equal(fixture.calls.length, 2, 'expired result should not be treated as fresh');
});

test('artist search reports upstream unavailability without labeling it a rate limit', async (t) => {
  const source = new MusicSources(async () => new Response(null, { status: 503, headers: { 'Retry-After': '30' } }), 0);
  const server = await createServer({ sources: source });
  t.after(() => server.close());
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await server.inject('/api/catalog?q=test');
    assert.equal(response.statusCode, 503);
    assert.ok(Number(response.headers['retry-after']) > 0);
    assert.ok(response.json().retryAt > Date.now());
  }
});

test('temporary artist search failures are not cached as results', async (t) => {
  let failed = false;
  const fixture = testSources({ artists: async () => {
    if (!failed) { failed = true; throw new UpstreamError('数据源限流', Date.now() + 60_000); }
    return [artist];
  } });
  const server = await createServer({ sources: fixture.sources });
  t.after(() => server.close());
  const query = '/api/catalog?q=test';
  assert.equal((await server.inject(query)).statusCode, 429);
  assert.deepEqual((await server.inject(query)).json(), { artists: [artist] });
});
