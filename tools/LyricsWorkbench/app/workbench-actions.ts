import { useEffect, useRef, useState } from 'react';
import { createArchive, exportEntries, lrcFilename, lyricText } from '../src/export';
import type { LyricScript } from '../src/lyric-script';
import { chooseLyrics, planLocalWrite, type LyricApproval, type WorkspaceRow } from '../src/workbench';
import type { CollectionItem } from '../src/types';
import type { LocalLyricChoice, LocalSaveResult, LocalTrack } from '../src/local-library-types';
import type { SongLocalSaveResult } from '../src/song-local-save';
import { canDownload, fetchSongFile, prepareSongBatch, songKey, trackPath } from './song-downloads';
import { failure } from './song-requests';
import { fetchDetail, jsonRequest, type WorkbenchDetail, type WorkbenchState } from './workbench-state';
import { download } from './ui';
import type { SavedFileLocation } from './workbench-save-locations';

const saveReason: Record<LocalSaveResult['status'], string> = { saved: '已保存', exists: '已有歌词', changed: '音频或歌词文件已变化，请重新搜索',
  review: '歌词候选过期或未通过核对，请重新查词', ambiguous: '存在同名音频，未写入', unsynced: '没有可用时码，未保存歌词',
  'different-lyrics': '时码版本的文字与本地歌词不同，已保留原文件', error: '写入失败' };
export function useWorkbenchActions(state: WorkbenchState, choices: ReadonlyMap<string, number>, lyricScript: LyricScript) {
  const [job, setJob] = useState<{ busy: boolean; mode?: 'save' | 'export'; message: string; error?: boolean; files?: SavedFileLocation[] }>();
  const [audioFiles, setAudioFiles] = useState<ReadonlyMap<string, Blob>>(new Map());
  const [downloadedKeys, setDownloadedKeys] = useState<ReadonlySet<string>>(new Set());
  const task = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => task.current?.abort(), []);
  function remember(entries: readonly { item: { provider: string; id: string }; audio: Blob }[]) {
    setDownloadedKeys(before => new Set([...before, ...entries.map(entry => `${entry.item.provider}:${entry.item.id}`)]));
    setAudioFiles(before => {
      const next = new Map(before);
      for (const entry of entries) { const key = `${entry.item.provider}:${entry.item.id}`; next.delete(key); next.set(key, entry.audio); }
      let bytes = [...next.values()].reduce((n, blob) => n + blob.size, 0);
      for (const [key, blob] of next) { if (bytes <= 160 * 1024 * 1024) break; next.delete(key); bytes -= blob.size; }
      return next;
    });
  }
  async function resolve(row: WorkspaceRow, signal: AbortSignal): Promise<WorkbenchDetail> {
    if (state.detail?.key === row.key && !['running', 'pending', 'error'].includes(state.detail.result.status)) return state.detail;
    const version = state.versions.get(row.key);
    const cacheKey = version ? `${row.key}/${songKey(version)}` : row.key;
    const cached = state.cache.current.get(cacheKey);
    if (cached && cached.result.status !== 'error') return cached;
    const data = await fetchDetail(row, signal, version, undefined, false, state.submitted);
    signal.throwIfAborted();
    if (data.result.status !== 'error') state.cache.current.set(cacheKey, data);
    return data;
  }
  async function run(rows: WorkspaceRow[], mode: 'save' | 'export', explicit?: { key: string; approval: LyricApproval }) {
    if (!rows.length || task.current) return;
    const controller = new AbortController(); task.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]);
    const targets = rows.slice(0, 50);
    let done = 0, pairedLyrics = 0, addedLyrics = 0, standaloneLyrics = 0, existingSongs = 0, existingLyrics = 0;
    const skipped: string[] = [], lyricWarnings: string[] = [];
    let plainLyrics = 0, existingPlainLyrics = 0;
    const files: SavedFileLocation[] = [];
    function recordSave(row: WorkspaceRow, result: SongLocalSaveResult) {
      switch (result.status) {
        case 'saved': done++; if (result.lyrics) pairedLyrics++; break;
        case 'lyrics-added': addedLyrics++; break;
        case 'lyrics-saved': standaloneLyrics++; break;
        case 'exists': if (result.audio) existingSongs++; else existingLyrics++; break;
        case 'conflict': skipped.push(`${row.track.title}：存在重复来源或同名文件冲突，未改动`); break;
      }
      if (result.lyricsKind === 'plain' && result.lyrics) {
        if (result.status === 'exists') existingPlainLyrics++;
        else plainLyrics++;
      }
      if (result.coverIssue) lyricWarnings.push(`${row.track.title}：歌曲已保存，投稿封面${result.coverIssue === 'missing' ? '缺失' : '暂时下载失败'}`);
      if (result.lyricsIssue) {
        const reason = result.lyricsIssue === 'review' ? '有多个歌词版本，请选择版本后重试' : result.lyricsIssue === 'unsynced' ? '未核对到这版音频的同步时码'
          : result.lyricsIssue === 'unavailable' ? '歌词来源暂不可用，可稍后重试' : '未找到匹配的歌词';
        lyricWarnings.push(`${row.track.title}：音频已在曲库，歌词未保存（${reason}）`);
      }
      if (result.status !== 'conflict') {
        if (result.audio || result.lyrics) files.push({ title: row.track.title, audio: result.audio, lyrics: result.lyrics });
        if (result.audio) setDownloadedKeys(before => new Set(before).add(row.key));
      }
    }
    const texts: CollectionItem[] = [];
    const locals = new Map<string, LocalTrack>();
    const localChoices: LocalLyricChoice[] = [];
    const songs = targets.flatMap(row => row.kind === 'song' && canDownload(row.track) ? [
      state.detail?.key === row.key && state.detail.song ? state.detail.song : row.track,
    ] : []);
    setJob({ busy: true, mode, message: mode === 'save' ? '正在保存到本地曲库…' : '正在准备导出…' });
    try {
      if (mode === 'export' && targets.length === 1 && songs.length === 1) {
        const file = await fetchSongFile(songs[0], signal, undefined, lyricScript);
        signal.throwIfAborted(); remember([{ item: songs[0], audio: file.audio }]); download(file.name, file.file);
        setJob({ busy: false, message: `已发起「${songs[0].title}」的${songs[0].availability === 'audio-only' ? ' MP3 下载；未附加其他版本歌词。' : '音频与配套歌词下载。'}` }); return;
      }
      for (const [index, row] of targets.entries()) {
        signal.throwIfAborted();
        setJob({ busy: true, mode, message: `${mode === 'save' ? '保存' : '准备导出'} ${index + 1}/${targets.length} · ${row.track.title}` });
        if (row.kind === 'song' && (canDownload(row.track) || mode === 'save' && row.track.provider === 'lrclib')) {
          if (mode === 'save') {
            try {
              const track = state.versions.get(row.key) ?? (state.detail?.key === row.key ? state.detail.song : undefined) ?? row.track;
              const result = await jsonRequest<SongLocalSaveResult>(`${trackPath(track)}/save`, signal,
                { lyricScript, ...(track.provider === 'bilibili-video' && choices.has(row.key) ? { candidateId: choices.get(row.key) } : {}), ...(track.provider === 'lrclib' && track.id !== row.track.id ? { alternate: true } : {}) });
              recordSave(row, result);
            } catch (error) { signal.throwIfAborted(); skipped.push(`${row.track.title}：${failure(error).message}`); }
          }
          continue;
        }
        if (mode === 'save' && row.kind === 'song') { skipped.push(`${row.track.title}：该来源未开放音频下载，也没有可单独保存的歌词`); continue; }
        try {
          const detail = await resolve(row, signal);
          if (mode === 'save' && detail.local) {
            if (detail.local.hasLyrics && detail.local.lyricsKind !== 'plain') { existingLyrics++; continue; }
            if (detail.local.lyricsKind === 'plain' && detail.timing?.status !== 'review') {
              skipped.push(`${row.track.title}：已有纯文本，请打开这一首单独查找时码`); continue;
            }
            const plan = planLocalWrite(detail.local, detail.timing ?? detail.result, choices.get(row.key), targets.length === 1 && explicit?.key === row.key ? explicit.approval : undefined);
            if (plan.status === 'ready') localChoices.push(plan.choice);
            else {
              const reason = plan.status === 'upgrade-approval' ? '已有纯文本，请打开这一首单独补时码'
                : plan.status === 'version-approval' ? '请先在右侧选择匹配的歌词版本'
                : '没有核对到可用时码，歌词未保存';
              skipped.push(`${row.track.title}：${reason}`);
            }
            continue;
          }
          if (mode === 'save' && row.kind === 'catalog') {
            const candidateId = choices.get(row.key);
            if (detail.result.status === 'review' && candidateId === undefined) {
              skipped.push(`${row.track.title}：请先选择歌词版本，再保存`); continue;
            }
            recordSave(row, await jsonRequest<SongLocalSaveResult>('/api/local-library/lyrics-only', signal, { track: row.track, candidateId, lyricScript }));
            continue;
          }
          const candidateId = choices.get(row.key);
          const chosen = chooseLyrics(candidateId !== undefined && detail.timing?.status === 'review' ? detail.timing : detail.result, candidateId, detail.track);
          if (!chosen || lyricText(chosen.result) === null) { skipped.push(`${row.track.title}：暂无可导出的歌词，或需要选择版本`); continue; }
          texts.push({ track: detail.track, result: chosen.result });
          if (detail.local) locals.set(detail.local.id, detail.local);
        } catch (error) { signal.throwIfAborted(); skipped.push(`${row.track.title}：${failure(error).message}`); }
      }
      if (localChoices.length) {
        const response = await jsonRequest<{ results: LocalSaveResult[] }>('/api/local-library/save', signal, { tracks: localChoices, lyricScript });
        const saved = new Set<string>();
        for (const result of response.results) {
          const row = targets.find(row => row.kind === 'local' && row.track.id === result.id);
          const title = row?.track.title ?? '歌曲';
          if (result.status === 'saved') { addedLyrics++; saved.add(result.id); }
          else if (result.status === 'exists') existingLyrics++;
          else { skipped.push(`${title}：${saveReason[result.status]}`); continue; }
          if (result.file) files.push({ title, ...(row?.kind === 'local' ? { audio: row.track.file } : {}), lyrics: result.file });
        }
        state.markLocalSaved(saved);
      }
      if (mode === 'export') {
        const data = exportEntries(texts, locals, lyricScript);
        if (targets.length === 1 && data.files.length === 1 && !songs.length) {
          download(data.files[0].name.split('/').at(-1) ?? lrcFilename(targets[0].track.title), new Blob([data.files[0].text], { type: 'text/plain;charset=utf-8' }));
          done = 1;
        } else {
          const songBatch = songs.length ? await prepareSongBatch(songs, signal,
            progress => setJob({ busy: true, mode, message: `下载 ${progress.current}/${progress.total} · ${progress.title ?? ''}` }), undefined, undefined, lyricScript) : undefined;
          if (songBatch) {
            remember(songBatch.completed); done += songBatch.completed.length;
            for (const track of songBatch.remaining) skipped.push(`${track.title}：${songBatch.error?.message ?? '未能下载'}`);
          }
          signal.throwIfAborted();
          if (songBatch?.archive) {
            const { default: JSZip } = await import('jszip');
            const zip = await JSZip.loadAsync(songBatch.archive);
            for (const file of data.files) {
              let name = file.name, n = 2;
              while (zip.file(name)) name = `${file.name.slice(0, -4)} [歌词 ${n++}].lrc`;
              zip.file(name, file.text);
            }
            if (data.files.length) zip.file('lyrics-manifest.json', JSON.stringify(data.manifest, null, 2));
            const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
            signal.throwIfAborted(); download('听页-歌曲与歌词.zip', archive);
          } else if (data.files.length) {
            const archive = await createArchive(data); signal.throwIfAborted(); download('听页-歌词.zip', new Blob([archive]));
          }
          done += data.files.length;
        }
      }
      const summary = mode === 'save' ? [done && `已保存 ${done} 首歌曲${pairedLyrics ? `（含 ${pairedLyrics} 份配套歌词）` : ''}`, addedLyrics && `已保存 ${addedLyrics} 首歌词`,
        standaloneLyrics && `已保存 ${standaloneLyrics} 份独立歌词（无音频）`, existingSongs && `${existingSongs} 首已在曲库`, existingLyrics && `${existingLyrics} 份歌词已存在`].filter(Boolean) : [];
      if (plainLyrics) lyricWarnings.push(`${plainLyrics} 份歌词已保存为纯文本（无时码，不进行逐句同步）`);
      if (existingPlainLyrics) lyricWarnings.push(`${existingPlainLyrics} 份已有歌词是纯文本（无时码，可在本地曲库查找时码）`);
      const limit = rows.length > 50 ? '每次最多处理 50 首，请继续处理剩余歌曲。' : '';
      if (mode === 'save') {
        const notes = skipped.length ? `未处理 ${skipped.length} 首：${skipped.slice(0, 3).join('；')}${skipped.length > 3 ? '…' : '。'}` : '';
        const warnings = lyricWarnings.length ? `${lyricWarnings.slice(0, 3).join('；')}${lyricWarnings.length > 3 ? ` 等 ${lyricWarnings.length} 首。` : '。'}` : '';
        setJob({ busy: false, error: !summary.length, files, message: `${summary.length ? `${summary.join(' · ')}。` : ''}${warnings}${notes}${limit}` });
      } else setJob({ busy: false, error: done === 0, message: `导出 ${done} 首${skipped.length ? `，跳过 ${skipped.length} 首。${skipped.slice(0, 3).join('；')}` : '，下载已发起。'}${limit}` });
    } catch (error) {
      if (!controller.signal.aborted) setJob({ busy: false, error: true, files, message: `${done + addedLyrics + standaloneLyrics ? `已写入 ${done + addedLyrics + standaloneLyrics} 项。` : ''}${signal.aborted ? '处理超时；请检查已保存文件后重试，已有文件不会覆盖。' : failure(error).message}` });
    } finally { if (task.current === controller) task.current = undefined; }
  }
  return { job, audioFiles, downloadedKeys, run, clearJob: () => { if (!task.current) setJob(undefined); } };
}
