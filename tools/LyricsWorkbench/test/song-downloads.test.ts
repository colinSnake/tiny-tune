import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { fetchSongFile, prepareSongBatch } from '../app/song-downloads';
import { SongArchivePaths } from '../src/song-archive';
import type { SongSummary } from '../src/song-types';

const song: SongSummary = { provider: 'bilibili-video', id: 'BV1J9oNYhEYT-2', title: '月半小夜曲', artist: '',
  album: '合集 · 第 2 P', duration: 293, availability: 'audio-only' };
const bundle: SongSummary = { ...song, provider: 'artist', id: '12', artist: '夜班', album: '现/场', releaseId: 'live-01', availability: 'ready' };
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1]);
const signal = new AbortController().signal;
const reply = (data: BodyInit, type: string) => new Response(data, { headers: { 'content-type': type } });

async function songZip() {
  const zip = new JSZip();
  zip.file('同版.mp3', mp3);
  zip.file('同版.lrc', '[00:10.00]这是同版歌词\n');
  zip.file('manifest.json', JSON.stringify({ version: 1, audio: { file: '同版.mp3' }, lyrics: { file: '同版.lrc' }, source: { license: '测试署名' } }));
  return zip.generateAsync({ type: 'arraybuffer' });
}

test('下载使用原有 MP3 和 ZIP 路由，直接复用文件中的音频供试听', async () => {
  const audio = await fetchSongFile(song, signal, async (url, init) => {
    assert.equal(url, '/api/songs/bilibili-video/BV1J9oNYhEYT-2/mp3');
    assert.equal(init.method, 'POST');
    return reply(mp3, 'audio/mpeg');
  });
  assert.equal(audio.name, '月半小夜曲.mp3');
  assert.equal(audio.audio, audio.file);
  const full = await fetchSongFile(bundle, signal, async url => {
    assert.equal(url, '/api/songs/artist/12/download');
    return reply(await songZip(), 'application/zip');
  });
  assert.equal(full.name, '夜班 - 月半小夜曲.zip');
  assert.deepEqual(new Uint8Array(await full.audio.arrayBuffer()), mp3);
  await assert.rejects(fetchSongFile(song, signal, async () => reply('error', 'text/plain')), /MP3/);
});

test('批量逐个处理，去重并跳过不可下载项，保留 ZIP 里的同版本歌词及署名', async () => {
  let active = 0, calls = 0;
  const result = await prepareSongBatch([song, bundle, song, { ...song, id: 'unavailable', availability: 'lyrics-only' }],
    signal, () => {}, async url => {
      assert.equal(++active, 1);
      calls++;
      const res = url.endsWith('mp3') ? reply(mp3, 'audio/mpeg') : reply(await songZip(), 'application/zip');
      active--;
      return res;
    });
  assert.equal(calls, 2);
  assert.equal(result.completed.length, 2);
  assert.equal(result.remaining.length, 0);
  const zip = await JSZip.loadAsync(await result.archive!.arrayBuffer());
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  assert.deepEqual(names.sort(), ['manifest.json', '夜班/现 场/同版.lrc', '夜班/现 场/同版.mp3', '未归档歌曲/月半小夜曲.mp3'].sort());
  assert.match(await zip.file('夜班/现 场/同版.lrc')!.async('string'), /这是同版歌词/);
  const { version, tracks } = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(version, 2);
  assert.equal(tracks[0].lyrics, null);
  assert.equal(tracks[0].source.provider, 'bilibili-video');
  assert.equal(tracks[1].audio.file, '夜班/现 场/同版.mp3');
  assert.equal(tracks[1].lyrics.file, '夜班/现 场/同版.lrc');
  assert.equal(tracks[1].source.license, '测试署名');
});

test('批量保留已成功歌曲，碰到限流不继续请求，取消不返回部分 ZIP', async () => {
  const next = { ...song, id: 'next' }, remaining = { ...song, id: 'remaining' };
  let count = 0;
  const retryAt = Date.now() + 30_000;
  const result = await prepareSongBatch([song, next, remaining], signal, () => {}, async () => ++count === 1
    ? reply(mp3, 'audio/mpeg') : Response.json({ error: '数据源限流', retryAt }, { status: 429 }));
  assert.equal(count, 2);
  assert.ok(result.archive);
  assert.deepEqual(result.completed.map(({ item }) => item), [song]);
  assert.deepEqual(result.remaining, [next, remaining]);
  assert.equal(result.error?.retryAt, retryAt);

  const request = new AbortController();
  await assert.rejects(prepareSongBatch([song], request.signal, () => {}, async () => {
    request.abort();
    return reply(mp3, 'audio/mpeg');
  }), { name: 'AbortError' });
});

test('到达 ZIP 大小预算及时停止，保留可重试的歌曲', async () => {
  let requests = 0;
  const other = { ...song, id: 'other' };
  const third = { ...song, id: 'third' };
  const result = await prepareSongBatch([song, other, third], signal, () => {}, async () => {
    requests++;
    return reply(mp3, 'audio/mpeg');
  }, mp3.byteLength + 1);
  assert.equal(requests, 2);
  assert.deepEqual(result.remaining, [other, third]);
  assert.match(result.error?.message ?? '', /体积/);
  assert.ok(result.archive);
});

test('损坏的单首 ZIP 不启用试听；批量中单首失败不影响其他歌曲', async () => {
  const brokenZip = () => reply('missing ZIP', 'application/zip');
  await assert.rejects(fetchSongFile(bundle, signal, async () => brokenZip()), /损坏/);
  const batch = await prepareSongBatch([bundle, song], signal, () => {}, async url =>
    url.endsWith('/download') ? brokenZip() : reply(mp3, 'audio/mpeg'));
  assert.equal(batch.completed.length, 1);
  assert.deepEqual(batch.remaining, [bundle]);
  assert.ok(batch.archive);
  assert.match(batch.error?.message ?? '', /损坏/);
});

async function currentZip(item: SongSummary, path: string, line: string, sourceId = item.id) {
  const zip = new JSZip();
  zip.file(`${path}.mp3`, mp3);
  zip.file(`${path}.lrc`, line);
  zip.file('manifest.json', JSON.stringify({ version: 2, title: item.title, artist: item.artist, album: item.album,
    releaseId: item.releaseId, source: { provider: item.provider, id: sourceId, license: '逐曲许可' },
    audio: { file: `${path}.mp3`, format: 'mp3' }, lyrics: { file: `${path}.lrc`, kind: 'plain' } }));
  return reply(await zip.generateAsync({ type: 'arraybuffer' }), 'application/zip');
}

test('同一发行合并目录；同名录音及消毒后重名的发行不会覆盖', async () => {
  const editions = [bundle, { ...bundle, id: '13' }, { ...bundle, id: '14', album: '现:场', releaseId: 'live-02' },
    { ...bundle, id: '15', album: '未知版本', releaseId: undefined },
    { ...bundle, id: '16', album: '现/场', releaseId: 'live-02' }];
  const { archive } = await prepareSongBatch(editions, signal, () => {}, async url => {
    const item = editions.find(t => url.includes(`/${t.id}/`))!;
    return currentZip(item, `夜班/现 场/${item.id === '13' ? 'COLÉ' : 'Colé'}`, `歌词-${item.id}`);
  });
  const zip = await JSZip.loadAsync(await archive!.arrayBuffer(), { checkCRC32: true });
  const { tracks } = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(tracks.length, editions.length);
  const directory = (i: number) => tracks[i].audio.file.split('/').slice(0, -1).join('/');
  assert.equal(directory(0), '夜班/现 场');
  assert.equal(directory(0), directory(1));
  assert.notEqual(directory(0), directory(2));
  assert.equal(directory(2), directory(4));
  assert.equal(directory(3), '未归档歌曲');
  assert.equal(new Set(tracks.map((t: { audio: { file: string } }) => t.audio.file.normalize('NFKC').toLowerCase())).size, editions.length);
  for (const [i, item] of editions.entries()) {
    const entry = tracks[i];
    assert.equal(entry.lyrics.file, entry.audio.file.replace(/\.mp3$/, '.lrc'));
    assert.equal(await zip.file(entry.lyrics.file)!.async('string'), `歌词-${item.id}`);
    assert.equal(entry.source.id, item.id);
  }
});

test('不接受跨曲目标识及含相对跳转的新版单曲包', async () => {
  await assert.rejects(fetchSongFile(bundle, signal, () => currentZip(bundle, '歌手/专辑/同版', '词', '13')), /损坏/);
  await assert.rejects(fetchSongFile(bundle, signal, () => currentZip(bundle, '歌手/../同版', '词')), /损坏/);
});


test('保留根清单文件名；不同来源的同名发行不合并，投稿合集不冒充专辑', () => {
  const paths = new SongArchivePaths();
  const release = { ...bundle, artist: 'MANIFEST.JSON', album: '同名专辑' };
  assert.equal(paths.add(release, '第一首').audio, 'MANIFEST.JSON [歌手]/同名专辑/第一首.mp3');
  assert.equal(paths.add({ ...release, provider: 'jamendo' }, '第一首').audio, 'MANIFEST.JSON [歌手]/同名专辑 [2]/第一首.mp3');
  assert.equal(paths.add({ ...release, provider: 'bilibili-video' }, '第一首').audio, '未归档歌曲/第一首.mp3');
  assert.equal(paths.add({ ...release, album: '../' }, '第二首').audio, '未归档歌曲/第二首.mp3');
  assert.equal(paths.add({ ...release, artist: '未归档歌曲', releaseId: 'other' }, '第三首').audio, '未归档歌曲 [歌手]/同名专辑/第三首.mp3');
});

test('single and batch ZIP refuse an LRC whose claimed kind hides invalid or missing timecodes', async () => {
  const request = async () => currentZip(bundle, '夜班/歌曲', '[00:01]开头\n没有时码的正文');
  await assert.rejects(fetchSongFile(bundle, signal, request), /歌词/);
  const result = await prepareSongBatch([bundle], signal, () => {}, request);
  assert.equal(result.archive, null);
  assert.deepEqual(result.remaining, [bundle]);
});
