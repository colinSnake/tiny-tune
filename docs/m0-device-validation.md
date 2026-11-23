# M0 真机验证记录

> 2026-11-19（Asia/Shanghai） · **进行中，未达到 M0 放行条件** · [路线图](roadmap.md#m0--可行性栅栏) / [PRD](prd.md)。这是一次性原生探针的证据，不是正式播放器的验收结论。

## 开发版验收进展

2026-11-20：以下更新来自独立 QA 开发版；本节之后为历史探针证据，不将探针的「未执行」或日志当作当前开发版结论。

- Mac：[工具实测](native-development-validation.md#mac-媒体验收)通过普通空格的播放／暂停与焦点隔离、底栏单次切歌，并核对 QA 进程内发布的曲名／时长／进度／播放状态。系统「播放中」卡片已由用户确认显示；系统播放及单次「下一首」由工具实测通过，暂停按钮和动态进度待测，物理外接卷仍阻塞；实体「下一首」[首次用户手测](native-development-validation.md#mac-实体下一首首次手测)及[单 QA 隔离复测](native-development-validation.md#mac-隔离媒体会话与格式预检)均失败；隔离复测确认系统服务收到播放／暂停变更、真实按键未观察到 App 回调。系统面板切歌对照已通过；[此前排查](native-development-validation.md#mac-实体键本轮排查)未定位按键进入系统前还是路由阶段丢失；[后续只读诊断](native-development-validation.md#mac-实体键只读诊断)确认有媒体控制描述符，但未检测实体按键输入，未修复或重新验收。[Mac App 格式矩阵与本地来源重连](native-development-validation.md#mac-格式矩阵与本地来源重连)补充六种合成样本的导入／播放状态／seek／自然切歌，以及本机重命名后的重新授权和冷启续播；不计为双端矩阵或外接卷恢复。
- iPhone：[既有开发版真机证据](native-development-validation.md#实体-iphone-复验)已覆盖本机目录导入、冷启动、回主屏自然切歌与控制中心；物理锁屏保留为**用户手测通过**。[此前工具实测](native-development-validation.md#实体-iphone-来源与音频打断)通过同提供者移址后回前台与冷启播放、系统「文件」预览抢占后的暂停与手动续播。[格式与来源恢复工具实测](native-development-validation.md#iphone-格式矩阵与来源恢复)通过六种合成格式导入、时钟推进、自然切曲，坏 MP3 被拒；ALAC seek 与单按钮模式切换通过。独立来源容器消失后保留索引及暂停点；修复重建目录拒绝重连后，显式预览、确认及冷启手动续播通过。[后续真机复验](native-development-validation.md#iphone-进度与单曲循环复验)通过 MP3、M4A AAC、ADTS AAC、FLAC 的暂停端点 seek，及 MP3 单曲循环跨曲末（同曲同队列）。WAV 独立 seek 阻塞，新增四种的精确曲中 seek 未测。实际撤权、线控与耳机断开阻塞；来电、第三方 File Provider 掉线和受保护样本未测。
- 尚未跨过 M0 放行门槛；范围与未完成条件见[路线图](roadmap.md#m0--可行性栅栏)。 已完成[独立 Release 本地试用包](local-preview.md)交接；Mac 的 30 首核心链路通过，iPhone 开发签名包安装和启动通过。环境受限项留档延期，不阻塞本地试用。

## 实际环境与范围

| 项 | 本轮实测配置 |
| --- | --- |
| Mac | Apple Silicon `Mac16,10`，macOS 27.2.1（26B131），约 27 GiB 可用；探针以 macOS 14 为部署目标编译并以 ad-hoc 签名启用 App Sandbox、用户选取只读与 app-scoped bookmarks。 |
| iPhone | 实体 iPhone 17 Pro Max，iOS 27.2.1（24B156）、Developer Mode 已开启；iOS 17 部署目标。复用本机现有开发签名和支持此设备的通配 profile；未创建新证书、profile 或注册新设备。 |
| 工具链 | 本机 `xcodebuild -version`：Xcode 27.0（27A266a）；`swift --version`：Apple Swift 6.4，以 Swift 6 模式构建；Mac/iOS SDK 27.0；FFmpeg/FFprobe 8.1。CI runner、最低系统运行验收、Mac 发布签名／公证尚未选定。 |

探针源码、合成音频期望 JSON、iPhone 安装包和本机证据放在用户目录的 `~/Library/Application Support/Tinytune M0 Probe/`（不进 Git）。探针独立于后来新增的 `apps/` 和 `packages/`；正式工程的结果见[原生开发版验证记录](native-development-validation.md)。源音频均由脚本生成正弦信号，不使用现有音乐库。

## Mac 实测

1. 启动签名探针，在未选目录时对本地合成 MP3 执行 `open(..., O_RDONLY)`，得到 `errno=1`。原生 `NSOpenPanel` 选中 `Matrix` 后保存只读 bookmark：枚举到 7 个样本、读打开成功、`O_WRONLY` 打开被拒绝。不创建、不截断、不写任何文件。
2. 退出后以独立进程重新打开探针，不再弹选取器。进程在恢复前仍读不到该文件；恢复 bookmark 后再次枚举 7 项，读打开成功，写打开被拒。随后同一 `AVPlayer` 换曲，检测时钟前进并对每个可播项 seek 至 1.5 秒（容差 ±0.2 秒）。用桌面真实空格事件独立触发了探针播放，日志记录 `PLAYER play row=1`；未覆盖搜索框等焦点场景。
3. 对探针自己的合成文件夹，在程序退出后做同卷改名，冷启动跟踪目录；最后恢复原名。**三次观测到 `stale=true` 时，旧 bookmark 恢复的 scope 可用 `O_WRONLY` 打开文件，违反只读预期。** 调用刷新后不再移动目录，再开独立进程的两次对照均为 `stale=false`、写打开被拒。`shasum -a 256 -c` 验证 7 个样本内容未改。只证明允许打开描述符，**未写入**，不对 OS 内部根因或跨版本表现下结论。

### Mac 只读异常：阻塞 M0 放行

下一轮隔离验证「刷新 → 释放旧 scope → 仅使用新 bookmark 重新开启」能否在**同一进程**保持只读；如果不能确认，评估 `stale` 一律停止业务访问并走系统选取器重新授权。无论系统权能结果如何，产品的读取服务不得提供原目录的写入／移动／删除路径。真实外接卷拔出／重接与撤权尚未执行；内部 `MEDIA registered once` 和空格事件都不能证明系统 Now Playing 或硬件媒体键可用，后两项仍未验收。

## 格式矩阵

表中「时钟／seek」来自 Mac 真机上 `AVPlayerItem.readyToPlay`、播放时钟前进和落点检测；未用声学采集确认扬声器出声。每个正常样本依次切换到下一素材验证替换，不代表后台自然切歌。标签列仅指 AVFoundation `commonMetadata` 里的 title／artist／album，不表示容器中本来没有标签。iPhone 已部署样本，仍须通过系统选取器跑功能测试。

| 媒体样本 | Mac 状态 | Mac 通用标签 | iPhone 状态 |
| --- | --- | --- | --- |
| MP3 | 时钟／seek 通过 | 三项齐 | 未执行 |
| M4A / AAC | 时钟／seek 通过 | 三项齐 | 未执行 |
| M4A / ALAC | 时钟／seek 通过 | 三项齐 | 未执行 |
| 裸 AAC / ADTS | 时钟／seek 通过 | 源样本无三项标签 | 未执行 |
| WAV / PCM s16le | 时钟／seek 通过 | 样本有标签，未读到三项 | 未执行 |
| FLAC | 时钟／seek 通过 | 样本有标签，未读到三项 | 未执行 |
| 伪装 MP3 的坏文件 | AVFoundation 拒绝（-11849） | 不适用 | 未执行 |
| DRM／受保护样本 | 未执行；未准备合规 fixture | 不适用 | 未执行 |

目前没有双端格式交集的放行结论；WAV／FLAC 的通用标签缺口先按 PRD 回退文件夹／文件名，是否增加其他读取路径待后续样本证据决定。

## iPhone 已部署与下一步

**设备安装、启动日志已确认**。本机 `xcodebuild` 未签名的首次 Debug bundle 经手工签名后设备安装成功，但启动时 `dyld` 拒绝未签名的 `TinytuneM0.debug.dylib`。临时工程只调整构建设置（禁用调试 dylib；另清理无关 headermap 警告），重编、重签并重装后成功；通过 `devicectl device copy from` 读到物理 iPhone 的 `LAUNCH`、`MEDIA registered once`、`RESTORE no bookmark`。样本在**另一个 App 的沙盒**，已查询 `Tinytune Fixtures` 的 Documents 确认 `Matrix` 内 7 个文件、`Background` 内 2 个文件都存在。未向个人应用或用户文件写入数据。

1. 在 iPhone 打开 **Tinytune M0 Probe → Choose Folder → 浏览 → 我的 iPhone → Tinytune Fixtures**，选中 **Matrix** 文件夹，再点探针里的 **Matrix** 按钮。等待日志出现 `MATRIX done`。
2. 从 iPhone App 切换器划掉 **Tinytune M0 Probe** 后重新打开，**不要**重选目录。确认日志出现 `RESTORE success`、曲目数为 7，并用 `Play/Pause` 确认听到合成音。保留设备连接以便收取实际日志并与 Mac 矩阵对比。
3. 同样选取 **Background** 文件夹，点播放第一首（约 25 秒）后锁屏，等自然推进到第二首（约 35 秒）；在锁屏检查歌曲名和暂停／继续，再另跑「下一首」远程命令（在第一首未结束时操作）。记录锁屏／控制中心操作、听感及切曲结果。前后台、撤权／移动、未落地文件提供商的行为单独追加，不能以成功安装视为通过。

## Fixture 与性能测量准备

| 样本 | 已生成并核对的范围 |
| --- | --- |
| `Matrix` | 6 个不同容器／codec（约 3.2–5.2 秒）＋ 1 个坏文件；`ffprobe` 校验正常样本的 codec 与时长，期望 JSON 同包。 |
| `Background` | 25 秒 MP3、35 秒 M4A AAC，已部署 iPhone，供锁屏和自然切换使用。 |
| `Library30` | 30 首、4,985,250 bytes；多种短样本、按歌手／专辑分层。 |
| `Library1000`／`Library5000` | 各 1,000／5,000 首，31,875,500／159,377,500 bytes；复用 3.2／4.1 秒 MP3／AAC 内容，使用不同路径。 |
| `Faults` | 损坏音频、可移动文件、循环链接和指向扫描根外的链接已生成；权限故障、外接卷和未落地文件要用实际环境另测。 |

正式扫描与数据库尚不存在，本轮**未执行性能测量**。计划以各端 Release 构建收集：确认选择到摘要可交互、冷进程启动到音乐库可交互、输入完成到结果可操作（含去抖）、点播到可听输出（测量仪器／判定方式待固定）；统计方法和阈值沿用 PRD AC-06。

## 命令证据与未放行项

- `xcrun --sdk macosx swiftc … -target arm64-apple-macosx14.0`、`codesign --verify --strict`：退出 0；`codesign -d --entitlements -` 核验 3 项 Mac sandbox 权限。`open -n … --args --probe-read … --matrix` 及真实系统目录选择器完成冷启动和读权限对照。
- `xcodebuild -project TinytuneM0.xcodeproj -scheme TinytuneM0 -destination 'generic/platform=iOS' … CODE_SIGNING_ALLOWED=NO build`：两次构建成功；首次签名包虽安装但运行失败，第二次签名／验证、`xcrun devicectl device install app`、`device process launch` 与 `device copy from` 成功，并已读取应用日志。
- `xcrun devicectl device info files … --domain-type appDataContainer …`：仅检查验证 App 自己的目录，样本数符合预期。没有用模拟器代替实机结论。
- **仍未放行**：Mac stale 权能异常、真实外接卷和系统媒体控制；iPhone 系统选择、冷启动恢复、矩阵、锁屏与后台验证；最低系统实际运行与 CI 配置。其余未执行项按上文记录。
