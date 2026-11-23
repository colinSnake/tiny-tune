import { normalize } from './match';
import type { Track } from './types';

export type AudioMetadata = {
  id: string; name: string; title: string; artist: string; album: string; duration: number | null; isrcs: string[];
};
export type AudioCoverage = 'full' | 'clip';
export type AudioBinding = { kind: 'local'; audioId: string; automatic?: true }
  | { kind: 'link'; url: string; coverage: AudioCoverage } | { kind: 'none' };

export function parseIsrc(value: string) {
  const code = value.trim().toUpperCase().replace(/-/g, '');
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code) ? code : '';
}
const codes = (values: string[] = []) => values.map(parseIsrc).filter(Boolean);
const same = (a: string, b: string) => !!a && !!b && normalize(a) === normalize(b);
const durationMatches = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= 2;
const stem = (name: string) => name.replace(/\.[^.]+$/, '').replace(/^\d{1,3}[\s_.-]+/, '');
const albumMatches = (track: Track, file: AudioMetadata) => track.albums.some(album => same(album, file.album));

export function matchAudio<T extends AudioMetadata>(track: Track, files: readonly T[], recordings: readonly Track[]) {
  const trackCodes = codes(track.isrcs);
  const ranked = files.flatMap(file => {
    const fileCodes = codes(file.isrcs);
    const isrc = fileCodes.some(code => trackCodes.includes(code));
    const tagTitle = same(track.title, file.title);
    const filenameTitle = same(track.title, stem(file.name));
    if (!isrc && !tagTitle && !filenameTitle) return [];
    const duration = durationMatches(track.duration, file.duration);
    const artist = same(track.artist, file.artist);
    const album = albumMatches(track, file);
    const conflict = (trackCodes.length > 0 && fileCodes.length > 0 && !isrc) ||
      (file.artist !== '' && !artist) || (file.title !== '' && !tagTitle) ||
      (file.album !== '' && track.albums.length > 0 && !album);
    const ambiguousRecording = recordings.some(other => {
      if (other.id === track.id || !same(other.title, track.title)) return false;
      const otherCodes = codes(other.isrcs);
      if (otherCodes.length && fileCodes.length && !otherCodes.some(code => fileCodes.includes(code))) return false;
      return (other.duration === null || durationMatches(other.duration, file.duration)) &&
        (!other.albums.length || !file.album || albumMatches(other, file));
    });
    const level = !conflict && duration ? (isrc ? 2 : tagTitle && artist && album && !ambiguousRecording ? 1 : 0) : 0;
    return [{ file, level, score: Number(artist) + Number(album) + Number(duration) }];
  }).sort((a, b) => b.level - a.level || b.score - a.score);
  const first = ranked[0];
  const automatic = first && first.level > 0 && (first.level === 2 ? ranked[1]?.level !== 2 : ranked.length === 1)
    ? first.file : undefined;
  return { automatic, candidates: ranked.map(entry => entry.file) };
}

// Reassess automatic bindings when another file or recording page adds conflicting evidence.
export function resolveLocalAudio<T extends AudioMetadata>(binding: AudioBinding | undefined, files: readonly T[], automatic?: T) {
  if (!binding) return automatic;
  if (binding.kind !== 'local') return;
  return binding.automatic ? (automatic?.id === binding.audioId ? automatic : undefined) : files.find(file => file.id === binding.audioId);
}

export function parseAudioLink(value: string): string | undefined {
  try {
    const text = value.trim();
    if (text.length > 4096 || !/^https?:\/\//i.test(text)) return;
    const url = new URL(text);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) return;
    // Media fragments could shift playback away from the recording timeline.
    url.hash = '';
    return url.href;
  } catch { return undefined; }
}

export function fullTrackSync(actual: number | null, expected: number | null, lastCue: number, coverage: AudioCoverage, recordingDuration: number | null = null) {
  return coverage === 'full' && actual !== null && Number.isFinite(actual) && actual > 0 &&
    durationMatches(actual, expected) && (recordingDuration === null || durationMatches(actual, recordingDuration)) && lastCue <= actual;
}
