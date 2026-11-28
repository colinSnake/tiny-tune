import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { readBounded } from './response-body';
import { parseLyrics, readCompleteAudio, SongError, songUserAgent, type SongCatalog, type SongRecord } from './songs';
import { songMatchScore, type SongSummary } from './song-types';

type Line = readonly [part: number, firstNote: number, lastNote: number];
type Release = Pick<SongSummary, 'id' | 'title' | 'artist' | 'album' | 'duration' | 'aliases'> & {
  bvid: string; format: string; audioHash: string;
  projectUrl: string; projectHash: string; lyricSourceUrl: string; lyricLines: readonly Line[];
  lyricJoins?: readonly (readonly [syllables: string, word: string])[];
  licenseUrl: string; credits: string;
};

const projectPath = 'Diamochang/free-software-song-openutau';
const revision = '3845741485b10cb70c36f13cf7c2f429f312a217';
const projectFile = 'The%20Free%20Software%20Song%20with%20OpenUTAU.ustx';
export const bilibiliReleases: readonly Release[] = [{
  id: '1619745690', bvid: 'BV1QE421w7GX', format: '30280', duration: 101.702,
  title: '自由软件之歌', artist: 'Diamochang · 幸 & 三色零歌', album: 'OpenUTAU 4/4 演绎版',
  aliases: { titles: ['自由软件之歌', '自由軟體之歌', 'The Free Software Song'], artists: ['Diamochang', '幸', '三色零歌'] },
  audioHash: '9a0782503081714dff6a4197adf4f9beff8a09ddd788c3926f7f3a1e9924cd2a',
  projectUrl: `https://raw.githubusercontent.com/${projectPath}/${revision}/${projectFile}`,
  projectHash: 'f11c1a2a526965bb86e7500b1ab97acff7b6c2ca4f74e3a2a12dc062cac3ec48',
  lyricSourceUrl: `https://github.com/${projectPath}/blob/${revision}/${projectFile}`,
  // Take each sung line once, in playback order. The second part takes over lines 7–8;
  // the third part doubles the other vocals, so its duplicate notes are omitted.
  lyricLines: [[0, 1, 8], [0, 9, 17], [0, 18, 25], [0, 26, 34], [0, 35, 40], [0, 41, 47],
    [1, 1, 7], [1, 8, 14], [0, 48, 54], [0, 55, 61], [0, 62, 67], [0, 68, 72]],
  lyricJoins: [['soft ware', 'software'], ['You ll', "You'll"], ['you ll', "you'll"], ['can not', 'cannot']],
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  credits: '歌词 Richard Stallman；4/4 版本配乐 Thor；演唱音源 幸 / 三色零歌；调校及投稿 Diamochang (MikeP)。' +
    '原音轨按 CC BY-SA 4.0 发布，本包将其转码为 MP3；纯文本歌词按原工程的演唱顺序整理。',
}];

type Commands = { ytDlp: string; ffmpeg: string };
type Options = { entries?: readonly Release[]; commands?: Commands | false; request?: typeof fetch };
const maxInput = 12 * 1024 * 1024;
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const sourceUrl = (entry: Release) => `https://www.bilibili.com/video/${entry.bvid}/`;

function executable(name: string) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    const path = join(dir, process.platform === 'win32' ? `${name}.exe` : name);
    try { accessSync(path, constants.X_OK); if (statSync(path).isFile()) return path; } catch { /* not on this PATH entry */ }
  }
}

function discoverTools(): Commands | false {
  const ytDlp = executable('yt-dlp'), ffmpeg = executable('ffmpeg');
  return ytDlp && ffmpeg ? { ytDlp, ffmpeg } : false;
}

function run(tool: string, args: string[], maxBuffer: number, signal: AbortSignal, input?: Buffer) {
  signal.throwIfAborted();
  return new Promise<Buffer>((resolve, reject) => {
    const child = execFile(tool, args, { encoding: 'buffer', maxBuffer, signal, killSignal: 'SIGKILL', windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.on('error', () => {}); // A decoder that rejects its input can close stdin early.
    child.stdin?.end(input);
  });
}

function projectLyrics(project: Buffer, entry: Release) {
  // This is a projection of a pinned OpenUTAU export, not a parser for uploaded YAML.
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(project).replace(/\r\n/g, '\n');
  const voices = (`\n${raw}`).split('\nvoice_parts:\n', 2)[1]?.split(/^\w+:/m, 1)[0] ?? '';
  const notes = voices.split(/^- name: /m).slice(1).map(part =>
    [...part.matchAll(/^ {4}lyric: (.+)$/gm)].map(([, value]) => value.replace(/^"(.*)"$/, '$1')));
  return entry.lyricLines.map(([part, first, last]) => {
    const line = notes[part]?.slice(first - 1, last);
    if (!line || line.length !== last - first + 1) throw new Error('Missing notes');
    return (entry.lyricJoins ?? []).reduce((text, [syllables, word]) => text.replaceAll(syllables, word), line.join(' '));
  }).join('\n');
}

export class BilibiliCatalog implements SongCatalog {
  private readonly entries: ReadonlyMap<string, Release>;
  private readonly media: BilibiliMedia;
  private readonly request: typeof fetch;

  constructor({ entries = bilibiliReleases, commands = discoverTools(), request = fetch }: Options = {}) {
    this.entries = new Map(entries.map(entry => [entry.id, entry]));
    this.media = new BilibiliMedia(commands);
    this.request = request;
  }

  status() {
    const configured = this.media.available && this.entries.size > 0;
    return { configured, bundlesEnabled: configured };
  }

  private requireTools() {
    if (!this.media.available) throw new SongError('B 站下载需要安装 yt-dlp 和 FFmpeg，安装后请重启服务。', 503);
  }

  private entry(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new SongError('B 站曲库没有收录这版录音。', 404);
    return entry;
  }

  private summary(entry: Release): SongSummary {
    const { id, title, artist, album, duration, aliases } = entry;
    return { provider: 'bilibili', id, title, artist, album, duration, aliases, availability: 'ready' };
  }

  async search(query: string, signal: AbortSignal) {
    signal.throwIfAborted();
    this.requireTools();
    return [...this.entries.values()].filter(entry => songMatchScore(entry, query) > 0).map(entry => this.summary(entry));
  }

  async detail(id: string, signal: AbortSignal): Promise<SongRecord> {
    this.requireTools();
    const entry = this.entry(id);
    let lyrics: ReturnType<typeof parseLyrics>['lyrics'];
    try {
      const response = await this.request(entry.projectUrl, { signal, redirect: 'error', headers: { 'User-Agent': songUserAgent } });
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new Error('Missing project');
      }
      const project = await readBounded(response, 256 * 1024, signal);
      if (hash(project) !== entry.projectHash) throw new SongError('B 站投稿对应的歌词工程版本已变更，需要重新核对。', 409);
      lyrics = parseLyrics(projectLyrics(project, entry), entry.duration).lyrics;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof SongError) throw error;
      throw new SongError('暂时无法读取 B 站投稿对应的歌词工程。', 502);
    }
    if (!lyrics) throw new SongError('这版 B 站录音没有可打包的歌词。', 409);
    const { bvid, licenseUrl, lyricSourceUrl, credits } = entry;
    return { track: { ...this.summary(entry), sourceUrl: sourceUrl(entry), rightsUrl: sourceUrl(entry),
      previewUrl: null, bilibiliVideoId: bvid, licenseUrl, lyricSourceUrl, credits, lyrics }, downloadUrl: null };
  }

  audio({ track }: SongRecord, signal: AbortSignal) {
    const entry = this.entry(track.id);
    return this.media.audio(sourceUrl(entry), track.duration, entry.audioHash, signal, entry.format);
  }
}

export class BilibiliMedia {
  constructor(private readonly commands: Commands | false = discoverTools()) {}

  get available() { return !!this.commands; }

  async audio(url: string, duration: number, expectedHash: string | undefined, signal: AbortSignal, format = '30280') {
    const tools = this.commands;
    if (!tools) throw new SongError('B 站下载需要安装 yt-dlp 和 FFmpeg，安装后请重启服务。', 503);
    const match = /^https:\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]{10})\/(?:\?p=([1-9]\d{0,2}))?$/.exec(url);
    if (!match || !/^\d{1,8}$/.test(format) || (!expectedHash && !match[2])) {
      throw new SongError('无效的 B 站音轨标识。', 400);
    }
    const filter = match[2] ? ['--match-filters', `id = ${match[1]}_p${match[2]}`] : [];
    const formats = (expectedHash ? [format] : ['30280', '30232', '30216'])
      .map(id => `${id}[protocol=https][vcodec=none]`).join('/');
    let original: Buffer;
    try {
      original = await run(tools.ytDlp, ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-cache-dir',
        '--no-cookies', '--no-cookies-from-browser', ...filter,
        '--downloader', 'native', '--fixup', 'never', '--no-progress', '--socket-timeout', '8', '--retries', '0',
        '--fragment-retries', '0', '--extractor-retries', '0', '--max-filesize', '12M',
        '-f', formats, '-o', '-', '--', url], maxInput, signal);
      if (!original.length) throw new Error('Empty audio');
    } catch {
      signal.throwIfAborted();
      throw new SongError('B 站未返回这个分集的完整公开音轨。可以稍后重试，或选择另一条投稿。', 502);
    }
    if (expectedHash && hash(original) !== expectedHash) throw new SongError('B 站音轨版本已变更，需要重新核对后才能下载。', 409);
    // Keep MP3 compatibility without imposing a second fixed 128 kbps bottleneck.
    // VBR cannot restore detail absent in the source and does not imply lossless audio.
    let mp3: Buffer;
    try {
      mp3 = await run(tools.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-err_detect', 'explode',
        '-f', 'mov', '-i', 'pipe:0', '-map', '0:a:0', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-q:a', '0', '-f', 'mp3', 'pipe:1'],
      32 * 1024 * 1024, signal, original);
    } catch {
      signal.throwIfAborted();
      throw new SongError('B 站音轨未能转为完整 MP3，请检查 FFmpeg 后重试。', 502);
    }
    return readCompleteAudio(new Response(new Uint8Array(mp3), { headers: { 'content-type': 'audio/mpeg' } }), { duration }, signal);
  }
}
