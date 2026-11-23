import { useEffect, useRef, useState } from 'react';
import { parseIsrc, type AudioBinding, type AudioMetadata } from '../src/audio';
import type { FoundResult, Track } from '../src/types';
import { canImportAudio } from './local-files';

export type LocalAudio = AudioMetadata & { file: File };
export type SavedLyrics = { track: Track; result: FoundResult };
type Records = { files: LocalAudio; bindings: AudioBinding; lyrics: SavedLyrics };
type Store = keyof Records;

function openLibrary() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('tinytune-audio-library', 1);
    req.onupgradeneeded = () => {
      for (const name of ['files', 'bindings', 'lyrics'] satisfies Store[]) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function readStore<K extends Store>(db: IDBDatabase, name: K) {
  return new Promise<Map<string, Records[K]>>((resolve, reject) => {
    const entries = new Map<string, Records[K]>();
    const tx = db.transaction(name, 'readonly');
    const req = tx.objectStore(name).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (typeof cursor.key === 'string') entries.set(cursor.key, cursor.value);
      cursor.continue();
    };
    tx.oncomplete = () => resolve(entries);
    tx.onabort = () => reject(tx.error);
  });
}
function writeStore<K extends Store>(db: IDBDatabase, name: K, key?: string, value?: Records[K]) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const store = tx.objectStore(name);
    if (key !== undefined) store.put(value, key);
    else store.clear();
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

async function readAudio(file: File): Promise<LocalAudio> {
  // Use a stable id when reimporting the same file without loading all its bytes into JS.
  const sample = await new Blob([JSON.stringify([file.webkitRelativePath || file.name, file.size, file.lastModified]),
    file.slice(0, 65_536), file.slice(Math.max(65_536, file.size - 65_536))]).arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', sample);
  const id = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const { parseBlob } = await import('music-metadata');
  const { common, format } = await parseBlob(file, { duration: true, skipCovers: true }).catch(() => ({
    common: {} as { title?: string; artist?: string; album?: string; isrc?: string[] }, format: {} as { duration?: number },
  }));
  // Untagged or unsupported files can still be confirmed manually, then checked by the player.
  const duration = format.duration;
  return { id, file, name: file.name, title: common.title?.trim() ?? '', artist: common.artist?.trim() ?? '',
    album: common.album?.trim() ?? '', duration: duration && Number.isFinite(duration) && duration > 0 ? duration : null,
    isrcs: (common.isrc ?? []).map(parseIsrc).filter(Boolean) };
}

export function useAudioLibrary() {
  const database = useRef<IDBDatabase | undefined>(undefined);
  const importing = useRef(false);
  const workingFiles = useRef(new Map<string, LocalAudio>());
  const [files, setFiles] = useState<LocalAudio[]>([]);
  const [bindings, setBindings] = useState<Map<string, AudioBinding>>(new Map());
  const [lyrics, setLyrics] = useState<Map<string, SavedLyrics>>(new Map());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    let current = true;
    let opened: IDBDatabase | undefined;
    void (async () => {
      try {
        opened = await openLibrary();
        if (!current) { opened.close(); return; }
        const [loadedFiles, loadedBindings, loadedLyrics] = await Promise.all([
          readStore(opened, 'files'), readStore(opened, 'bindings'), readStore(opened, 'lyrics'),
        ]);
        if (!current) return;
        database.current = opened;
        workingFiles.current = loadedFiles;
        setFiles([...loadedFiles.values()]); setBindings(loadedBindings); setLyrics(loadedLyrics);
        opened.onversionchange = () => {
          opened?.close(); database.current = undefined;
          setStorageError('曲库已在另一个页面更新，刷新后可重新保存。');
        };
      } catch {
        opened?.close();
        if (current) setStorageError('浏览器无法打开本地曲库，绑定仅在当前页面有效。');
      } finally { if (current) setReady(true); }
    })();
    return () => { current = false; opened?.close(); database.current = undefined; };
  }, []);

  function persist<K extends Store>(name: K, key: string, data: Records[K]) {
    if (!database.current) return;
    void writeStore(database.current, name, key, data).catch(() => setStorageError('部分更改无法保存到浏览器，刷新后可能丢失。'));
  }
  function bind(trackId: string, binding: AudioBinding) {
    setBindings(old => new Map(old).set(trackId, binding));
    persist('bindings', trackId, binding);
  }
  function rememberLyrics(track: Track, result: FoundResult) {
    if (track.id.startsWith('demo-')) return;
    const record = { track, result };
    setLyrics(old => new Map(old).set(track.id, record));
    persist('lyrics', track.id, record);
  }
  async function importFiles(chosen: File[], forTrack?: string) {
    if (!ready || importing.current) return;
    importing.current = true; setBusy(true); setFeedback('正在读取文件标签和时长…');
    let added = 0, duplicates = 0, skipped = 0;
    try {
      for (const file of chosen) {
        if (!canImportAudio(file)) { skipped++; continue; }
        try {
          const local = await readAudio(file);
          if (workingFiles.current.has(local.id)) duplicates++;
          else {
            workingFiles.current.set(local.id, local); added++;
            if (database.current) {
              try { await writeStore(database.current, 'files', local.id, local); }
              catch { setStorageError('部分音频无法保存（浏览器存储可能已满），仅保留在此页面。'); }
            }
          }
          if (forTrack) bind(forTrack, { kind: 'local', audioId: local.id });
          if (added && added % 25 === 0) setFeedback(`已读入 ${added} 首，继续扫描…`);
        } catch { skipped++; }
      }
      setFiles([...workingFiles.current.values()]);
      setFeedback([added ? `已导入 ${added} 首` : '', duplicates ? `已有 ${duplicates} 首` : '',
        skipped ? `跳过 ${skipped} 个非音频、过大或无法读取的文件` : ''].filter(Boolean).join(' · ') || '没有可导入文件。');
    } finally { importing.current = false; setBusy(false); }
  }
  async function clearFiles() {
    if (importing.current) return;
    importing.current = true; setBusy(true);
    try {
      if (database.current) await writeStore(database.current, 'files');
      workingFiles.current.clear(); setFiles([]); setFeedback('已清空浏览器里的音频副本，未改动原文件。');
    } catch { setStorageError('无法清空浏览器曲库，请重试。'); }
    finally { importing.current = false; setBusy(false); }
  }

  return { files, bindings, lyrics, ready, busy, feedback, storageError, importFiles, clearFiles, bind, rememberLyrics };
}
export type AudioLibrary = ReturnType<typeof useAudioLibrary>;
