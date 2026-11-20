# 素材库 · Live2D 接入过程（归档）

> 从 `二次创作\说明\素材库.md` 拆出（2026-11-21）：挂库、建索引、渲图与压墨配方、跑通证据。结论与现任素材仍在原文件。

## 二、挂进来（一次性）

```powershell
# 工程里建一个指向素材库的目录联结（不需要管理员权限）
New-Item -ItemType Junction -Path "assets\live2d_lib" -Target "E:\DCIM\【OST】音乐、音效、视频\双生视界\【Live2D】（23.12.21）\live2d"
```

为什么要联结：工程内置静态服务只服务项目目录内的文件（`export/server.mjs` 有 `startsWith(ROOT)` 检查），
而渲染页是从 HTTP 读模型与贴图的。结进去之后：
`assets/live2d_lib/<角色>/<模型目录>/<模型目录>.model3.json` 就能被 `tools/live2d_art.mjs` 直接吃。

---

## 三、索引（选型不再靠翻目录）

```powershell
python tools/live2d_index.py            # 扫全库，产 docs/archive/v4/art/live2d_index.json
python tools/live2d_index.py --top 20   # 顺带列橙+米白占比最高的 20 套
```

索引里每套模型记这几件事：角色 / 模型目录 / model3 名 / moc3 体积 / 贴图数量与最大尺寸 /
**三墨占比（cream / orange / black）** / 动作数 / 表达式数。三墨占比用与 `ink` 同一套 HSV 规则算，
所以能直接预判"这套渲出来大概是什么形状"：

- `orange` 高：有大量暖色/彩色布料（橙墨会占主体）
- `cream` 高：白衣、浅色系（适合压"米白为主体"的画面）
- `black` 低（多数套装 <1%）：说明贴图本身很亮，黑墨主要来自 `--keyline` 的黑边，而不是素材

角色平均（橙+米白占比）：菊理千姬 98.9 / 阿尼娅 98.9 / 洛可可 98.3 / 唯 97.4 / 艾琳 97.3 …
高奈利亚 24 套、1026 条动作，是动作最全的一个。

---

## 四、渲染与压墨（配方）

```powershell
# 1) 渲透明 PNG（角色/目录，任意姿势）
node tools/live2d_art.mjs render --model "高奈利亚/l2d16.u" --out out/_lib/bust.png --w 2048 --h 2048 `
     --pad 0.96 --params "PARAM_ANGLE_X:0,PARAM_ANGLE_Z:0"

# 2) 压成三墨并按交付尺寸出图（--crop 是源像素 x,y,w,h）
node tools/live2d_art.mjs ink --in out/_lib/bust.png --out out/_lib/f_bust_ink.png `
     --w 2172 --h 2896 --crop 1560,380,1200,1600 --skin cream --block 5 --clean 3 --keyline 4
```

参数怎么调（实测）：

| 参数 | 作用 | 建议 |
| --- | --- | --- |
| `--pad 0.94`（默认）/ `0.96` | 角色占画布比例 | 全身 0.94；只取上半身反而要 `--box` 更准 |
| `--params` | 叠参数改姿势 | `PARAM_ANGLE_X:0,PARAM_ANGLE_Z:0` 是正面；`-62` 近似侧脸；`PARAM_EYE_L_OPEN:0` 闭眼 |
| `--motion` + `--t` | 定格某条动作 | 伸手、捂胸这类姿势靠它，比自己拧参数快 |
| `--box x,y,w,h` | 模型坐标取框，直接渲成成品尺寸 | 胸像/特写用它，比事后裁切准 |
| `--block n` | 降采样"只取形体" | 3 = 保留五官，5 = 更平更像剪影（实测 5 更干净） |
| `--clean n` | 3×3 众数清理 | 3 能把发丝间碎点吃掉大半 |
| `--keyline n` | 输出黑边宽度 | 3–6；0 关掉会散 |
| `--skin cream\|black` | 皮肤走哪一墨 | `cream` = 有脸；`black` = 靠近原片"无脸"设计 |
| `--erase x,y,w,h` | 手工抹除（输出像素，多块用 `;`） | **无脸化的实际出口**：框住眉/眼填成皮肤墨，见下节 |
| `--blue s` | 蓝→橙 的饱和度阈值（默认 0.12） | 发面高光会漏成米白白洞；`0.005` 基本吃干净 |
| `--island n` | 小于 n 像素的色块并回周围主墨，并回填内部透明小洞 | **治碎斑的关键**：12000 起（1086×1448 档），蕾丝/花纹/发高光都被吃掉 |

### 目前最好的一档（占位稿）

```powershell
node tools/live2d_art.mjs ink --in out/_lib/p_face.png --out out/_lib/f_bust_try.png `
  --w 1086 --h 1448 --crop 1544,378,1266,1688 `
  --block 1 --clean 2 --island 12000 --keyline 4 --blue 0.005 --erase "650,780,140,120;515,995,100,70"
```

**但它只是占位稿**：原片那种"长发流向 / 领结切面 / 纯黑空脸"是设计出来的，压墨只能处理图像，
到不了那个标准（对照见 `out/_lib/compare_ink.png`）。

### 无脸怎么来（这条是卡点）

片子无脸，模型有脸。四条路里只有最后一条可靠：

| 试法 | 结果 |
| --- | --- |
| `--skin black` | 五官仍在墨下面露边 |
| `--block 8/12` | 脸压平大半，眉和眼还留两块 |
| `--faceless` | **失效**：头发压脸，眉眼与头发连通，泛洪判不出"洞" |
| `--erase` | **有效**：人给框，工具抹净 |

```powershell
node tools/live2d_art.mjs ink --in out/_lib/p_front.png --out out/_lib/i_front_face.png `
  --w 724 --h 966 --crop 772,189,633,844 --block 6 --clean 3 --keyline 4 --erase "420,505,152,122"
```

`--erase` 在 keyline 之前跑，抹掉的区域不会再勾出内线。无脸是设计决定，框得人给。

再走一遍收图流水线，把它归位到片子基准：

```powershell
python tools/art_intake.py --src "<把压好的图按 <key>.png 命名的目录>" --preview 20,166.5
```

---

## 五、已经跑通的证据（2026-11-17）

| 步骤 | 结果 |
| --- | --- |
| 高奈利亚 `l2d16.u` 渲 4096 透明图 | 一次成功，`canvas 1500x1500 @256.7%` |
| 同图压三墨（`--block 3` / `5`） | 覆盖 56.2%，cream 35.2 / orange 47.6 / black 17.2；蓝发→橙墨、白布→米白、深色→黑 |
| 四套候选正面（`out/_lib/candidates.png`） | 高奈利亚 l2d16（棋塔装）/ l2d5017 / 菊理千姬 l2d28（白羽天使裙）/ 朱诺 l2d5017 |
| 五取景（正面 / 侧脸 / 闭眼 / 手到胸前 / 眼部特写） | `out/_lib/five_views.png`；四条能出，**侧脸换不动**（见下） |
| 无脸化（`--erase`） | 724×966 胸像抹净五官，`out/_lib/i_front_face.png` |

实测出来的两个硬边界：

- **侧脸换不动**：`PARAM_ANGLE_X` 从默认 −30 调到 0、再调到 −62，同一套模型渲出来的 bbox 几乎不变
  （`623,207,1553,2047` vs `623,202,1553,2047`）——角度参数在这个模型上幅度极小。
  要侧脸得走 motion（`l2d5017.u` 有 `Mgirl02_celian`），或换一套角度变形明显的模型。
- **眼部特写分辨率不够**：贴图 2048，脸在贴图里只占一小块，4096 渲图裁出来再放大到 3000 长边是虚的。
  `f_eye` 那张要么接受放大、要么另画。

对照表看得很清楚：这套库的"原画质量"足够撑特写，**短板不在形体，在"三墨化之后还剩多少"**——
`--block` 越小越像插画、越大越像剪影，中间那一档要按镜头定。

---


