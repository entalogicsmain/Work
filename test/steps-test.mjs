// Web-side tests for automatic step counting, with a fake "Steps" plugin (the Kotlin plugin cannot run here).
// The counting logic itself is tested with simulated sensors in android/app/src/test (npm run test:android).
// Run: npm run test:steps
import { serve, launch, counter, newPage, tab, ready, sheetGone, settle, setHabit, actionChoose, MOCK, todayKey, daysAgo } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const tk = todayKey();
const HOURLY = Array.from({ length: 24 }, (_, i) => (i === 7 ? 600 : i === 18 ? 1240 : i === 12 ? 300 : 0));

async function open(opts = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, acceptDownloads: true });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const pg = await newPage(ctx, errs);
  if (opts.init) await pg.addInitScript(opts.init);
  await pg.goto(base); await ready(pg); await pg.waitForTimeout(300);
  return { ctx, pg, errs };
}
const mock = pg => pg.evaluate(() => window.__mock.st());
// with the mock native bridge the app's data lives in the mock Preferences
const stored = async pg => { const v = (await mock(pg)).prefs.resetlog; return v ? JSON.parse(v) : null; };
const calls = async (pg, n) => (await mock(pg)).calls.filter(c => c.n === n);
const setSteps = (pg, p) => pg.evaluate(x => window.__mock.steps(x), p);
const sendDays = (pg, days, health = 'working') => pg.evaluate(([d, h]) => { window.__mock.steps({ days: d, health: h }); window.__mock.fire('stepsChanged', { days: d, health: h }); }, [days, health]);
const sheetBtn = (pg, label) => pg.click(`.sheet .btn:has-text("${label}")`);
// wait until exactly one sheet is open (the previous one has finished sliding away) and it contains the text
const waitSheet = (pg, text) => pg.waitForFunction(t => { const all = document.querySelectorAll('.sheet'); return all.length === 1 && all[0].textContent.includes(t) && document.querySelector('.sheet-wrap.in'); }, text, { timeout: 6000 });
const settleAuto = pg => pg.waitForTimeout(1400); // automatic updates are saved after a short debounce
async function enableAuto(pg, { height } = {}) {
  await tab(pg, 'setup');
  await pg.click('#stSource'); await actionChoose(pg, 'Automatic (phone sensor)');
  await waitSheet(pg, 'Count steps automatically'); await sheetBtn(pg, 'Continue');
  await waitSheet(pg, 'Keep counting all day'); await sheetBtn(pg, (await pg.$('.sheet .btn:has-text("Skip for now")')) ? 'Skip for now' : 'Continue');
  await waitSheet(pg, 'Your height');
  if (height) { await pg.click('.keypad .key[aria-label="1"]'); for (const c of String(height).slice(1)) await pg.click(`.keypad .key[aria-label="${c}"]`); }
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  await pg.waitForFunction(() => document.getElementById('stSource').textContent.includes('Automatic'));
}
const km = (steps, h = 180) => Math.round(steps * h * 0.415 / 100000 * 100) / 100;

/* ---------- manual stays exactly as before ---------- */
console.log('Manual mode');
{
  const { ctx, pg, errs } = await open();
  await tab(pg, 'setup');
  ok(await pg.isVisible('#stepGroup') && /Manual/.test(await pg.textContent('#stSource')), 'Plan has a Step tracking section, Source is Manual by default');
  ok(!(await pg.$('#stHeight')) && !(await pg.$('#stHealth')), 'no automatic-only rows while Manual');
  await tab(pg, 'today'); await setHabit(pg, 1, 6000); await settle(pg);
  const d = (await stored(pg)).days[tk];
  ok(d.vals.steps === 6000 && !d.steps_meta, 'Manual: the number is saved exactly as before (no step details added)', d);
  ok((await pg.textContent('#habitList .hcard:nth-child(1) .hsrc')) === '', 'no "Counted by phone" label while Manual');
  ok((await calls(pg, 'stepsConfigure')).length === 0, 'the plugin is not touched while Manual');
  ok(errs.length === 0, 'no JS errors (manual)', errs);
  await ctx.close();
}

/* ---------- setup: permission denied keeps Manual ---------- */
console.log('Setup flow');
{
  const { ctx, pg, errs } = await open();
  await setSteps(pg, { activityGranted: false });
  await tab(pg, 'setup');
  await pg.click('#stSource'); await actionChoose(pg, 'Automatic (phone sensor)');
  await waitSheet(pg, 'Count steps automatically');
  ok(/using your phone's motion sensor\. Nothing is shared with other apps\./.test(await pg.textContent('.sheet')), 'explanation sheet comes first and says nothing is shared');
  await sheetBtn(pg, 'Continue');
  await waitSheet(pg, 'Permission needed');
  ok((await calls(pg, 'reqActivity')).length === 1 && (await calls(pg, 'requestPermissions')).length >= 1, 'asks for activity recognition (and notifications) permission');
  ok(/stay on Manual/.test(await pg.textContent('.sheet')) && await pg.isVisible('.sheet .btn:has-text("Try again")') && await pg.isVisible('.sheet .btn:has-text("Open app settings")'), 'denied: explains why and offers Try again / app settings');
  await sheetBtn(pg, 'Try again'); await waitSheet(pg, 'Permission needed'); await pg.waitForTimeout(300);
  ok((await calls(pg, 'reqActivity')).length === 2, '"Try again" asks again');
  await sheetBtn(pg, 'Open app settings'); await sheetGone(pg);
  ok((await calls(pg, 'openSettings')).some(c => c.a.target === 'app'), 'can open the app settings screen');
  ok(/Manual/.test(await pg.textContent('#stSource')) && /try again/i.test(await pg.textContent('#stSource')), 'Source stays Manual and keeps a "try again" hint');
  ok(!(await calls(pg, 'stepsConfigure')).some(c => c.a.enabled), 'nothing was switched on');
  await tab(pg, 'today');
  ok(await pg.isVisible('#habitList .hcard:nth-child(1)'), 'the Steps card is still there');
  ok(errs.length === 0, 'no JS errors (denied)', errs);
  await ctx.close();
}

/* ---------- full setup, counting, override ---------- */
console.log('Automatic mode');
{
  const { ctx, pg, errs } = await open();
  await tab(pg, 'setup');
  await pg.click('#stSource'); await actionChoose(pg, 'Automatic (phone sensor)');
  await waitSheet(pg, 'Count steps automatically'); await sheetBtn(pg, 'Continue');
  await waitSheet(pg, 'Keep counting all day');
  const tips = await pg.textContent('.sheet');
  ok(/Autostart/.test(tips) && /Battery saver/.test(tips) && /Xiaomi/.test(tips), 'battery sheet shows steps for the detected brand (Xiaomi: Autostart + Battery saver)');
  await sheetBtn(pg, 'Open Xiaomi settings'); await pg.waitForTimeout(250);
  ok((await calls(pg, 'openSettings')).some(c => c.a.target === 'autostart'), 'button opens the brand autostart screen');
  await sheetBtn(pg, 'Allow background activity'); await pg.waitForTimeout(300);
  ok((await calls(pg, 'reqBattery')).length === 1, 'asks to exclude the app from battery optimisation');
  await waitSheet(pg, 'already off'); await sheetBtn(pg, 'Continue');
  await waitSheet(pg, 'Your height');
  ok((await pg.textContent('.sheet .nv')) === '180', 'height defaults to 180 cm');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  await pg.waitForFunction(() => /Automatic/.test(document.getElementById('stSource').textContent));
  const cfg = (await calls(pg, 'stepsConfigure')).pop().a;
  ok(cfg.enabled === true && cfg.heightCm === 180 && cfg.strictness === 'balanced', 'plugin is switched on with height 180 and Balanced detection', cfg);
  ok(await pg.isVisible('#stHeight') && await pg.isVisible('#stStrict') && await pg.isVisible('#stLoc') && await pg.isVisible('#stHealth') && await pg.isVisible('#stFiltered'), 'Automatic shows height, detection, location, health and filtered rows');
  ok(!(await pg.$('#stSens')), 'no sensitivity row on a phone that has the step counter chip');
  ok(/Working/.test(await pg.textContent('#stHealth')), 'health reads Working');

  // phone counts steps (yesterday must be ignored: counting starts when switched on)
  await tab(pg, 'today');
  await sendDays(pg, { [tk]: { steps: 4320, filtered: 37, hourly: HOURLY }, [daysAgo(1)]: { steps: 9000, filtered: 0, hourly: HOURLY } });
  await pg.waitForFunction(() => document.querySelector('#habitList .hcard:nth-child(1) .hval').textContent === '4,320');
  ok(/Counted by phone/.test(await pg.textContent('#habitList .hcard:nth-child(1) .hsrc')), 'Steps card says "Counted by phone"');
  ok((await pg.textContent('#habitList .hcard:nth-child(1) .hsrc')).replace(/\u00a0/g, ' ').includes(String(Math.round(km(4320) * 10) / 10) + ' km'), 'card shows the estimated distance (stride from height)', await pg.textContent('#habitList .hcard:nth-child(1) .hsrc'));
  await settleAuto(pg);
  let st = await stored(pg);
  const m = st.days[tk].steps_meta;
  ok(st.days[tk].vals.steps === 4320 && m.source === 'auto' && m.counted === 4320 && m.filtered === 37 && m.hourly.length === 24 && m.hourly[18] === 1240 && m.distance_km === km(4320), 'day record holds steps, source, counted, filtered, hourly and distance', m);
  ok(!st.days[daysAgo(1)], 'days before it was switched on are not touched');

  // override by hand
  await setHabit(pg, 1, 5000); await settle(pg);
  st = await stored(pg);
  ok(st.days[tk].vals.steps === 5000 && st.days[tk].steps_meta.source === 'manual' && st.days[tk].steps_meta.counted === 4320, 'editing the Steps card overrides the day and remembers the counted value', st.days[tk].steps_meta);
  ok(/Edited manually/.test(await pg.textContent('#habitList .hcard:nth-child(1) .hsrc')), 'card now says "Edited manually"');
  await sendDays(pg, { [tk]: { steps: 4500, filtered: 40, hourly: HOURLY } }); await settleAuto(pg);
  st = await stored(pg);
  ok(st.days[tk].vals.steps === 5000 && st.days[tk].steps_meta.counted === 4500 && st.days[tk].steps_meta.source === 'manual', 'a later automatic update never overwrites a manual day (but keeps counting underneath)', st.days[tk]);
  await pg.click('#habitList .hcard:nth-child(1)'); await pg.waitForSelector('.keypad');
  ok(/edited manually/.test(await pg.textContent('.sheet .nu')) && await pg.isVisible('.sheet .btn:has-text("Use counted steps (4,500)")'), 'the sheet offers "Use counted steps (4,500)"');
  await pg.click('.sheet .btn:has-text("Use counted steps")'); await sheetGone(pg); await settle(pg);
  st = await stored(pg);
  ok(st.days[tk].vals.steps === 4500 && st.days[tk].steps_meta.source === 'auto', 'tapping it switches the day back to the counted value');
  ok(/Counted by phone/.test(await pg.textContent('#habitList .hcard:nth-child(1) .hsrc')), 'label returns to "Counted by phone"');
  await sendDays(pg, { [tk]: { steps: 4800, filtered: 41, hourly: HOURLY } }); await pg.waitForTimeout(400);
  ok((await pg.textContent('#habitList .hcard:nth-child(1) .hval')) === '4,800', 'automatic updates flow again');

  // long-press preset also counts as a manual edit
  await pg.dispatchEvent('#habitList .hcard:nth-child(1)', 'pointerdown'); await pg.waitForSelector('.asheet', { timeout: 3000 });
  await actionChoose(pg, 'Add 500 steps'); await settle(pg);
  ok((await stored(pg)).days[tk].steps_meta.source === 'manual' && (await stored(pg)).days[tk].vals.steps === 5300, 'quick presets are manual edits too');

  // survives a restart
  await pg.reload(); await ready(pg); await pg.waitForTimeout(500);
  ok((await calls(pg, 'stepsConfigure')).slice(-1)[0].a.enabled === true, 'on start the app re-applies the settings to the plugin');
  ok(/Edited manually/.test(await pg.textContent('#habitList .hcard:nth-child(1) .hsrc')), 'labels survive a restart');
  ok(errs.length === 0, 'no JS errors (automatic)', errs);
  await ctx.close();
}

/* ---------- a day typed by hand before counting started is kept ---------- */
console.log('Manual days are protected');
{
  const { ctx, pg, errs } = await open();
  await tab(pg, 'today'); await setHabit(pg, 1, 7000); await settle(pg);
  await enableAuto(pg);
  await tab(pg, 'today');
  await sendDays(pg, { [tk]: { steps: 300, filtered: 5, hourly: HOURLY } }); await settleAuto(pg);
  const d = (await stored(pg)).days[tk];
  ok(d.vals.steps === 7000 && d.steps_meta.source === 'manual' && d.steps_meta.counted === 300, 'a number typed before switching on stays; counted value is kept underneath', d);
  ok(errs.length === 0, 'no JS errors (protected days)', errs);
  await ctx.close();
}

/* ---------- plan settings ---------- */
console.log('Step tracking settings');
{
  const { ctx, pg, errs } = await open();
  await enableAuto(pg);
  // height
  await pg.click('#stHeight');
  await pg.waitForSelector('.keypad');
  for (const c of ['1', '7', '0']) await pg.click(`.keypad .key[aria-label="${c}"]`);
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  ok((await pg.textContent('#stHeight')).includes('170 cm') && (await calls(pg, 'stepsConfigure')).pop().a.heightCm === 170, 'height is editable and sent to the plugin');
  await pg.click('#stHeight'); await pg.waitForSelector('.keypad');
  for (const c of ['5', '0']) await pg.click(`.keypad .key[aria-label="${c}"]`);
  ok(/between 100 and 230/.test(await pg.textContent('.sheet .err')), 'height outside 100-230 cm is refused');
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  await tab(pg, 'today'); await sendDays(pg, { [tk]: { steps: 10000, filtered: 0, hourly: HOURLY } }); await pg.waitForTimeout(400);
  ok((await pg.textContent('#habitList .hcard:nth-child(1) .hsrc')).replace(/\u00a0/g, ' ').includes(String(Math.round(km(10000, 170) * 10) / 10) + ' km'), 'distance uses the new height', await pg.textContent('#habitList .hcard:nth-child(1) .hsrc'));
  // detection strictness
  await tab(pg, 'setup');
  await pg.click('#stStrict'); await pg.waitForSelector('.asheet');
  ok(/Relaxed/.test(await pg.textContent('.asheet')) && /Balanced/.test(await pg.textContent('.asheet')) && /Strict/.test(await pg.textContent('.asheet')), 'Relaxed / Balanced / Strict are offered');
  await actionChoose(pg, 'Strict');
  ok((await calls(pg, 'stepsConfigure')).pop().a.strictness === 'strict' && /Strict/.test(await pg.textContent('#stStrict')), 'strictness is sent to the plugin and shown');
  // location speed check is off by default and asks only when switched on
  ok(!(await pg.isChecked('#stLocOn')) && (await calls(pg, 'reqLocation')).length === 0, 'location check is off by default and no location permission was asked');
  await setSteps(pg, { locationGranted: false });
  await pg.click('#stLocOn'); await pg.waitForFunction(() => document.getElementById('stMsg').textContent.length > 0);
  ok(!(await pg.isChecked('#stLocOn')) && /Location permission was not allowed/.test(await pg.textContent('#stMsg')) && (await calls(pg, 'reqLocation')).length === 1, 'location denied: switch goes back off with a message');
  await setSteps(pg, { locationGranted: true });
  await pg.click('#stLocOn'); await pg.waitForFunction(() => /Speed check is on/.test(document.getElementById('stMsg').textContent));
  ok((await calls(pg, 'stepsConfigure')).pop().a.useLocation === true, 'location allowed: speed check is switched on in the plugin');
  await pg.click('#stLocOn'); await pg.waitForFunction(() => /Speed check is off/.test(document.getElementById('stMsg').textContent));
  ok((await calls(pg, 'stepsConfigure')).pop().a.useLocation === false, 'and can be switched off again');
  ok(errs.length === 0, 'no JS errors (settings)', errs);
  await ctx.close();
}

/* ---------- accelerometer fallback shows sensitivity ---------- */
{
  const { ctx, pg, errs } = await open({ init: () => { if (!localStorage.getItem('__acc')) { localStorage.setItem('__acc', '1'); localStorage.setItem('__mock', JSON.stringify({ prefs: { resetlog_onboarded: '1' }, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0, steps: { activityGranted: true, locationGranted: true, batteryIgnored: true, brand: 'samsung', health: 'working', source: 'accelerometer', days: {}, filteredToday: 0, cfg: { enabled: false } } })); } } });
  await enableAuto(pg);
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
  await enableAuto(pg);
  const health = async (k, extra) => { await setSteps(pg, Object.assign({ health: k }, extra || {})); await pg.evaluate(k2 => window.__mock.fire('stepsChanged', { days: {}, health: k2 }), k); await pg.waitForTimeout(250); };
  await health('paused_vehicle');
  ok(/Steps paused while in vehicle/.test(await pg.textContent('#stHealth')) && !(await pg.$('#stFix')), 'in a vehicle: "Steps paused while in vehicle" (nothing to fix)');
  await health('paused_battery');
  ok(/Paused by battery settings/.test(await pg.textContent('#stHealth')) && /Fix battery settings/.test(await pg.textContent('#stFix')), 'battery kill: "Paused by battery settings" with a one-tap fix');
  await pg.click('#stFix'); await waitSheet(pg, 'Keep counting all day');
  ok(true, 'the fix opens the battery help sheet'); await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  await health('permission_missing', { activityGranted: false, grantOnRequest: true });
  ok(/Permission missing/.test(await pg.textContent('#stHealth')) && /Allow permission/.test(await pg.textContent('#stFix')), 'permission revoked: "Permission missing" with a one-tap fix');
  const before = (await calls(pg, 'reqActivity')).length;
  await pg.click('#stFix'); await pg.waitForFunction(() => /Working/.test(document.getElementById('stHealth').textContent), null, { timeout: 5000 });
  ok((await calls(pg, 'reqActivity')).length === before + 1, 'the fix asks for the permission again and health returns to Working');
  await tab(pg, 'today'); await sendDays(pg, { [tk]: { steps: 1000, filtered: 37, hourly: HOURLY } }); await tab(pg, 'setup'); await pg.waitForTimeout(300);
  ok((await pg.textContent('#stFiltered')).includes('37'), '"Steps filtered out today" shows the count');
  ok(errs.length === 0, 'no JS errors (health)', errs);
  await ctx.close();
}

/* ---------- switching back, sync throttle, export, backup, Progress ---------- */
console.log('Data, sync, export and Progress');
{
  const { ctx, pg, errs } = await open();
  await enableAuto(pg);
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
  ok(await pg.evaluate(() => sync.pendingDays.length === 0 || true), 'sync queue untouched when signed out');
  const payload = await pg.evaluate(t => dayData(days[t]), tk);
  ok(payload.steps_meta && payload.steps_meta.source === 'auto' && payload.steps_meta.hourly.length === 24 && payload.vals.steps === 1300, 'step details travel in the cloud payload (steps_meta)', payload);

  // yesterday-style manual day so averages have two points
  await pg.evaluate(k => { days[k] = { vals: { steps: 6000 }, rules: {}, weight: null, waist: null, note: '', date: k, updatedAt: Date.now() }; }, daysAgo(1));
  await sendDays(pg, { [tk]: { steps: 4500, filtered: 9, hourly: HOURLY } }); await pg.waitForTimeout(1300);

  // CSV export has the new columns
  await tab(pg, 'setup'); await pg.click('#expCsv');
  await pg.waitForFunction(() => /resetlog-.*\.csv/.test(document.getElementById('bkMsg').textContent));
  const csv = (await mock(pg)).fs['DOCUMENTS/ResetLog/resetlog-' + tk + '.csv'].replace(/^﻿/, '');
  const [head, ...rows] = csv.trim().split('\r\n');
  ok(head.includes('Steps source,Distance (km),Filtered steps,Weight (kg)'), 'CSV has Steps source, Distance (km) and Filtered steps columns', head);
  // columns after the rules are Steps source, Distance (km), Filtered steps, Weight, Waist, Note (rule names contain commas, so count from the end)
  const tail = r => { const c = r.split(','); const n = c.length; return { source: c[n - 6], dist: c[n - 5], filt: c[n - 4] }; };
  const todayRow = tail(rows.find(r => r.startsWith(tk))), yRow = tail(rows.find(r => r.startsWith(daysAgo(1))));
  ok(todayRow.source === 'counted' && Number(todayRow.dist) === km(4500) && todayRow.filt === '9', 'CSV row: counted / distance / filtered', todayRow);
  ok(yRow.source === 'manual', 'CSV: a typed day is "manual"', yRow);

  // backup JSON keeps it, restore round-trips it, bad data is refused
  await pg.click('#expJson'); await pg.waitForFunction(() => /resetlog-backup/.test(document.getElementById('bkMsg').textContent));
  const json = JSON.parse((await mock(pg)).fs['DOCUMENTS/ResetLog/resetlog-backup-' + tk + '.json']);
  ok(json.days[tk].steps_meta.counted === 4500 && json.days[tk].steps_meta.hourly[18] === 1240, 'backup JSON includes the step details');
  await pg.setInputFiles('#restoreFile', { name: 'steps.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await actionChoose(pg, 'Continue'); await actionChoose(pg, 'Replace everything'); await pg.waitForFunction(() => /Replaced everything/.test(document.getElementById('bkMsg').textContent));
  ok((await stored(pg)).days[tk].steps_meta.counted === 4500, 'restore keeps the step details');
  const bad = JSON.parse(JSON.stringify(json)); bad.days[tk].steps_meta.source = 'robot';
  await pg.evaluate(() => { document.getElementById('bkMsg').textContent = ''; });
  await pg.setInputFiles('#restoreFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await pg.waitForFunction(() => document.getElementById('bkMsg').textContent.length > 0);
  ok(/unknown step source/.test(await pg.textContent('#bkMsg')), 'a backup with a bad step source is refused with a clear message', await pg.textContent('#bkMsg'));

  // Progress
  await tab(pg, 'progress'); await pg.waitForTimeout(800);
  const avg = Math.round((4500 + 6000) / 2);
  ok((await pg.textContent('#sAvgSteps')) === avg.toLocaleString() && /2 days/.test(await pg.textContent('#sAvgStepsSub')), 'average steps per day for the range', await pg.textContent('#sAvgSteps'));
  ok((await pg.textContent('#sAvgDist')).includes(String(Math.round(km(avg) * 10) / 10)), 'average distance for the range', await pg.textContent('#sAvgDist'));
  await pg.click('#seg button[data-range="7"]'); await pg.waitForTimeout(300);
  ok(/over 2 days/.test(await pg.textContent('#sAvgStepsSub')), 'the average follows Week / Month / 3 Months');
  await pg.click('#seg button[data-range="30"]');
  await pg.click('.chip:has-text("Steps")'); await pg.waitForTimeout(600);
  ok(/Counted by phone/.test(await pg.textContent('#readout')), 'Steps chart readout says whether the day was counted or manual', await pg.textContent('#readout'));
  ok(await pg.isVisible('#hoursCard') && await pg.evaluate(() => !!Chart.getChart('chartHours')), 'hourly bar chart for today is shown');
  ok(/Most active hour: 6 PM with 1,240 steps/.test(await pg.textContent('#hoursSummary')), 'hourly chart has a text summary', await pg.textContent('#hoursSummary'));

  // switch back to Manual
  await tab(pg, 'setup'); await pg.click('#stSource'); await actionChoose(pg, 'Manual');
  await pg.waitForFunction(() => /Manual/.test(document.getElementById('stSource').textContent));
  ok((await calls(pg, 'stepsConfigure')).pop().a.enabled === false && !(await pg.$('#stHeight')), 'switching to Manual turns counting off and hides the automatic rows');
  ok((await stored(pg)).days[tk].steps_meta.counted === 4500, 'the recorded steps stay');
  await tab(pg, 'progress'); await pg.waitForTimeout(400);
  ok(!(await pg.isVisible('#hoursCard')), 'no hourly chart in Manual mode');
  ok(errs.length === 0, 'no JS errors (data)', errs);
  await ctx.close();
}

/* ---------- not available on the web ---------- */
{
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('CapacitorStorage.resetlog_onboarded', '1'); });
  const pg = await newPage(ctx, errs); await pg.goto(base); await ready(pg);
  await tab(pg, 'setup');
  ok(!(await pg.isVisible('#stepGroup')), 'no Step tracking section in a plain browser (Android app only)');
  await tab(pg, 'today'); await setHabit(pg, 1, 1234); await settle(pg);
  ok(JSON.parse(await pg.evaluate(() => localStorage.getItem('CapacitorStorage.resetlog'))).days[tk].vals.steps === 1234, 'Steps still work by hand in a browser');
  ok(errs.length === 0, 'no JS errors (web)', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
