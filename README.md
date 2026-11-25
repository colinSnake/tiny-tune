# 听页 · Tinytune

听页（Tinytune）是面向 iPhone 和 Mac 的原生本地音乐播放器。选择一个文件夹，即可按歌手、专辑和歌曲浏览与搜索。不需要账号或网络；音频保留在原处，应用只保存书签、索引和封面缩略数据。

## 运行开发版

1. 用 Xcode 打开 [`tinytune.xcworkspace`](tinytune.xcworkspace)。选择 **Tinytune-macOS → My Mac**，或 **Tinytune-iOS → iPhone 模拟器**，点击 Run（⌘R）。若之前运行过旧版，先退出旧版并执行 **Product → Clean Build Folder**，再从 Xcode 运行；Mac 新产物名为 `听页.app`。最低部署目标为 macOS 14 和 iOS 17，使用 Swift 6，不依赖第三方 Swift 包。实测工具链见[开发验证记录](docs/native-development-validation.md)。
2. 点击「添加文件夹」，选一个含音乐的小目录，查看扫描结果后确认。Mac 上可双击歌曲；iPhone 上可点按歌曲并从底部迷你播放器打开「正在播放」。
3. iPhone 真机开发可在本机的 `.local/tinytune-ios-signing.xcconfig` 中设置 `DEVELOPMENT_TEAM = <你的 Apple 开发团队 ID>`。该文件不进入 Git；仓库不包含个人签名团队、开发证书或描述文件。

Mac 原生客户端没有需要启动的服务。也可以在仓库根目录用终端构建并打开（若正在运行旧版，先退出）：

```sh
xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-macOS \
  -destination "platform=macOS,arch=$(uname -m)" \
  -derivedDataPath "$PWD/.build-output/macOS" build && \
  open "$PWD/.build-output/macOS/Build/Products/Debug/听页.app"
```

先试合成样本（需要 Python 3；命令不会覆盖既有目录）：

```sh
python3 scripts/make-smoke-library.py "$HOME/Music/Tinytune Smoke"
```

脚本生成三首合成 WAV 和一个故意损坏的 `.mp3`，预期扫描结果是 **3 首可导入、1 个跳过**。

专辑按实际存放歌曲的文件夹分组，`CD 1` / `Disc 2` 等分碟目录归到上一层。歌名优先用文件名；自动歌手名优先使用可确定的歌手文件夹（如 `歌手/专辑/歌曲`、`audio/歌手/歌曲`，或直接选择 `audio` 后的 `歌手/歌曲`），其次使用音频内嵌歌手标签，再用文件名或专辑歌手兜底。单独一层不明用途的文件夹仍按专辑处理，`audio`、`未归档歌曲` 和分碟目录不会误作歌手。同名专辑显示来源与相对目录；歌曲列表的正文只显示歌名和歌手，保留同名歌曲的不同版本，可通过「编辑显示名称」查看原文件的相对路径。

- 对既有来源点「重新扫描」可补录音频内嵌曲号、碟号。仅在能确认文件路径消失时才提示缺失；确认后不把缺失或确认损坏、不支持的歌曲加入队列。音频放回原路径或修复后重扫，可恢复原记录和手动显示名。旧曲库重扫也会用原始标签替换旧的推断值。
- 在歌曲上长按（iPhone）或右键（Mac），选择「编辑显示名称」可修改歌名、歌手或恢复自动名称。修改只保存在音乐库中，重扫不会覆盖，也不会改写音频。
- 歌手和专辑详情中的歌曲优先显示自己的封面，其次使用所属专辑的封面；两者都没有时显示占位图。
- 可通过歌曲的长按或右键菜单将单首歌曲移出曲库。移除后，普通重扫不会加回；在「来源 → … → 恢复已移除曲目」可只恢复选中的可播放文件，不必重导整个来源。原始文件不变，恢复后按新加入曲目处理。

- 移除整个来源会同时清除该来源的歌曲、手动显示名、缺失/不可播放状态和排除记录，并清理不再被使用的导入歌词、封面缓存及播放队列引用；其他来源和原始音乐文件不受影响。再次导入按新来源建立记录，启动时也会修复旧版本遗留的无来源记录。

## 时码歌词

App 播放本地音频时可读取同目录、同名的 `.lrc`（例如 `01 曲名.flac` 搭配 `01 曲名.lrc`）。歌词显示在「正在播放」的唱片页内；macOS 也可以从播放底栏打开歌词侧栏。如果显示没有歌词或读取失败，补放或修好文件后点「重新读取歌词」即可，不用切歌或重新扫描。有时码则高亮并自动跟随，支持点句定位；手动翻看后可点「回到当前句」恢复跟随。纯文本只展示、不跳转。App 不联网获取歌词，也不改写音频。

给当前歌曲单独加歌词时，在唱片页选择「导入歌词…」（已有歌词时在歌词区的「…」菜单中）。选择 UTF-8 `.lrc`，对照预览里的音频路径确认版本后导入；文件不必和音频同名。导入的歌词按曲目保存，优先于同目录歌词。不再使用时，从同一菜单选择「移除导入的歌词」，即可恢复读取同目录歌词。导入与移除都不会改动原文件或打断播放。

可在[独立 Web 工作台](tools/LyricsWorkbench/README.md)查找、核对并下载 `.lrc`，再带回 App。

## Monorepo

- `apps/Shared/`：两端共用的 SwiftUI 界面、平台导航及应用状态；各平台单独维护权限和应用配置。
- `packages/TinytuneKit/`：同一个本地 Swift Package，提供 `Domain`、`Library`、`Playback`、`DesignSystem` 四个模块。
- `scripts/check.sh`：运行 Swift Package 测试，并构建 Mac、无签名 iOS 设备目标与 iOS 模拟器目标。

## 开发状态

已接通扫描预览、持久音乐库、浏览搜索、来源管理、播放控制和队列。开发版应用内默认简体中文，采用[「折光笺」Logo 与紫粉渐变主题](docs/brand/README.md)，配折页与声波原创矢量插画；系统面板和歌曲元数据保留各自的语言。开发版用一个按钮切换顺序播放、单曲循环、随机播放，并支持本地续播和切歌时跳过不可播放的候选。独立 QA 版已在 iPhone 真机跑通本机目录导入、冷启动续播、回主屏后的自然切歌及控制中心媒体操作；物理锁屏由用户真机补测通过；来源撤权和 Mac 硬件媒体键仍待验收。见[实体 iPhone 复验](docs/native-development-validation.md#实体-iphone-复验)。

[PRD](docs/prd.md) · [UI 设计](docs/ui-design.md) · [路线图](docs/roadmap.md) · [M0 真机记录](docs/m0-device-validation.md) · [本地试用交接](docs/local-preview.md)
