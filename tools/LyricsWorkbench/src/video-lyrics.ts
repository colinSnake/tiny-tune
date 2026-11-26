import { normalize, plainCandidate } from './match';
import type { LyricCandidate, LyricResult, Track } from './types';

// Credits supplied by video uploaders are lookup hints, not verified release metadata.
const gem = /^(?:g\.?\s*e\.?\s*m\.?\s*(?:[邓鄧]紫棋)?|[邓鄧]紫棋)$/iu;
const separator = /\s*[-–—－|｜]\s*/gu;
const variant = /\b(?:live|cover|mix|remix|edit|version|acoustic|instrumental|karaoke|demo|remaster(?:ed)?)\b|现场|現場|翻唱|伴奏|版本|纯音乐|純音樂/iu;
const jay = /^(?:周[杰傑][伦倫]|jay\s+chou|chou,\s*jay)$/iu;
const zhangJie = /^张杰$/u;
const knownPerformer = /^(?:周[杰傑][伦倫]|伍佰|李克勤|[邓鄧]紫棋|张杰|張杰|王力宏)$/u;
const credit = (value: string) => jay.test(value.normalize('NFKC').trim()) ? '周杰伦'
  : gem.test(value.normalize('NFKC').trim()) ? '邓紫棋' : zhangJie.test(value.normalize('NFKC').trim()) ? '张杰' : value.trim();
const lyricCredit = (value: string) => jay.test(value.normalize('NFKC').trim()) ? '周杰伦' : credit(value);
const isGem = (value: string) => credit(value) === '邓紫棋';

/** Resolve a narrow set of exact search aliases for lyric lookup only, never source metadata. */
export function videoLyricArtistHint(query: string): string | undefined {
  const normalized = normalize(query).replace(/[^\p{L}\p{N}]/gu, '');
  return ['梦龙乐队', '梦龙', 'imaginedragons'].includes(normalized) ? 'Imagine Dragons' : undefined;
}
const collectionLabel = /^(?:(?:的|經典|经典|熱門|热门|精選|精选|國語|国语|粵語|粤语|全|歌曲|單曲|单曲|金曲|華語|华语|音樂|音乐|無損|无损|高清|超清|怀旧|懷舊|合[集輯])\s*)+$/u;
const isPerformer = (value: string) => !!value.trim() && !variant.test(value) && !collectionLabel.test(value.trim()) &&
  !/等人|群星|播放量|最高|[0-9]|精[选選]/u.test(value);

/** Only strip a grouped credit when it begins with an independently known performer. */
export function stripVideoCoCredits(title: string, artist: string): string {
  if (!artist) return title;
  const isGroup = (value: string) => {
    const [lead, ...others] = value.split(/\s*[/／]\s*/u);
    return credit(lead) === artist && others.length > 0 && others.every(name => /^\p{Script=Han}{2,8}$/u.test(name) && !variant.test(name));
  };
  const cuts = [...title.matchAll(separator)];
  if (!cuts.length) return title;
  const first = cuts[0], last = cuts.at(-1)!;
  const before = title.slice(0, last.index).trim(), after = title.slice(first.index + first[0].length).trim();
  if (before && isGroup(title.slice(last.index + last[0].length).trim())) return before;
  if (after && isGroup(title.slice(0, first.index).trim())) return after;
  return title;
}

export function videoSongIdentity(raw: string, collection?: string): { title: string; artist: string } {
  const title = collection ? raw.replace(/^\s*\d{1,4}\s*[.．、)）]\s*(?=\S)/u, '') : raw;
  const namedCollection = collection?.match(/(?:^|[【\[])\s*([\p{Script=Han}A-Za-z·. ]{2,24}?)\s*(?:歌曲)?合[集輯]\s*[】\]]/u)?.[1];
  const parent = namedCollection ?? collection?.match(/(?:^|[】\]])\s*([^【】\[\]《》|｜:：]{1,30}?)\s*(?:的)?(?:经典|經典|热门|熱門|全)?(?:歌曲|金曲|单曲|單曲)\s*(?:\d+\s*首|精[选選]|合[集輯]|大全|全集)/u)?.[1];
  // A bracketed name is reliable even for an unfamiliar performer when the part repeats it.
  // Do not interpret adjacent labels such as “经典歌曲合集” as a performer.
  const bracketNames = [...(collection ?? '').matchAll(/【([^】]+)】/gu)].map(match => match[1].trim());
  const credits = new Set(bracketNames.filter(value => /^\p{Script=Han}{2,8}$/u.test(value) && isPerformer(value)).map(credit));
  const part = title.replace(/\s*[-–—－]+\s*$/u, '');
  const edges = [...part.matchAll(separator)];
  // A recognized performer explicitly attached to this part is stronger evidence than
  // a collection title that happens to contain a different song name.
  if (edges.length) {
    const first = edges[0], last = edges.at(-1)!;
    const lead = part.slice(0, first.index).trim(), tail = part.slice(last.index + last[0].length).trim();
    if (knownPerformer.test(lead) && isPerformer(lead)) return { title: part.slice(first.index + first[0].length).trim(), artist: credit(lead) };
    if (knownPerformer.test(tail) && isPerformer(tail)) return { title: part.slice(0, last.index).trim(), artist: credit(tail) };
  }
  if (credits.size && edges.length) {
    const first = edges[0], last = edges.at(-1)!;
    const lead = credit(part.slice(0, first.index)), tail = credit(part.slice(last.index + last[0].length));
    if (credits.has(lead) !== credits.has(tail)) {
      const atEnd = credits.has(tail);
      const name = (atEnd ? part.slice(0, last.index) : part.slice(first.index + first[0].length)).trim();
      if (name) return { title: name, artist: atEnd ? tail : lead };
    }
  }
  const known = /^(?:周[杰傑][伦倫]|伍佰|李克勤|[邓鄧]紫棋)$/u;
  const bracketCredits = bracketNames.filter(value => known.test(value));
  const bareCredit = collection?.replace(/^(?:【[^】]+】) */, '').match(/^(周[杰傑][伦倫]|伍佰|李克勤|[邓鄧]紫棋) *(?:无损|無損|动态歌词|動態歌詞|歌曲|音乐|音樂)/u)?.[1];
  const performer = [parent, bracketCredits.length === 1 ? bracketCredits[0] : bareCredit].find(value => value && isPerformer(value));
  const collectionArtist = performer ? credit(performer) : '';
  const withoutCoCredits = stripVideoCoCredits(title, collectionArtist);
  if (withoutCoCredits !== title) return { title: withoutCoCredits, artist: collectionArtist };
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
  if (explicit && isPerformer(explicit[2]) && (!collectionArtist || credit(explicit[2]) === collectionArtist)) {
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
  // A close duration can sort the choices, not determine which conflicting words were sung.
  if (!rest.length) return { status: 'plain', candidate: first };
  return { status: 'review', candidates: [first, ...rest].slice(0, 12) };
}
