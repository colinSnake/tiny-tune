# 时码歌词与独立采集工作台实施计划

> 在当前工作区的功能分支按红／绿顺序执行，每项独立验证；保留原有未提交文件，不暂存、不提交。

**目标：** 按歌手获取曲目和可用歌词，并让 Tinytune 离线同步显示导出的同名 `.lrc`。

**架构：** 原生端用 `Domain` 解析时间轴、`Library` 通过来源授权读同名文件、SwiftUI 根据现有播放器位置渲染。Web 和 CLI 共用采集、匹配、限速与导出；本地音频仅在浏览器中试听。

**技术栈：** Swift 6 / SwiftUI / AVPlayer、Vite / React / TypeScript、Node.js / Fastify、pnpm。

**规格：** [时码歌词与独立采集工作台](../specs/2026-11-21-timed-lyrics-workbench-design.md)

## 全局约束

只处理本地音频，App 不联网找词，不改持久化模型。只接 MusicBrainz 和 LRCLIB v1，遵守服务端限流，无音频上传或下载。导出待确认项时只写 manifest，不生成未确认歌词文件。

## 原生端与文件协议

- [x] 用 `tests/Fixtures/Lyrics/timeline.lrc` 定义共用毫秒样例。测试 `LyricsDocument.parse` 与 `index(at:)` 的多标签、偏移、同刻行、空行、纯文本和边界；执行 `swift test --package-path packages/TinytuneKit --filter Lyrics` 观察缺失类型的红测，再在 `Sources/Domain/LyricsDocument.swift` 实现并重跑。
- [x] 测试 `LyricsSidecar.read(in:audioPath:)` 的扩展名、缺失、软链接、坏 UTF-8 和上限；在 `Sources/Library/LyricsSidecar.swift` 复用 `FolderAccess`，借用来源作用域直到读完。使用已有 `AppState` 源和异步任务取消，切歌立即隐藏旧结果。
- [x] 在 `PlayerViews.swift` 提供歌词视图、滚动与 seek，在 `TinytuneApp.swift` 增加 macOS 侧栏。更新 `Localizable.xcstrings`。编译三个 native target，用合成文件覆盖可见性、播放、拖动和异常。

## 工作台与 CLI

- [x] 测试 Web 时间轴和导出包（共享 fixture），明确定义浏览器音源只用 object URL。实现 `src/lrc.ts` 和 `src/export.ts`。以 `pnpm test` 运行。
- [x] 测试 `src/providers.ts` / `src/match.ts`：固定上游 URL、翻页、规范化、歧义、纯文本、纯音乐、限速与取消。测试通过后接 `/api/catalog`、`/api/lyrics` 和 `src/collect.ts`，命令行按独立歌手 ID 采集并无覆盖写入。
- [x] `app/page.tsx` 完成歌手选择 → 曲目选择 → 匹配进度 → 本地预览 → 导出。用实际浏览器验证空态、样例歌词和播放，使用少量真实 API 检查独立连通性。

## 联调与文档

- [x] 运行 `scripts/check.sh`、`pnpm test`、`pnpm typecheck`、`pnpm build`；浏览器导出后用同名音轨验证原生侧读取。更新工作台 README 与项目说明，记录实际命令以及未验收的设备或通路。

## 首版验证（2026-11-21，Web 迁移前）

- `TINYTUNE_BUILD_DIR="$PWD/.build-output/lyrics" scripts/check.sh`：54 项 Swift 测试通过；macOS、无签名 iOS 设备和 iOS 模拟器目标均构建成功。iOS 模拟器运行时未安装，未运行 iOS 界面，也未在 iPhone 真机验证。
- `npm test`、`npm run typecheck`、`npm run build`：通过（7 项 Web／CLI 测试）。`npm audit --omit=dev` 本轮返回 0 个已知生产依赖漏洞。
- Chrome：用合成样例验证术语状态、播放定位、滚动恢复、单曲与 ZIP 导出，检查 ZIP 的 UTF-8 文件名和 manifest；验证 390 px 与桌面宽度。用模拟 API 验证 429 请求失败后可以重试，中止重试保留失败状态，候选未确认前不能导出、确认后可以导出。
- macOS 独立 QA `org.tinytune.player.lyricsqa`：导入 3 首合成曲目，读取 Web 实际输出的两个同名 `.lrc`；播放中高亮随进度变化，暂停点击歌词定位到 10 秒且仍暂停，滚动后能恢复跟随，切换后纯文本正确，无歌词音轨仍播放。非法 UTF-8、超限、软链接由单元测试覆盖，未单独做双端界面重测。
- 真实 API 烟测：搜索「周杰伦」得到「周杰倫」候选，浏览首批 50 条录音并返回下一页位置；LRCLIB 搜索文档示例曲目获得有效时码。CLI `--limit 1` 对另一录音正确输出未找到歌词的 manifest。未据此评估全量覆盖率，没有保存真实测试歌词或下载商业音频。
