import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { lrcFilename } from '../src/export';
import { activeIndex, formatTime, parseLrc } from '../src/lrc';
import { pickAutomaticSong, rankSongs, songProviderLabels, songProviders, type SongAvailability, type SongCatalogStatus, type SongDetail, type SongProvider, type SongSummary } from '../src/song-types';
import { checked, failure, RequestFailure, SongSearchRequest, type Failure, type SourceResult } from './song-requests';
import { download, Icon } from './ui';
import { LoadingRecording, LoadingRows } from './loading';

const LocalLyrics = lazy(() => import('./page'));
const defaultProviders = ['artist', 'lrclib'] as const;

const availabilityLabels: Record<SongAvailability, string> = {
  ready: '可下载', 'stream-only': '仅试听', 'missing-lyrics': '缺歌词', review: '待核对', 'lyrics-only': '仅歌词',
};
const unavailable: Record<Exclude<SongAvailability, 'ready'>, string> = {
  'stream-only': '来源未开放这版录音的整曲下载。',
  'missing-lyrics': '曲库未提供这版录音的歌词，不会用其他版本拼凑。',
  review: '这版录音的授权、音源或歌词时码尚未核对，暂不生成下载包。',
  'lyrics-only': '当前只找到歌词，没有可下载的同版本音频。',
};

const trackPath = (track: SongSummary) => `/api/songs/${track.provider}/${encodeURIComponent(track.id)}`;
const songKey = (track: SongSummary) => `${track.provider}:${track.id}`;
const sourceName = (track: SongSummary) => songProviderLabels[track.provider];

type DownloadState = { item: SongSummary; from: 'results' | 'detail' } & (
  | { state: 'pending' | 'saved' }
  | { state: 'failed'; error: Failure }
);

function RequestNote({ error, onRetry, retryLabel = '重试' }: { error: Failure; onRetry: () => void; retryLabel?: string }) {
  const [now, setNow] = useState(Date.now);
  const at = error.retryAt;
  useEffect(() => {
    if (!at) return;
    setNow(Date.now());
    if (at <= Date.now()) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= at) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [at]);
  const wait = at ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
  return <div className="song-notice"><p role="status">{error.message}</p>
    <button type="button" className="button ghost" onClick={onRetry} disabled={wait > 0} aria-label={wait ? `${retryLabel}（${wait} 秒后可用）` : retryLabel}>{wait ? `${wait} 秒后可重试` : retryLabel}</button>
  </div>;
}

function DownloadNote({ job, onCancel, onRetry }: { job: DownloadState; onCancel: () => void; onRetry: () => void }) {
  if (job.state === 'failed') return <RequestNote error={{ ...job.error, message: `「${job.item.title}」：${job.error.message}` }} retryLabel="重试下载" onRetry={onRetry} />;
  return <div className="song-download-note"><p role="status">
    {job.state === 'pending' ? <><span className="search-spinner" aria-hidden="true" /> 正在准备「{job.item.title}」的下载包</>
      : <><Icon name="download" size={16} /> 已发起「{job.item.title}」的下载。解压后请将 MP3 与同名 LRC 放在一起。</>}
  </p>{job.state === 'pending' && <button type="button" className="button ghost" onClick={onCancel}>取消下载</button>}</div>;
}

function TrackPlayer({ track, children }: { track: SongDetail; children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLButtonElement>(null);
  const [time, setTime] = useState(0);
  const [audioError, setAudioError] = useState(false);
  const parsed = useMemo(() => track.lyrics?.kind === 'timed' ? parseLrc(track.lyrics.text) : null, [track.lyrics]);
  const playable = !!track.previewUrl && !audioError;
  const index = parsed && playable ? activeIndex(parsed.cues, time) : -1;
  useEffect(() => {
    const box = scroller.current, cue = current.current;
    if (!box || !cue || box.contains(document.activeElement)) return;
    const boxRect = box.getBoundingClientRect(), cueRect = cue.getBoundingClientRect();
    if (cueRect.bottom > boxRect.bottom || cueRect.top < boxRect.top) {
      box.scrollTop += cueRect.top - boxRect.top - (box.clientHeight - cueRect.height) / 2;
    }
  }, [index]);
  return <>
    {track.availability !== 'lyrics-only' && <div className="song-playback">
      {track.previewUrl ? <audio ref={audio} controls controlsList="nodownload" preload="metadata" src={track.previewUrl} aria-label={`${track.title}试听`}
        onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onSeeked={e => setTime(e.currentTarget.currentTime)}
        onError={() => setAudioError(true)} /> : <p>这版录音没有可用的试听地址。</p>}
      {audioError && <p role="status">试听连接失败，可以再试一次，或打开下方的录音来源。</p>}
    </div>}
    {children}
    <div className="song-lyrics">
      <div className="song-lyrics-heading"><h3><Icon name="list" size={17} /> 歌词</h3>
        <span>{parsed ? playable ? '随播放定位' : '来源时码 · 未与音频匹配' : track.lyrics ? '纯文本 · 无时码' : '暂无可用歌词'}</span></div>
      {parsed ? <div className="song-cues" ref={scroller} tabIndex={0} aria-label="时码歌词">
        {parsed.cues.map((cue, i) => {
          if (cue.lines.length === 0) return null;
          const line = <><time>{formatTime(cue.ms / 1000)}</time><span>{cue.lines.join('\n')}</span></>;
          return playable ? <button key={cue.ms} type="button" className="song-cue" aria-current={index === i ? 'true' : undefined}
            ref={index === i ? current : undefined}
            onClick={() => { if (audio.current) { audio.current.currentTime = cue.ms / 1000; setTime(cue.ms / 1000); } }}>{line}</button>
            : <div key={cue.ms} className="song-cue">{line}</div>;
        })}
      </div> : track.lyrics ? <div className="song-cues plain" tabIndex={0} aria-label="纯文本歌词">{track.lyrics.text}</div>
        : <p className="song-no-lyrics">没有可用于这版录音的歌词。</p>}
    </div>
  </>;
}

export default function SongDownload({ showLocalLyrics }: { showLocalLyrics: boolean }) {
  const [localLyricsLoaded, setLocalLyricsLoaded] = useState(showLocalLyrics);
  const localLyrics = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (showLocalLyrics) localLyrics.current?.scrollIntoView({ block: 'start' });
  }, [showLocalLyrics]);

  function openLocalLyrics(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const tools = localLyrics.current;
    if (!tools) return;
    event.preventDefault();
    const { hash } = event.currentTarget;
    if (location.hash !== hash) history.pushState(history.state, '', hash);
    tools.open = true;
    setLocalLyricsLoaded(true);
    tools.querySelector('summary')?.focus({ preventScroll: true });
    tools.scrollIntoView({ block: 'start' });
  }

  const [catalog, setCatalog] = useState<SongCatalogStatus | null>(null);
  const [catalogError, setCatalogError] = useState<Failure | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const knownProviders = useRef<SongProvider[] | null>(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [sourceResults, setSourceResults] = useState<readonly SourceResult[]>([]);
  const [selected, setSelected] = useState<SongSummary | null>(null);
  const [track, setTrack] = useState<SongDetail | null>(null);
  const [availability, setAvailability] = useState<Record<string, SongAvailability>>({});
  const [detailError, setDetailError] = useState<Failure | null>(null);
  const [job, setJob] = useState<DownloadState | null>(null);
  const composing = useRef(false);
  const searchRequest = useRef<SongSearchRequest | null>(null);
  const searchInteracted = useRef(false);
  const detailRequest = useRef<AbortController | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const discovering = !!submitted && !catalog && !catalogError;
  const pending = sourceResults.filter(source => source.state === 'pending');
  const searching = discovering || pending.length > 0;
  const failed = sourceResults.filter(source => source.state === 'failed');
  const tracks = useMemo(() => rankSongs(sourceResults.flatMap(source => source.state === 'done' ? source.tracks : [])
    .map(item => availability[songKey(item)] ? { ...item, availability: availability[songKey(item)] } : item), submitted),
  [sourceResults, submitted, availability]);
  const ready = tracks.filter(item => item.availability === 'ready').length;
  const onlyLyrics = tracks.every(item => item.availability === 'lyrics-only');
  const searchingSameTerm = searching && submitted === query.trim();
  const downloadInDetail = !!(job?.from === 'detail' && track && songKey(track) === songKey(job.item));

  useEffect(() => {
    const status = new AbortController();
    const deadline = AbortSignal.timeout(6000);
    fetch('/api/songs/status', { signal: AbortSignal.any([status.signal, deadline]) }).then(checked).then(r => r.json()).then((data: SongCatalogStatus) => {
      if (status.signal.aborted) return;
      if (!Array.isArray(data.sources) || !data.sources.every(source => songProviders.includes(source))) {
        throw new RequestFailure('无法确认可用曲库，请重试。');
      }
      knownProviders.current = data.sources;
      setCatalog(data);
      searchRequest.current?.setProviders(data.sources);
    }).catch(error => {
      if (status.signal.aborted) return;
      setCatalogError(deadline.aborted ? { message: '确认可用曲库超时，请重试。' } : failure(error));
    });
    return () => status.abort();
  }, [catalogAttempt]);

  useEffect(() => () => { searchRequest.current?.cancel(); detailRequest.current?.abort(); downloadRequest.current?.abort(); }, []);

  function retryCatalog() {
    setCatalogError(null);
    setCatalogAttempt(attempt => attempt + 1);
  }

  function cancelDownload() {
    downloadRequest.current?.abort();
    downloadRequest.current = null;
    setJob(null);
  }

  function search(text: string) {
    const term = text.trim();
    if (!term || (searchRequest.current?.query === term && searchRequest.current.pending)) return;
    searchRequest.current?.cancel();
    detailRequest.current?.abort();
    searchInteracted.current = false;
    setSubmitted(term); setSelected(null); setTrack(null); setAvailability({}); setDetailError(null);
    setJob(current => current?.state === 'saved' ? null : current);
    const providers = knownProviders.current ?? defaultProviders;
    const request = new SongSearchRequest(term, providers, results => {
      setSourceResults(results);
      // A failed or pending source could still contain another version. Wait until all finish.
      if (searchInteracted.current || !knownProviders.current || !results.every(result => result.state === 'done')) return;
      const match = pickAutomaticSong(results.flatMap(result => result.tracks), term);
      if (match) void select(match, false);
    });
    searchRequest.current = request;
    request.start();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composing.current) search(query);
  }

  async function select(item: SongSummary, manual = true) {
    if (manual) searchInteracted.current = true;
    detailRequest.current?.abort();
    const request = new AbortController();
    detailRequest.current = request;
    setSelected(item); setTrack(null); setDetailError(null);
    if (manual && window.matchMedia('(max-width: 800px)').matches) heading.current?.focus();
    try {
      const response = await checked(await fetch(trackPath(item), { signal: request.signal }));
      const result = (await response.json() as { track: SongDetail }).track;
      if (!request.signal.aborted) {
        setTrack(result);
        setAvailability(before => ({ ...before, [songKey(result)]: result.availability }));
      }
    } catch (error) {
      if (!request.signal.aborted) setDetailError(failure(error));
    }
  }

  async function saveTrack(item: SongSummary, from: DownloadState['from']) {
    if (item.availability !== 'ready' || downloadRequest.current) return;
    if (job?.state === 'failed' && songKey(job.item) === songKey(item) && (job.error.retryAt ?? 0) > Date.now()) return;
    searchInteracted.current = true;
    const request = new AbortController();
    downloadRequest.current = request;
    setJob({ item, from, state: 'pending' });
    try {
      const response = await checked(await fetch(`${trackPath(item)}/download`, { method: 'POST', signal: request.signal }));
      if (response.headers.get('content-type')?.split(';')[0] !== 'application/zip') throw new RequestFailure('服务端未返回整曲下载包。');
      const zip = await response.blob();
      if (request.signal.aborted) return;
      const name = `${lrcFilename(`${item.artist} - ${item.title}`).slice(0, -4)}.zip`;
      download(name, zip);
      setJob({ item, from, state: 'saved' });
    } catch (error) {
      if (!request.signal.aborted) setJob({ item, from, state: 'failed', error: failure(error) });
    } finally {
      if (downloadRequest.current === request) downloadRequest.current = null;
    }
  }

  const downloadDisabled = (item: SongSummary) => job?.state === 'pending' ||
    (job?.state === 'failed' && songKey(job.item) === songKey(item));
  const downloadFeedback = job && <DownloadNote job={job} onCancel={cancelDownload} onRetry={() => void saveTrack(job.item, job.from)} />;

  return <>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="/" aria-label="TINYTUNE 首页">
        <span className="brand-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24"><use href="/icon.svg?v=3#brand-note" width="24" height="24" /></svg></span>
        <span className="brand-wordmark">TINYTUNE <small>音乐工作台</small></span>
      </a>
      <a className="song-tools-link" href="#local-lyrics" onClick={openLocalLyrics}><Icon name="list" size={15} /> 给本地音乐补歌词 <Icon name="arrow" size={14} /></a>
    </div></header>
    <main className="shell song-shell">
      <section className="hero song-hero" aria-labelledby="song-title">
        <div className="hero-art" aria-hidden="true" />
        <div className="hero-content">
          <p className="eyebrow"><span className="song-kicker-dot" /> TINYTUNE / 音乐下载</p>
          <h1 id="song-title">找一首歌，<span>把歌词一起带走。</span></h1>
          <p className="hero-description">按歌名或歌手搜索。可下载的版本直接打包；仅收录歌词的结果也可以在这里查看。</p>
          <form className="search-form song-search" onSubmit={submit} role="search" aria-label="搜索歌曲">
            <label className="search-input"><Icon name="search" /><input type="search" aria-label="歌名或歌手" placeholder="输入歌名或歌手" value={query} maxLength={120} required
              onChange={e => setQuery(e.target.value)} onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }} /></label>
            <button type="submit" className="button primary" disabled={searchingSameTerm}>搜索歌曲</button>
          </form>
          <div className="song-hero-meta"><span><i /> ZIP 内含 MP3、同名 LRC 与来源清单</span>
            {catalog?.featured && <button className="text-button" type="button" onClick={() => { setQuery('Code Monkey'); search('Code Monkey'); }}>试搜 Code Monkey <Icon name="arrow" size={13} /></button>}
          </div>
        </div>
      </section>
      <div className="workspace song-workspace">
        <section className="panel song-results" id="song-results" aria-labelledby="song-results-title">
          <div className="panel-top"><h2 id="song-results-title">搜索结果</h2><p>{tracks.length ? `${tracks.length} 条结果 · ${ready} 可下载` : '歌名 · 歌手 · 专辑'}</p></div>
          {!downloadInDetail && downloadFeedback}
          {tracks.length > 0 && <div className="song-result-status" role="status">
            {searching ? <><span className="search-spinner" aria-hidden="true" /> {pending.length ? `正在查询 ${pending.map(source => songProviderLabels[source.provider]).join('、')}` : '正在确认可用曲库'}，已找到的结果可先使用。</>
              : ready > 0 ? '可下载版本包含完整 MP3 和对应歌词。'
                : onlyLyrics ? '目前只找到歌词，没有可下载的同版本音频。' : '已返回的结果中暂无可下载的整曲。'}
          </div>}
          {tracks.length > 0 ? <ul className="song-track-list">
            {tracks.map((item, i) => <li className="song-result-row" key={songKey(item)}><button className="song-row" type="button"
              aria-pressed={selected !== null && songKey(selected) === songKey(item)} onClick={() => void select(item)}>
              <span className="song-row-number">{String(i + 1).padStart(2, '0')}</span>
              <span className="song-row-copy"><strong>{item.title}</strong><small>{[item.artist, item.album || '专辑未知', sourceName(item)].join(' · ')}</small></span>
              <time>{formatTime(item.duration)}</time>{item.availability !== 'ready' && <span className={`song-state ${item.availability}`}>{availabilityLabels[item.availability]}</span>}
            </button>{item.availability === 'ready' && <button type="button" className="button ghost song-row-download"
              aria-label={`下载《${item.title}》整曲和歌词（${item.artist} · ${item.album || sourceName(item)}）`}
              disabled={downloadDisabled(item)} onClick={() => void saveTrack(item, 'results')}><Icon name="download" size={16} /> 下载</button>}</li>)}
          </ul> : searching ? <LoadingRows label={`正在查找「${submitted}」的录音和歌词…`} />
            : <div className="empty song-empty"><span className="empty-icon"><Icon name="search" size={23} /></span>
              <strong>{!submitted ? '先搜索歌名或歌手' : failed.length || catalogError ? '暂未找到结果' : '没有找到匹配的歌曲或歌词'}</strong>
              <p>{!submitted ? '同名歌曲会按专辑或录音版本列出。' : failed.length || catalogError ? '有来源尚未返回结果，可在下方重试。' : `试试用「歌名 + 歌手」缩小范围，或换个关键词。`}</p></div>}
          {submitted && catalogError && <RequestNote error={{ ...catalogError, message: `曲库列表：${catalogError.message}` }} retryLabel="重试曲库列表" onRetry={retryCatalog} />}
          {failed.map(source => <RequestNote key={source.provider} error={{ ...source.error, message: `${songProviderLabels[source.provider]}：${source.error.message}` }}
            retryLabel={`重试 ${songProviderLabels[source.provider]}`} onRetry={() => searchRequest.current?.retry(source.provider)} />)}
        </section>
        <section className="panel song-detail" aria-labelledby="song-detail-title">
          <div className="panel-top"><h2 id="song-detail-title" ref={heading} tabIndex={-1}>{selected?.availability === 'lyrics-only' ? '歌词预览' : '试听与歌词'}</h2><p>{selected?.availability === 'lyrics-only' ? '无配对音频' : '录音详情'}</p></div>
          {detailError && selected ? <RequestNote error={detailError} onRetry={() => void select(selected)} />
            : !track ? selected ? <LoadingRecording title={selected.title} lyricsOnly={selected.availability === 'lyrics-only'} />
              : <div className="empty song-empty"><span className="empty-icon"><Icon name="audio" size={24} /></span><strong>还没有选中歌曲</strong><p>选中一个结果即可查看歌词；可下载的版本也能直接从列表下载。</p></div>
              : <div className="song-detail-body">
                <div className="song-recording">
                  <span className="song-cover" aria-hidden="true">🎵</span>
                  <div><p className="eyebrow">{sourceName(track)} / {formatTime(track.duration)}</p><h3>{track.title}</h3><p>{[track.artist, track.album || '单曲'].join(' · ')}</p></div>
                  <span className={`song-state ${track.availability}`}>{availabilityLabels[track.availability]}</span>
                </div>
                <TrackPlayer key={songKey(track)} track={track}>
                  <div className="song-download-actions">
                    {track.availability === 'ready' ? <>
                      <button type="button" className="button primary" disabled={downloadDisabled(track)} onClick={() => void saveTrack(track, 'detail')}>
                        <Icon name="download" /> {track.lyrics?.kind === 'plain' ? '下载整曲＋纯文本歌词' : '下载整曲＋歌词'}
                      </button><small>ZIP 文件</small>
                    </> : <p>{unavailable[track.availability]}</p>}
                  </div>
                  {downloadInDetail && downloadFeedback}
                </TrackPlayer>
                <div className="song-source-links"><a href={track.sourceUrl} target="_blank" rel="noreferrer">{track.availability === 'lyrics-only' ? '查看歌词来源 ↗' : '查看录音来源 ↗'}</a>
                  {track.licenseUrl && <a href={track.licenseUrl} target="_blank" rel="noreferrer">{track.licenseUrl.includes('/by-nc') ? '限非商业使用 ↗' : '使用许可 ↗'}</a>}
                  {track.lyricSourceUrl && track.lyricSourceUrl !== track.sourceUrl && <a href={track.lyricSourceUrl} target="_blank" rel="noreferrer">歌词出处 ↗</a>}
                  <a className="song-back" href="#song-results">返回结果 ↑</a>
                </div>
              </div>}
        </section>
      </div>
      <details className="local-lyrics" id="local-lyrics" ref={localLyrics} open={showLocalLyrics} onToggle={event => {
        const tools = event.currentTarget;
        if (tools.open) setLocalLyricsLoaded(true);
        else tools.querySelectorAll('audio').forEach(audio => audio.pause());
      }}>
        <summary>
          <span className="local-lyrics-icon"><Icon name="list" size={19} /></span>
          <span><strong>给本地音乐补歌词</strong><small>已有音频时，可在此匹配歌词并导出 LRC</small></span>
          <span className="local-lyrics-arrow"><Icon name="arrow" size={17} /></span>
        </summary>
        {localLyricsLoaded && <Suspense fallback={<LoadingRows count={2} label="正在打开补歌词工具…" />}><LocalLyrics /></Suspense>}
      </details>
      <footer className="site-footer song-footer"><span>TINYTUNE · 音乐工作台</span><span>仅为已核对音源和同版本歌词的录音提供下载。</span></footer>
    </main>
  </>;
}
