import type { CollectionItem, ItemState } from './types';

const unsafe = /[\x00-\x1f\x7f<>:"/\\|?*]/;
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function lrcFilename(name: string, fromAudio = false): string {
  const input = fromAudio ? name.replace(/\.[^.]+$/, '') : name;
  if (fromAudio && input && !unsafe.test(input) && !reserved.test(input) && !/[. ]$/.test(input)) return `${input}.lrc`;
  let stem = [...input.normalize('NFC').replace(new RegExp(unsafe.source, 'g'), ' ').replace(/\s+/g, ' ').trim()]
    .slice(0, 50).join('').replace(/^[. ]+|[. ]+$/g, '');
  if (reserved.test(stem)) stem = '_' + stem;
  return `${stem || 'lyrics'}.lrc`;
}

export function lyricText(result: ItemState): string | null {
  return result.status === 'timed' ? result.candidate.synced : result.status === 'plain' ? result.candidate.plain : null;
}

export function exportEntries(items: CollectionItem[]) {
  const used = new Set<string>();
  const files: { name: string; text: string }[] = [];
  const tracks = items.map(({ track, result }) => {
    const text = lyricText(result);
    let file = null;
    if (text !== null) {
      const base = lrcFilename(track.title);
      file = base;
      const stem = base.slice(0, -4);
      const id = track.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'track';
      let n = 0;
      while (used.has(file.toLowerCase())) file = `${stem} [${id}${n++ ? '-' + n : ''}].lrc`;
      used.add(file.toLowerCase());
      files.push({ name: file, text });
    }
    return {
      id: track.id, title: track.title, artist: track.artist, albums: track.albums, duration: track.duration,
      status: result.status, file,
      lyricSource: 'candidate' in result ? { provider: result.candidate.id < 0 ? 'demo' : 'LRCLIB', id: result.candidate.id } : null,
      error: result.status === 'error' ? result.message : null,
    };
  });
  return { files, manifest: { version: 1, catalog: items.length && items.every(({ track }) => track.id.startsWith('demo-')) ? 'demo' : 'MusicBrainz', tracks } };
}

export async function createArchive(data: ReturnType<typeof exportEntries>): Promise<ArrayBuffer> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const file of data.files) zip.file(file.name, file.text);
  zip.file('manifest.json', JSON.stringify(data.manifest, null, 2) + '\n');
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
