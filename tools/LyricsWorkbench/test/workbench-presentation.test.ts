import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Workbench from '../app/workbench';
import * as model from '../src/workbench';
import type { WorkspaceRow } from '../src/workbench';

const local: WorkspaceRow = { key: 'local-1', kind: 'local', track: { id: 'local-1', title: '歌名', artist: '歌手', duration: 241, albums: [], file: '歌手/专辑/原文件.mp3', hasLyrics: false } };
const online: WorkspaceRow = { key: 'jamendo:1', kind: 'song', versions: [], track: { provider: 'jamendo', id: '1', title: '歌名', artist: '歌手', album: '专辑', duration: 241, availability: 'audio-only' } };

test('workbench has a single action toolbar above both panels, not duplicate actions inside the detail', () => {
  const html = renderToStaticMarkup(createElement(Workbench));
  assert.match(html, /aria-label="统一下载与保存"/);
  assert.ok(html.indexOf('aria-label="统一下载与保存"') < html.indexOf('aria-label="歌曲与歌词工作区"'));
  assert.match(html, /保存到本机目录/);
  assert.match(html, /一键下载/);
  assert.doesNotMatch(html, /找歌，听歌/);
});

test('download status means local audio or an explicitly completed download, not just downloadable', () => {
  assert.equal(typeof model.rowPresentation, 'function', 'rowPresentation should distinguish existence from availability');
  assert.equal(model.rowPresentation(local).downloaded, true);
  assert.equal(model.rowPresentation(online).downloaded, false);
  assert.equal(model.rowPresentation(online, new Set([online.key])).downloaded, true);
  assert.equal(model.rowPresentation(online).status, '未下载');
  assert.equal(model.rowPresentation(local).status, '已下载');
});

test('unavailable sources and lyric-only results never offer a misleading audio download', () => {
  assert.equal(typeof model.rowPresentation, 'function');
  assert.equal(model.rowPresentation(online).canDownload, true);
  for (const availability of ['review', 'lyrics-only', 'stream-only'] as const) {
    const row: WorkspaceRow = { ...online, track: { ...online.track, availability } };
    assert.equal(model.rowPresentation(row).canDownload, false);
    assert.equal(model.rowPresentation(row).downloaded, false);
  }
  assert.equal(model.rowPresentation(local).canPreview, true);
});

test('row main explicitly resets legacy column flex direction to keep duration beside two text lines', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  const rule = css.split('.wb-row-main {')[1]?.split('}')[0] ?? '';
  assert.match(rule, /flex-direction:\s*row/);
});

test('workbench illustrations belong to the page background, not the hero or accessibility tree', async () => {
  const html = renderToStaticMarkup(createElement(Workbench));
  assert.doesNotMatch(html, /wb-intro-art/);
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  const pageRule = css.match(/body:has\(\.wb-shell\)\s*\{[^}]*web-paper-left\.svg[^}]*web-paper-right\.svg/)?.[0];
  assert.ok(pageRule, 'desktop artwork must be owned by the workspace page');
  assert.match(css, /@media\s*\(max-width:\s*560px\)\s*\{\s*body:has\(\.wb-shell\)\s*\{[^}]*background-image:[^;}]*web-paper-right\.svg[^;}]*;/);
  assert.match(css, /@media\s*\(prefers-contrast:\s*more\)[^{]*\{\s*body:has\(\.wb-shell\)\s*\{[^}]*background-image:\s*none/);
  for (const side of ['left', 'right']) {
    const asset = await readFile(new URL(`../public/web-paper-${side}.svg`, import.meta.url), 'utf8');
    assert.match(asset, /^<svg /);
  }
});


test('lyric-only and catalog rows state that no song audio is available', () => {
  const lyrics: WorkspaceRow = { ...online, key: 'lrclib:1', track: { ...online.track, provider: 'lrclib', availability: 'lyrics-only' } };
  const catalog: WorkspaceRow = { key: 'catalog:1', kind: 'catalog', track: { id: '1', title: '歌名', artist: '歌手', albums: [], duration: 241 } };
  for (const row of [lyrics, catalog]) {
    assert.equal(model.rowPresentation(row).status, '仅歌词');
    assert.equal(model.rowPresentation(row, new Set([row.key])).downloaded, false);
    assert.equal(model.rowPresentation(row).canPreview, false);
  }
  assert.equal(model.rowPresentation({ ...online, track: { ...online.track, availability: 'stream-only' } }).status, '仅试听');
  assert.equal(model.rowPresentation({ ...online, track: { ...online.track, availability: 'review' } }).status, '待核验');
});

test('downloadable audio appears before catalog and lyric-only results without dropping versions', () => {
  const catalog = { id: 'catalog-1', title: '歌名', artist: '歌手', albums: [], duration: 241 };
  const lyrics = { ...online.track, provider: 'lrclib' as const, availability: 'lyrics-only' as const };
  const stream = { ...online.track, id: '2', availability: 'stream-only' as const };
  const rows = model.workspaceRows([local.track], [catalog], [lyrics, stream, online.track, { ...lyrics, id: '3' }], '歌手');
  assert.deepEqual(rows.map(row => row.key), [local.key, online.key, 'catalog:catalog-1', 'lrclib:1', 'jamendo:2']);
  assert.equal(rows[3].kind === 'song' && rows[3].versions.length, 2);
});

test('selection notice discloses lyric-only saves before the action', () => {
  const lyrics: WorkspaceRow = { ...online, track: { ...online.track, availability: 'lyrics-only' } };
  assert.match(model.selectionSaveNotice([lyrics, lyrics, lyrics]) ?? '', /3 项仅提供歌词/);
  assert.match(model.selectionSaveNotice([lyrics]) ?? '', /不会保存音频/);
  assert.match(model.selectionSaveNotice([lyrics]) ?? '', /独立歌词/);
  assert.equal(model.selectionSaveNotice([online, local]), undefined);
});

test('lyric dropdown removes its outer focus ring and leaves more room beside adjacent controls', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  const focus = css.match(/\.wb-lyric-script select:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(focus, /outline:\s*none/);
  assert.match(focus, /box-shadow:\s*none/);
  assert.match(focus, /border-color:\s*var\(--accent\)/);
  assert.match(css, /\.wb-actions-buttons\s*\{[^}]*gap:\s*12px/);
  assert.match(css, /\.wb-lyric-script\s*\{[^}]*gap:\s*8px/);
  assert.match(css, /\.wb-actions-toolbar \.wb-actions-buttons\s*\{[^}]*gap:\s*7px/);
});

test('the workspace canvas has a 12px inset and preserves a responsive 640px 16:9 source video', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  assert.match(css, /\.wb-shell\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*padding:\s*12px;/);
  assert.match(css, /\.wb-layout\s*\{[^}]*grid-template-columns:[^;]+minmax\(0,\s*1fr\)/);
  assert.match(css, /\.wb-shell \.header-inner\s*\{[^}]*max-width:\s*none;/);
  const video = css.match(/\.wb-source-video\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(video, /width:\s*min\(100%,\s*640px\)/);
  assert.match(video, /height:\s*auto/);
  assert.match(video, /aspect-ratio:\s*16\s*\/\s*9/);
});

test('wide layouts share the remaining space equally between the song list and lyrics', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  assert.match(css, /\.wb-shell\s*\{[^}]*container:\s*workbench\s*\/\s*inline-size/);
  assert.match(css, /\.wb-layout\s*\{[^}]*gap:\s*var\(--wb-column-gap\)/);
  assert.match(css, /\.wb-playback-layout\s*\{[^}]*gap:\s*var\(--wb-column-gap\)/);
  assert.match(css, /@container workbench[^{}]*\{\s*\.wb-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) calc\(\(100% \+ var\(--wb-player-card-width\)\) \/ 2\);[^}]*\}\s*\.wb-playback-layout\s*\{[^}]*grid-template-columns:\s*var\(--wb-player-card-width\) minmax\(0,\s*1fr\);/);
});

test('the search lives in the header, titles use soft candy, and lyric text uses the regular UI font', async () => {
  const html = renderToStaticMarkup(createElement(Workbench));
  assert.match(html, /<header[\s\S]+role="search"[\s\S]+<\/header>/);
  assert.match(html, /歌曲与版本/);
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  assert.match(css, /\.wb-page-title[^{}]*\{[^}]*font-family:\s*var\(--display\)/);
  assert.match(css, /\.wb-lyric-text\s*\{[^}]*font-family:\s*var\(--ui\);[^}]*font-size:\s*14px/);
  assert.match(css, /\.wb-lyric-reading\s*\{[^}]*max-inline-size:\s*300px/);
});


test('the initial player reserves a themed 16:9 stage and reading surfaces let the page artwork through', async () => {
  const html = renderToStaticMarkup(createElement(Workbench));
  assert.match(html, /class="wb-media-stage"[^]*选择左侧歌曲/);
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  assert.match(css, /\.wb-media-stage\s*\{[^}]*width:\s*min\(100%,\s*640px\)[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /\.wb-lyrics-card\s*\{[^}]*background:\s*linear-gradient\([^}]*transparent/);
  assert.match(css, /\[data-wb-theme="dark"\][^]*--wb-stage-bg:/);
});

test('the search form suppresses the shared outer focus ring and retains a border focus cue', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  const focus = css.match(/\.wb-search\.search-form:focus-within\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(focus, /outline:\s*none/);
  assert.match(focus, /box-shadow:\s*none/);
  assert.match(focus, /border-color:\s*var\(--accent\)/);
});


test('the song list lets the viewport artwork show through like the lyrics panel', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  assert.match(css, /\.wb-list\s*\{[^}]*background:\s*linear-gradient\([^}]*var\(--wb-reading-wash\)[^}]*transparent/);
});

test('the header shows one icon-only theme switch with a tooltip describing its default system mode', () => {
  const html = renderToStaticMarkup(createElement(Workbench));
  const header = html.match(/<header[^>]*>.*?<\/header>/)?.[0] ?? '';
  const toggle = header.match(/<button(?=[^>]*aria-label="切换主题")([^>]*)>([\s\S]*?)<\/button>/);
  assert.ok(toggle, 'header must contain an accessible theme button');
  const tooltipId = toggle[1].match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(tooltipId, 'theme button must reference the tooltip');
  assert.match(toggle[2], /^<svg[^>]*lucide-monitor[^>]*>[\s\S]*<\/svg>$/);
  assert.ok(header.includes(`id="${tooltipId}"`));
  assert.match(header, /role="tooltip"[^>]*>[\s\S]*跟随系统/);
});
