import type { WorkspaceRow } from '../src/workbench';
import { videoLyricArtistHint } from '../src/video-lyrics';

export type UncreditedVideoSaveConsent =
  | { status: 'not-needed' }
  | { status: 'cancelled' }
  | { status: 'confirmed'; artistHint: string };

export function resolveUncreditedVideoSaveArtist(rows: readonly WorkspaceRow[], query: string,
  confirm: (message: string) => boolean): UncreditedVideoSaveConsent {
  const artistHint = videoLyricArtistHint(query);
  const titles = [...new Set(rows.flatMap(row => row.kind === 'song' && row.track.provider === 'bilibili-video' && !row.track.artist.trim()
    ? [row.track.title.trim()].filter(Boolean) : []))];
  if (!artistHint || !titles.length) return { status: 'not-needed' };
  const listed = titles.slice(0, 8).map(title => `• ${title}`).join('\n');
  const remainder = titles.length > 8 ? `\n另有 ${titles.length - 8} 首` : '';
  const message = `所选未署名的 B 站投稿将保存到“${artistHint}”目录：\n${listed}${remainder}\n\n请确认这些录音确属 ${artistHint}，且你有权保存完整音频。此选择只决定本地目录，不会把搜索词写成投稿署名。继续保存吗？`;
  return confirm(message) ? { status: 'confirmed', artistHint } : { status: 'cancelled' };
}


export function uncreditedVideoSavePayload(row: WorkspaceRow, confirmedArtistHint?: string) {
  return row.kind === 'song' && row.track.provider === 'bilibili-video' && !row.track.artist.trim() && confirmedArtistHint
    ? { saveArtistHint: confirmedArtistHint, confirmUncreditedSave: true as const }
    : {};
}
