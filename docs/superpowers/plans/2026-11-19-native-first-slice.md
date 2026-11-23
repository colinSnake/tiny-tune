# Tinytune 原生首个可运行切片 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 项目约定：未经用户明确请求，不暂存、不提交。

**Goal:** 两端可选择原目录、扫描和确认入库，浏览／搜索后播放同一份原文件。

**Architecture:** 一个 workspace 和两个原生 targets，`apps/Shared` 组装界面；本地 Swift Package 把值模型、存储、播放器和组件拆为四个 target。M0 的实机放行项保持打开，开发版对陈旧书签采取失败关闭，不获取旧 scope。

**Tech Stack:** Swift 6、SwiftUI、SwiftData、AVFoundation、XCTest；不引入外部依赖。

**Spec:** [PRD](../../prd.md)、[UI Design](../../ui-design.md)、[M0 证据](../../m0-device-validation.md)。

## Global Constraints

- iPhone iOS 17+、原生 macOS 14+，不复制、不修改音频；错误或取消不静默修改原库。
- 只交付可复现的开发切片；未完成项不在路线上勾掉，也不把模拟器或无签名构建算作真机验收。

### 1. 包契约与规则

- [x] 在 `packages/TinytuneKit/Tests/DomainTests` 先写文件名、排序／搜索、队列、相对路径契约测试；运行 `swift test` 确认缺实现时失败。
- [x] 在 `Sources/Domain` 实现最小值模型及规则；重跑包测试。

### 2. 本地索引、授权与媒体扫描

- [x] 在 `Tests/LibraryTests` 先测试草稿与确认边界、重复导入、拒绝错误的重新授权身份和真实音频预检。
- [x] 在 `Sources/Library` 实现 security-scoped lease、扫描／元数据、SwiftData actor 与正式库提交；重跑测试和失败路径。

### 3. 双端原生 UI 与播放

- [x] 建 workspace、目标、原生配置与统一构建脚本；`DesignSystem` 提供行、封面、状态和品牌语义色，`apps/Shared` 实现平台导航、导入摘要、来源、搜索、播放器。
- [x] `Playback` 使用 AVPlayer，按队列提供暂停／续播、seek 和跳曲；对当前项及延迟回调做隔离，切换时释放读取 lease。
- [x] 双端构建；在隔离样本上走真实 Mac 开窗链路，检查系统选取、重复启动以及播放器状态；iOS 能验证到哪一步就记录到哪一步。结果见[原生开发版验证记录](../../native-development-validation.md)，不代表 M0 或 M1 完成验收。
