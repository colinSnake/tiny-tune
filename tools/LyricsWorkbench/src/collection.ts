import type { ItemState, Track } from './types';

export function mergeTracks(current: Track[], page: Track[]) {
  const combined = new Map(current.map(track => [track.id, track]));
  for (const track of page) if (!combined.has(track.id)) combined.set(track.id, track);
  return [...combined.values()];
}

export function restoreCanceled(current: Record<string, ItemState>, original: Record<string, ItemState>) {
  return Object.fromEntries(Object.entries(current).map(([id, result]) =>
    [id, result.status === 'running' ? original[id] ?? { status: 'pending' as const } : result]));
}
