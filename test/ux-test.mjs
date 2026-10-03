// The Today / logging / onboarding / Settings UX pass: quiet and coalesced taps, the Add-mode number sheet, discoverable editing,
// a compact header, finished cards that fold after a pause, empty states, the edit strip, Weight surfaced, Plan removal with Undo,
// the Settings order and the first-time BMI scale choice.
// Run: npm run test:ux
import fs from 'fs';
import { createRequire } from 'module';
import { serve, launch, counter, newPage, skipOnboarding, tab, gear, ready, stored, sheetGone, settle, setHabit, cardSel, MOCK, todayKey, daysAgo } from './helpers.mjs';

const Core = createRequire(import.meta.url)('../www/js/core.js');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const tk = todayKey();
const KEY = 'CapacitorStorage.comeback';
const day = (k, vals = {}, rules = {}, extra = {}) => ({ vals, rules, weight: null, waist: null, note: '', date: k, updatedAt: 1e12, ...extra });

async function open({ data, w = 360, h = 800, scheme = 'light', reduce = false, native = false, prefs = {}, onboard = false, empty = false } = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, acceptDownloads: true, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  // a fast phone: this box has few cores, which would switch the lite look (and with it the wiggle) off by itself
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 }); });
  if (native) await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  if (!onboard && !native) await skipOnboarding(ctx);
  await ctx.addInitScript(([d, key, p]) => {
    if (localStorage.getItem('__d')) return;
    localStorage.setItem('__d', '1');
    if (d) localStorage.setItem(key, JSON.stringify(d));
    for (const k of Object.keys(p)) localStorage.setItem('CapacitorStorage.' + k, p[k]);
  }, [data, KEY, prefs]);
  const pg = await newPage(ctx, errs);
  await pg.goto(base);
  if (empty) await pg.waitForSelector('#todayEmpty');
  else if (!onboard) await ready(pg);
  return { ctx, pg, errs };
}
const toastShown = pg => pg.$eval('#toast', e => e.classList.contains('show'));
const hideToast = pg => pg.evaluate(() => { document.getElementById('toast').classList.remove('show'); });
const withSettings = fn => { const s = Core.defaultSettings(); fn(s); return s; };
const seedFor = (settings, days = {}) => ({ version: 2, settings, days });

/* ================= quiet taps, one toast for a run of taps, one Undo ================= */
console.log('Quiet taps');
{
  const { ctx, pg, errs } = await open();
  for (let i = 0; i < 3; i++) await pg.click(`${cardSel('pushups')} .cbtn.plus`);
  await pg.waitForTimeout(700);
  ok(!(await toastShown(pg)), 'tapping + on a Count card shows no toast (the number and the bar already move)');
  ok((await pg.textContent('#liveNote')) === 'Pushups 3 of 30 reps', 'but the final number is still announced to screen readers', await pg.textContent('#liveNote'));
  await pg.click(`${cardSel('pushups')} .cbtn.minus`); await pg.waitForTimeout(700);
  ok(!(await toastShown(pg)) && (await pg.textContent('#liveNote')) === 'Pushups 2 of 30 reps', '- is quiet too, and the announcement follows', await pg.textContent('#liveNote'));
  await pg.click('#sections .yrow[data-id="nofried"] .row'); await pg.waitForTimeout(500);
  ok(!(await toastShown(pg)) && /: done$/.test(await pg.textContent('#liveNote')), 'a Yes/No tap is quiet and announced', await pg.textContent('#liveNote'));
  // Duration presets have no minus, so they keep one toast; a run of taps shares it and one Undo
  await pg.click(`${cardSel('walk')} .chipbtn >> nth=1`); await pg.click(`${cardSel('walk')} .chipbtn >> nth=1`);
  ok(/^Brisk walk \+20 min$/.test(await pg.textContent('#toastMsg')) && await pg.isVisible('#toastUndo'), 'two +10 taps on one card read as one toast: "Brisk walk +20 min"', await pg.textContent('#toastMsg'));
  await pg.click('#toastUndo'); await settle(pg);
  ok((await stored(pg)).days[tk].vals.walk === undefined, 'one Undo reverts both taps');
  ok(errs.length === 0, 'no JS errors (quiet taps)', errs);
  await ctx.close();
}
{
  // a goal hit still gets its toast, and Undo goes back to before the first tap of the run
  const s = Core.defaultSettings();
  const { ctx, pg } = await open({ data: seedFor(s, { [tk]: day(tk, { pushups: 28 }) }) });
  await pg.click(`${cardSel('pushups')} .cbtn.plus`); await pg.click(`${cardSel('pushups')} .cbtn.plus`);
  ok(/Pushups goal hit/.test(await pg.textContent('#toastMsg')) && await pg.isVisible('#toastUndo'), 'hitting the target still earns a toast');
  await pg.click('#toastUndo'); await settle(pg);
  ok((await stored(pg)).days[tk].vals.pushups === 28, 'and its Undo reverts every tap of the run (28 again)', (await stored(pg)).days[tk].vals);
  await ctx.close();
}

/* ================= the number sheet: Add mode ================= */
console.log('Number sheet');
{
  const { ctx, pg, errs } = await open({ data: seedFor(Core.defaultSettings(), { [tk]: day(tk, { pushups: 20 }) }) });
  ok(/Tap to add/.test(await pg.getAttribute(`${cardSel('pushups')} .hc-main`, 'aria-label')) && !/type a number/.test(await pg.getAttribute(`${cardSel('pushups')} .hc-main`, 'aria-label')), 'the card says "Tap to add"');
  await pg.click(`${cardSel('pushups')} .hc-main`); await pg.waitForSelector('.keypad');
  ok(await pg.getAttribute('#numModeAdd', 'aria-checked') === 'true' && await pg.getAttribute('#numModeSet', 'aria-checked') === 'false', 'Count and Duration sheets open in Add mode, with a Set total toggle');
  await pg.click('.keypad .key[aria-label="1"]'); await pg.click('.keypad .key[aria-label="5"]');
  ok((await pg.textContent('.sheet .nv')) === '15' && /^20 \+ 15 = 35 of 30 reps$/.test((await pg.textContent('#numLive')).trim()), 'the big number is what you add, with a live line: "20 + 15 = 35 of 30 reps"', await pg.textContent('#numLive'));
  await pg.click('.preset:has-text("+5")');
  ok(/20 \+ 20 = 40 of 30 reps/.test(await pg.textContent('#numLive')), 'presets add to the amount');
  await pg.click('#numModeSet');
  ok((await pg.textContent('.sheet .nv')) === '40' && /of 30 reps/.test(await pg.textContent('.sheet .nu')) && !(await pg.textContent('#numLive')), 'Set total turns the number into the new total (40) and drops the live line');
  await pg.click('#numModeAdd');
  ok((await pg.textContent('.sheet .nv')) === '20', 'and back to Add gives the amount again (20)');
  await pg.click('.keypad .key[aria-label="7"]'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  ok((await stored(pg)).days[tk].vals.pushups === 27, 'Done adds the amount to what was there (20 + 7 = 27)', (await stored(pg)).days[tk].vals);
  ok(/^Pushups \+7$/.test(await pg.textContent('#toastMsg')), 'the toast reads "Pushups +7"', await pg.textContent('#toastMsg'));
  await pg.click(`${cardSel('pushups')} .hc-main`); await pg.waitForSelector('.keypad');
  await pg.click('#numModeSet'); await pg.click('.keypad .key[aria-label="1"]'); await pg.click('.keypad .key[aria-label="2"]');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  ok((await stored(pg)).days[tk].vals.pushups === 12 && /Pushups updated/.test(await pg.textContent('#toastMsg')), 'Set total corrects the day to exactly what was typed');
  // measurements stay "set a value"
  await pg.click('#rowWeight'); await pg.waitForSelector('.keypad');
  ok(!(await pg.$('#numModeAdd')) && !(await pg.isVisible('#numLive')), 'Weight (and Waist) still just set a value: no Add mode');
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  // Duration: minutes, with presets
  await pg.click(`${cardSel('walk')} .hc-main`); await pg.waitForSelector('.keypad');
  await pg.click('.preset:has-text("+10")'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  ok((await stored(pg)).days[tk].vals.walk === 10 && /Brisk walk \+10 min/.test(await pg.textContent('#toastMsg')), 'a Duration sheet adds minutes the same way ("Brisk walk +10 min")', await pg.textContent('#toastMsg'));
  await pg.click(`${cardSel('walk')} .hc-main`); await pg.waitForSelector('.keypad');
  const t = await pg.evaluate(() => [...document.querySelectorAll('.sheet #numMode button')].map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  ok(t.length === 2 && t.every(x => x >= 43.5), 'the Add / Set total toggle has 44px tap targets', t);
  await pg.keyboard.press('Escape'); await sheetGone(pg);
  ok(errs.length === 0, 'no JS errors (number sheet)', errs);
  await ctx.close();
}

/* ================= Today header: edit button, hold cue, one-time tip, compact layout ================= */
console.log('Today header and editing');
for (const scheme of ['light', 'dark']) {
  const { ctx, pg, errs } = await open({ scheme });
  const r = await pg.evaluate(() => {
    const tb = document.querySelector('.tabbar-in').getBoundingClientRect();
    const cards = [...document.querySelectorAll('#sections .tsec:first-child .hcard')].slice(0, 2).map(c => c.getBoundingClientRect());
    const eb = document.getElementById('editTodayBtn').getBoundingClientRect(), tt = document.getElementById('todayTitle').getBoundingClientRect();
    return { tabTop: tb.top, cardsBottom: Math.max(...cards.map(c => c.bottom)), n: cards.length, eb: [eb.width, eb.height, eb.top], tt: [tt.top, tt.bottom], over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  ok(r.n >= 1 && r.cardsBottom <= r.tabTop, `${scheme}: at 360x800 a full row of habit cards is visible on first load (above the tab bar)`, r);
  ok(r.eb[0] >= 44 && r.eb[1] >= 44 && r.eb[2] < r.tt[1] && r.over <= 0, `${scheme}: a visible 44px Edit (pencil) button sits in the title row, no sideways scroll`, r);
  ok(await pg.getAttribute('#editTodayBtn', 'aria-label') && /Edit Today/.test(await pg.getAttribute('#editTodayBtn', 'aria-label')), `${scheme}: it has an accessible name`);
  await ctx.close();
}
{
  const { ctx, pg, errs } = await open({ h: 1400 });
  ok(await pg.isVisible('#editToday') && await pg.isVisible('#editTodayBtn'), 'the bottom "Edit Today" row stays, next to the new pencil button');
  await pg.click('#editTodayBtn');
  ok(await pg.isVisible('#editBar') && !(await pg.isVisible('#editTodayBtn')), 'the pencil starts edit mode (and hides while editing)');
  await pg.click('#editDone');
  // press-and-hold: a visible cue while the 0.5 s hold runs, and nothing happens on a plain tap
  await pg.dispatchEvent(`${cardSel('pushups')} .hc-main`, 'pointerdown', { clientX: 120, clientY: 500 });
  await pg.waitForTimeout(250);
  ok(await pg.$eval(cardSel('pushups'), e => e.classList.contains('holding') && getComputedStyle(e).animationName === 'holdcue'), 'while a card is held a growing ring shows the press is working');
  await pg.dispatchEvent(`${cardSel('pushups')} .hc-main`, 'pointerup', { clientX: 120, clientY: 500 });
  ok(!(await pg.$eval(cardSel('pushups'), e => e.classList.contains('holding'))) && !(await pg.isVisible('#editBar')), 'letting go early removes the cue and does not start editing');
  await pg.dispatchEvent(`${cardSel('pushups')} .hc-main`, 'pointerdown', { clientX: 120, clientY: 500 });
  await pg.waitForSelector('#editBar:not([hidden])', { timeout: 3000 });
  ok(await pg.$eval('#p-today', e => e.classList.contains('editing')), 'holding for half a second still starts edit mode (long-press is kept as a shortcut)');
  await ctx.close();
}
{
  // the one-time tip after the first logged tap
  const { ctx, pg } = await open();
  ok(!/Tip:/.test(await pg.textContent('#todayHint')) && /Tap \+ to log/.test(await pg.textContent('#todayHint')) && !/Tap a target/.test(await pg.textContent('#todayHint')), 'before anything is logged the hint says "Tap + to log." (not "Tap a target")', await pg.textContent('#todayHint'));
  await pg.click(`${cardSel('pushups')} .cbtn.plus`); await pg.waitForTimeout(400);
  ok(/Tip: hold a card to rearrange/.test(await pg.textContent('#todayHint')), 'after the first logged tap a tip says "Tip: hold a card to rearrange"', await pg.textContent('#todayHint'));
  ok(await pg.evaluate(k => localStorage.getItem('CapacitorStorage.' + k) === '1', 'comeback_tip_edit'), 'and it is remembered (Preferences key comeback_tip_edit)');
  await pg.click(`${cardSel('pushups')} .cbtn.plus`); await pg.waitForTimeout(200);
  await ctx.close();
  const c2 = await open({ prefs: { comeback_tip_edit: '1' } });
  await c2.pg.click(`${cardSel('pushups')} .cbtn.plus`); await c2.pg.waitForTimeout(400);
  ok(!/Tip:/.test(await c2.pg.textContent('#todayHint')), 'once seen, the tip never comes back');
  await c2.ctx.close();
}

/* ================= edit mode: the pressed card stays put; the wiggle is short ================= */
console.log('Edit mode feel');
{
  const { ctx, pg } = await open({ h: 700 });
  await pg.evaluate(() => window.scrollTo(0, 420)); await pg.waitForTimeout(200);
  const before = await pg.$eval(cardSel('squats'), e => e.getBoundingClientRect().top);
  await pg.dispatchEvent(`${cardSel('squats')} .hc-main`, 'pointerdown', { clientX: 120, clientY: before + 20 });
  await pg.waitForSelector('#editBar:not([hidden])', { timeout: 3000 });
  await pg.waitForTimeout(100);
  const after = await pg.$eval(cardSel('squats'), e => e.getBoundingClientRect().top);
  ok(Math.abs(after - before) <= 2, 'the pressed card stays where it was when edit mode opens (scroll anchor)', [before, after]);
  ok(await pg.$eval(cardSel('squats'), e => getComputedStyle(e).animationName === 'wiggle'), 'cards wiggle at first to show they can be moved');
  await pg.waitForTimeout(1400);
  ok(await pg.$eval(cardSel('squats'), e => getComputedStyle(e).animationName === 'none'), 'and settle after about a second');
  await ctx.close();
  const r = await open({ reduce: true, h: 1400 });
  await r.pg.click('#editTodayBtn');
  ok(await r.pg.$eval(cardSel('squats'), e => getComputedStyle(e).animationName === 'none'), 'reduced motion: no wiggle at all');
  await r.ctx.close();
  const l = await open({ h: 1400 });
  await l.pg.evaluate(() => document.documentElement.classList.add('lite'));
  await l.pg.click('#editTodayBtn');
  ok(await l.pg.$eval(cardSel('squats'), e => getComputedStyle(e).animationName === 'none'), 'the simple look (.lite): no wiggle');
  await l.ctx.close();
}

/* ================= zero and empty states ================= */
console.log('Empty states');
{
  // nothing due today (the only habit is for another weekday): no 0-of-0 chips, no ring text, no hint
  const other = (new Date().getDay() + 3) % 7;
  const s = withSettings(x => { x.habits = x.habits.filter(h => h.id === 'pushups' || h.type === 'measure'); x.habits.forEach(h => { if (h.type === 'measure') h.hidden = true; }); x.habits.find(h => h.id === 'pushups').schedule = { kind: 'days', days: [other] }; });
  const { ctx, pg } = await open({ data: seedFor(s), empty: true });
  ok(/Nothing due today/.test(await pg.textContent('#todayEmpty')) && !(await pg.isVisible('#emptyPlans')), 'a day with nothing due says "Nothing due today" (the plan is not empty)');
  ok(!(await pg.isVisible('#chipTargets')) && !(await pg.isVisible('#chipRules')) && !(await pg.isVisible('#ring .ring-c')) && !(await pg.isVisible('#todayHint')), 'no "0 of 0 targets / rules" chips, no ring text and no hint when nothing is due');
  ok(/Nothing is due today/.test(await pg.getAttribute('#ring', 'aria-label')), 'the ring still has a spoken summary');
  await ctx.close();
  // one habit due: chips for it only
  const s2 = withSettings(x => { x.habits = x.habits.filter(h => h.id === 'pushups' || h.type === 'measure'); x.habits.forEach(h => { if (h.type === 'measure') h.hidden = true; }); });
  const o2 = await open({ data: seedFor(s2) });
  ok(await o2.pg.isVisible('#chipTargets') && !(await o2.pg.isVisible('#chipRules')) && /0 of 1 targets/.test(await o2.pg.textContent('#chipTargets')), 'only the chips that have something in them show (targets, but no rules chip)');
  await o2.ctx.close();
}

/* ================= Body starts open when weight is due; the due text and dot ================= */
console.log('Weight surfaced');
{
  const s = withSettings(x => { x.habits.filter(h => h.type === 'measure').forEach(h => { h.hidden = true; }); });
  const { ctx, pg } = await open({ data: seedFor(s) });
  ok(await pg.$eval('#sections .tsec[data-sec="body"] .tsec-toggle', e => e.getAttribute('aria-expanded') === 'false') && /Weight, waist and notes/.test(await pg.textContent('#sections .tsec[data-sec="body"] .tsec-sum')), 'with no weight or waist due, Body and notes stays collapsed by default');
  await ctx.close();
  const o = await open({ data: seedFor(Core.defaultSettings(), { [tk]: day(tk, { pushups: 3 }, {}, { weight: 85.5 }) }) });
  ok(await o.pg.$eval('#sections .tsec[data-sec="body"] .tsec-toggle', e => e.getAttribute('aria-expanded') === 'true'), 'with weight due it starts open');
  await o.pg.click('#sections .tsec[data-sec="body"] .tsec-toggle');
  const sum = await o.pg.textContent('#sections .tsec[data-sec="body"] .tsec-sum');
  ok(/Waist due/.test(sum) && !/Weight due/.test(sum), 'once the weight is logged the collapsed header only says what is still due ("Waist due")', sum);
  await o.ctx.close();
  const last = { [daysAgo(1)]: day(daysAgo(1), {}, {}, { weight: 86.1 }) };
  const p3 = await open({ data: seedFor(Core.defaultSettings(), last) });
  await p3.pg.click('#rowWeight'); await p3.pg.waitForSelector('.keypad');
  ok(/Use last \(86\.1\)/.test(await p3.pg.textContent('.sheet .presets')), 'the weight sheet shows "Use last (86.1)"');
  await p3.ctx.close();
}

/* ================= Plan: Remove with Undo, clearer Reorder ================= */
console.log('Plan');
{
  const { ctx, pg } = await open();
  await tab(pg, 'setup');
  ok(/Reorder in sections/.test(await pg.textContent('#reorderBtn')), 'the Reorder button says what it does ("Reorder in sections")');
  ok(/Swipe a row left to remove it/.test(await pg.textContent('#p-setup')) && !/Pull a card off Today/.test(await pg.textContent('#p-setup')), 'the swipe hint is short');
  const ids = () => pg.evaluate(() => settings.habits.map(h => h.id));
  const idsBefore = await ids();
  await pg.click('#planSections .swipe[data-id="plank"] .row'); await pg.waitForSelector('#fRemove');
  await pg.click('#fRemove'); await sheetGone(pg); await settle(pg);
  ok(!(await pg.$('.asheet')) && !(await stored(pg)).settings.habits.some(h => h.id === 'plank') && /Removed Plank/.test(await pg.textContent('#toastMsg')), 'the edit sheet\'s Remove deletes at once and the toast says so');
  await pg.click('#toastUndo'); await settle(pg);
  ok(JSON.stringify(await ids()) === JSON.stringify(idsBefore), 'Undo brings it back in the same place');
  await ctx.close();
  // no leftover red edge at rest
  const c2 = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2.625 });
  await skipOnboarding(c2);
  const p2 = await newPage(c2, []); await p2.goto(base); await ready(p2); await tab(p2, 'setup'); await p2.waitForTimeout(500);
  const red = await p2.evaluate(() => [...document.querySelectorAll('#planSections .swipe-del')].filter(d => getComputedStyle(d).visibility !== 'hidden').length);
  ok(red === 0, 'at rest no Remove button is painted behind the rows (no red hairline)', red);
  await c2.close();
}

/* ================= Settings order, backup warning, version ================= */
console.log('Settings');
{
  const { ctx, pg } = await open();
  await gear(pg);
  const heads = await pg.$$eval('#p-settings [role=heading]', e => e.filter(x => x.offsetParent !== null).map(x => x.textContent.trim()));
  ok(heads.join() === 'Reminder,Units,Body,Suggestions,Appearance,Backup,Account and sync,About', 'Settings order: Reminder, Units, Body, Suggestions, Appearance, Backup, Account and sync, About', heads);
  ok(/Last backup: never/.test(await pg.textContent('#lastBackup')) && await pg.$eval('#lastBackup', e => e.classList.contains('warn')) && await pg.isVisible('#backupNow'), '"Last backup: never" gets a gentle warning look and a "Back up now" button');
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#backupNow')]);
  ok(dl.suggestedFilename() === `comeback-backup-${tk}.json`, '"Back up now" runs the JSON export', dl.suggestedFilename());
  await pg.waitForTimeout(300);
  ok(!(await pg.isVisible('#backupNow')) && !(await pg.$eval('#lastBackup', e => e.classList.contains('warn'))), 'afterwards the warning and the button are gone');
  ok((await pg.textContent('#appVersion')) === pkg.version, 'the version shown in About is the one in package.json', [await pg.textContent('#appVersion'), pkg.version]);
  await ctx.close();
  const n = await open({ native: true });
  await gear(n.pg); await n.pg.waitForTimeout(400);
  const nh = await n.pg.$$eval('#p-settings [role=heading]', e => e.filter(x => x.offsetParent !== null).map(x => x.textContent.trim()));
  ok(nh.join() === 'Reminder,Units,Body,Suggestions,Appearance,Step tracking,Permissions,Advanced,Backup,Account and sync,About', 'in the Android app the phone-only groups come after Appearance (Step tracking, Permissions, Advanced), then Backup, Account and sync, About', nh);
  await n.ctx.close();
}

/* ================= BMI: height and scale are asked the first time it is opened ================= */
console.log('BMI first time');
{
  const s = Core.defaultSettings();
  const { ctx, pg, errs } = await open({ data: seedFor(s, { [daysAgo(1)]: day(daysAgo(1), { pushups: 5 }, {}, { weight: 80 }) }) });
  ok(await pg.evaluate(() => settings.body.heightCm === null && settings.body.scale === 'standard'), 'a new person has no height and the Standard scale');
  await pg.click('#rowBmi'); await pg.waitForSelector('.bmi-sheet');
  ok(/Set your height/.test(await pg.textContent('.bmi-sheet')) && await pg.isVisible('#bmiScaleChoice') && await pg.isVisible('#sheetScStd') && await pg.isVisible('#sheetScAsia'), 'the first time BMI opens it asks for the height and offers the scale in one line (Standard / Asian)');
  ok(await pg.getAttribute('#sheetScStd', 'aria-checked') === 'true', 'Standard is selected to begin with');
  await pg.click('#sheetScAsia'); await settle(pg);
  ok((await stored(pg)).settings.body.scale === 'asian' && await pg.getAttribute('#sheetScAsia', 'aria-checked') === 'true' && /Asian/.test(await pg.textContent('.scale-help')), 'choosing Asian saves it and says what it means');
  const tt = await pg.evaluate(() => [...document.querySelectorAll('#bmiScaleChoice [role=radio]')].map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  ok(tt.every(x => x >= 43.5), 'the scale buttons are 44px tall', tt);
  await pg.click('.bmi-sheet .btn'); await pg.waitForSelector('.keypad');
  for (const c of ['1', '8', '0']) await pg.click(`.keypad .key[aria-label="${c}"]`);
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  ok((await stored(pg)).settings.body.heightCm === 180, 'the height is saved from there');
  await gear(pg);
  ok(await pg.getAttribute('#scAsia', 'aria-checked') === 'true', 'Settings > Body shows the same scale');
  ok(errs.length === 0, 'no JS errors (BMI first time)', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
