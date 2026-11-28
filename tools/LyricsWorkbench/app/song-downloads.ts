import { SongArchivePaths, songBundleStem, songStem } from '../src/song-archive';
import { validatedLyricKind } from '../src/lyric-quality';
import type { LyricScript } from '../src/lyric-script';
import type { SongSummary } from '../src/song-types';
import { checked, failure, RequestFailure, type Failure } from './song-requests';

export const songKey = (track: SongSummary) => `${track.provider}:${track.id}`;
export const trackPath = (track: SongSummary) => `/api/songs/${track.provider}/${encodeURIComponent(track.id)}`;
export const canDownload = (track: SongSummary) => track.availability === 'ready' || track.availability === 'audio-only';
const maxSongBytes = 33 * 1024 * 1024;
export const maxBatchBytes = 160 * 1024 * 1024;

type FetchSong = (path: string, init: { method: 'POST'; signal: AbortSignal; headers?: Record<string, string>; body?: string }) => Promise<Response>;
type ManifestFields = Record<string, unknown>;
type SongFile = { name: string; file: Blob; audio: Blob; bundle?: { stem: string; lyrics: string; release: SongSummary;
  source: ManifestFields; audioInfo: ManifestFields; lyricInfo: ManifestFields } };
const fields = (value: unknown): ManifestFields => value && typeof value === 'object' && !Array.isArray(value) ? value as ManifestFields : {};
const glyphsOf = (value: unknown) => Array.isArray(value) ? value.filter((glyph): glyph is string =>
  typeof glyph === 'string' && /^\p{Script=Han}$/u.test(glyph)) : [];
export function glyphNotice(value: unknown) {
  const glyphs = glyphsOf(value);
  return glyphs.length ? `字形待核对（${glyphs.slice(0, 8).join('、')}${glyphs.length > 8 ? '…' : ''}）。` : '';
}
export type BatchProgress = { current: number; total: number; title?: string };
export type BatchResult = { archive: Blob | null; completed: { item: SongSummary; audio: Blob }[]; remaining: SongSummary[]; residualGlyphs: string[]; error?: Failure };

export async function fetchSongFile(item: SongSummary, signal: AbortSignal, request: FetchSong = fetch, lyricScript?: LyricScript): Promise<SongFile> {
  signal.throwIfAborted();
  if (!canDownload(item)) throw new RequestFailure('这个结果没有可下载的音频。');
  const mp3 = item.availability === 'audio-only';
  const type = mp3 ? 'audio/mpeg' : 'application/zip';
  const response = await checked(await request(`${trackPath(item)}/${mp3 ? 'mp3' : 'download'}`, { method: 'POST', signal,
    ...(!mp3 && lyricScript ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lyricScript }) } : {}) }));
  if (response.headers.get('content-type')?.split(';')[0] !== type) {
    throw new RequestFailure(mp3 ? '服务端未返回完整 MP3。' : '服务端未返回整曲下载包。');
  }
  if (Number(response.headers.get('content-length')) > maxSongBytes) {
    await response.body?.cancel();
    throw new RequestFailure('这首歌的下载文件超过大小上限。');
  }
  const file = await response.blob();
  signal.throwIfAborted();
  if (!file.size || file.size > maxSongBytes) throw new RequestFailure('下载文件为空或超过大小上限。');
  const stem = songStem(item);
  if (mp3) return { name: `${stem}.mp3`, file, audio: file };

  try {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const manifest = fields(JSON.parse(await zip.file('manifest.json')?.async('string') ?? 'null'));
    const version = manifest.version;
    if (version !== 1 && version !== 2) throw new Error('Unknown manifest');
    const source = fields(manifest.source), audioInfo = fields(manifest.audio), lyricInfo = fields(manifest.lyrics);
    const audioName = audioInfo.file, lyricName = lyricInfo.file;
    const bundleStem = songBundleStem(audioName, lyricName, version);
    if (!bundleStem || typeof audioName !== 'string' || typeof lyricName !== 'string') throw new Error('Invalid files');
    if (version === 2 && (source.provider !== item.provider || source.id !== item.id)) throw new Error('Wrong recording');
    const audioFile = zip.file(audioName), lyricFile = zip.file(lyricName);
    if (!audioFile || !lyricFile) throw new Error('Missing files');
    const release = version === 1 ? item : { ...item,
      title: typeof manifest.title === 'string' ? manifest.title : item.title,
      duration: typeof manifest.duration === 'number' && Number.isFinite(manifest.duration) && manifest.duration > 0 ? manifest.duration : item.duration,
      album: typeof manifest.album === 'string' ? manifest.album : '',
      artist: typeof manifest.artist === 'string' ? manifest.artist : item.artist,
      releaseId: typeof manifest.releaseId === 'string' ? manifest.releaseId : undefined };
    const [bytes, lyricBytes] = await Promise.all([audioFile.async('arraybuffer'), lyricFile.async('uint8array')]);
    signal.throwIfAborted();
    if (!bytes.byteLength || bytes.byteLength > maxSongBytes || !lyricBytes.byteLength || lyricBytes.byteLength > 256 * 1024) throw new Error('Invalid content');
    const lyrics = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(lyricBytes);
    const kind = validatedLyricKind(lyrics, release.duration);
    // Older bundles did not declare a kind. Current ones must not mislabel timing.
    if (!kind || version === 2 && lyricInfo.kind !== kind) throw new RequestFailure('下载包中的歌词或时码未通过校验。');
    return { name: `${stem}.zip`, file, audio: new Blob([bytes], { type: 'audio/mpeg' }), bundle: { stem: bundleStem, lyrics, release, source, audioInfo, lyricInfo } };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof RequestFailure) throw error;
    throw new RequestFailure('下载包损坏，或缺少同版本音频与歌词。');
  }
}

export async function prepareSongBatch(items: readonly SongSummary[], signal: AbortSignal, progress: (value: BatchProgress) => void,
  request: FetchSong = fetch, budget = maxBatchBytes, lyricScript?: LyricScript): Promise<BatchResult> {
  const tracks = [...new Map(items.filter(canDownload).map(track => [songKey(track), track])).values()];
  signal.throwIfAborted();
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const paths = new SongArchivePaths();
  const manifest: ManifestFields[] = [];
  const completed: BatchResult['completed'] = [], remaining: SongSummary[] = [];
  const residualGlyphs = new Set<string>();
  let size = 0, error: Failure | undefined;
  for (const [index, item] of tracks.entries()) {
    signal.throwIfAborted();
    progress({ current: index + 1, total: tracks.length, title: item.title });
    try {
      const song = await fetchSongFile(item, signal, request, lyricScript);
      if (size + song.file.size > budget) {
        error = { message: '已达到单个批量 ZIP 的体积上限，剩余歌曲可另行下载。' };
        remaining.push(...tracks.slice(index));
        break;
      }
      const bytes = await song.audio.arrayBuffer();
      signal.throwIfAborted();
      const bundle = song.bundle;
      const { title, album, artist, releaseId, duration } = bundle?.release ?? item;
      const path = paths.add({ provider: item.provider, album, artist, releaseId }, bundle?.stem ?? songStem(item));
      zip.file(path.audio, bytes);
      if (bundle) {
        zip.file(path.lyrics, bundle.lyrics);
        for (const glyph of glyphsOf(bundle.lyricInfo.residualGlyphs)) residualGlyphs.add(glyph);
      }
      manifest.push({ title, artist, album, releaseId, duration,
        source: { ...bundle?.source, provider: item.provider, id: item.id },
        audio: { ...bundle?.audioInfo, file: path.audio, format: 'mp3' },
        lyrics: bundle ? { ...bundle.lyricInfo, file: path.lyrics } : null });
      size += song.file.size;
      completed.push({ item, audio: song.audio });
    } catch (cause) {
      signal.throwIfAborted();
      const issue = failure(cause);
      if ((issue.retryAt ?? 0) > Date.now()) {
        error = issue;
        remaining.push(...tracks.slice(index));
        break;
      }
      error ??= issue;
      remaining.push(item);
    }
  }
  if (!completed.length) return { archive: null, completed, remaining, residualGlyphs: [...residualGlyphs], error };
  progress({ current: tracks.length, total: tracks.length });
  zip.file('manifest.json', JSON.stringify({ version: 2, tracks: manifest }, null, 2) + '\n');
  const archive = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
  signal.throwIfAborted();
  return { archive, completed, remaining, residualGlyphs: [...residualGlyphs], error };
}
