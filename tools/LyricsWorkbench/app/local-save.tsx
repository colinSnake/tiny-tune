import { WorkbenchDialog } from './dialog';
import type { localSavePlan, LocalSaveSkip } from '../src/collection';
import type { LocalSaveResult } from '../src/local-library-types';

const reasons: Record<LocalSaveSkip['reason'], string> = {
  'not-local': '未对应到本地音频，只能导出', review: '尚未查到或核对歌词版本', exists: '已存在同名歌词，不覆盖',
};
const statusLabels: Record<LocalSaveResult['status'], string> = {
  saved: '已保存', exists: '已有歌词，未覆盖', changed: '音频或歌词已变化，请重新搜索', review: '请重新查询并核对歌词',
  ambiguous: '同目录有同名音频，未写入', unsynced: '未核对到可用时码，未写入', 'different-lyrics': '歌词正文不同，未覆盖', error: '目录暂不可写',
};

export function LocalSaveDialog({ root, plan, busy, results, error, onSave, onDismiss }: {
  root: string; plan: ReturnType<typeof localSavePlan>; busy: boolean; results?: LocalSaveResult[]; error: string;
  onSave: () => void; onDismiss: () => void;
}) {
  const completed = results?.filter(row => row.status === 'saved').length;
  const skipped = plan.skipped.length + (results ? results.length - (completed ?? 0) : 0);
  const outcome = new Map(results?.map(result => [result.id, result]));
  return <WorkbenchDialog title="保存到本地曲库" icon="download" onDismiss={onDismiss}
    description="只在原音频旁保存同名 .lrc，不修改音频，也不覆盖已存在的歌词。">
    <p className="local-save-root">{root}</p>
    <p role="status" className="local-save-summary">{results ? `已保存 ${completed} 首 · 跳过 ${skipped} 首`
      : `${plan.ready.length} 首可保存 · ${skipped} 首跳过`}</p>
    <ul className="local-save-list" aria-label="保存详情">
      {plan.ready.map(({ track }) => {
        const row = outcome.get(track.id);
        return <li key={track.id}><strong>{track.title}</strong><span>{row ? statusLabels[row.status] : '待保存'}</span>
          <small>{row?.file ?? track.file.replace(/\.[^.]+$/, '.lrc')}</small></li>;
      })}
      {plan.skipped.map(({ track, reason }) => <li key={track.id}><strong>{track.title}</strong><span>{reasons[reason]}</span></li>)}
    </ul>
    {error && <p role="alert" className="error-text">{error}</p>}
    <footer className="dialog-actions">
      <button className="button ghost" type="button" disabled={busy} onClick={onDismiss}>{results || !plan.ready.length ? '关闭' : '取消'}</button>
      {!results && !!plan.ready.length && <button className="button primary" type="button" disabled={busy} onClick={onSave}>
        {busy ? '正在保存…' : `确认保存 ${plan.ready.length} 首`}</button>}
    </footer>
  </WorkbenchDialog>;
}
