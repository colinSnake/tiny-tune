# 曲笺 · Tinytune

曲笺（Tinytune）是面向 iPhone 和 Mac 的原生本地音乐播放器。选择一个文件夹，即可按歌手、专辑和歌曲浏览与搜索。不需要账号或网络；音频保留在原处，应用只保存书签、索引和封面缩略数据。

## 运行开发版

1. 用 Xcode 打开 [`tinytune.xcworkspace`](tinytune.xcworkspace)。选择 **Tinytune-macOS → My Mac**，或 **Tinytune-iOS → iPhone 模拟器**，点击 Run（⌘R）。最低部署目标为 macOS 14 和 iOS 17，使用 Swift 6，不依赖第三方 Swift 包。实测工具链见[开发验证记录](docs/native-development-validation.md)。
2. 点击「添加文件夹」，选一个含音乐的小目录，查看扫描结果后确认。Mac 上可双击歌曲；iPhone 上可点按歌曲并从底部迷你播放器打开「正在播放」。
3. iPhone 真机开发可在本机的 `.local/tinytune-ios-signing.xcconfig` 中设置 `DEVELOPMENT_TEAM = <你的 Apple 开发团队 ID>`。该文件不进入 Git；仓库不包含个人签名团队、开发证书或描述文件。

Mac 原生客户端没有需要启动的服务。也可以在仓库根目录用终端构建并打开（若正在运行旧版，先退出）：

```sh
xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-macOS \
  -destination "platform=macOS,arch=$(uname -m)" \
  -derivedDataPath "$PWD/.build-output/macOS" build && \
  open "$PWD/.build-output/macOS/Build/Products/Debug/Tinytune.app"
```

先试合成样本（需要 Python 3；命令不会覆盖既有目录）：

```sh
python3 scripts/make-smoke-library.py "$HOME/Music/Tinytune Smoke"
```

脚本生成三首合成 WAV 和一个故意损坏的 `.mp3`，预期扫描结果是 **3 首可导入、1 个跳过**。

## 时码歌词

App 播放本地音频时可读取同目录、同名的 `.lrc`（例如 `01 曲名.flac` 搭配 `01 曲名.lrc`）。在 iOS「正在播放」或 macOS 播放底栏点引号气泡「歌词」。有时码则逐行跟随、支持点句定位；纯文本无跳转。App 不联网获取歌词，也不改写音频。

按歌手查曲目和歌词请使用[独立 Web 工作台与命令行脚本](tools/LyricsWorkbench/README.md)，不下载音频。

## Monorepo

- `apps/Shared/`：两端共用的 SwiftUI 界面、平台导航及应用状态；各平台单独维护权限和应用配置。
- `packages/TinytuneKit/`：同一个本地 Swift Package，提供 `Domain`、`Library`、`Playback`、`DesignSystem` 四个模块。
- `scripts/check.sh`：运行 Swift Package 测试，并构建 Mac、无签名 iOS 设备目标与 iOS 模拟器目标。

## 开发状态

已接通扫描预览、持久音乐库、浏览搜索、来源管理、播放控制和队列。开发版应用内默认简体中文，采用[「琴身嵌梅」图标与松笺浅／深色主题](docs/brand/README.md)，配原创矢量插画；系统面板和歌曲元数据保留各自的语言。开发版用一个按钮切换顺序播放、单曲循环、随机播放，并支持本地续播和切歌时跳过不可播放的候选。独立 QA 版已在 iPhone 真机跑通本机目录导入、冷启动续播、回主屏后的自然切歌及控制中心媒体操作；物理锁屏由用户真机补测通过；来源撤权和 Mac 硬件媒体键仍待验收。见[实体 iPhone 复验](docs/native-development-validation.md#实体-iphone-复验)。

[PRD](docs/prd.md) · [UI 设计](docs/ui-design.md) · [路线图](docs/roadmap.md) · [M0 真机记录](docs/m0-device-validation.md) · [本地试用交接](docs/local-preview.md)
