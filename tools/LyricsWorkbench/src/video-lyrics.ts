import { normalize, plainCandidate } from './match';
import type { LyricCandidate, LyricResult, Track } from './types';

// Credits supplied by video uploaders are lookup hints, not verified release metadata.
const gem = /^(?:g\.?\s*e\.?\s*m\.?\s*(?:[邓鄧]紫棋)?|[邓鄧]紫棋)$/iu;
const separator = /\s*[-–—－|｜]\s*/gu;
const variant = /\b(?:live|cover|mix|remix|edit|version|acoustic|instrumental|karaoke|demo|remaster(?:ed)?)\b|现场|現場|翻唱|伴奏|版本|纯音乐|純音樂/iu;
const jay = /^(?:周[杰傑][伦倫]|jay\s+chou|chou,\s*jay)$/iu;
const credit = (value: string) => jay.test(value.normalize('NFKC').trim()) ? '周杰伦' : gem.test(value.normalize('NFKC').trim()) ? '邓紫棋' : value.trim();
const lyricCredit = (value: string) => jay.test(value.normalize('NFKC').trim()) ? '周杰伦' : credit(value);
const isGem = (value: string) => credit(value) === '邓紫棋';

export function videoSongIdentity(raw: string, collection?: string): { title: string; artist: string } {
  const title = collection ? raw.replace(/^\s*\d{1,4}\s*[.．、)）]\s*(?=\S)/u, '') : raw;
  const namedCollection = collection?.match(/(?:^|[【\[])\s*([\p{Script=Han}A-Za-z·. ]{2,24}?)\s*(?:歌曲)?合[集輯]\s*[】\]]/u)?.[1];
  const parent = namedCollection ?? collection?.match(/(?:^|[】\]])\s*([^【】\[\]《》|｜:：]{1,30}?)\s*(?:的)?(?:经典|經典|热门|熱門|全)?(?:歌曲|金曲|单曲|單曲)\s*(?:\d+\s*首|精[选選]|合[集輯]|大全|全集)/u)?.[1];
  // Parse performer credits from the source post, never the user's search query.
  const known = /^(?:周[杰傑][伦倫]|伍佰|李克勤|[邓鄧]紫棋)$/u;
  const bracketCredits = [...(collection ?? '').matchAll(/【([^】]+)】/gu)].map(match => match[1].trim()).filter(value => known.test(value));
  const bareCredit = collection?.replace(/^(?:【[^】]+】) */, '').match(/^(周[杰傑][伦倫]|伍佰|李克勤|[邓鄧]紫棋) *(?:无损|無損|动态歌词|動態歌詞|歌曲|音乐|音樂)/u)?.[1];
  const performer = parent ?? (bracketCredits.length === 1 ? bracketCredits[0] : bareCredit);
  const collectionArtist = performer && !variant.test(performer) && !/等人|群星|播放量|最高|[0-9]|精[选選]/u.test(performer) ? credit(performer) : '';
  const cuts = [...title.matchAll(separator)];
  if (cuts.length) {
    const lastCut = cuts.at(-1)!;
    const last = title.slice(lastCut.index + lastCut[0].length);
    if (last && (isGem(last) || jay.test(last) || collectionArtist && credit(last) === collectionArtist)) {
      const name = title.slice(0, lastCut.index).trim();
      if (name) return { title: name, artist: credit(last) };
    }
    const firstCut = cuts[0];
    const first = title.slice(0, firstCut.index);
    if (first && (isGem(first) || jay.test(first) || collectionArtist && credit(first) === collectionArtist)) {
      const name = title.slice(firstCut.index + firstCut[0].length).trim();
      if (name) return { title: name, artist: credit(first) };
    }
  }
  const explicit = /^(.+?)\s+(?:[-–—－|｜])\s+(\p{Script=Han}{2,8})$/u.exec(title);
  if (explicit && !variant.test(explicit[2]) && (!collectionArtist || credit(explicit[2]) === collectionArtist)) {
    return { title: explicit[1].trim(), artist: credit(explicit[2]) };
  }
  return { title: title.trim(), artist: collectionArtist };
}

const qualityTag = /^(?:(?:[248]k|1080p|60(?:fps|帧)|hi[- ]?res|无损|無損|高清|超清|mv)[\s/+·]*)+$/iu;
const decoration = (value: string) => qualityTag.test(value.replace(/^(?:【(.+)】|\[(.+)\])$/u, '$1$2')) || /^(?:百万级)?录音棚试听$/u.test(value);

/** Read a lookup hint without renaming the source recording. Unlabeled credits are limited to known names. */
export function videoPostLyricIdentity(raw: string, existingArtist = ''): Pick<Track, 'title' | 'artist'> | undefined {
  let [main, ...suffix] = raw.trim().split(/\s*[|｜丨]\s*/u);
  if (!suffix.every(decoration) || variant.test(main)) return;
  for (let prefix = /^(?:【([^】]+)】|\[([^\]]+)\])\s*/u.exec(main); prefix && decoration(prefix[1] ?? prefix[2]);
    prefix = /^(?:【([^】]+)】|\[([^\]]+)\])\s*/u.exec(main)) main = main.slice(prefix[0].length);
  const after = /^《([^《》]+)》\s*[-–—－]*\s*(.+)$/u.exec(main);
  const before = /^([^《》]+?)\s*《([^《》]+)》$/u.exec(main);
  const separated = /^([^《》]+?)\s*[-–—－]+\s*([^《》]+)$/u.exec(main);
  const pair = after ? [after[1], after[2]] : before ? [before[2], before[1]] : separated?.slice(1);
  if (!pair) return;
  const [title, performer] = pair.map(value => value.trim());
  const labeled = /^(?:演唱|歌手|主唱)\s*[:：]\s*(.+)$/u.exec(performer)?.[1];
  const artist = lyricCredit(labeled ?? performer);
  if (existingArtist && normalize(lyricCredit(existingArtist)) !== normalize(artist)) return;
  if (title && (artist === '周杰伦' || isGem(artist) || labeled && /^\p{Script=Han}{2,8}$/u.test(artist))) return { title, artist };
}

function sameTitle(title: string, candidate: string) {
  if (normalize(title) === normalize(candidate)) return true;
  // A translated suffix is common in LRCLIB (e.g. “句号 - Full Stop”).
  // Do not treat a live/remix/version label as a translation.
  const bilingual = /^([\p{Script=Han}\d]+)\s+[-–—－]\s+([a-z][a-z\s'’!?,.]{0,60})$/iu.exec(candidate);
  return !!bilingual && !variant.test(bilingual[2]) && normalize(title) === normalize(bilingual[1]);
}

export function videoLyricQuery(track: Pick<Track, 'title' | 'artist'>) {
  return `${track.title} ${isGem(track.artist) ? 'G.E.M.' : lyricCredit(track.artist)}`;
}

export function matchesVideoLyricIdentity(track: Track, candidate: LyricCandidate) {
  return sameTitle(track.title, candidate.title) && normalize(lyricCredit(candidate.artist)) === normalize(lyricCredit(track.artist));
}

export function matchVideoLyrics(track: Track, candidates: LyricCandidate[]): LyricResult {
  const matching = new Map<string, LyricCandidate>();
  const distance = (candidate: LyricCandidate) => track.duration !== null && candidate.duration !== null
    ? Math.abs(track.duration - candidate.duration) : Infinity;
  for (const candidate of candidates.filter(c => !c.instrumental && matchesVideoLyricIdentity(track, c)).sort((a, b) => distance(a) - distance(b))) {
    const plain = plainCandidate(candidate);
    if (plain.plain && !matching.has(plain.plain)) matching.set(plain.plain, plain);
  }
  const [first, ...rest] = matching.values();
  if (!first) return { status: 'missing' };
  const close = [first, ...rest].filter(candidate => distance(candidate) <= 2);
  if (!rest.length || close.length === 1) return { status: 'plain', candidate: first };
  return { status: 'review', candidates: [first, ...rest].slice(0, 12) };
}
