import type { Artist, LyricResult, Track } from './types';

export const demoArtist: Artist = { id: 'demo', name: 'Tinytune 样例', area: '本地样例', hint: '原创合成素材', aliases: [] };
export const demoTracks: Track[] = [
  { id: 'demo-window', title: '窗边的光', artist: demoArtist.name, albums: ['松笺练习曲'], duration: 19 },
  { id: 'demo-paper', title: '第二页', artist: demoArtist.name, albums: ['松笺练习曲'], duration: 19 },
];
const lines = [
  [1000, '把窗推开半寸'], [3000, '让晨光停在纸上'], [5200, '风轻轻翻过一页'],
  [7600, '树影沿着桌角走'], [10000, '不用赶往哪里'], [12400, '把这一刻听完'],
  [14800, '再把窗留给风'], [17200, '等下一次天亮'],
] as const;

export const demoResults: Record<string, LyricResult> = Object.fromEntries(demoTracks.map((track, i) => [track.id, {
  status: i === 0 ? 'timed' : 'plain',
  candidate: { id: -i - 1, title: track.title, artist: track.artist, album: track.albums[0], duration: track.duration,
    synced: i === 0 ? lines.map(([ms, line]) => `[00:${(ms / 1000).toFixed(3).padStart(6, '0')}]${line}`).join('\n') : '',
    plain: i === 1 ? '提笔时天色还浅\n白纸上没有方向\n留一点空位给风' : '', instrumental: false },
}]));

export function demoAudio(variant = 0): Blob {
  const rate = 16_000, samples = 19 * rate;
  const data = new ArrayBuffer(44 + samples * 2), view = new DataView(data);
  const label = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); label(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, samples * 2, true);
  for (const [i, [start]] of lines.entries()) {
    const base = Math.round(start * rate / 1000), note = [261.63, 329.63, 392, 349.23, 293.66, 440, 392, 261.63][(i + variant) % lines.length];
    for (let j = 0; j < rate * 1.6 && base + j < samples; j++) {
      const t = j / rate, phase = 2 * Math.PI * note * t;
      const gain = Math.min(1, t * 70) * Math.exp(-3.2 * t) * Math.min(1, (1.6 - t) * 16);
      view.setInt16(44 + (base + j) * 2, Math.round(4300 * gain * (Math.sin(phase) + 0.24 * Math.sin(phase * 2))), true);
    }
  }
  return new Blob([data], { type: 'audio/wav' });
}
