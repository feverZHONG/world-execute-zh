// zh_charset — collect every CJK character the film can draw, and write it into config.json's fonts.cjk text lists.
//
// Why: draw.js preloads a CJK role by `text` and refuses any glyph outside it (a silent system-font fallback would make
// the export differ machine to machine). The Latin roles fall back to their CJK role, so both zhSans and zhSerif must
// carry the whole set.
//
// Sources scanned: config.json (all strings except the font text lists themselves), docs/v4/chat_script.json,
// docs/v4/errors.json, every file under src/ and data/. Comments are NOT stripped on purpose: an extra glyph costs a
// few bytes in a woff2 slice, a missed one costs a broken frame.
//
//   node tools/zh_charset.mjs            # write the lists back into config.json
//   node tools/zh_charset.mjs --check    # only report what would change (exit 1 when it differs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/** CJK ideographs + CJK punctuation + fullwidth forms: everything a Chinese line can use. */
const isCJK = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xff6f) || (c >= 0xfe10 && c <= 0xfe19);
};

const files = ['docs/v4/chat_script.json', 'docs/v4/errors.json', 'docs/v4/lyrics.json'];
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((d) => {
  const rel = path.join(dir, d.name);
  if (d.isDirectory()) return walk(rel);
  if (/\.(js|mjs|json)$/.test(d.name)) files.push(rel);
});
// src = what the film draws; config + docs/v4 = the text it draws; data = lyric timing (English, scanned for safety).
// tools/ is deliberately left out: its Chinese is doc headings for the generator's own output, never a frame.
for (const dir of ['src', 'data']) if (fs.existsSync(path.join(ROOT, dir))) walk(dir);
for (const f of ['config.json']) if (fs.existsSync(path.join(ROOT, f))) files.push(f);

const text = files.filter((f) => fs.existsSync(path.join(ROOT, f)))
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

const chars = [...new Set([...text].filter(isCJK))].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
const list = chars.join('');

const cfgPath = path.join(ROOT, 'config.json');
const raw = fs.readFileSync(cfgPath, 'utf8');
/** Replace the `text` of one cjk entry, leaving every other byte of config.json alone. */
const rewrite = (src, role, value) => {
  const at = src.indexOf(`"role": "${role}"`);
  if (at < 0) throw new Error(`config.json: no fonts.cjk entry "${role}"`);
  const m = /"text":\s*"((?:[^"\\]|\\.)*)"/.exec(src.slice(at));
  if (!m) throw new Error(`config.json: entry "${role}" has no text field`);
  const start = at + m.index, end = start + m[0].length;
  return src.slice(0, start) + `"text": ${JSON.stringify(value)}` + src.slice(end);
};

const old = JSON.parse(raw).fonts.cjk.filter((c) => ['zhSans', 'zhSerif'].includes(c.role)).map((c) => c.text);
const same = old.every((s) => s === list);
console.log(`scanned ${files.length} files; ${chars.length} CJK characters`);
console.log(`zhSans/zhSerif text ${same ? 'already current' : CHECK ? 'DIFFERS' : 'updated'}`);
if (!same) {
  if (CHECK) { console.log(old.map((s, i) => `  [${i}] ${[...new Set([...s, ...list])].filter(isCJK).length} chars needed vs ${[...s].length} listed`).join('\n')); process.exitCode = 1; }
  else {
    let out = rewrite(raw, 'zhSans', list);
    out = rewrite(out, 'zhSerif', list);
    fs.writeFileSync(cfgPath, out);
    console.log('config.json written');
  }
}
const sample = chars.slice(0, 40).join('');
console.log(`first chars: ${sample}${chars.length > 40 ? ' …' : ''}`);
