export type SavedFileLocation = { title: string; audio?: string; lyrics?: string };

export function WorkbenchSaveLocations({ root, files }: { root: string; files: readonly SavedFileLocation[] }) {
  if (!files.length) return null;
  const fullPath = (relative: string) => `${root.replace(/[\\/]+$/, '')}/${relative}`;
  return <details className="wb-save-locations">
    <summary>查看保存位置</summary>
    <ul>
      {files.map(({ title, audio, lyrics }, index) => <li key={index}>
        <strong>{title}{!audio && ' · 仅歌词（无音频）'}</strong>
        {audio && <div>音频：<code>{fullPath(audio)}</code></div>}
        {lyrics && <div>歌词：<code>{fullPath(lyrics)}</code></div>}
      </li>)}
    </ul>
  </details>;
}
