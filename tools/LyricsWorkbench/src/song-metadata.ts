import type { SongSummary } from './song-types';

export type SongCover = { mime: 'image/jpeg' | 'image/png'; data: Buffer };

/** Compare encoded audio, not editable ID3 tags, when safely adding a missing sidecar. */
export function mp3Payload(audio: Buffer) {
  let start = 0, end = audio.length;
  while (audio.toString('ascii', start, start + 3) === 'ID3' && start + 10 <= end) {
    const header = audio.subarray(start, start + 10);
    if (header[3] < 2 || header[3] > 4 || header.subarray(6, 10).some(n => n > 127)) return audio;
    const size = 10 + (header[6] << 21 | header[7] << 14 | header[8] << 7 | header[9]) + (header[3] === 4 && (header[5] & 16) ? 10 : 0);
    if (start + size > end) return audio;
    start += size;
  }
  if (end - start >= 128 && audio.toString('ascii', end - 128, end - 125) === 'TAG') end -= 128;
  return audio.subarray(start, end);
}

/** ID3v2.3 uses UTF-16 text and big-endian frame lengths; audio is never re-encoded. */
export function tagSongMp3(audio: Buffer, song: Pick<SongSummary, 'title' | 'artist'> & Partial<Pick<SongSummary, 'provider' | 'id'>>, cover?: SongCover) {
  const frame = (id: string, body: Buffer) => {
    const header = Buffer.alloc(10); header.write(id, 0, 'ascii'); header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  };
  const text = (value: string) => Buffer.concat([Buffer.from([1, 255, 254]), Buffer.from(value.slice(0, 240), 'utf16le')]);
  const frames = [frame('TIT2', text(song.title)), frame('TPE1', text(song.artist))];
  if (song.provider && song.id) frames.push(frame('TXXX', text(`TINYTUNE_SOURCE${String.fromCharCode(0)}${song.provider}:${song.id}`)));
  if (cover) frames.push(frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from(cover.mime, 'ascii'), Buffer.from([0, 3, 0]), cover.data])));
  const body = Buffer.concat(frames), header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 4; i++) header[9 - i] = body.length >>> (7 * i) & 127;
  return Buffer.concat([header, body, mp3Payload(audio)]);
}

/** The image is the source video's cover, not an invented official album cover. */
export function bilibiliCoverUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !/^i[0-9]+[.]hdslb[.]com$/.test(url.hostname) ||
      !url.pathname.startsWith('/bfs/') || url.username || url.password || url.port || url.hash) return;
    url.protocol = 'https:'; return url.href;
  } catch { return; }
}
