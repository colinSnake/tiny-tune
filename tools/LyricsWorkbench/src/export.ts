import type { CollectionItem, ItemState } from './types';
import { hasInvalidLyricCandidate, validatedLyricKind } from './lyric-quality';
import { prepareLyricPayload } from './lyric-payload';
import type { LocalTrack } from './local-library-types';
import { defaultLyricScript, type LyricScript } from './lyric-script';

const unsafe = /[\x00-\x1f\x7f<>:"/\\|?*]/;
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function portableFilenameStem(input: string): string {
  let stem = [...input.normalize('NFC').replace(new RegExp(unsafe.source, 'g'), ' ').replace(/\s+/g, ' ').trim()]
    .slice(0, 50).join('').replace(/^[. ]+|[. ]+$/g, '');
  if (reserved.test(stem)) stem = '_' + stem;
  return stem;
}

export function lrcFilename(name: string, fromAudio = false): string {
  const input = fromAudio ? name.replace(/\.[^.]+$/, '') : name;
  if (fromAudio && input && !unsafe.test(input) && !reserved.test(input) && !/[. ]$/.test(input)) return `${input}.lrc`;
  return `${portableFilenameStem(input) || 'lyrics'}.lrc`;
}

export function lyricText(result: ItemState): string | null {
  if (result.status !== 'timed' && result.status !== 'plain' || hasInvalidLyricCandidate(result.candidate)) return null;
  const text = result.status === 'timed' ? result.candidate.synced : result.candidate.plain;
  return validatedLyricKind(text) === result.status ? text : null;
}

function directoryPart(name: string) {
  return name && !unsafe.test(name) && !reserved.test(name) && !/[. ]$/.test(name) ? name : portableFilenameStem(name) || '未归档';
}

export function exportEntries(items: CollectionItem[], localFiles?: ReadonlyMap<string, LocalTrack>, lyricScript: LyricScript = defaultLyricScript) {
  const used = new Set<string>();
  const files: { name: string; text: string }[] = [];
  const tracks = items.map(({ track, result }) => {
    const text = lyricText(result);
    const expectedKind = result.status === 'timed' || result.status === 'plain' ? result.status : undefined;
    const local = localFiles?.get(track.id);
    const payload = text === null || !expectedKind ? undefined : prepareLyricPayload(text, local?.duration ?? track.duration, lyricScript, expectedKind);
    let file = null;
    if (payload) {
      const parts = local?.file.split('/') ?? [];
      const name = parts.pop();
      const folders = local ? parts : localFiles ? [track.artist || '未知歌手', track.albums[0] || '未归档'] : [];
      const base = [...folders.map(directoryPart), lrcFilename(name ?? track.title, !!name)].join('/');
      file = base;
      const stem = base.slice(0, -4);
      const id = track.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'track';
      let n = 0;
      while (used.has(file.normalize('NFC').toLowerCase())) file = `${stem} [${id}${n++ ? '-' + n : ''}].lrc`;
      used.add(file.normalize('NFC').toLowerCase());
      files.push({ name: file, text: payload.text });
    }
    return {
      id: track.id, title: track.title, artist: track.artist, albums: track.albums, duration: track.duration,
      status: expectedKind && !payload ? 'review' : result.status, file,
      ...(payload?.residualGlyphs ? { residualGlyphs: payload.residualGlyphs } : {}),
      lyricSource: 'candidate' in result ? { provider: result.candidate.id < 0 ? 'demo' : 'LRCLIB', id: result.candidate.id } : null,
      error: result.status === 'error' ? result.message : expectedKind && !payload ? '歌词质量或时码未通过录音校验' : null,
    };
  });
  return { files, manifest: { version: 1, catalog: items.length && items.every(({ track }) => track.id.startsWith('demo-')) ? 'demo' : localFiles && items.some(item => localFiles.has(item.track.id)) ? 'local + MusicBrainz' : 'MusicBrainz', tracks } };
}

export async function createArchive(data: ReturnType<typeof exportEntries>): Promise<ArrayBuffer> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const file of data.files) zip.file(file.name, file.text);
  zip.file('manifest.json', JSON.stringify(data.manifest, null, 2) + '\n');
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
