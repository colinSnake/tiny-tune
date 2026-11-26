import { parseLrc } from './lrc';
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
  const tokens = latin.match(/[\p{Script=Latin}\p{M}]+[1-5]?/gu) ?? [];
  // Do not ignore other scripts, stray digits or markup when classifying a line.
  if (/[\p{L}\p{N}]/u.test(latin.replace(/[\p{Script=Latin}\p{M}]+[1-5]?/gu, ''))) return false;
  const words = tokens.map(token => token.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[1-5]$/u, '').replace(/v/gu, 'u'));
  return words.length >= 2 && Math.abs(words.length - characters) <= Math.max(1, characters * 0.2) &&
    new Set(words).size >= 2 && words.every(word => syllables.has(word)) && words.some(word => !vocables.has(word));
}

export function hasPhoneticAnnotations(source: string): boolean {
  if (!/\p{Script=Han}/u.test(source)) return false;
  const lines = source.normalize('NFC').split(/\r\n|[\r\n\u000B\u000C\u0085\u2028\u2029]/u)
    .map(line => line.trim().replace(/^(?:\[(?:\d{1,6}:|[A-Za-z]+:)[^\]]*\])+/u, '').trim()).filter(Boolean);
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

export type LyricQualityIssue = 'phonetic' | 'markup' | 'encoding' | 'timing';

// parseLrc deliberately tolerates unknown lines for display. Downloads must not
// mistake that tolerance for validation or silently discard a broken time tag.
export function lyricQualityIssue(source: string, duration?: number | null): LyricQualityIssue | undefined {
  if (/[\uFFFD\u0000-\u0008\u000E-\u001F\u007F]/u.test(source)) return 'encoding';
  if (/<\/?[A-Za-z][^>]*>/u.test(source)) return 'markup';
  if (hasPhoneticAnnotations(source)) return 'phonetic';
  for (const line of source.replace(/^\uFEFF/u, '').split(/\r\n|[\r\n\u000B\u000C\u0085\u2028\u2029]/u)) {
    let rest = line.trim();
    if (/^\[offset:/iu.test(rest) && !/^\[offset:\s*[+-]?\d+\s*\]$/iu.test(rest)) return 'timing';
    if (/^\[offset:/iu.test(rest) && Math.abs(Number(rest.slice(8, -1))) > 1e9) return 'timing';
    let tag: RegExpExecArray | null;
    while ((tag = /^\[\d{1,6}:[0-5]\d(?:\.\d{1,3})?\]/u.exec(rest))) rest = rest.slice(tag[0].length).trimStart();
    if (/^\[[+-]?\d+\s*[:：]/u.test(rest)) return 'timing';
  }
  if (duration !== undefined && duration !== null && Number.isFinite(duration) && duration > 0 &&
    parseLrc(source).cues.some(cue => cue.ms > (duration + 0.5) * 1000)) return 'timing';
  return;
}

export function hasInvalidLyricCandidate(candidate: Pick<LyricCandidate, 'synced' | 'plain' | 'duration'>): boolean {
  return hasPhoneticCandidate(candidate) || !!lyricQualityIssue(candidate.synced, candidate.duration) || !!lyricQualityIssue(candidate.plain, candidate.duration);
}
