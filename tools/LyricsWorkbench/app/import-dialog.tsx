import { useEffect, useRef, useState, type DragEvent } from 'react';
import { WorkbenchDialog } from './dialog';
import { audioAccept, canImportAudio, readDroppedFiles } from './local-files';
import { Icon } from './ui';

export function ImportDialog({ onDismiss, onImport }: { onDismiss: () => void; onImport: (files: File[]) => void }) {
  const [selection, setSelection] = useState<{ files: File[]; skipped: number }>();
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const scan = useRef<AbortController>(null);
  useEffect(() => () => scan.current?.abort(), []);

  function stage(files: File[], unreadable = 0) {
    const audio = files.filter(canImportAudio);
    setSelection({ files: audio, skipped: files.length - audio.length + unreadable });
  }

  async function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (scan.current) return;
    const task = new AbortController();
    scan.current = task;
    setReading(true);
    setSelection(undefined);
    try {
      const { files, unreadable } = await readDroppedFiles(event.dataTransfer, task.signal);
      if (!task.signal.aborted) stage(files, unreadable);
    } catch {
      if (!task.signal.aborted) stage([], 1);
    } finally {
      scan.current = null;
      if (!task.signal.aborted) setReading(false);
    }
  }

  return <WorkbenchDialog title="导入本地音频" icon="folder" onDismiss={onDismiss}
    description="音频仅保存在此浏览器，不上传，也不会改动原文件。">
    <div className={`import-drop${dragging ? ' is-dragging' : ''}`} aria-busy={reading}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; if (!reading) setDragging(true); }}
      onDragLeave={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDragging(false); }}
      onDrop={event => void drop(event)}>
      <Icon name="audio" size={23} />
      <strong>拖入文件夹或音频文件</strong>
      <span>会扫描子文件夹 · 单文件不超过 200 MiB</span>
      <label className="button ghost file-button">选择音频文件
        <input type="file" accept={audioAccept} multiple aria-label="选择音频文件" disabled={reading}
          onChange={event => {
            const files = Array.from(event.currentTarget.files ?? []);
            if (files.length) stage(files);
            event.currentTarget.value = '';
          }} />
      </label>
    </div>
    <div className="import-summary" role="status">
      {reading ? '正在扫描文件夹…' : selection ? <>
        <strong>{selection.files.length ? `已选 ${selection.files.length} 个音频文件` : '没有可导入的音频'}</strong>
        {selection.skipped > 0 && <span>跳过 {selection.skipped} 个非音频、过大或无法读取的文件</span>}
      </> : '选好后，确认再加入曲库。'}
    </div>
    <footer className="dialog-actions">
      <button type="button" className="button ghost" onClick={onDismiss}>取消</button>
      <button type="button" className="button primary" disabled={reading || !selection?.files.length}
        onClick={() => { if (selection?.files.length) onImport(selection.files); }}>确认导入</button>
    </footer>
  </WorkbenchDialog>;
}
