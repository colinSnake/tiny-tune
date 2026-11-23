export type Cue = { ms: number; lines: string[] };

export function parseLrc(source: string): { cues: Cue[]; plain: string } {
  const raw: [number, string][] = [];
  const plain: string[] = [];
  let offset = 0;
  for (const line of source.replace(/^\uFEFF/, '').split(/\r\n|[\r\n\u000B\u000C\u0085\u2028\u2029]/)) {
    let rest = line.trim();
    const meta = /^\[([A-Za-z]+):([^\]]*)\]$/.exec(rest);
    if (meta) {
      const ms = Number(meta[2]);
      if (meta[1].toLowerCase() === 'offset' && /^[+-]?\d+$/.test(meta[2].trim()) && Math.abs(ms) <= 1e9) offset = ms;
      continue;
    }
    const times: number[] = [];
    let tag: RegExpExecArray | null;
    while ((tag = /^\[([0-9]{1,6}):([0-5][0-9])(?:\.([0-9]{1,3}))?\]/.exec(rest))) {
      times.push((Number(tag[1]) * 60 + Number(tag[2])) * 1000 + Number((tag[3] ?? '').padEnd(3, '0')));
      rest = rest.slice(tag[0].length);
    }
    const words = rest.trim();
    if (!times.length) plain.push(words);
    for (const time of times) raw.push([time, words]);
  }
  if (!raw.some(([, words]) => words)) return { cues: [], plain: plain.join('\n').trim() };
  const grouped = new Map<number, Set<string>>();
  for (const [time, words] of raw) {
    const at = Math.max(0, time - offset);
    const lines = grouped.get(at) ?? new Set<string>();
    if (words) lines.add(words);
    grouped.set(at, lines);
  }
  return { cues: [...grouped.entries()].sort(([a], [b]) => a - b).map(([ms, lines]) => ({ ms, lines: [...lines] })), plain: '' };
}

export function activeIndex(cues: Cue[], seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return -1;
  let lo = 0, hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cues[mid].ms / 1000 <= seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && cues[lo - 1].lines.length ? lo - 1 : -1;
}

export function formatTime(seconds: number | null, precision = false): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${precision ? '.' + String(ms % 1000).padStart(3, '0') : ''}`;
}
