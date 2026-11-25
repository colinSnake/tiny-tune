import { Converter } from 'opencc-js/t2cn';

export type LyricScript = 'simplified' | 'original';
export const defaultLyricScript: LyricScript = 'simplified';

export function parseLyricScript(value: unknown): LyricScript | null {
  if (value === undefined) return defaultLyricScript;
  return value === 'simplified' || value === 'original' ? value : null;
}

const lineBreak = /(\r\n|[\r\n\u000b\u000c\u0085\u2028\u2029])/u;
const metadata = /^\s*\[[A-Za-z]+:[^\]]*\]\s*$/u;
const timeTag = /(\[\d{1,6}:[0-5]\d(?:\.\d{1,3})?\]|<\d{1,6}:[0-5]\d(?:\.\d{1,3})?>)/u;
let toSimplified: ReturnType<typeof Converter> | undefined;

/** Format only the final lyric payload, never the provider candidate or filename. */
export function formatLyricText(text: string, script: LyricScript = defaultLyricScript): string {
  if (script === 'original' || !/\p{Script=Han}/u.test(text)) return text;
  // Use t → cn, not twp → cn: don't localize vocabulary or rewrite Cantonese.
  const convert = toSimplified ??= Converter({ from: 't', to: 'cn' });
  return text.split(lineBreak).map((line, i) => i % 2 || metadata.test(line) ? line :
    line.split(timeTag).map((part, j) => j % 2 ? part : convert(part)).join('')).join('');
}
