import assert from 'node:assert/strict';
import test from 'node:test';
import { MusicSources, RequestQueue } from '../src/providers';
import { candidateResult, matchLyrics } from '../src/match';
import type { LyricCandidate, Track } from '../src/types';
import { mergeTracks, restoreCanceled } from '../src/collection';

const track: Track = { id: 'x', title: 'Ａ Song (Live)', artist: 'A Singer', duration: 100, albums: ['Live Album'] };
const candidate: LyricCandidate = { id: 1, title: 'a song (live)', artist: 'a  singer', album: 'live album',
  duration: 101, synced: '[00:01]行', plain: '', instrumental: false };

test('only trusts a matching version, credit and duration; exposes conflicts', () => {
  assert.equal(matchLyrics(track, [candidate]).status, 'timed');
  for (const patch of [{ duration: null }, { duration: 103 }, { album: 'Studio' }, { title: 'A Song' }, { artist: 'Other' }]) {
    assert.equal(matchLyrics(track, [{ ...candidate, ...patch }]).status, 'review');
  }
  assert.equal(matchLyrics(track, [candidate, { ...candidate, id: 2, synced: '[00:05]不同' }]).status, 'review');
  assert.equal(matchLyrics(track, [candidate, { ...candidate, id: 2, album: '' }]).status, 'timed');
  assert.equal(matchLyrics(track, []).status, 'missing');
  assert.equal(matchLyrics({ ...track, title: '歌 ①' }, [{ ...candidate, title: '歌 1' }]).status, 'review');
  assert.equal(candidateResult({ ...candidate, synced: '', plain: '纯文本' }).status, 'plain');
  assert.equal(candidateResult({ ...candidate, synced: '', instrumental: true }).status, 'instrumental');
  assert.equal(candidateResult({ ...candidate, synced: '[ar:artist]' }).status, 'missing');
});

test('provider uses fixed hosts and normalizes paging, durations and credits', async () => {
  const seen: URL[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); seen.push(url);
    assert.match(new Headers(init?.headers).get('User-Agent') ?? '', /Tinytune/);
    if (url.pathname === '/ws/2/artist') return Response.json({ artists: [
      { id: '1', name: 'A Singer', aliases: [{ name: '艺名' }], country: 'CN' }, { id: '2', name: 'Another Singer', aliases: [
        ...Array.from({ length: 8 }, (_, index) => ({ name: `Alias ${index}` })), { name: 'A Singer' },
      ] },
    ] });
    if (url.pathname === '/ws/2/recording/r') {
      assert.equal(url.searchParams.get('inc'), 'releases+isrcs');
      return Response.json({ id: 'r', releases: [{ title: 'Album' }], isrcs: ['us-abc-20-00002', 'wrong'] });
    }
    if (url.pathname === '/ws/2/recording') {
      if (url.searchParams.get('inc') !== 'artist-credits') return Response.json({ error: 'invalid inc' }, { status: 400 });
      return Response.json({ 'recording-count': 99, recordings: [
      { id: 'r', title: 'Song', length: 100500, 'artist-credit': [{ name: 'Singer', joinphrase: ' & ' }, { artist: { name: 'Other' } }] },
      { id: 'r', title: 'Duplicate' },
    ] }); }
    return Response.json([{ id: 4, trackName: 'Song', artistName: 'Singer & Other', albumName: 'Album',
      duration: 101, syncedLyrics: '[00:01]Lyrics', instrumental: false }]);
  };
  const sources = new MusicSources(fake, 0);
  const artists = await sources.artists('A Singer');
  assert.equal(artists.length, 2);
  assert.ok(artists[1].aliases.includes('A Singer'), 'identity resolution requires all aliases');
  const page = await sources.recordings('artist', 50, 50);
  assert.deepEqual(page.tracks, [{ id: 'r', title: 'Song', artist: 'Singer & Other', albums: [], duration: 100.5 }]);
  assert.equal(page.next, 52);
  const { track, result } = await sources.collect(page.tracks[0]);
  assert.deepEqual(track.albums, ['Album']);
  assert.deepEqual(track.isrcs, ['USABC2000002']);
  assert.equal(result.status, 'timed');
  assert.deepEqual(seen.map(url => url.host), ['musicbrainz.org', 'musicbrainz.org', 'musicbrainz.org', 'lrclib.net']);
  assert.equal(seen[1].searchParams.get('offset'), '50');
  assert.equal(seen[3].searchParams.get('artist_name'), 'Singer & Other');
});

test('limiter honors Retry-After and does not run canceled queued work', async () => {
  let requests = 0;
  const queue = new RequestQueue(0, 'end', {
    now: () => 1000, sleep: async delay => { assert.ok(delay >= 2000); }, random: () => 0,
  });
  await queue.json(async () => ++requests === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : Response.json({ ok: true }));
  assert.equal(requests, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(queue.json(async () => { assert.fail('canceled request must not run'); }, controller.signal), { name: 'AbortError' });
});


test('malformed upstream responses are failures, not a blank or exhausted collection', async () => {
  const sources = new MusicSources(async input => Response.json(new URL(String(input)).host === 'musicbrainz.org'
    ? { recordings: [{ id: 'x', title: 'some recording' }] } : [{ error: 'weird payload' }]), 0);
  await assert.rejects(sources.recordings('artist', 0, 50), /计数/);
  await assert.rejects(sources.lyrics(track), /歌词记录/);
});

test('overlapping pages keep enriched metadata and stop restores the interrupted item', () => {
  const weaker = { ...track, albums: [] };
  assert.deepEqual(mergeTracks([track], [weaker, { ...weaker, id: 'new' }]), [track, { ...weaker, id: 'new' }]);
  const failed = { status: 'error', message: 'retry me' } as const;
  const timed = { status: 'timed', candidate } as const;
  assert.deepEqual(restoreCanceled({ a: { status: 'running' }, b: { status: 'running' }, c: timed }, { a: failed }),
    { a: failed, b: { status: 'pending' }, c: timed });
});
