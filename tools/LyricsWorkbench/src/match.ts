import { parseLrc } from './lrc';
import { hasInvalidLyricCandidate, lyricQualityIssue } from './lyric-quality';
import type { LyricCandidate, LyricResult, Track } from './types';

// Fold the width block only; whole-string NFKC also merges distinct titles such as ① and 1.
export const normalize = (value: string) => value.replace(/[\u3000\uFF00-\uFFEF]+/gu, width => width.normalize('NFKC'))
  .normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

export function candidateResult(candidate: LyricCandidate): LyricResult {
  if (hasInvalidLyricCandidate(candidate)) return { status: 'missing' };
  if (candidate.instrumental) return { status: 'instrumental', candidate };
  if (parseLrc(candidate.synced).cues.length) return { status: 'timed', candidate };
  // Keep the supplier bytes for export; parse only to decide whether there is a body.
  const plain = candidate.plain || candidate.synced;
  if (parseLrc(plain).plain) return { status: 'plain', candidate: { ...candidate, plain } };
  return { status: 'missing' };
}

export function plainCandidate(candidate: LyricCandidate): LyricCandidate {
  if (hasInvalidLyricCandidate(candidate)) return { ...candidate, synced: '', plain: '' };
  const source = candidate.plain || candidate.synced;
  const parsed = parseLrc(source);
  const plain = parsed.cues.length ? parsed.cues.flatMap(cue => cue.lines).join('\n') : parsed.plain ? source : '';
  return { ...candidate, synced: '', plain };
}

export function matchLyrics(track: Track, candidates: LyricCandidate[]): LyricResult {
  const albums = new Set(track.albums.map(normalize).filter(Boolean));
  const eligible = candidates.map(candidate => ({ candidate, result: candidateResult(candidate) }))
    .filter(entry => entry.result.status !== 'missing');
  if (!eligible.length) return { status: 'missing' };
  const exact = eligible.filter(({ candidate: c, result }) =>
    normalize(c.title) === normalize(track.title) && normalize(c.artist) === normalize(track.artist) &&
    track.duration !== null && c.duration !== null && Math.abs(track.duration - c.duration) <= 2 &&
    (!albums.size || !c.album || albums.has(normalize(c.album))) &&
    (result.status !== 'timed' || !lyricQualityIssue(c.synced, track.duration, 0)));
  const sameAlbum = exact.filter(({ candidate: c }) => albums.has(normalize(c.album)));
  const best = sameAlbum.length ? sameAlbum : exact;
  if (best.length) {
    const [first] = best;
    const signatures = new Set(best.map(({ result }) => {
      if (result.status === 'timed') return JSON.stringify([result.status, parseLrc(result.candidate.synced).cues]);
      if (result.status === 'plain') return JSON.stringify([result.status, parseLrc(result.candidate.plain).plain]);
      return result.status;
    }));
    if (signatures.size === 1) return first.result;
  }
  return { status: 'review', candidates: eligible.map(({ candidate }) => candidate) };
}
