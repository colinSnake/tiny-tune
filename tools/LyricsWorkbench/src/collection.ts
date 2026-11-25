import { normalize } from './match';
import type { Artist, CollectionItem, ItemState, Track } from './types';
import { fitsLocalRecording, type LocalLyricChoice, type LocalTrack } from './local-library-types';

export function exactArtist(query: string, candidates: Artist[]) {
  const name = normalize(query);
  const exact = candidates.filter(artist => [artist.name, ...artist.aliases].some(alias => normalize(alias) === name));
  if (exact.length === 1) return exact[0];
}

export function mergeTracks(current: Track[], page: Track[]) {
  const combined = new Map(current.map(track => [track.id, track]));
  for (const track of page) if (!combined.has(track.id)) combined.set(track.id, track);
  return [...combined.values()];
}

export function restoreCanceled(current: Record<string, ItemState>, original: Record<string, ItemState>) {
  return Object.fromEntries(Object.entries(current).map(([id, result]) =>
    [id, result.status === 'running' ? original[id] ?? { status: 'pending' as const } : result]));
}

export function lyricQueryTargets(items: CollectionItem[], visible: CollectionItem[], selected: CollectionItem[]) {
  const pool = selected.length ? selected : visible;
  const pending = new Set(items.filter(item => item.result.status === 'pending').map(item => item.track.id));
  return pool.filter(item => pending.has(item.track.id)).map(item => item.track);
}

export type LocalSaveSkip = { track: Track; reason: 'not-local' | 'review' | 'exists' };
export function localSavePlan(items: CollectionItem[], local: ReadonlyMap<string, LocalTrack>, confirmed: ReadonlySet<string>) {
  const ready: { track: LocalTrack; choice: LocalLyricChoice }[] = [];
  const skipped: LocalSaveSkip[] = [];
  for (const { track, result } of items) {
    const file = local.get(track.id);
    if (!file) skipped.push({ track, reason: 'not-local' });
    else if (file.hasLyrics) skipped.push({ track, reason: 'exists' });
    else if ((result.status !== 'timed' && result.status !== 'plain') || !fitsLocalRecording(file, result.candidate)) skipped.push({ track, reason: 'review' });
    else ready.push({ track: file, choice: { id: track.id, candidateId: result.candidate.id, confirmed: confirmed.has(track.id) } });
  }
  return { ready, skipped };
}
