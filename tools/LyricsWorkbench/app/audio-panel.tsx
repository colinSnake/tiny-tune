import { useState, type ReactNode } from 'react';
import { parseAudioLink, type AudioCoverage } from '../src/audio';
import { formatTime } from '../src/lrc';
import type { Track } from '../src/types';
import type { AudioLibrary, LocalAudio } from './audio-library';
import { WorkbenchDialog } from './dialog';
import { ImportDialog } from './import-dialog';
import { audioAccept } from './local-files';
import { Icon } from './ui';

export function LibraryControls({ library }: { library: AudioLibrary }) {
  const [dialog, setDialog] = useState<'import' | 'clear' | null>(null);
  const unavailable = !library.ready || library.busy;
  const dismiss = () => setDialog(null);
  return <div className="library-strip">
    <div className="library-heading"><span className="library-icon"><Icon name="folder" size={20} /></span>
      <div><strong>本地曲库 <span>{library.files.length} 首</span></strong><p>一次导入，自动找同版本。音频不上传。</p></div>
    </div>
    <div className="library-actions">
      <button type="button" className="button ghost" aria-haspopup="dialog" disabled={unavailable} onClick={() => setDialog('import')}>
        <Icon name="folder" size={16} />导入本地音频
      </button>
      {library.files.length > 0 && <button type="button" className="button text-button" aria-haspopup="dialog" disabled={unavailable}
        onClick={() => setDialog('clear')}>清空曲库</button>}
    </div>
    {(library.feedback || library.storageError) && <div className="library-feedback">
      {library.feedback && <span role="status">{library.feedback}</span>}
      {library.storageError && <p className="error-text" role="alert">{library.storageError}</p>}
    </div>}
    {dialog === 'import' && <ImportDialog onDismiss={dismiss} onImport={files => { dismiss(); void library.importFiles(files); }} />}
    {dialog === 'clear' && <WorkbenchDialog icon="folder" title="清空本地曲库？" onDismiss={dismiss}
      description={`将移除此浏览器里的 ${library.files.length} 个音频副本。原文件和已保存的歌词不会被删除。`}>
      <footer className="dialog-actions">
        <button type="button" className="button ghost" onClick={dismiss}>取消</button>
        <button type="button" className="button danger" disabled={unavailable} onClick={() => { dismiss(); void library.clearFiles(); }}>清空音频</button>
      </footer>
    </WorkbenchDialog>}
  </div>;
}

export type PlayerSource = {
  key: string; label: string; provenance: string; coverage: AudioCoverage; file?: Blob; url?: string; localName?: string;
};

export function AudioPanel({ track, source, candidates, library, missing, children, fixed = false }: {
  track: Track; source?: PlayerSource; candidates: LocalAudio[]; library: AudioLibrary; missing: boolean; children?: ReactNode; fixed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [coverage, setCoverage] = useState<AudioCoverage>('full');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const choices = candidates.length ? candidates : library.files;
  const blocked = !library.ready || library.busy;
  return <section className="listening-deck" aria-label="音源与播放">
    <div className="deck-head"><span className="deck-icon"><Icon name={source ? 'wave' : 'audio'} size={19} /></span>
      <div><strong>{source ? source.label : missing ? '原音源不在曲库中' : '暂无可播放音源'}</strong>
        <small>{source ? source.provenance : !library.ready ? '正在读取本地曲库' : candidates.length ? '找到可能的版本，请核对后绑定' : '导入本地音频，或添加你有权播放的直链'}</small></div>
      {source && <span className="source-badge">{source.coverage === 'clip' ? '试听片段' : '整曲音源'}</span>}
    </div>
    {children}
    {!fixed && <div className="deck-actions">
      <label className="button ghost file-button"><Icon name="audio" size={15} />{source ? '换用本地文件' : '选择本地音频'}
        <input type="file" accept={audioAccept} aria-label="为这首选择本地音频" disabled={blocked}
          onChange={e => { const file = e.currentTarget.files?.[0]; if (file) void library.importFiles([file], track.id); e.currentTarget.value = ''; }} />
      </label>
      <button type="button" className="button text-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起音源选项' : '更多音源'}</button>
      {source && !track.id.startsWith('demo-') && <button type="button" disabled={blocked} className="button text-button unlink" onClick={() => library.bind(track.id, { kind: 'none' })}>解除绑定</button>}
    </div>}
    {!fixed && (!source && candidates.length > 0 || open) && <div className="source-options">
      {choices.length > 0 && <div className="source-field">
        <label htmlFor="library-audio">{candidates.length ? `本地候选 · ${candidates.length} 首` : '从本地曲库选择'}</label>
        <div className="source-field-row"><select id="library-audio" value={selected} onChange={e => setSelected(e.target.value)}>
          <option value="">选择录音版本</option>
          {choices.map(file => <option key={file.id} value={file.id}>{[file.name, file.artist, file.album, file.duration !== null ? formatTime(file.duration) : '时长未知'].filter(Boolean).join(' · ')}</option>)}
        </select>
        <button type="button" className="button primary" disabled={blocked || !choices.some(file => file.id === selected)}
          onClick={() => { library.bind(track.id, { kind: 'local', audioId: selected }); setOpen(false); }}>确认绑定</button></div>
      </div>}
      {open && <form className="source-field link-form" onSubmit={e => {
        e.preventDefault(); setError('');
        const parsed = parseAudioLink(url);
        if (!parsed) { setError('请输入不含账号密码的 HTTPS 音频直链（本机可使用 HTTP）。'); return; }
        if (blocked) return;
        library.bind(track.id, { kind: 'link', url: parsed, coverage }); setUrl(''); setOpen(false);
      }}>
        <label htmlFor="audio-link"><Icon name="link" size={15} /> 授权音频直链</label>
        <input id="audio-link" type="text" inputMode="url" autoComplete="off" placeholder="https://…/track.mp3" value={url} onChange={e => setUrl(e.target.value)} maxLength={4096} required />
        <div className="source-field-row"><select aria-label="直链音频范围" value={coverage} onChange={e => setCoverage(e.target.value === 'clip' ? 'clip' : 'full')}>
          <option value="full">同版本整曲</option><option value="clip">仅试听片段</option>
        </select><button type="submit" className="button primary" disabled={blocked || !url.trim()}>绑定直链</button></div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <small>使用可直接播放的音频地址（不是歌曲网页），链接保存在此浏览器。</small>
      </form>}
    </div>}
  </section>;
}
