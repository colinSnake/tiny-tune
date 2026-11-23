import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { MusicSources } from './providers';
import { isMbid, MusicSources as DefaultMusicSources, UpstreamError } from './providers';
import type { Artist, Track } from './types';
import { isSongId, JamendoCatalog, songSourceError, songZip, type SongCatalog } from './songs';
import { PublishedCatalog } from './published-songs';
import { LyricsCatalog } from './lyrics-catalog';
import { rankSongs, songProviders, songProviderLabels, type SongProvider } from './song-types';

type Sources = Pick<MusicSources, 'artists' | 'recordings' | 'collect'>;
type ServerOptions = {
  sources?: Sources; songs?: SongCatalog; publishedSongs?: SongCatalog | false; lyricSongs?: SongCatalog | false; songDownloadTimeout?: number;
  developmentRoot?: string; staticRoot?: string; logger?: boolean;
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

export async function createServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const defaultSources = new DefaultMusicSources();
  const sources = options.sources ?? defaultSources;
  const artistSearches = new Map<string, { artists: Artist[]; expiresAt: number }>();

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

  const songs = options.songs ?? new JamendoCatalog({
    clientId: process.env.JAMENDO_CLIENT_ID,
    allowBundles: process.env.JAMENDO_BUNDLE_AUTHORIZED === '1',
    approvedTrackHashes: Object.fromEntries((process.env.JAMENDO_APPROVED_MP3_SHA256 ?? '').split(',').map(entry => entry.trim().split(':', 2))),
  });
  const publishedSongs = options.publishedSongs ?? (options.songs ? false : new PublishedCatalog());
  // Explicit fixtures must opt into independent sources; the normal server shares LRCLIB's queue with local matching.
  const lyricSongs = options.lyricSongs ?? (options.songs || options.publishedSongs !== undefined || options.sources
    ? false : new LyricsCatalog(defaultSources));
  const catalogs: Record<SongProvider, SongCatalog | false> = { artist: publishedSongs, jamendo: songs, lrclib: lyricSongs };
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

  app.get('/api/songs/status', async (_request, reply) => reply.header('Cache-Control', 'no-store').send({
    ...songs.status(), featured: !!publishedSongs, sources: searchSources(),
  }));
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
    if (!isSongId(id)) return badInput(reply, '无效的录音 ID。');
    const catalog = getSongCatalog(provider);
    if (!catalog) return reply.code(404).send({ error: '录音来源未启用。' });
    return withSongRequest(request, reply, 18_000, async signal => ({ track: (await catalog.detail(id, signal)).track }));
  });
  app.post<{ Params: { provider: string; id: string } }>('/api/songs/:provider/:id/download', { bodyLimit: 1024 }, async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== `${request.protocol}://${request.host}`) return reply.code(403).send();
    const { id, provider } = request.params;
    if (!isSongId(id)) return badInput(reply, '无效的录音 ID。');
    const catalog = getSongCatalog(provider);
    if (!catalog) return reply.code(404).send({ error: '录音来源未启用。' });
    if (provider === 'lrclib') return reply.code(409).send({ error: '该结果只有歌词，没有可下载的同版本音频。' });
    if (activeDownloads >= 2) {
      reply.header('Retry-After', '3');
      return reply.code(429).send({ error: '正在准备其他整曲下载，请稍后再试。', retryAt: Date.now() + 3000 });
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
      return await withSongRequest(request, reply, options.songDownloadTimeout ?? 60_000, async signal => {
        const { body, filename } = await songZip(catalog, id, signal);
        const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
        return reply.type('application/zip').header('X-Content-Type-Options', 'nosniff')
          .header('Content-Disposition', `attachment; filename="tinytune-song.zip"; filename*=UTF-8''${encoded}`).send(body);
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
      // Match Fastify's decoding of unreserved URL characters before excluding API requests.
      if (path === '/api' || path.startsWith('/api/')) return next();
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
  const app = await createServer({
    logger: true,
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
