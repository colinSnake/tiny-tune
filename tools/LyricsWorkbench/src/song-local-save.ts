import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { portableFilenameStem } from './export';
import { hasLrcTiming, parseLrc } from './lrc';
import { lyricQualityIssue } from './lyric-quality';
import { maxLyricsBytes, readSidecar } from './lrc-sidecar';
import { defaultLyricScript, formatLyricText, type LyricScript } from './lyric-script';
import { songStem, songTitleStem, SongArchivePaths } from './song-archive';
import { mp3Payload } from './song-metadata';
import type { VideoSaveTargets } from './local-library-types';
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

async function inspectSong(dir: Directory, folders: string[], stem: string, sidecar: string | undefined, loadAudio: () => Promise<Buffer>,
  verifyAudio = false): Promise<SongLocalSaveResult | 'different' | undefined> {
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
  const existing: SongLocalSaveResult = { status: 'exists', audio: relativeAudio };
  if (sidecars.length) {
    const name = sidecars[0].name;
    const previous = await readSidecar(join(dir.directory, name)).catch(() => undefined);
    existing.lyrics = [...folders, name].join('/');
    if (previous?.kind === 'plain') existing.lyricsKind = 'plain';
  }
  if (!verifyAudio && (sidecars.length || !sidecar)) return existing;

  // Use the open file's identity to prevent attaching words to a replacement during the check.
  const path = join(dir.directory, recording.name);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const original = await handle.stat({ bigint: true });
    const same = (stat: typeof original) => stat.isFile() && stat.dev === original.dev && stat.ino === original.ino &&
      stat.size === original.size && stat.mtimeNs === original.mtimeNs && stat.ctimeNs === original.ctimeNs;
    if (!original.isFile()) return { status: 'conflict' };
    if (original.size > BigInt(maxAudioBytes + 3 * 1024 * 1024)) return { status: 'conflict' };
    const audio = mp3Payload(await loadAudio());
    const bytes = Buffer.alloc(Number(original.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) return { status: 'conflict' };
      offset += bytesRead;
    }
    // Match encoded audio only; equal metadata or duration does not identify a recording.
    if (!same(await lstat(path, { bigint: true }))) return { status: 'conflict' };
    if (!audio.length || !mp3Payload(bytes).equals(audio)) return 'different';
    if (sidecars.length || !sidecar) return existing;
    const name = `${recording.name.slice(0, -4)}.lrc`;
    const written = await publish(dir, [{ name, data: sidecar }], async () => {
      if (!same(await lstat(path, { bigint: true }))) throw new SongError('音频已变化，未补写歌词。', 409);
    });
    return { status: written ? 'lyrics-added' : 'conflict', audio: relativeAudio, ...(written ? { lyrics: [...folders, name].join('/') } : {}) };
  } finally { await handle.close(); }
}

export async function saveSongLocally(root: string, track: SongDetail, source: Buffer | (() => Promise<Buffer>), legacyVideoTitle?: string,
  lyricScript: LyricScript = defaultLyricScript, videoTargets?: VideoSaveTargets, saveDirectoryArtist?: string): Promise<SongLocalSaveResult> {
  const directoryArtist = track.provider === 'bilibili-video' && !track.artist.trim() ? saveDirectoryArtist?.trim() ?? '' : track.artist.trim();
  if (track.provider === 'bilibili-video' && (!directoryArtist || !track.title.trim())) throw new SongError('未能可靠识别这条投稿的歌手和歌名，请选择署名清楚的单曲或分集，未创建未知歌手目录。', 409);
  const invalid = () => new SongError('此录音未通过下载验证。', 409);
  const validated = (audio: Buffer) => { if (!audio.length || audio.length > maxAudioBytes) throw invalid(); return audio; };
  if (track.availability !== 'ready' && track.availability !== 'audio-only' || track.availability === 'ready' && !track.lyrics?.text.trim()) throw invalid();
  if (Buffer.isBuffer(source)) validated(source);
  const lastCue = track.lyrics?.kind === 'timed' && parseLrc(track.lyrics.text).cues.at(-1);
  const text = track.lyrics?.text ?? '';
  const clean = Buffer.byteLength(text) <= maxLyricsBytes && !lyricQualityIssue(text, track.duration);
  // A plain payload must not smuggle a valid or malformed time tag into a playable sidecar.
  const plain = track.lyrics?.kind === 'plain' && clean && !hasLrcTiming(text) && !!parseLrc(text).plain;
  const sidecar = plain ? formatLyricText(text, lyricScript) : clean && track.availability === 'ready' && lastCue && track.duration > 0 && lastCue.ms <= track.duration * 1000
    ? formatLyricText(track.lyrics!.text, lyricScript) : undefined;
  const report = (result: SongLocalSaveResult): SongLocalSaveResult => result.lyrics && plain && (result.status === 'saved' || result.status === 'lyrics-added')
    ? { ...result, lyricsKind: 'plain' } : result.audio && !result.lyrics && track.lyrics
      ? { ...result, lyricsIssue: 'unsynced' } : result;
  let downloading: Promise<Buffer> | undefined;
  const loadAudio = () => downloading ??= (typeof source === 'function' ? source().then(validated) : Promise.resolve(source));
  const conflict = { status: 'conflict' as const };
  const complete = (result: SongLocalSaveResult | 'different' | undefined) => report(result && result !== 'different' ? result : conflict);
  if (videoTargets?.conflict) return conflict;
  const base = await realpath(resolve(root));
  async function inspectPath(existingAudio: string, text: string | undefined, verifyAudio: boolean) {
    const parts = existingAudio.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || part.includes(String.fromCharCode(92))) || !existingAudio.toLowerCase().endsWith('.mp3')) return conflict;
    const name = parts.pop()!;
    const existing = await openDirectory(base, parts, false);
    if (!existing) return conflict;
    return inspectSong(existing, parts, name.slice(0, -4), text, loadAudio, verifyAudio);
  }
  if (videoTargets?.exact) return complete(await inspectPath(videoTargets.exact, sidecar, false));
  let byteMatch: { path: string; outcome: SongLocalSaveResult } | undefined;
  for (const path of videoTargets?.compare ?? []) {
    const outcome = await inspectPath(path, undefined, true);
    if (outcome === 'different') continue;
    if (!outcome || outcome.status === 'conflict' || byteMatch) return conflict;
    byteMatch = { path, outcome };
  }
  if (byteMatch) {
    const { path, outcome } = byteMatch;
    return sidecar && !outcome.lyrics ? complete(await inspectPath(path, sidecar, true)) : report(outcome);
  }
  const stem = songTitleStem(track.title);
  const directoryTrack = directoryArtist === track.artist ? track : { ...track, artist: directoryArtist };
  const previousStem = songStem(directoryTrack);
  const folders = [artistFolder(directoryArtist)];
  const album = portableFilenameStem(track.album);
  if (track.provider !== 'bilibili-video' && track.releaseId && album) folders.push(album);
  const legacyStem = legacyVideoTitle !== undefined ? songTitleStem(legacyVideoTitle) : previousStem;
  const old = new SongArchivePaths().add(directoryTrack, legacyStem).audio.split('/');
  const oldStem = old.pop()!.slice(0, -4);
  const verifyAudio = track.provider === 'bilibili-video';
  const target = await openDirectory(base, folders, false);
  if (target) {
    // Existing downloads keep the spelling and location the user already has.
    for (const name of new Set([stem, previousStem])) {
      const existing = await inspectSong(target, folders, name, sidecar, loadAudio, verifyAudio);
      if (existing) return complete(existing);
    }
  }
  if (old.join('/') !== folders.join('/') || oldStem !== stem && oldStem !== previousStem) {
    const oldDirectory = await openDirectory(base, old, false);
    if (oldDirectory) {
      const existing = await inspectSong(oldDirectory, old, oldStem, sidecar, loadAudio, verifyAudio);
      if (existing) return complete(existing);
    }
  }
  const audio = await loadAudio();
  const directory = await openDirectory(base, folders, true);
  const files: { name: string; data: string | Buffer }[] = [{ name: `${stem}.mp3`, data: audio }];
  if (sidecar) files.push({ name: `${stem}.lrc`, data: sidecar });
  const written = await publish(directory!, files);
  if (!written) return complete(await inspectSong(directory!, folders, stem, sidecar, loadAudio, verifyAudio));
  return report({ status: 'saved', audio: [...folders, `${stem}.mp3`].join('/'), ...(sidecar ? { lyrics: [...folders, `${stem}.lrc`].join('/') } : {}) });
}

export async function saveLyricsLocally(root: string, track: { title: string; artist: string; duration?: number | null }, text: string, version?: string,
  lyricScript: LyricScript = defaultLyricScript): Promise<SongLocalSaveResult> {
  if (!track.artist.trim() || !track.title.trim() || !text.trim() || Buffer.byteLength(text) > maxLyricsBytes ||
      lyricQualityIssue(text, track.duration)) throw new SongError('没有通过质量校验的可保存歌词。', 409);
  const parsed = parseLrc(text);
  if (!parsed.cues.length && !parsed.plain) throw new SongError('没有可保存的歌词。', 409);
  const base = await realpath(resolve(root));
  const folders = [artistFolder(track.artist), '独立歌词'];
  const directory = (await openDirectory(base, folders, true))!;
  const suffix = version ? ` [${portableFilenameStem(version)}]` : '';
  const stem = `${songTitleStem(track.title)}${suffix}`;
  const name = `${stem}.lrc`;
  const names = new Set([fileKey(stem), fileKey(`${songStem(track)}${suffix}`)]);
  const matching = (await readdir(directory.directory, { withFileTypes: true })).filter(entry => {
    const ext = extname(entry.name);
    return !!ext && names.has(fileKey(entry.name.slice(0, -ext.length)));
  });
  const siblings = matching.filter(entry => extname(entry.name).toLowerCase() === '.lrc');
  if (siblings.length > 1 || siblings.some(entry => !entry.isFile()) || matching.some(entry =>
    audioExtensions.has(extname(entry.name).toLowerCase()))) return { status: 'conflict' };
  if (siblings.length) return { status: 'exists', lyrics: [...folders, siblings[0].name].join('/') };
  return await publish(directory, [{ name, data: formatLyricText(text, lyricScript) }]) ? { status: 'lyrics-saved', lyrics: [...folders, name].join('/') } : { status: 'conflict' };
}
