import { useEffect, useMemo, useRef, useState } from 'react';
import { exactArtist, mergeTracks } from '../src/collection';
import { candidateResult } from '../src/match';
import type { LocalLibrarySearch, LocalLyricsLookup, LocalTrack, TimingLookup } from '../src/local-library-types';
import { songProviders, type SongAvailability, type SongCatalogStatus, type SongDetail, type SongSummary } from '../src/song-types';
import type { Artist, ItemState, Track, TrackPage } from '../src/types';
import { localSearchTerms, workspaceRows, type WorkspaceRow } from '../src/workbench';
import { checked, failure, SongSearchRequest, type SourceResult } from './song-requests';
import { songKey, trackPath } from './song-downloads';

export async function jsonRequest<T>(url: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await checked(await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(url.endsWith('/save') ? 150_000 : 30_000)]) : AbortSignal.timeout(url.endsWith('/save') ? 150_000 : 30_000),
    ...(body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }));
  return response.json() as Promise<T>;
}
export type WorkbenchDetail = { key: string; track: Track; result: ItemState; local?: LocalTrack; song?: SongDetail; timing?: TimingLookup; findingTiming?: boolean };
export function rowTrack(row: WorkspaceRow): Track {
  return row.kind === 'song' ? { ...row.track, duration: row.track.duration || null, albums: row.track.album ? [row.track.album] : [] } : row.track;
}
export async function fetchDetail(row: WorkspaceRow, signal: AbortSignal, version?: SongSummary, onReady?: (detail: WorkbenchDetail) => void,
  searchTiming = false): Promise<WorkbenchDetail> {
  if (row.kind === 'song') {
    const { track: song } = await jsonRequest<{ track: SongDetail }>(trackPath(version ?? row.track), signal);
    const track: Track = { ...song, id: songKey(song), duration: song.duration || null, albums: song.album ? [song.album] : [] };
    let result: ItemState = song.lyrics ? candidateResult({ id: Number(song.id) || -1, title: song.title, artist: song.artist,
      album: song.album, duration: song.duration || null, instrumental: false, synced: song.lyrics.kind === 'timed' ? song.lyrics.text : '',
      plain: song.lyrics.kind === 'plain' ? song.lyrics.text : '' }) : { status: 'missing' };
    const lookup = song.lyricIdentity ?? song;
    if (!song.lyrics && lookup.title && lookup.artist) {
      onReady?.({ key: row.key, track, song, result: { status: 'running' } });
      try { result = (await jsonRequest<{ result: ItemState }>(`${trackPath(song)}/lyrics`, signal, {})).result; }
      catch (error) { signal.throwIfAborted(); result = { status: 'error', message: failure(error).message }; }
    }
    return { key: row.key, track, song, result };
  }
  if (row.kind === 'local') {
    const response = await jsonRequest<LocalLyricsLookup>(`/api/local-library/${row.track.id}/lyrics`, signal, searchTiming ? { searchTiming } : {});
    return { ...response, key: row.key, local: response.track };
  }
  const response = await jsonRequest<{ track: Track; result: ItemState }>('/api/lyrics', signal, row.track);
  return { ...response, key: row.key };
}

export function useWorkbench() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [local, setLocal] = useState<LocalTrack[]>([]);
  const [root, setRoot] = useState('');
  const [localEnabled, setLocalEnabled] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [catalog, setCatalog] = useState<Track[]>([]);
  const [artist, setArtist] = useState<Artist>();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [next, setNext] = useState<number | null>(null);
  const [availability, setAvailability] = useState<ReadonlyMap<string, SongAvailability>>(new Map());
  const [sources, setSources] = useState<readonly SourceResult[]>([]);
  const [sourceError, setSourceError] = useState('');
  const [statusReady, setStatusReady] = useState(false);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const known = useRef<SongCatalogStatus | undefined>(undefined);
  const searchTask = useRef<AbortController | undefined>(undefined);
  const localTask = useRef<AbortController | undefined>(undefined);
  const songSearch = useRef<SongSearchRequest | undefined>(undefined);
  const catalogTask = useRef<AbortController | undefined>(undefined);
  const [selection, setSelection] = useState<{ key: string; autoPlay: boolean }>();
  const selectedKey = selection?.key ?? '';
  const autoPlayPending = useRef(false);
  const [versions, setVersions] = useState<ReadonlyMap<string, SongSummary>>(new Map());
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [detail, setDetail] = useState<WorkbenchDetail>();
  const cache = useRef(new Map<string, WorkbenchDetail>());
  const songs = useMemo(() => sources.flatMap(source => source.state === 'done' ? source.tracks : []), [sources]);
  const rows = useMemo(() => workspaceRows(local, catalog, songs, submitted, availability), [local, catalog, songs, submitted, availability]);
  const selected = rows.find(row => row.key === selectedKey);
  const version = versions.get(selectedKey);
  const rowsRef = useRef(rows); rowsRef.current = rows;

  useEffect(() => {
    const task = new AbortController();
    setSourceError(''); setStatusReady(false);
    void jsonRequest<SongCatalogStatus>('/api/songs/status', task.signal).then(status => {
      if (task.signal.aborted) return;
      if (!Array.isArray(status.sources) || status.sources.some(source => !songProviders.includes(source))) throw new Error('来源列表无效');
      known.current = status; setStatusReady(true); songSearch.current?.setProviders(status.sources);
    }).catch(error => { if (!task.signal.aborted) { setSourceError(`在线来源：${failure(error).message}`); setStatusReady(true); } });
    return () => task.abort();
  }, [statusAttempt]);
  useEffect(() => {
    const task = new AbortController();
    void jsonRequest<LocalLibrarySearch>('/api/local-library', task.signal).then(data => {
      if (!task.signal.aborted) { setRoot(data.root ?? ''); setLocalEnabled(data.enabled); }
    }).catch(() => undefined);
    return () => task.abort();
  }, []);
  useEffect(() => () => { searchTask.current?.abort(); localTask.current?.abort(); catalogTask.current?.abort(); songSearch.current?.cancel(); }, []);

  async function findLocal(names: string[], search: AbortController) {
    localTask.current?.abort();
    const task = new AbortController(); localTask.current = task; setLocalBusy(true); setLocalError('');
    try {
      const params = new URLSearchParams(localSearchTerms(names).map(name => ['q', name]));
      const data = await jsonRequest<LocalLibrarySearch>(`/api/local-library?${params}`, AbortSignal.any([search.signal, task.signal]));
      if (task.signal.aborted || search.signal.aborted) return;
      setLocal(data.tracks); setRoot(data.root ?? ''); setLocalEnabled(data.enabled);
      if (data.limited) setLocalError('结果较多，仅显示前一部分；可输入更完整的歌手或歌名。');
    } catch (error) { if (!search.signal.aborted && !task.signal.aborted) setLocalError(`本地曲库：${failure(error).message}`); }
    finally { if (localTask.current === task && !search.signal.aborted) setLocalBusy(false); }
  }
  async function loadArtist(target: Artist, offset: number, search: AbortController) {
    catalogTask.current?.abort(); const task = new AbortController(); catalogTask.current = task;
    setCatalogBusy(true); setCatalogError('');
    if (!offset) { setCatalog([]); setNext(null); }
    setArtist(target); setArtists([]);
    try {
      const page = await jsonRequest<TrackPage>(`/api/catalog?artist=${target.id}&offset=${offset}`, AbortSignal.any([search.signal, task.signal]));
      if (search.signal.aborted || task.signal.aborted) return;
      setCatalog(current => offset ? mergeTracks(current, page.tracks) : page.tracks); setNext(page.next);
    } catch (error) { if (!task.signal.aborted && !search.signal.aborted) setCatalogError(`歌手曲目：${failure(error).message}`); }
    finally { if (catalogTask.current === task && !search.signal.aborted) setCatalogBusy(false); }
  }
  function search(text = query) {
    const term = text.trim(); if (!term) return;
    searchTask.current?.abort(); localTask.current?.abort(); catalogTask.current?.abort(); songSearch.current?.cancel();
    const task = new AbortController(); searchTask.current = task;
    setSubmitted(term); setAvailability(new Map()); setLocal([]); setCatalog([]); setArtist(undefined); setArtists([]); setCatalogError('');
    autoPlayPending.current = true;
    setSelection(undefined); setVersions(new Map()); setDetail(undefined); setNext(null); cache.current.clear();
    void findLocal([term], task);
    const request = new SongSearchRequest(term, known.current?.sources ?? [], results => { if (!task.signal.aborted) setSources(results); });
    songSearch.current = request; request.start();
    setCatalogBusy(true);
    void jsonRequest<{ artists: Artist[] }>(`/api/catalog?q=${encodeURIComponent(term)}`, task.signal).then(async data => {
      if (task.signal.aborted) return;
      const match = exactArtist(term, data.artists) ?? (data.artists.length === 1 ? data.artists[0] : undefined);
      if (match) { void findLocal([...new Set([term, match.name, ...match.aliases])], task); await loadArtist(match, 0, task); }
      else { setArtists(data.artists.slice(0, 5)); setCatalogBusy(false); }
    }).catch(error => { if (!task.signal.aborted) { setCatalogError(`歌手目录：${failure(error).message}`); setCatalogBusy(false); } });
  }
  const searching = !!submitted && (localBusy || catalogBusy || !statusReady || sources.some(source => source.state === 'pending'));
  useEffect(() => {
    const first = rows[0];
    if (selectedKey || localBusy || !first) return;
    // Local results rank first; for remote-only results, wait for artist resolution so it cannot reorder an in-flight selection.
    if (catalogBusy && first.kind !== 'local') return;
    const autoPlay = autoPlayPending.current;
    autoPlayPending.current = false;
    setSelection(current => current ?? { key: first.key, autoPlay });
  }, [rows, selectedKey, localBusy, catalogBusy]);
  useEffect(() => {
    const row = rowsRef.current.find(item => item.key === selectedKey);
    if (!row) { setDetail(undefined); return; }
    const task = new AbortController();
    const cacheKey = version ? `${row.key}/${songKey(version)}` : row.key;
    const remembered = cache.current.get(cacheKey);
    if (remembered && !detailAttempt) { setDetail(remembered); return; }
    const localPlain = remembered?.local?.lyricsKind === 'plain' && remembered.result.status === 'plain' ? remembered : undefined;
    setDetail(localPlain ? { ...localPlain, timing: undefined, findingTiming: true }
      : { key: row.key, track: rowTrack(row), result: { status: 'running' }, ...(row.kind === 'local' ? { local: row.track } : {}) });
    const publish = (data: WorkbenchDetail) => {
      if (task.signal.aborted) return;
      setDetail(data);
      if (data.song) {
        const song = data.song;
        setAvailability(current => current.get(songKey(song)) === song.availability ? current : new Map(current).set(songKey(song), song.availability));
      }
    };
    void fetchDetail(row, task.signal, version, publish, !!localPlain).then(data => {
      if (!task.signal.aborted) { if (data.result.status !== 'error') cache.current.set(cacheKey, data); publish(data); }
    }).catch(error => {
      if (!task.signal.aborted) setDetail(localPlain ? { ...localPlain, timing: { status: 'error', message: failure(error).message } }
        : { key: row.key, track: rowTrack(row), ...(row.kind === 'local' ? { local: row.track } : {}), result: { status: 'error', message: failure(error).message } });
    });
    return () => task.abort();
  }, [selectedKey, version, detailAttempt]);

  return { query, setQuery, submitted, rows, selected, autoPlay: selection?.autoPlay ?? false, detail, version, versions, root, localEnabled, localBusy, localError, artist, artists, next,
    catalogBusy, catalogError, sources, sourceError, searching, cache,
    search, select: (row: WorkspaceRow) => { autoPlayPending.current = false; setDetailAttempt(0); setSelection({ key: row.key, autoPlay: false }); },
    chooseVersion: (song: SongSummary) => { setDetailAttempt(0); setVersions(current => new Map(current).set(selectedKey, song)); },
    retryDetail: () => setDetailAttempt(n => n + 1), retryStatus: () => setStatusAttempt(n => n + 1),
    retrySource: (source: SourceResult) => songSearch.current?.retry(source.provider),
    chooseArtist: (target: Artist) => { const task = searchTask.current; if (task) { setSelection(undefined); setDetail(undefined); setVersions(new Map()); cache.current.clear(); void findLocal([submitted, target.name, ...target.aliases], task); void loadArtist(target, 0, task); } },
    loadMore: () => { if (artist && next !== null && searchTask.current && !catalogBusy) void loadArtist(artist, next, searchTask.current); },
    markLocalSaved: (ids: ReadonlySet<string>) => {
      if (!ids.size) return;
      setLocal(current => current.map(track => ids.has(track.id) ? { ...track, hasLyrics: true, lyricsKind: 'timed' } : track));
      for (const [key, value] of cache.current) if (value.local && ids.has(value.local.id)) cache.current.delete(key);
      if (ids.has(selectedKey)) setDetailAttempt(n => n + 1);
    },
  };
}
export type WorkbenchState = ReturnType<typeof useWorkbench>;
