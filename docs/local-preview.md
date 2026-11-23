# 曲笺本地试用交接

2026-11-20（Asia/Shanghai）· **可本地试用，不是公开发布版。** 已挂起受环境限制的非必要验收，不再为本地试用反复追测。历史通过、失败和未测结论不变；M0／M3 的完整退出条件和 M4 发布栅栏没有标为通过。

## 试用包与安装

| 平台 | 产物与范围 |
| --- | --- |
| Mac | `Tinytune-Mac-Local-Preview.zip`，解压后打开 `Tinytune.app`。Release，arm64／x86_64 通用二进制；仅在本机 Apple Silicon、macOS 27.2.1 上启动实测。使用本地 ad hoc 签名，未经 Developer ID 签名或公证，不作为对外下载包。 |
| iPhone | `Tinytune-iPhone-Development.ipa`，Release 开发签名包。已用 `devicectl device install app` 将同一签名的 `.app` 安装到已登记的 iPhone 17 Pro Max（iOS 27.2.1）并启动；此机上可直接打开独立试用实例。开发签名不等于任意设备可装，不是 TestFlight 或 App Store 包。 |

本机从仓库根目录运行 `cat .build-output/local-preview-dir.txt` 可定位该次输出；压缩包及 `SHA256SUMS.txt` 在该目录的 `artifacts/`。产物和签名资料不纳入 Git。两端的标识均为 `org.tinytune.player.localpreview`，隔离正式版及既有 QA 的曲库和续播信息。试用包不附个人音乐；本轮仅使用合成的 `Local Preview 30`。

## 本轮验证

| 项目 | 结果 |
| --- | --- |
| 仓库检查（自动验证） | 根目录 `TINYTUNE_BUILD_DIR=<独立输出>/check bash scripts/check.sh` 退出 0。48 个 XCTest（播放 22、曲库 9、领域 12、设计系统 5）零失败；macOS、无签名 iOS 设备目标、iOS 模拟器三项构建成功。Mac 音量滑杆的主 actor 隔离警告及 App Intents 元数据跳过警告仍在。另建双端 Release 成功；ZIP 与 IPA 解包后 `codesign --verify --deep --strict` 均通过，压缩包 SHA-256 校验通过。 |
| Mac 30 首导入与冷启续播（工具实测） | 从实际解压后的试用包启动；系统选取 `Local Preview 30`，预览 30 可导入、1 坏文件跳过。确认后曲库显示 30 首，点播 `Preview Tone 01`、暂停在 15.068 s。正常退出并重开，保留 30 首、原曲和暂停点；无需重新选取目录，手动续播后暂停于 16.551 s，29 首待播及完整队列不变。31 个原样本的 SHA-256 不变，独立播放器容器内未发现 WAV／MP3 副本。 |
| iPhone 安装、启动与扫描预览（工具实测） | 实体设备安装和启动成功；镜像看到空库和四个中文 Tab。来自独立合成样本容器的原生文件选取器可打开 `Local Preview 30`，摘要显示 30 可导入、1 坏文件跳过；31 个设备样本回读 SHA-256 一致。系统随后弹出该 App 的首次无线数据权限选择，本轮未代选，未确认写入；**此试用包的 30 首导入确认、点播、冷启续播未测**。可以自行选择无线数据授权，再回到「导入 30 首」；只想试用本地曲库时不必先做下表的补测。既有独立 QA 的真机结果见[开发版记录](native-development-validation.md#iphone-格式矩阵与来源恢复)，不冒充本包复验。 |

测试样本：6 个歌手／专辑目录，每目录 5 首 18–23 秒单声道 PCM WAV，音频合计 27,122,820 bytes，加一个故意损坏的 MP3。生成复用 `scripts/make-smoke-library.py` 的合成音生成函数；路径、时长、体积和散列见本轮输出中的 `fixture-expected.json`。本轮未采集性能基准或扬声器听感。

## 以后遇到再补测

| 事项 | 保留状态／重启条件 |
| --- | --- |
| Mac 实体「下一首」 | **两次用户手测失败，未修复**。保留[隔离与只读诊断](native-development-validation.md#mac-实体键只读诊断)。有实际复现再判定消费控制输入与系统分派，当前用 App 内控件，不以它阻塞本地试用。 |
| Mac 系统播放面板 | 系统播放、单次切歌有先前证据；面板暂停、动态进度未测（面板界面绑定超时）。如面板实际异常再抓系统与应用状态。 |
| 设备／来源／音频边界 | Mac 物理外接卷、iPhone 耳机／线控、真实系统撤权为环境阻塞；来电、第三方 File Provider 掉线、WAV 独立 seek、其余精确曲中 seek、受保护音频和听感未完成。拿到具体设备、配件或样本再复验。既有 iPhone 物理锁屏仍是**用户手测通过**。 |
| 完整发布验收 | 不以本地试用豁免最低系统实测、完整发布通道签名与安装、性能、无障碍等正式发布门槛；需要对外分发时按[路线图](roadmap.md#m4--v10-发布栅栏)处理。 |

本轮未改应用代码，未提交、未推送，未覆盖正式版或触碰个人曲库。
