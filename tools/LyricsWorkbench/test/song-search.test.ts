import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from '../src/server';
import { MusicSources } from '../src/providers';
import { LyricsCatalog } from '../src/lyrics-catalog';
import { pickAutomaticSong, rankSongs, type SongSummary } from '../src/song-types';
import { SongError, type SongCatalog } from '../src/songs';

const studio: SongSummary = { provider: 'artist', id: '1', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 270, availability: 'ready' };
const live: SongSummary = { ...studio, provider: 'jamendo', id: '2', album: '演唱会', duration: 285, availability: 'stream-only' };
const lyric: SongSummary = { ...studio, provider: 'lrclib', id: '3', availability: 'lyrics-only' };

const raw = { id: 3, trackName: '晴天', artistName: '周杰伦', albumName: '叶惠美', duration: 270,
  instrumental: false, syncedLyrics: '[00:01.00]测试歌词', plainLyrics: '测试歌词' };

test('可打包的录音优先；唯一精确匹配可展开，同一曲名的多个录音不得自动选', () => {
  assert.deepEqual(rankSongs([lyric, live, studio], '晴天 周杰伦').map(t => t.id), ['1','3','2']);
  assert.equal(pickAutomaticSong([studio, lyric], '周杰伦 晴天'), studio);
  assert.equal(pickAutomaticSong([studio, live, lyric], '晴天'), undefined);
  assert.equal(pickAutomaticSong([studio], '周杰伦'), undefined);
  assert.equal(pickAutomaticSong([lyric], '晴天'), lyric);
});

test('在线歌词按精确 ID 查看，不能尝试打包；标题和歌手不匹配的结果被过滤', async t => {
  let requests = 0;
  const sources = new MusicSources(async url => {
    const parsed = new URL(url.toString());
    assert.equal(parsed.hostname, 'lrclib.net');
    requests++;
    if (parsed.pathname === '/api/search') {
      assert.equal(parsed.searchParams.get('q'), '晴天 周杰伦');
      return Response.json([raw, { ...raw, id: 4, trackName: '另一首歌' }, { ...raw, id: 5, instrumental: true }]);
    }
    assert.equal(parsed.pathname, '/api/get/3');
    return Response.json(raw);
  }, 0);
  const catalog = new LyricsCatalog(sources);
  const app = await createServer({ lyricSongs: catalog });
  t.after(() => app.close());
  const search = `/api/songs?source=lrclib&q=${encodeURIComponent('晴天 周杰伦')}`;
  assert.deepEqual((await app.inject(search)).json().tracks, [lyric]);
  assert.deepEqual((await app.inject(search)).json().tracks, [lyric]);
  const result = await app.inject('/api/songs/lrclib/3');
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().track.lyrics.text, raw.syncedLyrics);
  assert.equal(result.json().track.previewUrl, null);
  assert.equal((await app.inject({ method: 'POST', url: '/api/songs/lrclib/3/download' })).statusCode, 409);
  assert.equal(requests, 2);
});

test('同一搜索里的来源彼此独立；歌词源失败不隐藏可下载结果', async t => {
  const unused = async () => { throw new Error('unused'); };
  const enabled = { configured: true, bundlesEnabled: false };
  const published: SongCatalog = { status: () => enabled, search: async () => [studio], detail: unused, audio: unused };
  const lyricCatalog: SongCatalog = { ...published, search: async () => { throw new SongError('故障样例', 502); } };
  const app = await createServer({ publishedSongs: published, lyricSongs: lyricCatalog });
  t.after(() => app.close());
  const query = encodeURIComponent('晴天');
  assert.equal((await app.inject(`/api/songs?source=lrclib&q=${query}`)).statusCode, 502);
  assert.deepEqual((await app.inject(`/api/songs?source=artist&q=${query}`)).json().tracks, [studio]);
  const response = await app.inject(`/api/songs?q=${query}`);
  assert.deepEqual(response.json().tracks, [studio]);
  assert.match(response.json().warning, /LRCLIB/);
  assert.equal((await app.inject(`/api/songs?source=other&q=${query}`)).statusCode, 400);
});
