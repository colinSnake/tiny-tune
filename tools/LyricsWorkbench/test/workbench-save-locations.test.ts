import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkbenchSaveLocations } from '../app/workbench-save-locations';

test('save details show actual source artist directories and distinguish lyrics from audio', () => {
  const html = renderToStaticMarkup(createElement(WorkbenchSaveLocations, {
    root: '/music/',
    files: [
      { title: '七里香 周杰伦', lyrics: 'GM Lyric/独立歌词/GM Lyric - 七里香 周杰伦.lrc' },
      { title: '晴天', audio: '周杰伦/周杰伦 - 晴天.mp3', lyrics: '周杰伦/周杰伦 - 晴天.lrc' },
    ],
  }));
  assert.match(html, /查看保存位置/);
  assert.match(html, /仅歌词（无音频）/);
  assert.match(html, /音频：/);
  assert.match(html, /歌词：/);
  assert.ok(html.includes('/music/GM Lyric/独立歌词/GM Lyric - 七里香 周杰伦.lrc'));
  assert.ok(html.includes('/music/周杰伦/周杰伦 - 晴天.mp3'));
  assert.ok(!html.includes('/music//'));
});

test('save details do not appear without successful file locations', () => {
  assert.equal(renderToStaticMarkup(createElement(WorkbenchSaveLocations, { root: '/music', files: [] })), '');
});
