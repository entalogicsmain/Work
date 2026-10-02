// Accessibility and glass-performance checks: inert backgrounds behind sheets, headings and roles, radio groups, the calendar,
// swipe rows, toast and save banners, chart semantics, BMI colours, focus rings, simple look, and 200% text on a small phone.
// Run: node test/a11y-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { serve, launch, counter, newPage, tab, gear, ready, sheetGone, actionChoose, ymd } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const CSS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www/css/app.css'), 'utf8');

const settings = { habits: [
  { id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }, { id: 'walk', name: 'Brisk walk', unit: 'min', target: 30 }, { id: 'pushups', name: 'Pushups', unit: 'reps', target: 30 },
  { id: 'pullups', name: 'Pull-ups', unit: 'reps', target: 5 }, { id: 'squats', name: 'Squats', unit: 'reps', target: 30 }, { id: 'plank', name: 'Plank', unit: 'sec', target: 60 },
  { id: 'water', name: 'Water', unit: 'litres', target: 2.5 }, { id: 'sleep', name: 'Sleep', unit: 'hours', target: 7 }],
  rules: [{ id: 'nofried', name: 'No fried food' }, { id: 'nosugar', name: 'No sugar in tea' }] };
const days = {}; const now = Date.now();
for (let i = 0; i < 40; i++) { const k = ymd(new Date(now - i * 864e5)); const q = .45 + .5 * Math.abs(Math.sin(i * 1.7));
  days[k] = { vals: { steps: Math.round(9000 * q), walk: Math.round(35 * q), pushups: Math.round(34 * q), pullups: Math.round(6 * q), squats: Math.round(32 * q), plank: Math.round(70 * q), water: Math.round(2.8 * q * 10) / 10, sleep: Math.round(8 * q * 10) / 10 },
    rules: { nofried: q > .55, nosugar: q > .5 }, weight: Math.round((89 - i * .07) * 10) / 10, waist: null, note: '', date: k, updatedAt: now - i * 864e5 }; }
const DATA = { version: 1, settings, days };

async function open(w, h, scheme, opts = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme || 'light', hasTouch: w < 900 });
  // a fast phone by default (this box has few cores, which would switch the lite look on by itself)
  await ctx.addInitScript(([lite]) => { if (!lite) Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 }); }, [!!opts.lite]);
  await ctx.addInitScript(([d, empty, onb]) => { if (!localStorage.getItem('__s')) { localStorage.setItem('__s', '1'); if (!empty) localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(d)); if (!onb) localStorage.setItem('CapacitorStorage.comeback_onboarded', '1'); } }, [DATA, !!opts.empty, !!opts.onboarding]);
  const pg = await newPage(ctx, errs);
  await pg.goto(base); if (!opts.onboarding) await ready(pg); else await pg.waitForSelector('.onb'); await pg.waitForTimeout(500);
  if (!opts.empty && !opts.onboarding) await pg.evaluate(() => { if (settings.body.heightCm == null) { settings.body.heightCm = 178; renderToday(true); renderProgress(); } });
  return { ctx, pg, errs };
}
const inertState = pg => pg.evaluate(() => ['#screens', '.tabbar', '.navbar'].map(s => document.querySelector(s).hasAttribute('inert')));

/* ---------- CSS rules that cannot be seen from a screenshot ---------- */
{
  const blurSel = /(^|\})\s*([^{}@]+)\{[^}]*backdrop-filter:\s*saturate[^}]*blur/g;
  const blurred = new Set(); let m;
  while ((m = blurSel.exec(CSS))) m[2].split(',').forEach(x => blurred.add(x.trim()));
  const allowed = ['.navbar::before', '.tabbar-in', '.sheet', '.asheet .ag', '.toast', '.ptr-in'];
  ok([...blurred].every(x => allowed.includes(x)), 'only bars, sheets, the toast and the refresh pill use backdrop blur in the stylesheet', [...blurred].filter(x => !allowed.includes(x)));
  ok(/@media \(prefers-contrast:more\)\{\s*:root\{[^}]*--card:var\(--solid\)[^}]*--glass-border:var\(--label2\)/.test(CSS), 'more contrast: cards turn solid and edges strong');
  ok(/@media \(forced-colors:active\)[\s\S]*\.switch[\s\S]*\.ring[\s\S]*\.bar/.test(CSS), 'forced colours: switches, rings and bars have their own rules');
  ok(/\.toast:not\(\.show\)|visibility:hidden/.test(CSS) && /\.toast\{[^}]*visibility:hidden/.test(CSS), 'a hidden toast is visibility:hidden (its Undo leaves the tab order)');
  ok(/\.field \.box:focus-within\{outline:2px solid var\(--accent\)/.test(CSS), 'the field box carries the focus ring');
}

/* ---------- glass performance, light look ---------- */
{
  const { ctx, pg, errs } = await open(412, 915, 'light', {});
  const f = await pg.evaluate(() => {
    const bf = e => { const c = getComputedStyle(e); return c.backdropFilter || c.webkitBackdropFilter || 'none'; };
    const q = s => document.querySelector(s);
    return { ring: bf(q('.ringcard')), hcard: bf(q('.hcard')), stat: bf(q('#progBody .stat')), group: bf(q('#p-setup .group')), seg: bf(q('#seg')), tab: bf(q('.tabbar-in')), nav: getComputedStyle(q('.navbar'), '::before').backdropFilter,
      scrim: null };
  });
  ok(f.ring === 'none' && f.hcard === 'none' && f.stat === 'none' && f.group === 'none' && f.seg === 'none', 'cards, groups, stats and segments have no backdrop blur', f);
  ok(/blur/.test(f.tab) && /blur/.test(f.nav), 'the tab bar and the top bar keep their blur', f);
  await pg.click('#sections .hcard[data-id="pushups"] .hc-main'); await pg.waitForSelector('.sheet-wrap.in'); await pg.waitForTimeout(400);
  const s = await pg.evaluate(() => ({ sheet: getComputedStyle(document.querySelector('.sheet')).backdropFilter, scrim: getComputedStyle(document.querySelector('.scrim')).backdropFilter }));
  ok(/blur/.test(s.sheet) && s.scrim === 'none', 'sheets blur, the scrim is only a tint', s);

  // ---------- sheets: inert background, labelled dialog, stacked layers ----------
  ok((await inertState(pg)).every(Boolean), 'with a sheet open, the screens, the tab bar and the top bar are inert', await inertState(pg));
  const lab = await pg.evaluate(() => { const sh = document.querySelector('.sheet'), id = sh.getAttribute('aria-labelledby'), el = id && document.getElementById(id); return { id, tag: el && el.tagName, text: el && el.textContent, label: sh.getAttribute('aria-label') }; });
  ok(lab.tag === 'H2' && lab.text === 'Pushups' && !lab.label, 'the sheet is named by its own heading (aria-labelledby)', lab);
  // focus lands inside the sheet and Tab stays in it
  const inSheet = async () => pg.evaluate(() => !!document.activeElement.closest('.sheet,.asheet'));
  ok(await inSheet(), 'focus moves into the sheet');
  await pg.keyboard.press('Tab'); await pg.keyboard.press('Tab');
  ok(await inSheet(), 'Tab stays inside the sheet');
  // stack an action sheet on a sheet
  await pg.evaluate(() => { actionSheet({ title: 'Test', message: 'Stacked', actions: [{ label: 'Go', value: 'go' }] }); }); await pg.waitForSelector('.asheet'); await pg.waitForTimeout(300);
  const stacked = await pg.evaluate(() => ({ sheetInert: document.querySelector('.sheet-wrap:first-child').hasAttribute('inert'), bg: ['#screens', '.tabbar', '.navbar'].map(s => document.querySelector(s).hasAttribute('inert')), lab: document.querySelector('.asheet').getAttribute('aria-labelledby') }));
  ok(stacked.sheetInert && stacked.bg.every(Boolean) && !!stacked.lab, 'a stacked action sheet makes the sheet under it inert and is labelled', stacked);
  await pg.click('.asheet .ab.cancel'); await pg.waitForTimeout(450);
  const after1 = await pg.evaluate(() => ({ sheetInert: document.querySelector('.sheet-wrap').hasAttribute('inert'), bg: ['#screens', '.tabbar', '.navbar'].map(s => document.querySelector(s).hasAttribute('inert')) }));
  ok(!after1.sheetInert && after1.bg.every(Boolean), 'closing the top layer frees the sheet below and keeps the page inert', after1);
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg); await pg.waitForTimeout(100);
  ok((await inertState(pg)).every(x => !x), 'after the last layer closes nothing stays inert', await inertState(pg));
  ok(await pg.evaluate(() => document.activeElement && document.activeElement.closest('.hc-main') !== null), 'focus returns to the card that opened the sheet');

  // ---------- toast ----------
  const t0 = await pg.evaluate(() => { const t = document.getElementById('toast'), u = document.getElementById('toastUndo'); return { vis: getComputedStyle(t).visibility, undoVis: getComputedStyle(u).visibility }; });
  ok(t0.vis === 'hidden' && t0.undoVis === 'hidden', 'an idle toast and its Undo button are hidden from keyboard and screen readers', t0);
  await pg.evaluate(() => toast('A short message', { undo: () => {} }));
  await pg.waitForTimeout(450);
  const t1 = await pg.evaluate(() => ({ vis: getComputedStyle(document.getElementById('toast')).visibility, undoVis: getComputedStyle(document.getElementById('toastUndo')).visibility }));
  ok(t1.vis === 'visible' && t1.undoVis === 'visible', 'a shown toast is visible', t1);
  // durations: spy on setTimeout
  const dur = await pg.evaluate(() => { const out = []; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => { out.push(ms); return st(f, ms, ...a); };
    toast('x'); const short = out.pop(); toast('x'.repeat(100)); const long = out.pop(); toast('x', { undo: () => {} }); const undoShort = out.pop(); toast('x'.repeat(200), { undo: () => {} }); const undoLong = out.pop(); window.setTimeout = st; return { short, long, undoShort, undoLong }; });
  ok(dur.short === 4000 && dur.long === 6000 && dur.undoShort === 8000 && dur.undoLong === 12000, 'toast stays max(4s, 60ms per character), at least 8s with Undo', dur);

  // ---------- saved indicator + save error banner ----------
  const sv = await pg.evaluate(() => { const el = document.getElementById('savedInd'); const before = document.getElementById('savedTxt').textContent; flashSaved(); return { role: el.getAttribute('role'), before, after: document.getElementById('savedTxt').textContent }; });
  ok(sv.role === 'status' && sv.before === '' && sv.after === 'Saved', 'the Saved indicator is a status region whose text appears when it saves', sv);
  const se = await pg.evaluate(() => { const b = document.getElementById('saveError'); const h0 = b.hidden; showSaveError(true); const on = !b.hidden && getComputedStyle(b).display !== 'none'; showSaveError(false); return { h0, on, off: b.hidden, role: b.getAttribute('role') }; });
  ok(se.h0 && se.on && se.off && se.role === 'alert', 'the persistent save-error banner shows and clears with showSaveError()', se);
  await ctx.close();
  ok(errs.length === 0, 'no page errors (light)', errs);
}

/* ---------- save failure raises the banner, success clears it ---------- */
{
  const { ctx, pg, errs } = await open(412, 915, 'light', {});
  await pg.evaluate(() => { window.__realPersist = store.persist; store.persist = async () => { throw new Error('disk full'); }; });
  await pg.click('#sections .hcard[data-id="pushups"] .hc-main'); await pg.waitForSelector('.keypad');
  await pg.click('.keypad .key[aria-label="7"]'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  await pg.waitForFunction(() => !document.getElementById('saveError').hidden, null, { timeout: 4000 });
  ok(true, 'a failed save shows the banner');
  await pg.evaluate(() => { store.persist = window.__realPersist; });
  await pg.click('#saveRetry'); await pg.waitForFunction(() => document.getElementById('saveError').hidden, null, { timeout: 5000 });
  ok(true, 'retrying clears the banner once the save works');
  await ctx.close();
}

/* ---------- headings and roles ---------- */
{
  const { ctx, pg, errs } = await open(412, 915, 'light', {});
  // Today: the Body heading is not inside a button
  const body = await pg.evaluate(() => { const h2 = [...document.querySelectorAll('#sections h2.tsec-title')].find(x => /Body/.test(x.textContent)); const btn = h2 && h2.querySelector('button.tsec-toggle'); return { h2: !!h2, nested: !!document.querySelector('button h2, button h1, button h3'), inside: !!btn, hOutside: h2 && !h2.closest('button') }; });
  ok(body.h2 && !body.nested && body.hOutside, 'Today: the Body heading wraps its toggle button, never the other way round', body);
  ok(['true', 'false'].includes(await pg.$eval('#sections .tsec[data-sec="body"] .tsec-toggle', e => e.getAttribute('aria-expanded'))), 'Body toggle still has aria-expanded');
  // Plan and Settings: group heads are headings
  for (const [name, go] of [['Plan', () => tab(pg, 'setup')], ['Settings', () => gear(pg)]]) {
    await go(); await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => { const heads = [...document.querySelectorAll('.screen.on .group-head')].filter(e => e.offsetParent !== null); return { n: heads.length, bad: heads.filter(e => { const x = e.querySelector('[role=heading][aria-level="2"]') || e.querySelector('h2'); return !x || !x.textContent.trim(); }).map(e => e.textContent.trim()) }; });
    ok(r.n > 2 && r.bad.length === 0, `${name}: every group head is a level-2 heading`, r);
  }
  await tab(pg, 'setup'); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => { const h = document.querySelector('#p-setup .group-head [role=heading]'); const cs = getComputedStyle(h); return cs.textTransform === 'uppercase' && parseFloat(cs.fontSize) < 16; }), 'Plan: heading roles keep the small uppercase group-head styling');

  // Plan swipe rows: no role=button inside role=button, handle is a sibling button, swipe-del hidden until open
  const rows = await pg.evaluate(() => { const sw = document.querySelector('#planSections .swipe'); const row = sw.querySelector('.row'), hd = sw.querySelector('.handle'), del = sw.querySelector('.swipe-del');
    return { rowTag: row.tagName, nestedInteractive: !!row.querySelector('button,[role=button],a,input'), handleTag: hd.tagName, handleSibling: hd.parentElement === row.parentElement && !row.contains(hd), delHidden: del.getAttribute('aria-hidden'), delTab: del.tabIndex }; });
  ok(rows.rowTag === 'BUTTON' && !rows.nestedInteractive && rows.handleTag === 'BUTTON' && rows.handleSibling, 'Plan: the row is one button and the reorder handle is a sibling button', rows);
  ok(rows.delHidden === 'true' && rows.delTab === -1, 'Plan: the swipe Remove button is out of reach until the row is open', rows);
  const rb = await (await pg.$('#planSections .swipe[data-id="walk"] .row')).boundingBox();
  await pg.mouse.move(rb.x + rb.width - 30, rb.y + rb.height / 2); await pg.mouse.down(); await pg.mouse.move(rb.x + 60, rb.y + rb.height / 2, { steps: 8 }); await pg.mouse.up(); await pg.waitForTimeout(400);
  const opened = await pg.evaluate(() => { const d = document.querySelector('#planSections .swipe[data-id="walk"] .swipe-del'); return { hid: d.getAttribute('aria-hidden'), tab: d.tabIndex }; });
  ok(opened.hid === null && opened.tab === 0, 'Plan: swiping a row open exposes its Remove button', opened);
  await pg.click('#planSections .swipe[data-id="walk"] .swipe-del'); await actionChoose(pg, 'Cancel').catch(() => {});
  await pg.evaluate(() => closeAllLayers()); await pg.waitForTimeout(450);
  // reorder with the handle still works (keyboard)
  await pg.click('#reorderBtn');
  await pg.focus('#planSections .swipe[data-id="pushups"] .handle'); await pg.keyboard.press('ArrowDown'); await pg.waitForTimeout(900);
  const ord = await pg.$$eval('#planSections .swipe', e => e.map(x => x.dataset.id));
  ok(ord.indexOf('squats') < ord.indexOf('pushups') || ord.indexOf('pullups') < ord.indexOf('pushups'), 'Plan: the handle button still reorders with the arrow keys', ord);
  await pg.click('#reorderBtn');

  // ---------- Progress: radio group, arrow keys, empty-state, calendar, chart semantics ----------
  await tab(pg, 'progress'); await pg.waitForTimeout(500);
  const seg = await pg.evaluate(() => { const g = document.getElementById('seg'); const rs = [...g.querySelectorAll('button')]; return { role: g.getAttribute('role'), roles: rs.map(r => r.getAttribute('role')), checked: rs.map(r => r.getAttribute('aria-checked')), tabs: rs.map(r => r.tabIndex) }; });
  ok(seg.role === 'radiogroup' && seg.roles.every(r => r === 'radio') && seg.checked.join() === 'false,true,false' && seg.tabs.join() === '-1,0,-1', 'Progress: the range selector is a radio group with one tab stop', seg);
  await pg.focus('#seg button[aria-checked="true"]'); await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(400);
  const seg2 = await pg.evaluate(() => ({ checked: [...document.querySelectorAll('#seg button')].map(r => r.getAttribute('aria-checked')).join(), focus: document.activeElement.dataset.range, tabs: [...document.querySelectorAll('#seg button')].map(r => r.tabIndex).join() }));
  ok(seg2.checked === 'false,false,true' && seg2.focus === '90' && seg2.tabs === '-1,-1,0', 'Progress: Right arrow selects and focuses the next range', seg2);
  await pg.keyboard.press('ArrowLeft'); await pg.keyboard.press('ArrowLeft'); await pg.waitForTimeout(300);
  ok((await pg.$eval('#seg button[data-range="7"]', e => e.getAttribute('aria-checked'))) === 'true', 'Progress: Left arrow goes back (week)');
  await pg.click('#seg button[data-range="30"]'); await pg.waitForTimeout(300);
  // selected styling follows aria-checked
  const selBg = await pg.evaluate(() => { const on = document.querySelector('#seg button[aria-checked="true"]'), off = document.querySelector('#seg button[aria-checked="false"]'); return getComputedStyle(on).fontWeight !== getComputedStyle(off).fontWeight; });
  ok(selBg, 'Progress: the selected segment is styled from aria-checked');
  // chart semantics
  const ch = await pg.evaluate(() => ({ canvasHidden: document.getElementById('chart').getAttribute('aria-hidden'), canvasRole: document.getElementById('chart').getAttribute('role'), readoutLive: document.getElementById('readout').getAttribute('aria-live'), summary: document.getElementById('chartSummary').textContent.length, hoursHidden: document.getElementById('chartHours').getAttribute('aria-hidden'), announce: document.getElementById('chartAnnounce').getAttribute('aria-live') }));
  ok(ch.canvasHidden === 'true' && !ch.canvasRole && ch.summary > 20 && ch.hoursHidden === 'true', 'Progress: chart canvases are hidden from assistive tech (the summary text carries the data)', ch);
  ok(!ch.readoutLive && ch.announce === 'polite', 'Progress: the scrub readout is not live; a separate status announces metric and range changes', ch);
  await pg.evaluate(() => { document.getElementById('chartAnnounce').textContent = ''; });
  await pg.click('#seg button[data-range="7"]'); await pg.waitForTimeout(300);
  ok((await pg.textContent('#chartAnnounce')).length > 10, 'Progress: changing the range announces the new summary');
  await pg.evaluate(() => { document.getElementById('chartAnnounce').textContent = ''; });
  const chartBox = await (await pg.$('#chart')).boundingBox();
  await pg.mouse.move(chartBox.x + 60, chartBox.y + 60); await pg.mouse.move(chartBox.x + 150, chartBox.y + 60); await pg.waitForTimeout(200);
  ok((await pg.textContent('#chartAnnounce')) === '', 'Progress: scrubbing the chart does not announce anything');
  await pg.click('#seg button[data-range="30"]'); await pg.waitForTimeout(300);
  // markers and monotone line
  const ds = await pg.evaluate(() => { const c = Chart.getChart('chart'); const d = c.data.datasets[0]; return { pr: d.pointRadius, tension: d.tension, mode: d.cubicInterpolationMode, n: d.data.filter(v => v != null).length }; });
  ok(ds.mode === 'monotone' && ds.tension === 0, 'Progress: the trend line is monotone (no overshoot)', ds);
  await pg.click('#seg button[data-range="7"]'); await pg.waitForTimeout(300);
  const ds7 = await pg.evaluate(() => { const d = Chart.getChart('chart').data.datasets[0]; return { pr: d.pointRadius }; });
  ok(ds7.pr > 0, 'Progress: a week of points gets markers', ds7);
  await pg.click('#seg button[data-range="90"]'); await pg.waitForTimeout(300);
  const ds90 = await pg.evaluate(() => { const d = Chart.getChart('chart').data.datasets[0]; return { pr: d.pointRadius, n: d.data.filter(v => v != null).length }; });
  ok(ds90.n > 20 && ds90.pr === 0, 'Progress: no markers once there are more than 20 points', ds90);
  await pg.click('#seg button[data-range="7"]');
  // target line label
  await pg.click('#chips .chip[data-metric="h:steps"]'); await pg.waitForTimeout(400);
  const leg = await pg.evaluate(() => ({ hidden: document.getElementById('chartLegend').hidden, text: document.getElementById('chartLegend').textContent, ds: Chart.getChart('chart').data.datasets.length }));
  ok(!leg.hidden && /Target 8,000 steps/.test(leg.text) && leg.ds === 2, 'Progress: the dashed target line is labelled "Target 8,000 steps"', leg);
  await pg.click('#chips .chip[data-metric="score"]'); await pg.waitForTimeout(300);
  ok(await pg.$eval('#chartLegend', e => e.hidden), 'Progress: no target label when the metric has no target');
  // calendar: one tab stop, arrow keys
  const heat = await pg.evaluate(() => { const hs = [...document.querySelectorAll('#heat .hc')]; return { n: hs.length, tabbable: hs.filter(h => h.tabIndex === 0).length, role: document.getElementById('heat').getAttribute('role') }; });
  ok(heat.role === 'group' && heat.tabbable === 1 && heat.n >= 7, 'Progress: the calendar is one group with a single tab stop', heat);
  await pg.focus('#heat .hc[tabindex="0"]'); const idx0 = await pg.evaluate(() => [...document.querySelectorAll('#heat .hc')].indexOf(document.activeElement));
  await pg.keyboard.press('ArrowLeft'); const idx1 = await pg.evaluate(() => [...document.querySelectorAll('#heat .hc')].indexOf(document.activeElement));
  ok(idx1 === idx0 - 1 && (await pg.$$eval('#heat .hc[tabindex="0"]', e => e.length)) === 1, 'Progress: arrow keys move through the calendar days', [idx0, idx1]);
  // BMI card + sheet
  await pg.click('#bmiOpen'); await pg.waitForSelector('#bmiSeg'); await pg.waitForTimeout(500);
  const bmi = await pg.evaluate(() => { const g = document.getElementById('bmiSeg'); const cs = n => getComputedStyle(document.querySelector(n)).backgroundColor;
    const cat = [...document.querySelectorAll('#bmiLegend li')].map(li => li.querySelector('.sw').className.split(' ').find(c => c.startsWith('sb-')));
    const swatch = cat.map(c => getComputedStyle(document.querySelector('#bmiLegend .' + c)).backgroundColor), seg = cat.map(c => getComputedStyle(document.querySelector('#scaleBar .' + c)).backgroundColor);
    const pill = document.querySelector('#bmiCat .pill').className;
    return { role: g.getAttribute('role'), radios: [...g.querySelectorAll('button')].map(b => b.getAttribute('role')).join(), canvasHidden: document.getElementById('chartBmi').getAttribute('aria-hidden'), readoutLive: document.getElementById('bmiReadout').getAttribute('aria-live'), swatch, seg, pill, cat, gap: getComputedStyle(document.querySelector('#scaleBar .sb-normal')).boxShadow }; });
  ok(bmi.role === 'radiogroup' && bmi.radios === 'radio,radio,radio' && bmi.canvasHidden === 'true' && !bmi.readoutLive, 'BMI sheet: range selector is a radio group, canvas hidden, scrub readout not live', bmi);
  ok(bmi.swatch.join() === bmi.seg.join() && new Set(bmi.seg).size === 4, 'BMI: each category uses one colour for its scale segment and its legend swatch', bmi);
  ok(/bmi-(under|normal|over|obese)/.test(bmi.pill) && bmi.gap !== 'none', 'BMI: the category pill uses the BMI palette and the scale segments have a gap', bmi);
  const bmiPills = await pg.evaluate(() => { const probe = c => { const e = document.createElement('span'); e.className = 'pill ' + c; document.body.appendChild(e); const cs = getComputedStyle(e); const r = [cs.color, cs.backgroundColor]; e.remove(); return r; };
    const sw = c => { const e = document.createElement('i'); e.className = 'sw sb-' + c; document.body.appendChild(e); const r = getComputedStyle(e).backgroundColor; e.remove(); return r; };
    return ['under', 'normal', 'over', 'obese'].map(c => ({ c, text: probe('bmi-' + c)[0], bar: sw(c) })); });
  ok(bmiPills.every(p => p.text === p.bar), 'BMI: pill text, scale segment and swatch share the same token', bmiPills);
  // theme change redraws all charts (BMI chart is open now): flip the colour scheme and look at the tick colour option
  const before = await pg.evaluate(() => Chart.getChart('chartBmi').options.scales.x.ticks.color);
  await pg.emulateMedia({ colorScheme: 'dark' }); await pg.waitForTimeout(500);
  const afterC = await pg.evaluate(() => ({ bmi: Chart.getChart('chartBmi').options.scales.x.ticks.color, main: Chart.getChart('chart').options.scales.x.ticks.color }));
  ok(afterC.bmi !== before && afterC.main === afterC.bmi, 'a theme change redraws the BMI and main charts with fresh colours', { before, afterC });
  await pg.click('.sheet .txtbtn:has-text("Done")'); await sheetGone(pg);
  await pg.emulateMedia({ colorScheme: 'light' }); await pg.waitForTimeout(200);
  ok(errs.length === 0, 'no page errors (roles)', errs);
  await ctx.close();
}

/* ---------- Progress empty state ---------- */
{
  const { ctx, pg, errs } = await open(412, 915, 'light', { empty: true });
  await tab(pg, 'progress'); await pg.waitForTimeout(500);
  const e = await pg.evaluate(() => ({ seg: document.getElementById('seg').offsetParent !== null, canvas: document.getElementById('chart').offsetParent !== null, empty: document.getElementById('progEmpty').offsetParent !== null }));
  ok(e.empty && !e.seg && !e.canvas, 'Progress empty state hides the range selector and the chart', e);
  await ctx.close();
}

/* ---------- focus rings ---------- */
{
  const { ctx, pg } = await open(412, 915, 'light', {});
  await tab(pg, 'setup'); await pg.waitForTimeout(300);
  await pg.keyboard.press('Tab'); // make the page keyboard-driven
  await pg.focus('#planSections .swipe .row'); await pg.keyboard.press('Shift+Tab'); await pg.keyboard.press('Tab');
  const ring = await pg.evaluate(() => { const c = getComputedStyle(document.activeElement); return { cls: document.activeElement.className, off: c.outlineOffset, w: c.outlineWidth }; });
  ok(/row/.test(ring.cls) && parseFloat(ring.off) < 0 && parseFloat(ring.w) >= 2, 'rows draw their focus ring inside (not clipped by the rounded group)', ring);
  // field box ring
  await pg.click('#createHabitRow'); await pg.waitForSelector('#fName'); await pg.waitForTimeout(400);
  await pg.keyboard.press('Tab'); await pg.focus('#fName'); await pg.keyboard.press('Shift+Tab'); await pg.keyboard.press('Tab');
  const box = await pg.evaluate(() => { const i = document.getElementById('fName'), b = i.closest('.box'); return { boxOutline: getComputedStyle(b).outlineStyle + ' ' + getComputedStyle(b).outlineWidth, inputOutline: getComputedStyle(i).outlineStyle }; });
  ok(/solid 2px/.test(box.boxOutline) && box.inputOutline === 'none', 'form fields: the box carries the focus ring, the inner input has none', box);
  const segOff = await pg.evaluate(() => { const b = document.querySelector('#fSched button[aria-checked="true"]'); b.focus(); return getComputedStyle(b).outlineOffset; });
  await pg.keyboard.press('Shift+Tab'); await pg.keyboard.press('Tab');
  ok(parseFloat(segOff) < 0, 'segment buttons draw their focus ring inside the control', segOff);
  await ctx.close();
}

/* ---------- Simple look ---------- */
{
  const { ctx, pg, errs } = await open(412, 915, 'light', {});
  await gear(pg); await pg.waitForTimeout(400);
  ok(await pg.isVisible('#simpleOn') || (await pg.$('#simpleOn')) !== null, 'Settings has a "Simple look" switch');
  const lite0 = await pg.evaluate(() => document.documentElement.classList.contains('lite'));
  await pg.evaluate(() => document.getElementById('simpleOn').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(200);
  await pg.click('#simpleRow'); await pg.waitForTimeout(300);
  const on = await pg.evaluate(() => ({ lite: document.documentElement.classList.contains('lite'), tab: getComputedStyle(document.querySelector('.tabbar-in')).backdropFilter, stored: localStorage.getItem('CapacitorStorage.comeback_simple_look') }));
  ok(on.lite && on.tab === 'none' && on.stored === '1', 'Simple look: adds the lite class, drops the tab bar blur and is remembered', { lite0, on });
  // wiggle off
  await tab(pg, 'today'); await pg.click('#editToday'); await pg.waitForTimeout(400);
  const wig = await pg.evaluate(() => getComputedStyle(document.querySelector('#sections .titem')).animationName);
  ok(wig === 'none', 'Simple look: no wiggle while editing Today', wig);
  await pg.click('#editDone'); await pg.waitForTimeout(200);
  await pg.reload(); await ready(pg); await pg.waitForTimeout(600);
  ok(await pg.evaluate(() => document.documentElement.classList.contains('lite')), 'Simple look: still on after a restart');
  await gear(pg); await pg.click('#simpleRow'); await pg.waitForTimeout(300);
  const off = await pg.evaluate(() => ({ lite: document.documentElement.classList.contains('lite'), tab: getComputedStyle(document.querySelector('.tabbar-in')).backdropFilter }));
  ok(!off.lite && /blur/.test(off.tab), 'Simple look: switching it off restores the glass', off);
  await ctx.close();
}

/* ---------- onboarding: off-screen pages are inert ---------- */
{
  const { ctx, pg } = await open(412, 915, 'light', { onboarding: true, empty: true });
  const st = await pg.evaluate(() => { const ps = [...document.querySelectorAll('.onb-page')]; return { n: ps.length, inert: ps.map(p => p.hasAttribute('inert')), bg: ['#screens', '.tabbar', '.navbar'].map(s => document.querySelector(s).hasAttribute('inert')) }; });
  ok(st.n >= 2 && st.inert[0] === false && st.inert.slice(1).every(Boolean), 'onboarding: pages that are off screen are inert', st);
  ok(st.bg.every(Boolean), 'onboarding: the app behind it is inert', st);
  await pg.click('#onbNext'); await pg.waitForTimeout(500);
  const st2 = await pg.evaluate(() => [...document.querySelectorAll('.onb-page')].map(p => p.hasAttribute('inert')));
  ok(st2[0] === true && st2[1] === false, 'onboarding: moving on makes the new page live and the old one inert', st2);
  await ctx.close();
}

/* ---------- confetti uses tokens ---------- */
{
  const { ctx, pg } = await open(412, 915, 'light', {});
  const cf = await pg.evaluate(() => { const orig = document.body.appendChild.bind(document.body); let got = null; document.body.appendChild = n => { if (n.classList && n.classList.contains('confetti')) got = [...n.children].map(i => i.style.background); return orig(n); }; celebrate(); document.body.appendChild = orig; return got; });
  ok(cf && cf.length > 0 && cf.every(c => /var\(--confetti-\d\)/.test(c)), 'confetti colours come from the --confetti tokens', cf && cf.slice(0, 3));
  await ctx.close();
}

/* ---------- Today: a lone last card spans the row on phones ---------- */
{
  const { ctx, pg } = await open(360, 800, 'light', {});
  await pg.evaluate(() => { settings.habits.find(h => h.id === 'plank').hidden = true; renderToday(true); }); await pg.waitForTimeout(300);   // 3 cards in Workout: an odd run
  const r = await pg.evaluate(() => { const bad = []; let soloCount = 0; document.querySelectorAll('#sections .tsec-body').forEach(b => { let run = []; const end = () => { const want = run.length % 2 === 1 ? run[run.length - 1] : null; run.forEach(c => { const solo = c.classList.contains('solo'); if (solo) soloCount++; if (solo !== (c === want)) bad.push(c.dataset.id); }); run = []; };
    [...b.children].forEach(c => { if (c.classList.contains('hcard')) run.push(c); else end(); }); end(); });
    return { bad, soloCount }; });
  ok(r.bad.length === 0 && r.soloCount > 0, 'Today: the last card of an odd run of cards is marked to span the row, no other is', r);
  const span = await pg.evaluate(() => { const s = document.querySelector('#sections .hcard.solo'); const body = s.parentElement; return Math.abs(s.getBoundingClientRect().width - body.getBoundingClientRect().width) < 2; });
  ok(span, 'Today: a lone card fills the full row on a phone');
  await ctx.close();
}

/* ---------- 200% text on a small phone ---------- */
for (const scheme of ['light', 'dark']) {
  const { ctx, pg, errs } = await open(360, 800, scheme, {});
  await pg.addStyleTag({ content: 'html{font-size:200% !important}' }); await pg.waitForTimeout(500);
  const bad = [];
  for (const t of ['today', 'progress', 'setup', 'settings']) {
    if (t === 'settings') await gear(pg); else await tab(pg, t);
    await pg.waitForTimeout(450);
    const o = await pg.evaluate(() => {
      const vw = document.documentElement.clientWidth, out = [];
      for (const el of document.querySelectorAll('.screen.on *, .navbar *, .tabbar *')) {
        if (el.closest('.chips') || el.closest('svg') || el.tagName === 'CANVAS' || el.classList.contains('vh')) continue;
        const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).position === 'fixed' && !el.closest('.navbar,.tabbar')) continue;
        if (r.right > vw + 1 || r.left < -1) out.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ' ' + Math.round(r.left) + '-' + Math.round(r.right));
      }
      return { sw: document.documentElement.scrollWidth, vw, out: out.slice(0, 4) };
    });
    if (o.sw > o.vw || o.out.length) bad.push([t, o]);
    // tab labels are fully inside their buttons and inside the bar
    const tabs = await pg.evaluate(() => [...document.querySelectorAll('.tabbar .tab')].map(b => { const s = b.querySelector('span'), r = b.getBoundingClientRect(), sr = s.getBoundingClientRect(), bar = document.querySelector('.tabbar-in').getBoundingClientRect();
      return { t: s.textContent, clippedX: s.scrollWidth > s.clientWidth + 1 || sr.left < r.left - 1 || sr.right > r.right + 1, outOfBar: sr.top < bar.top - 1 || sr.bottom > bar.bottom + 1 || r.bottom > bar.bottom + 1 || r.top < bar.top - 1 }; }));
    if (tabs.some(x => x.clippedX || x.outOfBar)) bad.push([t, 'tabs', tabs]);
  }
  ok(bad.length === 0, `360x800 at 200% text (${scheme}): nothing overflows and tab labels are not clipped`, bad);
  await tab(pg, 'progress'); await pg.waitForTimeout(400);
  const sizes = await pg.evaluate(() => { const cells = [...document.querySelectorAll('#heat .hc i')].map(i => { const r = i.getBoundingClientRect(); return [r.width, r.height]; }); const seg = document.getElementById('seg').getBoundingClientRect();
    const cell = document.querySelector('#heat .hc').getBoundingClientRect(); const bar = document.querySelector('.tabbar-in').getBoundingClientRect(); const lastCard = [...document.querySelectorAll('.screen.on .card,.screen.on .group')].pop();
    window.scrollTo(0, 1e6); const lb = lastCard.getBoundingClientRect().bottom; return { sq: cells.every(c => Math.abs(c[0] - c[1]) < 1), maxW: Math.max(...cells.map(c => c[0])), colW: cell.width, segH: seg.height, tabH: bar.height, lastBottom: lb, barTop: bar.top }; });
  ok(sizes.sq && sizes.maxW <= sizes.colW + 1 && sizes.segH >= 48, '200% text: calendar cells stay square inside their column and the segment grows', sizes);
  ok(sizes.lastBottom <= sizes.barTop + 1, '200% text: the last card still scrolls clear of the taller tab bar', sizes);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
