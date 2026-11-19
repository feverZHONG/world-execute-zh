# world.execute (me) ; · 简体中文二创

[![来源](https://img.shields.io/badge/upstream-Nyankomintsu%2Fworld--execute--me--lyric--mv-blue)](https://github.com/Nyankomintsu/world-execute-me-lyric-mv)
[![许可](https://img.shields.io/badge/code-MIT-green)](LICENSE)
[![剪影](https://img.shields.io/badge/silhouettes-CC%20BY--NC--SA%204.0-orange)](CREDITS.md)

一份**非官方同人作品**的简体中文副本：把 Mili《world.execute (me) ;》歌词 MV 渲染工程（上游第四版）的界面与台词换成简体中文机器腔，
歌词一句不动。工程本体（用 canvas 逐帧绘制、无头浏览器读帧、ffmpeg 合成）沿用上游，代码仍是 MIT。

> 与 Mili、Anthropic 均无关联，未获授权或背书。**本仓库不含歌曲音频与歌词文本**，运行时要自备。

---

## 一、来源（这份副本从哪来）

| 项 | 内容 |
|:--|:--|
| 上游仓库 | <https://github.com/Nyankomintsu/world-execute-me-lyric-mv>（原版中文 README 见 [`README.upstream.md`](README.upstream.md)） |
| 上游版本 | **v4**（`package.json` 里 `version: 4.0.0`），整片全部镜已完成 |
| 上游作者 / 署名 | **Nyankomint**（角色剪影由其提供，CC BY-NC-SA 4.0） |
| 上游原片 | B 站 <https://www.bilibili.com/video/BV186pc65E68> |
| 上游许可 | 代码与自撰文档 **MIT**（见 [`LICENSE`](LICENSE)）；角色剪影 **CC BY-NC-SA 4.0**；字体 SIL OFL 1.1 |
| 原曲 | Mili《world.execute (me) ;》，收录于专辑《Miracle Milk》(2016)；作曲 Cassie Wei / Mili，作词 Mili。音频与歌词版权归 Mili 及相关权利人，**不在本仓库内** |
| 本副本 | 由 **feverZHONG**（B 站 UP 主「fever钟」）制作，2026 年 11 月起；目标是把整片 UI 与台词简体中文化，不改歌词 |

上游的 AI 使用说明同样适用于本副本：上游代码与文档由 AI（Claude，经 Claude Code）撰写，方向与取舍来自制作者；
角色剪影是用 AI 图像生成工具做的拟人二创图。详见 [`CREDITS.md`](CREDITS.md)。

**上游要求全文的登记**：制作者给 AI 的两份要求 [`PROMPT_v4.md`](PROMPT_v4.md)、[`PROMPT_v4_fix.md`](PROMPT_v4_fix.md) 在副本里原样保留（根目录与 `docs/archive/v4/` 各一份，逐字节一致）；
它们与 `PLAN.md`、`KIT.md`、`PROGRESS.md`、`README.upstream.md` 等上游文档的尺寸、SHA-256、版权与维护规则，统一登记在 [`二次创作/说明/上游文档登记.md`](二次创作/说明/上游文档登记.md)

---

## 二、这个副本改了什么

歌词一字未动，只改"机器说的话"——界面、对话、错误文案、片尾署名，语体是简体中文、短硬、全角标点、句末不加句号。

| 层 | 内容 | 证据 |
|:--|:--|:--|
| 字体层 | 字体栈、按字断行（不按空格）、等宽汉字 1em、字形校验；两角色各 **547 字**的用字表（含注释里的字，比实际画面用字略多） | `tools/zh_charset.mjs`、`src/engine/draw.js` |
| 文案层 | `chat_script.json`、`errors.json` 全量中文化，场景里硬编码的 UI 字一并改（含警告页整页、片尾署名） | `docs/archive/v4/chat_script.json`、`docs/archive/v4/errors.json`、`src/scenes/*` |
| 美术层（接线，不出图） | 剪影交付规格单、验收脚本、八张实测基线；坐标基准参数化（1086×1448 不再写死）；**收图流水线**：外来图一键规整到基线构图、量墨、出配准初值 | `二次创作/说明/剪影规格.md`、[`收图流程.md`](二次创作/说明/收图流程.md)、`tools/art_check.mjs`、`tools/art_intake.py`、`src/engine/art.js` |
| 美术层（形体来源） | 接入本机**双生视界 Live2D 素材库**（15 角色 / 204 套模型 / 1.84 GB）：建墨色索引、渲染工具认库路径、三墨压图配方 | [`素材库.md`](二次创作/说明/素材库.md)、`tools/live2d_index.py`、`docs/archive/v4/art/live2d_index.json`、`tools/live2d_art.mjs` |
| 导出层 | 修本机 ffmpeg 4.2.2 不认 `adelay=...:all=1`；1080p60 全片已出；自检脚本量音画滞后 | `export/export.mjs`、`tools/check_export.py` |
| 试验线（已结案） | SVG 位图矢量化（无画质收益，2026-11-17 关闭）、Live2D 模型顶剪影（能跑通但不能当成品） | `二次创作/说明/踩坑与经验.md` 3.3 / 3.4 |

---

## 三、目录

```
src/            canvas 渲染引擎与全部场景（engine / scenes）
export/         export.mjs（逐帧 + ffmpeg 合成）、server.mjs（静态服务与预览）
tools/          字表、台词稿、量图、验收、自检、Live2D 试验等脚本
docs/           v4 的对话文案、错误文案、上游提示词与进度记录
assets/         角色剪影（8 张 PNG + regions.json）、SVG 验证副本、字体包清单（另：`live2d_lib` 是指向本机素材库的目录联结，不入库）
二次创作/        中文化相关的说明与文稿（规格单、清单、踩坑经验、台词稿）
音頻&歌詞/       自备歌曲与歌词（不入库，只留 README）
out/            渲染产物与成片（不入库）
```

中文化的全部文档在 [`二次创作/`](二次创作/README.md)，入口是 [`二次创作说明.md`](二次创作说明.md)。

---

## 四、怎么跑（Windows 本机）

```powershell
cd "E:\DCIM\doubaoWS\workspace\world-execute-中文版"

# 预览（起本地静态服务并打开页面；无音频也能无声播）
npm run preview

# 静帧检查（最快确认画面对不对，几秒到一分钟）
node export/export.mjs --sheet out/qa.png --times 12.5,30,60 --cols 1 --width 1280 --height 720

# 整片 1080p60（本机实测 13,017 帧 / 216.95 s / 约 27 分钟）
node export/export.mjs --start -5 --out out/wem_zh_1080p60.mp4 --width 1920 --height 1080

# 成片自检（元数据 + 音轨与源 wav 的互相关 + 按歌时间抽帧）
python tools/check_export.py out/wem_zh_1080p60.mp4 --frames -2.5,45.4,170.19,209.8 --outdir out/check
```

- 时间参数一律是**歌时间**（音频开头 = 0）；成片前有 `safety.preroll: 5` 秒警告页，影片时间 = 歌时间 + 5。
- 换中文文案后先跑 `node tools/zh_charset.mjs`，547 字表之外的新字会被拦下。
- 字体包在 `assets/fonts`（`@fontsource/noto-sans-sc`、`noto-serif-sc`），`npm install` 装在工程根另需 `playwright-core` 与 `ffmpeg-static`。
- 本机只有 Edge → playwright 回落 `msedge`；ffmpeg 用系统 4.2.2（nvenc 探测失败时回落 libx264，属正常）。

---

## 五、已交付

| 产物 | 说明 |
|:--|:--|
| `out/wem_zh_1080p60.mp4` | 1080p60 全片，13,017 帧 / 216.950 s / 508.7 MB / 平均 8.0 fps；音轨与源 wav 滞后实测 **0.0 ms**（不入库） |
| `二次创作/说明/交图清单.md` | 一页纸素材清单：画师要交什么、尺寸、硬规格、验收口径 |
| `二次创作/说明/剪影规格.md` | 规格单全文（八张实测表 + 七条硬规格 + SVG/Live2D 结论） |
| `二次创作/文稿/台词中文稿.md` | 全片中文台词稿（由 `tools/zh_script_doc.mjs` 从文案源生成） |
| `二次创作/说明/踩坑与经验.md` | 字体层、美术层、导出层的坑与实测数据；接手先看这份 |

---

## 六、许可与红线

- **代码与自撰文档**：MIT。改后发布，保留上游版权声明即可。
- **角色剪影**（`assets/character/*.png`）：CC BY-NC-SA 4.0，署名 **Nyankomint**。非商业、相同方式共享。
  仓库里的 `assets/character_svg/` 只是本地技术验证副本，同样受此约束。
- **歌曲与歌词**：不在本仓库内，权利属于 Mili 及相关权利人。本工程只读你自己放在 `音頻&歌詞/` 的文件。
- **AI 生成**：片中含 AI 生成的角色图；公开分享时请一并标注。
- **闪光警告**：成片含大段高对比快速切换（歌时间 148.04–192.34 s），片头有 5 秒警示页；公开发布请在标题或简介再标一次。
- **不可直接发布的东西**：`assets/live2d/`（第三方 Live2D 模型，只作本地试验）、`assets/character_svg/`（技术验证副本）。

---

## 七、版本管理

这份副本**单独一个 Git 仓库**（父目录 `E:\DCIM\doubaoWS` 与 `workspace\` 都没有 `.git`）。默认**私有**，只作本地与异地备份：

- 忽略项：`/out/`（渲染产物与成片）、`/音頻&歌詞/*`（歌与词）、`/assets/fonts/node_modules/`、`/assets/live2d/`、`/assets/_test_art/`、`node_modules/`、`/data/lyrics.json`。
- `.gitattributes` 只有一行 `* -text`：逐字节保留，不做 CRLF 转换（工程里 CRLF/LF 混杂，`tools/script_json.py` 还依赖 `chat_script.json` 的排版），别改成 `text=auto`。
- 文档一律 UTF-8（无 BOM）；用 Windows 记事本打开再保存会把编码改坏。
- 公开推远端前，先把 `assets/character/`、`assets/character_svg/`、`tools/live2d_lib/` 三处换成自己的素材。

---

## 八、上游原版文档

上游第四版的中文说明、提示词、逐轮进度都在 [`README.upstream.md`](README.upstream.md) 与 [`docs/`](docs/README.md)，
本副本没有删改它们——那份文档解释的是"原版怎么做的"，这份解释的是"中文化改了什么"。
