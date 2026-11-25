import assert from 'node:assert/strict';
import test from 'node:test';
import { videoPostLyricIdentity, videoSongIdentity } from '../src/video-lyrics';

test('an explicitly named Wu Bai collection retains the artist instead of promotional text', () => {
  for (const collection of [
    '【伍佰合集】100首伍佰2025年播放量最高的单曲分P合集（带歌词）',
    '【伍佰合集】100首伍佰2023年播放量最高歌曲合集，迷一样的男人',
  ]) assert.deepEqual(videoSongIdentity('1. 挪威的森林', collection), { title: '挪威的森林', artist: '伍佰' });
});

test('numbered parts are cleaned but mixed-artist collections do not invent a single performer', () => {
  assert.deepEqual(videoSongIdentity('0001. 突然的自我', '【伍佰等人的歌曲合集】带滚动歌词（分P版）'), { title: '突然的自我', artist: '' });
  assert.deepEqual(videoSongIdentity('1. 歌曲', '【伍佰、任贤齐合集】'), { title: '歌曲', artist: '' });
});

test('video lyric lookup reads clear credits without changing the source title', () => {
  for (const title of [
    '《告白气球》周杰伦丨百万级录音棚试听丨【Hi-Res无损】',
    '【4K60帧】《告白气球》——周杰伦',
    '《告白气球》 - 周杰伦',
    '周杰伦《告白气球》',
    '【4K Hi-Res】告白气球-周杰倫',
    '《测试歌曲》 - 演唱：测试歌手',
  ]) {
    const identity = title.includes('测试歌曲') ? { title: '测试歌曲', artist: '测试歌手' } : { title: '告白气球', artist: '周杰伦' };
    assert.deepEqual(videoPostLyricIdentity(title), identity);
  }
});

test('a title without an explicit, unambiguous performer is not used for video lyric lookup', () => {
  for (const title of [
    '《告白气球》百万级录音棚试听',
    '《告白气球》周杰伦丨某某翻唱',
    '《告白气球》周杰伦、另一歌手',
    '《告白气球》周杰伦丨另一歌手演唱',
    '《告白气球》— 原唱：周杰伦',
    '《告白气球》周杰伦 — 伴奏',
    '《告白气球》周杰伦 cover',
  ]) assert.equal(videoPostLyricIdentity(title), undefined, title);
});


test('a lookup hint cannot override a conflicting collection performer or rename a credited recording', () => {
  const raw = '《告白气球》 - 周杰倫';
  assert.deepEqual(videoSongIdentity(raw), { title: '《告白气球》', artist: '周杰伦' });
  assert.deepEqual(videoPostLyricIdentity(raw, '周杰倫'), { title: '告白气球', artist: '周杰伦' });
  assert.equal(videoPostLyricIdentity(raw, '另一位歌手'), undefined);
});
