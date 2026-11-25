# Workbench Video Lyrics and Layout Implementation Plan

**Goal:** 从 B 站投稿标题中的明确署名查找可阅读歌词，同时让歌曲列表和 16:9 视频使用更宽的工作区。

**Architecture:** 为投稿详情提供仅供查词的身份提示，保留原投稿标题和保存路径。使用 CSS Grid 和容器查询按右栏可用空间切换歌词位置，不改变播放器行为。

**Tech Stack:** TypeScript、Fastify、React、CSS、Node Test Runner。

## Global Constraints

- 四边内距 12px；有足够空间时视频为 640×360，不足时按 16:9 缩小。
- 不从查询词推断歌手，不给未核对的录音写入同步时码，不改用户文件或提交仓库改动。
- 编译前只清理对应的闲置 Web 构建产物。

### 任务 1：恢复视频歌词预览

- [x] 在 `tools/LyricsWorkbench/test/{video-lyrics,bilibili-discovery,workbench-state}.test.ts` 覆盖真实标题结构、歧义标题、详情到歌词接口，以及前端自动查词。确认缺少查词身份导致测试失败。
- [x] 在 `src/video-lyrics.ts` 提取明确的标题与署名；在 `src/bilibili-discovery.ts` 和 `src/song-types.ts` 提供仅供查词的身份；`src/server.ts` 和 `app/workbench-state.ts` 优先消费该提示。
- [x] 用同一投稿 ID 调本地 API，确认返回纯文本候选且不包含同步歌词。

### 任务 2：调整播放器工作区

- [x] 在 `test/workbench-presentation.test.ts` 覆盖工作区外距、视频比例和宽屏并排规则。
- [x] 在 `app/workbench-player.tsx` 加入播放器／歌词的共同容器，在 `app/workbench.css` 分配栏宽，移除视频固定小高度。
- [x] 在浏览器实测桌面、宽屏及窄窗口；跑完整 Web 测试、类型检查和干净构建。

**本轮验收:** 127 个 Web 测试、TypeScript 类型检查与干净构建通过。Chrome 在本机开发页按歌名搜索并打开 `BV1pdRTB8ESa`，显示纯文本歌词。1024、1280 和 1440px 视口实测视频为 640×360；390px 视口按 16:9 缩放。四周 12px 且无横向溢出。
