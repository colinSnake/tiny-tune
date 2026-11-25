import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { activeIndex, formatTime, parseLrc } from '../src/lrc';
import { pickAutomaticSong, rankSongs, songProviderLabels, songProviders, type SongAvailability, type SongCatalogStatus, type SongDetail, type SongProvider, type SongSummary } from '../src/song-types';
import { checked, failure, RequestFailure, SongSearchRequest, type Failure, type SourceResult } from './song-requests';
import { download, Icon } from './ui';
import { LoadingRecording, LoadingRows } from './loading';
import { canDownload, fetchSongFile, prepareSongBatch, songKey, trackPath, type BatchProgress } from './song-downloads';
import { useSongPlayback } from './song-playback';

const LocalLyrics = lazy(() => import('./page'));
const defaultProviders = ['artist', 'bilibili-video', 'lrclib'] as const;

const availabilityLabels: Record<SongAvailability, string> = {
  ready: '可下载', 'audio-only': '仅 MP3', 'stream-only': '仅试听', 'missing-lyrics': '缺歌词', review: '待核对', 'lyrics-only': '仅歌词',
};
const unavailable: Record<Exclude<SongAvailability, 'ready' | 'audio-only'>, string> = {
  'stream-only': '来源未开放这版录音的整曲下载。',
  'missing-lyrics': '曲库未提供这版录音的歌词，不会用其他版本拼凑。',
  review: '这版录音的授权、音源或歌词时码尚未核对，暂不生成下载包。',
  'lyrics-only': '当前只找到歌词，没有可下载的同版本音频。',
};

const sourceName = (track: SongSummary) => songProviderLabels[track.provider];
const isBilibili = (track: SongSummary) => track.provider === 'bilibili' || track.provider === 'bilibili-video';
const availabilityLabel = (track: SongSummary) => track.provider === 'bilibili-video' && track.availability === 'review'
  ? '查看详情' : track.provider === 'bilibili-video' && track.availability === 'stream-only' ? '仅播放' : availabilityLabels[track.availability];

type DownloadState = { item: SongSummary; from: 'results' | 'detail' } & (
  | { state: 'pending' | 'saved' }
  | { state: 'failed'; error: Failure }
);

type BatchState = { state: 'pending'; progress: BatchProgress } | { state: 'finished'; count: number; remaining: number; error?: Failure };

function RequestNote({ error, onRetry, retryLabel = '重试', retryDisabled = false }: { error: Failure; onRetry: () => void; retryLabel?: string; retryDisabled?: boolean }) {
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
    <button type="button" className="button ghost" onClick={onRetry} disabled={wait > 0 || retryDisabled} aria-label={wait ? `${retryLabel}（${wait} 秒后可用）` : retryLabel}>{wait ? `${wait} 秒后可重试` : retryLabel}</button>
  </div>;
}

function DownloadNote({ job, onCancel, onRetry }: { job: DownloadState; onCancel: () => void; onRetry: () => void }) {
  if (job.state === 'failed') return <RequestNote error={{ ...job.error, message: `「${job.item.title}」：${job.error.message}` }} retryLabel="重试下载" onRetry={onRetry} />;
  return <div className="song-download-note"><p role="status">
    {job.state === 'pending' ? <><span className="search-spinner" aria-hidden="true" /> 正在准备「{job.item.title}」的{job.item.availability === 'audio-only' ? 'MP3' : '下载包'}</>
      : <><Icon name="download" size={16} /> 已发起「{job.item.title}」的下载。{job.item.availability === 'audio-only' ? '单首 MP3，不含歌词。' : '解压后请将 MP3 与同名 LRC 放在一起。'}</>}
  </p>{job.state === 'pending' && <button type="button" className="button ghost" onClick={onCancel}>取消下载</button>}</div>;
}

function PreviewButton({ item, playback }: { item: SongSummary; playback: ReturnType<typeof useSongPlayback> }) {
  const key = songKey(item), enabled = playback.available.has(key), playing = playback.playing === key;
  const label = playing ? `暂停《${item.title}》` : `试听《${item.title}》`;
  return <button type="button" className="button ghost song-row-preview" aria-label={label} aria-pressed={playing}
    title={enabled ? label : '下载后可试听'} disabled={!enabled} onClick={() => playback.toggle(item)}>
    <Icon name={playing ? 'pause' : 'play'} size={17} />
  </button>;
}

function TrackPlayer({ track, children, localPlaying, onPreview }: { track: SongDetail; children: ReactNode; localPlaying: boolean; onPreview: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLButtonElement>(null);
  const [time, setTime] = useState(0);
  const [audioError, setAudioError] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const video = isBilibili(track) && track.bilibiliVideoId && /^BV[0-9A-Za-z]{10}$/.test(track.bilibiliVideoId)
    ? `https://player.bilibili.com/player.html?bvid=${track.bilibiliVideoId}&page=${track.bilibiliPage ?? 1}&autoplay=0` : null;
  const parsed = useMemo(() => track.lyrics?.kind === 'timed' ? parseLrc(track.lyrics.text) : null, [track.lyrics]);
  const playable = !!track.previewUrl && !audioError;
  const index = parsed && playable ? activeIndex(parsed.cues, time) : -1;
  useEffect(() => {
    if (localPlaying) { audio.current?.pause(); setShowVideo(false); }
  }, [localPlaying]);
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
      {video ? showVideo ? <iframe className="song-video" src={video} title={`${track.title} · B 站播放器`} allowFullScreen />
        : <button type="button" className="button ghost" onClick={() => { onPreview(); setShowVideo(true); }}><Icon name="audio" size={17} /> 加载 B 站播放器</button>
        : track.previewUrl ? <audio ref={audio} controls controlsList="nodownload" preload="metadata" src={track.previewUrl} aria-label={`${track.title}试听`}
        onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onSeeked={e => setTime(e.currentTarget.currentTime)}
        onPlay={onPreview} onError={() => setAudioError(true)} /> : <p>这版录音没有可用的试听地址。</p>}
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
  const [batchMode, setBatchMode] = useState(false);
  const [batchKeys, setBatchKeys] = useState<ReadonlySet<string>>(new Set());
  const [batch, setBatch] = useState<BatchState | null>(null);
  const playback = useSongPlayback();
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
  const downloadable = tracks.filter(canDownload);
  const ready = downloadable.length;
  const batchItems = downloadable.filter(item => batchKeys.has(songKey(item)));
  const batchBusy = batch?.state === 'pending';
  const downloading = batchBusy || job?.state === 'pending';
  const needsAudioCheck = tracks.some(item => item.provider === 'bilibili-video' && item.availability === 'review');
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
    if (batchBusy) cancelDownload();
    setBatch(null); setBatchMode(false); setBatchKeys(new Set());
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
    if (!canDownload(item) || downloadRequest.current) return;
    if (job?.state === 'failed' && songKey(job.item) === songKey(item) && (job.error.retryAt ?? 0) > Date.now()) return;
    searchInteracted.current = true;
    const request = new AbortController();
    downloadRequest.current = request;
    setJob({ item, from, state: 'pending' });
    try {
      const { name, file, audio } = await fetchSongFile(item, request.signal);
      request.signal.throwIfAborted();
      download(name, file);
      playback.remember([{ item, audio }]);
      setJob({ item, from, state: 'saved' });
    } catch (error) {
      if (!request.signal.aborted) setJob({ item, from, state: 'failed', error: failure(error) });
    } finally {
      if (downloadRequest.current === request) downloadRequest.current = null;
    }
  }

  function toggleBatch() {
    if (downloading) return;
    searchInteracted.current = true;
    setJob(null); setBatchMode(!batchMode); setBatchKeys(new Set()); setBatch(null);
  }

  function checkTrack(item: SongSummary, checked: boolean) {
    setBatchKeys(before => {
      const next = new Set(before);
      if (checked) next.add(songKey(item));
      else next.delete(songKey(item));
      return next;
    });
  }

  function cancelBatch() {
    cancelDownload();
    setBatch(null);
  }

  async function saveBatch(items: readonly SongSummary[]) {
    if (!items.length || downloadRequest.current || (batch?.state === 'finished' && (batch.error?.retryAt ?? 0) > Date.now())) return;
    searchInteracted.current = true;
    const request = new AbortController();
    downloadRequest.current = request;
    setJob(null);
    setBatch({ state: 'pending', progress: { current: 0, total: items.length, title: items[0].title } });
    try {
      const result = await prepareSongBatch(items, request.signal, progress => {
        if (!request.signal.aborted) setBatch({ state: 'pending', progress });
      });
      request.signal.throwIfAborted();
      if (result.archive) {
        download(`听页-${result.completed.length}首.zip`, result.archive);
        playback.remember(result.completed);
      }
      setBatchKeys(new Set(result.remaining.map(songKey)));
      if (!result.remaining.length) setBatchMode(false);
      setBatch({ state: 'finished', count: result.completed.length, remaining: result.remaining.length, error: result.error });
    } catch (error) {
      if (!request.signal.aborted) setBatch({ state: 'finished', count: 0, remaining: items.length, error: failure(error) });
    } finally {
      if (downloadRequest.current === request) downloadRequest.current = null;
    }
  }

  const downloadDisabled = (item: SongSummary) => downloading ||
    (job?.state === 'failed' && songKey(job.item) === songKey(item));
  const batchFeedback = batch?.state === 'pending'
    ? <div className="song-download-note"><p role="status"><span className="search-spinner" aria-hidden="true" />
      {batch.progress.title ? `${batch.progress.current || 1}/${batch.progress.total} · 正在下载「${batch.progress.title}」` : '正在打包 ZIP…'}</p>
      <button type="button" className="button ghost" onClick={cancelBatch}>取消下载</button></div>
    : batch?.state === 'finished' ? batch.error
      ? <RequestNote error={{ ...batch.error, message: `${batch.count ? `已打包 ${batch.count} 首，` : ''}还有 ${batch.remaining} 首未完成。${batch.error.message}` }}
        onRetry={() => void saveBatch(batchItems)} retryLabel="下载剩余歌曲" retryDisabled={downloading || !batchItems.length} />
      : <div className="song-download-note"><p role="status">已发起 {batch.count} 首歌曲的 ZIP 下载，可试听其中的音频。</p></div> : null;
  const downloadFeedback = job && <DownloadNote job={job} onCancel={cancelDownload} onRetry={() => void saveTrack(job.item, job.from)} />;

  return <>
    <audio className="song-preview-audio" ref={playback.element} onPlay={playback.sync} onPause={playback.sync} onEnded={playback.sync} hidden />
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="/" aria-label="听页首页">
        <span className="brand-icon" aria-hidden="true"><img className="brand-mark" src="/tingye-logo.svg" alt="" /></span>
        <span className="brand-wordmark">听页 <small>歌曲与歌词工作台</small></span>
      </a>
      <a className="song-tools-link" href="#local-lyrics" onClick={openLocalLyrics}><Icon name="list" size={15} /> 搜歌手查歌词 <Icon name="arrow" size={14} /></a>
    </div></header>
    <main className="shell song-shell">
      <section className="hero song-hero" aria-labelledby="song-title">
        <div className="hero-art" aria-hidden="true" />
        <div className="hero-content">
          <p className="eyebrow"><span className="song-kicker-dot" /> 听页 / 音乐下载</p>
          <h1 id="song-title">找一首歌，<span>把歌词一起带走。</span></h1>
          <p className="hero-description">按歌名或歌手搜索 B 站投稿和曲库。可下载的版本可直接保存 MP3，或连同配套歌词打包。</p>
          <form className="search-form song-search" onSubmit={submit} role="search" aria-label="搜索歌曲">
            <label className="search-input"><Icon name="search" /><input type="search" aria-label="歌名或歌手" placeholder="输入歌名或歌手" value={query} maxLength={120} required
              onChange={e => setQuery(e.target.value)} onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }} /></label>
            <button type="submit" className="button primary" disabled={searchingSameTerm}>搜索歌曲</button>
          </form>
          <div className="song-hero-meta"><span><i /> 支持下载 MP3，或批量打包 ZIP</span>
            {catalog?.sources?.includes('bilibili') && <button className="text-button" type="button" title="B 站来源仅包含已核对的投稿"
              onClick={() => { const example = '自由软件之歌'; setQuery(example); search(example); }}>试搜 B 站 · 自由软件之歌 <Icon name="arrow" size={13} /></button>}
            {catalog?.featured && ['朱約信', 'Code Monkey'].map(example => <button key={example} className="text-button" type="button"
              onClick={() => { setQuery(example); search(example); }}>试搜 {example} <Icon name="arrow" size={13} /></button>)}
          </div>
        </div>
      </section>
      <div className="workspace song-workspace">
        <section className="panel song-results" id="song-results" aria-labelledby="song-results-title">
          <div className="panel-top song-results-head"><div><h2 id="song-results-title">搜索结果</h2>
            <p>{tracks.length ? `${tracks.length} 条结果 · ${ready} 可下载` : '歌名 · 歌手 · 专辑'}</p></div>
            <button type="button" className="button ghost song-batch-button" disabled={!ready || downloading}
              aria-expanded={batchMode} onClick={toggleBatch}>{batchMode ? '取消选择' : '批量下载'}</button>
          </div>
          {!downloadInDetail && downloadFeedback}
          {batchFeedback}
          {!!playback.error && <div className="song-result-status" role="status">{playback.error}</div>}
          {batchMode && <div className="song-batch-controls">
            <label><input type="checkbox" checked={ready > 0 && batchItems.length === ready} disabled={!ready || downloading}
              ref={input => { if (input) input.indeterminate = batchItems.length > 0 && batchItems.length < ready; }}
              onChange={event => setBatchKeys(new Set(event.target.checked ? downloadable.map(songKey) : []))} /> 全选可下载</label>
            <span aria-live="polite">已选 {batchItems.length} 首</span>
            {!(batch?.state === 'finished' && batch.error) && <button type="button" className="button primary" disabled={!batchItems.length || downloading}
              onClick={() => void saveBatch(batchItems)}>打包下载</button>}
          </div>}
          {tracks.length > 0 && <div className="song-result-status" role="status">
            {searching ? <><span className="search-spinner" aria-hidden="true" /> {pending.length ? `正在查询 ${pending.map(source => songProviderLabels[source.provider]).join('、')}` : '正在确认可用曲库'}，已找到的结果可先使用。</>
              : ready > 0 ? '「仅 MP3」只保存音频；带歌词的版本下载 ZIP。下载后可试听。'
                : needsAudioCheck ? '点开 B 站结果，检查这版能否下载 MP3。'
                  : onlyLyrics ? '目前只找到歌词，没有可下载的同版本音频。' : '已返回的结果中暂无可下载的整曲。'}
          </div>}
          {tracks.length > 0 ? <ul className="song-track-list">
            {tracks.map((item, i) => <li className="song-result-row" key={songKey(item)}>
              {batchMode && <div className="song-row-check">{canDownload(item) && <input type="checkbox" aria-label={`选择《${item.title}》（${item.album || sourceName(item)}）`}
                checked={batchKeys.has(songKey(item))} disabled={downloading} onChange={event => checkTrack(item, event.target.checked)} />}</div>}
              <button className="song-row" type="button"
              aria-pressed={selected !== null && songKey(selected) === songKey(item)} onClick={() => void select(item)}>
              <span className="song-row-number">{String(i + 1).padStart(2, '0')}</span>
              <span className="song-row-copy"><strong>{item.title}</strong><small>{[item.artist, item.album || '专辑未知', sourceName(item)].filter(Boolean).join(' · ')}</small></span>
              <time>{formatTime(item.duration)}</time>{item.availability !== 'ready' && <span className={`song-state ${item.availability}`}>{availabilityLabel(item)}</span>}
            </button>{(canDownload(item) || playback.available.has(songKey(item))) && <div className="song-row-actions">
              {canDownload(item) && <button type="button" className="button ghost song-row-download"
                aria-label={`下载《${item.title}》${item.availability === 'audio-only' ? 'MP3' : '整曲和歌词'}（${[item.artist, item.album || sourceName(item)].filter(Boolean).join(' · ')}）`}
                disabled={downloadDisabled(item)} onClick={() => void saveTrack(item, 'results')}>{item.availability === 'audio-only' ? '下载' : '下载 ZIP'}</button>}
              <PreviewButton item={item} playback={playback} />
            </div>}</li>)}
          </ul> : searching ? <LoadingRows label={`正在查找「${submitted}」的录音和歌词…`} />
            : <div className="empty song-empty"><span className="empty-icon"><Icon name="search" size={23} /></span>
              <strong>{!submitted ? '先搜索歌名或歌手' : failed.length || catalogError ? '暂未找到结果' : '没有找到匹配的歌曲或歌词'}</strong>
              <p>{!submitted ? '同名歌曲会按专辑或录音版本列出。' : failed.length || catalogError ? '有来源尚未返回结果，可在下方重试。' : `试试用「歌名 + 歌手」缩小范围，或换个关键词。`}</p></div>}
          {submitted && sourceResults.some(source => source.provider === 'bilibili-video' && (source.state === 'failed' || source.state === 'done' && !source.tracks.length)) &&
            <a className="text-button song-search-fallback" href={`https://search.bilibili.com/all?${new URLSearchParams({ keyword: submitted })}`} target="_blank" rel="noreferrer">在 B 站打开这次搜索 ↗</a>}
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
                  <div><p className="eyebrow">{sourceName(track)} / {formatTime(track.duration)}</p><h3>{track.title}</h3><p>{[track.artist, track.album || '单曲'].filter(Boolean).join(' · ')}</p></div>
                  <span className={`song-state ${track.availability}`}>{availabilityLabel(track)}</span>
                </div>
                <TrackPlayer key={songKey(track)} track={track} localPlaying={!!playback.playing} onPreview={playback.pause}>
                  <div className="song-download-actions">
                    {track.availability === 'ready' ? <>
                      <button type="button" className="button primary" disabled={downloadDisabled(track)} onClick={() => void saveTrack(track, 'detail')}>
                        <Icon name="download" /> {track.lyrics?.kind === 'plain' ? '下载整曲＋纯文本歌词' : '下载整曲＋歌词'}
                      </button><small>ZIP 文件</small>
                    </> : track.availability === 'audio-only' ? <>
                      <button type="button" className="button primary" disabled={downloadDisabled(track)} onClick={() => void saveTrack(track, 'detail')}>
                        下载
                      </button><PreviewButton item={track} playback={playback} /><small>MP3 · 不含歌词</small>
                    </> : <p>{track.downloadNote ?? unavailable[track.availability]}</p>}
                  </div>
                  {downloadInDetail && downloadFeedback}
                </TrackPlayer>
                <div className="song-source-links"><a href={track.sourceUrl} target="_blank" rel="noreferrer">{track.availability === 'lyrics-only' ? '查看歌词来源 ↗' : isBilibili(track) ? '打开 B 站投稿 ↗' : '查看录音来源 ↗'}</a>
                  {track.licenseUrl && <a href={track.licenseUrl} target="_blank" rel="noreferrer">{track.licenseUrl.includes('/by-nc-sa/') ? '非商业 · 相同方式分享 ↗' : track.licenseUrl.includes('/by-nc') ? '限非商业使用 ↗' : '使用许可 ↗'}</a>}
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
          <span><strong>给本地音乐补歌词</strong><small>按歌手查歌词，勾选后批量保存到曲库或导出 LRC</small></span>
          <span className="local-lyrics-arrow"><Icon name="arrow" size={17} /></span>
        </summary>
        {localLyricsLoaded && <Suspense fallback={<LoadingRows count={2} label="正在打开补歌词工具…" />}><LocalLyrics /></Suspense>}
      </details>
      <footer className="site-footer song-footer"><span>听页 · 歌曲与歌词工作台</span><span>请仅保存你有权使用的音频；不使用其他版本的歌词拼包。</span></footer>
    </main>
  </>;
}
