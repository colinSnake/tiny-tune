import { lrcMetadata, lyricLines, parseLrc, readLrcTimeTags, timeTagMs } from './lrc';
import type { LyricCandidate } from './types';

// Syllables, rather than Latin letters alone, distinguish pronunciation annotations
// from sung English, other languages and repeated vocables such as “la la la”.
const syllables = new Set(`
a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu
ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo
da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er
fa fan fang fei fen feng fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo
ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo
ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo
la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu long lou lu luan lue lun luo
ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nue nuo o ou
pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun
ran rang rao re ren reng ri rong rou ru ruan rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo
ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei wen weng wo wu
xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun
za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo
`.trim().split(/\s+/u));

// These syllables are also conventional sung vocables, not pronunciation evidence.
const vocables = new Set('a ai ao ba da di du e ei en ha he hei hu la na o ou sha wa ya ye yo'.split(' '));

const hanCount = (text: string) => [...text.matchAll(/\p{Script=Han}/gu)].length;

function pronunciation(text: string, characters: number): boolean {
  if (characters < 2) return false;
  const latin = text.replace(/\p{Script=Han}/gu, ' ');
  const numbered = latin.match(/[a-z]+[1-6]/giu) ?? [];
  if (numbered.length >= 2 && Math.abs(numbered.length - characters) <= Math.max(1, characters * 0.2) &&
      !/[\p{L}\p{N}]/u.test(latin.replace(/[a-z]+[1-6]/giu, '')) &&
      numbered.every(word => /^(?:(?:[bpmfdtnlgkhwzcsj]|ng|gw|kw)?(?:aa|oe|eo|yu|[aeiou])(?:ng|[iumnptk])?|m|ng)[1-6]$/iu.test(word))) return true;
  const tokens = latin.match(/[\p{Script=Latin}\p{M}]+[1-5]?/gu) ?? [];
  // Do not ignore other scripts, stray digits or markup when classifying a line.
  if (/[\p{L}\p{N}]/u.test(latin.replace(/[\p{Script=Latin}\p{M}]+[1-5]?/gu, ''))) return false;
  const words = tokens.map(token => token.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[1-5]$/u, '').replace(/v/gu, 'u'));
  return words.length >= 2 && Math.abs(words.length - characters) <= Math.max(1, characters * 0.2) &&
    new Set(words).size >= 2 && words.every(word => syllables.has(word)) && words.some(word => !vocables.has(word));
}

export function hasPhoneticAnnotations(source: string): boolean {
  if (!/\p{Script=Han}/u.test(source)) return false;
  const lines = lyricLines(source.normalize('NFC'))
    .map(line => readLrcTimeTags(line).rest.replace(/^(?:\[[A-Za-z]+:[^\]]*\]\s*)+/u, '').trim()).filter(Boolean);
  return lines.some((line, index) => {
    const count = hanCount(line);
    if (count) return pronunciation(line, count);
    return pronunciation(line, hanCount(lines[index - 1] ?? '')) || pronunciation(line, hanCount(lines[index + 1] ?? ''));
  });
}

// Reject the whole supplier record. A clean plain field must not hide a bad synced
// field (or vice versa); choose another candidate instead of silently deleting lines.
export function hasPhoneticCandidate(candidate: Pick<LyricCandidate, 'synced' | 'plain'>): boolean {
  if (hasPhoneticAnnotations(candidate.synced) || hasPhoneticAnnotations(candidate.plain)) return true;
  const words = (source: string) => {
    const parsed = parseLrc(source);
    return parsed.cues.length ? parsed.cues.flatMap(cue => cue.lines) : parsed.plain.split(String.fromCharCode(10)).map(line => line.trim()).filter(Boolean);
  };
  return [[candidate.synced, candidate.plain], [candidate.plain, candidate.synced]].some(([annotation, chinese]) => {
    if (/\p{Script=Han}/u.test(annotation) || !/\p{Script=Han}/u.test(chinese)) return false;
    const latin = words(annotation), han = words(chinese);
    return latin.length === han.length && latin.length > 0 && latin.every((line, i) => pronunciation(line, hanCount(han[i])));
  });
}

const inlineTime = /<(\d{1,6}):([0-5]\d)(?:\.(\d{1,3}))?>/gu;
const timingMarker = /\[\s*[+−-]?\d+\s*[:：]/u;
const inlineTimingMarker = /<\s*[+−-]?\d+\s*[:：]/u;
const credit = /^(?:(?:作[词詞曲]|[填谱譜编編]曲|[词詞曲]|演唱|混音|和[声聲]|制作人|製作人|[录錄]音|歌手|原唱|[翻]?譯|[翻]?译|[统統]筹|策[划劃]|[监監]制|監製|吉他|贝斯|貝斯|[钢鋼]琴|[乐樂]器|版权声明|版權聲明|lyric(?:s|ist)?|written by|compos(?:er|ed by)|arrang(?:er|ed by)|vocals?)\s*[:：])/iu;
const promotion = /^(?:[〖【]?(?:关注|關注|加群|添加微信).{0,12}(?:公众号|公眾號|微信|获取|獲取|下载|下載)|(?:扫码|掃碼).{0,12}(?:下载|下載|关注|關注))/u;

const lyricBodyKey = (text: string) => text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const writingSystems = [/\p{Script=Hiragana}|\p{Script=Katakana}/u, /\p{Script=Hangul}/u, /\p{Script=Han}/u,
  /\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Arabic}/u];

function collapsedLyricCue(timedLines: Map<number, Set<string>>) {
  if (timedLines.size !== 1) return false;
  const [lines] = timedLines.values();
  if (lines.size <= 1) return false;
  if (lines.size > 2) return true;
  // One lyric and its translation can share a single cue. Don't mistake a pair
  // in clearly different writing systems for a collapsed same-language verse.
  const [first, second] = [...lines].map(line => writingSystems.findIndex(script => script.test(line)));
  return first < 0 || second < 0 || first === second;
}

export type LyricQualityIssue = 'phonetic' | 'markup' | 'encoding' | 'timing' | 'incomplete' | 'promotion';

// parseLrc is permissive for display. Validate the original lines before anything
// can be discarded, and use the same offset convention as the player.
export function lyricQualityIssue(source: string, duration?: number | null, tolerance = 0.5): LyricQualityIssue | undefined {
  if (/[\uFFFD\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\uD800-\uDFFF]/u.test(source)) return 'encoding';
  if (/<!--[\s\S]*?-->|<!doctype\b|<\/?[A-Za-z][^>]*>/iu.test(source)) return 'markup';
  if (hasPhoneticAnnotations(source)) return 'phonetic';
  let offset: number | undefined;
  let untimedBody = false;
  let hasTiming = false;
  const times: number[] = [];
  const sung = new Map<number, Set<string>>();
  for (const line of lyricLines(source)) {
    const trimmed = line.trim();
    if (/^\[offset\s*[:：]/iu.test(trimmed)) {
      const value = /^\[offset:\s*([+-]?\d+)\s*\]$/iu.exec(trimmed);
      const ms = value ? Number(value[1]) : NaN;
      if (!(Math.abs(ms) <= 1e9) || offset !== undefined && offset !== ms) return 'timing';
      offset = ms;
    }
    if (lrcMetadata.test(trimmed)) continue;
    const { times: lineTimes, rest } = readLrcTimeTags(trimmed);
    const words = rest.replace(inlineTime, '').trim();
    if (timingMarker.test(words) || inlineTimingMarker.test(words)) return 'timing';
    if (promotion.test(words)) return 'promotion';
    if (lineTimes.length) {
      hasTiming = true;
      const body = !credit.test(words) && lyricBodyKey(words);
      for (const ms of lineTimes) {
        times.push(ms);
        if (body) {
          const lines = sung.get(ms) ?? new Set<string>();
          lines.add(body);
          sung.set(ms, lines);
        }
      }
      for (const stamp of rest.matchAll(inlineTime)) times.push(timeTagMs(stamp));
    } else {
      if (words !== rest) return 'timing';
      if (words && !credit.test(words)) untimedBody = true;
    }
  }
  if (!hasTiming) return;
  if (!sung.size || untimedBody || collapsedLyricCue(sung)) return 'timing';
  const appliedOffset = offset ?? 0;
  // Preserve the player's small clamp at zero, but not a collapsed set of sung lines.
  if (appliedOffset > 0 && [...sung.keys()].filter(ms => ms <= appliedOffset).length > 1) return 'timing';
  if (duration != null && Number.isFinite(duration) && duration > 0 &&
      times.some(ms => ms - appliedOffset > (duration + tolerance) * 1000)) return 'timing';
}

export function validatedLyricKind(source: string, duration?: number | null, tolerance?: number): 'timed' | 'plain' | undefined {
  if (lyricQualityIssue(source, duration, tolerance)) return;
  const parsed = parseLrc(source);
  return parsed.cues.length ? 'timed' : parsed.plain ? 'plain' : undefined;
}

function hasMissingVerses(synced: string, plain: string): boolean {
  // Require positive evidence from this candidate's two fields. Gaps alone say
  // nothing about missing verses (e.g. a long instrumental solo or outro).
  const body = (lines: string[]) => lines.map(line => line.replace(inlineTime, '').trim())
    .filter(line => line && !credit.test(line))
    .map(lyricBodyKey).filter(Boolean);
  const timed = body(parseLrc(synced).cues.flatMap(cue => cue.lines));
  const reference = body(parseLrc(plain).plain.split('\n'));
  if (!timed.length || reference.length <= timed.length) return false;
  // Use the sequence, not a set of unique words: an omitted repeated chorus
  // counts as missing even though its lines also appear earlier in the song.
  let next = 0;
  for (const line of reference) if (line === timed[next]) next++;
  return next === timed.length;
}

export function lyricCandidateIssue(candidate: Pick<LyricCandidate, 'synced' | 'plain' | 'duration'>): LyricQualityIssue | undefined {
  return lyricQualityIssue(candidate.synced, candidate.duration) ?? lyricQualityIssue(candidate.plain, candidate.duration) ??
    (hasPhoneticCandidate(candidate) ? 'phonetic' : hasMissingVerses(candidate.synced, candidate.plain) ? 'incomplete' : undefined);
}

export function hasInvalidLyricCandidate(candidate: Pick<LyricCandidate, 'synced' | 'plain' | 'duration'>): boolean {
  return !!lyricCandidateIssue(candidate);
}
