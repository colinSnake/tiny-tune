import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { portableFilenameStem } from './export';
import { parseLrc } from './lrc';
import { defaultLyricScript, formatLyricText, type LyricScript } from './lyric-script';
import { songStem, SongArchivePaths } from './song-archive';
import { mp3Payload } from './song-metadata';
import { SongError } from './songs';
import type { SongDetail } from './song-types';

const fileKey = (name: string) => name.normalize('NFC').toLowerCase();
const isExists = (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST';
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const audioExtensions = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac']);
const maxAudioBytes = 32 * 1024 * 1024;
const artistFolder = (artist: string) => {
  const name = portableFilenameStem(artist) || '未知歌手';
  return ['未归档歌曲', 'manifest.json'].includes(fileKey(name)) ? `${name} [歌手]` : name;
};
export type SongLocalSaveResult = {
  status: 'saved' | 'lyrics-added' | 'lyrics-saved' | 'exists' | 'conflict';
  audio?: string;
  lyrics?: string;
  lyricsIssue?: 'missing' | 'unsynced' | 'unavailable' | 'review';
  lyricsKind?: 'plain';
  coverIssue?: 'missing' | 'unavailable';
};

async function openDirectory(base: string, folders: string[], create: boolean) {
  let directory = base;
  for (const folder of folders) {
    directory = join(directory, folder);
    if (create) await mkdir(directory).catch(error => { if (!isExists(error)) throw error; });
    const stat = await lstat(directory).catch(error => { if (!create && isMissing(error)) return undefined; throw error; });
    if (!stat) return undefined;
    if (!stat.isDirectory() || await realpath(directory) !== directory) throw new SongError('保存目录已变更或包含符号链接。', 409);
  }
  const initial = await lstat(directory);
  return {
    directory,
    async verify() {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.dev !== initial.dev || stat.ino !== initial.ino || await realpath(directory) !== directory) {
        throw new SongError('保存目录已变更。', 409);
      }
    },
  };
}

type Directory = NonNullable<Awaited<ReturnType<typeof openDirectory>>>;
async function publish(dir: Directory, files: { name: string; data: string | Buffer }[], beforeLink?: () => Promise<void>) {
  const staged: { target: string; temp: string }[] = [], published: typeof staged = [];
  try {
    for (const { name, data } of files) {
      await dir.verify();
      const temp = join(dir.directory, `.tinytune-${randomUUID()}.tmp`);
      const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      staged.push({ temp, target: join(dir.directory, name) });
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    }
    for (const file of staged) {
      await beforeLink?.();
      await dir.verify();
      await link(file.temp, file.target);
      published.push(file);
    }
    return true;
  } catch (error) {
    // Remove only this transaction's hardlinks, never a pre-existing path.
    for (const { target, temp } of published) {
      const [a, b] = await Promise.all([lstat(target).catch(() => null), lstat(temp).catch(() => null)]);
      if (a && b && a.dev === b.dev && a.ino === b.ino) await unlink(target).catch(() => undefined);
    }
    if (isExists(error)) return false;
    throw error;
  } finally {
    for (const { temp } of staged) await unlink(temp).catch(() => undefined);
  }
}

async function inspectSong(dir: Directory, folders: string[], stem: string, sidecar: string | undefined, loadAudio: () => Promise<Buffer>): Promise<SongLocalSaveResult | undefined> {
  const stemKey = fileKey(stem);
  const siblings = (await readdir(dir.directory, { withFileTypes: true })).filter(entry => {
    const ext = extname(entry.name);
    return !!ext && fileKey(entry.name.slice(0, -ext.length)) === stemKey;
  });
  const recordings = siblings.filter(entry => audioExtensions.has(extname(entry.name).toLowerCase()));
  const sidecars = siblings.filter(entry => extname(entry.name).toLowerCase() === '.lrc');
  if (!recordings.length && !sidecars.length) return;
  const [recording] = recordings;
  if (recordings.length !== 1 || !recording.isFile() || extname(recording.name).toLowerCase() !== '.mp3' ||
      sidecars.length > 1 || sidecars.some(entry => !entry.isFile())) return { status: 'conflict' };
  const relativeAudio = [...folders, recording.name].join('/');
  if (sidecars.length) return { status: 'exists', audio: relativeAudio, lyrics: [...folders, sidecars[0].name].join('/') };
  if (!sidecar) return { status: 'exists', audio: relativeAudio };

  // Use the open file's identity to prevent attaching words to a replacement during the check.
  const path = join(dir.directory, recording.name);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const original = await handle.stat({ bigint: true });
    const same = (stat: typeof original) => stat.isFile() && stat.dev === original.dev && stat.ino === original.ino &&
      stat.size === original.size && stat.mtimeNs === original.mtimeNs && stat.ctimeNs === original.ctimeNs;
    if (!original.isFile()) return { status: 'conflict' };
    // Only byte-identical audio can receive a provider's paired timeline.
    const audio = await loadAudio();
    if (original.size > BigInt(maxAudioBytes + 3 * 1024 * 1024)) return { status: 'conflict' };
    const bytes = Buffer.alloc(Number(original.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) return { status: 'conflict' };
      offset += bytesRead;
    }
    if (!mp3Payload(bytes).equals(mp3Payload(audio))) return { status: 'conflict' };
    const name = `${recording.name.slice(0, -4)}.lrc`;
    const written = await publish(dir, [{ name, data: sidecar }], async () => {
      if (!same(await lstat(path, { bigint: true }))) throw new SongError('音频已变化，未补写歌词。', 409);
    });
    return { status: written ? 'lyrics-added' : 'conflict', audio: relativeAudio, ...(written ? { lyrics: [...folders, name].join('/') } : {}) };
  } finally { await handle.close(); }
}

export async function saveSongLocally(root: string, track: SongDetail, source: Buffer | (() => Promise<Buffer>), legacyVideoTitle?: string,
  lyricScript: LyricScript = defaultLyricScript, existingAudio?: string): Promise<SongLocalSaveResult> {
  if (track.provider === 'bilibili-video' && (!track.artist.trim() || !track.title.trim())) throw new SongError('未能可靠识别这条投稿的歌手和歌名，请选择署名清楚的单曲或分集，未创建未知歌手目录。', 409);
  const invalid = () => new SongError('此录音未通过下载验证。', 409);
  const validated = (audio: Buffer) => { if (!audio.length || audio.length > maxAudioBytes) throw invalid(); return audio; };
  if (track.availability !== 'ready' && track.availability !== 'audio-only' || track.availability === 'ready' && !track.lyrics?.text.trim()) throw invalid();
  if (Buffer.isBuffer(source)) validated(source);
  const lastCue = track.lyrics?.kind === 'timed' && parseLrc(track.lyrics.text).cues.at(-1);
  const plain = track.lyrics?.kind === 'plain' && track.lyrics.text.trim() && Buffer.byteLength(track.lyrics.text) <= 256 * 1024;
  const sidecar = plain ? formatLyricText(track.lyrics!.text, lyricScript) : track.availability === 'ready' && lastCue && track.duration > 0 && lastCue.ms <= track.duration * 1000
    ? formatLyricText(track.lyrics!.text, lyricScript) : undefined;
  const report = (result: SongLocalSaveResult): SongLocalSaveResult => result.lyrics && plain && (result.status === 'saved' || result.status === 'lyrics-added')
    ? { ...result, lyricsKind: 'plain' } : result.audio && !result.lyrics && track.lyrics
      ? { ...result, lyricsIssue: 'unsynced' } : result;
  let downloading: Promise<Buffer> | undefined;
  const loadAudio = () => downloading ??= (typeof source === 'function' ? source().then(validated) : Promise.resolve(source));
  const base = await realpath(resolve(root));
  if (existingAudio) {
    const parts = existingAudio.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || part.includes(String.fromCharCode(92))) || !existingAudio.toLowerCase().endsWith('.mp3')) return { status: 'conflict' };
    const name = parts.pop()!;
    const existing = await openDirectory(base, parts, false);
    if (!existing) return { status: 'conflict' };
    return report(await inspectSong(existing, parts, name.slice(0, -4), sidecar, loadAudio) ?? { status: 'conflict' });
  }
  const stem = songStem(track);
  const folders = [artistFolder(track.artist)];
  const album = portableFilenameStem(track.album);
  if (track.provider !== 'bilibili-video' && track.releaseId && album) folders.push(album);
  const legacyStem = legacyVideoTitle !== undefined ? songStem({ artist: '', title: legacyVideoTitle }) : stem;
  const old = new SongArchivePaths().add(track, legacyStem).audio.split('/');
  const oldStem = old.pop()!.slice(0, -4);
  const target = await openDirectory(base, folders, false);
  if (target) {
    const existing = await inspectSong(target, folders, stem, sidecar, loadAudio);
    if (existing) return report(existing);
  }
  if (old.join('/') !== folders.join('/') || oldStem !== stem) {
    const oldDirectory = await openDirectory(base, old, false);
    if (oldDirectory) {
      const existing = await inspectSong(oldDirectory, old, oldStem, sidecar, loadAudio);
      if (existing) return report(existing);
    }
  }
  const audio = await loadAudio();
  const directory = await openDirectory(base, folders, true);
  const files: { name: string; data: string | Buffer }[] = [{ name: `${stem}.mp3`, data: audio }];
  if (sidecar) files.push({ name: `${stem}.lrc`, data: sidecar });
  const written = await publish(directory!, files);
  if (!written) return report(await inspectSong(directory!, folders, stem, sidecar, loadAudio) ?? { status: 'conflict' });
  return report({ status: 'saved', audio: [...folders, `${stem}.mp3`].join('/'), ...(sidecar ? { lyrics: [...folders, `${stem}.lrc`].join('/') } : {}) });
}

export async function saveLyricsLocally(root: string, track: { title: string; artist: string }, text: string, version?: string,
  lyricScript: LyricScript = defaultLyricScript): Promise<SongLocalSaveResult> {
  if (!track.artist.trim() || !track.title.trim() || !text.trim() || Buffer.byteLength(text) > 256 * 1024) throw new SongError('没有可保存的歌词。', 409);
  const base = await realpath(resolve(root));
  const folders = [artistFolder(track.artist), '独立歌词'];
  const directory = (await openDirectory(base, folders, true))!;
  const stem = `${songStem(track)}${version ? ` [${portableFilenameStem(version)}]` : ''}`;
  const name = `${stem}.lrc`;
  const entries = await readdir(directory.directory, { withFileTypes: true });
  const siblings = entries.filter(entry => fileKey(entry.name) === fileKey(name));
  if (siblings.length > 1 || siblings.some(entry => !entry.isFile()) || entries.some(entry => {
    const ext = extname(entry.name);
    return audioExtensions.has(ext.toLowerCase()) && fileKey(entry.name.slice(0, -ext.length)) === fileKey(stem);
  })) return { status: 'conflict' };
  if (siblings.length) return { status: 'exists', lyrics: [...folders, siblings[0].name].join('/') };
  return await publish(directory, [{ name, data: formatLyricText(text, lyricScript) }]) ? { status: 'lyrics-saved', lyrics: [...folders, name].join('/') } : { status: 'conflict' };
}
