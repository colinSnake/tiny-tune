import { constants, type BigIntStats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { hasLrcTiming, parseLrc } from './lrc';
import { lyricQualityIssue } from './lyric-quality';

export const maxLyricsBytes = 256 * 1024;
export const fileSignature = (stats: BigIntStats) => [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':');

export async function readSidecar(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maxLyricsBytes)) return;
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== Number(before.size) || fileSignature(await lstat(path, { bigint: true })) !== fileSignature(before)) return;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    const parsed = parseLrc(text);
    const kind = lyricQualityIssue(text) ? 'protected' as const : parsed.cues.length ? 'timed' as const : parsed.plain && !hasLrcTiming(text) ? 'plain' as const : 'protected' as const;
    return { text, parsed, kind, identity: fileSignature(before) };
  } finally { await file.close(); }
}
