# 听页品牌重塑设计规格

> 状态：用户已确认，按以下规格实施。
>
> 日期：2026-11-25。
>
> 用户确认：中文 App 名称使用「听页」；采用候选 Logo 03「折光笺」；更新 iOS、macOS 主 App 与 LyricsWorkbench 的品牌外观。

## 0. iOS 设计稿审阅补充（2026-11-25）

- 用户已确认 iOS 设计方向，并要求空曲库页移除“添加文件夹”按钮上方与下方的辅助提示文案；保留主标题与添加操作。
- 正在播放页的黑胶唱片需要保留清晰可见的唱针，唱头落在唱片外圈沟槽区域，不遮挡中心封面／品牌标记。

## 1. 目标

把 Tinytune 面向用户的产品品牌统一更新为「听页」，以候选 03 的折页音乐符号为 Logo，建立新的紫—粉渐变视觉系统，并重绘主 App 与 LyricsWorkbench 的装饰插画。此变更只处理品牌表达，不改变曲库、搜索、播放、歌词、下载、导出或文件访问行为。

## 2. 品牌概念与视觉原则

- 中文展示名：**听页**。
- 标志：基于用户选定的 Figma 候选 **03「折光笺 / Folded Letter」**（Figma 节点 `1:13`）重整为正式矢量 Logo；保留折页轮廓与负形音符，不带文字。
- 核心渐变：鸢尾紫 `#8367F4` → 玫瑰粉 `#ED83B5`。渐变方向在同一系统内保持一致，应用于品牌标记及少量重要强调。
- 内容底色保持高可读性的浅纸白／淡紫灰与深墨紫／炭黑；正文使用深色／浅色中性墨色。
- 渐变不承载小字号正文或唯一状态提示。定义满足对比度要求的实色强调、前景色与焦点状态；警告、错误、成功语义色与品牌色分离。
- 保留真实专辑封面原色，不对用户音频或封面做品牌调色。
- 插画转为当代抽象的「纸页折线 × 声音流动」语言：以留白、纸面折层、音符／声波路径和克制渐变呼应标志；不再使用山水、传统乐器、梅花或植物图案。

## 3. 范围

### iOS 与 macOS 主 App

- 用户可见名称、关于页名称、品牌图及文档更新为「听页」。
- 保持工程 target、scheme、`PRODUCT_NAME`、Bundle ID、包名及技术目录名 Tinytune 不变；macOS 的 `.app` 外壳使用 `听页.app`，Finder 中也显示新品牌名。
- 更新共用 App Icon 资源集各尺寸、透明底 macOS 图标版本及应用内品牌图，并保留一个可维护的主 SVG 源稿。
- 在 `TuneTheme` 集中定义新的浅／深色语义颜色及品牌渐变；更新原生控件的导航选中、主要按钮、播放进度与焦点反馈，避免全屏铺用渐变。
- 重绘现有空曲库装饰插画的横向、竖向、顶部和通屏构图，并同步明暗外观；重绘无专辑封面时的 `FoldedRecord` 占位图形，使其符合新标志语言。
- 保留高对比度／辅助大字下隐藏纯装饰插画的既有行为。

### LyricsWorkbench

- 将工作台浏览器标题、favicon、页头品牌名及现有品牌副标题更新为「听页」及与主 App 一致的表述。
- 在现有 CSS 主题变量上统一颜色；逐页覆盖搜索、结果列表、状态徽标、播放器、歌词、弹窗、错误和禁用态，不改变交互、布局和业务行为。
- 重绘 Web hero 的背景插画为匹配主 App 的轻量折页／声波抽象构图；保留现有响应式结构与内容密度。
- 沿用该工具当前仅有的浅色呈现，不借本次品牌改造额外新增独立的深色模式。

### 文档与历史资源

- 更新 README、品牌指南、UI 设计说明与 LyricsWorkbench 文档中的当前品牌名称、Logo 和颜色描述。
- 旧图标及旧配色稿保留为明确标注的历史设计资料，不删除用户已有作品；不再称为现行视觉系统。

## 4. 资源与代码边界

预期修改或新增：

- `apps/Shared/InfoPlist.xcstrings`、`apps/Shared/Localizable.xcstrings`、`apps/Shared/TinytuneApp.swift`：可见名称与本地化回退。
- `apps/Shared/Assets.xcassets/AppIcon.appiconset/`、`apps/Shared/Assets.xcassets/BrandMark.imageset/`：双平台图标／品牌图。
- `docs/brand/`：正式 Logo 源稿、品牌指南及新插画源文件；旧稿仅标记归档。
- `packages/TinytuneKit/Sources/DesignSystem/Components.swift`、相关 Artwork 资源集、`TuneThemeTests.swift`：语义色、渐变和占位插画。
- `scripts/render-library-landscape.py`（仅在需要时）：依既有构图导出约定重新生成发布尺寸资源。
- `tools/LyricsWorkbench/index.html`、`tools/LyricsWorkbench/public/icon.svg`、`tools/LyricsWorkbench/public/landscape.svg`、`tools/LyricsWorkbench/app/styles.css`、`tools/LyricsWorkbench/app/workbench.css`、品牌页头组件与相关文档。
- `README.md`、`docs/ui-design.md`、`docs/brand/README.md`。

当前工作区存在大量未提交的功能改动，包含上述部分目标文件及新插画源文件。实施时须基于这些文件当前内容作窄范围编辑，不得 checkout、重置、覆盖或回滚既有改动；新命名的现行资源与归档稿须清晰区分。

## 5. 验收标准

1. iOS 与 macOS 的系统可见名称均为「听页」，关于页及工作台品牌区域也使用同一名称；技术工程标识仍为 Tinytune。
2. iOS/macOS 图标和 App 内品牌图由同一 Logo 源稿导出，尺寸、透明度与资源清单对应正确。
3. 原生主题在浅／深色均解析正确；主要文字、次要文字和控件状态通过现有可执行的对比度测试。警告／错误仍不与品牌强调色混淆。
4. 装饰插画在各已支持构图与明暗模式均替换为新风格；不影响点击目标、版式、辅助功能或 Reduce Motion／高对比度行为。
5. LyricsWorkbench 所有页面和状态使用同一组浅色主题变量，品牌名、favicon、hero 插画同步；现有交互功能不回归。
6. 定向验证包括 Swift Package 测试、macOS／iOS 构建、LyricsWorkbench typecheck／build／tests，以及矢量／PNG 资源尺寸与透明度检查。每次构建前遵守仓库要求，清理对应固定 `.build-output` 目标且确认无并发构建进程。
7. 不改动本次品牌范围以外的功能，不创建提交、不推送。

## 6. 非目标

- 不改工程名、Bundle ID、产品功能、播放行为、数据格式、文件访问逻辑或歌词供应方。
- 不修改真实音频封面，不引入第三方图库／字体／品牌素材。
- 不删除旧设计稿，不自动发布或部署 LyricsWorkbench。
- 不为品牌渐变牺牲可访问性、系统控件可辨识度或警告状态语义。
