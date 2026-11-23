# Tinytune 歌词工作台

独立本地 Web 工具和采集脚本：输入歌手，浏览录音、按版本匹配歌词、预览时码、批量导出。使用 Vite、React、TypeScript、Node.js 和 Fastify，不需要数据库、账号或浏览器插件。**只采集曲目元数据和歌词，不下载音频。**

## 启动网页

需要 Node.js 22.18 或以上，以及 `package.json` 指定的 pnpm 版本。从仓库根目录运行：

```sh
cd tools/LyricsWorkbench
pnpm install --frozen-lockfile
pnpm dev
```

访问 `http://127.0.0.1:9117`。开发模式只启动一个 Fastify 服务：页面、API 和 Vite 热更新共用同一端口，不需要另起 Vite 或配置 API 代理。修改 `.env.local` 后需重启开发服务。服务只监听本机；不要把本实例直接暴露到公网。查看界面不需要 API Key。选择「试用合成样例」→「匹配已选曲目」→「载入试听样例」，可以不联网体验时间轴、定位和导出。

构建并以生产模式本机预览：

```sh
pnpm build
pnpm start
```

构建生成 `dist/public/`（静态页面和资源）与 `dist/server/index.js`（服务端入口）。生产模式由 Fastify 提供静态资源和 API，不启动 Vite，默认访问 `http://127.0.0.1:9120`。开发和生产都可以用 `PORT` 环境变量更换端口，例如 `PORT=8080 pnpm dev`。

1. 搜索歌手名称或别名，核对多个同名歌手的地区、描述后选定一位。每次加载最多 50 条录音，可继续分页。
2. 勾选曲目，点击「匹配已选曲目」。为遵循数据源限速，匹配不是瞬时操作；可停止剩余请求或重试失败项。只有录音版本足够明确时才自动确认；「待确认」可预览候选并手动选择。
3. 点击歌曲预览。选择自己的本地音频可逐行试听、点歌词跳转。本地音频不上传；浏览器可能不支持某些编码，此时仍可查词和导出。
4. 下载单曲 `.lrc`，或用 ZIP 导出已确认歌词和 `manifest.json`。只要曲目列表可用，也可以单独导出曲目清单。纯文本不会生成假的时码。

## 命令行采集

```sh
pnpm collect '歌手名称' --limit 50 --out ./export
pnpm collect --artist-id '你的 MusicBrainz 歌手 ID' --limit 100 --out ./export
```

只在歌手名称或别名精确对应到唯一候选时自动使用；否则打印候选 ID，使用 `--artist-id` 再试。`--limit` 可设为 1–500，默认 50。脚本输出自动确认的歌词及清单；歧义只记录状态，需到 Web 端人工确认。不会覆盖已有文件。`Ctrl+C` 保留已完成的结果。

## 放回 Tinytune

例如，把 `01 晴天.lrc` 放到 `01 晴天.flac` 同目录。**文件主名（包括曲序、空格和版本后缀）必须一致**，扩展名用 `.lrc`。单曲导出搭配选择本地音频时使用该音频主名；批量 ZIP 默认用曲名，对照清单处理重名和不同版本。歌词保存后无需重新扫描：打开或关闭后重开歌词视图即可重新读取。

- macOS：点播放器底栏的引号气泡「歌词」，打开右侧歌词栏。
- iOS：打开「正在播放」，点引号气泡「歌词」。点击时码行可跳转，手动滚动后可点「回到当前句」。
- App 支持 UTF-8（含 BOM）的逐行 LRC、含偏移和多时码的常见格式，以及无时码的纯文本。不改写音频或标签。

用独立测试曲库验证 iPhone 时，见[时码歌词体验验收步骤](../../docs/native-development-validation.md#iphone-时码歌词验收)。

## 来源、限制与验证

曲目使用 [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API)，选中匹配时查询录音对应的发行信息；歌词使用 [LRCLIB v1](https://lrclib.net/docs.txt) 的搜索接口。查询只发给这两个固定来源，并遵守限速。公开查询不等于可再分发，请只保存你有权使用的歌词。录音、专辑和歌词以数据源收录为准；不保证覆盖歌手全集。若已注册 LRCLIB，可在 `.env.local` 提供服务端 `LRCLIB_API_KEY`，不要加 `VITE_` 前缀，以免暴露到前端。

```sh
pnpm test
pnpm typecheck
pnpm build
```
