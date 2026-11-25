import { formatLyricText } from '../src/lyric-script';
import { normalize } from '../src/match';
import type { Track } from '../src/types';
import { videoPostLyricIdentity } from '../src/video-lyrics';

type SongName = Pick<Track, 'title' | 'artist'>;

/** Presentation only: uploader decorations never change a song's identity or saved name. */
export function workbenchSongLabel(track: SongName, video: boolean, hint?: SongName) {
  if (!video) return { ...track, edition: '' };
  const raw = track.title;
  const identity = hint ?? videoPostLyricIdentity(raw, track.artist);
  const quoted = [...raw.matchAll(/《([^《》]+)》/gu)];
  const title = identity?.title || (quoted.length === 1 ? quoted[0][1] : raw);
  const artist = identity?.artist || track.artist;
  const quality = raw.match(/\b([248]k)\s*(?:(60)\s*(帧|fps))?/iu);
  const edition = /录音棚试听/u.test(raw) ? '录音棚试听版'
    : /循环单曲/u.test(raw) ? '循环单曲'
    : /翻唱|外语版/u.test(raw) ? '翻唱版本'
    : quality ? [quality[1].toUpperCase(), quality[2] && `${quality[2]} ${quality[3].toUpperCase()}`, /\bMV\b/iu.test(raw) && 'MV'].filter(Boolean).join(' ')
    : /hi[- ]?res|无损/iu.test(raw) ? 'Hi-Res 试听版'
    : raw === title ? 'B 站投稿' : raw.replace(`《${title}》`, '').replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '') || 'B 站投稿';
  return { title, artist, edition };
}

const creditLine = /^\s*(?:作[词詞曲]|[词詞曲]|编曲|編曲|演唱|制作|製作|編製|编制)\s*[:：]\s*\S/u;
function metadataKey(value: string) { return normalize(formatLyricText(value)); }
function unquote(value: string) { return value.replace(/^《(.+)》$/u, '$1'); }

/** Only peel off an explicit leading title and adjacent credits, not lyrics later in the document. */
export function plainLyricReading(text: string, song: SongName, candidate?: SongName) {
  const lines = text.trim().split(/\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/u);
  const first = metadataKey(lines[0]);
  const titles = [song.title, candidate?.title].filter((value): value is string => !!value).map(value => unquote(metadataKey(value)));
  const names = [song.artist, candidate?.artist].filter((value): value is string => !!value).map(metadataKey);
  const [heading, artist, ...rest] = first.split(/\s+[-—–]\s+/u);
  const next = lines.slice(1).find(line => line.trim());
  const isTitle = artist ? !rest.length && titles.includes(unquote(heading)) &&
    (names.includes(artist) || names.includes(artist.replace(/\s+\([^()]+\)$/u, ''))) :
    titles.includes(unquote(first)) && !!next && creditLine.test(next);
  const credits: string[] = [];
  let start = isTitle && lines.length > 1 ? 1 : 0;
  while (start < lines.length) {
    if (creditLine.test(lines[start])) credits.push(lines[start].trim());
    else if (lines[start].trim()) break;
    start++;
  }
  const body = lines.slice(start < lines.length ? start : 0);
  return { credits: start < lines.length ? credits : [], stanzas: body.join('\n').split(/\n(?:[^\S\n]*\n)+/u).map(verse => verse.split('\n').map(line => line.trim()).filter(Boolean)).filter(verse => verse.length) };
}
