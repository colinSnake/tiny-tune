import { lyricText } from './export';
import { candidateResult, normalize, plainCandidate } from './match';
import { fitsLocalRecording, matchesLocalLyricIdentity, type LocalTrack } from './local-library-types';
import { rankSongs, type SongSummary, type SongAvailability } from './song-types';
import type { ItemState, Track } from './types';

// Choosing content does not establish that another recording's timestamps match.
export function chooseLyrics(state: ItemState, id?: number, local?: Track) {
  const candidate = state.status === 'review'
    ? id === undefined ? state.candidates[0] : state.candidates.find(c => c.id === id)
    : 'candidate' in state ? state.candidate : undefined;
  if (!candidate || candidateResult(candidate).status === 'missing') return;
  const sameIdentity = !local || matchesLocalLyricIdentity(local, candidate);
  // Video candidates are already screened by song/artist on the server; the default is a preview only.
  if (local?.id.startsWith('bilibili-video:')) {
    return { candidate, result: candidateResult(plainCandidate(candidate)), mode: 'plain' as const };
  }
  if (state.status === 'review' && id === undefined && !sameIdentity) return;
  const mode = local && (!sameIdentity || !fitsLocalRecording(local, candidate) ||
    (local as Partial<LocalTrack>).confirmTiming && state.status === 'review' && id === undefined) ? 'plain' as const : 'original' as const;
  const result = candidateResult(mode === 'plain' ? plainCandidate(candidate) : candidate);
  return { candidate, result, mode };
}

export type WorkspaceRow = { key: string } & (
  | { kind: 'local'; track: LocalTrack }
  | { kind: 'catalog'; track: Track }
  | { kind: 'song'; track: SongSummary; versions: SongSummary[] }
);
export function workspaceRows(local: LocalTrack[], catalog: Track[], songs: readonly SongSummary[], query: string, availability: ReadonlyMap<string, SongAvailability> = new Map()): WorkspaceRow[] {
  const rows: WorkspaceRow[] = local.map(track => ({ key: track.id, kind: 'local', track }));
  const otherRows: WorkspaceRow[] = catalog.map(track => ({ key: `catalog:${track.id}`, kind: 'catalog', track }));
  const lyrics = new Map<string, Extract<WorkspaceRow, { kind: 'song' }>>();
  for (const track of rankSongs(songs.map(track => availability.has(`${track.provider}:${track.id}`) ? { ...track, availability: availability.get(`${track.provider}:${track.id}`)! } : track), query)) {
    const key = `${track.provider}:${track.id}`;
    if (track.provider === 'lrclib') {
      const identity = JSON.stringify([normalize(track.title), normalize(track.artist)]);
      const previous = lyrics.get(identity);
      if (previous) { previous.versions.push(track); continue; }
      const row = { key, kind: 'song' as const, track, versions: [track] };
      lyrics.set(identity, row); otherRows.push(row);
    } else (hasDownloadableAudio(track.availability) ? rows : otherRows).push({ key, kind: 'song', track, versions: [track] });
  }
  return [...rows, ...otherRows];
}

export function localSearchTerms(names: string[]) {
  return [...new Set(names.map(name => name.trim()).filter(name => name.length > 0 && name.length <= 120))].slice(0, 12);
}

const hasDownloadableAudio = (availability: SongAvailability) => availability === 'ready' || availability === 'audio-only';
const isLyricOnly = (row: WorkspaceRow) => row.kind === 'catalog' || row.kind === 'song' && row.track.availability === 'lyrics-only';

export function selectionSaveNotice(rows: readonly WorkspaceRow[]) {
  const count = rows.filter(isLyricOnly).length;
  if (count) return `所选结果中 ${count} 项仅提供歌词：如有可保存的歌词，将放入来源歌手的「独立歌词」子目录，不会保存音频。`;
}

export type RowPresentation = { status: '已下载' | '未下载' | '仅歌词' | '仅试听' | '待核验' | '不可下载'; downloaded: boolean; canDownload: boolean; canPreview: boolean };

export function rowPresentation(row: WorkspaceRow, downloaded: ReadonlySet<string> = new Set()): RowPresentation {
  if (row.kind === 'local') return { status: '已下载', downloaded: true, canDownload: false, canPreview: true };
  if (row.kind === 'catalog' || row.track.availability === 'lyrics-only') return { status: '仅歌词', downloaded: false, canDownload: false, canPreview: false };
  const { availability } = row.track;
  const canDownload = hasDownloadableAudio(availability);
  const isDownloaded = downloaded.has(row.key);
  const status = isDownloaded ? '已下载' : canDownload ? '未下载' : availability === 'stream-only' ? '仅试听' : availability === 'review' ? '待核验' : '不可下载';
  return { status, downloaded: isDownloaded, canDownload, canPreview: true };
}

export type LyricApproval = { candidateId: number; mode: 'original' | 'plain' };
export function planLocalWrite(track: LocalTrack, result: ItemState, choiceId?: number, approval?: LyricApproval) {
  const effectiveId = choiceId ?? (approval?.mode === 'original' ? approval.candidateId : undefined);
  const chosen = chooseLyrics(result, effectiveId, track);
  if (!chosen || lyricText(chosen.result) === null) return { status: 'missing' as const };
  if (result.status === 'review' && effectiveId === undefined && track.confirmTiming) return { status: 'version-approval' as const };
  if (chosen.mode !== 'original' || chosen.result.status !== 'timed') return { status: 'unsynced' as const };
  if (result.status === 'review' && effectiveId === undefined) return { status: 'version-approval' as const };
  const upgradePlain = track.lyricsKind === 'plain';
  if (upgradePlain && (approval?.candidateId !== chosen.candidate.id || approval.mode !== 'original')) return { status: 'upgrade-approval' as const };
  return { status: 'ready' as const, choice: { id: track.id, candidateId: chosen.candidate.id, confirmed: result.status === 'review' || upgradePlain,
    mode: chosen.mode, ...(upgradePlain ? { upgradePlain: true } : {}) } };
}
