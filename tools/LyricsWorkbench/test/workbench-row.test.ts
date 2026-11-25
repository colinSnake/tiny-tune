import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkbenchSongRow } from '../app/workbench-row';
import type { WorkspaceRow } from '../src/workbench';
const track: WorkspaceRow = { key: 'jamendo:1', kind: 'song', versions: [], track: { provider: 'jamendo', id: '1', title: '非常长的歌名', artist: '唯一歌手', album: '发行', duration: 241, availability: 'audio-only' } };
const noop = () => {};
function render(row = track, playing = false, downloadedKeys = new Set<string>()) { return renderToStaticMarkup(createElement(WorkbenchSongRow, { row, selected: true, checked: false, busy: false, playing, downloadedKeys, onSelect: noop, onToggle: noop, onPreview: noop, onDownload: noop })); }
test('song row shows two text lines, duration and actual download status', () => {
 const html = render();
 assert.ok(html.includes('class="wb-row-copy"'));
 assert.ok(html.includes('class="wb-row-meta"'));
 assert.equal(html.split('>唯一歌手</').length - 1, 1);
 assert.ok(html.includes('4:01'));
 assert.ok(html.includes('未下载'));
 assert.ok(!html.includes('wb-cover'));
});
test('playback and download are labeled icon-only controls with accurate pause state', () => {
 const html = render(track, true, new Set([track.key]));
 assert.ok(html.includes('aria-label="暂停《非常长的歌名》"'));
 assert.ok(html.includes('aria-label="下载《非常长的歌名》"'));
 assert.ok(html.includes('已下载'));
 for (const label of ['试听','下载','暂停']) assert.ok(!html.includes('>'+label+'<'));
});
test('local audio is downloaded and does not offer a misleading remote download', () => {
 const row: WorkspaceRow = { key: 'local-1', kind: 'local', track: { id: 'local-1', title: '本地曲目', artist: '本地歌手', duration: null, albums: [], file: '真实目录/本地曲目.mp3', hasLyrics: false } };
 const html = render(row);
 assert.ok(html.includes('已下载'));
 assert.match(html, /aria-label="下载《本地曲目》"[^>]*disabled/);
 assert.ok(!html.includes('真实目录/本地曲目.mp3'));
});


test('lyric-only row does not suggest that an unavailable song simply has not been downloaded', () => {
 const html = render({ ...track, key: 'lrclib:1', track: { ...track.track, provider: 'lrclib', availability: 'lyrics-only' } });
 assert.ok(html.includes('仅歌词'));
 assert.ok(!html.includes('未下载'));
 assert.ok(html.includes('仅提供歌词，不含音频'));
});

test('identified video rows show a clean title and human-readable edition without losing the source title', () => {
  const title = '【4K60帧】《告白气球》——周杰伦';
  const row: WorkspaceRow = { ...track, track: { ...track.track, title, artist: '', provider: 'bilibili-video' } };
  const html = render(row);
  assert.match(html, /<strong>告白气球<\/strong>/);
  assert.match(html, /周杰伦 · 4K 60 帧/);
  assert.ok(html.includes(`title="${title}"`));
});
