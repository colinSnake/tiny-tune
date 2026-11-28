import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { MusicSources } from './providers';
import { isMbid, MusicSources as DefaultMusicSources, UpstreamError } from './providers';
import type { Artist, LyricResult, Track } from './types';
import { LocalMusicLibrary } from './local-library';
import { localBatchLimit, localTrackId, type LocalLyricChoice } from './local-library-types';
import { isSongId, JamendoCatalog, songSourceError, songZip, type SongCatalog } from './songs';
import { PublishedCatalog } from './published-songs';
import { BilibiliCatalog } from './bilibili-songs';
import { BilibiliDiscovery, isBilibiliVideoId } from './bilibili-discovery';
import { lyricText } from './export';
import { songTitleStem } from './song-archive';
import { parseLyricScript } from './lyric-script';
import { saveLyricsLocally, saveSongLocally, type SongLocalSaveResult } from './song-local-save';
import { LyricsCatalog } from './lyrics-catalog';
import { matchLyrics, normalize } from './match';
import { chooseLyrics } from './workbench';
import { matchVideoLyrics, videoLyricArtistHint, videoLyricQuery } from './video-lyrics';
import { rankSongs, songProviders, songProviderLabels, type SongDetail, type SongProvider } from './song-types';

type Sources = Pick<MusicSources, 'artists' | 'recordings' | 'collect'>;
type ServerOptions = {
  sources?: Sources; songs?: SongCatalog; publishedSongs?: SongCatalog | false; lyricSongs?: SongCatalog | false;
  bilibiliSongs?: SongCatalog | false; bilibiliVideos?: BilibiliDiscovery | false; songDownloadTimeout?: number;
  developmentRoot?: string; staticRoot?: string; logger?: boolean;
  localFontPath?: string;
  localLibraryRoot?: string; localLyricSearch?: MusicSources['searchLyrics'];
};

function isTrack(data: unknown): data is Track {
  if (!data || typeof data !== 'object') return false;
  const track = data as Record<string, unknown>;
  const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024;
  return typeof track.id === 'string' && isMbid(track.id) && text(track.title) && !!track.title.trim() &&
    text(track.artist) && !!track.artist.trim() && Array.isArray(track.albums) && track.albums.length <= 24 &&
    track.albums.every(text) && (track.duration === null ||
      typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0);
}

function badInput(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

function sourceError(error: unknown, signal: AbortSignal, reply: FastifyReply) {
  if (signal.aborted) return reply.code(499).send();
  const upstream = error instanceof UpstreamError ? error : undefined;
  const retryAt = upstream?.retryAt;
  const message = upstream?.message ?? '采集失败，请重试。';
  if (retryAt) reply.header('Retry-After', String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))));
  return reply.code(upstream?.status ?? (retryAt ? 429 : 502)).send({ error: message, retryAt });
}

function requestSignal(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!reply.raw.writableEnded) abort(); };
  request.raw.once('aborted', abort);
  reply.raw.once('close', close);
  return {
    signal: controller.signal,
    dispose() {
      request.raw.off('aborted', abort);
      reply.raw.off('close', close);
    },
  };
}

// The filesystem workflow is available only on the workbench's loopback origin.
// Checking the literal Host also prevents another hostname resolving to loopback.
function localOrigin(request: FastifyRequest) {
  const host = request.headers.host;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) ||
      !host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
  const { origin, 'sec-fetch-site': site } = request.headers;
  if (site && site !== 'same-origin' && site !== 'none') return false;
  if (origin || request.method === 'POST') return origin === `${request.protocol}://${host}`;
  return true;
}

function localChoices(body: unknown): LocalLyricChoice[] | undefined {
  const tracks = (body as { tracks?: unknown } | null)?.tracks;
  if (!Array.isArray(tracks) || !tracks.length || tracks.length > localBatchLimit) return;
  const ids = new Set<string>();
  for (const track of tracks) {
    if (!track || typeof track.id !== 'string' || !localTrackId.test(track.id) || ids.has(track.id) ||
      !Number.isSafeInteger(track.candidateId) || track.candidateId <= 0 || typeof track.confirmed !== 'boolean' ||
      track.mode !== undefined && track.mode !== 'original' && track.mode !== 'plain' ||
      track.upgradePlain !== undefined && (typeof track.upgradePlain !== 'boolean' || track.upgradePlain && tracks.length !== 1)) return;
    ids.add(track.id);
  }
  return tracks;
}

function audioRange(value: string, size: number): { start: number; end: number } | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || !m[1] && !m[2]) return;
  if (!m[1]) {
    const suffix = Number(m[2]);
    return suffix > 0 && Number.isSafeInteger(suffix) ? { start: Math.max(0, size - suffix), end: size - 1 } : undefined;
  }
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : size - 1;
  if (start < size && end >= start && Number.isSafeInteger(end)) return { start, end: Math.min(size - 1, end) };
}

export async function createServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const defaultSources = new DefaultMusicSources();
  const sources = options.sources ?? defaultSources;
  const artistSearches = new Map<string, { artists: Artist[]; expiresAt: number }>();

  if (options.localFontPath) {
    try {
      const font = await readFile(options.localFontPath);
      app.get('/local-assets/ruantang.ttf', async (_request, reply) => reply
        .type('font/ttf')
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .send(font));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  app.get('/api/catalog', async (request, reply) => {
    const params = new URL(request.url, 'http://127.0.0.1').searchParams;
    const query = params.get('q')?.trim();
    const artistId = params.get('artist');
    const context = requestSignal(request, reply);
    try {
      if (query && !artistId && query.length <= 120) {
        const cached = artistSearches.get(query);
        if (cached && cached.expiresAt > Date.now()) return { artists: cached.artists };
        artistSearches.delete(query);
        const artists = await sources.artists(query, context.signal);
        context.signal.throwIfAborted();
        artistSearches.set(query, { artists, expiresAt: Date.now() + 2 * 60_000 });
        const oldest = artistSearches.size > 64 ? artistSearches.keys().next().value : undefined;
        if (oldest !== undefined) artistSearches.delete(oldest);
        return { artists };
      }
      if (artistId && !query && isMbid(artistId)) {
        const offset = params.get('offset') ?? '0';
        if (!/^\d{1,6}$/.test(offset)) return badInput(reply, '无效的分页位置。');
        return await sources.recordings(artistId, Number(offset), 50, context.signal);
      }
      return badInput(reply, '输入歌手名称或有效的 MusicBrainz 歌手 ID。');
    } catch (error) {
      return sourceError(error, context.signal, reply);
    } finally {
      context.dispose();
    }
  });

  app.post('/api/lyrics', async (request, reply) => {
    const origin = request.headers.origin;
    const expectedOrigin = `${request.protocol}://${request.host}`;
    if (origin && origin !== expectedOrigin) return reply.code(403).send();
    if (!request.headers['content-type']?.startsWith('application/json')) {
      return badInput(reply, '请求必须使用 JSON。');
    }
    if (!isTrack(request.body)) return badInput(reply, '曲目信息不完整，无法匹配歌词。');

    const context = requestSignal(request, reply);
    try {
      return await sources.collect(request.body, context.signal);
    } catch (error) {
      return sourceError(error, context.signal, reply);
    } finally {
      context.dispose();
    }
  });

  const local = options.localLibraryRoot ? new LocalMusicLibrary(options.localLibraryRoot,
    options.localLyricSearch ?? ((query, signal) => defaultSources.searchLyrics(query, signal, 100))) : undefined;
  const localHeaders = (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store').header('Cross-Origin-Resource-Policy', 'same-origin');
    return localOrigin(request);
  };
  app.get<{ Querystring: { q?: string | string[] } }>('/api/local-library', async (request, reply) => {
    if (!localHeaders(request, reply)) return reply.code(403).send();
    if (!local) return { enabled: false, tracks: [] };
    const params = new URL(request.url, 'http://127.0.0.1').searchParams;
    const q = params.getAll('q').map(value => value.trim());
    if (!q.length) return { enabled: true, root: local.root, tracks: [] };
    if (q.length > 12 || q.some(value => !value || value.length > 120)) return badInput(reply, '歌名或歌手名称无效。');
    try { return await local.search(q); }
    catch { return reply.code(503).send({ error: '本地曲库暂不可读，请检查 Web 服务的目录访问权限。' }); }
  });
  app.post<{ Params: { id: string }; Body?: { searchTiming?: boolean } }>('/api/local-library/:id/lyrics', { bodyLimit: 1024 }, async (request, reply) => {
    if (!localHeaders(request, reply)) return reply.code(403).send();
    if (!local || !localTrackId.test(request.params.id)) return reply.code(404).send({ error: '找不到本地录音。' });
    const context = requestSignal(request, reply);
    try {
      return await local.lookup(request.params.id, context.signal, request.body?.searchTiming === true) ?? reply.code(404).send({ error: '本地音频已变化，请重新搜索歌手。' });
    } catch (error) { return sourceError(error, context.signal, reply); }
    finally { context.dispose(); }
  });
  app.get<{ Params: { id: string } }>('/api/local-library/:id/audio', async (request, reply) => {
    if (!localHeaders(request, reply)) return reply.code(403).send();
    const audio = local && localTrackId.test(request.params.id) ? await local.audio(request.params.id).catch(() => undefined) : undefined;
    if (!audio) return reply.code(404).send({ error: '找不到本地音频，请重新搜索歌手。' });
    const { file, size, mime } = audio;
    const header = request.headers.range;
    const range = header ? audioRange(header, size) : undefined;
    if (header && !range) {
      await file.close();
      return reply.header('Content-Range', `bytes */${size}`).code(416).send();
    }
    reply.type(mime).header('Accept-Ranges', 'bytes').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Length', range ? range.end - range.start + 1 : size);
    if (range) reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    if (request.method === 'HEAD') { await file.close(); return reply.send(); }
    return reply.send(file.createReadStream(range));
  });
  app.post('/api/local-library/save', { bodyLimit: 12_000 }, async (request, reply) => {
    if (!localHeaders(request, reply)) return reply.code(403).send();
    if (!local) return reply.code(404).send({ error: '尚未配置本地曲库。' });
    const choices = localChoices(request.body);
    if (!choices) return badInput(reply, `请选择 1–${localBatchLimit} 首已核对的本地录音。`);
    const lyricScript = parseLyricScript((request.body as { lyricScript?: unknown }).lyricScript);
    if (!lyricScript) return badInput(reply, '请选择简体中文或保留原文。');
    try { return { results: await local.save(choices, lyricScript) }; }
    catch { return reply.code(503).send({ error: '暂时无法访问本地曲库，请重新搜索后重试。' }); }
  });

  app.post('/api/local-library/lyrics-only', { bodyLimit: 12_000 }, async (request, reply) => {
    if (!localHeaders(request, reply)) return reply.code(403).send();
    if (!local) return reply.code(404).send({ error: '尚未配置本地曲库。' });
    const body = request.body as { track?: unknown; candidateId?: number; lyricScript?: unknown } | null;
    if (!isTrack(body?.track) || (body.candidateId !== undefined && (!Number.isSafeInteger(body.candidateId) || body.candidateId <= 0))) {
      return badInput(reply, '请选择有效的歌曲和歌词版本。');
    }
    const { track, candidateId } = body;
    const lyricScript = parseLyricScript(body.lyricScript);
    if (!lyricScript) return badInput(reply, '请选择简体中文或保留原文。');
    return withSongRequest(request, reply, 25_000, async signal => {
      const { result } = await sources.collect(track, signal);
      const chosen = (result.status !== 'review' || candidateId !== undefined) && chooseLyrics(result, candidateId, track);
      const text = chosen && lyricText(chosen.result);
      if (!chosen || !text || candidateId !== undefined && chosen.candidate.id !== candidateId ||
          normalize(chosen.candidate.title) !== normalize(track.title) || normalize(chosen.candidate.artist) !== normalize(track.artist)) {
        return reply.code(409).send({ error: '没有核对到可保存的歌词，请重新选择歌词版本。' });
      }
      signal.throwIfAborted();
      return saveLyricsLocally(local.root, track, text, result.status === 'review' ? `歌词 ${chosen.candidate.id}` : undefined, lyricScript);
    });
  });

  const songs = options.songs ?? new JamendoCatalog({
    clientId: process.env.JAMENDO_CLIENT_ID,
    allowBundles: process.env.JAMENDO_BUNDLE_AUTHORIZED === '1',
    approvedTrackHashes: Object.fromEntries((process.env.JAMENDO_APPROVED_MP3_SHA256 ?? '').split(',').map(entry => entry.trim().split(':', 2))),
  });
  const publishedSongs = options.publishedSongs ?? (options.songs ? false : new PublishedCatalog());
  // Explicit fixtures must opt into independent sources; the normal server shares LRCLIB's queue with local matching.
  const lyricSongs = options.lyricSongs ?? (options.songs || options.publishedSongs !== undefined || options.sources
    ? false : new LyricsCatalog(defaultSources));
  const bilibiliSongs = options.bilibiliSongs ?? (options.songs || options.publishedSongs !== undefined || options.lyricSongs !== undefined || options.sources
    ? false : new BilibiliCatalog());
  const bilibiliVideos = options.bilibiliVideos ?? (options.songs || options.publishedSongs !== undefined || options.lyricSongs !== undefined ||
    options.bilibiliSongs !== undefined || options.sources ? false : new BilibiliDiscovery({ approved: process.env.BILIBILI_APPROVED_AUDIO_SHA256 }));
  const catalogs: Record<SongProvider, SongCatalog | false> = { artist: publishedSongs, bilibili: bilibiliSongs,
    'bilibili-video': bilibiliVideos, jamendo: songs, lrclib: lyricSongs };
  const validId = (provider: string, id: string) => provider === 'bilibili-video' ? isBilibiliVideoId(id) : isSongId(id);
  const getSongCatalog = (value: string) => {
    const provider = songProviders.find(candidate => candidate === value);
    return provider ? catalogs[provider] : false;
  };
  const searchSources = () => songProviders.filter(provider => {
    const catalog = catalogs[provider];
    return catalog && catalog.status().configured;
  });
  let activeDownloads = 0;

  async function withSongRequest(request: FastifyRequest, reply: FastifyReply, timeout: number,
    action: (signal: AbortSignal) => Promise<unknown>) {
    const context = requestSignal(request, reply);
    const deadline = AbortSignal.timeout(timeout);
    reply.header('Cache-Control', 'no-store');
    try {
      return await action(AbortSignal.any([context.signal, deadline]));
    } catch (error) {
      if (context.signal.aborted) return reply.code(499).send();
      if (deadline.aborted) return reply.code(504).send({ error: '连接曲库或准备下载超时，请重试。' });
      const { message, status, retryAt } = songSourceError(error);
      if (retryAt) reply.header('Retry-After', String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))));
      return reply.code(status).send({ error: message, retryAt });
    } finally {
      context.dispose();
    }
  }

  async function songLyrics(track: SongDetail, signal: AbortSignal, searchArtistHint?: unknown): Promise<{ track: Track; result: LyricResult; lyricArtistHint?: string }> {
    const video = track.provider === 'bilibili-video';
    const { title, artist } = video && track.lyricIdentity ? track.lyricIdentity : track;
    const recording: Track = { id: `${track.provider}:${track.id}`, title, artist,
      albums: !video && track.album ? [track.album] : [], duration: track.duration || null };
    const hintedArtist = video && !artist && typeof searchArtistHint === 'string' ? videoLyricArtistHint(searchArtistHint) : undefined;
    const lookupArtist = artist || hintedArtist || '';
    const lookupTrack = lookupArtist === artist ? recording : { ...recording, artist: lookupArtist };
    if (!title || !lookupArtist) return { track: recording, result: { status: 'missing' } };
    const find = options.localLyricSearch ?? ((query: string, signal?: AbortSignal) => defaultSources.searchLyrics(query, signal, 100));
    const candidates = (await find(video ? videoLyricQuery(lookupTrack) : `${title} ${artist}`, signal)).slice(0, 100);
    signal.throwIfAborted();
    return { track: recording, result: video ? matchVideoLyrics(lookupTrack, candidates) : matchLyrics(recording, candidates),
      ...(hintedArtist ? { lyricArtistHint: hintedArtist } : {}) };
  }

  app.get('/api/songs/status', async (_request, reply) => {
    const sources = searchSources();
    return reply.header('Cache-Control', 'no-store').send({
      configured: sources.length > 0, bundlesEnabled: sources.some(provider => {
        const catalog = catalogs[provider];
        return catalog && catalog.status().bundlesEnabled;
      }), featured: !!publishedSongs, sources,
    });
  });
  app.get<{ Querystring: { q?: string; source?: string } }>('/api/songs', async (request, reply) => {
    const q = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (!q || q.length > 120) return badInput(reply, '请输入歌名或歌手（最多 120 个字符）。');
    const source = request.query.source;
    if (source !== undefined) {
      const provider = songProviders.find(candidate => candidate === source);
      if (!provider) return badInput(reply, '不支持的搜索来源。');
      const catalog = catalogs[provider];
      if (!catalog) return reply.code(404).send({ error: '搜索来源未启用。' });
      return withSongRequest(request, reply, 18_000, async signal => ({ tracks: rankSongs(await catalog.search(q, signal), q) }));
    }
    return withSongRequest(request, reply, 18_000, async signal => {
      const active = searchSources();
      if (!active.length) return { tracks: await songs.search(q, signal) };
      const results = await Promise.allSettled(active.map(async provider => {
        const catalog = catalogs[provider];
        return catalog ? await catalog.search(q, signal) : [];
      }));
      signal.throwIfAborted();
      const failures = results.flatMap((result, i) => result.status === 'rejected' ? [{ provider: active[i], error: result.reason }] : []);
      if (failures.length === active.length) throw failures[0].error;
      const tracks = rankSongs(results.flatMap(result => result.status === 'fulfilled' ? result.value : []), q);
      const warnings = failures.map(({ provider }) => `${songProviderLabels[provider]} 暂不可用`);
      if (!tracks.length && !songs.status().configured) warnings.push('Jamendo 尚未配置');
      return { tracks, ...(warnings.length ? { warning: `${warnings.join('；')}。` } : {}) };
    });
  });
  app.get<{ Params: { provider: string; id: string } }>('/api/songs/:provider/:id', async (request, reply) => {
    const { id, provider } = request.params;
    if (!validId(provider, id)) return badInput(reply, '无效的录音 ID。');
    const catalog = getSongCatalog(provider);
    if (!catalog) return reply.code(404).send({ error: '录音来源未启用。' });
    return withSongRequest(request, reply, 18_000, async signal => ({ track: (await catalog.detail(id, signal)).track }));
  });
  app.post<{ Params: { provider: string; id: string; mode: string } }>('/api/songs/:provider/:id/:mode', { bodyLimit: 1024 }, async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== `${request.protocol}://${request.host}`) return reply.code(403).send();
    const { id, provider, mode } = request.params;
    if (mode !== 'download' && mode !== 'mp3' && mode !== 'save' && mode !== 'lyrics' || mode === 'mp3' && (provider !== 'bilibili-video' || !bilibiliVideos)) {
      return reply.code(404).send({ error: '这个来源没有该下载方式。' });
    }
    if (mode === 'save' && (!localHeaders(request, reply) || !options.localLibraryRoot)) return reply.code(403).send({ error: '本地保存未启用或请求并非来自本机页面。' });
    if (!validId(provider, id)) return badInput(reply, '无效的录音 ID。');
    const catalog = getSongCatalog(provider);
    if (!catalog) return reply.code(404).send({ error: '录音来源未启用。' });
    if (mode === 'lyrics') return withSongRequest(request, reply, 25_000, async signal => {
      const { track } = await catalog.detail(id, signal);
      const lyricsBody = request.body as { artistHint?: unknown } | undefined | null;
      return songLyrics(track, signal, provider === 'bilibili-video' ? lyricsBody?.artistHint : undefined);
    });
    const optionsBody = request.body as { lyricScript?: unknown; alternate?: unknown; candidateId?: unknown; saveArtistHint?: unknown } | undefined | null;
    const lyricScript = parseLyricScript(optionsBody?.lyricScript);
    if (!lyricScript) return badInput(reply, '请选择简体中文或保留原文。');
    if (provider === 'bilibili-video' && mode === 'download') return reply.code(409).send({ error: '未核对到同版本歌词，不能打包 ZIP。' });
    if (provider === 'lrclib') {
      if (mode !== 'save' || !local) return reply.code(409).send({ error: '该结果只有歌词，没有可下载的同版本音频。' });
      return withSongRequest(request, reply, 25_000, async signal => {
        const { track } = await catalog.detail(id, signal);
        if (track.availability !== 'lyrics-only' || !track.lyrics) return reply.code(409).send({ error: '没有可保存的歌词。' });
        signal.throwIfAborted();
        const alternate = optionsBody?.alternate === true;
        return saveLyricsLocally(local.root, track, track.lyrics.text, alternate ? `歌词 ${id}` : undefined, lyricScript, track.lyrics.kind);
      });
    }
    if (activeDownloads >= 2) {
      reply.header('Retry-After', '3');
      return reply.code(429).send({ error: '正在准备其他下载，请稍后再试。', retryAt: Date.now() + 3000 });
    }
    activeDownloads++;
    let workDone = false, responseDone = false;
    const release = () => { if (workDone && responseDone) activeDownloads--; };
    const close = () => {
      reply.raw.off('finish', close);
      reply.raw.off('close', close);
      responseDone = true;
      release();
    };
    reply.raw.once('finish', close);
    reply.raw.once('close', close);
    try {
      // The curated archive can take longer to serve a complete file; keep the same
      // byte and concurrency limits, and keep all other sources on the existing deadline.
      const timeout = options.songDownloadTimeout ?? (provider === 'artist' ? 120_000 : provider === 'bilibili-video' && mode === 'save' ? 75_000 : 60_000);
      return await withSongRequest(request, reply, timeout, async signal => {
        if (mode === 'save') {
          let track: SongDetail, download: () => Promise<Buffer>, legacyVideoTitle: string | undefined;
          let lyricsIssue: SongLocalSaveResult['lyricsIssue'];
          let saveDirectoryArtist: string | undefined;
          let videoSource: Awaited<ReturnType<BilibiliDiscovery['mp3Source']>> | undefined;
          if (provider === 'bilibili-video' && bilibiliVideos) {
            const result = videoSource = await bilibiliVideos.mp3Source(id, signal);
            track = result.track; download = result.audio; legacyVideoTitle = result.downloadTitle;
            if (!track.artist.trim()) {
              saveDirectoryArtist = typeof optionsBody?.saveArtistHint === 'string'
                ? videoLyricArtistHint(optionsBody.saveArtistHint) : undefined;
            }
            try {
              const { result: found } = await songLyrics(track, AbortSignal.any([signal, AbortSignal.timeout(12_000)]), saveDirectoryArtist);
              const candidate = found.status === 'plain' ? found.candidate : found.status === 'review'
                ? found.candidates.find(candidate => candidate.id === optionsBody?.candidateId) : undefined;
              if (candidate?.plain.trim()) track = { ...track, lyrics: { kind: 'plain', text: candidate.plain } };
              else lyricsIssue = found.status === 'missing' ? 'missing' : found.status === 'review' ? 'review' : 'unsynced';
            } catch {
              signal.throwIfAborted();
              lyricsIssue = 'unavailable';
            }
            if (saveDirectoryArtist && !track.lyrics?.text.trim()) {
              return reply.code(409).send({ error: '未找到通过质量校验的匹配歌词，未写入本地曲库。' });
            }
          } else {
            const record = await catalog.detail(id, signal);
            if (record.track.availability !== 'ready') return reply.code(409).send({ error: '这版录音未开放整曲与歌词下载。' });
            track = record.track; download = () => catalog.audio(record, signal);
          }
          signal.throwIfAborted();
          const directoryTrack = saveDirectoryArtist ? { ...track, artist: saveDirectoryArtist } : track;
          const videoTargets = local && directoryTrack.provider === 'bilibili-video' && directoryTrack.artist && directoryTrack.title ? await local.videoSaveTargets(directoryTrack) : undefined;
          const result = await saveSongLocally(options.localLibraryRoot!, track, async () => {
            signal.throwIfAborted();
            const audio = await download();
            signal.throwIfAborted();
            return audio;
          }, legacyVideoTitle, lyricScript, videoTargets, saveDirectoryArtist);
          if (result.status === 'saved' || result.status === 'lyrics-added') local?.invalidate();
          return { ...result, ...(result.audio && !result.lyrics && lyricsIssue ? { lyricsIssue } : {}),
            ...(result.status === 'saved' && videoSource?.coverIssue ? { coverIssue: videoSource.coverIssue } : {}) };
        }
        let body: Buffer, filename: string;
        if (mode === 'mp3' && bilibiliVideos) {
          const download = await bilibiliVideos.mp3(id, signal);
          body = download.body;
          filename = `${songTitleStem(download.track.title)}.mp3`;
        } else ({ body, filename } = await songZip(catalog, id, signal, lyricScript));
        const extension = mode === 'mp3' ? 'mp3' : 'zip';
        const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
        return reply.type(mode === 'mp3' ? 'audio/mpeg' : 'application/zip').header('X-Content-Type-Options', 'nosniff')
          .header('Content-Disposition', `attachment; filename="tinytune-song.${extension}"; filename*=UTF-8''${encoded}`).send(body);
      });
    } finally { workDone = true; release(); }
  });

  if (options.developmentRoot) {
    const [{ default: middie }, { createServer: createViteServer }] = await Promise.all([
      import('@fastify/middie'),
      import('vite'),
    ]);
    await app.register(middie);
    const vite = await createViteServer({
      root: options.developmentRoot,
      appType: 'mpa',
      // Let Node --watch own config restarts instead of Vite replacing its server in place.
      configLoader: 'native',
      server: {
        middlewareMode: true,
        ws: { server: app.server },
        cors: false,
        watch: { ignored: ['**/vite.config.ts', '**/.env*'] },
      },
    });
    app.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      let path: string;
      try {
        path = decodeURI(request.url?.split('?', 1)[0] ?? '/');
      } catch {
        return next();
      }
      // Match Fastify's decoding of unreserved URL characters before excluding server routes.
      if (path === '/api' || path.startsWith('/api/') || path === '/local-assets/ruantang.ttf') return next();
      vite.middlewares(request, response, next);
    });
    // Close upgraded HMR connections before Fastify closes the HTTP listener.
    app.addHook('preClose', () => vite.close());
  } else if (options.staticRoot) {
    await app.register(fastifyStatic, {
      root: options.staticRoot,
      prefix: '/',
      index: ['index.html'],
    });
  }

  return app;
}

async function main() {
  const production = process.env.NODE_ENV === 'production';
  const root = fileURLToPath(new URL('..', import.meta.url));
  const projectRoot = resolve(root, production ? '..' : '.');
  const workspaceRoot = resolve(projectRoot, '../..');
  const app = await createServer({
    logger: true,
    localLibraryRoot: process.env.TINYTUNE_AUDIO_LIBRARY,
    localFontPath: resolve(workspaceRoot, '.local/fonts/ruantang.ttf'),
    ...(production ? { staticRoot: resolve(root, 'public') } : { developmentRoot: root }),
  });
  try {
    const address = await app.listen({
      host: '127.0.0.1',
      port: Number(process.env.PORT ?? (production ? 9120 : 9117)),
    });
    console.log(`TINYTUNE 访问地址：${new URL('/', address).href}`);
  } catch (error) {
    await app.close();
    throw error;
  }
  const close = () => { void app.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
