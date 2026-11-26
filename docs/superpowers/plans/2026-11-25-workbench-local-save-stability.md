# 工作台本地保存稳定性 Implementation Plan

**Goal:** 修复 B 站录音误去重、重复归档，以及本地纯文本歌词依赖线上查询的问题。保留原路径和原文件；不对视频录音自动套用时码。

### 1. 本地保存识别录音

- [x] 在 `tools/LyricsWorkbench/test/song-save-regression.test.ts` 通过实际保存路由复现同来源旧标签重复下载、不同来源但同名同长误报已存在，并覆盖重名冲突、多个精确来源、无来源标签的音频验证。
- [x] `src/local-library.ts` 在私有索引保留分集来源标识，跳过搜索结果的展示上限做精确查重；`src/server.ts` 将精确与待比较路径交给 `src/song-local-save.ts`。没有可信来源匹配时，同名同长只用作索引提示；以 MP3 音频数据确认，不覆盖同名冲突。

### 2. 本地歌词优先

- [x] 在 `tools/LyricsWorkbench/test/local-library.test.ts` 加入离线本地歌词预览与显式查找时码用例，验证保留原文和现有防误写规则。
- [x] `src/local-library.ts` 默认直接读取纯文本；显式查找时码时另外提供候选与查找状态。`app/workbench-state.ts`、`app/workbench.tsx` 和 `app/workbench-actions.ts` 保持本地正文可读，只在显式选同版时预览/补齐时码。

### 3. 回归

- [x] 更新工作台 README；从干净的临时编译缓存运行工作台全量测试和类型检查，验证真实本地《天后》仍能读取已补的同步歌词，检查 `git diff --check`。不移动用户文件、不提交。
