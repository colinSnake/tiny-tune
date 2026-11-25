import { useEffect, useRef, useState, type FormEvent } from 'react';
import { exactArtist, localSavePlan, lyricQueryTargets, mergeTracks, restoreCanceled } from '../src/collection';
import { demoArtist, demoResults, demoTracks } from '../src/demo';
import { createArchive, exportEntries } from '../src/export';
import { formatTime } from '../src/lrc';
import type { Artist, ItemState, LyricResult, Track, TrackPage } from '../src/types';
import { Preview } from './preview';
import { useAudioLibrary } from './audio-library';
import { LibraryControls } from './audio-panel';
import { download, Icon, Status, statusLabels } from './ui';
import { LoadingRows } from './loading';
import { LocalSaveDialog } from './local-save';
import { localBatchLimit, type LocalLibrarySearch, type LocalSaveResult, type LocalTrack } from '../src/local-library-types';

const pending: ItemState = { status: 'pending' };
class RequestError extends Error {
  constructor(message: string, readonly retryAt?: number) { super(message); }
}
const message = (error: unknown) => {
  const text = error instanceof Error ? error.message : '操作失败，请重试。';
  const seconds = error instanceof RequestError && error.retryAt ? Math.ceil((error.retryAt - Date.now()) / 1000) : 0;
  return seconds > 0 ? `${text}（${seconds} 秒后重试）` : text;
};
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const header = res.headers.get('Retry-After');
    const seconds = header && /^\d+$/.test(header) ? Number(header) : NaN;
    const retryAt = Number.isSafeInteger(seconds) ? Date.now() + seconds * 1000
      : typeof json?.retryAt === 'number' && Number.isFinite(json.retryAt) ? json.retryAt : undefined;
    throw new RequestError(typeof json?.error === 'string' ? json.error : `请求失败（HTTP ${res.status}）`, retryAt);
  }
  return json as T;
}

export default function LocalLyrics() {
  const library = useAudioLibrary();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [searchError, setSearchError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [retryClock, setRetryClock] = useState(0);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - retryClock) / 1000));
  const composing = useRef(false);
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [artist, setArtist] = useState<Artist>();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);
  const [localRoot, setLocalRoot] = useState('');
  const [localNotice, setLocalNotice] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [savePlan, setSavePlan] = useState<ReturnType<typeof localSavePlan>>();
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveResults, setSaveResults] = useState<LocalSaveResult[]>();
  const [saveError, setSaveError] = useState('');
  const localTask = useRef<AbortController>(null);
  const [next, setNext] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, ItemState>>({});
  const [focus, setFocus] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState<'artist' | 'tracks' | ''>('');
  const [notice, setNotice] = useState('');
  const [zipBusy, setZipBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; running: boolean; stopped: boolean }>();
  const catalogTask = useRef<AbortController>(null);
  const matchTask = useRef<AbortController>(null);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const [demo, setDemo] = useState(false);
  const localById = new Map(localTracks.map(track => [track.id, track]));
  const items = [...localTracks, ...tracks].map(track => {
    const saved = localById.has(track.id) ? undefined : library.lyrics.get(track.id);
    return { track: saved && !track.albums.length ? { ...track, albums: saved.track.albums, isrcs: saved.track.isrcs } : track,
      result: results[track.id] ?? saved?.result ?? pending };
  });
  const visible = items.filter(item => filter === 'all' || item.result.status === filter);
  const checked = visible.filter(({ track }) => selection.has(track.id)).length;
  const focused = items.find(item => item.track.id === focus);
  const selected = items.filter(item => selection.has(item.track.id));
  const downloadable = selected.filter(item => item.result.status === 'timed' || item.result.status === 'plain').length;
  const errors = (selected.length ? selected : visible).filter(item => item.result.status === 'error').map(item => item.track);
  const queryTargets = lyricQueryTargets(items, visible, selected);
  const readyToSelect = visible.filter(({ result }) => result.status === 'timed' || result.status === 'plain').map(({ track }) => track.id);

  useEffect(() => () => { catalogTask.current?.abort(); localTask.current?.abort(); matchTask.current?.abort(); }, []);
  useEffect(() => {
    if (!retryAt) return;
    let timer: number;
    const update = () => {
      const now = Date.now();
      setRetryClock(now);
      const remaining = retryAt - now;
      if (remaining > 0) timer = window.setTimeout(update, remaining % 1000 || 1000);
    };
    update();
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  useEffect(() => { if (allCheckbox.current) allCheckbox.current.indeterminate = checked > 0 && checked < visible.length; }, [checked, visible.length]);
  useEffect(() => {
    if (!localLoading && ![...localTracks, ...tracks].some(track => track.id === focus)) {
      setFocus(localTracks[0]?.id ?? tracks[0]?.id ?? '');
    }
  }, [localLoading, localTracks, tracks, focus]);

  function resetCatalog() {
    matchTask.current?.abort(); matchTask.current = null;
    setTracks([]); setNext(null); setTotal(0); setResults({}); setSelection(new Set());
    setFocus(''); setFilter('all'); setProgress(undefined); setConfirmed(new Set());
    setSavePlan(undefined); setSaveResults(undefined); setSaveError('');
  }
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (!composing.current && loading !== 'artist' && !saveBusy) void findArtists(query.trim());
  }
  async function findLocal(names: string[]) {
    localTask.current?.abort();
    const task = new AbortController(); localTask.current = task;
    setLocalLoading(true); setLocalNotice('');
    const params = new URLSearchParams([...new Set(names.filter(name => name && name.length <= 120))].slice(0, 12).map(name => ['q', name]));
    try {
      const data = await request<LocalLibrarySearch>(`/api/local-library?${params}`, { signal: task.signal });
      if (task.signal.aborted) return;
      setLocalRoot(data.root ?? '');
      setLocalTracks(data.tracks);
      if (data.limited) setLocalNotice('本地曲库只展示前一批结果；曲库较大或有目录无法读取。');
      if (data.tracks.length) setFocus(current => current || data.tracks[0].id);
    } catch (error) { if (!task.signal.aborted) setLocalNotice(message(error)); }
    finally { if (localTask.current === task) setLocalLoading(false); }
  }
  async function findArtists(q: string) {
    if (!q || saveBusy) return;
    catalogTask.current?.abort();
    resetCatalog(); setArtist(undefined); setDemo(false); setLocalTracks([]);
    void findLocal([q]);
    const task = new AbortController(); catalogTask.current = task;
    setSubmitted(q); setArtists(null); setSearchError(''); setNotice(''); setLoading('artist');
    if (Date.now() < retryAt) { setLoading(''); setSearchError('在线曲库限流中；仍可查看本地结果。'); return; }
    try {
      const data = await request<{ artists: Artist[] }>(`/api/catalog?q=${encodeURIComponent(q)}`, { signal: task.signal });
      if (task.signal.aborted) return;
      setArtists(data.artists);
      const target = exactArtist(q, data.artists);
      if (target) void load(target);
    } catch (error) {
      if (!task.signal.aborted) {
        setRetryClock(Date.now());
        setRetryAt(error instanceof RequestError ? error.retryAt ?? 0 : 0);
        setSearchError(error instanceof Error ? error.message : message(error));
      }
    } finally { if (catalogTask.current === task) setLoading(''); }
  }
  async function load(target: Artist, offset = 0) {
    if (saveBusy) return;
    catalogTask.current?.abort();
    const task = new AbortController(); catalogTask.current = task;
    if (!offset) {
      resetCatalog(); setLocalTracks([]);
      void findLocal([target.name, ...target.aliases]);
      setArtist(target); setDemo(false);
    }
    setNotice(''); setLoading('tracks');
    try {
      const page = await request<TrackPage>(`/api/catalog?artist=${encodeURIComponent(target.id)}&offset=${offset}`, { signal: task.signal });
      if (task.signal.aborted) return;
      const additions = page.tracks.map(track => ({ ...track, artist: track.artist || target.name }));
      setTracks(previous => mergeTracks(previous, additions));
      setTotal(page.total); setNext(page.next);
      if (!offset) setFocus(current => current || additions[0]?.id || '');
    } catch (error) { if (!task.signal.aborted) setNotice(message(error)); }
    finally { if (catalogTask.current === task) setLoading(''); }
  }
  function sample() {
    catalogTask.current?.abort(); catalogTask.current = null;
    localTask.current?.abort(); localTask.current = null; setLocalTracks([]); setLocalNotice(''); setLocalLoading(false);
    resetCatalog(); setQuery(''); setSubmitted(''); setSearchError(''); setLoading(''); setNotice(''); setArtists(null); setArtist(demoArtist); setDemo(true);
    setTracks(demoTracks); setResults(demoResults); setTotal(demoTracks.length);
    setFocus(demoTracks[0].id);
  }
  function toggle(ids: string[], enabled: boolean) {
    setSelection(old => {
      const current = new Set(old);
      for (const id of ids) { if (enabled) current.add(id); else current.delete(id); }
      return current;
    });
  }
  function setResult(id: string, result: ItemState) { setResults(old => ({ ...old, [id]: result })); }
  function selectTrack(track: Track, state: ItemState) {
    setFocus(track.id);
    if (state.status === 'pending') void match([track], false);
    if (window.matchMedia('(max-width: 800px)').matches) document.getElementById('preview-title')?.scrollIntoView({ block: 'start' });
  }
  function confirm(track: Track, result: LyricResult, manually = false) {
    setResult(track.id, result);
    if (localById.has(track.id)) {
      setConfirmed(current => {
        const next = new Set(current); if (manually) next.add(track.id); else next.delete(track.id); return next;
      });
    } else if ('candidate' in result) library.rememberLyrics(track, result);
  }
  async function match(targets: Track[], batch = true) {
    if (!targets.length || matchTask.current) return;
    targets = targets.slice(0, localBatchLimit);
    const task = new AbortController(); matchTask.current = task;
    if (batch) setNotice('');
    if (batch) setProgress({ done: 0, total: targets.length, running: true, stopped: false });
    let done = 0;
    try {
      for (const track of targets) {
        if (task.signal.aborted) break;
        setResult(track.id, { status: 'running' });
        try {
          const isLocal = localById.has(track.id);
          const response = demo ? { track, result: demoResults[track.id] } : await request<{ track: Track; result: LyricResult }>(
            isLocal ? `/api/local-library/${track.id}/lyrics` : '/api/lyrics', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(isLocal ? {} : track), signal: task.signal,
            });
          if (task.signal.aborted) break;
          if (!isLocal) setTracks(current => current.map(row => row.id === track.id ? response.track : row));
          confirm(response.track, response.result);
        } catch (error) {
          if (task.signal.aborted) break;
          setResult(track.id, { status: 'error', message: message(error) });
          if (error instanceof RequestError && error.retryAt && error.retryAt > Date.now()) {
            setNotice(message(error)); done++; break;
          }
        }
        done++;
        if (batch) setProgress({ done, total: targets.length, running: true, stopped: false });
      }
    } finally {
      if (matchTask.current === task) {
        matchTask.current = null;
        if (task.signal.aborted) setResults(current => restoreCanceled(current, results));
        if (batch) setProgress({ done, total: targets.length, running: false, stopped: task.signal.aborted });
      }
    }
  }
  function downloadManifest() {
    const data = exportEntries(selected.length ? selected : items).manifest;
    download('manifest.json', new Blob([JSON.stringify({ ...data, artist, tracks: data.tracks.map(track => ({ ...track, file: null })) }, null, 2) + '\n'], { type: 'application/json' }));
  }
  async function downloadZip() {
    setZipBusy(true); setNotice('');
    try {
      const data = exportEntries(selected, localById);
      const zip = await createArchive(data);
      download('tinytune-lyrics.zip', new Blob([zip], { type: 'application/zip' }));
    } catch (error) { setNotice(message(error)); }
    finally { setZipBusy(false); }
  }

  function openSave() {
    setSaveResults(undefined); setSaveError('');
    setSavePlan(localSavePlan(selected, localById, confirmed));
  }
  async function saveSelection() {
    if (!savePlan?.ready.length || saveBusy) return;
    const saved: LocalSaveResult[] = [];
    setSaveBusy(true); setSaveError('');
    try {
      for (let start = 0; start < savePlan.ready.length; start += localBatchLimit) {
        const result = await request<{ results: LocalSaveResult[] }>('/api/local-library/save', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tracks: savePlan.ready.slice(start, start + localBatchLimit).map(row => row.choice) }),
        });
        saved.push(...result.results);
      }
    } catch (error) {
      setSaveError(message(error));
      if (saved.length) {
        const complete = new Set(saved.map(row => row.id));
        for (const row of savePlan.ready) if (!complete.has(row.track.id)) saved.push({ id: row.track.id, status: 'error' });
      }
    } finally {
      if (saved.length) {
        setSaveResults(saved);
        const complete = new Set(saved.filter(row => row.status === 'saved' || row.status === 'exists').map(row => row.id));
        setLocalTracks(current => current.map(track => complete.has(track.id) ? { ...track, hasLyrics: true } : track));
      }
      setSaveBusy(false);
    }
  }

  const matching = items.some(item => item.result.status === 'running') || !!progress?.running;
  const singleArtist = artists && exactArtist(submitted, artists);
  return <div className="local-lyrics-content">
    <div className="local-lyrics-search">
      <form className="search-form" onSubmit={submitSearch} role="search" aria-label="搜索歌手">
        <label className="search-input"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} type="search" maxLength={120}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          aria-label="歌手名称" placeholder="输入歌手名或别名" required /></label>
        <button type="submit" className="button primary" disabled={!query.trim() || saveBusy} aria-disabled={loading === 'artist' || undefined}>搜索歌手<Icon name="arrow" size={16} /></button>
      </form>
      <div className="hero-meta"><span>搜歌手 → 查歌词 → 勾选后保存或导出</span><button className="demo-button" type="button" onClick={sample}><Icon name="play" size={14} />试用合成样例</button></div>
    </div>

    <section className="search-results" aria-label="歌手搜索结果">
      {loading === 'artist' ? <div className="panel local-lyrics-loading"><LoadingRows count={2} label={`正在查找「${submitted}」…`} /></div>
        : searchError ? <div className="search-feedback search-retry">
          <div role="status"><strong>{searchError}</strong>
            {retryAt > 0 && <p>{retrySeconds > 0 ? <><span className="retry-clock" aria-hidden="true">{retrySeconds} 秒后可重试</span>
              <span className="sr-only">等候结束后可重试。</span></> : '现在可以重试。'}</p>}
          </div>
          <button type="button" className="button ghost" disabled={retrySeconds > 0}
            onClick={() => { setQuery(submitted); void findArtists(submitted); }}>重试搜索</button>
        </div>
        : artists && !artists.length ? <p className="search-feedback" role="status">在线曲库未找到「{submitted}」，可试试别名或查看下面的本地结果。</p>
        : singleArtist ? <p className="search-feedback compact" role="status"><Icon name="record" size={16} /> 已找到 <strong>{singleArtist.name}</strong></p>
        : !!artists?.length && <div className="artist-results">
          <div className="section-label">选择歌手 <span>{artists.length} 位</span></div>
          <div className="artist-options">{artists.map(option => <button type="button" key={option.id} aria-pressed={option.id === artist?.id}
            className="artist-option" onClick={() => void load(option)}>
            <span><strong>{option.name}</strong><small>{[option.area, option.hint, ...option.aliases.slice(0, 2)].filter(Boolean).join(' · ') || '暂无歌手详情'}</small></span><Icon name="arrow" size={16} />
          </button>)}</div>
        </div>}
    </section>
    {!demo && <div className="local-library-note">
      {localRoot && <p><strong>本地曲库</strong> <span>{localRoot}</span></p>}
      {localLoading && <p role="status">正在查找本地歌曲…</p>}
      {localNotice && <p role="status">{localNotice}</p>}
      {!localLoading && <details><summary>可选：导入其他试听文件</summary><LibraryControls library={library} /></details>}
    </div>}
    {notice && <p className="alert" role="alert">{notice}</p>}

    <div className="workspace">
      <section className="panel collection" aria-labelledby="collection-title">
        <div className="panel-top"><h3 id="collection-title"><span>01</span> 歌曲列表</h3>
          {(artist || !!localTracks.length) && <p>{!!localTracks.length && `本地 ${localTracks.length} 首`}{artist && `${localTracks.length ? ' · ' : ''}${artist.name} · ${tracks.length} / ${total} 曲`}</p>}
        </div>
        {!artist && !localTracks.length ? <div className="empty"><span className="empty-icon"><Icon name="list" size={24} /></span><p>搜索歌手后，在这里选择录音。</p></div> : <>
          {!!items.length && <div className="collection-tools">
            <label className="check-label"><input ref={allCheckbox} type="checkbox" checked={visible.length > 0 && checked === visible.length}
              disabled={!visible.length} onChange={e => toggle(visible.map(({ track }) => track.id), e.target.checked)} />已选 {selection.size} 曲</label>
            <select aria-label="按歌词状态筛选" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
            {progress?.running ? <button type="button" className="button ghost" onClick={() => matchTask.current?.abort()}>停止查询</button>
              : <button type="button" className="button primary" onClick={() => void match(queryTargets)} disabled={!queryTargets.length || matching}>查询歌词{queryTargets.length ? ` · ${Math.min(queryTargets.length, localBatchLimit)} 首` : ''}</button>}
            <button type="button" className="button ghost" disabled={!readyToSelect.length} onClick={() => setSelection(new Set(readyToSelect))}>勾选有歌词</button>
          </div>}
          {progress && <div className="progress-row" role="status"><progress value={progress.done} max={progress.total} />
            <span>{progress.stopped ? '已停止' : progress.running ? '匹配中' : '已处理'} {progress.done} / {progress.total}</span></div>}
          {!loading && !items.length && <div className="list-note">{notice && artist ? <button type="button" className="button ghost" onClick={() => void load(artist)}>重试加载曲目</button> : '暂无收录曲目。'}</div>}
          {!!items.length && !visible.length && <p className="list-note">没有符合筛选的曲目。</p>}
          {!!items.length && <p className="list-hint">点曲名查单首、试听对时。不勾选时查询当前列表，勾选后只查询所选歌曲（每批最多 50 首）。</p>}
          <ul className="track-list">{visible.map(({ track: t, result }) => <li key={t.id} className={focus === t.id ? 'active-track' : ''}>
            <input type="checkbox" checked={selection.has(t.id)} onChange={e => toggle([t.id], e.target.checked)} aria-label={`勾选 ${t.title}`} />
            <button className="track-button" type="button" onClick={() => selectTrack(t, result)} aria-current={focus === t.id ? 'true' : undefined}>
              <span><strong>{t.title}</strong><small>{[t.artist, localById.has(t.id) ? localById.get(t.id)?.file : t.albums[0] || '专辑待核对', t.duration !== null ? formatTime(t.duration) : '时长未知'].filter(Boolean).join(' · ')}</small></span>
              {!demo && <span className="local-track-badge">{localById.get(t.id)?.hasLyrics ? '本地 · 已有歌词' : localById.has(t.id) ? '本地' : '在线'}</span>}
              <Status result={result} />
            </button>
          </li>)}</ul>
          {loading === 'tracks' && <LoadingRows count={tracks.length ? 2 : 3} label={tracks.length ? '正在加载更多曲目…' : '正在加载曲目…'} />}
          {(next !== null || errors.length > 0) && <div className="more-row">
            {next !== null && <button type="button" className="button ghost" onClick={() => { if (artist) void load(artist, next); }} disabled={loading === 'tracks'}>{loading === 'tracks' ? '加载中…' : '加载更多曲目'}</button>}
            {!!errors.length && <button type="button" className="button ghost" onClick={() => void match(errors)} disabled={matching}>重试失败的 {errors.length} 曲</button>}
          </div>}
          <footer className="export-bar local-export-bar">
            {localRoot && !demo && <button type="button" className="button primary" onClick={openSave} disabled={!selection.size || saveBusy}>
              <Icon name="download" size={16} />保存到本地曲库</button>}
            <button type="button" className="button ghost" onClick={downloadManifest} disabled={!items.length}>导出曲目清单</button>
            <button type="button" className={localRoot && !demo ? 'button ghost' : 'button primary'} onClick={downloadZip} disabled={!downloadable || zipBusy}><Icon name="download" size={16} />{zipBusy ? '打包中…' : `导出 ZIP${downloadable ? ` · ${downloadable} 曲` : ''}`}</button>
          </footer>
        </>}
      </section>
      <section className="panel preview" aria-labelledby="preview-title">
        <div className="panel-top"><h3 id="preview-title"><span>02</span> 播放与歌词</h3></div>
        {focused ? <Preview key={focused.track.id} localRecording={localById.get(focused.track.id)} item={focused} library={library} recordings={items.map(item => item.track)} matching={matching}
          onMatch={() => void match([focused.track], false)} onConfirm={result => confirm(focused.track, result, true)} />
          : <div className="empty"><span className="empty-icon"><Icon name="wave" size={24} /></span><p>选择录音后，在这里配对音源和歌词。</p></div>}
      </section>
    </div>
    {savePlan && localRoot && <LocalSaveDialog root={localRoot} plan={savePlan} busy={saveBusy} results={saveResults} error={saveError}
      onSave={() => void saveSelection()} onDismiss={() => { if (!saveBusy) setSavePlan(undefined); }} />}
    <p className="local-lyrics-source">曲目：本地曲库与 MusicBrainz · 歌词：LRCLIB</p>
  </div>;
}
