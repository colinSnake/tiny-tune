export const audioAccept = 'audio/*,.mp3,.m4a,.flac,.wav,.aac,.ogg,.opus,.aif,.aiff,.alac,.wma,.mp4';
const audioExtension = /\.(mp3|m4a|flac|wav|aac|ogg|opus|aiff?|alac|wma|mp4)$/i;
const maxAudioSize = 200 * 1024 * 1024;

export function canImportAudio(file: File) {
  return file.size > 0 && file.size <= maxAudioSize && (file.type.startsWith('audio/') || audioExtension.test(file.name));
}

export async function readDroppedFiles(transfer: DataTransfer, signal: AbortSignal) {
  // Capture entries during the drop event, before DataTransfer becomes inaccessible.
  const dropped = Array.from(transfer.items).filter(item => item.kind === 'file').map(item => {
    const entry = item.webkitGetAsEntry?.();
    return { entry, file: entry ? null : item.getAsFile() };
  });
  if (!dropped.some(item => item.entry)) return { files: Array.from(transfer.files), unreadable: 0 };

  const files: File[] = [];
  let unreadable = 0;
  async function visit(entry: FileSystemEntry) {
    signal.throwIfAborted();
    try {
      if (entry.isFile) {
        files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        while (!signal.aborted) {
          const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
          if (!batch.length) break;
          for (const child of batch) await visit(child);
        }
      }
    } catch {
      signal.throwIfAborted();
      unreadable++;
    }
  }
  for (const { entry, file } of dropped) {
    if (entry) await visit(entry);
    else if (file) files.push(file);
    else unreadable++;
  }
  signal.throwIfAborted();
  return { files, unreadable };
}
