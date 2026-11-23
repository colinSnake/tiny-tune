import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import JSZip from 'jszip';
import { parseLrc, activeIndex } from '../src/lrc';
import { createArchive, exportEntries, lrcFilename } from '../src/export';
import type { CollectionItem } from '../src/types';

const sample = await readFile(new URL('../../../tests/Fixtures/Lyrics/timeline.lrc', import.meta.url), 'utf8');

test('shared timeline applies offset, sorts lines, and respects clear markers', () => {
  const { cues } = parseLrc(sample);
  assert.deepEqual(cues.map(({ ms }) => ms), [875, 2750, 5250, 7750]);
  assert.deepEqual(cues.map(({ lines }) => lines), [['第一句'], ['合成段落', '第二行'], [], ['合成段落']]);
  assert.equal(activeIndex(cues, 0.874), -1);
  assert.equal(activeIndex(cues, 0.875), 0);
  assert.equal(activeIndex(cues, 2.75), 1);
  assert.equal(activeIndex(cues, 5.25), -1);
  assert.equal(activeIndex(cues, 7.75), 3);
  assert.equal(activeIndex(cues, Infinity), -1);
  assert.equal(parseLrc('\ufeff[ti:title]\r\n正文\r\n下一行\r\n').plain, '正文\n下一行');
});

test('exports only confirmed items, avoids collisions and includes a manifest', async () => {
  const track = { id: 'a', title: '../晴天', artist: '测试', albums: [], duration: 10 };
  const candidate = { id: 1, title: '晴天', artist: '测试', album: '', duration: 10,
    instrumental: false, synced: sample, plain: '' };
  const items: CollectionItem[] = [
    { track, result: { status: 'timed', candidate } },
    { track: { ...track, id: 'b' }, result: { status: 'plain', candidate: { ...candidate, synced: '', plain: '纯文本' } } },
    { track: { ...track, id: 'c' }, result: { status: 'review', candidates: [candidate] } },
  ];
  const data = exportEntries(items);
  assert.equal(data.files.length, 2);
  assert.equal(new Set(data.files.map(file => file.name)).size, 2);
  assert.ok(data.files.every(file => !/[\\/]/.test(file.name) && !file.name.startsWith('.')));
  assert.equal(data.manifest.tracks[2].file, null);
  assert.equal(data.files[1].text, '纯文本');
  assert.equal(lrcFilename('01 曲.Live.flac', true), '01 曲.Live.lrc');
  assert.equal(lrcFilename('01  曲.Live.flac', true), '01  曲.Live.lrc');
  assert.equal(lrcFilename('CON.flac', true), '_CON.lrc');
  assert.equal(lrcFilename('Note: Part?.flac', true), 'Note Part.lrc');
  const zip = await JSZip.loadAsync(await createArchive(data));
  assert.equal(await zip.file(data.files[0].name)?.async('string'), sample);
  assert.equal(JSON.parse((await zip.file('manifest.json')?.async('string'))!).tracks.length, 3);
});
