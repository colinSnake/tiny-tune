import type { SongProvider, SongSummary } from '../src/song-types';

export type Failure = { message: string; retryAt?: number };
export class RequestFailure extends Error {
  constructor(message: string, readonly retryAt?: number) { super(message); }
}
export async function checked(response: Response) {
  if (response.ok) return response;
  const payload = await response.json().catch(() => null) as { error?: unknown; retryAt?: unknown } | null;
  throw new RequestFailure(typeof payload?.error === 'string' ? payload.error : '请求未完成，请稍后重试。',
    typeof payload?.retryAt === 'number' && Number.isFinite(payload.retryAt) ? payload.retryAt : undefined);
}
export const failure = (error: unknown): Failure => error instanceof RequestFailure ? { message: error.message, retryAt: error.retryAt } : { message: '连接失败，请检查网络后重试。' };

export type SourceResult = { provider: SongProvider } & (
  | { state: 'pending' }
  | { state: 'done'; tracks: SongSummary[] }
  | { state: 'failed'; error: Failure }
);

export class SongSearchRequest {
  private readonly request = new AbortController();
  private results: SourceResult[];
  private started = false;
  constructor(readonly query: string, providers: readonly SongProvider[], private readonly publish: (results: readonly SourceResult[]) => void,
    private readonly fetcher: (url: string, init: { signal: AbortSignal }) => Promise<Response> = (url, init) => fetch(url, init)) {
    this.results = [...new Set(providers)].map(provider => ({ provider, state: 'pending' }));
  }

  get pending() { return this.results.some(source => source.state === 'pending'); }

  start() {
    if (this.started || this.request.signal.aborted) return;
    this.started = true;
    this.publish(this.results);
    for (const { provider } of this.results) void this.load(provider);
  }

  setProviders(providers: readonly SongProvider[]) {
    if (this.request.signal.aborted) return;
    const added: SongProvider[] = [];
    this.results = [...new Set(providers)].map(provider => {
      const existing = this.results.find(result => result.provider === provider);
      if (existing) return existing;
      added.push(provider);
      return { provider, state: 'pending' };
    });
    if (!this.started) return;
    this.publish(this.results);
    for (const provider of added) void this.load(provider);
  }

  retry(provider: SongProvider) {
    if (this.request.signal.aborted) return;
    const source = this.results.find(result => result.provider === provider);
    if (source?.state !== 'failed' || (source.error.retryAt ?? 0) > Date.now()) return;
    this.update({ provider, state: 'pending' });
    void this.load(provider);
  }

  cancel() { this.request.abort(); }

  private update(next: SourceResult) {
    if (this.request.signal.aborted || !this.results.some(result => result.provider === next.provider)) return;
    this.results = this.results.map(result => result.provider === next.provider ? next : result);
    this.publish(this.results);
  }

  private async load(provider: SongProvider) {
    const signal = this.request.signal;
    try {
      const params = new URLSearchParams({ q: this.query, source: provider });
      const response = await checked(await this.fetcher(`/api/songs?${params}`, { signal }));
      const { tracks } = await response.json() as { tracks: SongSummary[] };
      if (!Array.isArray(tracks)) throw new RequestFailure('搜索接口没有返回有效的结果。');
      this.update({ provider, state: 'done', tracks });
    } catch (error) {
      this.update({ provider, state: 'failed', error: failure(error) });
    }
  }
}
