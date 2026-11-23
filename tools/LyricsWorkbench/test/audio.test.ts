import assert from 'node:assert/strict';
import test from 'node:test';
import { fullTrackSync, matchAudio, parseAudioLink, resolveLocalAudio, type AudioMetadata } from '../src/audio';
import { exactArtist } from '../src/collection';
import type { Track } from '../src/types';

const track: Track = { id: 'a', title: 'Find You', artist: 'G.E.M.', albums: ['Revelación'], duration: 255, isrcs: ['HKABC2200001'] };
const file: AudioMetadata = { id: 'file', name: '01 Find You.flac', title: 'Find You', artist: 'G.E.M.', album: 'Revelación', duration: 255, isrcs: [] };

test('exact artist or alias only opens a sole unambiguous result', () => {
  const result = { id: 'a', name: 'G.E.M. 鄧紫棋', aliases: ['邓紫棋'], hint: '', area: '' };
  assert.equal(exactArtist(' 邓紫棋 ', [result]), result);
  assert.equal(exactArtist('紫棋', [result]), undefined);
  assert.equal(exactArtist('邓紫棋', [result, { ...result, id: 'b' }]), undefined);
});

test('only a clear local version auto-matches; plausible duplicate recordings need confirmation', () => {
  assert.equal(matchAudio(track, [file], [track]).automatic?.id, 'file');
  const competing = { ...track, id: 'b', title: 'FIND YOU', artist: 'G.E.M. 鄧紫棋', albums: [], duration: 256, isrcs: [] };
  assert.equal(matchAudio(track, [file], [track, competing]).automatic, undefined);
  assert.equal(matchAudio(track, [file], [track, competing]).candidates.length, 1);
  const untagged = { ...file, title: '', artist: '', album: '' };
  assert.equal(matchAudio(track, [untagged], [track]).candidates.length, 1);
  assert.equal(matchAudio(track, [untagged], [track]).automatic, undefined);
  assert.equal(matchAudio(track, [file, { ...file, id: 'copied' }], [track]).automatic, undefined);
  const otherArtist = { ...file, artist: 'Another artist' };
  assert.equal(matchAudio(track, [otherArtist], [track]).automatic, undefined);
});

test('a saved automatic pairing yields to newly discovered ambiguity but an explicit choice survives', () => {
  const other = { ...track, id: 'other', albums: [], isrcs: [], duration: 256 };
  const saved = { kind: 'local', audioId: file.id, automatic: true } as const;
  assert.equal(resolveLocalAudio(saved, [file], matchAudio(track, [file], [track]).automatic), file);
  assert.equal(resolveLocalAudio(saved, [file], matchAudio(track, [file], [track, other]).automatic), undefined);
  assert.equal(resolveLocalAudio({ kind: 'local', audioId: file.id }, [file], undefined), file);
  assert.equal(resolveLocalAudio({ kind: 'none' }, [file], file), undefined);
});

test('ISRC can disambiguate versions but not contradictory tags or durations', () => {
  const duplicate = { ...track, id: 'b', isrcs: ['HKABC2200002'] };
  const exact = { ...file, isrcs: ['hk-abc-22-00001'] };
  assert.equal(matchAudio(track, [exact, { ...file, id: 'other', isrcs: ['HKABC2200002'] }], [track, duplicate]).automatic?.id, 'file');
  assert.equal(matchAudio(track, [{ ...exact, duration: 275 }], [track]).automatic, undefined);
  assert.equal(matchAudio(track, [{ ...file, isrcs: duplicate.isrcs! }], [track]).automatic, undefined);
  assert.equal(matchAudio(track, [{ ...exact, album: 'Live' }], [track]).automatic, undefined);
});

test('only a plausible full recording enables lyric seeking', () => {
  assert.equal(fullTrackSync(255.8, 255, 253, 'full'), true);
  assert.equal(fullTrackSync(30, 255, 253, 'clip'), false);
  assert.equal(fullTrackSync(30, 255, 23, 'full'), false);
  assert.equal(fullTrackSync(255, 255, 255.2, 'full'), false);
  assert.equal(fullTrackSync(255, null, 253, 'full'), false);
  assert.equal(fullTrackSync(19, 19, 17, 'full', 255), false);
});

test('accepts browser-playable direct URL forms, never credentials or non-web schemes', () => {
  assert.equal(parseAudioLink(' https://example.org/song.flac?rev=2 '), 'https://example.org/song.flac?rev=2');
  assert.equal(parseAudioLink('http://127.0.0.1:9118/audio.wav'), 'http://127.0.0.1:9118/audio.wav');
  for (const invalid of ['javascript:alert(1)', 'file:///audio.mp3', 'data:audio/wav,abc', 'https://secret@example.org/a', 'http://example.org/a']) {
    assert.equal(parseAudioLink(invalid), undefined);
  }
});
