import { Converter } from 'opencc-js/t2cn';
import { lrcMetadata } from './lrc';
import { simplifiedVariantSources } from './unihan-simplified-variants';

export type LyricScript = 'simplified' | 'original';
export const defaultLyricScript: LyricScript = 'simplified';

export function parseLyricScript(value: unknown): LyricScript | null {
  if (value === undefined) return defaultLyricScript;
  return value === 'simplified' || value === 'original' ? value : null;
}

const lineBreak = /(\r\n|[\r\n\u000b\u000c\u0085\u2028\u2029])/u;
const timeTag = /(\[\d{1,6}:[0-5]\d(?:\.\d{1,3})?\]|<\d{1,6}:[0-5]\d(?:\.\d{1,3})?>)/u;
let toSimplified: ReturnType<typeof Converter> | undefined;

const foreignLine = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const han = /\p{Script=Han}/u;
const languageKey = /^(?:lang|language|la)$/iu;
const chineseLanguage = /^(?:zh|cmn|yue|wuu|nan|hak|gan|hsn|chinese)(?:[-_][a-z0-9]+)*$/iu;
const languageCode = /^(?:[a-z]{2,3}(?:[-_][a-z0-9]+)*|japanese|korean)$/iu;
// In a mixed, unlabelled document, only convert a Han line if it has positive
// Chinese evidence. Shared Han words (e.g. 東京電車) are not language evidence.
const chineseLine = /[你妳您们們么麼吗嗎咱仨嘅佢唔冇咗喺搵嚟嗰啲咩嘢哋]|著作[权權]/u;

function mapLyricBody(text: string, transform: (part: string) => string): string {
  const parts = text.split(lineBreak);
  const metadata = parts.map((line, i) => i % 2 ? null : lrcMetadata.exec(line.trim()));
  const languages = metadata.flatMap(match => match && languageKey.test(match[1]) ? [match[2].trim()] : []);
  const hasChineseLabel = languages.some(value => chineseLanguage.test(value));
  const hasForeignLabel = languages.some(value => !chineseLanguage.test(value) && languageCode.test(value));
  if (hasForeignLabel && !hasChineseLabel) return text;
  const mixed = hasForeignLabel || !hasChineseLabel && parts.some((line, i) => i % 2 === 0 && !metadata[i] && foreignLine.test(line));
  return parts.map((line, i) => i % 2 || metadata[i] || foreignLine.test(line) || mixed && !chineseLine.test(line) ? line :
    line.split(timeTag).map((part, j) => j % 2 || !han.test(part) ? part : transform(part)).join('')).join('');
}

// Narrow contextual decisions; don't map ambiguous glyphs in names or valid words.
const aspect = /([朝望看等听捧抱拉握抓牵揣贴靠倚带背跟伴守笑哭喊唱说想念爱恨留站坐蹲躺走跑睡做活盼忍迎沿趁闪亮映飘飞倒流挂躲藏压含举拿开关绕数跳])著/gu;
const authorForms = '(?:著作(?:权)?|著名|名著|显著|卓著|原著|译著|撰著|编著|论著|专著|巨著|土著|执著)';
const authorWords = new RegExp(`(${authorForms})`, 'u');
const preservedForms = new RegExp(`${authorForms}|慰藉|凭藉|覆盖|覆水|覆辙|颠覆|翻云覆雨|反覆|倾覆|乾坤`, 'gu');

/** Format only the final lyric payload, never the provider candidate or filename. */
export function formatLyricText(text: string, script: LyricScript = defaultLyricScript): string {
  if (script === 'original' || !han.test(text)) return text;
  // Use t → cn, not twp → cn: don't localize vocabulary or rewrite Cantonese.
  const convert = toSimplified ??= Converter({ from: 't', to: 'cn' });
  return mapLyricBody(text, part => convert(part).replace(/妳/gu, '你')
    .replace(/簷(?=下|前|上|边|角|外|内)|(?<=屋|门|房|飞)簷/gu, '檐')
    .replace(/磅礡/gu, '磅礴').replace(/麻痺/gu, '麻痹')
    .split(authorWords)
    .map((span, i) => i % 2 ? span : span.replace(aspect, '$1着')).join(''));
}

/** Scan all converted Han body characters. Unknown contexts are not auto-corrected. */
export function residualLyricGlyphs(text: string): string[] {
  const found = new Set<string>();
  mapLyricBody(text, part => {
    for (const char of part.replace(preservedForms, '')) {
      if (char === '瞓') continue; // Standard written Cantonese, not a conversion error.
      if (simplifiedVariantSources.has(char) || /[著妳簷礡痺]/u.test(char)) found.add(char);
    }
    return part;
  });
  return [...found];
}
