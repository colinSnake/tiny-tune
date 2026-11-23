import { parseLrc } from './lrc';
import type { LyricCandidate, LyricResult, Track } from './types';

// Fold the width block only; whole-string NFKC also merges distinct titles such as ① and 1.
export const normalize = (value: string) => value.replace(/[\u3000\uFF00-\uFFEF]+/gu, width => width.normalize('NFKC'))
  .normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

export function candidateResult(candidate: LyricCandidate): LyricResult {
  if (candidate.instrumental) return { status: 'instrumental', candidate };
  if (parseLrc(candidate.synced).cues.length) return { status: 'timed', candidate };
  const plain = parseLrc(candidate.plain || candidate.synced).plain;
  if (plain) return { status: 'plain', candidate: { ...candidate, plain } };
  return { status: 'missing' };
}

export function matchLyrics(track: Track, candidates: LyricCandidate[]): LyricResult {
  const albums = new Set(track.albums.map(normalize).filter(Boolean));
  const eligible = candidates.map(candidate => ({ candidate, result: candidateResult(candidate) }))
    .filter(entry => entry.result.status !== 'missing');
  if (!eligible.length) return { status: 'missing' };
  const exact = eligible.filter(({ candidate: c }) =>
    normalize(c.title) === normalize(track.title) && normalize(c.artist) === normalize(track.artist) &&
    track.duration !== null && c.duration !== null && Math.abs(track.duration - c.duration) <= 2 &&
    (!albums.size || !c.album || albums.has(normalize(c.album))));
  const sameAlbum = exact.filter(({ candidate: c }) => albums.has(normalize(c.album)));
  const best = sameAlbum.length ? sameAlbum : exact;
  if (best.length) {
    const [first] = best;
    const signatures = new Set(best.map(({ result }) => {
      if (result.status === 'timed') return JSON.stringify([result.status, parseLrc(result.candidate.synced).cues]);
      if (result.status === 'plain') return JSON.stringify([result.status, result.candidate.plain]);
      return result.status;
    }));
    if (signatures.size === 1) return first.result;
  }
  return { status: 'review', candidates: eligible.map(({ candidate }) => candidate) };
}
