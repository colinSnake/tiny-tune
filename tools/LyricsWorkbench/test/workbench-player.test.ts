import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkbenchPlayer } from '../app/workbench-player';
import type { WorkbenchDetail } from '../app/workbench-state';

const track = { id: 'bilibili-video:BV1xN411x76o-1', title: '句号', artist: '邓紫棋', duration: 236, albums: [] };
const detail: WorkbenchDetail = { key: track.id, track, result: { status: 'running' }, song: {
  provider: 'bilibili-video', id: 'BV1xN411x76o-1', title: track.title, artist: track.artist, duration: 236, album: '',
  availability: 'stream-only', lyrics: null, bilibiliVideoId: 'BV1xN411x76o', bilibiliPage: 1,
  previewUrl: null, sourceUrl: 'https://www.bilibili.com/video/BV1xN411x76o/', licenseUrl: null,
} };

test('source preview starts collapsed and lyric search remains visible in its own labelled card', () => {
  const html = renderToStaticMarkup(createElement(WorkbenchPlayer, { detail, result: detail.result }));
  assert.match(html, /aria-label="打开来源播放器"/);
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /class="wb-media-stage"[^]*class="wb-stage-placeholder\b/);
  assert.match(html, /class="wb-lyrics-card" aria-labelledby="wb-lyrics-title"/);
  assert.match(html, /正在查找歌词/);
});

test('video preview separates a trusted song heading, original source title, credits and stanzas', () => {
  const title = '《告白气球》周杰伦丨百万级录音棚试听丨【Hi-Res无损】';
  const identified: WorkbenchDetail = { ...detail, track: { ...detail.track, title, artist: '' }, song: { ...detail.song!, title, artist: '', lyricIdentity: { title: '告白气球', artist: '周杰伦' } } };
  const result = { status: 'plain' as const, candidate: { id: 1, title: '告白气球', artist: '周杰伦', album: '', duration: 210, instrumental: false, synced: '', plain: '告白气球\n词：样例作者\n曲：样例作曲\n\n第一行\n第二行\n\n\n第三行' } };
  const html = renderToStaticMarkup(createElement(WorkbenchPlayer, { detail: identified, result }));
  assert.match(html, /<h2[^>]*>告白气球<\/h2>/);
  assert.match(html, /wb-source-caption[^]*百万级录音棚试听/);
  assert.match(html, /wb-lyric-credits[^]*样例作者[^]*样例作曲/);
  assert.match(html, /<p>第一行<br\/>第二行<\/p><p>第三行<\/p>/);
  assert.doesNotMatch(html, /aria-label="时码歌词"|data-line=/);
});

test('a normal lyric line is never stripped just because it mentions lyrics credits', () => {
  const result = { status: 'plain' as const, candidate: { id: 1, title: track.title, artist: track.artist, album: '', duration: 236, instrumental: false, synced: '', plain: '我想写一行字\n词：是留给你的话\n\n再听一个晚上' } };
  const html = renderToStaticMarkup(createElement(WorkbenchPlayer, { detail, result }));
  assert.doesNotMatch(html, /wb-lyric-credits/);
  assert.match(html, /我想写一行字<br\/>词：是留给你的话/);
});

test('pure-text metadata matches a traditional title and a romanized artist alias while preserving lyrics in original mode', () => {
  const track = { ...detail.track, title: '样例歌曲', artist: '样例歌手' };
  const candidate = { id: 1, title: track.title, artist: track.artist, album: '', duration: 236, instrumental: false, synced: '',
    plain: '樣例歌曲 - 樣例歌手 (Sample Singer)\n詞：甲\n曲：乙\n編曲：丙\n第一句原詞\n第二句原詞\n\n下一段' };
  const html = renderToStaticMarkup(createElement(WorkbenchPlayer, { detail: { ...detail, track }, lyricScript: 'original', result: { status: 'plain', candidate } }));
  assert.match(html, /wb-lyric-credits[^>]*>詞：甲 · 曲：乙 · 編曲：丙<\/p>/);
  assert.match(html, /<p>第一句原詞<br\/>第二句原詞<\/p><p>下一段<\/p>/);
  assert.doesNotMatch(html, /Sample Singer/);
});

test('a lyric may start with the song title when there is no metadata marker', () => {
  const candidate = { id: 1, title: track.title, artist: track.artist, album: '', duration: 236, instrumental: false, synced: '', plain: '句号\n这行开头确实就是歌名' };
  const html = renderToStaticMarkup(createElement(WorkbenchPlayer, { detail, result: { status: 'plain', candidate } }));
  assert.match(html, /<p>句号<br\/>这行开头确实就是歌名<\/p>/);
});

test('audio controls and a lyrics-only result reserve the same player area', () => {
  const audio = { ...detail, song: { ...detail.song!, previewUrl: '/sample.wav' } };
  const noAudio = { ...detail, key: 'lrclib:1', song: { ...detail.song!, bilibiliVideoId: undefined, availability: 'lyrics-only' as const } };
  const render = (item: WorkbenchDetail) => renderToStaticMarkup(createElement(WorkbenchPlayer, { detail: item, result: item.result }));
  assert.match(render(audio), /class="wb-media-stage"[^]*<audio[^]*aria-label="播放音频"/);
  assert.match(render(noAudio), /class="wb-media-stage"[^]*此结果仅提供歌词/);
  assert.doesNotMatch(render(noAudio), /<audio|<iframe/);
});

test('the default preview simplifies both plain lyric text and credits without changing the candidate', () => {
  const candidate = { id: 1, title: track.title, artist: track.artist, album: '', duration: 236, instrumental: false, synced: '',
    plain: '句號\n詞：測試作者\n\n愛與聲音\n聽見原詞' };
  const html = renderToStaticMarkup(createElement(WorkbenchPlayer, { detail, result: { status: 'plain', candidate } }));
  assert.match(html, /wb-lyric-credits[^>]*>词：测试作者<\/p>/);
  assert.match(html, /<p>爱与声音<br\/>听见原词<\/p>/);
  assert.equal(candidate.plain, '句號\n詞：測試作者\n\n愛與聲音\n聽見原詞');
});

test('timed lyrics show only the words in either script without changing the source timecodes', () => {
  const synced = '[00:06.250]愛與聲音\n[00:09.500]聽見原詞';
  const candidate = { id: 1, title: track.title, artist: track.artist, album: '', duration: 236, instrumental: false, plain: '', synced };
  const render = (lyricScript: 'simplified' | 'original') => renderToStaticMarkup(createElement(WorkbenchPlayer, { detail, lyricScript, result: { status: 'timed', candidate } }));
  const simplified = render('simplified');
  const original = render('original');
  assert.doesNotMatch(simplified, /<time\b|0:06|0:09/);
  assert.doesNotMatch(original, /<time\b|0:06|0:09/);
  assert.match(simplified, /<span[^>]*>爱与声音<\/span>[\s\S]*<span[^>]*>听见原词<\/span>/);
  assert.match(original, /<span[^>]*>愛與聲音<\/span>[\s\S]*<span[^>]*>聽見原詞<\/span>/);
  assert.equal(candidate.synced, synced);
});

test('timed lyric content includes a trailing scroll area for the final active lines', () => {
  const timed = { status: 'timed' as const, candidate: { id: 1, title: track.title, artist: track.artist, album: '', duration: 236,
    instrumental: false, synced: '[00:01.00]第一句\n[00:04.00]第二句', plain: '第一句\n第二句' } };
  const html = renderToStaticMarkup(createElement(WorkbenchPlayer, { detail, result: timed }));
  assert.match(html, /wb-lyric-tail-space/);
});

test('video artist hints explain automatic folder selection without prompting or changing source credits', () => {
  const hinted: WorkbenchDetail = { ...detail, lyricLookupHint: 'Imagine Dragons', track: { ...detail.track, artist: '' },
    song: { ...detail.song!, artist: '' } };
  const html = renderToStaticMarkup(createElement(WorkbenchPlayer, { detail: hinted, result: { status: 'missing' } }));
  assert.match(html, /歌词按“Imagine Dragons”查找/);
  assert.match(html, /这是搜索线索，不是投稿署名/);
  assert.match(html, /保存时自动使用该歌手目录，不改写投稿署名/);
  assert.doesNotMatch(html, /会要求确认|保存权限/);
  assert.match(html, /按“Imagine Dragons”查找后仍未匹配到歌词/);
  assert.doesNotMatch(html, /来源未提供明确歌手，暂无法匹配歌词/);
});
