# tools · 工具索引

> 一个脚本一件事，入口固定在这里。新加脚本先找位置挂进本表；找不到位置，说明它该并进某个现有工具，而不是再开一个。
> 命令一律在工程根执行（`node tools/xxx.mjs` / `python tools/xxx.py`）。

## 一、主流程（跑片子、出片、字表、自检）

| 脚本 | 做什么 |
|:--|:--|
| `zh_charset.mjs` | 收全片用到的 CJK 字符，回写 `config.json → fonts.cjk[].text`；`--check` 只比对。动任何中文文案后先跑它 |
| `zh_script_doc.mjs` | 从两份脚本 JSON 编译 `二次创作/文稿/台词中文稿.md` |
| `storyboard.mjs` | 从代码里的镜头清单生成 `STORYBOARD.md`（`npm run storyboard`） |
| `base_sheets.mjs` | v4 保留段落的基线拼图，一beat 一帧 |
| `regress_sheets.mjs` | 已重做段落的改前/改后拼图 |
| `fill_lyrics.mjs` | 用你的歌词文件 + 仓库内时间表生成 `data/lyrics.json`（`npm run lyrics`） |
| `parse_lrc.py` | 解析 LRC 时间轴 |
| `analyze_audio.py` | 逐帧音频特征 → `data/audio_features.json`（`npm run analyze`，需 librosa） |
| `check_no_lyrics.mjs` | 发布前门禁：入库文件里不得有连续歌词 |
| `dump_text.mjs` | 给 `fillText` 挂勾子，按 0.5 s 网格扫全片画出的文字（查漏中文用） |
| `check_export.py` | 成片最小自检：ffprobe 元数据 + 音轨与源 wav 互相关 + 按歌时间抽帧（本机唯一能跑的质检） |
| `check_flash.py` | 闪光安全：按 WCAG 2.3.1 三闪阈值扫成片（需 cv2/librosa） |
| `check_sync.py` | 音画同步与 cue 对齐自检（需 librosa/cv2，本机跑不了） |
| `sync_check.py` | `check_sync` 的本地替身：只查 mp4 声轨是否正好前置 preroll 5 s，numpy + ffmpeg |
| `probe_webcodecs.mjs` | 探本机 WebCodecs 有没有硬件 H.264、单帧开销 |
| `render_4k_seg.py` | **4K60 现行方案**：120 帧（2 s）一段、逐段重试、最后 concat 视频 + 单独合成一条连续音轨；配套 `export.mjs --mute` |
| `render_4k_chunks.py` | 上一代方案：分 12 段 × 1086 帧，断点续跑记 `out/_4k_parts/progress.json` |

## 二、画板与美术流水线

| 脚本 | 做什么 |
|:--|:--|
| `art_dims.mjs` | 量剪影进管线时的真实源尺寸、设计基准换算、长宽比偏差（换图后第一件事，`sx == sy`） |
| `art_check.mjs` | 验收八张剪影：尺寸 / alpha / 三墨 / 包围盒留白，与 `docs/archive/v4/art/baseline.json` 比构图位移与尺度（`--baseline` 重写基线） |
| `art_intake.py` | 收图流水线：外来图规整到基线构图、量墨、出配准初值（见 `二次创作/说明/收图流程.md`） |
| `art_crop.py` | 按 `art_crop_spec.json` 把原生立绘裁成剪影位，不过滤、不重上色 |
| `art_filter.mjs` | 把任意一张图滤镜成片子的三墨剪影（cream / orange / black） |
| `live2d_art.mjs` | 把 Live2D 模型渲成透明 PNG，并附带同名 `.json` 记模型/画布/取框参数；可再压成三墨剪影 |
| `live2d_index.py` | 给双生视界 Live2D 素材库建索引（`docs/archive/v4/art/live2d_index.json`） |
| `plates.py` | 画板共用：从 Live2D 渲图裁出片子用的画板，并把「这张板从哪来」一起留档 |
| `plate_bake.py` | 按源头最大像素重出画板（上限 2172 宽，带 ±6 px 平移搜索补 f_bust 的 1 行偏移） |
| `plate_cut.py` | 从 Live2D 渲图裁出项目交付尺寸（默认 1086×1448） |
| `plate_refit.py` | 反解每张画板的取框参数（zoom / top / cx），再按新尺寸重出 |
| `plate_tune.py` | 在画板空间里直接搜参数，把新画板调到跟旧画板严丝合缝（refit 的梯度解只是近似） |
| `plate_iou.py` | 按剪影重合度反解取框（参考图带黑底时比梯度法稳） |
| `plate_pick.py` | 用成片帧选取框：裁一版 → 出同刻帧 → 与改前帧比 PSNR，取最高 |
| `plate_trace.py` | 给剩下三张画板找源头：候选渲图逐个试取框，先小图快筛再确认 |
| `plate_alpha_key.py` | 给压了黑底的画板补回 alpha：四边向内泛洪，只吃与边缘连通的近黑像素，再羽化 |
| `plate_delta.py` | 量新旧画板之间的构图差（设计 px），并算出 REGISTER 的修正值 |
| `plate_vs.py` | 把反解出的取框真裁出来，与旧画板并排看（分数咬得紧时靠眼睛定） |
| `plate_check.py` | 画板自检：每张必须是带 alpha 的 PNG，且确有透明像素（黑底板进片就是黑方块） |
| `raster_to_svg.mjs` | 三墨 PNG → SVG（三块累进版）。**路线已结案、代码零加载**，`推进计划.md` P7 挂着等拍板 |

## 三、文案门禁（中文层）

| 脚本 | 做什么 |
|:--|:--|
| `copy_audit.py` | 抽出全部中文上屏文案，按来源分组写进 `二次创作/文稿/全片文案总表.md` |
| `copy_lint.py` | 门禁：抓半中半英的串（口径见 `说明/语言边界.md`） |
| `copy_typo.py` | 扫排版糙点：半角标点、省略号写法、数字与单位间距、重复空格；只报告不改 |
| `latin_text.py` | 扫 `src/` 里画到画面上的纯拉丁字面量，出待判清单 |
| `list_ascii_text.py` | 读 `out/_lib/text_dump.json`，列 ASCII 串（需先跑 `dump_text.mjs`） |
| `report_en_film.py` / `report_en_left.py` | 把 `text_dump.json` 里的英文串归类、按首次出现时间排序 |

## 四、一次性取证（留档用，不再是日常流程）

| 脚本 | 做什么 |
|:--|:--|
| `luma.py` | 逐帧平均亮度，验证高潮光的单向递增与最亮帧位置 |
| `measure_cues.py` | 拿音频实测 `src/scenes/cues.js` 的每个 cue（人声或整段 onset） |
| `compare_frames.py` | 成片 vs 参考帧对比（PSNR/差异图） |
| `compare_sheets.py` | 拼图对比 |
| `probe.html` / `probe_webcodecs.html` | 浏览器里的 WebCodecs 手工探针 |

## 五、待归位

- `render_4k_seg.py`、`render_4k_chunks.py`（2026-11-20 新写，此前未入库、无任何文档提及，本表首次挂上）。
- 五个孤立脚本已在本表挂上用途：`copy_typo.py`、`latin_text.py`、`plate_trace.py`、`sync_check.py`、`list_ascii_text.py`。
- 一次性取证类若要收进 `tools/experiments/`，先改完所有文档里的引用路径再动目录（现在 20 多处 md 还写着 `tools/plate_*.py`）。
