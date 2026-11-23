export function LoadingRows({ label, count = 3 }: { label: string; count?: number }) {
  return <>
    <p className="loading-caption" role="status">{label}</p>
    <div className="song-track-list skeleton-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <div className="song-row skeleton-row" key={i}>
        <span className="skeleton skeleton-number" />
        <div className="skeleton-copy"><span className="skeleton" /><span className="skeleton" /></div>
        <span className="skeleton skeleton-time" />
        <span className="skeleton skeleton-pill" />
      </div>)}
    </div>
  </>;
}

function LyricLines() {
  return <div className="skeleton-lyrics" aria-hidden="true">
    {[78, 57, 87, 64].map(width => <span key={width} className="skeleton" style={{ width: `${width}%` }} />)}
  </div>;
}

export function LoadingLyrics({ label }: { label: string }) {
  return <div className="song-lyrics">
    <p className="loading-caption" role="status">{label}</p>
    <LyricLines />
  </div>;
}

export function LoadingRecording({ title, lyricsOnly = false }: { title: string; lyricsOnly?: boolean }) {
  return <div className="song-detail-body">
    <p className="loading-caption" role="status">正在加载「{title}」的{lyricsOnly ? '歌词' : '录音与歌词'}…</p>
    <div className="song-recording skeleton-recording" aria-hidden="true">
      <span className="skeleton skeleton-cover" />
      <div className="skeleton-copy"><span className="skeleton" /><span className="skeleton" /></div>
      <span className="skeleton skeleton-pill" />
    </div>
    {!lyricsOnly && <>
      <div className="skeleton skeleton-player" aria-hidden="true" />
      <div className="skeleton skeleton-action" aria-hidden="true" />
    </>}
    <div className="song-lyrics"><LyricLines /></div>
  </div>;
}
