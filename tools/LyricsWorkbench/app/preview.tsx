import { useEffect, useMemo, useRef, useState } from 'react';
import { demoAudio } from '../src/demo';
import { lrcFilename, lyricText } from '../src/export';
import { activeIndex, formatTime, parseLrc } from '../src/lrc';
import { candidateResult } from '../src/match';
import type { CollectionItem, LyricCandidate, LyricResult } from '../src/types';
import { download, Icon, Status } from './ui';

export function Preview({ item, onConfirm }: { item: CollectionItem; onConfirm: (result: LyricResult) => void }) {
  const { track, result } = item;
  const [candidate, setCandidate] = useState<LyricCandidate>();
  const shown = result.status === 'review' && candidate ? candidateResult(candidate) : result;
  const lyric = lyricText(shown);
  const { cues, plain } = useMemo(() => parseLrc(lyric ?? ''), [lyric]);
  const [audio, setAudio] = useState<{ file: string; url: string }>();
  const [audioError, setAudioError] = useState('');
  const [clock, setClock] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [follows, setFollows] = useState(true);
  const player = useRef<HTMLAudioElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const active = duration !== null ? activeIndex(cues, clock) : -1;
  useEffect(() => {
    return () => { if (audio) URL.revokeObjectURL(audio.url); };
  }, [audio]);
  useEffect(() => {
    if (!follows || active < 0) return;
    const box = timeline.current;
    const line = box?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (box && line) box.scrollTo({ top: line.offsetTop - (box.clientHeight - line.clientHeight) / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [follows, active]);

  function attach(file: string, blob: Blob) {
    setAudio({ file, url: URL.createObjectURL(blob) });
    setClock(0); setDuration(null); setFollows(true); setAudioError('');
  }
  function seek(seconds: number) {
    if (player.current && duration !== null && seconds <= duration) {
      player.current.currentTime = seconds; setClock(seconds);
    }
  }
  const exportable = lyricText(result);
  return <div className="preview-content">
    <div className="track-cover">
      <span className="mini-record"><Icon name="record" size={27} /></span>
      <div><h3>{track.title}</h3><p>{[track.artist, track.albums[0] || formatTime(track.duration)].filter(Boolean).join(' · ')}</p></div>
    </div>
    <div className="preview-meta"><Status result={result} />{'candidate' in shown && shown.candidate.id > 0 && <span>LRCLIB #{shown.candidate.id}</span>}</div>
    {result.status === 'review' && <div className="review-box">
      <label htmlFor="candidate">核对候选的专辑、署名及时长</label>
      <select id="candidate" value={candidate?.id ?? ''} onChange={event => setCandidate(result.candidates.find(c => String(c.id) === event.target.value))}>
        <option value="">选择一个候选版本</option>
        {result.candidates.map(c => <option key={c.id} value={c.id}>{c.title} · {c.artist} · {c.album || '未知专辑'} · {formatTime(c.duration)}</option>)}
      </select>
      {candidate && <button className="button primary" onClick={() => onConfirm(candidateResult(candidate))}>确认这个版本</button>}
    </div>}
    <div className="audio-box">
      {audio ? <>
        <div className="audio-name"><Icon name="audio" size={15} /><span>{audio.file}</span>
          <button type="button" onClick={() => { setAudio(undefined); setDuration(null); setAudioError(''); }} aria-label="移除本地音频"><Icon name="close" size={15} /></button></div>
        <audio key={audio.url} ref={player} controls src={audio.url} preload="metadata"
          onLoadedMetadata={e => { setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null); }}
          onTimeUpdate={e => setClock(e.currentTarget.currentTime)} onSeeked={e => setClock(e.currentTarget.currentTime)}
          onError={() => { setDuration(null); setAudioError('浏览器无法播放这个文件。可以更换音频，或仅预览时码。'); }} />
        {audioError && <p className="error-text" role="alert">{audioError}</p>}
      </> : <>
        <label className="button ghost file-button"><Icon name="audio" size={16} />选择本地音频
          <input type="file" accept="audio/*,.flac,.wav,.m4a,.aac,.mp3,.ogg,.opus" onChange={e => {
            const file = e.currentTarget.files?.[0]; if (file) attach(file.name, file);
          }} />
        </label>
        {track.id === 'demo-window' && <button className="button text-button" onClick={() => attach('窗边的光.wav', demoAudio())}><Icon name="play" size={15} />载入试听样例</button>}
        <small>音频不上传</small>
      </>}
    </div>
    {cues.length ? <>
      <div className="timeline-caption"><span>时码 / 歌词</span>
        {!follows && duration !== null && <button className="text-button" onClick={() => setFollows(true)}>回到当前句</button>}
      </div>
      <div ref={timeline} className="timeline" role="region" aria-label="时码歌词" tabIndex={0}
        onWheel={() => setFollows(false)} onTouchMove={() => setFollows(false)}
        onKeyDown={e => { if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) setFollows(false); }}>
        {cues.map((cue, i) => cue.lines.length > 0 && <button key={cue.ms} type="button" data-line={i} aria-current={active === i ? 'true' : undefined}
          className="lyric-line" disabled={duration === null || cue.ms / 1000 > duration} onClick={() => seek(cue.ms / 1000)}>
          <time>{formatTime(cue.ms / 1000, true)}</time><span>{cue.lines.join('\n')}</span>
        </button>)}
      </div>
    </> : plain ? <div className="timeline plain" aria-label="纯文本歌词">{plain}</div>
      : <p className="preview-note">{result.status === 'error' ? result.message : {
        pending: '尚未匹配歌词。', running: '正在查找歌词…', review: '请选择并确认歌词版本。',
        instrumental: '纯音乐，无歌词。', missing: '未找到歌词。', timed: '', plain: '',
      }[result.status]}</p>}
    <button className="button export-one" disabled={exportable === null} onClick={() => {
      if (exportable !== null) download(lrcFilename(audio?.file || track.title, !!audio), new Blob([exportable], { type: 'text/plain;charset=utf-8' }));
    }}><Icon name="download" size={17} /> 导出这首 .lrc</button>
  </div>;
}
