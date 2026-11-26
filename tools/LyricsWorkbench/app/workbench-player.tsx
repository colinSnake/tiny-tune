import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fullTrackSync } from '../src/audio';
import { activeIndex, formatTime, parseLrc } from '../src/lrc';
import { lyricText } from '../src/export';
import { defaultLyricScript, formatLyricText, type LyricScript } from '../src/lyric-script';
import type { ItemState } from '../src/types';
import type { WorkbenchDetail } from './workbench-state';
import { Icon } from './ui';
import { plainLyricReading, workbenchSongLabel } from './workbench-reading';

type PlayerProps = { detail: WorkbenchDetail; result: ItemState; lyricScript?: LyricScript; audioFile?: Blob; autoPlay?: boolean; playRequest?: number; onPlaybackChange?: (playing: boolean) => void; lyricStatus?: ReactNode; lyricOptions?: ReactNode; onRetry?: () => void; retryLabel?: string };
function PlayerStandby({ message, onOpen }: { message: string; onOpen?: () => void }) {
  const content = <><span className="wb-stage-mark"><Icon name={onOpen ? 'play' : 'headphones'} size={25} /></span><span>{message}</span></>;
  return onOpen ? <button type="button" className="wb-stage-placeholder wb-stage-open" onClick={onOpen}>{content}</button>
    : <div className="wb-stage-placeholder" role="status">{content}</div>;
}

export function WorkbenchPlayerWaiting({ searching, submitted }: { searching: boolean; submitted: boolean }) {
  return <div className="wb-playback-layout">
    <section className="wb-preview wb-watch" aria-labelledby="wb-watch-title">
      <div className="wb-watch-top"><span className="wb-watch-kicker">试听</span></div>
      <div className="wb-track-heading"><div><h2 id="wb-watch-title">播放器</h2><p>歌曲将在这里播放</p></div></div>
      <div className="wb-media-stage"><PlayerStandby message={searching ? '正在准备试听…' : submitted ? '没有可预览的歌曲' : '选择左侧歌曲开始试听'} /></div>
    </section>
    <section className="wb-lyrics-card" aria-labelledby="wb-lyrics-title">
      <div className="wb-lyrics-heading"><h3 id="wb-lyrics-title">歌词</h3></div>
      <div className="wb-no-lyrics">选中歌曲后将在这里显示歌词。</div>
    </section>
  </div>;
}

export function WorkbenchPlayer({ detail, result, lyricScript = defaultLyricScript, audioFile, autoPlay, playRequest, onPlaybackChange, lyricStatus, lyricOptions, onRetry, retryLabel = '重新查词' }: PlayerProps) {
  const [blobUrl, setBlobUrl] = useState<string>();
  useEffect(() => {
    if (!audioFile) { setBlobUrl(undefined); return; }
    const objectUrl = URL.createObjectURL(audioFile); setBlobUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl);
  }, [audioFile]);
  const url = detail.local ? `/api/local-library/${detail.local.id}/audio` : blobUrl ?? detail.song?.previewUrl ?? undefined;
  const [media, setMedia] = useState<{ url?: string; clock: number; duration: number | null; failed: boolean }>({ clock: 0, duration: null, failed: false });
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [timelineTailSpace, setTimelineTailSpace] = useState(0);
  const [videoOpen, setVideoOpen] = useState(false);
  const [seekHint, setSeekHint] = useState('');
  const [playbackHint, setPlaybackHint] = useState('');
  const text = lyricText(result);
  const parsed = useMemo(() => parseLrc(formatLyricText(text ?? '', lyricScript)), [text, lyricScript]);
  const duration = media.url === url ? media.duration : null;
  const clock = media.url === url ? media.clock : 0;
  const song = detail.song;
  const video = song?.bilibiliVideoId && /^BV[0-9A-Za-z]{10}$/.test(song.bilibiliVideoId)
    ? `https://player.bilibili.com/player.html?bvid=${song.bilibiliVideoId}&page=${song.bilibiliPage ?? 1}&autoplay=1` : undefined;
  const label = workbenchSongLabel(detail.track, detail.key.startsWith('bilibili-video:'), song?.lyricIdentity);
  const plain = useMemo(() => parsed.plain ? plainLyricReading(parsed.plain, label, 'candidate' in result ? result.candidate : undefined) : undefined,
    [parsed.plain, label.title, label.artist, result]);
  const canSync = !!url && !media.failed && parsed.cues.length > 0 && result.status === 'timed' && fullTrackSync(duration, result.candidate.duration,
    (parsed.cues.at(-1)?.ms ?? 0) / 1000, 'full', detail.track.duration);
  const active = canSync ? activeIndex(parsed.cues, clock) : -1;
  const audio = useRef<HTMLAudioElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const handledRequest = useRef<number | undefined>(undefined);
  const attemptedAutoPlay = useRef(false);
  const playbackCallback = useRef(onPlaybackChange); playbackCallback.current = onPlaybackChange;
  useEffect(() => { setFollow(true); setSeekHint(''); }, [url, text]);
  useEffect(() => {
    const element = audio.current; setPlaying(false); setPlaybackHint('');
    return () => { element?.pause(); playbackCallback.current?.(false); };
  }, [url]);
  useEffect(() => {
    const box = timeline.current;
    if (!box || parsed.cues.length === 0) { setTimelineTailSpace(0); return; }
    const updateTail = () => setTimelineTailSpace(Math.ceil(box.clientHeight / 2));
    updateTail();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateTail);
    observer?.observe(box);
    window.addEventListener('resize', updateTail);
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateTail); };
  }, [parsed.cues.length]);
  useEffect(() => {
    if (!follow || active < 0) return;
    const box = timeline.current, line = box?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (box && line) box.scrollTo({ top: box.scrollTop + line.getBoundingClientRect().top - box.getBoundingClientRect().top - (box.clientHeight - line.clientHeight) / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [active, follow, parsed.cues, timelineTailSpace]);
  function pauseFollowing() {
    const box = timeline.current;
    if (!follow || !canSync || !box || box.scrollHeight <= box.clientHeight) return;
    // A queued smooth scroll can otherwise override the first manual wheel or swipe.
    box.scrollTo({ top: box.scrollTop, behavior: 'instant' });
    setFollow(false);
  }
  async function startAudio(element: HTMLAudioElement) {
    setPlaybackHint('');
    try { await element.play(); }
    catch (error) {
      if (audio.current !== element || (error instanceof DOMException && error.name === 'AbortError')) return;
      playback(false);
      setPlaybackHint(error instanceof DOMException && error.name === 'NotAllowedError'
        ? '浏览器未允许自动播放，请点击播放按钮。' : '音频尚未就绪，请点击播放按钮重试。');
    }
  }
  function toggleAudio() {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) element.pause(); else void startAudio(element);
  }
  useEffect(() => {
    if (!url && !video) return;
    if (playRequest !== undefined && handledRequest.current !== playRequest) {
      handledRequest.current = playRequest;
      attemptedAutoPlay.current = true;
      if (url) toggleAudio(); else setVideoOpen(open => !open);
    } else if (autoPlay && !attemptedAutoPlay.current) {
      attemptedAutoPlay.current = true;
      if (url && audio.current) void startAudio(audio.current);
      else if (video) setVideoOpen(true);
    }
  }, [autoPlay, playRequest, url, video]);
  function update(element: HTMLAudioElement) {
    setMedia({ url, clock: element.currentTime, duration: Number.isFinite(element.duration) ? element.duration : null, failed: false });
  }
  function resumeFollowing() { setFollow(true); setSeekHint(''); }
  function playback(value: boolean) { setPlaying(value); playbackCallback.current?.(value); }
  return <div className="wb-playback-layout">
    <section className="wb-preview wb-watch" aria-labelledby="wb-watch-title">
      <div className="wb-watch-top">
        {!url && video
          ? <button className="wb-source-toggle text-button" type="button" aria-label={videoOpen ? '收起来源播放器' : '打开来源播放器'} aria-expanded={videoOpen} aria-controls={videoOpen ? 'wb-source-video' : undefined} onClick={() => setVideoOpen(open => !open)}><Icon name={videoOpen ? 'close' : 'play'} size={15} />{videoOpen ? '收起视频' : '播放 B 站视频'}</button>
          : <span className="wb-watch-kicker">{playing ? '正在播放' : '当前歌曲'}</span>}
        {song?.sourceUrl && <a className="wb-preview-link" href={song.sourceUrl} target="_blank" rel="noreferrer">{video ? '打开 B 站' : '打开来源'}<Icon name="external" size={12} /></a>}
      </div>
      <div className="wb-track-heading"><div><h2 id="wb-watch-title" title={detail.track.title}>{label.title}</h2><p>{[label.artist, label.edition || (detail.local ? '本地曲库' : detail.track.albums[0]), formatTime(detail.track.duration)].filter(Boolean).join(' · ')}</p></div></div>
      <div className="wb-media-stage">
        {url ? <>
          <div className="wb-stage-visual" aria-hidden="true"><span className="wb-stage-mark"><Icon name="record" size={32} /></span></div>
          <div className="wb-player">
            <audio key={url} ref={audio} preload="metadata" src={url} aria-label={`${label.title} 音频播放器`}
              onLoadedMetadata={e => update(e.currentTarget)} onDurationChange={e => update(e.currentTarget)} onTimeUpdate={e => update(e.currentTarget)}
              onSeeking={e => { update(e.currentTarget); resumeFollowing(); }} onSeeked={e => update(e.currentTarget)}
              onPlay={resumeFollowing} onPlaying={() => { setVideoOpen(false); playback(true); }} onPause={() => playback(false)} onEnded={() => playback(false)}
              onError={() => { playback(false); setMedia({ url, clock: 0, duration: null, failed: true }); }} />
            <button className="wb-player-toggle" type="button" aria-label={playing ? '暂停音频' : '播放音频'} onClick={() => void toggleAudio()}><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
            <div className="wb-player-progress"><div className="wb-player-caption"><span>{detail.local ? '本地原音频' : '在线音频'}</span><time>{formatTime(clock)} / {formatTime(duration)}</time></div>
              <input aria-label="播放进度" type="range" min={0} max={duration || 1} step={0.1} value={Math.min(clock, duration || 1)} disabled={!duration || media.failed}
                onChange={event => { if (audio.current && duration) { audio.current.currentTime = Number(event.target.value); update(audio.current); } }} /></div>
          </div>
        </> : video && videoOpen ? <iframe id="wb-source-video" className="song-video wb-source-video" src={video} title={`${label.title} · 来源播放器`} allow="autoplay; fullscreen" allowFullScreen />
          : <PlayerStandby message={video ? '在此播放 B 站视频' : song?.availability === 'lyrics-only' ? '此结果仅提供歌词' : !song && !detail.key.startsWith('catalog:') && detail.result.status === 'running' ? '正在获取试听源…' : '暂无可用音源'} onOpen={video ? () => setVideoOpen(true) : undefined} />}
      </div>
      {url && media.url === url && media.failed && <p className="wb-lyric-note wb-preview-error" role="alert">无法播放音频，请重新选择歌曲或检查来源是否可用。</p>}
      {video && song && <div className="wb-source-caption"><span className="wb-cover" aria-hidden="true"><Icon name="record" size={16} /></span><div><strong title={song.title}>{song.title}</strong><small>{song.album || 'B 站投稿'}</small></div></div>}
      {(playbackHint || seekHint) && <p role="status" className="wb-lyric-note">{playbackHint || seekHint}</p>}
    </section>
    <section className="wb-lyrics-card" aria-labelledby="wb-lyrics-title">
      <div className="wb-lyrics-heading"><h3 id="wb-lyrics-title">歌词</h3>{lyricStatus}
        <div className="wb-lyrics-tools">
          {!follow && canSync && <button className="text-button" type="button" onClick={() => setFollow(true)}>回到当前句</button>}
          {onRetry && <button className="text-button" type="button" onClick={onRetry}>{retryLabel}</button>}
        </div>
      </div>
      {detail.lyricLookupHint && <p className="wb-hint" role="status">歌词按“{detail.lyricLookupHint}”查找；这是搜索线索，不是投稿署名。保存未署名投稿时，会要求确认目标歌手目录和音源保存权限。</p>}
      {lyricOptions}
      {(parsed.cues.length > 0 || plain) && <div className="wb-lyrics-info"><div className="wb-lyric-reading">
        <p className="wb-lyric-note">{canSync ? (follow ? '随播放滚动 · 点击歌词跳转' : '已暂停自动滚动 · 当前句仍会高亮') : parsed.cues.length ? '时间轴未与音源核对，仅供阅读' : video ? 'B 站嵌入播放器未提供可用进度，歌词仅供阅读' : '纯文本 · 不自动滚动'}</p>
        {!!plain?.credits.length && <p className="wb-lyric-credits">{plain.credits.join(' · ')}</p>}
      </div></div>}
    {parsed.cues.length ? <div className="timeline wb-timeline" ref={timeline} aria-label="时码歌词" role="region" tabIndex={0}
      onWheel={pauseFollowing} onTouchMove={pauseFollowing}
      onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) pauseFollowing(); }}>
      <div className="wb-lyric-reading">{parsed.cues.map((cue, index) => cue.lines.length > 0 && <button type="button" className="wb-lyric-line" key={cue.ms} data-line={index}
        disabled={!canSync} aria-current={index === active ? 'true' : undefined} onClick={() => {
          const element = audio.current, time = cue.ms / 1000;
          if (!element || !canSync) return;
          if (!Array.from({ length: element.seekable.length }, (_, i) => i).some(i => time >= element.seekable.start(i) && time <= element.seekable.end(i))) {
            setSeekHint('该段还未缓冲，请稍后再试。'); return;
          }
          element.currentTime = time; resumeFollowing();
        }}><span className="wb-lyric-text">{cue.lines.join('\n')}</span></button>)}
        <div className="wb-lyric-tail-space" aria-hidden="true" style={{ blockSize: `${timelineTailSpace}px` }} /></div>
    </div> : plain ? <div className="timeline plain wb-timeline" aria-label="纯文本歌词" role="region" tabIndex={0}>
      <div className="wb-lyric-reading wb-lyric-text wb-stanzas">{plain.stanzas.map((verse, i) => <p key={i}>{verse.map((line, j) => <Fragment key={j}>{j > 0 && <br />}{line}</Fragment>)}</p>)}</div>
    </div>
      : <div className="wb-no-lyrics" role="status">{result.status === 'running' ? <><span className="search-spinner" />正在查找歌词…</>
        : result.status === 'error' ? result.message : result.status === 'instrumental' ? '纯音乐，没有歌词。' : result.status === 'review' ? '请选择要预览的歌词版本。' : detail.lyricLookupHint && video ? `按“${detail.lyricLookupHint}”查找后仍未匹配到歌词；投稿未提供明确歌手署名。` : video && !(song?.lyricIdentity?.artist || detail.track.artist) ? '来源未提供明确歌手，暂无法匹配歌词。' : '暂未匹配到歌词。'}</div>}
    </section>
  </div>;
}
