# 原生开发版验证记录

> 构建独立的 macOS Debug 测试副本时，传入 `TINYTUNE_MACOS_BUNDLE_IDENTIFIER=org.tinytune.player.qa`。不要从命令行全局覆盖 `PRODUCT_BUNDLE_IDENTIFIER`，否则 Swift package 的资源 Bundle 也会被改成相同 ID，导致默认封面无法加载。

> 2026-11-19（Asia/Shanghai） · UI 与最小功能已接通；[M0](m0-device-validation.md) 与 [M1](roadmap.md#m1--原生工程与纵向切片) 均未达到退出条件。

## 环境与验证结果

本机 Apple Silicon Mac mini，macOS 27.2.1（26B131）、Xcode 27.0（27A266a）、Apple Swift 6.4。模拟器为 iPhone 17 / iOS 26.5。部署目标为 iOS 17、macOS 14，未在最低系统上运行验证。本轮未安装或测试实体 iPhone 上的播放器。

| 检查 | 实际结果 |
| --- | --- |
| `scripts/check.sh` | 退出码 0：9 个 XCTest（4 个 Domain、5 个 Library）通过；macOS、通用 iOS 设备目标（无签名）和 iOS 模拟器目标均构建成功。未执行远端 CI。 |
| `codesign --verify --strict` 检查 Mac Debug app | 通过。另检视签名，包含 App Sandbox、用户选取只读与 app-scoped bookmark 权能；不是发布签名。 |
| Mac 小目录烟测 | 在使用独立标识的 Debug app 中经系统面板选取合成样本。摘要为新增 3 首、跳过 1 个损坏文件；确认后出现两个歌手，退出重开后仍可浏览并点播。 |
| Mac 播放及搜索 | 双击 `First Light`，观察播放计时前进后暂停；队列显示 `Glass Lake (Live)`。暂停时搜索该曲有一个结果，没有替换当前曲目。视觉检查详情页内底栏、进度滑块和队列入口。未做扬声器采集、硬件媒体键或 seek 落点测量。 |
| 原始样本 | 对导入前的 4 个文件重新执行 `shasum -a 256 -c`，全部匹配。SwiftData 测试另覆盖重新打开索引及移除来源时保留原音频。 |
| iPhone 模拟器 | 使用 `simctl install`、`simctl launch` 与 `simctl io screenshot` 验证当前构建能启动；检查简体中文空库、添加文件夹入口及底部导航的浅／深色截图。未跑通模拟器目录选择与播放链路。 |

## 复现 Mac 小样本流程

1. 通过 `python3 scripts/make-smoke-library.py "$HOME/Music/Tinytune Smoke"` 生成独立测试目录。需要验证样本完整性时，对目录内容预先保存 SHA-256，流程后重新校验。
2. 在 Xcode 运行 `Tinytune-macOS`；在空库中选中样本根目录。预期摘要是新增 3 首、跳过 1 个。确认后浏览 `Daybreak` 与 `Field Notes`，退出再打开应用；不重选目录，进入 `Daybreak`。
3. 双击 `First Light`，观察底栏计时前进后暂停；打开队列确认 `Glass Lake (Live)` 在后方。搜索 `Glass Lake`，确认结果和当前曲目状态。需要清理时，可从「来源」移除测试索引，再独立处理生成的样本目录。

## 首轮记录中的待验证或实现

以下是首轮边界；后续设备进展以本文后面的逐次复验为准。

- 与 M0 探针结果一致，开发版发现书签陈旧时，在开启旧访问权限前停止并要求重新选取。尚未完成实体 iPhone 的授权、冷启动、锁屏／后台、格式矩阵，以及 Mac 外接卷、媒体键和系统播放状态验收。
- 尚未完成双端 30 首样本端到端验收、iPhone 真机随机播放与续播、细粒度移除／全库缺失文件对账，以及大库性能和辅助功能 QA。现阶段的测试不替代这些门槛。

## 靛蓝唱片主题与中文界面复验

2026-11-19：在独立 Mac Debug 构建使用 `-AppleLanguages '(en)' -AppleLocale en_US` 启动。旧版侧栏以英文显示；新版检查了中文侧栏、窗口标题、搜索提示、导入摘要、播放控件和队列弹层。系统文件选择器的系统文案仍跟随启动语言，应用提供的选取说明是中文。

- 从系统选择器打开用户授权的现有音乐目录：首次预览新增 58 首、跳过 0 首，确认后可按歌名查到并点播抽样曲目。观察播放计时前进和暂停状态切换。退出进程后重开，仍显示来源与 58 首，无需重选目录即可重扫和点播；重扫报告 58 首未变化，没有新增或更新。没有逐首试听或覆盖后台和系统媒体键。
- 比对测试前后目录中 61 个常规文件的相对路径及 SHA-256，全部一致。仓库不保存真实音乐、路径清单或曲目截图。
- iPhone 17 / iOS 26.5 模拟器以同样的英文参数启动，检查简中空库、底部标签页，以及原创插画在浅／深色下的显示。实体 iPhone 未运行本次构建。
- `scripts/check.sh` 再次通过（9 个测试，3 个构建）；Mac Debug 签名检查通过。计算主题语义实色的 sRGB 对比度，正文／警告／强调色与指定背景及实色按钮标签均 ≥4.5:1；不代表通过系统高对比度和辅助功能全量验收。

## 本地续播复验

2026-11-19：`scripts/check.sh` 退出码 0，19 个 XCTest（10 个续播、5 个曲库、4 个领域）通过；macOS、通用 iOS 设备（无签名）和 iOS 模拟器构建均成功。续播测试覆盖冷启动不解析音频、来源打开失败且保存原位置、移除失效 ID、坏数据／未来版本、结束状态、清空队列、实际 seek、替换为较短文件和失败后的显式从头播放。

- 使用独立标识 `org.tinytune.player.resumeqa` 的 Mac Debug app，`codesign --verify --strict` 通过。经系统选择器导入 3 首合成音频；不使用真实音乐库。
- 在歌曲列表播放 `Distant Tide`，暂停后开启列表循环，并从队列移出合成曲目 `First Light`，再点播放。播放计时约 7.75 秒时正常 `⌘Q`，进程退出。重启时显示同一首曲目和约 8.02 秒进度，循环模式和唯一待播 `Glass Lake (Live)` 保留。检查队列前后进度未变化，点播放后进度从 8.02 秒继续前进。
- 另外暂移当前合成音频后冷启动：尚未按播放时即显示无法播放与「查看来源」，未改曲或清空进度。点击重试失败后「从头播放」出现；放回文件后点该按钮，从 0 秒播放同一首。恢复后的合成样本与原始副本内容一致。
- 本轮没有在实体 iPhone 或 iOS 模拟器上运行续播链路，未测 iPhone 锁屏／后台、硬件媒体键、外接卷掉线、强制退出的恢复点、最低系统版本或远端 CI。Mac 的测试以播放状态、时间和快照为证据，未采集扬声器输出。M0／M3 未整体放行。

## 随机播放与实际历史复验

2026-11-19：`scripts/check.sh` 退出码 0，31 个 XCTest（14 个播放、12 个领域、5 个曲库）通过；macOS、iOS 通用设备（无签名）、iOS 模拟器目标均构建成功。固定种子覆盖无放回、与列表／单曲循环组合、跨轮返回后不消耗新轮次，以及移除后不再回到队列。新快照保存实际历史、向前重播路径和本轮待播；旧版快照仍可读取，不推测旧记录里从未保存的历史。

- 复用标识为 `org.tinytune.player.resumeqa` 的独立 Mac Debug app，更新后 `codesign --verify --strict` 通过。旧版合成曲库和 V1 快照正常载入：3 首歌、保留 `Distant Tide` 的暂停位置及列表循环，无需重新导入。
- 从歌曲列表播放 `Distant Tide`，在队列直接选 `Glass Lake (Live)`、跳过 `First Light`，并在第三首开头暂停。按「上一首」回到 `Distant Tide`；按「下一首」回到 `Glass Lake (Live)`，保持暂停。
- 开启随机，原曲和列表循环不变，待播为 `Distant Tide`、`First Light`。正常退出并重开，仍为暂停，随机仍开启，两个待播项次序不变。关闭随机没有切歌或改变循环模式。测试音频内容未改变。
- 本轮未执行 iOS 模拟器界面、实体 iPhone、Mac 最小窗口尺寸及 VoiceOver 专项检查；未修改失败耗尽策略，M0／M3 未整体放行。

## 不可播放曲目恢复复验

2026-11-19：`scripts/check.sh` 退出码 0，37 个 XCTest（20 个播放、12 个领域、5 个曲库）通过；macOS、通用 iOS 设备（未签名）、iOS 模拟器构建成功。新增回归覆盖自然推进遇损坏 WAV 时继续、列表循环最多尝试一次每首歌、单曲循环起播失败后停止、失效历史项不进入前向重播、移除当前后选择可播尾部，以及暂停／移除／重新选曲时拒收迟到结果。原有冷启动恢复测试继续验证直接起播失败不换曲、不清空进度。

- 复用独立 Mac Debug 版 `org.tinytune.player.resumeqa`，`codesign --verify --strict` 通过。暂移 3 首合成样本中的第二首，暂停第一首后点「下一首」：选中第三首，显示「已跳过 1 首」，保持暂停。
- 保持列表循环，暂移剩余两首后再点「下一首」：播放位置停止、显示「没有可播放的歌曲」，展开「正在播放」可见「重试」与「查看来源」。仅放回第一首后点「重试」，从第一首开始播放。全部样本和测试版原检查点已还原，`diff -qr` 确认样本内容与原副本一致，未访问真实音乐目录。
- 播放验证以 AVPlayer 状态、快照和 Mac 界面为依据，未采集扬声器输出。iOS 本轮仅构建；未执行 iOS 模拟器交互、实体 iPhone、锁屏／后台、媒体键或外接卷断开的端到端验收。未整体放行 M0／M3。

## iOS 后台与冷启动续播复验

2026-11-20（Asia/Shanghai）：`scripts/check.sh` 退出码 0，37 个 XCTest 通过；macOS、通用 iOS 设备（无签名）和 iOS 模拟器构建均成功。以下为 iPhone 17／iOS 26.5 专用模拟器，不是实体设备结果。

| 场景 | 实际观察 |
| --- | --- |
| 系统目录选取 | 通过「我的 iPhone」选取 `Playback Smoke`，确认预览为新增 3 首、损坏音频跳过 1 首，确认后可点播。四个中文 Tab 保留。 |
| 播放中切到主屏 | 从 `Distant Tide` 自然推进到 `First Light`。还在主屏时，同一首 `First Light` 的 V2 检查点由 5.00 s 更新至 10.25 s。这是播放时钟与持久化证据，不是实际扬声器听感。 |
| 结束进程并冷启动 | 暂停 `Distant Tide` 在约 15.48 s，开启随机，使用 `simctl terminate`／`launch`。新进程仍显示约 0:15 和播放按钮，没有自动开始播放；队列为 `Glass Lake (Live)`、`First Light`，随机保持开启。无需重选目录，点播放后进度从保存位置继续。 |
| 系统媒体控件 | 模拟器控制中心未显示可执行的媒体控件；未取得系统控制成功证据。 |

模拟器仅使用项目合成音频，测试前后与原副本的 `diff -qr` 一致。未操作个人曲库，也未验证硬件音频路由、线控或系统打断。

### 实体 iPhone 复验

2026-11-20（Asia/Shanghai），iPhone 17 Pro Max／iOS 27.2.1，USB 直连。独立测试版 **Tinytune QA**（`org.tinytune.player.playbackqa`，0.1.0 / 1）首次安装后远程启动超时；本次重连后 `xcrun devicectl device process launch` 成功，使用 Xcode Device Hub 操作实体屏幕。合成曲库只写入 **Tinytune Fixtures** 的 Documents，快照只从 **Tinytune QA** 容器读取；没有写入正式版或访问个人曲库。

| 场景 | 结果与实际观察 |
| --- | --- |
| 系统选取与导入 | **通过。** 在「我的 iPhone → Tinytune Fixtures → Playback Smoke」选取目录。预览新增 3 首，跳过 1 首损坏音频；确认后来源页与歌曲列表均显示 3 首。未给 QA 版开启无线数据权限。 |
| 回主屏与自然切歌 | **通过。** 点播 `Distant Tide` 后回到主屏，没有手动切歌。`devicectl device copy from` 读取的 V2 快照显示首曲从 11.500 s 到 16.752 s，再自然推进到待播首项 `First Light`，后者从 0 到 20.750 s。 |
| 冷启动与原目录续播 | **通过。** 随机模式下暂停 `Distant Tide` 在 10.994 s，以 `devicectl device process launch --terminate-existing` 冷启。无需重选目录，仍显示暂停；重启前后快照相同，随机仍开启，待播顺序仍为 `Glass Lake (Live)`、`First Light`。手动播放从约 0:11 继续，而不是从头播放。 |
| 控制中心媒体命令 | **通过。** 系统上一首由 `Glass Lake (Live)` 切回 `First Light`；系统播放后再暂停，连续两次检查点稳定在 0.321 s，未走到曲末；系统下一首切到 `Glass Lake (Live)` 并保持暂停，回到应用看到同样的曲名和状态。 |
| 物理锁屏 | **用户手测通过。** 用户在实体 iPhone 上补测并确认锁屏场景正常。此前 Device Hub 未取得可观察的锁屏画面；这一项记录用户反馈，不以控制中心结果代替，也未采集逐项操作日志。 |

用 `devicectl device copy from` 取回合成样本，`diff -qr` 确认文件不变；读取的快照仅验证播放状态和时钟，未采集扬声器输出。未测线控、音频打断、数据源移动／撤权或全格式矩阵。本次没有重跑构建与 XCTest，M0／M3 未整体放行。

## 2026-11-20 真机追加验证

本节为 2026-11-20（Asia/Shanghai）的**工具实测**。既有 iPhone 物理锁屏结论仍是「用户手测通过」，本轮未重测。只使用独立 QA 标识与合成文件，未运行正式版或访问个人曲库。没有改应用代码；未执行 `scripts/check.sh`，也没有以模拟器或历史构建替代本轮真机证据。

### Mac 媒体验收

Apple Silicon Mac mini／macOS 27.2.1（26B131），Xcode 27.0（27A266a）／Swift 6.4。本轮以 `xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-macOS -destination platform=macOS,arch=arm64 … PRODUCT_BUNDLE_IDENTIFIER=org.tinytune.player.macmediaqa ENABLE_DEBUG_DYLIB=NO build` 在单独的输出目录重编 Debug 包。构建退出 0，`codesign --verify --strict` 通过；核验沙盒、用户选取只读和 app-scoped bookmark 权能。经原生选取器导入 `Media Smoke`，新增 3 首、损坏文件跳过 1 个；四个文件的前后 SHA-256 一致。

| 场景 | 状态与证据 |
| --- | --- |
| 歌曲列表焦点下的空格 | **通过（工具实测，普通键盘事件）。** 在歌曲列表双击 `Distant Tide`，连续分三次按空格并在每次后读取界面：播放 → 暂停 → 播放 → 暂停。每次看到一次预期状态切换；曲名不变，最终暂停在 0.372 s，待播依旧是 `First Light` → `Glass Lake (Live)`。不是硬件媒体键验收。 |
| 搜索框与系统文件对话框焦点 | **通过（工具实测）。** 在工具栏搜索框输入 `First`、空格、`Light`，搜索值为 `First Light`；随后在原生文件选取器「前往文件夹」输入包含普通空格的 `Media Smoke` 路径，再取消对话框。两者均接受空格，当前曲与暂停点（0.372 s）不变。 |
| 底栏切歌对照 | **通过（工具实测）。** 暂停在 `Distant Tide` 时点一次底栏「下一首」，只到 `First Light`、仍暂停，队列仅余 `Glass Lake (Live)`；点一次「上一首」回到 `Distant Tide`。 |
| `MPNowPlayingInfoCenter` 发布值 | **通过（工具实测，仅 QA 进程内）。** LLDB 附加到独立 QA 进程，只读回 SDK 的 `nowPlayingInfo` 与 `playbackState` 后脱离。切到 `First Light` 后读到曲名、24 s 时长、0 s 起点、播放速率 1、`.playing`；另一次暂停时读到同曲、1.350187932 s、速率 0、`.paused`，与底栏读数一致。不是系统媒体面板或命令分派的证据。 |
| 系统 Now Playing 面板及按钮 | **阻塞。** 当前桌面工具未能打开并读取 macOS 控制中心（绑定系统菜单进程超时），未取得系统面板曲名、动态进度、状态或由系统按钮切歌的证据。不能以进程内读回代替。 |
| 硬件媒体键与重复分派 | **阻塞，待用户按实体键。** 未发送模拟媒体键；硬件单次按下是否只切一首、播放／暂停及系统命令是否重复分派均未验证。QA 起点已留在 `Distant Tide` 暂停，队列为 `First Light` → `Glass Lake (Live)`；先按一次实体「下一首」以区分未响应、单次切歌和跳过一首。 |
| 外接卷掉线／恢复 | **阻塞。** `diskutil list external physical` 无结果；未使用模拟器磁盘映像代替物理外接卷。 |

### 实体 iPhone 来源与音频打断

iPhone 17 Pro Max／iOS 27.2.1，连接现有物理设备，通过 Device Hub 操作已部署的 **Tinytune QA**（`org.tinytune.player.playbackqa`）。用 `devicectl` 仅从 QA 播放器与 **Tinytune Fixtures** 容器取证。未重装 QA，也未重复导入、锁屏或控制中心用例。

| 场景 | 状态与证据 |
| --- | --- |
| 同一「我的 iPhone」提供者内移动来源 | **通过（工具实测）。** 在系统「文件」中将 `Tinytune Fixtures/Playback Smoke` 移到同容器的 `Background/Playback Smoke`，取回样本确认新路径有效。回到 QA，「来源」仍显示 3 首，无不可用提示。保持目录在新位置，用 `devicectl device process launch --terminate-existing` 冷启；重启前后检查点逐字节相同（`Glass Lake (Live)` 暂停约 2.611 s、随机队列未改）。未重新选取来源，手动播放后同曲检查点自然到达 22 s（曲末）。最后用系统「文件」移回原位置，移前样本与移址后、归位后的副本 `diff -qr` 均无差异。本项不等于撤权、跨提供者移动或远程文件未落地。 |
| 系统媒体抢占 | **通过（工具实测，系统「文件」快速查看场景）。** 播放 `Distant Tide` 后切到「文件」，未开始预览时 Tinytune 的后台检查点持续前进（1.508 → 6.750 → 12.000 s）。在系统快速查看点播另一条合成音频 `01-One` 后，Tinytune 检查点停在 13.042 s、未到曲末，采样及返回前台均不再推进，原曲和两首待播的顺序保持不变。关闭预览后看到「已暂停」，手动点播放再暂停，检查点前进到 13.564 s，队列未变化。只以画面和播放快照为证，未采集音频或 AVAudioSession 通知日志。 |
| 真正撤权 | **阻塞。** 本地同提供者移动没有使书签失效；未取得仅影响 QA 来源的独立撤权条件。没有用移除索引或移动目录冒充权限撤销。 |
| 耳机断开／线控 | **阻塞。** 未有可控的实体耳机接入／断开条件；未用软件切换代替。 |
| 来电、不可用 File Provider、全格式矩阵与最低系统版本 | **未测。** 没有触发真实来电；快速查看结果不能代替该场景。 |

本轮已执行项未观察到可复现的产品失败，未做代码修复或新增回归测试。系统面板、硬件媒体键、权限异常和配件条件等尚未闭环，**M0／M3 不放行**。

## 播放模式控件复验

2026-11-20（Asia/Shanghai）：Mac 底栏与 iPhone 全屏页改用同一个播放模式按钮，按顺序 → 单曲循环 → 随机 → 顺序切换。旧快照保留原曲、暂停位置和实际随机顺序；旧的随机＋循环以随机为准，仅列表循环则回落到顺序。未更改快照文件格式。此前的独立随机／列表循环记录是历史证据，不代表当前 UI。

- **自动验证通过。** 修改前，定向测试复现旧列表循环未回落、旧随机＋单曲循环未互斥；修改后，`scripts/check.sh` 退出 0：39 个 XCTest 通过（22 个播放、12 个领域、5 个曲库）；macOS、通用 iOS 设备（无签名）、iOS 模拟器三个目标均构建成功。回归验证三个模式的切换、冷启动恢复、旧快照和队列行为。
- **Mac 工具实测通过。** macOS 27.2.1 的独立 QA（`org.tinytune.player.modeqa`，`codesign --verify --strict` 通过）只导入合成样本。底栏始终只有一个播放模式按钮，依次显示编号列表、带 1 的循环箭头和交叉箭头；模式切换不改变当前 `Distant Tide` 或 0.332 s 暂停位置。单曲循环时从约 18.717 s 继续，越过 19 s 曲末后仍播放同曲，进度回到约 0.250 s；暂停后点一次「下一首」到 `First Light`，仍保持暂停。
- **Mac 音量工具实测通过。** 扬声器实心图标打开原竖直滑杆；键盘向下调整到 0% 后显示静音斜杠，`Esc` 可关闭。合成文件前后 SHA-256 均匹配，没有操作正式版或个人曲库。
- **未测。** 本轮 iPhone 只构建未安装，未做真机 UI 复验；未重测系统 Now Playing、硬件媒体键、锁屏或音频配件，不改变 M0／M3 整体验收结论。

## 交付前复核与 Mac 媒体键交接

2026-11-20（Asia/Shanghai）：复核当前工作树。**macOS 独立 QA 可在本机试用；M0／M3 未放行，不具备双端 v1.0 交付条件。** 没有改应用代码、重装 iPhone 或覆盖正式版。

| 范围 | 状态与证据 |
| --- | --- |
| 仓库检查 | **通过（自动验证）。** 本轮 `scripts/check.sh` 退出 0：39 个 XCTest（22 播放、12 领域、5 曲库）无失败；macOS、无签名 iOS 设备目标和 iOS 模拟器均构建成功。Mac 构建有 `PlayerViews.swift` 音量滑杆的主 actor 隔离警告；不将通过写成无警告。三端构建不是设备或分发验收。 |
| Mac QA 重建和手测起点 | **通过（工具实测）。** 以当前代码重建并启动 `org.tinytune.player.macmediaqa`（macOS 27.2.1，`codesign --verify --strict` 退出 0）。底栏播放后再暂停，仍是 `Distant Tide`，进度从约 0.339 s 到 0.599 s；顺序模式，待播为 `First Light` → `Glass Lake (Live)`。验收窗口保留在此状态。`Media Smoke` 四个样本 SHA-256 均匹配。 |
| Mac 系统 Now Playing、硬件媒体键 | **阻塞。** 桌面工具仍无法绑定 ControlCenter 和 SystemUIServer（两者均超时），未观察到系统面板，也未以进程内状态代替。未模拟媒体键。待用户在上述暂停起点按一次实体「下一首」，再核对只切到 `First Light`、仍暂停且只余 `Glass Lake (Live)`；系统面板、播放／暂停和重复分派在取得证据前不勾选。 |
| 权限异常与外设 | **阻塞。** 本轮 `diskutil list external physical` 无输出；未测试物理外接卷。iPhone 实际撤权和耳机断开沿用上节阻塞结论，本轮未重测。 |
| 双端发布项 | **未测。** 本轮未重新安装 iPhone QA，未测当前 iPhone 模式控件、完整格式矩阵、最低系统、发布签名／分发安装及 M4 完整验收。iPhone 物理锁屏仍为既有**用户手测通过**，不是本轮自动结果。 |

本轮未观察到可复现的产品失败。QA 包的本机签名校验不等于分发签名或双端可安装候选版。

### Mac 实体「下一首」首次手测

- **失败（用户手测，2026-11-20）。** 在 Mac 独立 QA 的 `Distant Tide` 暂停、顺序模式，且队列为 `First Light` → `Glass Lake (Live)` 时，用户报告按了一次实体「下一首」而未见切歌。预期停在 `First Light`，仍暂停且只余 `Glass Lake (Live)`。实际未达到该结果。
- **工具核对。** 回读同一 QA 进程的窗口和检查点：仍是 `Distant Tide`、暂停，待播两首顺序不变；暂停点由约 0.599 s 变为 0 s。因此不能表述为「所有状态没变」。时段内系统日志显示 ControlCenter 能查询 QA 的播放会话，QA 发布的 `NextTrack` 为启用，且音频引擎有换载记录；没有足够证据把这些记录归因于这一次实体按键，也未看到系统面板画面。命令是否送达、是否重复及根因仍待查。未使用模拟媒体键。
- **对照通过（工具实测）。** 仅在同一 QA 进程挂上 LLDB 自动继续断点，分别跟踪六个系统媒体命令入口与播放器切歌方法。点底栏「下一首」到 `First Light`，仍暂停；点底栏「上一首」回到 `Distant Tide`，待播恢复为 `First Light` → `Glass Lake (Live)`。两次动作各命中对应的播放器方法一次，调用栈来自底栏，未命中系统命令入口。该对照不替代实体键验收；已留好原暂停起点，等待带跟踪的下一次用户手测。本轮未改应用代码，未重新运行 `scripts/check.sh`。

## Mac 隔离媒体会话与格式预检

2026-11-20（Asia/Shanghai）。仍在 macOS 27.2.1 的独立 QA 范围内，没有操作正式版或个人曲库。

- **系统媒体状态发布通过（工具实测，系统服务日志）。** 退出仅持有合成曲库的 `org.tinytune.player.modeqa`，保留同一 `org.tinytune.player.macmediaqa` 及既有 LLDB 命令跟踪。用 QA 底栏播放并暂停 `Distant Tide`；`mediaremoted` 确认本地 QA 会话在 13:21:01–13:21:02 `Paused → Playing → Paused`，发布了该会话的 Active Now Playing 通知，ControlCenter 查询了支持命令。这是系统服务收到状态的证据，不等于面板上看到曲名、进度或系统按钮可用。
- **实体「下一首」复测失败（用户手测，工具回读）。** 只运行媒体 QA，`Distant Tide` 暂停于 0.332 s、顺序模式，待播 `First Light` → `Glass Lake (Live)`；用户确认短按一次实体 ⏭。回读 QA 界面和检查点：曲名、暂停点、两首待播均不变。LLDB 六个系统媒体命令入口及 `Player.next()`／`Player.previous()` 均无新命中；筛选此 QA 的系统日志亦未找到此次 `NextTrack` 分派。定位到「未观察到命令进入 App」，不能仅凭日志缺失断言是键盘、操作系统路由或注册问题。随后以 macOS「播放中」（Now Playing）面板的「下一首」作对照，结果见下。没有模拟实体键，也未改动系统键盘设置。
- **系统「播放中」面板显示（用户手测）与播放命令通过（工具实测）。** 用户确认系统卡片已显示。13:42:54 的 ControlCenter 日志记录向 `org.tinytune.player.macmediaqa` 发送命令，LLDB 恰命中一次 `playCommand` 回调，系统返回成功，`mediaremoted` 观察到暂停 → 播放，QA 检查点亦推进。该次队列自然播完，不计为系统面板手动切歌。随后用 QA 底栏恢复 `Distant Tide` 暂停和两首待播。
- **系统面板单次「下一首」通过（用户点击／工具实测）。** 13:54:58，用户确认点了一次系统「播放中」卡片的 ⏭；同一命令 ID 从 ControlCenter 经 `mediaremoted` 到 QA，系统日志列出一个 `NextTrack` handler，并返回 `Success`。LLDB 只命中一次 `nextTrackCommand` 回调和一次由该回调发起的 `Player.next()`。QA 界面和快照确认仅切到 `First Light`，保持暂停在 0:00，待播仅余 `Glass Lake (Live)`。说明面板命令可经现有 App 注册正常推进队列；不能据此认定实体键可用或键盘是根因。系统面板暂停按钮与面板动态进度仍未测。
- **Mac 文件解析预检通过（工具实测，非应用端到端）。** 使用 FFmpeg 8.1 `lavfi sine` 生成 44.1 kHz、19/21/23/25/27/29 s 的 MP3、M4A AAC、M4A ALAC、ADTS AAC、WAV PCM、FLAC 与刻意损坏的 MP3。`ffprobe` 核对容器、codec 与时长，样本目录外保留 `expected.json` 和 `files.sha256`。临时命令行入口链接 Mac QA 同构建的 `Library.o`、`Domain.o`，在实体 Mac 调用 `AudioScanner.inspect`：六个正常样本均接受（19.043/20.975/23.000/24.985/27.000/29.000 s），坏 MP3 拒绝；MP3 和两种 M4A 取到标题、歌手、专辑，其余三项在这批样本回退文件名。七个文件前后 SHA-256 一致。未在 App 内导入这批样本，出声、seek、切曲、沙盒目录授权与 iPhone 格式矩阵均未测，不据此承诺格式发布范围。

本轮未改应用代码，未重跑 `scripts/check.sh`；不改变 M0／M3 未放行结论。

## Mac 格式矩阵与本地来源重连

2026-11-20（Asia/Shanghai），实体 Apple Silicon Mac mini／macOS 27.2.1。另以独立标识 `org.tinytune.player.codecqa` 新构建 Debug，`xcodebuild` 与 `codesign --verify --strict` 均退出 0。只操作「Matrix Smoke」合成目录和该 QA 容器；未访问个人曲库或覆盖正式版。此前系统媒体命令跟踪已停止，本轮不重试实体媒体键。

**App 内导入、起播、seek、暂停及自然切歌通过（工具实测）。** 使用系统选取器从空库导入：6 新增、1 个损坏 MP3 跳过。逐首从头点播，确认播放位置先自然推进，然后拖动到底栏约一半处并暂停；两次读取的暂停位置稳定。CoreMedia 日志记录该 QA 启动音频队列；未采集实际扬声器输出，不将工具读数写成主观听感。

| 合成样本 | App 显示的元数据 | 起播已推进（秒）→ 拖动后位置（秒） | 同一顺序队列中自然结束后的结果 |
| --- | --- | --- | --- |
| MP3 | 标题、歌手、专辑标签 | 0.265 → 9.750 | 进入 M4A AAC |
| M4A AAC | 标题、歌手、专辑标签 | 0.250 → 10.270 | 进入 M4A ALAC |
| M4A ALAC | 标题、歌手、专辑标签 | 0.266 → 12.250 | 进入 ADTS AAC |
| ADTS AAC | 回退文件名 | 0.279 → 13.255 | 进入 FLAC |
| FLAC | 回退文件名 | 0.287 → 15.254 | 进入 WAV |
| WAV PCM | 回退文件名 | 0.283 → 14.256 | 27.000 s 停止，下一首禁用 |

自然切歌用例只拖到曲末前、不点下一首；观察五次跨格式切换均从 0 开始并保持播放，最终队列耗尽停止。**未测**受保护样本、其他 codec 参数、最低 macOS 版本、iPhone 端矩阵及扬声器听感；没有据此承诺双端支持范围。

**Mac 本机目录重命名后的重新授权／冷启动续播通过（工具实测）。** MP3 暂停约 9.903 s，队列还有五首。退出 QA，把 `Matrix Smoke` 重命名为 `Matrix Smoke Moved` 后冷启。系统没有自动恢复授权，QA 明确显示一个来源不可用，保留六首索引和原快照（`cmp` 逐字节一致）。从原来源条目的「重新授权」选新目录，预览为 0 新增、0 更新、6 未变化、1 跳过；确认「重新连接」后恢复可用，手动播放从原位置继续至 10.250 s。暂停后再次冷启，不重选目录，从约 10.312 s 续播到 10.764 s，再暂停。随后恢复样本目录原名并重新连接；最终原路径可用、六首索引保留。七个样本原始 SHA-256 均匹配。此项不是实际系统撤权或物理卷掉线恢复。

**阻塞／未测。** `devicectl list devices` 的两个实体 iPhone 条目均为 `unavailable`，没有安装或操作 iPhone QA，未测实际撤权、耳机断开和现版本 iPhone 格式矩阵。`diskutil list external physical` 无输出，未测物理卷掉线。Mac 实体 ⏭ 延续此前两次用户手测失败；系统面板暂停按钮和动态进度仍未测，没有用模拟媒体键或历史结果替代。本轮未改应用代码，未重跑 `scripts/check.sh`，M0／M3 未整体放行。

## iPhone 格式矩阵与来源恢复

2026-11-20（Asia/Shanghai），实体 iPhone 17 Pro Max／iOS 27.2.1。以当前工作树构建、在本地使用已有开发签名重新签署并安装独立 `org.tinytune.player.ioscodecqa`；没有覆盖正式版或旧播放 QA。通过 Device Hub 操作实体设备、通过 `devicectl` 回读独立容器；只使用合成音频。

- **iPhone 格式矩阵通过（工具实测，限此批样本）。** 系统选取器导入 `Matrix Smoke`：6 首新增、1 个损坏 MP3 跳过。MP3、M4A AAC、M4A ALAC 读取标题／歌手／专辑，ADTS AAC、FLAC、WAV 回退文件名。顺序队列 MP3 → M4A AAC → M4A ALAC → ADTS AAC → FLAC → WAV；各首均有播放时钟前进，五次自然换曲后末曲在 27 s、待播 0、`ended=true`，界面显示停止。ALAC 暂停后拖动进度，快照更新且没有起播；其余五种格式的独立 seek、实际扬声器听感与受保护样本未测。六首音频和坏样本的设备回读 SHA-256 均匹配。
- **iPhone 单按钮模式通过（工具实测）。** 真机全屏播放器只显示一个模式按钮，暂停在 ALAC 约 13.226 s 时逐次切到单曲循环、随机、顺序；快照分别为 `one`、`off + isShuffled=true`、`off + isShuffled=false`，切换不换曲、不起播。四个中文 Tab 与蓝紫选中状态仍在。
- **本机独立来源容器消失后的保护通过（工具实测）。** 另建只含合成样本的 `org.tinytune.spike.recoveryfixtures`，授权其 `Provider Removal QA` 子目录，播放 `Recovery Tone` 后暂停于 34.828 s。只卸载这个专用来源 App，再冷启播放器 QA：该来源标记不可用、曲目显示无法播放，另一个矩阵来源正常，全部七首索引保留，播放检查点逐字节未变。没有卸载正式版、清理索引或操作个人来源；这不是系统撤权或第三方 File Provider 掉线。
- **修复前，重建目录的显式重连失败（工具实测）。** 重装同一个合成来源 App，把原合成样本按相同相对路径 `recovery-tone.mp3` 放回同名子目录（SHA-256 一致），点失效条目的重新授权并选该目录。旧容器已消失，新目录身份不同，旧实现只接受相同目录身份，显示「这不是原文件夹。没有替换任何来源」。原索引、来源与暂停快照保留。这不满足 PRD R-03 的显式迁移回退要求。
- **修复后，显式重连与冷启续播通过（工具实测）。** 同一 QA 标识覆盖升级，保留原 QA 数据。在原失效条目重新授权，预览显示新目录名、匹配 1／未匹配 0、样例 `recovery-tone.mp3`；第一次取消后仍显示来源不可用、快照不变。第二次点击「重新连接」后恰好两个来源、仍是七首，告警消失，不自动播放，原曲 ID 与 34.828 s 检查点逐字节相同；手动续播时钟前进。再次于 18.439 s 暂停并冷启，保持同一曲目与暂停点，无需重选目录；手动播放后检查点到 33.750 s，最后留在暂停状态。匹配按完整、精确拼写的相对路径；只允许由显式重连进入，普通导入不自动迁移，零匹配或与其他已索引来源冲突不替换旧书签。当前没有改变原始音频；恢复样本的设备回读 SHA-256 匹配。
- **本轮代码检查通过（自动验证）。** 修改前两个新增曲库测试以 `wrongSource` 失败；修改后定向 7 个曲库测试通过，覆盖重连保留来源／曲目 ID 及未匹配索引、零路径匹配拒绝、不得接管另一已索引来源。仓库根 `scripts/check.sh` 退出 0：43 个 XCTest（播放 22、领域 12、曲库 7、设计系统 2），macOS、通用 iOS 设备（无签名）、iOS 模拟器三目标构建成功。Mac 音量滑杆仍有既有主 actor 隔离警告，另有 App Intents 元数据跳过警告。iPhone 独立 QA 签名校验、安装与真机续播另行通过；不是分发验收。
- **阻塞／未测。** 真实系统撤权、耳机断开和线控仍阻塞；真机 `devicectl device info audio` 返回不支持 Audio Output Device Selection，未确认可操作耳机路由。真实来电和第三方 File Provider 掉线未测；既有物理锁屏继续记为用户手测通过，未重做。

### Mac 实体键本轮排查

- **失败（既有两次用户手测，不是本轮复测）。** 保留[首次记录](#mac-实体下一首首次手测)和[单一媒体 QA 复测](#mac-隔离媒体会话与格式预检)。重新按隔离复测时间窗查询 `rcd`／`mediaremoted`／`mediaremoteagent`／`ControlCenter` 的硬件、HID 和 NextTrack 相关归档日志，没有匹配，不能区分键未产生消费控制事件、系统未路由、或日志未收录。正向对照仍可从归档回读：同一 QA 被系统识别为 Active Now Playing，收到播放→暂停状态；随后面板 `NextTrack` 的发送和成功返回都可追溯，原 LLDB 记录仅命中一个回调和一次 `Player.next()`。边界仍是「没有观察到实体键命令进入 App」，不是「已证明键盘故障」。
- **当前环境检查（工具实测）。** 系统识别蓝牙 Apple 键盘，`hidutil` 未发现该设备的自定义 `UserKeyMapping`，全局 `fnState` 无显式读值；不据此推断实际 F9／Fn 模式。`com.apple.rcd` 在本会话已注册、未运行，单点状态不能作为故障根因。当前 Mac SDK 把 `MPNowPlayingSession` 标为 macOS 不可用。未模拟按键、未改系统键设置、未加入全局按键拦截或改写已通过面板对照的媒体 handler。
- **仍未修复、未复验。** 下一步需在合成 QA 播放中做受控物理 A/B（同一键常规／Fn 状态，必要时换可用键盘），同时采集实际消费控制输入和系统分派；拿到首个丢失边界再做最小修复。本轮 ControlCenter 界面绑定仍超时，未测面板暂停及动态进度；`diskutil list external physical` 无输出，外接卷掉线阻塞。M0、M3 及双端发布均未放行。

## iPhone 进度与单曲循环复验

2026-11-20（Asia/Shanghai），实体 iPhone 17 Pro Max／iOS 27.2.1。在已安装的独立 `org.tinytune.player.ioscodecqa` 上，使用 Device Hub 操作原合成曲目，通过 `devicectl` 回读 QA 容器的 `PlaybackSnapshot.json`。不重复导入、自然切歌矩阵或物理锁屏验收。进度保留三位小数（秒），曲目与完整队列均通过 JSON 对比核对。

| 合成曲目 | 状态与证据（工具实测） |
| --- | --- |
| MP3 | **暂停拖动到端点通过。** 11.084 → 0.000 → 19.042 s，暂停、不换曲，完整队列不变。手动播放与自然重播见下方。 |
| M4A AAC | **暂停拖回起点、手动续播通过。** 12.482 → 0.000 s，仍暂停；手动播放再暂停为 3.901 s，同曲同队列。 |
| ADTS AAC | **暂停拖动到两端、手动续播通过。** 3.676 → 24.983 → 0.000 s，仍暂停；手动播放再暂停为 3.649 s，同曲同队列。 |
| FLAC | **暂停拖回起点通过。** 3.670 → 0.000 s，同曲同队列、不自动播放。手动起播后镜像失去坐标操作能力，下一次回读已到后续曲，未拿到 FLAC 的同曲续播检查点。 |
| WAV | **独立 seek 阻塞，本轮未测。** 镜像可截图，但重新绑定后坐标点击仍报 `noWindowsAvailable`；WAV 自然播放时钟前进可回读，不能代替 seek。 |

- **单曲循环跨曲末通过（工具实测）。** MP3 处于暂停，点击一次模式按钮，确认 `repeatMode=one` 后只手动点一次播放。观察到 5.000 → 10.250 → 15.250 → 0.000 → 5.000 → 10.250 s，重播后镜像仍显示 `01 MP3` 正在播放。55 次快照内当前曲、六首待播顺序、历史与完整队列都未变化，始终 `ended=false`，未点「下一首」。之后暂停并还原顺序模式。
- **未测／阻塞边界。** 上表新增 seek 仅确认端点；镜像中指向曲中位置的拖动也出现落在端点的情况，本轮未能测定精确的曲中 seek，未判定为播放器缺陷。ALAC 保留上轮 seek 结果；扬声器听感、受保护样本、真实来电、第三方 File Provider 掉线未测。`devicectl device info audio` 仍返回不支持 `Audio Output Device Selection`，未能确认可操作耳机路由；耳机断开／线控和仅影响 QA 的真实系统撤权仍阻塞。镜像中断后只冷启 QA 播放器使它停止，最终为顺序模式、已暂停。

### Mac 实体键只读诊断

- **新证据（工具实测，仅设备描述符与权限预检）。** 当前工具宿主调用 `IOHIDCheckAccess`（`ListenEvent`）与 `CGPreflightListenEventAccess` 均返回已授权；没有请求或更改权限。仅对前次排查的 Apple 蓝牙键盘枚举 HID 元素描述符：四个匹配集合里，`ScanNextTrack`（`0xB5`）、`ScanPreviousTrack`（`0xB6`）、`PlayOrPause`（`0xCD`）各有一个描述符。未安装事件监听器、未采集键值或注入按键。这只能确定可在后续限定媒体 usage 做只读对照，不能证明实体按键发出了事件、系统分派成功或应用需要修复。
- **两次实体 ⏭ 用户手测仍为失败；本轮未复测、未修复。** 后续应在单一 QA 正在播放时，按实时时间窗对比目标键常规／Fn 组合是否产生 `0xB5`，再对照系统命令与 App 回调。一旦观察到第一个丢失环节，再决定是否需要改代码。不同 QA 正在运行，本轮未打断它做隔离；ControlCenter 的界面绑定再次超时，系统面板暂停、动态进度仍未测。`diskutil list external physical` 无输出，物理外接卷掉线恢复阻塞。

本轮未修改应用代码、未重跑 `scripts/check.sh`；未提交、未推送。供本地复核的快照、`repeat-live.log`、读回校验和 Mac 只读诊断输出位于 `.build-output/device-followup-dir.txt` 指向的忽略目录。**M0／M3 均未放行。**

## 「留白落梅」图标与松笺主题复验

2026-11-20（Asia/Shanghai）：将图标定稿为「弦风 · 留白落梅」，iOS 与 macOS 采用同一 SVG 的平台规格导出。应用内松笺主题替代此前的靛蓝主题；历史验证仍按当时的版本记录。

- `scripts/check.sh` 退出 0：41 个 XCTest（播放 22、领域 12、曲库 5、设计系统 2）通过；macOS、iOS 通用设备（无签名）、iOS 模拟器均构建成功。新增测试核对松笺强调色在两种外观中的解析值，以及语义实色文本组合对比度。Mac 音量滑杆仍有既有的主 actor 隔离警告。
- 核对全部 11 个 `AppIcon` 槽位对应定稿导出；从 macOS 构建产物解出 `AppIcon.icns`，目视确认梅花位置和配色，`codesign --verify --strict` 通过。
- 在 iPhone 模拟器安装并运行本轮构建，对照浅色和深色空音乐库截图，确认主背景、插画、添加按钮与底栏选中项切换到松笺配色。未做实体 iPhone 外观、VoiceOver、高对比度与完整交互复验；未改变既有发布验收结论。

## 01「琴身嵌梅」图标复验

2026-11-20（Asia/Shanghai）：按确认改用[位置对照图](brand/tinytune-brand-plum-blossom-preview.png)中间的 01「琴身嵌梅」，iOS 与 macOS 资源均从[嵌梅源稿](brand/tinytune-app-icon-xianfeng-plum-inlay.svg)重新导出。淡金梅花嵌于琵琶琴身右侧，琴头与笛口之间保留留白。松笺主题、App 显示名及 Bundle ID 不变。

- `scripts/check.sh` 退出 0：43 个 XCTest（播放 22、曲库 7、领域 12、设计系统 2）通过；macOS、iOS 通用设备（无签名）、iOS 模拟器三项构建通过。
- 全部 11 个 `AppIcon` 槽位（8 张 PNG）与 01 的导出尺寸、色彩模式和像素一致。抽查三份构建产物中的图标（macOS `.icns`、iOS 设备与模拟器的 iPhone 图标 PNG），目视确认均为 01；macOS `codesign --verify --strict` 通过。未在模拟器或真机安装复验，也未复验应用内主题或交互。

## 本地 Release 试用包复验

2026-11-20：按新的试用范围将硬件键、外设等受限项单列保留，不阻塞本地试用。Mac Release 包解压后通过 30 首导入及冷启续播；iPhone Release 开发签名包在已登记实体设备安装启动并完成 30 首的扫描预览，系统无线数据提示未代选，未完成确认入库。`scripts/check.sh` 本轮 48 个 XCTest 及三项构建通过。安装方式、逐项证据、已知范围及延后项见[本地试用交接](local-preview.md)，正式发布未放行。

## Mac 真实曲库抽验

2026-11-21（Asia/Shanghai），Apple Silicon Mac／macOS 27.2.1（26B131）。从当前工作树构建独立 Release QA `org.tinytune.player.reallibraryqa`，构建和 `codesign --verify --strict` 均通过。仅使用用户本轮授权的一个本机文件夹，从 QA 空库经 App 系统选择器读入；未操作正式版、未将音频复制到 iPhone。以下均为工具实测，不是用户手测；不记录真实目录路径、文件名或曲目信息。

| 场景 | 结果与证据 |
| --- | --- |
| 递归扫描与入库 | **通过。** 目录树内 59 个音频候选全部入库（56 MP3、3 FLAC），另有 3 个隐藏非音频文件未参与扫描，不是音频读取失败。预览显示「59 首可导入」，确认后侧栏显示 59 首；只读查询 QA 索引，验证路径集合与实际候选完全一致。点击系统选择器确认后约 1.5 s 首次回读即见预览结果；含 UI 工具开销，单次观察不作为性能基准。 |
| 查找 | **通过。** 分别用已知歌名、专辑、歌手搜索，均返回预期歌曲；另用无匹配查询验证空结果，曲库仍为 59 首。 |
| 播放与暂停 | **通过（各抽一首）。** 双击歌手搜索结果播放 MP3，进度从约 0.250 s 到暂停时 7.389 s；当时为顺序模式、5 首一组、余 4 首。另从歌曲列表播放 FLAC，进度由 0 到约 9.153 s 后暂停；从 QA 检查点和索引核对了实际格式。验证依据为运行时播放状态和进度，未监听音质或逐首播完。 |
| 冷启动续播 | **通过（MP3 样本）。** 正常退出并确认进程结束，重新启动后仍为 59 首；同一首歌停在 7.389 s，不自动播放。QA 快照前后曲目、模式、完整队列及 4 首待播顺序一致；没有重选目录，点播放后仍是原曲，进度继续至约 7.813 s 后暂停。 |
| 原文件保护 | **通过（只读沙盒及元数据核对）。** 验证 QA 的用户选择文件只读 entitlement；前后比对 62 个原始文件的相对路径、设备号、inode、权限、大小及修改／状态变更时间，均未变化；未做内容哈希比较。 |

本轮没有在所测路径发现失败；没有复测 Mac 实体媒体键（保留之前两次用户手测失败）或系统 Now Playing，也没有重测既有的耳机、外接卷阻塞项。未测同一曲库在 iPhone 上的表现或千首级性能。QA 保留已导入索引，最终为暂停。仅更新验证文档和路线图，未改应用代码、未运行 `scripts/check.sh`、未提交或推送；不改变 M0／M3 或正式发布的放行状态。

### Mac 真实曲库默认封面复验

2026-11-21（Asia/Shanghai）。**修正前失败（用户截图、工具复现）：**在上一份独立 Release QA 打开「歌曲」，无内嵌封面的行显示空白，有封面的行正常。该构建用全局 `PRODUCT_BUNDLE_IDENTIFIER` 覆盖，App 与 `TinytuneKit_DesignSystem.bundle` 的标识相同；SwiftUI 日志在旧包路径下报告找不到 `FoldedRecord`。

**通过（Mac 工具实测）：**保持原 QA App 标识，用 `-configuration Debug TINYTUNE_MACOS_BUNDLE_IDENTIFIER=org.tinytune.player.reallibraryqa` 重建，验证 App 与 DesignSystem 的资源包标识不同，构建和 `codesign --verify --strict` 通过。关闭旧包并启动新包后，原 59 首无需重新导入；歌曲列表与底栏原本空白的位置显示现有「折页唱片」默认封面，同屏的原有封面正常。只修正 QA 构建方式，不改封面资源、应用代码或原始音乐；正式版与 iPhone 未操作，本轮未运行 `scripts/check.sh`。

## Mac 合成数据性能基线

2026-11-21（Asia/Shanghai），Apple M4／24 GB／macOS 27.2.1（26B131），Xcode 27.0（27A266a）。**Mac 工具实测，仅限核心逻辑。** 用 Swift 6 的 `-O` 独立探针链接当前工作树的 `Library`／`Domain`，复用 App 的 `LibraryIndex`，按 `SearchCatalog` 相同的筛选实现做对照。使用生成的 WAV、合成元数据和独立临时 SwiftData 存储，不读写个人曲库或 QA App 容器。

| 项目 | 本轮结果 | 边界 |
| --- | --- | --- |
| 1,000 首目录扫描 | 全部 1,000 首可用、0 跳过；独立进程连测三次 0.90／0.86／0.84 s，中位 0.86 s。 | 实际 `AudioScanner.scan`，本地 0.35 s WAV、100 张专辑、无封面；不含打开系统选择器、创建书签、摘要渲染或确认保存。重复用同一批文件，未清理系统文件缓存，不是三个冷扫描。 |
| 5,000 首存储打开与索引 | 同一合成 SQLite 存储由三个新进程打开，打开→读取／排序→分组共约 147–158 ms；其中读取与排序约 130–139 ms。 | 不含 App 进程启动、播放检查点恢复、首屏绘制；不是 UI 冷启动数据。 |
| 5,000 首搜索筛选 | 原逻辑两轮 P95 32.13／32.20 ms；一次性预处理搜索键的试验为 7.18／7.15 ms，额外建键约 21 ms。 | 每轮 30 次，包含大小写、全角、空白、中文、无匹配等。逐次核对歌曲、歌手、专辑的结果 ID 及顺序一致；不含现有 150 ms 去抖、结果绘制或首次建键。 |
| 20,000 首搜索筛选（额外压力样本） | 原逻辑 P95 134.92 ms；试验 30.22 ms，额外建键约 86 ms。 | 一轮 30 次；结果 ID 与原顺序一致。未测额外内存或端到端延迟；试验没有接入 App。 |

**优化优先级：**先处理搜索中的重复规范化：当前 `SearchCatalog` 在视图中筛选三组结果，`Track.matches` 对同一查询和各元数据字段重复做大小写、宽度和空白折叠。可在曲库变化时准备搜索键、每次只规范化一次查询，保留各字段独立匹配与原顺序；落地前需验证导入／重扫／移除的结果刷新，以及首次搜索的建键成本。封面重复解码值得后续采样，但本轮没有滚动帧时间或内存证据，不先改缓存。扫描与冷启动暂不重构。

探针及原始输出保存在 `.build-output/performance-review-dir.txt` 指向的忽略目录。未修改应用代码，未执行 `scripts/check.sh`；未测 App 端到端搜索、首次出声、带封面的真实扫描或 iPhone 性能。本记录不视为 AC-06、M0／M3 或正式发布验收通过。

### 搜索缓存落地复验

2026-11-21（Asia/Shanghai）。曲库快照在后台构建歌曲、歌手、专辑的搜索键，和浏览索引一起发布。查询保留 150 ms 去抖，后台筛选；仅采用当前快照的结果，同一查询／快照不因界面重绘而重复筛选。不改界面、匹配规则、排序、曲目 ID 或数据库格式。

- **通过（自动回归）。** 新增 2 个测试：大小写／全角／空白、中文、重音符号、字段不串接、空查询和结果顺序；临时 SwiftData 曲库从导入、重扫更新元数据、移除单曲到移除来源，确认索引换代，旧词不再匹配且重扫保持曲目 ID。`scripts/check.sh` 本轮退出 0：54 个 XCTest、0 失败，macOS、无签名 iOS 设备目标、iOS 模拟器均构建成功。既有 Mac 音量滑杆主 actor 警告仍在。
- **通过（Mac 工具实测）。** 独立签名 QA `org.tinytune.player.searchqa` 通过系统选择器导入 1,000 首合成 WAV。按歌手、专辑、全角大小写与多空白混合歌名搜索，并验证无匹配提示。保留同一歌名查询，添加第二个合成来源；曲库显示 1,001 首，已有结果未丢失，歌曲结果自动从 1 条更新为 2 条。未操作正式版或个人曲库。
- **通过（核心逻辑性能对照）。** 同一 M4 Mac 上用优化构建链接实际 `LibraryIndex.search`，使用上一轮的合成元数据。5,000 首每轮 30 次、两轮 P95 从 34.36／34.83 ms 降至 7.62／7.91 ms；建索引后首次查询为 6.85／7.46 ms，创建浏览及搜索索引共 35–40 ms。20,000 首一轮 30 次，P95 从 142.37 ms 降至 32.52 ms，建索引后首次查询约 27 ms。所有对照查询的歌曲、歌手及专辑 ID 和顺序一致。耗时只含规范化与筛选，不含去抖、绘制和快照读取；未测额外内存或 iPhone 实机性能。

本轮日志位于 `.build-output/search-optimization-dir.txt` 指向的忽略目录。未提交或推送；不改变 AC-06、M0／M3 或正式发布的放行状态。

## iPhone 时码歌词验收

> 2026-11-24 行为变更：以下为历史待验收步骤；其中第 4、5 步对无歌词页按钮的要求已被替代。当前 iOS 无歌词只显示状态，不展示重新读取或导入按钮；有词或读取失败时的恢复流程另验。完整最新验证见文末追加修复记录。

2026-11-21（Asia/Shanghai）。本轮准备了 `.build-output/Tinytune-Lyrics-Smoke.zip`（本地忽略目录），内含 3 首 19 秒合成音频和本轮工作台实际导出的 2 份 `.lrc`。已核对 ZIP 完整性、UTF-8 文件名、时码、纯文本和同名配对。`xcrun simctl list runtimes` 未列出运行时；`xcrun devicectl list devices --timeout 5` 列出的手机均不可用。**以下为待执行的 iPhone 运行验收，不是通过记录。**

1. 准备安装了本次歌词代码的独立签名测试版。把 ZIP 复制到 iPhone，在「文件」中解压；在测试版选择解压得到的「Tinytune 歌词验收」**文件夹**，确认新增 3 首。无需导入个人曲库，也不要安装到正式版的容器。
2. 播放「01 窗边的光」，打开「正在播放」，在唱片页的歌词区点展开。应随进度切换高亮；在歌词区域上下拖动后，「回到当前句」应出现，点击后能恢复跟随。
3. 暂停后点「不用赶往哪里」（10 秒），进度应跳到 `0:10` 并保持暂停；恢复播放应在约 12.4 秒高亮「把这一刻听完」。拖动播放进度至前 1 秒内，首句开始前不应高亮。
4. 切换到「02 第二页」，应显示不带跳转的纯文本；再切到「03 无词」，应提示「这首歌没有歌词」，播放仍可继续。切换后不应残留上一首的歌词。在「文件」中补放 `03 无词.lrc`，回到同一首歌的「正在播放」页并点「重新读取歌词」，确认无需切歌即可看到歌词。退出并重开测试版，不重新选择文件夹，再打开有词曲目的歌词以确认来源授权保留。

5. 单曲导入：让播放停在「03 无词」，在歌词区点「导入歌词…」，从「文件」选择另一目录的 UTF-8 `.lrc`。先取消一次确认，验证未替换；再次选择，核对预览的音频路径和歌词后确认，验证不切歌即可显示、播放进度与队列不变。重启验证保存仍在；点歌词区「… → 移除导入的歌词」，应恢复步骤 4 补放的同名歌词。

如本地验收包已清理，可从工作台「试用合成样例 → 匹配已选曲目 → 导出 ZIP」重新获取两份 `.lrc`。在 `tools/LyricsWorkbench` 安装依赖后运行下列命令重制 WAV；将导出的 `窗边的光.lrc`、`第二页.lrc` 分别加上 `01 `、`02 ` 前缀后放入生成目录，不给第三首放歌词文件。

```sh
node --import tsx --input-type=module -e '
  import { mkdirSync, writeFileSync } from "node:fs";
  import { demoAudio } from "./src/demo.ts";
  const dir = "../../.build-output/Tinytune 歌词验收";
  const wav = Buffer.from(await demoAudio().arrayBuffer());
  mkdirSync(dir, { recursive: true });
  for (const name of ["01 窗边的光", "02 第二页", "03 无词"]) {
    writeFileSync(`${dir}/${name}.wav`, wav);
  }
'
```


## 2026-11-24 iOS 播放、曲库与通屏背景追加修复

本轮按追加需求修改 SwiftUI，未安装或覆盖手机中的个人曲库版，未创建提交或推送；保留工作区既有的其他修改。当前实现取代先前设计稿的顶部渐隐、左对齐标题和行内重扫，不改 macOS 对应交互。

### 实现与只读目录核对

- 正在播放：iPhone 唱盘和曲名居中，独立手机唱针几何；主控仅上一首／播放暂停／下一首，播放模式与队列以不同图标和文字另起一排。原来的近似列表图标分别是播放顺序和队列，并非两个上一首／下一首。无歌词仅显示状态；读取失败仍可恢复。
- 浏览与搜索：iOS 只对同来源、同目录、同文件名基干／歌手且时长差不超过 0.2 秒的明确音质后缀副本作展示折叠，且副本元数据必须未被手改。不同来源、不同目录、不同录音、无标记格式副本保留；底层记录、旧队列、导入歌词与文件 ID 不改，macOS 默认不折叠。
- 用户指定目录只读枚举出 59 个音频文件（56 MP3、3 FLAC）。其中同一录音有普通、高品、Hi-Res、无损四个文件，均约 240.879 秒；App 依据文件名解析歌手后归为同组，折叠三个有音质标记的副本，**实际投影为 56 首**。最初人工预期为 57，真实目录回归暴露漏数一个带歌手别名标签的无损版本；核对实际文件和解析规则后修正只读样本预期，并断言精确折叠路径，而非放宽生产逻辑。
- 真实目录测试只读取调用者提供的 ffprobe JSON，不操作个人数据库。元数据报告与相对路径清单保存在本地忽略目录 `.build-output/ios-followup-audio-*.json`，未加入仓库。核对前后 59 个文件的 SHA-256、大小及修改时间，均不变。两份 FLAC 的额外 ffmpeg 抽查出现无效帧提示；未修改文件，此项不算音频完整性或真实播放验收。
- 曲库歌手／专辑／歌曲切换只重建对应滚动容器，保留排序与详情导航；iOS 外层使用非惰性容器，子列表仍按原有结构。
- 音乐库／搜索／来源共用完整日夜山水，等比填充裁切；正在播放使用低对比度夜景。音乐库与来源标题居中。来源卡片移除文件夹图标、已连接状态、行内重扫和页尾原文件／上传说明，保留更多菜单与授权异常提示。

### 本轮执行结果

每次编译前均检查没有活动构建进程，并定向清理对应 `.build-output` 目标的上一轮产物与编译缓存；不清其他任务或用户数据，不使用 `git clean -fdx`。以下为本次代码的结果，非历史验证复用：

```sh
TINYTUNE_AUDIO_METADATA_REPORT="$PWD/.build-output/ios-followup-audio-metadata.json"   swift test --package-path packages/TinytuneKit --scratch-path .build-output/SwiftPackage
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_ios_landscape_design.py'
xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator CODE_SIGNING_ALLOWED=NO build
xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-iOS -destination 'generic/platform=iOS' -derivedDataPath .build-output/iPhoneOS CODE_SIGNING_ALLOWED=NO build
xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-macOS -destination 'platform=macOS,arch=arm64' -derivedDataPath .build-output/macOS build
git diff --check
```

- **通过：98 个 XCTest，0 失败、0 跳过**（Domain 28、Library 37、DesignSystem 19、Playback 14）；本轮包含启用真实目录报告的精确路径与 56 首投影断言。平时未提供报告时该只读 QA 用例明确跳过，不依赖开发者音频目录。
- **通过：11 项 Python 结构／资源检查**；音质后缀、视图返回值、整图等比布局和来源图标的回归问题均先观察失败再修正。结构检查不是原生 UI 手势验收。
- **通过：iOS Simulator、无签名 iPhoneOS、macOS 三目标清洁构建**。macOS 仍有既有音量滑杆 `doubleValue` actor 隔离警告；三目标均有未依赖 AppIntents 的 metadata extraction skipped 提示，本轮未将这些提示当作无警告通过。
- **通过：资源打包复核**。`assetutil --info` 确认实际 Simulator 构建包包含 `LibraryLandscape-Page` 浅／深两张 1170 × 2532、3× 资源；透明度及 SVG 画幅由结构检查验证。已审阅的是插画合成预览，不冒充原生 App 截图。
- **通过：`git diff --check`**。日志保存为 `.build-output/ios-followup-{tests,structure,simulator,device,macos}.log`；本轮复用固定输出目录，结束时占用约 SwiftPackage 223M、iOSSimulator 438M、iPhoneOS 228M、macOS 282M，没有新建每轮验证目录。

### 未执行的原生运行验收

`xcrun simctl list runtimes` 本轮仍为空；最后一次 `devicectl` 列出一台 paired / available iPhone 和一台 unavailable iPhone。为避免覆盖个人 App 与曲库，本轮**没有安装、启动或操作手机 App**，也没有模拟器运行。以下仍待独立签名 QA 环境验收，不能由测试和编译代替：

- 有／无歌词和读取失败切换、唱针落点与唱盘视觉居中、实际播放和队列。
- 长歌手／专辑／歌曲列表滚到底后连续切换；详情返回与搜索输入切换。
- 刘海及底部安全区的全页插画、浅深色、横屏、VoiceOver、Dynamic Type 与减少动态效果。
- 来源更多菜单、异常重连、弹窗手势与内容高度。


## 2026-11-24 来源授权提示进一步精简

- 按后续要求，iOS 来源卡片移除「需要重新授权」状态提示，不显示行内重新连接；重新连接／重新选择文件夹只保留在更多菜单。macOS 原有警告和操作不变。
- 原生 SwiftUI 和设计预览中「周末收藏」卡片同步修改，不更改来源授权、扫描或重连业务。
- 本次先新增回归并观察到失败，再移除提示；`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_ios_landscape_design.py'`：12 项通过。断言覆盖原生／预览卡片不显示提示与行内重连，两个更多菜单均保留重新选择文件夹。
- 从预览 HTML 提取脚本后执行 `node --check .build-output/ios-source-menu-preview.js`，通过；`git diff --check` 通过。
- 确认无活动构建后定向清理 `.build-output/iOSSimulator` 上轮产物与缓存，再运行 `xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator CODE_SIGNING_ALLOWED=NO build`：通过。固定目录约 438M；日志为 `.build-output/ios-source-menu-{structure,simulator}.log`。
- 本次未重跑 Swift 包测试、iPhoneOS 或 macOS 构建，未安装运行手机、未做浏览器视觉验收，未提交或推送；先前 98 项包测试与三目标构建不冒充本次结果。


## 2026-11-24 根页面标题与搜索对齐

- 音乐库与来源改为与搜索相同的原生 `.navigationTitle` 和 `.navigationBarTitleDisplayMode(.inline)`，去掉内容区的大标题及隐藏导航栏设置，不用固定坐标模拟位置。数量摘要保留为居中的内容区副标题，新增在导航栏右侧，来源关于在左侧；继续隐藏装饰性工具栏底板并保留 44 pt 热区。
- 本次运行 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_ios_landscape_design.py'`：12 项通过，检查三页均使用 inline 导航标题、透明导航背景及完整山水。
- 确认无活动构建并定向清理 `.build-output/iOSSimulator` 后，执行 `xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator CODE_SIGNING_ALLOWED=NO build`：通过。日志为 `.build-output/ios-inline-titles-{structure,simulator}.log`。
- `git diff --check` 通过。未安装或启动手机 App、未做原生截图／手势验收；本次未重跑 Swift 包测试、iPhoneOS 或 macOS 构建，不复用历史结果冒充本次通过。未提交或推送。


## 2026-11-24 移除 iOS 来源关于入口和底部弹窗

- 删除来源左上角关于图标、`showsAbout` 状态、对应 sheet 和未再使用的 iOS `AboutTinytuneView`。音乐库和来源的新增文件夹、来源更多菜单、播放器及队列弹窗保留，macOS 设置不改。交互预览同步移除入口及关于跳转；历史关于图板仅作旧稿。
- 先运行新增回归观察失败，再修改；`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_ios_landscape_design.py'`：14 项通过。覆盖关于按钮／状态／视图移除、原有新增入口和播放器／队列弹窗保留。
- `node --check .build-output/ios-remove-about-preview.js` 与 `git diff --check` 通过。
- 初次清理检测到活动构建即停止，未删除其目录；确认该构建结束后，定向清理 `.build-output/iOSSimulator` 的旧产物与编译缓存，再运行 `xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator CODE_SIGNING_ALLOWED=NO build`：通过。日志为 `.build-output/ios-remove-about-{structure,simulator}.log`，继续使用固定产物目录。
- 本次未运行 iPhoneOS／macOS 构建、Swift 包测试或手机／浏览器 UI 验收，未安装手机 App；未提交或推送。不将历史构建或测试结果当作本次结果。


## 2026-11-24 iOS 播放模式与队列改为同排纯图标

- 本轮按追加要求取代此前的带文案第二排，iOS 正在播放页依次显示播放模式／上一曲／播放暂停／下一曲／队列。顺序播放使用 `arrow.right`，队列使用 `music.note.list`，外侧四个图标统一 22 pt；按钮仍保留至少 44×44 pt 点击区、VoiceOver 标签及播放模式值。队列回调和播放模式切换逻辑不变，macOS 与迷你播放器维持原样。
- 新增结构回归先观察失败，再落实修改；本轮 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_ios_landscape_design.py'`：15 项通过，日志 `.build-output/ios-transport-icons-structure.log`。
- `python3 /tmp/tinytune-followup-clean.py iOSSimulator` 确认无活动构建并定向清理旧产物和编译缓存后，运行 `xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator CODE_SIGNING_ALLOWED=NO build`：通过，退出码 0；日志 `.build-output/ios-transport-icons-simulator.log`。
- `git diff --check` 通过。仅完成结构检查和模拟器目标编译，未启动模拟器或进行原生 UI／真机验收，未安装手机 App。本轮未执行 Swift 包测试、iPhoneOS 或 macOS 构建；未提交、未推送，不将先前结果计入本轮。


## 2026-11-24 双端大封面、五行歌词与底部固定播放区

- 根据手机截图调整原生 SwiftUI：iOS 封面半径 71→92，macOS 79→99，均约占唱片直径 68%；唱盘与唱针大小不变，并通过几何回归确认唱针仍在封面外、唱片内。
- 正在播放页歌词直接展示最多五行居中上下文，当前句高亮，拖动预览与减少动态效果保留。补足曲首／曲尾窗口；间奏仅展示未来歌词，末尾空白不残留已唱行。移除 inline 歌词的展开、收起和导入菜单图标，独立歌词面板的管理能力不删。无歌词双端均只显示状态，读取失败仍可重试。
- 进度条和播放主控移入独立 `.safeAreaInset(edge: .bottom)`，不受歌词加载、有无及上方内容滚动影响；歌曲信息使用剩余视口高度靠底部，短屏／大字号仍能滚动查看。无歌词与无当前曲目同样保留底部播放区。双端顺序播放统一为 `list.number`，iOS 保留纯图标单排与 22 pt 大小、至少 44 pt 热区。
- 回归先红后绿：新增 5 项布局结构检查先全数失败；共享封面比例测试先报告两端比例不足。修改后 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_now_playing_layout.py'`（5 项）及 `-p 'test_ios_landscape_design.py'`（15 项）通过。新增歌词窗口、曲首曲尾、间奏和短歌词行为测试。
- 确认无活动编译并在每个目标编译前分别运行 `python3 /tmp/tinytune-followup-clean.py SwiftPackage`、`iOSSimulator`、`macOS`，定向清理对应上轮产物和编译缓存。随后运行 `swift test --package-path packages/TinytuneKit --scratch-path .build-output/SwiftPackage`：102 项用例，0 失败，1 项真实目录环境测试按既有条件跳过；日志 `.build-output/now-playing-presentation-tests.log`。
- 两次 `xcodebuild -workspace tinytune.xcworkspace` 分别使用 `-scheme Tinytune-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator` 和 `-scheme Tinytune-macOS -destination 'platform=macOS' -derivedDataPath .build-output/macOS`，均追加 `CODE_SIGNING_ALLOWED=NO build`：均通过、退出码 0。日志 `.build-output/now-playing-layout-{ios,macos}.log`。
- `git diff --check` 通过。没有重启正在运行的 Mac App，也未安装手机 App、启动模拟器或进行原生截图／真机视觉验收；未执行本轮 iPhoneOS 设备构建。保留其他未提交修改，未创建提交、未推送；历史结果不计入本轮验证。


## iOS 正在播放间距与点按进度条跟进验证

- 本轮仅调整 iOS：竖向布局将弹性空白从唱盘和歌曲信息之间移至歌词下方，唱盘到歌曲信息间距为 12 pt，歌词上方额外留白为 6 pt；有词、无词均保留原有底部安全区固定进度条和主控。macOS 布局不改。
- iOS 原生进度条增加点按识别，按滑块首尾实际中心计算跳转时间，覆盖边界钳制、RTL 和非零值域；复用现有 valueChanged 提交、当前曲目 ID 校验和 seek 能力检查，不调用播放／暂停切换。原有拖动预览、松手提交和取消预览保留。
- 结构回归先红后绿：新增的布局与点击轨道检查修改前失败；修改后运行 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_now_playing_layout.py'`（7 项）及 `-p 'test_ios_landscape_design.py'`（15 项），共 22 项通过。日志 `.build-output/ios-player-spacing-seek-{red,structure,ios-regression}.log`。
- 确认无活动构建后，分别运行 `python3 /tmp/tinytune-followup-clean.py SwiftPackage` 与 `python3 /tmp/tinytune-followup-clean.py iOSSimulator`，定向清理对应上一轮产物和编译缓存，再依次执行对应测试／构建。
- `swift test --package-path packages/TinytuneKit --scratch-path .build-output/SwiftPackage`：四个测试套件合计 113 项，0 失败，1 项真实目录环境测试按既有条件跳过。包含新增的 7 项点按映射测试，以及真实音频 seek 后保持播放／暂停意图的回归测试。日志 `.build-output/ios-player-spacing-seek-tests.log`。
- `xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator CODE_SIGNING_ALLOWED=NO build`：`BUILD SUCCEEDED`，退出码 0；日志 `.build-output/ios-player-spacing-seek-simulator.log`。
- `git diff --check` 通过。固定构建目录最终占用约 SwiftPackage 224 MB、iOSSimulator 437 MB，未另建重复编译目录。未安装手机 App、未启动模拟器、未进行原生截图或真机触控验收；本轮未执行 iPhoneOS 或 macOS 构建，未重启正在运行的 Mac App。保留其他未提交修改，未创建提交、未推送。

## 2026-11-25 · 听页品牌改造验收

- **Swift Package**：第一次全套 `swift test --package-path packages/TinytuneKit --scratch-path .build-output/TinytuneKit` 暴露出歌曲行占位图测试仍断言旧绿主题，并只允许亮底深字，导致深色模式的新紫灰底／浅紫图标断言失败（3 项）。将测试期望更新为当前浅／深主题色，并按两种明暗方向计算对比度后，清理固定目录并重跑：26 项通过，0 失败，0 跳过。日志：`.build-output/tingye-swift-tests.log`。
- **iOS Simulator**：清理 `.build-output/iOSSimulator` 后执行 `xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator CODE_SIGNING_ALLOWED=NO build`，`BUILD SUCCEEDED`。日志：`.build-output/tingye-ios-simulator.log`。
- **macOS**：清理 `.build-output/macOS` 后执行 `xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-macOS -destination 'platform=macOS' -derivedDataPath .build-output/macOS CODE_SIGNING_ALLOWED=NO build`，`BUILD SUCCEEDED`。日志：`.build-output/tingye-macos.log`。Xcode 的 App Intents 元数据跳过提示是因 target 未依赖 `AppIntents.framework`，非构建失败。
- **LyricsWorkbench**：`pnpm test` 109 项通过、0 失败、0 跳过；`pnpm typecheck` 通过；先清理固定 `tools/LyricsWorkbench/dist` 后 `pnpm build` 通过。构建保留一条既有的本机私有字体 `/local-assets/ruantang.ttf` 解析提示，字体由本机运行环境提供，不随项目打包。记录位于 `.build-output/tingye-workbench-{tests,typecheck,build}.log`。
- **品牌资源**：资产清单 JSON 与当前 SVG 均可解析；iOS 图标为 1024 × 1024 不透明 PNG，macOS 各尺寸图标保留透明背景。Logo、空态与唱片插画均使用新源稿；空库设计图中已去掉添加按钮上下的辅助文案，播放设计图可见唱针且唱头落在外圈沟槽。
- **视觉复核**：本地 LyricsWorkbench 生产构建以 Playwright 检视 1280 × 720 与 390 × 844 视口；两端均加载「听页」标志，页面横向溢出检查为 false。iOS 三页设计稿已重新导出，overview 在 `~/.codex/visualizations/2026/11/25/tingye-ios-design/tingye-ios-design-overview.jpg`。**未启动 iOS Simulator 或 macOS App 做运行时截图验收，未做真机验收；本次为设计稿检查与双端构建验证。**
- **收尾**：`git diff --check` 通过；没有创建提交或推送。保留 `.build-output` 中固定目录的本轮验证产物，没有创建新的重复构建目录。

## 2026-11-25 · 听页唱针与 macOS 主内容插画复刻

- 唱臂沿批准稿使用磨砂银曲线、小轴座和楔形唱头，iOS/macOS 共享轮廓，针尖位于封面外的黑胶沟槽。保留现有真实封面比例和 iOS 页面背景。
- macOS 接入浅、深两张原稿插画。独立 QA App（`org.tinytune.player.designqa.20261125`）实际运行：确认 1120 × 720 浅色空曲库和显式对该进程应用 `DarkAqua` 后的五首合成歌曲列表、搜索结果和来源页；另在浅色实拍歌手、专辑详情页，确认内容卡片不会透出插画。合成索引的来源未授权，截图保留了原有的状态提示；未用正式曲库。系统原生工具栏及真实列表状态不做像素等同比较。构建包确认包含浅／深插画及侧栏标志的 1×／2× 资源。隔离执行 Logo 导出脚本，确认三个倍率的标志与目前资源的 RGBA 像素完全一致。
- 分别清理固定 `.build-output/TinytuneKit`、`.build-output/macOS`、`.build-output/iOSSimulator` 的旧产物及编译缓存后执行验证。`swift test --package-path packages/TinytuneKit --scratch-path .build-output/TinytuneKit --jobs 4` 共 118 项，117 项通过、1 项无真实音频目录配置跳过、0 失败。`xcodebuild -workspace tinytune.xcworkspace` 分别使用 `-scheme Tinytune-macOS -destination platform=macOS -derivedDataPath .build-output/macOS` 和 `-scheme Tinytune-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator`，并追加 `-jobs 5 CODE_SIGNING_ALLOWED=NO build`，均 `BUILD SUCCEEDED`。日志：`.build-output/tingye-replica-{swift-tests,macos,ios}.log`。
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests`：28 项结构／资源检查通过。新增 macOS 详情背景与 iOS 空库保留背景的两个回归检查均先失败再通过；日志 `.build-output/tingye-replica-structure.log`。
- 当前本机 `xcrun simctl list -j runtimes` 返回空列表。唱针另用生产组件的手机几何在 macOS `ImageRenderer` 中渲染并目视检查；不是 iOS 整页截图。未执行 iPhoneOS 构建、模拟器运行或实体 iPhone 验收。
- 本机截图位于 `~/.codex/visualizations/2026/11/25/tingye-implementation-review/`：`macos-light.png`、`macos-dark-populated.png`、`macos-search.png`、`macos-sources.png`、`macos-artist-detail.png`、`macos-album-detail.png`、`ios-phone-record-component.png`。未提交或推送。

## 2026-11-25 · iOS「耳边折页」背景接入

- 曲库、搜索、来源三个根页面共用右下角固定插画层，替换其旧通屏插画；空曲库移除叠加的旧插画层，保留徽记和添加按钮。空库以批准的 `0.87` 不透明度展示，浏览态降至 `0.59`。资产随系统明暗切换，短视口按比例收小，增强对比度和辅助大字隐藏装饰。正在播放页及其原有背景、唱针和封面保持不变。
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests`：30 项通过。Swift 包定向清理 `.build-output/TinytuneKit` 后执行 `swift test --package-path packages/TinytuneKit --scratch-path .build-output/TinytuneKit --jobs 4`：120 项执行，119 项通过，1 项因未设置实际音乐目录报告而跳过，0 失败。另确认源 SVG 和透明 PNG 与批准稿的素材逐字节相同。
- iOS 两目标分别定向清理上轮输出后，运行 `xcodebuild -workspace tinytune.xcworkspace -scheme Tinytune-iOS -jobs 4 CODE_SIGNING_ALLOWED=NO`，分别使用 `-destination 'generic/platform=iOS' -derivedDataPath .build-output/iPhoneOS build` 与 `-destination 'generic/platform=iOS Simulator' -derivedDataPath .build-output/iOSSimulator build`，均 `BUILD SUCCEEDED`。用 `xcrun assetutil --info` 确认两个构建包都包含正常和 `UIAppearanceDark` 两个 1170 × 672 透明变体。
- 用 macOS `ImageRenderer` 核对生产 SwiftUI 背景组件的浅色空库、深色浏览、短视口及辅助大字；像素检查确认辅助大字画面不含插画。证据位于 `~/.codex/visualizations/2026/11/25/tingye-ios-background-implementation/`，`earfold-component-review.png` 为底部区域对照。当前 `xcrun simctl list -j runtimes` 返回空列表；未运行 iOS 模拟器或真机，未做整页运行验收，未安装 App。
- 日志与资产清单位于 `.build-output/tingye-iphone-earfold-*`。未执行 macOS App 或 Web 构建，本次未提交或推送。
