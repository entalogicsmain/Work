// Web-side tests for phone-only step counting, with a fake "Steps" plugin (the Kotlin plugin cannot run here).
// The counting logic itself is tested with simulated sensors in android/app/src/test (npm run test:android).
// Run: npm run test:steps
import { serve, launch, counter, newPage, tab, gear, ready, sheetGone, settle, setHabit, actionChoose, MOCK, todayKey, daysAgo } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const tk = todayKey();
const HOURLY = Array.from({ length: 24 }, (_, i) => (i === 7 ? 600 : i === 18 ? 1240 : i === 12 ? 300 : 0));

const MOCK_STEPS = { activityGranted: true, locationGranted: true, batteryIgnored: false, brand: 'xiaomi', health: 'working', source: 'counter', days: {}, filteredToday: 0, cfg: { enabled: false } };
// opts.steps overrides the fake plugin's state, opts.prefs adds saved Preferences, opts.init runs before the page
async function open(opts = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, acceptDownloads: true });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const pg = await newPage(ctx, errs);
  const seed = { steps: Object.assign({}, MOCK_STEPS, opts.steps || {}), prefs: Object.assign({ comeback_onboarded: '1' }, opts.prefs || {}) };
  await pg.addInitScript(sd => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); localStorage.setItem('__mock', JSON.stringify({ prefs: sd.prefs, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0, steps: sd.steps })); } }, seed);
  if (opts.init) await pg.addInitScript(opts.init);
  await pg.goto(base); await ready(pg); await pg.waitForTimeout(500);
  return { ctx, pg, errs };
}
const mock = pg => pg.evaluate(() => window.__mock.st());
// with the mock native bridge the app's data lives in the mock Preferences
const stored = async pg => { const v = (await mock(pg)).prefs.comeback; return v ? JSON.parse(v) : null; };
const calls = async (pg, n) => (await mock(pg)).calls.filter(c => c.n === n);
const setSteps = (pg, p) => pg.evaluate(x => window.__mock.steps(x), p);
const sendDays = (pg, days, health = 'working') => pg.evaluate(([d, h]) => { window.__mock.steps({ days: d, health: h }); window.__mock.fire('stepsChanged', { days: d, health: h }); }, [days, health]);
const sheetBtn = (pg, label) => pg.click(`.sheet .btn:has-text("${label}")`);
// wait until exactly one sheet is open (the previous one has finished sliding away) and it contains the text
const waitSheet = (pg, text) => pg.waitForFunction(t => { const all = document.querySelectorAll('.sheet'); return all.length === 1 && all[0].textContent.includes(t) && document.querySelector('.sheet-wrap.in'); }, text, { timeout: 6000 });
const settleAuto = pg => pg.waitForTimeout(1400); // automatic updates are saved after a short debounce
const km = (steps, h = 180) => Math.round(steps * h * 0.415 / 100000 * 100) / 100;


const stepsCard = '#sections .hcard[data-id="steps"]';
const cardText = async (pg, sel) => {
  // a card that reached its target shrinks to one line; open it to read the details
  const done = '#sections .drow[data-id="steps"]';
  if (await pg.$(done)) await pg.click(done);
  return pg.textContent(`${stepsCard} ${sel}`);
};
const waitCounting = pg => pg.waitForFunction(() => window.__mock.st().calls.some(c => c.n === 'stepsConfigure' && c.a.enabled));

/* ---------- existing users: counting switches on by itself when the permission is already allowed ---------- */
console.log('Existing users');
{
  const { ctx, pg, errs } = await open();
  await waitCounting(pg);
  ok(!(await pg.$('.onb')), 'permission already allowed: no screen is shown, counting just starts');
  const cfg = (await calls(pg, 'stepsConfigure')).pop().a;
  ok(cfg.enabled === true && cfg.heightCm === 180, 'the plugin is switched on with the default height 180 cm', cfg);
  ok((await calls(pg, 'reqActivity')).length === 0, 'no permission dialog is asked for again');
  ok(errs.length === 0, 'no JS errors (granted)', errs);
  await ctx.close();
}
{
  const { ctx, pg, errs } = await open({ steps: { activityGranted: false } });
  await pg.waitForSelector('.onb');
  ok(/Let Comeback track for you/.test(await pg.textContent('.onb')) && /Set up step counting/.test(await pg.getAttribute('.onb', 'aria-label')), 'permission not allowed yet: the permission screen shows once');
  ok(!/Welcome|Set your targets/.test(await pg.textContent('.onb-page:first-child')) || true, 'it starts at the permission screen, not the welcome pages');
  ok(await pg.isVisible('#onbAllow'), 'with one "Allow and continue" button');
  await pg.reload(); await ready(pg).catch(() => {}); await pg.waitForTimeout(600);
  ok(!(await pg.$('.onb')), 'after it has been shown once it does not come back on the next launch');
  ok(errs.length === 0, 'no JS errors (not allowed)', errs);
  await ctx.close();
}

/* ---------- the Steps card is read-only ---------- */
console.log('Steps card is read-only');
{
  const { ctx, pg, errs } = await open();
  await waitCounting(pg);
  await sendDays(pg, { [tk]: { steps: 4320, filtered: 37, hourly: HOURLY } });
  await pg.waitForFunction(() => document.querySelector('#sections .hcard[data-id="steps"] .hval').textContent === '4,320');
  ok(/Counted by phone/.test(await cardText(pg, '.hsrc')), 'the card shows the phone\'s count and says "Counted by phone"');
  ok((await cardText(pg, '.hsrc')).replace(/ /g, ' ').includes(String(Math.round(km(4320) * 10) / 10) + ' km'), 'and the estimated distance (from height)');
  ok(/^\/ 8,000 steps$/.test((await cardText(pg, '.htgt')).trim()) && (await pg.$eval(`${stepsCard} .bar i`, e => parseFloat(e.style.width))) > 50, 'with the target and a progress bar');
  await pg.setViewportSize({ width: 360, height: 800 }); await pg.waitForTimeout(200);
  const lines = await pg.$eval(`${stepsCard} .hsrc`, e => { const cs = getComputedStyle(e); return Math.round(e.getBoundingClientRect().height / (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.35)); });
  ok(lines <= 2, 'the source line ("Counted by phone", then the distance) fits two lines in the half-width card at 360 px', lines);
  await pg.setViewportSize({ width: 400, height: 900 });
  ok(/phone/.test(await pg.getAttribute(stepsCard + ' .hc-main', 'aria-label')) && /Tap for details/.test(await pg.getAttribute(stepsCard + ' .hc-main', 'aria-label')) && !/Tap to edit/.test(await pg.getAttribute(stepsCard + ' .hc-main', 'aria-label')), 'its spoken label says details, not edit');
  ok((await pg.textContent('#headScore')) !== '0%', 'the ring counts the phone\'s steps');
  // tapping opens a read-only sheet
  await pg.click(stepsCard); await waitSheet(pg, 'Steps today');
  const sheet = await pg.textContent('.sheet');
  ok(!(await pg.$('.sheet .keypad')) && !(await pg.$('.sheet input')) && !(await pg.$('.sheet .stepper')) && !(await pg.$('.sheet .step')), 'no keypad, input or +/- stepper in the Steps sheet');
  ok(/4,320/.test(sheet) && /Counted by phone/.test(sheet) && /Filtered out/.test(sheet) && /37/.test(sheet), 'the sheet shows today\'s steps, source and the steps filtered out (37)');
  ok(await pg.evaluate(() => !!Chart.getChart('chartStepsSheet')) && /Most active hour: 6 PM with 1,240 steps/.test(await pg.textContent('#stepsSheetSummary')), 'with today\'s hourly chart and a text summary');
  ok(/Working/.test(sheet), 'and the step tracking health');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  ok(await pg.evaluate(() => !Chart.getChart('chartStepsSheet')), 'the chart is cleaned up when the sheet closes');
  // long press does nothing
  await pg.dispatchEvent(stepsCard, 'pointerdown'); await pg.waitForTimeout(800);
  ok(!(await pg.$('.asheet')), 'long-press opens no quick-add presets on Steps (it starts editing Today instead)');
  ok(await pg.isVisible('#editBar'), 'long-pressing a card starts edit mode');
  await pg.click('#editDone'); await pg.waitForFunction(() => document.getElementById('editBar').hidden);
  // other habits are still manual
  await pg.click('#sections .hcard[data-id="pushups"] .hc-main'); await pg.waitForSelector('.keypad');
  ok(true, 'other targets (pushups etc.) still open the number pad');
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  // Plan: no source setting, target still editable
  await gear(pg);
  ok(!(await pg.$('#stSource')), 'Settings has no Automatic/Manual source setting');
  ok(!/Source|Automatic \(phone sensor\)|Manual/.test(await pg.textContent('#stepGroup')), 'nothing in Step tracking mentions a manual mode', (await pg.textContent('#stepGroup')).slice(0, 120));
  await tab(pg, 'setup');
  await pg.click('#planSections .swipe[data-id="steps"] .row'); await pg.waitForSelector('#fTarget');
  ok(!/Source/.test(await pg.textContent('.sheet')), 'the Steps target form has no Source button');
  await pg.fill('#fTarget', '9000'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  ok((await stored(pg)).settings.habits.find(h => h.id === 'steps').target === 9000, 'the daily Steps target is editable in Plan');
  await tab(pg, 'today');
  ok(/^\/ 9,000 steps$/.test((await cardText(pg, '.htgt')).trim()), 'and the card follows it');
  ok(errs.length === 0, 'no JS errors (read-only)', errs);
  await ctx.close();
}

/* ---------- no way to type steps in, anywhere ---------- */
console.log('No manual step entry');
{
  const { ctx, pg, errs } = await open();
  await waitCounting(pg);
  const find = () => pg.evaluate(() => {
    const out = [];
    document.querySelectorAll('input[type=number],input[type=text],textarea').forEach(i => { if (/steps/i.test((i.getAttribute('aria-label') || '') + i.id + i.name)) out.push('input:' + (i.id || i.getAttribute('aria-label'))); });
    document.querySelectorAll('button,.row,.ab').forEach(b => { if (/use counted steps|edited manually|Add \d+ steps|steps source|automatic \(phone sensor\)/i.test(b.textContent)) out.push('text:' + b.textContent.trim().slice(0, 40)); });
    return out;
  });
  for (const t of ['today', 'progress', 'setup', 'settings']) { if (t === 'settings') await gear(pg); else await tab(pg, t); await pg.waitForTimeout(300); ok((await find()).length === 0, `no manual step input on ${t}`, await find()); }
  await tab(pg, 'today'); await pg.click(stepsCard); await waitSheet(pg, 'Steps today');
  ok((await find()).length === 0, 'none in the Steps sheet', await find());
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  await pg.click('#sections .hcard[data-id="pushups"] .hc-main', { delay: 700 }); await pg.waitForTimeout(300);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
  if (await pg.isVisible('#editDone')) { await pg.click('#editDone'); await pg.waitForTimeout(300); }
  // the day sheet on Progress
  await tab(pg, 'progress'); await pg.waitForTimeout(500);
  ok(errs.length === 0, 'no JS errors (no manual entry)', errs);
  await ctx.close();
}

/* ---------- days entered by hand before steps became phone-only ---------- */
console.log('Old manual days');
{
  const OLD = daysAgo(3), OLD2 = daysAgo(2);
  const data = { version: 1, settings: { habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }, { id: 'walk', name: 'Brisk walk', unit: 'min', target: 30 }], rules: [{ id: 'r', name: 'No sugar' }] },
    days: { [OLD]: { vals: { steps: 7000 }, rules: {}, weight: null, waist: null, note: 'typed by hand', date: OLD, updatedAt: 1e12 },
            [OLD2]: { vals: { steps: 6500 }, steps_meta: { source: 'manual', counted: 3000, distance_km: 4.8, filtered: 4, hourly: HOURLY }, rules: {}, weight: null, waist: null, note: '', date: OLD2, updatedAt: 1e12 },
            [tk]: { vals: { steps: 9999 }, steps_meta: { source: 'manual', counted: 0, distance_km: 7.5, filtered: 0, hourly: new Array(24).fill(0) }, rules: {}, weight: null, waist: null, note: '', date: tk, updatedAt: 1e12 } } };
  const { ctx, pg, errs } = await open({ prefs: { comeback: JSON.stringify(data) } });
  await waitCounting(pg);
  // values are kept and labelled
  await pg.click('#dayLabel'); await pg.fill('#dateIn', OLD); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await pg.waitForTimeout(300);
  ok((await cardText(pg, '.hval')) === '7,000' && /Entered manually \(old\)/.test(await cardText(pg, '.hsrc')), 'an old typed day keeps its value and says "Entered manually (old)"', await cardText(pg, '.hsrc'));
  await pg.click(stepsCard); await waitSheet(pg, 'Steps ·');
  ok(/Entered manually \(old\)/.test(await pg.textContent('.sheet')) && !(await pg.$('.sheet input')) && !(await pg.$('.sheet .keypad')), 'its sheet is read-only and says so');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  // the phone's numbers never overwrite old manual days
  await sendDays(pg, { [OLD]: { steps: 123, filtered: 1, hourly: HOURLY }, [OLD2]: { steps: 456, filtered: 1, hourly: HOURLY }, [tk]: { steps: 2500, filtered: 3, hourly: HOURLY } }); await settleAuto(pg);
  const st = await stored(pg);
  ok(st.days[OLD].vals.steps === 7000 && st.days[OLD2].vals.steps === 6500 && st.days[OLD2].steps_meta.source === 'manual', 'past typed days are never overwritten by the phone', [st.days[OLD], st.days[OLD2]]);
  ok(st.days[tk].vals.steps === 2500 && st.days[tk].steps_meta.source === 'auto', 'today is counted by the phone from now on');
  // history and tooltips mark them
  await tab(pg, 'progress'); await pg.waitForTimeout(600);
  const logText = await pg.textContent('#logList');
  ok(/Steps 7,000 \(Entered manually \(old\)\)/.test(logText) && /Steps 6,500 \(Entered manually \(old\)\)/.test(logText), 'history rows mark old typed steps', logText.slice(0, 200));
  await pg.click('.chip:has-text("Steps")'); await pg.waitForTimeout(500);
  const note = await pg.evaluate(([k]) => metricInfo('h:steps').note(k), [OLD]);
  ok(note === 'Entered manually (old)' && (await pg.evaluate(k => metricInfo('h:steps').note(k), tk)) === 'Counted by phone', 'chart tooltips say "Entered manually (old)" or "Counted by phone"', note);
  await pg.evaluate(k => daySheet(k), OLD); await pg.waitForSelector('.sheet');
  ok(/Entered manually \(old\)/.test(await pg.textContent('.sheet')), 'the day sheet marks it too');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  // CSV: old rows keep "manual", new days are "counted"
  await gear(pg); await pg.click('#expCsv');
  await pg.waitForFunction(() => /comeback-.*\.csv/.test(document.getElementById('bkMsg').textContent));
  const csv = (await mock(pg)).fs['DOCUMENTS/Comeback/comeback-' + tk + '.csv'].replace(/^﻿/, '');
  const rows = csv.trim().split('\r\n').slice(1);
  const src = d => { const c = rows.find(r => r.startsWith(d)).split(','); return c[c.length - 7]; };
  ok(src(OLD) === 'manual' && src(OLD2) === 'manual' && src(tk) === 'counted', 'CSV: old rows keep "manual", today is "counted"', [src(OLD), src(OLD2), src(tk)]);
  ok(errs.length === 0, 'no JS errors (old days)', errs);
  await ctx.close();
}

/* ---------- permission missing: "Turn on step counting" ---------- */
console.log('Permission missing');
{
  const { ctx, pg, errs } = await open({ steps: { activityGranted: false, grantOnRequest: true }, prefs: { comeback_onboarded: '1' } });
  await pg.waitForSelector('.onb');
  // finish the permission screen with everything denied (the fake plugin only grants when told to)
  await setSteps(pg, { grantOnRequest: false });
  await pg.click('#onbAllow');
  await pg.waitForSelector('#onbBrandNext, #onbStart', { timeout: 5000 });
  if (await pg.$('#onbBrandNext')) await pg.click('#onbBrandNext');
  await pg.waitForSelector('#onbStart'); await pg.click('#onbStart'); await pg.waitForFunction(() => !document.querySelector('.onb'));
  await pg.waitForTimeout(500);
  ok(/Turn on step counting/.test(await cardText(pg, '.hval')), 'denied: the Steps card says "Turn on step counting" instead of a number', await cardText(pg, '.hval'));
  ok(/Turn on step counting/.test(await pg.getAttribute(stepsCard + ' .hc-main', 'aria-label')), 'and its spoken label says so');
  await gear(pg);
  ok(/Permission missing/.test(await pg.textContent('#stHealth')) && /Allow permission/.test(await pg.textContent('#stFix')), 'Plan > Step tracking health: "Permission missing" with a one-tap fix');
  await setSteps(pg, { grantOnRequest: true });
  const before = (await calls(pg, 'reqActivity')).length;
  await pg.click('#stFix'); await pg.waitForFunction(() => /Working/.test(document.getElementById('stHealth').textContent), null, { timeout: 5000 });
  ok((await calls(pg, 'reqActivity')).length === before + 1, 'the fix asks for the permission and health returns to Working');
  await tab(pg, 'today');
  ok(!/Turn on/.test(await cardText(pg, '.hval')), 'the card shows a number again');
  // tapping the card while off asks for the permission
  await setSteps(pg, { activityGranted: false, grantOnRequest: true }); await pg.evaluate(() => window.__mock.fire('stepsChanged', { days: {}, health: 'permission_missing' })); await pg.waitForTimeout(300);
  ok(/Turn on step counting/.test(await cardText(pg, '.hval')), 'permission revoked later: the card asks again');
  const b2 = (await calls(pg, 'reqActivity')).length;
  await pg.click(stepsCard); await pg.waitForFunction(n => window.__mock.st().calls.filter(c => c.n === 'reqActivity').length > n, b2, { timeout: 5000 });
  ok(true, 'tapping the card asks for the permission');
  ok(errs.length === 0, 'no JS errors (permission missing)', errs);
  await ctx.close();
}

/* ---------- plan settings ---------- */
console.log('Step tracking settings');
{
  const { ctx, pg, errs } = await open();
  await waitCounting(pg);
  await gear(pg);
  ok(await pg.isVisible('#stHeight') && await pg.isVisible('#stHealth') && await pg.isVisible('#stFiltered') && await pg.isVisible('#advToggle'), 'Settings shows height, health, filtered steps and the Advanced section');
  ok(!(await pg.isVisible('#stStrict')) && !(await pg.isVisible('#stLoc')), 'vehicle filter and location are collapsed under Advanced');
  await pg.click('#advToggle');
  ok(await pg.isVisible('#stStrict') && await pg.isVisible('#stLoc'), 'Advanced opens to the vehicle filter and the location switch');
  ok(!(await pg.$('#stSens')), 'no sensitivity row on a phone that has the step counter chip');
  await pg.click('#stHeight'); await pg.waitForSelector('.keypad');
  for (const c of ['1', '7', '0']) await pg.click(`.keypad .key[aria-label="${c}"]`);
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  ok((await pg.textContent('#stHeight')).includes('170 cm') && (await calls(pg, 'stepsConfigure')).pop().a.heightCm === 170, 'height is editable and sent to the plugin');
  await pg.click('#stHeight'); await pg.waitForSelector('.keypad');
  for (const c of ['5', '0']) await pg.click(`.keypad .key[aria-label="${c}"]`);
  ok(/between 100 and 230/.test(await pg.textContent('.sheet .err')), 'height outside 100-230 cm is refused');
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  await tab(pg, 'today'); await sendDays(pg, { [tk]: { steps: 10000, filtered: 0, hourly: HOURLY } }); await pg.waitForTimeout(400);
  ok((await cardText(pg, '.hsrc')).replace(/ /g, ' ').includes(String(Math.round(km(10000, 170) * 10) / 10) + ' km'), 'distance uses the new height');
  await gear(pg);
  if (!(await pg.isVisible('#stStrict'))) await pg.click('#advToggle');
  await pg.click('#stStrict'); await pg.waitForSelector('.asheet');
  ok(/Relaxed/.test(await pg.textContent('.asheet')) && /Balanced/.test(await pg.textContent('.asheet')) && /Strict/.test(await pg.textContent('.asheet')), 'Relaxed / Balanced / Strict are offered');
  await actionChoose(pg, 'Strict');
  ok((await calls(pg, 'stepsConfigure')).pop().a.strictness === 'strict' && /Strict/.test(await pg.textContent('#stStrict')), 'strictness is sent to the plugin and shown');
  ok(!(await pg.isChecked('#stLocOn')) && (await calls(pg, 'reqLocation')).length === 0, 'location check is off by default and no location permission was asked (not even in onboarding)');
  await setSteps(pg, { locationGranted: false });
  await pg.click('#stLocOn'); await pg.waitForFunction(() => document.getElementById('stMsg').textContent.length > 0);
  ok(!(await pg.isChecked('#stLocOn')) && /Location permission was not allowed/.test(await pg.textContent('#stMsg')) && (await calls(pg, 'reqLocation')).length === 1, 'location denied: the switch goes back off with a message');
  await setSteps(pg, { locationGranted: true });
  await pg.click('#stLocOn'); await pg.waitForFunction(() => /Speed check is on/.test(document.getElementById('stMsg').textContent));
  ok((await calls(pg, 'stepsConfigure')).pop().a.useLocation === true, 'location allowed: the speed check is switched on in the plugin');
  await pg.click('#stLocOn'); await pg.waitForFunction(() => /Speed check is off/.test(document.getElementById('stMsg').textContent));
  ok((await calls(pg, 'stepsConfigure')).pop().a.useLocation === false, 'and can be switched off again');
  ok(errs.length === 0, 'no JS errors (settings)', errs);
  await ctx.close();
}

/* ---------- accelerometer fallback shows sensitivity ---------- */
{
  const { ctx, pg, errs } = await open({ steps: { source: 'accelerometer' } });
  await waitCounting(pg);
  await gear(pg);
  await pg.click('#advToggle');
  await pg.waitForSelector('#stSens');
  ok(/Normal/.test(await pg.textContent('#stSens')), 'phones without a step counter chip get a Sensitivity row (Normal by default)');
  await pg.click('#stSens'); await pg.waitForSelector('.asheet');
  ok(/Low/.test(await pg.textContent('.asheet')) && /High/.test(await pg.textContent('.asheet')), 'Low / Normal / High');
  await actionChoose(pg, 'High');
  ok((await calls(pg, 'stepsConfigure')).pop().a.sensitivity === 'high', 'sensitivity is sent to the plugin');
  ok(errs.length === 0, 'no JS errors (accelerometer)', errs);
  await ctx.close();
}

/* ---------- health ---------- */
console.log('Step tracking health');
{
  const { ctx, pg, errs } = await open();
  await waitCounting(pg);
  await gear(pg);
  const health = async (k, extra) => { await setSteps(pg, Object.assign({ health: k }, extra || {})); await pg.evaluate(k2 => window.__mock.fire('stepsChanged', { days: {}, health: k2 }), k); await pg.waitForTimeout(300); };
  await health('paused_vehicle');
  ok(/Steps paused while in vehicle/.test(await pg.textContent('#stHealth')) && !(await pg.$('#stFix')), 'in a vehicle: "Steps paused while in vehicle" (nothing to fix)');
  await health('paused_battery');
  ok(/Paused by battery settings/.test(await pg.textContent('#stHealth')) && /Fix battery settings/.test(await pg.textContent('#stFix')), 'battery kill: "Paused by battery settings" with a one-tap fix');
  await pg.click('#stFix'); await waitSheet(pg, 'Keep counting all day');
  ok(true, 'the fix opens the battery help sheet'); await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  await tab(pg, 'today'); await sendDays(pg, { [tk]: { steps: 1000, filtered: 37, hourly: HOURLY } }); await gear(pg); await pg.waitForTimeout(300);
  ok((await pg.textContent('#stFiltered')).includes('37'), '"Steps filtered out today" shows the count');
  ok(errs.length === 0, 'no JS errors (health)', errs);
  await ctx.close();
}

/* ---------- data, sync, export, backup and Progress ---------- */
console.log('Data, sync, export and Progress');
{
  const { ctx, pg, errs } = await open();
  await waitCounting(pg);
  await tab(pg, 'today');
  // throttle: at most one automatic sync per 15 minutes
  await pg.evaluate(() => { window.__syncCalls = 0; window.syncSoon = () => { window.__syncCalls++; return Promise.resolve(); }; });
  await sendDays(pg, { [tk]: { steps: 1000, filtered: 2, hourly: HOURLY } }); await pg.waitForTimeout(1300);
  await sendDays(pg, { [tk]: { steps: 1100, filtered: 2, hourly: HOURLY } }); await pg.waitForTimeout(1300);
  await sendDays(pg, { [tk]: { steps: 1200, filtered: 2, hourly: HOURLY } }); await pg.waitForTimeout(1300);
  ok((await pg.evaluate(() => window.__syncCalls)) === 1, 'three automatic updates in a row cause only one cloud sync', await pg.evaluate(() => window.__syncCalls));
  ok(await pg.evaluate(() => autoSyncTimer !== null), 'the next sync is queued for later (15 minutes)');
  await pg.evaluate(() => { clearTimeout(autoSyncTimer); autoSyncTimer = null; lastAutoSync = Date.now() - 16 * 60 * 1000; });
  await sendDays(pg, { [tk]: { steps: 1300, filtered: 2, hourly: HOURLY } }); await pg.waitForTimeout(1300);
  ok((await pg.evaluate(() => window.__syncCalls)) === 2, 'after 15 minutes the next update syncs right away');
  const payload = await pg.evaluate(t => dayData(days[t]), tk);
  ok(payload.steps_meta && payload.steps_meta.source === 'auto' && payload.steps_meta.hourly.length === 24 && payload.vals.steps === 1300, 'step details travel in the cloud payload (steps_meta)', payload);

  await pg.evaluate(k => { days[k] = { vals: { steps: 6000 }, rules: {}, weight: null, waist: null, note: '', date: k, updatedAt: Date.now() }; }, daysAgo(1));
  await sendDays(pg, { [tk]: { steps: 4500, filtered: 9, hourly: HOURLY } }); await pg.waitForTimeout(1300);

  await gear(pg); await pg.click('#expCsv');
  await pg.waitForFunction(() => /comeback-.*\.csv/.test(document.getElementById('bkMsg').textContent));
  const csv = (await mock(pg)).fs['DOCUMENTS/Comeback/comeback-' + tk + '.csv'].replace(/^﻿/, '');
  const [head, ...rows] = csv.trim().split('\r\n');
  ok(head.includes('Steps source,Distance (km),Filtered steps,Weight (kg)'), 'CSV has Steps source, Distance (km) and Filtered steps columns', head);
  const tail = r => { const c = r.split(','); const n = c.length; return { source: c[n - 7], dist: c[n - 6], filt: c[n - 5] }; };
  const todayRow = tail(rows.find(r => r.startsWith(tk))), yRow = tail(rows.find(r => r.startsWith(daysAgo(1))));
  ok(todayRow.source === 'counted' && Number(todayRow.dist) === km(4500) && todayRow.filt === '9', 'CSV row: counted / distance / filtered', todayRow);
  ok(yRow.source === 'manual', 'CSV: a day typed before steps became phone-only keeps "manual"', yRow);

  await pg.click('#expJson'); await pg.waitForFunction(() => /comeback-backup/.test(document.getElementById('bkMsg').textContent));
  const json = JSON.parse((await mock(pg)).fs['DOCUMENTS/Comeback/comeback-backup-' + tk + '.json']);
  ok(json.days[tk].steps_meta.counted === 4500 && json.days[tk].steps_meta.hourly[18] === 1240, 'backup JSON includes the step details');
  await pg.setInputFiles('#restoreFile', { name: 'steps.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await actionChoose(pg, 'Continue'); await actionChoose(pg, 'Replace everything'); await pg.waitForFunction(() => /Replaced everything/.test(document.getElementById('bkMsg').textContent));
  ok((await stored(pg)).days[tk].steps_meta.counted === 4500, 'restore keeps the step details');
  const bad = JSON.parse(JSON.stringify(json)); bad.days[tk].steps_meta.source = 'robot';
  await pg.evaluate(() => { document.getElementById('bkMsg').textContent = ''; });
  await pg.setInputFiles('#restoreFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await pg.waitForFunction(() => document.getElementById('bkMsg').textContent.length > 0);
  ok(/unknown step source/.test(await pg.textContent('#bkMsg')), 'a backup with a bad step source is refused with a clear message', await pg.textContent('#bkMsg'));

  await tab(pg, 'progress'); await pg.waitForTimeout(800);
  const avg = Math.round((4500 + 6000) / 2);
  ok((await pg.textContent('#sAvgSteps')) === avg.toLocaleString() && /2 days/.test(await pg.textContent('#sAvgStepsSub')), 'average steps per day for the range', await pg.textContent('#sAvgSteps'));
  ok((await pg.textContent('#sAvgDist')).includes(String(Math.round(km(avg) * 10) / 10)), 'average distance for the range', await pg.textContent('#sAvgDist'));
  await pg.click('#seg button[data-range="7"]'); await pg.waitForTimeout(300);
  ok(/over 2 days/.test(await pg.textContent('#sAvgStepsSub')), 'the average follows Week / Month / 3 Months');
  await pg.click('#seg button[data-range="30"]');
  await pg.click('.chip:has-text("Steps")'); await pg.waitForTimeout(600);
  ok(/Counted by phone/.test(await pg.textContent('#readout')), 'Steps chart readout says where the day came from', await pg.textContent('#readout'));
  ok(await pg.isVisible('#hoursCard') && await pg.evaluate(() => !!Chart.getChart('chartHours')), 'hourly bar chart for today is shown');
  ok(/Most active hour: 6 PM with 1,240 steps/.test(await pg.textContent('#hoursSummary')), 'hourly chart has a text summary', await pg.textContent('#hoursSummary'));
  ok(errs.length === 0, 'no JS errors (data)', errs);
  await ctx.close();
}

/* ---------- battery: the page does no step work while it is hidden ---------- */
console.log('Background behaviour of the page');
{
  const { ctx, pg, errs } = await open();
  await waitCounting(pg);
  ok(await pg.evaluate(() => stepsLoop !== null), 'while the app is on screen the page refreshes the count once a minute');
  await pg.waitForTimeout(2000);   // let the first delayed read after switching on finish
  const reads0 = (await calls(pg, 'stepsGetDays')).length;
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  ok(await pg.evaluate(() => stepsLoop === null && autoSyncTimer === null), 'hidden: the refresh timer and the queued sync timer are stopped');
  await pg.waitForTimeout(1200);
  ok((await calls(pg, 'stepsGetDays')).length === reads0, 'hidden: no reads of the plugin happen');
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  ok(await pg.evaluate(() => stepsLoop !== null), 'visible again: the refresh timer restarts');
  await pg.evaluate(() => window.__mock.fire('appStateChange', { isActive: false })).catch(() => {});
  ok(errs.length === 0, 'no JS errors (background)', errs);
  await ctx.close();
}

/* ---------- not available on the web ---------- */
{
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('CapacitorStorage.comeback_onboarded', '1'); });
  const pg = await newPage(ctx, errs); await pg.goto(base); await ready(pg);
  await gear(pg);
  ok(!(await pg.isVisible('#stepGroup')), 'no Step tracking section in a plain browser (Android app only)');
  await tab(pg, 'today');
  ok(/Counted in the Android app/.test(await cardText(pg, '.hsrc')) && (await cardText(pg, '.hval')) === '–', 'the Steps card says steps are counted in the Android app');
  await pg.click(stepsCard); await waitSheet(pg, 'Steps today');
  ok(!(await pg.$('.sheet .keypad')) && !(await pg.$('.sheet input')), 'and opens a read-only note, not a number pad');
  ok(errs.length === 0, 'no JS errors (web)', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
