import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { exportEntries } from './export';
import { normalize } from './match';
import { isMbid, MusicSources } from './providers';
import type { CollectionItem, ItemState } from './types';

const help = `用法：pnpm collect "歌手名称" --out ./export --limit 50
      pnpm collect --artist-id <MusicBrainz MBID> --out ./export
只获取曲目和歌词，不下载音频。--limit 范围 1–500；默认 50。`;
const exists = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'EEXIST';
const describe = (error: unknown) => error instanceof Error ? error.message : '未知错误';

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    'artist-id': { type: 'string' }, limit: { type: 'string', default: '50' }, out: { type: 'string', default: './export' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  const id = values['artist-id'];
  const name = positionals[0]?.trim();
  const limit = Number(values.limit);
  if ((!!id === !!name) || positionals.length > 1 || (id && !isMbid(id)) ||
      (name && name.length > 120) || !/^\d+$/.test(values.limit) || limit < 1 || limit > 500) throw new Error(help);
  const cancellation = new AbortController();
  process.once('SIGINT', () => cancellation.abort());
  const { signal } = cancellation;
  const sources = new MusicSources();
  const candidates = id ? [] : await sources.artists(name, signal);
  const exact = candidates.filter(a => [a.name, ...a.aliases].some(label => normalize(label) === normalize(name)));
  if (!id && exact.length !== 1) {
    console.error(candidates.length ? '无法唯一确认歌手，请用 --artist-id 重试：' : '未找到歌手，请核对名称。');
    for (const a of candidates) console.error(`${a.id}  ${a.name}  ${[a.area, a.hint].filter(Boolean).join(' · ')}`);
    process.exitCode = 1; return;
  }
  const artist = id ? await sources.artist(id, signal) : exact[0];
  console.log(`目标歌手：${artist.name} (${artist.id})`);
  const log: CollectionItem[] = [];
  const seen = new Set<string>();
  try {
    let offset: number | null = 0;
    while (offset !== null && log.length < limit && !signal.aborted) {
      const page = await sources.recordings(artist.id, offset, Math.min(50, limit - log.length), signal);
      offset = page.next;
      for (const row of page.tracks) {
        if (signal.aborted || log.length >= limit) break;
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        let track = { ...row, artist: row.artist || artist.name };
        let result: ItemState;
        try { ({ track, result } = await sources.collect(track, signal)); }
        catch (error) {
          if (signal.aborted) break;
          result = { status: 'error', message: describe(error) };
          process.exitCode = 1;
        }
        log.push({ track, result });
        console.log(`[${log.length}/${limit}] ${track.title} · ${result.status}`);
      }
    }
  } catch (error) {
    if (!signal.aborted) { process.exitCode = 1; console.error(describe(error)); }
  }
  if (signal.aborted) { process.exitCode = 130; console.error('已停止，保留已处理结果。'); }
  const output = resolve(values.out);
  await mkdir(output, { recursive: true });
  const { files, manifest } = exportEntries(log, undefined, 'original');
  for (const { name, text } of files) {
    try { await writeFile(join(output, name), text, { flag: 'wx' }); }
    catch (error) {
      const entry = manifest.tracks.find(track => track.file === name)!;
      entry.error = exists(error) ? `已存在，未覆盖：${name}` : `写入失败：${name}（${describe(error)}）`;
      entry.file = null;
      if (!exists(error)) process.exitCode ||= 1;
      console.error(entry.error);
    }
  }
  const text = JSON.stringify({ ...manifest, artist }, null, 2) + '\n';
  let manifestPath = join(output, 'manifest.json');
  try { await writeFile(manifestPath, text, { flag: 'wx' }); }
  catch (error) {
    if (!exists(error)) throw error;
    manifestPath = join(output, `manifest-${randomUUID().slice(0, 8)}.json`);
    await writeFile(manifestPath, text, { flag: 'wx' });
  }
  console.log(`已处理 ${log.length} 曲，已写入 ${manifest.tracks.filter(track => track.file).length} 个歌词文件。\n${manifestPath}`);
}

main().catch(error => {
  console.error(describe(error));
  process.exitCode = (error as Error)?.name === 'AbortError' ? 130 : 1;
});
