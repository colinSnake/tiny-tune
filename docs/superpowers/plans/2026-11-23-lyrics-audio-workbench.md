# Lyrics Audio Workbench Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Steps use checkboxes for tracking.

**Goal:** 搜索后可按录音版本查词、配对真实音频、同步试听，并记住绑定。

**Architecture:** 浏览器本地曲库和版本匹配独立于 Fastify；Fastify 保留已有搜索、限流和采集，只在已有录音详情请求补充可用的 ISRC。React 将录音、音源和已确认歌词关联，并用播放进度驱动时码。

**Tech Stack:** React、Vite、Fastify、TypeScript、IndexedDB、pnpm

**Spec:** [设计](../specs/2026-11-23-lyrics-audio-workbench-design.md)

## Global Constraints

不上传本地音频，不代理在线直链，不采集无授权音源；不改变端口和导出内容。没有本轮用户授权不创建 Git 提交。

### 1. 版本匹配与持久化

- [x] 在 `tools/LyricsWorkbench/test/audio.test.ts` 写搜索精确命中、ISRC、同名录音、时长冲突、片段和直链校验测试，先运行 `pnpm test` 观察失败。
- [x] 在 `src/audio.ts` 实现保守候选与播放时码校验，在 `src/collection.ts` 加入唯一精确搜索判定；`src/providers.ts` 保留限流并读取录音详情的 ISRC。
- [x] `app/audio-library.ts` 实现读文件标签、IndexedDB 的文件/绑定/已确认歌词记录和不可保存反馈；通过 `pnpm test` 和 `pnpm typecheck`。

### 2. 搜索与播放界面

- [x] `app/page.tsx` 实现提交状态与单曲操作，保留批量取消、下载和分页。
- [x] `app/preview.tsx`、`app/audio-panel.tsx` 显示可播放音源、可确认的本地候选、直链和时码对齐状态；`app/styles.css` 更新桌面和窄屏布局。
- [x] 同步 `tools/LyricsWorkbench/README.md`；运行 pnpm 安装、测试和构建，在浏览器验证 Enter、单曲、文件与直链、切歌／刷新后的恢复、片段和窄屏。

### 本轮验证

- `pnpm install --frozen-lockfile`、`pnpm test`（18 项）、`pnpm build`（含类型检查）、`git diff --check` 通过。
- 浏览器用受控曲目与合成音频确认：Enter、固定的搜索按钮文案、唯一结果自动展开、空结果／重试、单曲查词、文件夹导入、标签自动配对、整曲直链、片段不套整曲时码、播放跟随、点句定位、切歌及刷新后恢复。生产页面在 390 px 视口为单列、无横向溢出。
- 真实上游 MusicBrainz 在本轮生产端复测触发 HTTP 429，未完成真实曲目端到端验证；未测试商业音源和实体移动设备。
