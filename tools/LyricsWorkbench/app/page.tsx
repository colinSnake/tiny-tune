import { useEffect, useRef, useState, type FormEvent } from 'react';
import { exactArtist, mergeTracks, restoreCanceled } from '../src/collection';
import { demoArtist, demoResults, demoTracks } from '../src/demo';
import { createArchive, exportEntries } from '../src/export';
import { formatTime } from '../src/lrc';
import type { Artist, ItemState, LyricResult, Track, TrackPage } from '../src/types';
import { Preview } from './preview';
import { useAudioLibrary } from './audio-library';
import { LibraryControls } from './audio-panel';
import { download, Icon, Status, statusLabels } from './ui';
import { LoadingRows } from './loading';

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
  const items = tracks.map(track => {
    const saved = library.lyrics.get(track.id);
    return { track: saved && !track.albums.length ? { ...track, albums: saved.track.albums, isrcs: saved.track.isrcs } : track,
      result: results[track.id] ?? saved?.result ?? pending };
  });
  const visible = items.filter(item => filter === 'all' || item.result.status === filter).map(item => item.track);
  const checked = visible.filter(track => selection.has(track.id)).length;
  const focused = items.find(item => item.track.id === focus);
  const selected = items.filter(item => selection.has(item.track.id));
  const downloadable = selected.filter(item => item.result.status === 'timed' || item.result.status === 'plain').length;
  const errors = selected.filter(item => item.result.status === 'error').map(item => item.track);
  const unprocessed = selected.filter(item => item.result.status === 'pending').map(item => item.track);

  useEffect(() => () => { catalogTask.current?.abort(); matchTask.current?.abort(); }, []);
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

  function resetCatalog() {
    matchTask.current?.abort(); matchTask.current = null;
    setTracks([]); setNext(null); setTotal(0); setResults({}); setSelection(new Set());
    setFocus(''); setFilter('all'); setProgress(undefined);
  }
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (!composing.current && loading !== 'artist') void findArtists(query.trim());
  }
  async function findArtists(q: string) {
    if (!q || Date.now() < retryAt) return;
    catalogTask.current?.abort();
    const task = new AbortController(); catalogTask.current = task;
    setSubmitted(q); setArtists(null); setSearchError(''); setNotice(''); setLoading('artist');
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
    catalogTask.current?.abort();
    const task = new AbortController(); catalogTask.current = task;
    if (!offset) { resetCatalog(); setArtist(target); setDemo(false); }
    setNotice(''); setLoading('tracks');
    try {
      const page = await request<TrackPage>(`/api/catalog?artist=${encodeURIComponent(target.id)}&offset=${offset}`, { signal: task.signal });
      if (task.signal.aborted) return;
      const additions = page.tracks.map(track => ({ ...track, artist: track.artist || target.name }));
      setTracks(previous => mergeTracks(previous, additions));
      setTotal(page.total); setNext(page.next);
      if (!offset) setFocus(additions[0]?.id ?? '');
    } catch (error) { if (!task.signal.aborted) setNotice(message(error)); }
    finally { if (catalogTask.current === task) setLoading(''); }
  }
  function sample() {
    catalogTask.current?.abort(); catalogTask.current = null;
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
  function confirm(track: Track, result: LyricResult) {
    setResult(track.id, result);
    if ('candidate' in result) library.rememberLyrics(track, result);
  }
  async function match(targets: Track[], batch = true) {
    if (!targets.length || matchTask.current || !library.ready) return;
    const task = new AbortController(); matchTask.current = task;
    if (batch) setNotice('');
    if (batch) setProgress({ done: 0, total: targets.length, running: true, stopped: false });
    let done = 0;
    try {
      for (const track of targets) {
        if (task.signal.aborted) break;
        setResult(track.id, { status: 'running' });
        try {
          const response = demo ? { track, result: demoResults[track.id] } : await request<{ track: Track; result: LyricResult }>('/api/lyrics', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(track), signal: task.signal,
          });
          if (task.signal.aborted) break;
          setTracks(current => current.map(row => row.id === track.id ? response.track : row));
          confirm(response.track, response.result);
        } catch (error) {
          if (task.signal.aborted) break;
          setResult(track.id, { status: 'error', message: message(error) });
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
      const data = exportEntries(selected);
      const zip = await createArchive(data);
      download('tinytune-lyrics.zip', new Blob([zip], { type: 'application/zip' }));
    } catch (error) { setNotice(message(error)); }
    finally { setZipBusy(false); }
  }

  const matching = items.some(item => item.result.status === 'running') || !!progress?.running;
  const singleArtist = artists && exactArtist(submitted, artists);
  return <div className="local-lyrics-content">
    <div className="local-lyrics-search">
      <form className="search-form" onSubmit={submitSearch} role="search" aria-label="搜索歌手">
        <label className="search-input"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} type="search" maxLength={120}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          aria-label="歌手名称" placeholder="输入歌手名或别名" required /></label>
        <button type="submit" className="button primary" disabled={!query.trim() || retrySeconds > 0} aria-disabled={loading === 'artist' || undefined}>搜索歌手<Icon name="arrow" size={16} /></button>
      </form>
      <div className="hero-meta"><span><kbd>Enter</kbd> 搜索</span><button className="demo-button" type="button" onClick={sample}><Icon name="play" size={14} />试用合成样例</button></div>
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
        : artists && !artists.length ? <p className="search-feedback" role="status">没有找到「{submitted}」，试试别名或原文拼写。</p>
        : singleArtist ? <p className="search-feedback compact" role="status"><Icon name="record" size={16} /> 已找到 <strong>{singleArtist.name}</strong></p>
        : !!artists?.length && <div className="artist-results">
          <div className="section-label">选择歌手 <span>{artists.length} 位</span></div>
          <div className="artist-options">{artists.map(option => <button type="button" key={option.id} aria-pressed={option.id === artist?.id}
            className="artist-option" onClick={() => void load(option)}>
            <span><strong>{option.name}</strong><small>{[option.area, option.hint, ...option.aliases.slice(0, 2)].filter(Boolean).join(' · ') || '暂无歌手详情'}</small></span><Icon name="arrow" size={16} />
          </button>)}</div>
        </div>}
    </section>
    <LibraryControls library={library} />
    {notice && <p className="alert" role="alert">{notice}</p>}

    <div className="workspace">
      <section className="panel collection" aria-labelledby="collection-title">
        <div className="panel-top"><h3 id="collection-title"><span>01</span> 录音列表</h3>
          {artist && <p>{artist.name} · {tracks.length} / {total} 曲</p>}
        </div>
        {!artist ? <div className="empty"><span className="empty-icon"><Icon name="list" size={24} /></span><p>搜索歌手后，在这里选择录音。</p></div> : <>
          {!!tracks.length && <div className="collection-tools">
            <label className="check-label"><input ref={allCheckbox} type="checkbox" checked={visible.length > 0 && checked === visible.length}
              disabled={!visible.length} onChange={e => toggle(visible.map(t => t.id), e.target.checked)} />已选 {selection.size} 曲</label>
            <select aria-label="按歌词状态筛选" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
            {progress?.running ? <button type="button" className="button ghost" onClick={() => matchTask.current?.abort()}>停止匹配</button>
              : <button type="button" className="button primary" onClick={() => match(unprocessed)} disabled={!unprocessed.length || matching || !library.ready}>批量匹配歌词</button>}
          </div>}
          {progress && <div className="progress-row" role="status"><progress value={progress.done} max={progress.total} />
            <span>{progress.stopped ? '已停止' : progress.running ? '匹配中' : '已处理'} {progress.done} / {progress.total}</span></div>}
          {!loading && !tracks.length && <div className="list-note">{notice ? <button type="button" className="button ghost" onClick={() => void load(artist)}>重试加载曲目</button> : '暂无收录曲目。'}</div>}
          {!!tracks.length && !visible.length && <p className="list-note">没有符合筛选的曲目。</p>}
          {!!tracks.length && <p className="list-hint">点曲名查歌词和试听 · 勾选仅用于批量处理</p>}
          <ul className="track-list">{visible.map(t => <li key={t.id} className={focus === t.id ? 'active-track' : ''}>
            <input type="checkbox" checked={selection.has(t.id)} onChange={e => toggle([t.id], e.target.checked)} aria-label={`勾选 ${t.title}`} />
            <button className="track-button" type="button" onClick={() => selectTrack(t, results[t.id] ?? library.lyrics.get(t.id)?.result ?? pending)} aria-current={focus === t.id ? 'true' : undefined}>
              <span><strong>{t.title}</strong><small>{[t.artist, t.albums[0] || '专辑待核对', t.duration !== null ? formatTime(t.duration) : '时长未知'].filter(Boolean).join(' · ')}</small></span>
              <Status result={results[t.id] ?? library.lyrics.get(t.id)?.result ?? pending} />
            </button>
          </li>)}</ul>
          {loading === 'tracks' && <LoadingRows count={tracks.length ? 2 : 3} label={tracks.length ? '正在加载更多曲目…' : '正在加载曲目…'} />}
          {(next !== null || errors.length > 0) && <div className="more-row">
            {next !== null && <button type="button" className="button ghost" onClick={() => load(artist, next)} disabled={loading === 'tracks'}>{loading === 'tracks' ? '加载中…' : '加载更多曲目'}</button>}
            {!!errors.length && <button type="button" className="button ghost" onClick={() => match(errors)} disabled={matching || !library.ready}>重试失败的 {errors.length} 曲</button>}
          </div>}
          <footer className="export-bar"><button type="button" className="button ghost" onClick={downloadManifest} disabled={!items.length}>导出曲目清单</button>
            <button type="button" className="button primary" onClick={downloadZip} disabled={!downloadable || zipBusy}><Icon name="download" size={16} />{zipBusy ? '打包中…' : `导出 ZIP${downloadable ? ` · ${downloadable} 曲` : ''}`}</button>
          </footer>
        </>}
      </section>
      <section className="panel preview" aria-labelledby="preview-title">
        <div className="panel-top"><h3 id="preview-title"><span>02</span> 播放与歌词</h3></div>
        {focused ? <Preview key={focused.track.id} item={focused} library={library} recordings={items.map(item => item.track)} matching={matching}
          onMatch={() => void match([focused.track], false)} onConfirm={result => confirm(focused.track, result)} />
          : <div className="empty"><span className="empty-icon"><Icon name="wave" size={24} /></span><p>选择录音后，在这里配对音源和歌词。</p></div>}
      </section>
    </div>
    <p className="local-lyrics-source">曲目：MusicBrainz · 歌词：LRCLIB</p>
  </div>;
}
