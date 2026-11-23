import type { ItemState } from '../src/types';

export const statusLabels: Record<ItemState['status'], string> = {
  pending: '未匹配', running: '匹配中', timed: '有时码', plain: '纯文本', review: '待确认',
  instrumental: '纯音乐', missing: '未找到', error: '请求失败',
};

type IconName = 'wave' | 'search' | 'arrow' | 'download' | 'audio' | 'play' | 'record' | 'close' | 'list';
const paths: Record<IconName, string> = {
  wave: 'M3 12h2m2-4v8m4-12v16m4-13v10m4-7v4m2-2h1',
  search: 'M21 21l-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
  audio: 'M9 18V5l11-2v13M9 18c0 4-7 4-7 1 0-2 4-3 7-1Zm11-2c0 4-7 4-7 1 0-2 4-3 7-1Z',
  play: 'm8 5 12 7-12 7Z',
  record: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  close: 'm6 6 12 12M18 6 6 18',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1',
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
