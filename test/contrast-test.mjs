// WCAG AA contrast check for the colour tokens that ship in www/css/app.css (light and dark).
// Surfaces are translucent glass, so each pair is tested over every backdrop it can sit on (the page base colour and each
// aurora colour, plus a shifted copy for content that blurs through a bar or sheet) and the WORST case must pass.
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
// composite fg (any alpha) over an opaque RGBA background
const over = (fg, bg) => { const [r, g, b, a] = Array.isArray(fg) ? fg : toRGBA(fg); const B = Array.isArray(bg) ? bg : toRGBA(bg); return [r * a + B[0] * (1 - a), g * a + B[1] * (1 - a), b * a + B[2] * (1 - a), 1]; };
const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };

let pass = 0, fail = 0;
for (const [mode, V] of [['light', light], ['dark', dark]]) {
  const c = k => { if (!V[k]) throw new Error('missing token --' + k); return V[k]; };
  const rgba = k => toRGBA(c(k));
  // everything behind the glass: the aurora blobs at full strength, the base colour, and the extremes
  const pageBackdrops = [rgba('bg'), rgba('aurora-a'), rgba('aurora-b'), rgba('aurora-c'), rgba('aurora-d')];
  // content that blurs through a bar or sheet shifts the backdrop: dark text in light mode, bright controls in dark mode
  const shift = mode === 'light' ? [0, 0, 0, .3] : [255, 255, 255, .25];
  const withShift = list => list.flatMap(b => [b, over(shift, b)]);
  const behindSheet = withShift(pageBackdrops.map(b => over(rgba('scrim'), b)));
  const behindBars = withShift(pageBackdrops);

  // surface(backdrop) -> opaque RGBA the glass looks like over that backdrop
  const surfaces = {
    'page (text on the aurora)': { over: pageBackdrops, make: b => b },
    'card': { over: pageBackdrops, make: b => over(rgba('card'), b) },
    'sheet': { over: behindSheet, make: b => over(rgba('sheet'), b) },
    'sheet card': { over: behindSheet, make: b => over(rgba('sheet-card'), over(rgba('sheet'), b)) },
    'bars (nav bar, tab bar)': { over: behindBars, make: b => over(rgba('glass'), b) },
  };
  // run a check across all backdrops of a surface and report the worst one
  const check = (name, surface, fg, min, bgAdjust) => {
    const S = surfaces[surface];
    let worst = Infinity;
    for (const b of S.over) {
      let bg = S.make(b); if (bgAdjust) bg = bgAdjust(bg);
      const f = typeof fg === 'function' ? fg(bg) : toRGBA(fg);
      worst = Math.min(worst, ratio(over(f, bg), bg));
    }
    if (worst >= min) { pass++; console.log(`  PASS [${mode}] ${name}  ${worst.toFixed(2)}:1 worst case (need ${min})`); }
    else { fail++; console.log(`  FAIL [${mode}] ${name}  ${worst.toFixed(2)}:1 worst case (need ${min})`); }
  };
  const tint = (t, bg) => over(rgba(t), bg);

  for (const sn of Object.keys(surfaces)) {
    check(`label on ${sn}`, sn, c('label'), 4.5);
    check(`secondary label on ${sn}`, sn, c('label2'), 4.5);
    check(`accent text on ${sn}`, sn, c('accent'), 4.5);
    check(`green text on ${sn}`, sn, c('green'), 4.5);
    check(`orange text on ${sn}`, sn, c('orange'), 4.5);
    check(`red text on ${sn}`, sn, c('red'), 4.5);
  }
  // tinted pills and cells, which sit on cards
  for (const s of ['green', 'orange', 'red']) {
    const ratioOn = (bg) => ratio(rgba(s), tint(s + '-soft', bg));
    check(`${s} pill text on its tint (over card)`, 'card', c(s), 4.5, bg => tint(s + '-soft', bg));
  }
  // the same pills inside a sheet (orange text on the orange tint over the sheet card, for example)
  for (const s of ['green', 'orange', 'red']) check(`${s} pill text on its tint (over sheet card)`, 'sheet card', c(s), 4.5, bg => tint(s + '-soft', bg));
  // BMI categories: one token each, used by the pill, the scale segment and the legend swatch
  for (const cat of ['under', 'normal', 'over', 'obese']) {
    check(`BMI ${cat} pill text on its tint (over card)`, 'card', c('bmi-' + cat), 4.5, bg => tint('bmi-' + cat + '-soft', bg));
    check(`BMI ${cat} pill text on its tint (over sheet card)`, 'sheet card', c('bmi-' + cat), 4.5, bg => tint('bmi-' + cat + '-soft', bg));
    check(`BMI ${cat} scale segment and swatch against the card`, 'card', c('bmi-' + cat), 3);
    check(`BMI ${cat} scale segment and swatch against the sheet card`, 'sheet card', c('bmi-' + cat), 3);
  }
  // chart tick labels and the dashed target line are drawn in the secondary label colour straight on the card
  check('chart tick labels (secondary label) on the card', 'card', c('label2'), 4.5);
  check('chart tick labels (secondary label) on the sheet card', 'sheet card', c('label2'), 4.5);
  check('dashed target line (secondary label) against the card', 'card', c('label2'), 3);
  check('label on orange calendar cell', 'card', c('label'), 4.5, bg => tint('orange-soft', bg));
  check('accent text on its tint (over card)', 'card', c('accent'), 4.5, bg => tint('accent-soft', bg));
  check('accent text on the selected tab pill', 'bars (nav bar, tab bar)', c('accent'), 4.5, bg => tint('accent-soft', bg));
  check('red destructive text on danger tint', 'card', c('red'), 4.5, bg => tint('red-soft', bg));
  check('label on unselected chip / segment (over page)', 'page (text on the aurora)', c('label'), 4.5, bg => tint('fill', bg));
  check('label on selected segment (glass-hi over track)', 'page (text on the aurora)', c('label'), 4.5, bg => over(rgba('glass-hi'), tint('fill', bg)));
  check('secondary label on empty calendar cell (over card)', 'card', c('label2'), 4.5, bg => tint('fill', bg));
  // solid colours
  const solid = (name, fg, bg, min) => { const r = ratio(toRGBA(fg), toRGBA(bg)); if (r >= min) { pass++; console.log(`  PASS [${mode}] ${name}  ${r.toFixed(2)}:1 (need ${min})`); } else { fail++; console.log(`  FAIL [${mode}] ${name}  ${r.toFixed(2)}:1 (need ${min})`); } };
  solid('white on accent buttons / selected chips (top of the gradient)', c('on-accent'), c('accent-fill'), 4.5);
  solid('white on accent buttons (bottom of the gradient)', c('on-accent'), c('accent-fill-lo'), 4.5);
  solid('text on the red swipe-to-remove button (on-red on red)', c('on-red'), c('red'), 4.5);
  solid('text on green calendar cell', c('on-green'), c('green'), 4.5);
  solid('label on the opaque fallback surface', c('label'), c('solid'), 4.5);
  solid('secondary label on the opaque fallback surface', c('label2'), c('solid'), 4.5);
  solid('accent text on the opaque fallback surface', c('accent'), c('solid'), 4.5);
  for (const bgk of [...[0, 1, 2, 3].map(i => 'aurora-' + 'abcd'[i]), 'bg']) {
    // toast sits above everything; its text must hold on every backdrop
    const t = over(rgba('toast'), rgba(bgk));
    for (const [n, fgk] of [['toast text', 'toast-label'], ['toast action', 'toast-action']]) {
      const r = ratio(rgba(fgk), t);
      if (r >= 4.5) pass++; else { fail++; console.log(`  FAIL [${mode}] ${n} over ${bgk}  ${r.toFixed(2)}:1`); }
    }
  }
  solid('white knob on the switch (on state)', '#FFFFFF', c('switch-on'), 3);
  solid('white knob on the switch (off state)', '#FFFFFF', c('switch-off'), 3);
  console.log(`  PASS-or-checked [${mode}] toast text and action over every backdrop`);
  // graphics and controls (3:1) against the glass card
  for (const s of ['switch-on', 'switch-off', 'green', 'orange', 'red']) check(`${s} against card (progress bars, rings, switches, cells)`, 'card', c(s), 3, undefined);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
