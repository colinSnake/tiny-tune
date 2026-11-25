# 听页 · Tinytune 品牌

面向用户的 App 名称为「听页」，macOS 构建产物为 `听页.app`；工程、scheme、内部产品名及 Bundle ID `org.tinytune.player` 保持不变。品牌表达采用候选 03「折光笺」：折页轮廓中以负形留出音符，传达“为音乐留一页”的安静、轻盈感。

## 标志与色彩

- **正式源稿**：[听页 Logo SVG](tingye-logo.svg)。主色由鸢尾紫 `#8367F4` 过渡到玫瑰粉 `#ED83B5`，中段为柔和紫。Logo 使用渐变；小字号正文、状态文本和错误提示不使用渐变。
- **语义色**：浅色底 `#FAF8FC`、白色浮层、主文字 `#2A2331`、辅助文字 `#756B7E`；深色底 `#19151F`、浮层 `#27212D`、浅色文字 `#F7F1FA`。按钮与可读控件使用实色鸢尾紫 `#6D4AC4`（深色外观 `#C1A9FF`），不以渐变替代文本对比。警告、错误、成功维持独立语义色。
- **使用原则**：真实专辑封面保留原色；品牌紫粉用于标志、选中反馈和少量主要强调，不铺满整页。
- **图标导出**：iOS PNG 使用不透明浅纸底；macOS 图标使用透明画布。通过 `scripts/render-tingye-icons.py` 从主 SVG 同步导出，勿单独手工漂移图形。

## 插画语言

插画以“折页 × 声音流动”为主线，用纸张折层、弧形声波、留白与克制的紫粉渐变构图。原生构图源稿位于 [`illustrations/`](illustrations/)；不以山水、传统乐器、梅花或植物纹样作为当前品牌视觉。

- **macOS**：[`mac-fold-light.svg`](illustrations/mac-fold-light.svg) 与 [`mac-fold-dark.svg`](illustrations/mac-fold-dark.svg) 分别在 Chromium 中以 1080 × 680 透明画布、2× 像素倍率渲染为 PNG，由 `TingyeMacLibraryBackground` 资产随系统明暗切换。插画固定在主内容区右下，空曲库、列表、搜索、来源共用；不延到侧栏、歌词栏或正在播放页。窗口较窄时降低插画存在感；增强对比度和辅助大字隐藏插画。
- **LyricsWorkbench**：`public/web-paper-left.svg` 与 `public/web-paper-right.svg` 铺在页面两侧，不属于搜索页头；窄屏只保留右上角折页，歌曲和歌词面板以实色遮挡插画。高对比度和强制颜色模式隐藏插画。
- **iOS**：「耳边折页」沿右下角展开，[浅色](illustrations/iphone-earfold-light.svg)与[深色](illustrations/iphone-earfold-dark.svg)源稿通过 `sips -s format png` 渲染为 1170 × 672 透明 PNG，存入 `TingyePhoneLibraryBackground`。曲库、搜索与来源共用一层固定背景；空曲库用较高不透明度，浏览态减淡。短视口按比例缩小，增强对比度和辅助大字时隐藏。正在播放页背景与真实封面比例保持不变。

以上装饰不拦截交互，不进入辅助朗读。

## 历史设计稿

以下资源保留为探索记录，不属于现行品牌系统：

- [原蓝紫「弦风」](tinytune-app-icon-xianfeng.svg)及[「折叠旋律」对照稿](tinytune-app-icon-xianfeng-preview.png)。
- [青瓷绿](tinytune-brand-celadon-preview.png)、[暖竹青](tinytune-brand-warm-celadon-preview.png)、[薄荷青](tinytune-brand-mint-preview.png)、[杏笺与朱漆](tinytune-brand-paper-lacquer-preview.png)。
- [蜜釉、桃陶、松笺、梅墨对照](tinytune-brand-four-palettes-preview.png)，以及[梅花版本图标](tinytune-app-icon-xianfeng-plum-inlay.svg)。
- `landscape/` 与 `Header-Light.svg`、`Page-Light.svg` 为旧山水插画设计稿，留作历史记录，不再作为当前 App 或 Workbench 的品牌装饰。

历史图板里的“已接入／未接入”仅反映当时制作状态。
