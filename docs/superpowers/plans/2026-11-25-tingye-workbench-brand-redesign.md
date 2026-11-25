# 听页 LyricsWorkbench 品牌重塑实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 LyricsWorkbench 的用户可见名称、颜色、favicon 与 hero 插画统一到听页品牌，同时保持现有布局与工作流。

**Architecture:** 保留现有组件与业务逻辑，仅替换公共 CSS 令牌、可见品牌文案和 `public/` 下的 SVG 品牌资源；渐变端点与原生 App 共用。

**Tech Stack:** TypeScript、React、CSS、SVG、Vite、Node test runner。

**Spec:** `docs/superpowers/specs/2026-11-25-tingye-brand-redesign.md`

## Global Constraints

- 品牌名称使用「听页」；副标题使用「歌曲与歌词工作台」。
- 核心渐变为 `#8367F4 → #ED83B5`；维持当前单一浅色工具界面，不新增深色模式。
- 现有搜索、试听、歌词、下载、保存与导出行为及页面结构不得改变。
- 旧设计资源保留；仅更新当前运行资源与必要说明。
- 构建前确认没有并发的 Workbench 进程并清理固定 `dist` 输出；不删除 `.local/`、配置或用户数据。
- 未获明确要求不提交、不推送。

---

### Task 1: 品牌名、图标与 CSS 令牌

**Files:**
- Modify: `tools/LyricsWorkbench/index.html`、`tools/LyricsWorkbench/public/icon.svg`、`tools/LyricsWorkbench/app/workbench.tsx`、`tools/LyricsWorkbench/app/page.tsx`、`tools/LyricsWorkbench/app/song-download.tsx`、相关 README
- Test: 页面品牌文案与资源引用静态检查

- [x] 先确认所有浏览器标题、页头、footer、favicon 引用点与实际路由。
- [x] 更新可见品牌为「听页」，副标题统一为「歌曲与歌词工作台」，产品包/技术标识不变。
- [x] 让 favicon 与主 SVG Logo 使用一致的折页音符标记。

### Task 2: 主题与插画

**Files:**
- Modify: `tools/LyricsWorkbench/app/styles.css`、`tools/LyricsWorkbench/app/workbench.css`
- Create/Modify: `tools/LyricsWorkbench/public/landscape.svg` 与 `docs/brand/illustrations/`

- [x] 将公共颜色变量迁移到紫粉品牌色与纸白/墨紫中性色；语义错误/警示色保留独立色相。
- [x] 检查按钮、输入、焦点环、选择态、徽标、播放器、歌词面板、弹窗、禁用/错误态及移动断点，避免遗留松绿。
- [x] 用折页和声波的轻量 SVG 替换旧 hero 景观图，不改变现有响应式结构与内容密度。

### Task 3: Workbench 验收

**Files:**
- Modify: `tools/LyricsWorkbench/README.md` 与品牌文档

- [x] 更新文档中的现行品牌/色板描述，旧稿标注为历史。
- [x] 运行 `pnpm test`、`pnpm typecheck` 与 `pnpm build`；按仓库要求先清理固定构建输出目录。
- [x] 启动本地预览检查桌面及窄屏视觉，确认可见文案和色彩无遗漏；停止本轮服务并清理临时构建缓存。
- [x] 复核 diff 与工作树，确认没有改动功能代码或无关未提交内容；不提交。
