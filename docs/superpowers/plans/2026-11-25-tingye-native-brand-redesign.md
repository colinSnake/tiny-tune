# 听页原生品牌重塑实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 iOS 与 macOS 主 App 的可见品牌统一为「听页」，上线折光笺 Logo、紫粉主题与新插画，并按审阅意见精简空曲库提示、保留唱针。

**Architecture:** 以一个可维护的 SVG 主标识衍生 App Icon 与应用内品牌图；在 `TuneTheme` 集中定义浅／深色语义色和渐变；新插画采用独立命名的 Asset Catalog，避免覆盖工作树中已有的绿色草案。UI 只替换品牌表现，不改变曲库、播放或文件行为。

**Tech Stack:** SwiftUI、Swift Package/XCTest、Xcode Asset Catalog、SVG、Python 与 macOS `sips`。

**Spec:** `docs/superpowers/specs/2026-11-25-tingye-brand-redesign.md`

## Global Constraints

- 显示名称统一为「听页」；工程、target、scheme、Bundle ID、包名及技术目录继续使用 Tinytune。
- 品牌渐变固定为 `#8367F4 → #ED83B5`；正文、状态色须保持语义与对比度。
- 保留真实封面原色及现有交互；只更改视觉品牌和用户确认的空状态辅助文案。
- 空曲库页保留主标题与“添加文件夹”操作，移除其上、下方辅助提示；唱片唱针可见且唱头落在唱片沟槽内。
- 不删除旧设计稿；对已有的未提交改动只做本计划范围内的窄编辑。
- 构建前检查目标无并发进程，清理对应固定 `.build-output` 目录；不清理 `.local/` 或用户资料。
- 未获明确要求不提交、不推送。

---

### Task 1: 主题令牌与对比度测试

**Files:**
- Modify: `packages/TinytuneKit/Sources/DesignSystem/Components.swift`
- Test: `packages/TinytuneKit/Tests/DesignSystemTests/TuneThemeTests.swift`

- [x] 先将主题测试改为新品牌色并补充渐变端点断言，运行定向测试确认失败。
- [x] 更新浅／深色 canvas、surface、text、accent、focus 和 `brandGradient`；让大面积填充使用中性色，渐变限于品牌标记和少数强调控件。
- [x] 重新运行主题测试，验证对比度断言与新令牌均通过。

### Task 2: 折光笺 Logo、应用图标与显示名称

**Files:**
- Create: `docs/brand/tingye-logo.svg`、`docs/brand/tingye-app-icon.svg` 及必要的导出脚本／归档说明
- Modify: `apps/Shared/Assets.xcassets/AppIcon.appiconset/`、`apps/Shared/Assets.xcassets/BrandMark.imageset/`、`apps/Shared/InfoPlist.xcstrings`、`apps/Shared/Localizable.xcstrings`、`apps/Shared/TinytuneApp.swift`、`apps/Tinytune.xcodeproj/project.pbxproj`
- Test: Asset Catalog JSON/PNG 尺寸校验与显示名称静态检查

- [x] 以审阅通过的折页音符造型建立无文字 SVG 主标识，并按统一源稿导出 iOS/macOS App Icon 与应用内 BrandMark。
- [x] 归档现有绿色 BrandMark 与旧 App Icon，保留历史资产。
- [x] 将系统显示名、About 本地化、应用页头回退名改为「听页」，保持所有工程标识不变。
- [x] 校验资源清单 JSON、图像尺寸/透明度及标识引用。

### Task 3: 空曲库与正在播放唱片

**Files:**
- Modify: `apps/Shared/CatalogViews.swift`、`packages/TinytuneKit/Sources/DesignSystem/NowPlayingRecord.swift`
- Test: `packages/TinytuneKit/Tests/DesignSystemTests/NowPlayingPresentationTests.swift` 与 iOS/macOS 构建

- [x] 空曲库保留标题和按钮，删除按钮上方说明与下方隐私提示；只清理已不再使用的本地化项。
- [x] 保留 `NowPlayingRecord` 的唱针结构与现有沟槽几何；以浅薰衣草金属／深墨紫阴影替换松绿配色，不遮挡圆形封面。
- [x] 保持 Reduce Motion、播放状态和封面旋转行为不变；运行唱针几何测试。

### Task 4: 新插画资源与原生接入

**Files:**
- Create: `docs/brand/illustrations/` 下浅/深色折页 × 声波 SVG 与 `packages/TinytuneKit/Sources/DesignSystem/Resources/Artwork.xcassets/Tingye*` 资源集
- Modify: `packages/TinytuneKit/Sources/DesignSystem/Components.swift`、`packages/TinytuneKit/Sources/DesignSystem/LibraryLandscape.swift`
- Test: Asset Catalog JSON、SVG 结构及 iOS/macOS 外观渲染检查

- [x] 创建 horizontal、portrait、header、page 构图及无封面唱片插画；新资源单独命名，旧图留存。
- [x] 接入新的浅/深色资源，保持点击、可访问性、高对比度和大字模式下的既有行为。
- [ ] 导出 iOS 与 macOS App 运行时截图检查裁切、留白、文字对比度（本轮完成独立 iOS 设计稿复核；未启动原生 App／模拟器做运行时截图）。

### Task 5: 原生文档与验收

**Files:**
- Modify: `README.md`、`docs/brand/README.md`、`docs/ui-design.md`、`docs/native-development-validation.md`

- [x] 更新当前品牌说明并将旧稿明确标记为历史版本。
- [x] 清理 `.build-output/TinytuneKit` 后运行 Swift Package 全套测试。
- [x] 分别清理并运行 macOS 与 iOS Simulator 构建；检查 icon、品牌图、浅/深色插画及名称。
- [x] 复核 `git diff`，确认功能逻辑和无关工作树修改没有被触碰；不提交。
