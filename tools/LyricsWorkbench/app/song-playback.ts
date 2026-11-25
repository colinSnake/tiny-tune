import { useEffect, useRef, useState } from 'react';
import type { SongSummary } from '../src/song-types';
import { maxBatchBytes, songKey } from './song-downloads';

export function useSongPlayback() {
  const element = useRef<HTMLAudioElement>(null);
  const source = useRef<{ key: string; url: string } | null>(null);
  const [files, setFiles] = useState<ReadonlyMap<string, Blob>>(new Map());
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => () => {
    if (source.current) URL.revokeObjectURL(source.current.url);
    source.current = null;
  }, []);

  function remember(entries: readonly { item: SongSummary; audio: Blob }[]) {
    setFiles(previous => {
      const next = new Map(previous);
      for (const { item, audio } of entries) {
        const key = songKey(item);
        next.delete(key);
        next.set(key, audio);
      }
      let size = [...next.values()].reduce((total, blob) => total + blob.size, 0);
      for (const [key, blob] of next) {
        if (size <= maxBatchBytes) break;
        next.delete(key);
        size -= blob.size;
      }
      return next;
    });
  }

  function toggle(item: SongSummary) {
    const node = element.current, key = songKey(item), file = files.get(key);
    if (!node || !file) return;
    if (source.current?.key === key && !node.paused) { node.pause(); return; }
    if (source.current?.key !== key || node.error) {
      node.pause();
      if (source.current) URL.revokeObjectURL(source.current.url);
      source.current = { key, url: URL.createObjectURL(file) };
      node.src = source.current.url;
    }
    const current = source.current;
    setError('');
    void node.play().catch((cause: unknown) => {
      if (source.current !== current || (cause instanceof DOMException && cause.name === 'AbortError')) return;
      setError('无法播放这份音频，请重试试听或重新下载。');
      setPlaying(null);
    });
  }

  return { element, available: files, playing, error, remember, toggle, pause: () => element.current?.pause(),
    sync: () => setPlaying(element.current && !element.current.paused && !element.current.ended ? source.current?.key ?? null : null) };
}
