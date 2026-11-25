import { useEffect, useMemo, useRef, useState } from 'react';
import { fullTrackSync, matchAudio, resolveLocalAudio } from '../src/audio';
import { demoAudio } from '../src/demo';
import { lrcFilename, lyricText } from '../src/export';
import { activeIndex, formatTime, parseLrc } from '../src/lrc';
import { candidateResult } from '../src/match';
import { fitsLocalRecording, type LocalTrack } from '../src/local-library-types';
import type { CollectionItem, LyricCandidate, LyricResult, Track } from '../src/types';
import type { AudioLibrary } from './audio-library';
import { AudioPanel, type PlayerSource } from './audio-panel';
import { download, Icon, Status } from './ui';
import { LoadingLyrics } from './loading';

export function Preview({ item, recordings, library, matching, onMatch, onConfirm, localRecording }: {
  item: CollectionItem; recordings: Track[]; library: AudioLibrary; matching: boolean; localRecording?: LocalTrack;
  onMatch: () => void; onConfirm: (result: LyricResult) => void;
}) {
  const { track, result } = item;
  const binding = library.bindings.get(track.id);
  const { automatic, candidates } = useMemo(() => matchAudio(track, library.files, recordings), [track, library.files, recordings]);
  const local = resolveLocalAudio(binding, library.files, automatic);
  const missing = binding?.kind === 'local' && !library.files.some(file => file.id === binding.audioId);
  const isDemo = track.id === 'demo-window' || track.id === 'demo-paper';
  const sample = useMemo(() => isDemo && !binding ? demoAudio(track.id === 'demo-paper' ? 2 : 0) : undefined, [track.id, isDemo, binding]);
  let source: PlayerSource | undefined;
  if (localRecording) source = { key: track.id, label: localRecording.file,
    url: `/api/local-library/${track.id}/audio`, localName: localRecording.file.split('/').at(-1), provenance: '本地曲库 · 原文件', coverage: 'full' };
  else if (local) source = { key: local.id, label: local.name, file: local.file, localName: local.name,
    provenance: !binding || (binding.kind === 'local' && binding.automatic) ? '本地曲库 · 自动配对' : '本地曲库 · 手动确认', coverage: 'full' };
  else if (binding?.kind === 'link') source = { key: binding.url, url: binding.url, label: '在线音频',
    provenance: new URL(binding.url).hostname, coverage: binding.coverage };
  else if (sample) source = { key: track.id, file: sample, label: '合成试听样例', provenance: '本地生成 · 无需联网', coverage: 'full' };

  const [blobUrl, setBlobUrl] = useState<{ file: Blob; url: string }>();
  const file = source?.file;
  useEffect(() => {
    if (!file) { setBlobUrl(undefined); return; }
    const url = URL.createObjectURL(file);
    setBlobUrl({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const url = source?.url ?? (file && file === blobUrl?.file ? blobUrl.url : undefined);
  const [media, setMedia] = useState<{ url?: string; duration: number | null; clock: number; error?: string }>({ duration: null, clock: 0 });
  const duration = media.url === url ? media.duration : null;
  const clock = media.url === url ? media.clock : 0;
  const audioError = media.url === url ? media.error : undefined;
  const [choiceId, setChoiceId] = useState<number>();
  const chosen = result.status === 'review' ? result.candidates.find(c => c.id === choiceId) : undefined;
  const shown = chosen ? candidateResult(chosen) : result;
  const lyric = lyricText(shown);
  const { cues, plain } = useMemo(() => parseLrc(lyric ?? ''), [lyric]);
  const expected = shown.status === 'timed' ? shown.candidate.duration ?? track.duration : track.duration;
  const lastCue = (cues.at(-1)?.ms ?? 0) / 1000;
  const canReviewLocal = !!localRecording && !!chosen && fitsLocalRecording(localRecording, chosen) &&
    fullTrackSync(duration, chosen.duration, lastCue, 'full', track.duration);
  const isSync = !!source && (!chosen || canReviewLocal) && cues.length > 0 &&
    fullTrackSync(duration, expected, lastCue, source.coverage, track.duration);
  const active = isSync ? activeIndex(cues, clock) : -1;
  const [follows, setFollows] = useState(true);
  const [seekHint, setSeekHint] = useState('');
  const player = useRef<HTMLAudioElement>(null);
  const timeline = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!localRecording && library.ready && !binding && automatic && !isDemo && fullTrackSync(duration, track.duration, 0, 'full')) {
      library.bind(track.id, { kind: 'local', audioId: automatic.id, automatic: true });
    }
  }, [library, binding, automatic, duration, track.id, track.duration, isDemo, localRecording]);
  useEffect(() => { setFollows(true); setSeekHint(''); }, [url]);
  useEffect(() => {
    if (!follows || active < 0) return;
    const box = timeline.current;
    const line = box?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (box && line) box.scrollTo({ top: line.offsetTop - (box.clientHeight - line.clientHeight) / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [follows, active]);

  const exportable = lyricText(result);
  const syncMessage = source?.coverage === 'clip' ? '试听片段不使用整曲时码。' : chosen ? localRecording
    ? canReviewLocal ? '仅试听对时，尚未确认。请核对开头、中段和结尾。' : '时长或时码不符，或音源尚未就绪；此版本不能保存到本地曲库。'
    : '确认歌词版本后才启用同步。'
    : source && duration !== null && cues.length && !isSync ? '时长或时码与音源不符。可试听，请核对版本后再同步。'
    : isSync ? '时间轴已同步，点歌词可跳转。' : '';
  const canMatch = result.status === 'pending' || result.status === 'error' || result.status === 'missing';

  return <div className="preview-content">
    <div className="track-cover">
      <span className="track-note" aria-hidden="true">🎵</span>
      <div><p className="eyebrow">SESSION / 当前录音</p><h3>{track.title}</h3>
        <p>{[track.artist, track.albums[0], track.duration !== null ? formatTime(track.duration) : '时长未知'].filter(Boolean).join(' · ')}</p></div>
    </div>
    <AudioPanel track={track} source={source} candidates={candidates} library={library} missing={missing} fixed={!!localRecording}>
      {url && <audio key={url} ref={player} controls src={url} preload="metadata" aria-label={`${track.title} 音频播放器`}
        onLoadedMetadata={e => setMedia({ url, clock: e.currentTarget.currentTime, duration: Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null })}
        onTimeUpdate={e => { const clock = e.currentTarget.currentTime; setMedia(prev => prev.url === url ? { ...prev, clock } : prev); }}
        onSeeked={e => { const clock = e.currentTarget.currentTime; setMedia(prev => prev.url === url ? { ...prev, clock } : prev); }}
        onError={() => setMedia({ url, duration: null, clock: 0, error: localRecording ? '无法播放本地音频；它可能已变更，或浏览器不支持此格式。' : '无法播放此音源。请检查音频格式、链接是否过期，或换用本地文件。' })} />}
      {audioError && <p className="deck-note" role="alert">{audioError}</p>}
      {!!syncMessage && <p className="deck-note">{syncMessage}</p>}
      {isSync && seekHint && <p className="deck-note" role="status">{seekHint}</p>}
    </AudioPanel>
    <div className="timeline-caption"><strong>歌词时间轴</strong><Status result={result} />
      {!follows && isSync && <button className="text-button" type="button" onClick={() => setFollows(true)}>回到当前句</button>}
    </div>
    {result.status === 'review' && <div className="review-box">
      <label htmlFor="candidate">核对歌词版本的专辑、署名及时长</label>
      <select id="candidate" value={chosen?.id ?? ''} onChange={event => setChoiceId(event.target.value ? Number(event.target.value) : undefined)}>
        <option value="">选择一个歌词版本</option>
        {result.candidates.map((c: LyricCandidate) => <option key={c.id} value={c.id}>{c.title} · {c.artist} · {c.album || '未知专辑'} · {formatTime(c.duration)}</option>)}
      </select>
      {chosen && <button className="button primary" type="button" disabled={matching || (!!localRecording && !canReviewLocal)}
        onClick={() => onConfirm(candidateResult(chosen))}>确认歌词版本</button>}
      {localRecording && <button className="text-button" type="button" disabled={matching} onClick={() => { setChoiceId(undefined); onMatch(); }}>重新查询歌词</button>}
    </div>}
    {cues.length ? <div ref={timeline} className="timeline" role="region" aria-label="时码歌词" tabIndex={0}
      onWheel={() => setFollows(false)} onTouchMove={() => setFollows(false)}
      onKeyDown={e => { if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) setFollows(false); }}>
      {cues.map((cue, i) => cue.lines.length > 0 && <button key={cue.ms} type="button" data-line={i} aria-current={active === i ? 'true' : undefined}
        className="lyric-line" disabled={!isSync} onClick={() => {
          const audio = player.current, time = cue.ms / 1000;
          if (!audio || !isSync) return;
          const { seekable } = audio;
          const canSeek = Array.from({ length: seekable.length }, (_, i) => i).some(i => time >= seekable.start(i) && time <= seekable.end(i));
          if (!canSeek) { setSeekHint('这段音频暂不能跳转。可先播放等待缓冲，或换用本地文件。'); return; }
          setSeekHint(''); audio.currentTime = time; setFollows(true);
        }}>
        <time>{formatTime(cue.ms / 1000, true)}</time><span>{cue.lines.join('\n')}</span>
      </button>)}
    </div> : plain ? <div className="timeline plain" aria-label="纯文本歌词">{plain}</div>
      : result.status === 'running' ? <LoadingLyrics label="正在核对录音版本并查找歌词…" />
      : <div className="lyric-placeholder">
        <span>{result.status === 'error' ? result.message : {
          pending: '还没有匹配这首的歌词。', review: '歌词版本不唯一，需要确认。',
          instrumental: '纯音乐，没有歌词。', missing: '没有找到这个版本的歌词。', timed: '', plain: '',
        }[result.status]}</span>
        {canMatch && <button className="button ghost" type="button" disabled={matching} onClick={onMatch}>
          {matching ? '等待当前匹配完成' : result.status === 'pending' ? '查找这首歌词' : '重新查找这首歌词'}</button>}
      </div>}
    <div className="preview-footer">
      <small>{'candidate' in shown && (shown.candidate.id > 0 ? `歌词来源 · LRCLIB #${shown.candidate.id}` : '歌词来源 · 原创样例')}</small>
      {localRecording && exportable !== null && <button className="text-button" type="button" disabled={matching} onClick={() => { setChoiceId(undefined); onMatch(); }}>重新查询歌词</button>}
      <button className="button ghost" type="button" disabled={exportable === null} onClick={() => {
        if (exportable !== null) download(lrcFilename(source?.localName ?? track.title, !!source?.localName), new Blob([exportable], { type: 'text/plain;charset=utf-8' }));
      }}><Icon name="download" size={16} /> 导出 .lrc</button>
    </div>
  </div>;
}
