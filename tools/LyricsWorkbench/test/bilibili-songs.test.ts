import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import JSZip from 'jszip';
import { BilibiliCatalog, BilibiliMedia, bilibiliReleases } from '../src/bilibili-songs';
import { createServer } from '../src/server';
import { JamendoCatalog } from '../src/songs';
import type { SongSummary } from '../src/song-types';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const source = 'https://www.bilibili.com/video/BV1QE421w7GX/';
const id = '1619745690';
const recording = Buffer.from('approved original input fixture');
const frame = Buffer.alloc(417);
frame.set([0xff, 0xfb, 0x90, 0x64]);
const audio = Buffer.concat(Array.from({ length: 115 }, () => frame));
const project = '\uFEFFvoice_parts:\r\n- name: First\r\n    lyric: 甲\r\n    lyric: 乙\r\n- name: Second\r\n    lyric: "丙"\r\nwave_parts:\r\n- name: backing';

async function setup(t: TestContext, change: { badProject?: boolean; badAudio?: boolean; shortMp3?: boolean; missingTools?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tinytune-bili-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ytDlp = join(dir, 'yt-dlp.cjs'), ffmpeg = join(dir, 'ffmpeg.cjs');
  const command = async (path: string, code: string) => writeFile(path, `#!${process.execPath}\n${code}\n`, { mode: 0o700 });
  await command(ytDlp, `
    const assert = require('node:assert/strict');
    const args = process.argv.slice(2);
    assert.deepEqual(args.slice(-2), ['--', ${JSON.stringify(source)}]);
    assert(args.includes('--ignore-config') && args.includes('--no-plugin-dirs'));
    assert(args.includes('30280[protocol=https][vcodec=none]'));
    process.stdout.write(Buffer.from(${JSON.stringify(change.badAudio ? 'different upstream recording' : recording.toString())}));
  `);
  await command(ffmpeg, `
    const assert = require('node:assert/strict');
    assert(process.argv.includes('libmp3lame'));
    assert.equal(process.argv[process.argv.indexOf('-q:a') + 1], '0');
    assert(!process.argv.includes('-b:a'), 'do not force a lossy 128 kbps bottleneck');
    assert.equal(require('node:fs').readFileSync(0, 'utf8'), ${JSON.stringify(recording.toString())});
    process.stdout.write(Buffer.from(${JSON.stringify((change.shortMp3 ? audio.subarray(0, frame.length * 4) : audio).toString('base64'))}, 'base64'));
  `);
  const release = { ...bilibiliReleases[0], duration: 3, audioHash: hash(recording), projectHash: hash(project),
    lyricLines: [[0, 1, 2], [1, 1, 1]] as const };
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, release.projectUrl);
    assert.equal(init?.redirect, 'error');
    return new Response(change.badProject ? `${project} changed` : project);
  };
  const bilibiliSongs = new BilibiliCatalog({ entries: [release], commands: change.missingTools ? false : { ytDlp, ffmpeg }, request });
  const app = await createServer({ songs: new JamendoCatalog({}), bilibiliSongs });
  t.after(() => app.close());
  return app;
}

const detailPath = `/api/songs/bilibili/${id}`;
const downloadPath = `${detailPath}/download`;

test('B 站录音可用歌名或歌手找到，从列表直打包该版本的 MP3 和工程歌词', async t => {
  const server = await setup(t);
  assert.deepEqual((await server.inject('/api/songs/status')).json().sources, ['bilibili']);
  for (const query of ['自由软件之歌', 'Diamochang']) {
    const search = await server.inject(`/api/songs?source=bilibili&q=${encodeURIComponent(query)}`);
    assert.equal(search.statusCode, 200, search.body);
    assert.deepEqual(search.json().tracks.map(({ provider, id, availability }: SongSummary) => [provider, id, availability]), [['bilibili', id, 'ready']]);
  }
  const detail = await server.inject(detailPath);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().track.sourceUrl, source);
  assert.equal(detail.json().track.bilibiliVideoId, 'BV1QE421w7GX');
  assert.deepEqual(detail.json().track.lyrics, { kind: 'plain', text: '甲 乙\n丙' });

  // A client-supplied URL never becomes a subprocess argument or changes the recording.
  const reply = await server.inject({ method: 'POST', url: downloadPath, payload: { url: 'http://127.0.0.1/' } });
  assert.equal(reply.statusCode, 200, reply.body.slice(0, 300));
  const zip = await JSZip.loadAsync(reply.rawPayload, { checkCRC32: true });
  const mp3 = Object.keys(zip.files).find(file => file.endsWith('.mp3'))!;
  assert.deepEqual(await zip.file(mp3)!.async('nodebuffer'), audio);
  assert.equal(await zip.file(mp3.replace(/\.mp3$/, '.lrc'))!.async('string'), '甲 乙\n丙');
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(manifest.source.url, source);
  assert.equal(manifest.source.license, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.match(manifest.source.credits, /Diamochang/);
  assert.match(manifest.lyrics.source, /free-software-song-openutau\/blob\//);
  assert.equal((await server.inject({ method: 'POST', url: '/api/songs/bilibili/42/download' })).statusCode, 404);
});

test('B 站未安装工具或来源版本变化时不返回坏 ZIP', async t => {
  const disabled = await setup(t, { missingTools: true });
  assert.deepEqual((await disabled.inject('/api/songs/status')).json().sources, []);
  assert.equal((await disabled.inject({ method: 'POST', url: downloadPath })).statusCode, 503);
  for (const [change, status, message] of [
    [{ badProject: true }, 409, /歌词工程版本/], [{ badAudio: true }, 409, /音轨版本/], [{ shortMp3: true }, 502, /时长/],
  ] as const) {
    const server = await setup(t, change);
    const response = await server.inject({ method: 'POST', url: downloadPath });
    assert.equal(response.statusCode, status, response.body);
    assert.match(response.json().error, message);
  }
});

test('普通 MP3 转码只允许指定的 B 站分集和 HTTPS 音轨，并验证完整时长', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tinytune-bili-mp3-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ytDlp = join(dir, 'yt-dlp.cjs'), ffmpeg = join(dir, 'ffmpeg.cjs');
  const url = `${source}?p=2`;
  await writeFile(ytDlp, `#!${process.execPath}
    const assert = require('node:assert/strict');
    const args = process.argv.slice(2);
    assert.deepEqual(args.slice(-2), ['--', ${JSON.stringify(url)}]);
    assert.equal(args[args.indexOf('--match-filters') + 1], 'id = BV1QE421w7GX_p2');
    assert(args.includes('--no-cookies') && args.includes('--no-cookies-from-browser'));
    assert.deepEqual(args[args.indexOf('-f') + 1].split('/'),
      ['30280', '30232', '30216'].map(id => id + '[protocol=https][vcodec=none]'));
    process.stdout.write(Buffer.from(${JSON.stringify(recording.toString())}));
  `, { mode: 0o700 });
  await writeFile(ffmpeg, `#!${process.execPath}
    const assert = require('node:assert/strict');
    const args = process.argv.slice(2);
    assert.equal(args[args.indexOf('-q:a') + 1], '0');
    assert(!args.includes('-b:a'), 'do not force a lossy 128 kbps bottleneck');
    assert.equal(require('node:fs').readFileSync(0, 'utf8'), ${JSON.stringify(recording.toString())});
    process.stdout.write(Buffer.from(${JSON.stringify(audio.toString('base64'))}, 'base64'));
  `, { mode: 0o700 });
  const media = new BilibiliMedia({ ytDlp, ffmpeg });
  const signal = new AbortController().signal;
  assert.deepEqual(await media.audio(url, 3, undefined, signal), audio);
  await assert.rejects(media.audio(source, 3, undefined, signal), /无效的 B 站音轨标识/);
  await assert.rejects(media.audio(url, 9, undefined, signal), /时长不符/);
});


test('MP3 duration validation accepts genuine variable bitrate frame sizes', async () => {
  const { mp3Duration } = await import('../src/song-mp3');
  const rates = [128, 192, 256, 320], indices = [9, 11, 13, 14];
  const frames = Array.from({ length: 115 }, (_, index) => {
    const i = index % rates.length;
    const frame = Buffer.alloc(Math.floor(144000 * rates[i] / 44100));
    frame.set([0xff, 0xfb, indices[i] << 4, 0x64]);
    return frame;
  });
  assert.equal(mp3Duration(Buffer.concat(frames)), 115 * 1152 / 44100);
  assert.equal(mp3Duration(Buffer.concat(frames).subarray(0, -1)), null);
});
