# 曲笺 · Tinytune 品牌

App 显示名为「曲笺」，英文工程名 Tinytune、构建产物 `Tinytune.app` 和 Bundle ID `org.tinytune.player` 保持不变。

正式图标定为「弦风 · 琴身嵌梅」（[位置对照图](tinytune-brand-plum-blossom-preview.png)中间的 **01**）。保留琵琶与竹笛交叠的构图，在琵琶琴身右侧嵌一朵淡金五瓣梅；琴头和笛口之间留白，不加枝叶或文字。

- **正式源稿**：[琴身嵌梅 SVG](tinytune-app-icon-xianfeng-plum-inlay.svg)。暖燕麦至浅苔绿底板 `#F2ECD9` → `#C9CEAE`，配松墨绿琵琶、低饱和绿竹笛与淡金梅花 `#CFBB91`。
- **应用主题**：「松笺」。浅色用暖纸白背景与松墨绿 `#355541`，深色用墨绿背景与浅苔绿 `#C4D5A7`。导航、按钮、播放进度与插画使用同一色系；不染真实专辑封面，图标点缀色不用于警告状态。完整语义色见 [UI 设计 · 视觉系统](../ui-design.md#6-视觉系统与组件)。

iOS 和 macOS 共用 [`AppIcon` 资源集](../../apps/Shared/Assets.xcassets/AppIcon.appiconset/)，其中 PNG 由同一个 SVG 导出：

- **iOS**：移除底板的圆角，导出 1024 × 1024 的不透明 RGB PNG；系统裁剪图标外轮廓。
- **macOS**：保留底板圆角，将图形缩至 824 × 824，居中放在 1024 × 1024 的透明画布上，再按资源集要求缩放。相同像素尺寸的槽位复用同一文件。

更新图标时请同时更新两端的 PNG，并用 `scripts/check.sh` 检查两端构建。

## 原创山水背景「山间听曲」

以飞鸟版设计稿为准：借竹笛的斜势画远山，借琵琶的弧线画近岸，淡金只点在亭檐与灯窗。macOS 横卷用四羽，iOS 窄屏重构用三羽；浅色为暖纸松墨，深色为雾绿山影。原稿在 [`landscape/`](landscape/)，均为本项目原创，不使用馆藏或其他第三方插画。

背景只放在空曲库的内容区底层；不进入歌曲列表、搜索、播放控件或系统导航，也不随空态内容滚动。放大的辅助阅读字号及高对比度模式下让位于纯色底。

发布用浅／深色透明资源在 `DesignSystem` 的 `Artwork.xcassets`。如修改源稿，在已安装 Pillow 和 NumPy 的 macOS 环境中运行 `python3 scripts/render-library-landscape.py` 重新导出；正常构建不需要 Python 依赖。

## 历史设计稿

下列文档保留探索过程，不是正式资源：

- [原蓝紫「弦风」](tinytune-app-icon-xianfeng.svg)及[与「折叠旋律」的对照](tinytune-app-icon-xianfeng-preview.png)。
- [青瓷绿](tinytune-brand-celadon-preview.png)、[暖竹青](tinytune-brand-warm-celadon-preview.png)、[薄荷青](tinytune-brand-mint-preview.png)、[杏笺与朱漆](tinytune-brand-paper-lacquer-preview.png)。
- [蜜釉、桃陶、松笺、梅墨对照](tinytune-brand-four-palettes-preview.png)。其中松笺的配色被定稿采用。
- [02「留白落梅」](tinytune-app-icon-xianfeng-plum-between.svg)：梅红小花落在琴头和笛口之间，已由 01「琴身嵌梅」取代。

历史图板里的「已接入」或「未接入」描述的是制作时的状态。
