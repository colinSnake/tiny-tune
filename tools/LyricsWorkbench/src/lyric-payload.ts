import { validatedLyricKind } from './lyric-quality';
import { defaultLyricScript, formatLyricText, residualLyricGlyphs, type LyricScript } from './lyric-script';

export function prepareLyricPayload(source: string, duration?: number | null, script: LyricScript = defaultLyricScript,
  expectedKind?: 'timed' | 'plain', tolerance = 0) {
  const kind = validatedLyricKind(source, duration, tolerance);
  if (!kind || expectedKind && expectedKind !== kind) return;
  const text = formatLyricText(source, script);
  if (text !== source && validatedLyricKind(text, duration, tolerance) !== kind) return;
  const residualGlyphs = script === 'simplified' ? residualLyricGlyphs(text) : [];
  return { text, kind, ...(residualGlyphs.length ? { residualGlyphs } : {}) };
}
