import { portableFilenameStem } from './export';
import type { SongSummary } from './song-types';

const unfiledDirectory = '未归档歌曲';
const pathKey = (value: string) => value.normalize('NFKC').toLowerCase();
const safePart = (value: string) => value.length > 0 && !/^[. ]|[. ]$|[\x00-\x1f\x7f<>:"/\\|?*]/.test(value) &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);

type ReleaseFields = Pick<SongSummary, 'provider' | 'releaseId' | 'album' | 'artist'>;
export const songTitleStem = (title: string) => portableFilenameStem(title) || '未命名歌曲';
export const songStem = (track: Pick<SongSummary, 'artist' | 'title'>) =>
  portableFilenameStem([track.artist, track.title].filter(Boolean).join(' - ')) || '未命名歌曲';

/** One instance per archive: resolve portable path collisions without moving a release's other tracks. */
export class SongArchivePaths {
  private readonly artistFolders = new Map<string, string>();
  private readonly releases = new Map<string, string>();
  private readonly usedDirectories = new Set<string>();
  private readonly usedSongs = new Set<string>();

  add(track: ReleaseFields, name: string) {
    let directory = unfiledDirectory;
    const album = portableFilenameStem(track.album);
    if (track.provider !== 'bilibili-video' && track.releaseId && album) {
      const key = JSON.stringify([track.provider, track.releaseId]);
      const previous = this.releases.get(key);
      if (previous) directory = previous;
      else {
        let artist = portableFilenameStem(track.artist) || '未知歌手';
        if ([pathKey(unfiledDirectory), 'manifest.json'].includes(pathKey(artist))) artist = `${artist} [歌手]`;
        const artistKey = pathKey(artist);
        artist = this.artistFolders.get(artistKey) ?? artist;
        this.artistFolders.set(artistKey, artist);
        directory = this.reserve(this.usedDirectories, `${artist}/${album}`);
        this.releases.set(key, directory);
      }
    }
    const basename = this.reserve(this.usedSongs, `${directory}/${portableFilenameStem(name) || '未命名歌曲'}`);
    return { audio: `${basename}.mp3`, lyrics: `${basename}.lrc` };
  }

  private reserve(used: Set<string>, base: string) {
    let path = base, n = 2;
    while (used.has(pathKey(path))) path = `${base} [${n++}]`;
    used.add(pathKey(path));
    return path;
  }
}

export function songBundleStem(audio: unknown, lyrics: unknown, version: number): string | undefined {
  if (typeof audio !== 'string' || !audio.endsWith('.mp3') || lyrics !== `${audio.slice(0, -4)}.lrc`) return;
  const parts = audio.split('/');
  if ((version === 1 ? parts.length !== 1 : parts.length !== 2 && parts.length !== 3) || !parts.every(safePart)) return;
  const stem = parts[parts.length - 1].slice(0, -4);
  if (safePart(stem)) return stem;
}
