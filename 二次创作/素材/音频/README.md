# 音频

放备用音源：换歌候选、试听版本、封面音乐。

现用的音频在工程的 `音頻&歌詞/` 目录，由 `config.json → paths.audio` 指向：

```json
"paths": { "audio": "音頻&歌詞/Mili - world.execute (me) ;.mp3" }
```

## 换歌要连带动三样

1. `config.json → paths.audio` 换成新文件
2. `音頻&歌詞/` 里放新歌词（`.lrc` 或 `.txt`，该目录只允许一个歌词文件），跑 `npm run lyrics`
3. **最要命的**：`data/lyric_timing.json`（129 行时间表）、`src/scenes/cues.js`（九十多处词点鼓点）、15 段镜头的小节硬编码，全部作废，得重做

第 3 条意味着**换歌＝重做整片**。这首歌的时间轴是全片骨架，不是可替换的素材。

换歌只在最后手段时用。真要换，先看 `说明/使用说明.md` 第五节。
