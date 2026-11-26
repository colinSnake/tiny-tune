import { useEffect, useRef, useState, type FormEvent } from 'react';
import { chooseLyrics, selectionSaveNotice, type WorkspaceRow } from '../src/workbench';
import { songProviderLabels, type SongSummary } from '../src/song-types';
import type { LyricCandidate } from '../src/types';
import { formatTime } from '../src/lrc';
import { useWorkbenchActions } from './workbench-actions';
import { WorkbenchPlayer, WorkbenchPlayerWaiting } from './workbench-player';
import { WorkbenchSongRow } from './workbench-row';
import { WorkbenchSaveLocations } from './workbench-save-locations';
import { WorkbenchThemeToggle } from './workbench-theme';
import { useWorkbench } from './workbench-state';
import { Icon, Status } from './ui';
import { canDownload } from './song-downloads';
import { lyricText } from '../src/export';
import { defaultLyricScript, type LyricScript } from '../src/lyric-script';

function rowTitle(row: WorkspaceRow) { return row.track.title; }

function RetryNotice({ message, retryAt, onRetry }: { message: string; retryAt?: number; onRetry: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!retryAt || retryAt <= Date.now()) return;
    const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time >= retryAt) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const wait = Math.max(0, Math.ceil(((retryAt ?? 0) - now) / 1000));
  return <p className="wb-alert" role="alert">{message} <button className="text-button" type="button" disabled={wait > 0} onClick={onRetry}>{wait ? `${wait} 秒后重试` : '重试'}</button></p>;
}

export default function Workbench() {
  const state = useWorkbench();
  const composing = useRef(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Map<string, number>>(new Map());
  const [lyricScript, setLyricScript] = useState<LyricScript>(defaultLyricScript);
  const actions = useWorkbenchActions(state, choices, lyricScript);
  const [playingKey, setPlayingKey] = useState('');
  const [previewRequest, setPreviewRequest] = useState<{ key: string; id: number }>();
  const previewSequence = useRef(0);
  const detail = state.detail?.key === state.selected?.key ? state.detail : undefined;
  const candidateId = detail ? choices.get(detail.key) : undefined;
  const lyricReview = detail?.timing?.status === 'review' ? detail.timing : detail?.result;
  const chosen = detail ? chooseLyrics(candidateId !== undefined && detail.timing?.status === 'review' ? detail.timing : detail.result, candidateId, detail.track) : undefined;
  const lyricVersions = lyricReview?.status === 'review' ? lyricReview.candidates : [];
  const videoLyricReview = detail?.song?.provider === 'bilibili-video' && lyricReview?.status === 'review';
  const requiresLyricChoice = !!detail?.timing || !!detail?.local?.confirmTiming || videoLyricReview;
  const lrclibRow = state.selected?.kind === 'song' && state.selected.versions.length > 1 ? state.selected : undefined;
  const busy = !!actions.job?.busy;
  const saving = busy && actions.job?.mode === 'save';
  const chosenRows = state.rows.filter(row => checked.has(row.key));
  const activeRows = chosenRows.length ? chosenRows : state.selected ? [state.selected] : [];
  const saveNotice = state.localEnabled ? selectionSaveNotice(activeRows) : undefined;
  const singleLocal = activeRows.length === 1 && activeRows[0].kind === 'local' && activeRows[0].key === state.selected?.key;
  const activeLocal = singleLocal ? detail?.local : undefined;
  const upgradesPlain = activeLocal?.lyricsKind === 'plain';
  const timedChoice = chosen?.result.status === 'timed';

  function select(row: WorkspaceRow) { if (row.key !== state.selected?.key) { setPlayingKey(''); setPreviewRequest(undefined); } state.select(row); actions.clearJob(); }
  function preview(row: WorkspaceRow) { select(row); setPreviewRequest({ key: row.key, id: ++previewSequence.current }); }
  function toggle(row: WorkspaceRow) { setChecked(before => { const next = new Set(before); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; }); }
  function chooseCandidate(id: number) { if (detail) setChoices(before => new Map(before).set(detail.key, id)); }
  function retryLyrics() {
    if (detail?.local?.lyricsKind === 'plain') setChoices(before => { const next = new Map(before); next.delete(detail.key); return next; });
    state.retryDetail();
  }
  function chooseVersion(version: SongSummary) { state.chooseVersion(version); }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (composing.current || !state.query.trim()) return; state.search(); setChecked(new Set()); setChoices(new Map()); setPlayingKey(''); setPreviewRequest(undefined); }
  function runAction(mode: 'save' | 'export') {
    if (!activeRows.length) return;
    const approval = activeRows.length === 1 && chosen && detail?.key === activeRows[0].key
      ? { key: activeRows[0].key, approval: { candidateId: chosen.candidate.id, mode: chosen.mode } } : undefined;
    void actions.run(activeRows, mode, approval);
  }
  return <main className="shell wb-shell">
    <header className="site-header"><div className="header-inner"><a className="brand" href="/" aria-label="听页"><span className="brand-icon"><img className="brand-mark" src="/tingye-logo.svg" alt="" /></span><span className="brand-wordmark">听页 <small>歌曲与歌词工作台</small></span></a>
      <form className="search-form song-search wb-search" role="search" aria-label="搜索歌曲或歌手" onSubmit={submit}>
        <label className="search-input"><Icon name="search" /><input type="search" aria-label="歌手、歌名" placeholder="歌名或歌手，例如：伍佰 挪威的森林" value={state.query} maxLength={120} required
          onChange={event => state.setQuery(event.target.value)} onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || composing.current)) event.preventDefault(); }} /></label>
        <button type="submit" className="button primary" disabled={state.searching && state.submitted === state.query.trim()}><Icon name="search" size={16} />搜索</button>
      </form>
      <div className="wb-header-actions"><span className="wb-root" title={state.root || '尚未配置本地音乐目录'}><Icon name="folder" size={15} /><span>{state.localEnabled ? '保存位置 · ' + (state.root.split(/[\\/]/u).filter(Boolean).at(-1) ?? state.root) : '本地曲库未配置'}</span></span>
        <WorkbenchThemeToggle />
      </div>
    </div></header>

    <section className="wb-actions-toolbar" aria-label="统一下载与保存">
      <div className="wb-actions-context"><div><span>{chosenRows.length ? `已选 ${chosenRows.length} 首歌曲` : state.submitted ? '搜索结果' : '歌曲与歌词工作台'}</span><h1 className="wb-page-title" title={state.submitted || undefined}>{state.submitted || '歌曲与歌词'}</h1></div></div>
      <div className="wb-actions-buttons">
        <label className="wb-lyric-script" title="应用于歌词预览、保存与下载">歌词字形<select aria-label="歌词字形" disabled={busy} value={lyricScript}
          onChange={event => setLyricScript(event.currentTarget.value === 'original' ? 'original' : defaultLyricScript)}>
          <option value="simplified">简体中文</option><option value="original">保留原文</option>
        </select></label>
        <button type="button" className="button ghost" disabled={busy || !activeRows.length || (!chosenRows.length && !!detail && !(detail.song && canDownload(detail.song)) && (!chosen || lyricText(chosen.result) === null))} onClick={() => runAction('export')}><Icon name="download" size={16} />一键下载</button>
        <button type="button" className="button primary wb-save-button" aria-busy={saving || undefined} aria-describedby={saveNotice ? 'wb-save-notice' : undefined}
          disabled={busy || !activeRows.length || !state.localEnabled || (singleLocal && (!activeLocal || !timedChoice || activeLocal.hasLyrics && !upgradesPlain))}
          onClick={() => runAction('save')}><Icon name="folder" size={16} />{saving ? '正在保存…' : upgradesPlain ? '补齐歌词时码' : '保存到本机目录'}</button></div>
      {saveNotice && <p className="wb-save-notice" id="wb-save-notice">{saveNotice}</p>}
      {actions.job && <p className={`wb-action-status${actions.job.error ? ' error' : ''}`} title={actions.job.message} role="status">{actions.job.busy && <span className="search-spinner" />} {actions.job.message}</p>}
      {actions.job?.files && <WorkbenchSaveLocations root={state.root} files={actions.job.files} />}
    </section>

    <section className="wb-layout" aria-label="歌曲与歌词工作区">
      <section className="panel wb-list" aria-labelledby="wb-list-title">
        <div className="panel-top"><div><h2 id="wb-list-title">歌曲与版本</h2><p aria-live="polite">{state.submitted ? `${state.rows.length} 首结果${state.artist ? ` · ${state.artist.name}` : ''}` : '搜索歌手或歌名开始'}</p></div>
          {state.searching && <span className="search-spinner" aria-label="正在搜索" />}</div>
        <div className="wb-list-content" id="wb-results" tabIndex={0} aria-label="歌曲搜索结果">
        {state.artists.length > 0 && <div className="wb-artists" aria-label="选择歌手">{state.artists.map(artist => <button type="button" key={artist.id} className="button ghost" onClick={() => state.chooseArtist(artist)}>{artist.name}</button>)}</div>}
        {state.localError && <p className="wb-alert" role="status">{state.localError}</p>}
        {state.catalogError && <p className="wb-alert" role="alert">{state.catalogError}</p>}
        {state.sourceError && <p className="wb-alert" role="alert">{state.sourceError} <button className="text-button" type="button" onClick={state.retryStatus}>重试</button></p>}
        {state.sources.filter(item => item.state === 'failed').map(source => <RetryNotice key={source.provider} message={`${songProviderLabels[source.provider]}：${source.error.message}`} retryAt={source.error.retryAt} onRetry={() => state.retrySource(source)} />)}
          {state.rows.map(row => <WorkbenchSongRow key={row.key} row={row} selected={state.selected?.key === row.key} checked={checked.has(row.key)} busy={busy} playing={playingKey === row.key} downloadedKeys={actions.downloadedKeys}
            onSelect={() => select(row)} onToggle={() => toggle(row)} onPreview={() => preview(row)} onDownload={() => { select(row); void actions.run([row], 'export'); }} />)}
          {!state.rows.length && state.submitted && !state.searching && <div className="wb-empty">没有找到歌曲或本地文件。</div>}
          {state.next !== null && <button type="button" className="button ghost wb-more" disabled={state.catalogBusy} onClick={state.loadMore}>{state.catalogBusy ? '载入中…' : '载入更多歌曲'}</button>}
        </div>
        <div className="wb-list-actions">{chosenRows.length ? <><span>已选 {chosenRows.length} 首</span><button className="text-button" type="button" disabled={busy} onClick={() => setChecked(new Set())}>取消选择</button></> : <small>点歌自动查词 · 勾选歌曲后可批量操作（每次最多 50 首）</small>}</div>
      </section>
      <section className="wb-detail" aria-label="试听与歌词">
        <div className="wb-detail-content">
          {!detail ? <WorkbenchPlayerWaiting searching={state.searching || !!state.selected} submitted={!!state.submitted} />
            : <WorkbenchPlayer key={detail.key} detail={detail} autoPlay={state.autoPlay} playRequest={previewRequest?.key === detail.key ? previewRequest.id : undefined}
              onPlaybackChange={playing => setPlayingKey(previous => playing ? detail.key : previous === detail.key ? '' : previous)}
              result={chosen?.result ?? detail.result} lyricScript={lyricScript} audioFile={actions.audioFiles.get(detail.song ? `${detail.song.provider}:${detail.song.id}` : '')}
              lyricStatus={<Status result={chosen?.result ?? detail.result} />} onRetry={detail.result.status !== 'running' && !detail.findingTiming ? retryLyrics : undefined}
              retryLabel={detail.local?.lyricsKind === 'plain' ? '查找歌词时码' : undefined}
              lyricOptions={<>
                {lrclibRow && <label className="wb-version">歌词版本<select aria-label="歌词版本" value={state.version?.id ?? lrclibRow.versions[0].id} onChange={event => { const choice = lrclibRow.versions.find(item => item.id === event.target.value); if (choice) chooseVersion(choice); }}>{lrclibRow.versions.map(version => <option key={version.id} value={version.id}>{version.title} · {version.artist} · {formatTime(version.duration)}</option>)}</select></label>}
                {lyricVersions.length > 0 && <label className="wb-version">匹配歌词<select aria-label="匹配歌词" value={(requiresLyricChoice ? candidateId : chosen?.candidate.id) ?? ''} onChange={event => chooseCandidate(Number(event.target.value))}>{(!chosen || requiresLyricChoice && candidateId === undefined) && <option value={''} disabled>选择歌词版本</option>}{lyricVersions.map((candidate: LyricCandidate) => <option key={candidate.id} value={candidate.id}>{candidate.title} · {candidate.album || '未知版本'} · {candidate.artist} · {formatTime(candidate.duration)}</option>)}</select></label>}
                {videoLyricReview && candidateId === undefined && <p className="wb-hint" role="status">当前只预览首个版本，保存歌词前请先选择版本。</p>}
                {chosen?.mode === 'plain' && detail.song?.provider !== 'bilibili-video' && <p className="wb-hint" role="status">未核对到这版音频的可用时码，仅供阅读。</p>}
                {detail.local?.lyricsKind === 'timed' && <p className="wb-lyric-note">正在使用本地同步歌词。</p>}
                {detail.local?.lyricsKind === 'plain' && <p className="wb-lyric-note" role="status">{detail.findingTiming ? '正在查找时码，仍显示本地歌词。'
                  : detail.timing?.status === 'error' ? detail.timing.message
                  : detail.timing?.status === 'missing' ? '未找到这版录音可用的时码，已保留本地歌词。'
                  : detail.timing?.status === 'review' ? '请核对同版歌词，确认后再补齐时码。' : '这份歌词没有时码，播放时不会自动跟唱。'}</p>}
                {detail.local?.lyricsKind === 'protected' && <p className="wb-lyric-note">已有歌词无法安全读取或配对，原文件未改动。</p>}
              </>} />}
        </div>
      </section>
    </section>

    <footer className="site-footer wb-footer"><span>听页 · 歌曲与歌词工作台</span><span>只下载来源明确开放的音频；配套歌词仅保存已核对的同步时码。</span></footer>
  </main>;
}
