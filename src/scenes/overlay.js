// What the film says about itself, outside the conversation:
//   - the photosensitivity warning: (v4) a full page BEFORE the song, at negative song time (prerollShot), and, as in
//     v3, a small system toast during the calm opening seconds
//   - the credit note on black after the power-down
// The toast and the credits live on the overlay layer, above every transition; v3 has no debug HUD (no frame
// counter, BPM, line counter, meters) and neither has v4.
import { room, toast } from '../components/chat.js';
import { clamp, easeOut, prog } from '../engine/util.js';

/** m:ss of a film time (song time + pre-roll), for what viewers are told. */
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** The stretch the warning names, in FILM time, as text: computed from config, never typed in. */
export const flashRangeText = (cfg) => { const pre = cfg.safety.preroll ?? 0, [a, b] = cfg.safety.flashRange ?? [148.04, 192.34]; return `${mmss(a + pre)} – ${mmss(b + pre)}`; };

/**
 * The warning page (song time -preroll … 0, silent). The client is not switched on yet, so this is not a piece of
 * chat interface: it is a compiler's warning, mono, in the greys of the `off` state. No orange: the first colour of
 * the film is still the spark at 15.11 s. The page must not flash itself: it fades in over 0.4 s, its lines arrive
 * one by one, the countdown changes one digit a second, and it is gone 0.4 s before the song, leaving exactly
 * the dark room the boot shot opens on.
 */
export function prerollShot(env) {
  const { cfg, lyrics } = env, PRE = cfg.safety.preroll ?? 0;
  if (!(PRE > 0)) return null;
  const T0 = -PRE, LH = 70, X = 300, SIZE = 44;
  const ZH = cfg.safety.warningLine ?? '';
  return {
    id: 'preroll', at: T0, lines: null, palette: 'off', hud: 0,
    layout: 'a compiler warning, mono, left-aligned on the dark room; a three-second countdown under it',
    moment: 'Before the song and before the client is switched on: a compiler-style warning that the film contains flashing images and strong light, with the time range, then a countdown from three. It clears to the dark room the boot begins in.',
    render(ctx, t) {
      room(ctx, { light: [960, 540], dim: 0.85, motif: 0 });          // exactly the first frame of boot-power: no step at 0
      const page = clamp((t - T0) / 0.4) * (1 - prog(t, -0.8, -0.4));
      if (page <= 0.003) return;
      const cw = ctx.cw(SIZE), o = { size: SIZE, font: 'mono' };
      const GUT = ctx.measure('   =', o) + 8;                          // gutter column, measured so a Chinese line never shifts it
      const line = (i) => { const a = easeOut(prog(t, T0 + 0.4 + i * 0.25, T0 + 0.58 + i * 0.25)); return { a: a * page, y: 300 + i * LH + (1 - a) * 10 }; };
      // $ check "<title>"
      let l = line(0);
      ctx.text('$ ', X, l.y, { ...o, color: 'mute', alpha: l.a });
      ctx.text(`校验 "${lyrics.lines[11].text}"`, X + 2 * cw, l.y, { ...o, color: 'sub', alpha: l.a });
      // 警告：…   (the word in an inverse block: cream ground, dark letters)
      l = line(2);
      const wWord = ctx.measure('警告', { ...o, weight: 800 });
      ctx.rect(X - 10, l.y - SIZE * 0.86, wWord + 22, SIZE * 1.16, { fill: true, color: 'text', alpha: l.a });
      ctx.text('警告', X, l.y, { ...o, weight: 800, color: 'panel', alpha: l.a });
      ctx.text('：本片含有闪烁画面', X + wWord + 12, l.y, { ...o, weight: 700, color: 'text', alpha: l.a });
      // the gutter lines
      l = line(3);
      ctx.text('  -->', X, l.y, { ...o, color: 'mute', alpha: l.a });
      ctx.text(flashRangeText(cfg), X + GUT, l.y, { ...o, weight: 700, color: 'text', alpha: l.a });
      l = line(4);
      ctx.text('   |', X, l.y, { ...o, color: 'mute', alpha: l.a });
      ctx.text('快速、高反差的剪切与强光', X + GUT, l.y, { ...o, color: 'sub', alpha: l.a });
      l = line(5);
      ctx.text('   =', X, l.y, { ...o, color: 'mute', alpha: l.a });
      ctx.text('注意：可能影响光敏感观众', X + GUT, l.y, { ...o, color: 'sub', alpha: l.a });
      l = line(6);
      ctx.text('   =', X, l.y, { ...o, color: 'mute', alpha: l.a });
      ctx.text(ZH, X + GUT, l.y - 1, { size: SIZE * 0.95, weight: 500, color: 'sub', alpha: l.a });
      // 倒数 3 … 2 … 1: only the digit changes
      if (t >= -3) {
        const a = easeOut(prog(t, -3, -2.82)) * page, y = 300 + 8 * LH;
        ctx.text('倒数', X, y, { ...o, color: 'mute', alpha: a });
        ctx.text(String(clamp(Math.ceil(-t), 1, 3)), X + GUT, y, { ...o, weight: 700, color: 'text', alpha: a });
      }
      // a hairline down the gutter ties the block together (drawn once the warning line is there)
      const g = line(2).a;
      ctx.line(X - 34, 300 + 2 * LH - SIZE * 0.86, X - 34, 300 + 6 * LH + SIZE * 0.3, { color: 'line', width: 3, alpha: g });
    },
  };
}

export function overlayScene({ cfg, features }) {
  const T_OFF = features.barTime(112);          // the music stops here
  const NOTE = [
    // literal greys: by now the palette is `dead`, and this note must stay readable
    ['非官方同人作品。与 Anthropic 及 Mili 无隶属关系，亦未获其认可。', '#b8b6ae'],
    ['音乐：《world.execute(me);》，Mili。片中角色名为高奈利亚。', '#7d7b73'],
    // the plates are Live2D renders out of the game's model library, not drawings of ours: say where they come from
    ['角色图像取自《双生视界》Live2D 素材，版权归原权利人。', '#7d7b73'],
    ['界面与编排由本片作者用代码完成。', '#7d7b73'],
  ];
  return {
    id: 'overlay', overlay: true, z: 100, start: -1e9, end: 1e9,
    render(ctx, t) {
      const wEnd = cfg.safety.warningSeconds;
      if (t > 0.9 && t < wEnd) {
        toast(ctx, { x: 960 - 300, y: 24, w: 600, h: 58 }, {
          title: '本片含有闪烁画面与强光', tone: 'info', icon: '!',
          k: prog(t, 0.9, 1.3), out: easeOut(prog(t, wEnd - 0.5, wEnd)),
        });
      }
      const a = prog(t, T_OFF + 1.6, T_OFF + 2.4) * (1 - prog(t, features.duration - 0.6, features.duration - 0.1));
      if (a > 0) NOTE.forEach(([s, col], i) => ctx.text(s, 960, 502 + i * 46, { size: 26, color: col, alpha: a, align: 'center', weight: i ? 400 : 500 }));
    },
  };
}
