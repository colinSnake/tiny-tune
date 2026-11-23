import { normalize } from './match';
import type { Artist, ItemState, Track } from './types';

export function exactArtist(query: string, candidates: Artist[]) {
  const [only] = candidates;
  if (candidates.length === 1 && [only.name, ...only.aliases].some(name => normalize(name) === normalize(query))) return only;
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
