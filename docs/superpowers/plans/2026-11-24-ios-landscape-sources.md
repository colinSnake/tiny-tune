# iOS 晴川留白设计落地计划

> 根据已批准的 `docs/design/2026-11-24-ios-landscape-sources` 设计实施；不再重复设计审批。
> 使用 writing-plans、test-driven-development 与 verification-before-completion；本任务不提交、不推送，不改动现有工作树中的无关修改。

## 目标与边界
- 原生 SwiftUI 落地音乐库/来源页的顶部山水背景、裸图标与左/右操作布局。
- 关于和导入预览采用紧凑、自适应高度、可滚动内容与固定底部动作。
- 保留系统文件夹选择器、真实数据、导入/重连/恢复/移除确认、三标签及播放器。macOS 外观/逻辑保持原样。

## 实施步骤
1. **回归基线（RED）**：扩展原有 iOS 导航源码检查，覆盖顶部图标、来源操作、弹窗适配及无障碍；先运行并记录预期失败。
2. **背景与页面**：复用 Web 插画生成独立 Header 日/夜资源；在 DesignSystem 增加顶部装饰组件，尊重高对比度/辅助字号；原有空态插画不覆盖。更新 TinytuneApp/CatalogViews/SourceViews 的 iOS 分支，保留业务回调。
3. **弹窗**：独立 iOS 内容分支、统一标题/文件夹卡片/统计/跳过详情/主操作；关于使用品牌图形。默认紧凑 detent + large，辅助字号用 large；不裁掉错误/恢复选择。
4. **验证（GREEN）**：运行导航结构和资源检查；清理确认无人占用的目标构建目录后，运行 Swift 包测试及 iOS 模拟器/设备编译。若缺少模拟器 runtime，明确记录未执行运行截图、VoiceOver 和 Dynamic Type 实测，不冒充通过。

## 文件职责
- `packages/TinytuneKit/Sources/DesignSystem/LibraryLandscape.swift`：复用现有实现，增加顶部插画与布局度量。
- `packages/TinytuneKit/Sources/DesignSystem/Resources/Artwork.xcassets/LibraryLandscape-Header.imageset`：日/夜透明资源。
- `docs/brand/landscape/Header-*.svg`、`scripts/render-library-landscape.py`：可编辑源图与可复现导出。
- `apps/Shared/TinytuneApp.swift`：页面导航/上方操作/关于 detent。
- `apps/Shared/SourceViews.swift`：来源卡片、关于及导入预览的原生内容。
- `apps/Shared/CatalogViews.swift`：如需，接入顶部标题/背景，保留原分类与排序。
- `apps/Shared/Localizable.xcstrings`：仅追加本次新文案。
- `scripts/tests/test_ios_landscape_design.py`：静态布局及资源约束；`scripts/check-ios-navigation.swift`：供后续在真机/模拟器截图上核对标题与标签栏。

## 验证约束
每次编译前先确认无相关运行中的构建，定向清理该目标产物与缓存，固定输出目录；不删除用户数据、`.local/` 或验收资料。日志留在 `.build-output`，验收摘要补入设计目录。
