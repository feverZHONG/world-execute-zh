// A STICKER for the comment section (not part of the film): the cat-eared figure with her paws up (cat_paws), in
// tears, and what she says. Rendered as a check card (lab.js) through the film's own pipeline:
//
//   node export/export.mjs --lab meme --sheet out/meme/meme_16x9.png --times 0 --cols 1 --width 3840 --height 2160
//
// and the middle square is cut out of it afterwards (ffmpeg: crop=2160:2160:840:0). Everything stands inside that
// square (x 420 … 1500 of the 1920 x 1080 frame).
//
// She is the supplied silhouette, untouched: the tears, the blush and the shaking are drawn over her in the film's
// inks (cream with a dark edge, the error's rose for the blush). Her line is set in Noto Sans TC 900 (config.json
// fonts.cjk -> memeSans: only the characters of this line are loaded); the one Latin word in it is the system's mono.
import { ground } from '../components/plate.js';

/** Her figure on the sheet: the top edge of the art cuts her ears, so it lies just above the frame. */
const H = 812, FIG = { x: 960 - (H * 1086) / 1448 / 2 + 6, y: -12, w: (H * 1086) / 1448, h: H }, K = H / 1448;
/** A point of the art (source px) on the sheet. */
const at = ([x, y]) => [FIG.x + x * K, FIG.y + y * K];
/** Her line, in her own register (see 说明\角色\高奈利亚.md: 动词先行 / 句落动作或状态 / 无主句 / 情绪只出现在手上 /
 *  不用感叹号): the sticker reports the film as finished, and then names the one thing on her that is still moving.
 *  Two rows, no first person. */
const ROW1 = '画完了。', ROW2 = '手还在抖。';

/** The blush under an eye: three short strokes in the rose of the error. On this sticker it is the only thing her
 *  face says - the tears were taken out, so the second row is what tells on her. */
function blush(ctx, x, y, s) {
  for (let i = -1; i <= 1; i++) ctx.line(x + i * 13 * s - 5 * s, y + 9 * s, x + i * 13 * s + 5 * s, y - 9 * s, { color: 'err', width: 5 * s, alpha: 0.9 });
}
/** She is shaking: a pair of short arcs beside a point, on the side `dir` (+1 right, -1 left). */
function shake(ctx, x, y, dir, s = 1) {
  for (const [d, r] of [[0, 30], [20, 40]]) ctx.circle(x + dir * d * s, y, r * s, { color: 'sub', width: 5 * s, a0: dir > 0 ? -0.55 : Math.PI - 0.55, a1: dir > 0 ? 0.55 : Math.PI + 0.55 });
}
/** A row of type with its shadow plate and a dark edge: parts = [[string, font role, weight, colour], ...], centred on x. */
function row(ctx, parts, x, y, size) {
  const w = parts.map(([str, font, weight]) => ctx.measure(str, { size: font === 'mono' ? size * 0.96 : size, weight, font }) + (font === 'mono' ? size * 0.28 : 0));
  let px = x - w.reduce((a, b) => a + b, 0) / 2;
  parts.forEach(([str, font, weight, color], i) => {
    const o = { size: font === 'mono' ? size * 0.96 : size, weight, font }, tx = px + (font === 'mono' ? size * 0.14 : 0);
    ctx.text(str, tx + size * 0.07, y + size * 0.07, { ...o, color: 'bg' });
    ctx.text(str, tx, y, { ...o, color: 'panel', stroke: size * 0.16 });
    ctx.text(str, tx, y, { ...o, color });
    px += w[i];
  });
}

export function labCards(env) {
  const { art } = env;
  return {
    meme: [{
      palette: 'warm',
      render(ctx) {
        ground(ctx, { light: [960, 400, 540, 'raised', 1], marks: false });
        // her, with a shadow plate under her (the print of the film)
        art.inks(ctx, 'cat_paws', { ...FIG, x: FIG.x + 16, y: FIG.y + 16 }, { plates: [{ ink: 'all', role: 'bg' }] });
        art.inks(ctx, 'cat_paws', FIG);
        // her face: no tears (a sticker of her crying is a different sticker), only the blush under both eyes -
        //   and the second row naming the thing she cannot keep still
        const eyes = (art.region('cat_paws', 'eyes.0') && art.region('cat_paws', 'eyes.1')) ? ['eyes.0', 'eyes.1'].map((k) => { const r = art.region('cat_paws', k); return [r.x, r.y]; }) : [[690, 430], [520, 515]];
        const [eR, eL] = eyes.map(at);                                    // (on the sheet: eR is the eye at the right)
        blush(ctx, eR[0] - 26, eR[1] + 46, 1.15); blush(ctx, eL[0] + 15, eL[1] + 30, 1.15);
        // she is shaking: beside her shoulders
        shake(ctx, FIG.x + FIG.w + 4, 470, 1); shake(ctx, FIG.x - 4, 520, -1);
        // what she says (short lines now: the top one carries the weight, the bottom one is her tell)
        row(ctx, [[ROW1, 'memeSans', 900, 'text']], 960, 896, 118);
        row(ctx, [[ROW2, 'memeSans', 900, 'text']], 960, 1000, 62);
        // (no ledger line under it: the `// token × …` counter that stood here was a number nobody computed. A
        //  sticker says her line and stops; anything under it has to be a real figure, or it is not there.)
        ctx.fx.glow = 0.3; ctx.fx.scan = 0; ctx.fx.vignette = 0.5; ctx.fx.zoom = 1; ctx.fx.bright = 1.04;
      },
    }],
  };
}
