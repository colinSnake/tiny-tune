import type { LyricCandidate, Track } from './types';
import { parseLrc } from './lrc';
import { matchesVideoLyricIdentity } from './video-lyrics';
import { candidateResult, normalize } from './match';

export type LocalTrack = Track & { file: string; hasLyrics: boolean; lyricsKind?: 'plain' | 'timed' | 'protected'; confirmTiming?: boolean };
export type LocalLibrarySearch = { enabled: boolean; root?: string; tracks: LocalTrack[]; limited?: boolean };
export type LocalLyricChoice = { id: string; candidateId: number; confirmed: boolean; mode?: 'original' | 'plain'; upgradePlain?: boolean };
export type LocalSaveStatus = 'saved' | 'exists' | 'changed' | 'review' | 'ambiguous' | 'unsynced' | 'different-lyrics' | 'error';
export type LocalSaveResult = { id: string; status: LocalSaveStatus; file?: string };
export const localBatchLimit = 50;
export const localTrackId = /^local-[a-f0-9]{40}$/;

// A conflicting/unknown duration cannot be repaired by checking a box. Do not write or
// enable synchronized preview if the timeline extends beyond the actual file either.
export function fitsLocalRecording(track: Track, candidate: LyricCandidate) {
  if (track.duration === null || candidate.duration === null || Math.abs(track.duration - candidate.duration) > 2) return false;
  const result = candidateResult(candidate);
  if (result.status === 'timed') return (parseLrc(candidate.synced).cues.at(-1)?.ms ?? 0) / 1000 <= track.duration;
  return result.status === 'plain';
}

export function fitsTimedLyrics(track: Track, candidate: LyricCandidate) {
  return candidateResult(candidate).status === 'timed' && fitsLocalRecording(track, candidate);
}

export function matchesLocalLyricIdentity(track: Track, candidate: LyricCandidate) {
  return (track as Partial<LocalTrack>).confirmTiming ? matchesVideoLyricIdentity(track, candidate)
    : normalize(candidate.title) === normalize(track.title) && normalize(candidate.artist) === normalize(track.artist);
}
