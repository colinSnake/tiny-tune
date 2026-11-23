import { useEffect, useRef, useState, type FormEvent } from 'react';
import { mergeTracks, restoreCanceled } from '../src/collection';
import { demoArtist, demoResults, demoTracks } from '../src/demo';
import { createArchive, exportEntries } from '../src/export';
import { formatTime } from '../src/lrc';
import type { Artist, ItemState, LyricResult, Track, TrackPage } from '../src/types';
import { Preview } from './preview';
import { download, Icon, Status, statusLabels } from './ui';

const pending: ItemState = { status: 'pending' };
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const retry = typeof json?.retryAt === 'number' ? `（${Math.max(1, Math.ceil((json.retryAt - Date.now()) / 1000))} 秒后重试）` : '';
    throw new Error((json?.error || `请求失败（HTTP ${res.status}）`) + retry);
  }
  return json as T;
}

export default function Workbench() {
  const [query, setQuery] = useState('');
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
  const visible = tracks.filter(track => filter === 'all' || (results[track.id] ?? pending).status === filter);
  const checked = visible.filter(track => selection.has(track.id)).length;
  const items = tracks.map(track => ({ track, result: results[track.id] ?? pending }));
  const focused = items.find(item => item.track.id === focus);
  const selected = items.filter(item => selection.has(item.track.id));
  const downloadable = selected.filter(item => item.result.status === 'timed' || item.result.status === 'plain').length;
  const errors = selected.filter(item => item.result.status === 'error').map(item => item.track);
  const unprocessed = selected.filter(item => item.result.status === 'pending').map(item => item.track);

  useEffect(() => () => { catalogTask.current?.abort(); matchTask.current?.abort(); }, []);
  useEffect(() => { if (allCheckbox.current) allCheckbox.current.indeterminate = checked > 0 && checked < visible.length; }, [checked, visible.length]);

  function resetCatalog() {
    matchTask.current?.abort(); matchTask.current = null;
    setTracks([]); setNext(null); setTotal(0); setResults({}); setSelection(new Set());
    setFocus(''); setFilter('all'); setProgress(undefined);
  }
  async function findArtists(event: FormEvent) {
    event.preventDefault();
    const q = query.trim(); if (!q) return;
    catalogTask.current?.abort();
    const task = new AbortController(); catalogTask.current = task;
    resetCatalog(); setArtist(undefined); setArtists(null); setDemo(false); setNotice(''); setLoading('artist');
    try {
      const data = await request<{ artists: Artist[] }>(`/api/catalog?q=${encodeURIComponent(q)}`, { signal: task.signal });
      if (!task.signal.aborted) setArtists(data.artists);
    } catch (error) { if (!task.signal.aborted) setNotice(message(error)); }
    finally { if (catalogTask.current === task) setLoading(''); }
  }
  async function load(target: Artist, offset = 0) {
    catalogTask.current?.abort();
    const task = new AbortController(); catalogTask.current = task;
    if (!offset) { resetCatalog(); setArtist(target); }
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
    resetCatalog(); setQuery(''); setLoading(''); setNotice(''); setArtists(null); setArtist(demoArtist); setDemo(true);
    setTracks(demoTracks); setTotal(demoTracks.length); setSelection(new Set(demoTracks.map(track => track.id)));
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
  async function match(targets: Track[]) {
    if (!targets.length || matchTask.current) return;
    const task = new AbortController(); matchTask.current = task;
    setNotice('');
    setProgress({ done: 0, total: targets.length, running: true, stopped: false });
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
          setResult(track.id, response.result);
        } catch (error) {
          if (task.signal.aborted) break;
          setResult(track.id, { status: 'error', message: message(error) });
        }
        done++;
        setProgress({ done, total: targets.length, running: true, stopped: false });
      }
    } finally {
      if (matchTask.current === task) {
        matchTask.current = null;
        if (task.signal.aborted) setResults(current => restoreCanceled(current, results));
        setProgress({ done, total: targets.length, running: false, stopped: task.signal.aborted });
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

  return <>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="/" aria-label="Tinytune 歌词工作台"><span className="brand-icon"><Icon name="wave" size={20} /></span><span className="brand-wordmark">Tinytune <small>歌词工作台</small></span></a>
      <span className="local-tag"><i /> 本地工具</span>
    </div></header>
    <main className="shell">
      <section className="hero" aria-labelledby="title">
        <div className="hero-art" aria-hidden="true" />
        <h1 id="title">为音乐<span>找回歌词</span></h1>
        <form className="search-form" onSubmit={findArtists}>
          <label className="search-input"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} type="search" maxLength={120}
            aria-label="歌手名称" placeholder="输入歌手名" required /></label>
          <button type="submit" className="button primary" disabled={!query.trim() || loading === 'artist'}>{loading === 'artist' ? '搜索中…' : '搜索歌手'}<Icon name="arrow" size={16} /></button>
        </form>
        <button className="demo-button" type="button" onClick={sample}><Icon name="play" size={14} />试用合成样例</button>
      </section>

      {notice && <p className="alert" role="alert">{notice}</p>}
      {artists && <section className="artist-results" aria-label="歌手候选">
        <div className="section-label">歌手候选 <span>{artists.length}</span></div>
        {!artists.length && <p>未找到歌手，试试别名或原文。</p>}
        <div className="artist-options">{artists.map(option => <button type="button" key={option.id} aria-pressed={option.id === artist?.id}
          className="artist-option" onClick={() => load(option)}>
          <span><strong>{option.name}</strong><small>{[option.area, option.hint, ...option.aliases.slice(0, 2)].filter(Boolean).join(' · ') || option.id}</small></span><Icon name="arrow" size={16} />
        </button>)}</div>
      </section>}

      <div className="workspace">
        <section className="panel collection" aria-labelledby="collection-title">
          <div className="panel-top"><h2 id="collection-title">曲目与匹配</h2>
            {artist && <p>{artist.name} · {tracks.length} / {total} 曲</p>}
          </div>
          {!artist ? <div className="empty"><span className="empty-icon"><Icon name="list" size={24} /></span><p>先搜索歌手</p></div> : <>
            {!!tracks.length && <div className="collection-tools">
              <label className="check-label"><input ref={allCheckbox} type="checkbox" checked={visible.length > 0 && checked === visible.length}
                disabled={!visible.length} onChange={e => toggle(visible.map(t => t.id), e.target.checked)} />已选 {selection.size} 曲</label>
              <select aria-label="按歌词状态筛选" value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
              {progress?.running ? <button type="button" className="button ghost" onClick={() => matchTask.current?.abort()}>停止匹配</button>
                : <button type="button" className="button primary" onClick={() => match(unprocessed)} disabled={!unprocessed.length}>匹配已选曲目</button>}
            </div>}
            {progress && <div className="progress-row" role="status"><progress value={progress.done} max={progress.total} />
              <span>{progress.stopped ? '已停止' : progress.running ? '匹配中' : '已处理'} {progress.done} / {progress.total}</span></div>}
            {loading === 'tracks' && !tracks.length && <p className="list-note" role="status">正在加载曲目…</p>}
            {!loading && !tracks.length && <p className="list-note">{notice ? '曲目加载失败，请重新选择歌手。' : '暂无收录曲目。'}</p>}
            {!!tracks.length && !visible.length && <p className="list-note">没有符合筛选的曲目。</p>}
            <ul className="track-list">{visible.map(t => <li key={t.id} className={focus === t.id ? 'active-track' : ''}>
              <input type="checkbox" checked={selection.has(t.id)} onChange={e => toggle([t.id], e.target.checked)} aria-label={`勾选 ${t.title}`} />
              <button className="track-button" type="button" onClick={() => setFocus(t.id)} aria-current={focus === t.id ? 'true' : undefined}>
                <span><strong>{t.title}</strong><small>{[t.artist, t.albums[0], formatTime(t.duration)].filter(Boolean).join(' · ')}</small></span>
                <Status result={results[t.id] ?? pending} />
              </button>
            </li>)}</ul>
            {(next !== null || errors.length > 0) && <div className="more-row">
              {next !== null && <button type="button" className="button ghost" onClick={() => load(artist, next)} disabled={loading === 'tracks'}>{loading === 'tracks' ? '加载中…' : '加载更多曲目'}</button>}
              {!!errors.length && <button type="button" className="button ghost" onClick={() => match(errors)} disabled={progress?.running}>重试失败的 {errors.length} 曲</button>}
            </div>}
            <footer className="export-bar"><button type="button" className="button ghost" onClick={downloadManifest} disabled={!items.length}>导出曲目清单</button>
              <button type="button" className="button primary" onClick={downloadZip} disabled={!downloadable || zipBusy}><Icon name="download" size={16} />{zipBusy ? '打包中…' : `导出 ZIP${downloadable ? ` · ${downloadable} 曲` : ''}`}</button>
            </footer>
          </>}
        </section>
        <section className="panel preview" aria-labelledby="preview-title">
          <div className="panel-top"><h2 id="preview-title">歌词预览</h2></div>
          {focused ? <Preview key={focused.track.id} item={focused} onConfirm={result => setResult(focused.track.id, result)} />
            : <div className="empty"><span className="empty-icon"><Icon name="wave" size={24} /></span><p>选择曲目查看歌词</p></div>}
        </section>
      </div>
      <footer className="site-footer"><span>曲目：MusicBrainz · 歌词：LRCLIB</span><span>仅保存有权使用的歌词</span></footer>
    </main>
  </>;
}
