import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { MusicSources } from './providers';
import { isMbid, MusicSources as DefaultMusicSources, UpstreamError } from './providers';
import type { Track } from './types';

type Sources = Pick<MusicSources, 'artists' | 'recordings' | 'collect'>;
type ServerOptions = { sources?: Sources; developmentRoot?: string; staticRoot?: string; logger?: boolean };

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
  const retryAt = error instanceof UpstreamError ? error.retryAt : undefined;
  const message = error instanceof UpstreamError ? error.message : '采集失败，请重试。';
  if (retryAt) reply.header('Retry-After', String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))));
  return reply.code(retryAt ? 429 : 502).send({ error: message, retryAt });
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
  const sources = options.sources ?? new DefaultMusicSources();

  app.get('/api/catalog', async (request, reply) => {
    const params = new URL(request.url, 'http://127.0.0.1').searchParams;
    const query = params.get('q')?.trim();
    const artistId = params.get('artist');
    const context = requestSignal(request, reply);
    try {
      if (query && !artistId && query.length <= 120) {
        return { artists: await sources.artists(query, context.signal) };
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
    await app.listen({
      host: '127.0.0.1',
      port: Number(process.env.PORT ?? (production ? 9120 : 9117)),
    });
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
