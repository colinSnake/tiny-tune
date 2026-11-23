# 「山间听曲」飞鸟版 · 视觉验收

## 对照条件

- 视觉基准：对话中确认的 `shanjian-birds-v03.png` 及其三个未缩放界面图（`shanjian-birds-macos.png`、`shanjian-birds-ios-light.png`、`shanjian-birds-ios-dark.png`）。插画原稿归档于 [`docs/brand/landscape/`](docs/brand/landscape/)；macOS 深色为从同一横卷衍生的补充配色，定稿板没有对应截图。
- 运行状态：空曲库、默认文字大小、未打开任何弹窗。macOS 独立测试应用窗口 **1120 × 720 pt**，截图 **1120 × 720 px**；iPhone 17 Pro 模拟器（iOS 26.5）**402 × 874 pt**，截图 **1206 × 2622 px**。比对统一转换为 sRGB，手机图降采样至 **402 × 874 px**。
- 运行截图：`.build-output/landscape-qa.w4tGdS/` 下的 `mac-final-light.png`、`mac-final-dark.png`、`iphone-final-light.png`、`iphone-final-dark.png`。同一对话内的 `shanjian-design-comparison.png` 上方为稿件，下方为应用运行截图。

## 对照结果

- **构图和间距**：完整画幅比较后，桌面横卷右下对齐；窄屏版本终点淡至标签栏上沿。主操作按钮、标题和唱片插画留在前景，山水不占用布局空间。
- **图形和色彩**：对比所截取的飞鸟、山脊和小亭区域（macOS `x790..1120, y386..710`；iOS `x156..402, y621..777`），sRGB 通道绝对差均值依次为 macOS 浅色 **1.137 / 255**、iOS 浅色 **0.569 / 255**、iOS 深色 **0.519 / 255**。轮廓、淡金点缀、透明度与纸纹均使用所选原稿导出，不以界面控件近似绘制。另查看 macOS 深色横卷，验证外观切换使用雾绿色资源。
- **字形和文案**：应用继续使用现有系统字体、字号、字重、按钮样式和空曲库文案。iOS 稿的示意标题与当前应用的「曲库里还没有歌曲」及说明行不同；本次只接入背景，不回退已有界面文案。macOS 工具栏对比度受窗口是否处于焦点影响，属于系统差异。
- **变更记录**：首次 iPhone 截图中山水整体比定稿高 **9 pt**。补偿标签栏附近的 9 pt 后，以相同视口重新截取浅色和深色；两张图与原稿的最佳垂直对齐偏移均为 **0 pt**。
- **辅助使用**：在 iOS 模拟器分别切换「增大对比度」和辅助字体 `accessibility-medium`、重新截屏，原插画区域已退回纯色。插画不参与命中测试或辅助功能树；未进行 VoiceOver 手动引导检查。

## 验证范围

- `scripts/check.sh`：49 项 XCTest 通过；macOS、iOS 设备目标（未签名）和 iOS 模拟器构建均通过。
- 验收覆盖空曲库于上述参考视口的静态显示；短视口的等比例缩放由单元测试覆盖。未在 iPhone 真机运行，也未重新验收本次范围外的导入和播放流程。

final result: passed
