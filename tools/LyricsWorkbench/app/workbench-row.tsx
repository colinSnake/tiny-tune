import type { WorkspaceRow } from '../src/workbench';
import { rowPresentation } from '../src/workbench';
import { formatTime } from '../src/lrc';
import { Icon } from './ui';
import { workbenchSongLabel } from './workbench-reading';

type Props = { row: WorkspaceRow; selected: boolean; checked: boolean; busy: boolean; playing: boolean; downloadedKeys: ReadonlySet<string>; onSelect: () => void; onToggle: () => void; onPreview: () => void; onDownload: () => void };
export function WorkbenchSongRow({ row, selected, checked, busy, playing, downloadedKeys, onSelect, onToggle, onPreview, onDownload }: Props) {
  const view = rowPresentation(row, downloadedKeys);
  const label = workbenchSongLabel(row.track, row.kind === 'song' && row.track.provider === 'bilibili-video');
  const caption = [label.artist, label.edition, row.kind === 'local' && '本地曲库'].filter(Boolean).join(' · ');
  return <article className={`wb-row${selected ? ' selected' : ''}${checked ? ' checked' : ''}${row.kind === 'local' ? ' is-local' : ''}`}>
    <input className="wb-check" type="checkbox" aria-label={`批量选择《${row.track.title}》`} checked={checked} onChange={onToggle} />
    <button type="button" className="wb-row-main" aria-current={selected ? 'true' : undefined} title={row.track.title} onClick={onSelect}>
      <span className="wb-row-copy"><strong>{label.title}</strong><span className="wb-row-meta">{caption && <span className="wb-row-artist" title={caption}>{caption}</span>}<span className={`wb-row-status ${view.downloaded ? 'is-downloaded' : ''}`}>{view.status}</span></span></span>
      <time className="wb-row-duration" aria-label={`时长 ${formatTime(row.track.duration)}`}>{formatTime(row.track.duration)}</time>
    </button>
    <div className="wb-row-actions" aria-label={`${row.track.title} 的操作`}>
      <button className="wb-row-action" type="button" aria-label={`${playing ? '暂停' : '试听'}《${row.track.title}》`} aria-pressed={playing} title={view.canPreview ? playing ? '暂停' : '试听' : '暂无音频，可查看歌词'} disabled={!view.canPreview} onClick={onPreview}><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
      <button className="wb-row-action" type="button" aria-label={`下载《${row.track.title}》`} title={view.canDownload ? view.downloaded ? '再次下载' : '下载音频' : row.kind === 'local' ? '音频已在本地目录' : view.status === '仅歌词' ? '仅提供歌词，不含音频' : '该来源暂不提供音频下载'} disabled={busy || !view.canDownload} onClick={onDownload}><Icon name="download" size={16} /></button>
    </div>
  </article>;
}
