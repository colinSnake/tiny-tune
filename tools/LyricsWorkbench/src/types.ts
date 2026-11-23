export type Artist = { id: string; name: string; hint: string; area: string; aliases: string[] };
export type Track = { id: string; title: string; artist: string; albums: string[]; duration: number | null; isrcs?: string[] };
export type TrackPage = { tracks: Track[]; next: number | null; total: number };
export type LyricCandidate = {
  id: number; title: string; artist: string; album: string; duration: number | null;
  instrumental: boolean; synced: string; plain: string;
};
export type FoundResult = { status: 'timed' | 'plain' | 'instrumental'; candidate: LyricCandidate };
export type LyricResult = FoundResult | { status: 'review'; candidates: LyricCandidate[] } | { status: 'missing' };
export type ItemState = LyricResult | { status: 'pending' | 'running' } | { status: 'error'; message: string };
export type CollectionItem = { track: Track; result: ItemState };
