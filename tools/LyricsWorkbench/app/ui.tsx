import type { ItemState } from '../src/types';

export const statusLabels: Record<ItemState['status'], string> = {
  pending: '未匹配', running: '匹配中', timed: '有时码', plain: '纯文本', review: '待确认',
  instrumental: '纯音乐', missing: '未找到', error: '请求失败',
};

type IconName = 'wave' | 'search' | 'arrow' | 'download' | 'audio' | 'play' | 'pause' | 'record' | 'close' | 'list' | 'folder' | 'link' | 'headphones' | 'external' | 'save';
const paths: Record<IconName, string> = {
  wave: 'M3 12h2m2-4v8m4-12v16m4-13v10m4-7v4m2-2h1',
  search: 'M21 21l-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
  audio: 'M9 18V5l11-2v13M9 18c0 4-7 4-7 1 0-2 4-3 7-1Zm11-2c0 4-7 4-7 1 0-2 4-3 7-1Z',
  play: 'm8 5 12 7-12 7Z',
  pause: 'M9 5v14m6-14v14',
  record: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  close: 'm6 6 12 12M18 6 6 18',
  folder: 'M3 5h7l2 2h9v12H3Zm0 5h18',
  link: 'm10 13 4-4m-6 6-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m4 0 2-2a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1',
  headphones: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H5a1 1 0 0 1-1-1v-4Zm16 0h-3v5h2a1 1 0 0 0 1-1v-4Z',
  external: 'M14 5h5v5m0-5-8 8M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4',
  save: 'M5 4h12l2 2v14H5Zm3 0v5h8V4m-7 10h6',
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Status({ result }: { result: ItemState }) {
  return <span className={`status status-${result.status}`}><i />{statusLabels[result.status]}</span>;
}

export function download(file: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = file;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
