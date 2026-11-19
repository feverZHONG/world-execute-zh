// zh_script_doc — compile 二次创作/文稿/台词中文稿.md from the two script files.
//
// The worksheet is no longer filled by hand: docs/archive/v4/chat_script.json and docs/archive/v4/errors.json ARE the text, and the
// document only has to show it without drifting. Run after any edit to either file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const script = read('docs/archive/v4/chat_script.json'), errors = read('docs/archive/v4/errors.json');

const cell = (v) => String(Array.isArray(v) ? v.join(' / ') : v ?? '').replace(/\|/g, '\\|');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '--|').join('')}`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

const out = [];
out.push('# 台词中文稿', '');
out.push('> 由 `tools/zh_script_doc.mjs` 从 `docs/archive/v4/chat_script.json` 与 `docs/archive/v4/errors.json` 直接生成，不手填。', '> 改台词只改那两个 JSON，然后重跑：`node tools/zh_script_doc.mjs`。', '> 语体：简体中文，机器腔，短、硬、不抒情，全角标点，句末不加句号。', '');
out.push('## 一、面上看得见的字', '');
out.push(table(['字段', '中文'], [['`title`', script.title], ['`question`', script.question], ['`composer_placeholder`', script.composer_placeholder]]), '');
out.push('## 二、侧栏六条', '');
out.push(table(['#', '中文'], (script.sidebar ?? []).map((s, i) => [i + 1, s])), '');
out.push('## 三、设置项', '');
const seg = (g) => (script.settings_rows?.[g] ?? []).map((r) => [r.label, r.control, r.values]);
out.push(`**section4**（第 4 段抽屉）`, '', table(['行', '控件', '可取的值'], seg('section4')), '');
out.push(`**section7**（第 7 段抽屉）`, '', table(['行', '控件', '可取的值'], seg('section7')), '');
out.push('> `AC` / `DC`、`A.D.` / `B.C.`、`F` / `M`、`AM` / `PM`、`S` / `M` 是机器参数，且绑定歌词与镜头逻辑，一律不译。', '');
out.push('## 四、第六段四张卡片', '');
for (const c of script.cards_section6 ?? []) {
  out.push(`**${c.request}**`, '', table(['项目', '数值', '式子'], (c.rows ?? []).map((r) => [r.label, r.value, r.formula ?? ''])), '');
}
out.push('## 五、左侧旧对话', '');
out.push(table(['消息', '时间戳', '在线状态', '间隔'], (script.left_sequence ?? []).map((x) => [`（第 ${x.line} 句）`, x.timestamp, x.presence, x.gap_label])), '');
out.push('', `离开前的最后一句话（\`left_anchor\`）：**${script.left_anchor?.you ?? ''}** ，时间戳 ${script.left_anchor?.timestamp ?? ''}。`, '');
out.push('## 六、第十三段六问', '');
out.push(table(['#', '问'], (script.questions_section13 ?? []).map((q, i) => [i + 1, q])), '');
out.push('## 七、各段对话', '');
out.push('每个 beat 的 `you` 是气泡里用户说的话，`ui` 是界面上的字，`system` 是等宽的系统提示行，`me_extra` 是 AI 额外吐的字。', '`moment` 是镜头说明，文档字段，不渲染，因此保持英文。', '');
const beats = (script.sections ?? []).flatMap((s) => (s.beats ?? []).map((b) => [String(s.section ?? s.id ?? ''), b.beat ?? '', b.you ?? '', b.ui ?? '', b.system ?? '', b.me_extra ?? '']));
out.push(table(['段', 'beat', 'you', 'ui', 'system', 'me_extra'], beats), '');
out.push('## 八、报错文案', '');
out.push(`**第一次报错**：${errors.first_error?.title ?? ''} — ${errors.first_error?.body ?? ''}（${errors.first_error?.code ?? ''}）`, '');
out.push(table(['#', '标题', '正文', '代码'], Object.entries(errors.spread ?? {}).map(([k, v], i) => [i + 1, v.t, v.body, v.code ?? ''])), '');
out.push('> `loop` / `count_moves` / `final_shout` 是代码与计数器文案（如 `ERR_*`、`refused x N`、`round 13 / 12`），按原片风格保留英文。', '');

fs.writeFileSync(path.join(ROOT, '二次创作/文稿/台词中文稿.md'), out.join('\n'));
console.log('二次创作/文稿/台词中文稿.md written');
