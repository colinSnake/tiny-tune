import type { WorkspaceRow } from '../src/workbench';
import { videoLyricArtistHint } from '../src/video-lyrics';

/** A search hint selects the local folder without changing the source recording credit. */
export function uncreditedVideoSavePayload(row: WorkspaceRow, query = '') {
  const artistHint = videoLyricArtistHint(query);
  return row.kind === 'song' && row.track.provider === 'bilibili-video' && !row.track.artist.trim() && artistHint
    ? { saveArtistHint: artistHint }
    : {};
}
