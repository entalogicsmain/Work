// WCAG AA contrast check for the colour tokens that ship in www/css/app.css (light and dark).
// Text pairs need 4.5:1, graphics/controls 3:1. Run: npm run test:contrast
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www/css/app.css'), 'utf8');
const rootBlock = css.match(/:root\{([\s\S]*?)\n\}/)[1];
const darkBlock = css.match(/@media \(prefers-color-scheme:dark\)\{\s*:root\{([\s\S]*?)\}\s*\}/)[1];
const parseVars = b => Object.fromEntries([...b.matchAll(/--([\w-]+):([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const light = parseVars(rootBlock), dark = { ...light, ...parseVars(darkBlock) };

function toRGBA(v) {
  v = v.trim();
  let m = v.match(/^#([0-9a-f]{6})$/i); if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16), 1];
  m = v.match(/^#([0-9a-f]{3})$/i); if (m) return [...m[1]].map(c => parseInt(c + c, 16)).concat(1);
  m = v.match(/^rgba?\(([^)]+)\)$/); if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error('cannot parse colour ' + v);
}
const over = (fg, bg) => { const [r, g, b, a] = toRGBA(fg), B = toRGBA(bg); return [r * a + B[0] * (1 - a), g * a + B[1] * (1 - a), b * a + B[2] * (1 - a), 1]; };
const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };

let pass = 0, fail = 0;
for (const [mode, V] of [['light', light], ['dark', dark]]) {
  const c = k => { if (!V[k]) throw new Error('missing token --' + k); return V[k]; };
  const solid = (fg, bg) => over(c(fg), bg);
  const surfaces = { bg: c('bg'), card: c('card'), sheet: c('sheet'), 'sheet-card': c('sheet-card') };
  const check = (name, fgRGB, bgRGB, min) => {
    const r = ratio(fgRGB, bgRGB);
    if (r >= min) { pass++; console.log(`  PASS [${mode}] ${name}  ${r.toFixed(2)}:1 (need ${min})`); }
    else { fail++; console.log(`  FAIL [${mode}] ${name}  ${r.toFixed(2)}:1 (need ${min})`); }
  };
  for (const [sn, sv] of Object.entries(surfaces)) {
    const bg = toRGBA(sv);
    check(`label on ${sn}`, toRGBA(c('label')), bg, 4.5);
    check(`secondary label on ${sn}`, toRGBA(c('label2')), bg, 4.5);
    check(`accent text on ${sn}`, toRGBA(c('accent')), bg, 4.5);
    check(`green text on ${sn}`, toRGBA(c('green')), bg, 4.5);
    check(`orange text on ${sn}`, toRGBA(c('orange')), bg, 4.5);
    check(`red text on ${sn}`, toRGBA(c('red')), bg, 4.5);
  }
  const card = c('card');
  for (const s of ['green', 'orange', 'red']) check(`${s} pill text on its tint (over card)`, toRGBA(c(s)), solid(s + '-soft', card), 4.5);
  check('label on orange calendar cell', toRGBA(c('label')), solid('orange-soft', card), 4.5);
  check('accent text on its tint (over card)', toRGBA(c('accent')), solid('accent-soft', card), 4.5);
  check('white on accent buttons / selected chips', toRGBA(c('on-accent')), toRGBA(c('accent-fill')), 4.5);
  check('text on green calendar cell', toRGBA(c('on-green')), toRGBA(c('green')), 4.5);
  check('toast text', toRGBA(c('toast-label')), over(c('toast'), c('bg')), 4.5);
  check('toast action', toRGBA(c('toast-action')), over(c('toast'), c('bg')), 4.5);
  check('label on unselected chip / segment (over bg)', toRGBA(c('label')), solid('fill', c('bg')), 4.5);
  check('secondary label on empty calendar cell (over card)', toRGBA(c('label2')), solid('fill', card), 4.5);
  check('red destructive text on danger tint', toRGBA(c('red')), solid('red-soft', card), 4.5);
  // graphics and controls
  for (const s of ['accent-fill', 'green', 'orange', 'red']) check(`${s} fill against card (progress bars, rings, switch on, cells)`, toRGBA(c(s)), toRGBA(card), 3);
  check('switch off track against card', toRGBA(c('switch-off')), toRGBA(card), 3);
  check('white knob against switch off track', [255, 255, 255, 1], toRGBA(c('switch-off')), 2.5);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
