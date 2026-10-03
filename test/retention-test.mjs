// Retention features in the browser: light days and the streak shield (Today, calendar, backup), the weekly review (card on Today, tile on
// Progress, share), insights, and the goal weight (Settings, Progress chart and card, BMI sheet). The rules themselves are tested in core-test.mjs.
// Run: node test/retention-test.mjs
import { createRequire } from 'module';
import { serve, launch, counter, newPage, tab, gear, ready, settle, sheetGone, enterNumber, MOCK } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const Core = createRequire(import.meta.url)('../www/js/core.js');
const browser = await launch();

const V = { steps: 9000, pushups: 30, pullups: 5, squats: 30, plank: 60, walk: 30, water: 2.5, sleep: 7 };
const R = { nofried: true, nosugar: true, nomaida: true, nolate: true };
const mk = (k, over = {}, extra = {}) => Object.assign({ vals: Object.assign({}, V, over), rules: Object.assign({}, R), weight: null, waist: null, note: '', date: k, updatedAt: 1e12 }, extra);
const MON = '2026-10-05', FRI = '2026-10-02';
const at = (base0, n) => Core.addDays(base0, n);
const asDays = list => Object.fromEntries(list.map(d => [d.date, d]));

async function open({ now, days, settings, native = false, scheme = 'light', w = 390, h = 900, zoom } = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, timezoneId: 'America/New_York', locale: 'en-US', colorScheme: scheme });
  await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 }); } catch (e) {} });
  const st = settings || Core.defaultSettings();
  const payload = days ? { version: 2, settings: st, days } : null;
  if (native) {
    await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
    const prefs = { comeback_onboarded: '1' }; if (payload) prefs.comeback = JSON.stringify(payload);
    await ctx.addInitScript(sd => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); localStorage.setItem('__mock', JSON.stringify({ prefs: sd, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0, steps: { activityGranted: true, locationGranted: true, batteryIgnored: false, brand: 'other', health: 'working', source: 'counter', days: {}, filteredToday: 0, cfg: { enabled: false } } })); } }, prefs);
  } else {
    await ctx.addInitScript(sd => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); localStorage.setItem('CapacitorStorage.comeback_onboarded', '1'); if (sd) localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(sd)); } }, payload);
  }
  const pg = await newPage(ctx, errs);
  await pg.clock.install({ time: new Date(now) });
  await pg.goto(base); await ready(pg); await pg.waitForTimeout(450);
  if (zoom) { await pg.addStyleTag({ content: `html{font-size:${zoom}% !important}` }); await pg.waitForTimeout(300); }
  return { ctx, pg, errs };
}
const store = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.comeback')));
const text = (pg, sel) => pg.$eval(sel, e => e.textContent.trim().replace(/\s+/g, ' '));
const box = (pg, sel) => pg.$eval(sel, e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
const overflow = pg => pg.evaluate(() => { const vw = document.documentElement.clientWidth; const out = []; for (const el of document.querySelectorAll('.screen.on *')) { if (el.closest('.chips') || el.closest('svg') || el.tagName === 'CANVAS' || el.classList.contains('vh')) continue; const r = el.getBoundingClientRect(); if (r.width === 0) continue; if (r.right > vw + 1 || r.left < -1) out.push((el.id || el.className).toString().slice(0, 30)); } return { sw: document.documentElement.scrollWidth, vw, out: out.slice(0, 3) }; });

/* ============ light day ============ */
console.log('Light day');
{
  const days = asDays([-3, -2, -1].map(n => mk(at(FRI, n))));
  const { ctx, pg, errs } = await open({ now: FRI + 'T09:00:00-04:00', days });
  const btn = await box(pg, '#lightToggle');
  ok(btn.h >= 44 && btn.w >= 44, 'the light-day button next to Edit Today is a 44px target', btn);
  ok(await pg.$eval('#todayFoot', f => f.contains(document.getElementById('editToday')) && f.contains(document.getElementById('lightToggle'))), 'it sits in the Today footer with Edit Today');
  ok((await text(pg, '#lightToggle')) === 'Take it easy today' && (await pg.getAttribute('#lightToggle', 'aria-pressed')) === 'false', 'it says "Take it easy today" and is a toggle', await text(pg, '#lightToggle'));
  await pg.click('#lightToggle');
  await pg.waitForFunction(() => document.getElementById('todayHint').textContent.includes('Light day on'));
  ok((await text(pg, '#todayHint')) === 'Light day on. Just do what you can. Your streak is safe.', 'the hint says the day is light and the streak is safe', await text(pg, '#todayHint'));
  ok((await pg.getAttribute('#lightToggle', 'aria-pressed')) === 'true' && (await text(pg, '#lightToggle')) === 'Light day on', 'the button shows it is on');
  ok(/3-day streak · light day/.test(await text(pg, '#streakLine')), 'the streak line stays at 3 and says light day', await text(pg, '#streakLine'));
  ok(/Light day on/.test(await text(pg, '#toastMsg')) && await pg.isVisible('#toastUndo'), 'a toast confirms it, with Undo');
  await settle(pg);
  ok((await store(pg)).days[FRI].light === true, 'the day record carries light:true', (await store(pg)).days[FRI]);
  // Undo from the toast turns it off again; then on again from the button
  await pg.click('#toastUndo');
  await pg.waitForFunction(() => !document.getElementById('todayHint').textContent.includes('Light day on'));
  await pg.click('#lightToggle');
  await pg.waitForFunction(() => document.getElementById('todayHint').textContent.includes('Light day on'));
  await settle(pg);
  ok((await store(pg)).days[FRI].light === true, 'Undo turned it off and the button turned it on again');
  await tab(pg, 'progress'); await pg.waitForTimeout(400);
  const cell = await pg.$eval('#heat .hc.today', e => ({ cls: e.className, label: e.getAttribute('aria-label') }));
  ok(/\bl\b/.test(cell.cls) && /light day/.test(cell.label) && !/\b(g|o|r)\b/.test(cell.cls), 'the calendar shows a light day with its own style and label', cell);
  const sty = await pg.$eval('#heat .hc.today i', e => { const c = getComputedStyle(e); return { b: c.borderTopStyle, w: c.borderTopWidth }; });
  ok(sty.b === 'dashed' && sty.w === '2px', 'a light day is dashed (a shape, not just a colour)', sty);
  ok(await pg.$$eval('.heatcard .legend .rv-legend', e => e.map(x => x.textContent.trim()).join()) === 'Light day,Shield day', 'the legend names light and shield days');
  await tab(pg, 'today');
  // toggling off from the button
  await pg.click('#lightToggle'); await pg.waitForFunction(() => !document.getElementById('todayHint').textContent.includes('Light day on'));
  await settle(pg);
  ok(!(await store(pg)).days[FRI].light, 'turning it off removes the flag');
  // a past day
  await pg.click('#prevDay');
  ok((await text(pg, '#lightToggle')) === 'Mark as a light day', 'for a past day the button says "Mark as a light day"');
  await pg.click('#lightToggle'); await settle(pg);
  ok((await store(pg)).days[at(FRI, -1)].light === true, 'it can mark a past day');
  ok(/Light day on/.test(await text(pg, '#todayHint')), 'with the same hint');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ============ the morning after, and the shield ============ */
console.log('Welcome back and the streak shield');
{
  const days = asDays([-4, -3, -2].map(n => mk(at('2026-10-03', n))));
  days['2026-10-02'] = Object.assign(mk('2026-10-02', {}), { vals: {}, rules: {}, light: true });
  const { ctx, pg } = await open({ now: '2026-10-03T09:00:00-04:00', days });
  ok((await text(pg, '#todayHint')) === 'Welcome back. Pick up with one easy thing.', 'the day after a light day says "Welcome back. Pick up with one easy thing."', await text(pg, '#todayHint'));
  await ctx.close();
}
{
  // six kept days (25 Sep to 30 Sep), nothing on 1 Oct, today (2 Oct) not started
  const days = asDays([0, 1, 2, 3, 4, 5].map(n => mk(at('2026-09-25', n))));
  const { ctx, pg } = await open({ now: FRI + 'T09:00:00-04:00', days });
  ok((await text(pg, '#todayHint')) === 'Rest day used. Streak safe at 6.', 'a covered miss shows "Rest day used. Streak safe at 6."', await text(pg, '#todayHint'));
  ok(/^6-day streak/.test(await text(pg, '#streakLine')), 'and the streak is still 6', await text(pg, '#streakLine'));
  await tab(pg, 'progress'); await pg.waitForTimeout(400);
  const c = await pg.$eval('#heat .hc.sh', e => ({ label: e.getAttribute('aria-label'), text: e.textContent.trim(), cls: e.className }));
  ok(/shield day/.test(c.label) && c.text === '1', 'the covered day is marked "shield day" on the calendar', c);
  ok(await pg.$eval('#heat .hc.sh i', e => getComputedStyle(e).borderTopStyle) === 'dotted', 'dotted, so it differs from a light day by shape');
  await pg.click('#heat .hc.sh');
  await pg.waitForSelector('.sheet');
  ok(/Shield day/.test(await text(pg, '.sheet')), 'its sheet explains it');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  await ctx.close();
}

/* ============ weekly review card ============ */
console.log('Weekly review');
const week = (n0, over = {}) => [0, 1, 2, 3, 4, 5, 6].slice(0, n0).map(n => mk(at('2026-09-28', n), over));
{
  // last week: Mon-Fri logged, plank low on Wed to Fri; the week before: Mon-Wed
  const days = asDays([0, 1, 2].map(n => mk(at('2026-09-21', n))).concat([0, 1, 2, 3, 4].map(n => mk(at('2026-09-28', n), n >= 2 ? { plank: 20 } : {}))));
  const { ctx, pg, errs } = await open({ now: MON + 'T09:00:00-04:00', days });
  await pg.waitForSelector('#reviewCard');
  const t = await text(pg, '#reviewText');
  ok(/^Last week: 5 of 7 days kept \(up from 3\)\./.test(t) && /steadiest habit\./.test(t) && /Plank dipped\./.test(t), 'the card on Monday reads like the example', t);
  ok(/Keeping the plan as it is sounds right\.$/.test(t), 'and ends gently', t);
  ok(!/fail|bad|missed|should|behind/i.test(t), 'no blame in the wording');
  ok(await pg.$eval('#reviewCard', c => c.getBoundingClientRect().top < document.querySelector('#sections').getBoundingClientRect().top), 'it sits above the sections on Today');
  const bs = await Promise.all(['#rvKeep', '#rvLighten', '#rvDismiss'].map(s => box(pg, s)));
  ok(bs.every(b => b.h >= 44 && b.w >= 44), 'the choices and the dismiss button are 44px targets', bs);
  ok(await pg.$eval('#rvKeep', b => !b.classList.contains('secondary')) && await pg.$eval('#rvLighten', b => b.classList.contains('secondary')), 'a mixed week makes "Keep the plan" the main choice');
  ok((await pg.$('#rvRaise')) === null, 'nothing to raise after a mixed week');
  ok((await pg.$('#rvShare')) === null, 'no Share button in the browser (it needs the Android app)');
  ok(await pg.$eval('#reviewNote', i => !!i.labels[0] && i.labels[0].textContent.length > 5), 'the note box has a label');
  await pg.fill('#reviewNote', 'Felt tired midweek');
  await pg.click('#rvKeep');
  await pg.waitForFunction(() => !document.getElementById('reviewCard'));
  await settle(pg);
  const s1 = await store(pg);
  ok(/Weekly review: Felt tired midweek/.test(s1.days[MON].note), 'the note is saved into that day\'s note', s1.days[MON]);
  ok(await pg.evaluate(() => localStorage.getItem('CapacitorStorage.comeback_review_seen')) === '2026-09-28', 'the answer is remembered on the device under comeback_review_seen (the week start)');
  ok(JSON.stringify(s1.settings.habits.find(x => x.id === 'plank').target) === '60', 'keeping the plan changes nothing');
  await pg.reload(); await ready(pg); await pg.waitForTimeout(500);
  ok((await pg.$('#reviewCard')) === null, 'after a reload the review stays dismissed');
  await pg.click('#prevDay');
  ok((await pg.$('#reviewCard')) === null, 'and it is not shown on past days');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}
{
  // a hard week: Lighten the plan eases the habit that slipped, with Undo
  const days = asDays([0, 1, 2, 3].map(n => mk(at('2026-09-28', n), n >= 2 ? { plank: 20 } : {})));
  const { ctx, pg } = await open({ now: MON + 'T09:00:00-04:00', days });
  await pg.waitForSelector('#reviewCard');
  const t = await text(pg, '#reviewText');
  ok(/Keep the plan, or ease plank to 50 sec\?$/.test(t), 'a hard week offers to ease the habit that dipped', t);
  ok(await pg.$eval('#rvLighten', b => !b.classList.contains('secondary')), '"Lighten the plan" becomes the main choice');
  await pg.click('#rvLighten');
  await pg.waitForFunction(() => !document.getElementById('reviewCard'));
  await settle(pg);
  ok((await store(pg)).settings.habits.find(x => x.id === 'plank').target === 50, 'plank is now 50 sec');
  ok(/Plank is now 50 sec/.test(await text(pg, '#toastMsg')) && await pg.isVisible('#toastUndo'), 'a toast says so, with Undo', await text(pg, '#toastMsg'));
  await pg.click('#toastUndo'); await settle(pg);
  ok((await store(pg)).settings.habits.find(x => x.id === 'plank').target === 60, 'Undo puts the target back');
  await ctx.close();
}
{
  // a strong week: Raise offers the next step
  const days = asDays(week(7));
  const { ctx, pg } = await open({ now: MON + 'T09:00:00-04:00', days });
  await pg.waitForSelector('#reviewCard');
  const raise = await text(pg, '#rvRaise');
  ok(/^Raise /.test(raise) && await pg.$eval('#rvRaise', b => !b.classList.contains('secondary')), 'a week with everything kept offers "Raise [habit]"', raise);
  const hid = await pg.evaluate(() => Core.weekSummary(settings, days, '2026-09-28').suggestion.habitId);
  const want = Core.suggestTarget(Core.defaultSettings().habits.find(x => x.id === hid).target);
  await pg.click('#rvRaise'); await settle(pg);
  ok((await store(pg)).settings.habits.find(x => x.id === hid).target === want, 'it raises with the same step as the target suggestion', [hid, want]);
  await ctx.close();
}
{
  // a new person (nothing last week) sees no review; and the dismiss button works
  const { ctx, pg } = await open({ now: MON + 'T09:00:00-04:00' });
  ok((await pg.$('#reviewCard')) === null, 'no review when there is nothing from last week');
  await ctx.close();
  const days = asDays(week(5));
  const o = await open({ now: MON + 'T09:00:00-04:00', days });
  await o.pg.waitForSelector('#reviewCard'); await o.pg.click('#rvDismiss');
  await o.pg.waitForFunction(() => !document.getElementById('reviewCard'));
  ok(await o.pg.evaluate(() => localStorage.getItem('CapacitorStorage.comeback_review_seen')) === '2026-09-28', 'dismissing also remembers the week');
  await o.ctx.close();
}
{
  // Share through the Android bridge
  const days = asDays(week(5));
  const { ctx, pg } = await open({ now: MON + 'T09:00:00-04:00', days, native: true });
  await pg.waitForSelector('#rvShare');
  await pg.click('#rvShare'); await pg.waitForTimeout(300);
  const calls = (await pg.evaluate(() => window.__mock.st())).calls.filter(c => c.n === 'share');
  ok(calls.length === 1 && /Last week: 5 of 7 days kept/.test(calls[0].a.text), 'Share hands the week to the system share sheet as text', calls);
  await ctx.close();
}

/* ============ Progress: week tile and insights ============ */
console.log('Progress: week tile and insights');
{
  const days = asDays([0, 1, 2].map(n => mk(at('2026-09-21', n))).concat([0, 1, 2, 3, 4].map(n => mk(at('2026-09-28', n), n >= 2 ? { plank: 20 } : {})), [0, 1].map(n => mk(at('2026-10-05', n)))));
  const { ctx, pg, errs } = await open({ now: '2026-10-07T09:00:00-04:00', days });
  await tab(pg, 'progress'); await pg.waitForSelector('#weekCard'); await pg.waitForTimeout(300);
  ok(await pg.$eval('#wkSeg', g => g.getAttribute('role') === 'radiogroup' && [...g.querySelectorAll('[role=radio]')].map(b => b.getAttribute('aria-checked')).join() === 'true,false'), 'the tile is a radio group, "This week" first');
  ok(/^2 of 2/.test(await text(pg, '#wkBig')), 'this week so far: 2 of 2 days kept (Wednesday is still open)', await text(pg, '#wkBig'));
  await pg.click('#wkSeg [data-w="last"]');
  ok(/^5 of 7/.test(await text(pg, '#wkBig')) && /Up from 3/.test(await text(pg, '#wkCmp')), 'Last week: 5 of 7, up from 3', await text(pg, '#wkBig') + ' / ' + await text(pg, '#wkCmp'));
  ok(/Plank dipped/.test(await text(pg, '#wkList')), 'with the habit that dipped');
  const tb = await box(pg, '#wkSeg [data-w="last"]');
  ok(tb.h >= 44, 'the toggle is a 44px target', tb);
  ok((await pg.$('#wkShare')) === null, 'no Share in the browser');
  ok((await pg.$eval('#insightsCard', e => e.hidden)), 'no insights with under 3 weeks of data');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}
{
  // 45 days, plank missed every Friday
  const list = []; for (let i = 1; i <= 45; i++) { const k = at(FRI, -i); list.push(mk(k, Core.dow(k) === 5 ? { plank: 0 } : {})); }
  const { ctx, pg, errs } = await open({ now: FRI + 'T09:00:00-04:00', days: asDays(list) });
  await tab(pg, 'progress'); await pg.waitForSelector('#insList'); await pg.waitForTimeout(300);
  const items = await pg.$$eval('#insList li', l => l.map(x => x.textContent.trim().replace(/\s+/g, ' ')));
  ok(items.length >= 1 && items.length <= 3 && /^Plank was missed on \d+ of the last \d+ Fridays\. Want to move it to other days\?/.test(items[0]), 'the insights card names the habit that is missed on one weekday', items);
  ok(!/because|caused|you should/i.test(items.join(' ')) && /not why/.test(await text(pg, '.ins-foot')), 'it describes, it does not explain or blame');
  const mb = await box(pg, '.ins-move');
  ok(mb.h >= 44, 'the "Move it" button is a 44px target', mb);
  ok(/Move plank off Fris/i.test(await pg.getAttribute('.ins-move', 'aria-label')), 'with a clear label', await pg.getAttribute('.ins-move', 'aria-label'));
  await pg.click('.ins-move'); await settle(pg);
  const sch = (await store(pg)).settings.habits.find(x => x.id === 'plank').schedule;
  ok(sch.kind === 'days' && sch.days.join() === '0,1,2,3,4,6', 'moving it takes Friday out of the schedule', sch);
  ok(await pg.isVisible('#toastUndo'), 'with Undo');
  await pg.click('#toastUndo'); await settle(pg);
  ok((await store(pg)).settings.habits.find(x => x.id === 'plank').schedule.kind === 'daily', 'Undo restores it');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ============ goal weight ============ */
console.log('Goal weight');
{
  const st = Core.defaultSettings(); st.body.heightCm = 178;
  const wts = { [-27]: 86, [-20]: 85.5, [-13]: 85, [-6]: 84.5, [0]: 84 };
  const list = []; for (let i = 30; i >= 0; i--) { const k = at(FRI, -i); list.push(mk(k, {}, wts[-i] != null ? { weight: wts[-i] } : {})); }
  const { ctx, pg, errs } = await open({ now: FRI + 'T09:00:00-04:00', days: asDays(list), settings: st });
  await gear(pg);
  ok(/Not set/.test(await text(pg, '#stGoal')), 'Settings > Body has a Goal weight row ("Not set")', await text(pg, '#stGoal'));
  ok(await pg.$eval('#bodyGroup', g => g.contains(document.getElementById('stGoal'))), 'it is in the Body group');
  await pg.click('#stGoal'); await pg.waitForSelector('.keypad');
  ok(/Goal weight/.test(await text(pg, '.sheet h2')), 'it opens the number pad');
  await enterNumber(pg, '80');
  await pg.click('.sheet .btn.secondary:has-text("target date")');
  await pg.waitForSelector('#goalDateIn');
  await pg.fill('#goalDateIn', '2026-11-27');
  await pg.locator('.sheet .txtbtn.strong').last().click();
  await pg.waitForFunction(() => [...document.querySelectorAll('.sheet button')].some(b => /Target date: late November/.test(b.textContent)));
  ok(true, 'the date sheet fills the "Target date" button');
  await pg.locator('.sheet .txtbtn.strong').first().click(); await sheetGone(pg); await settle(pg);
  let s = await store(pg);
  ok(s.settings.body.goalKg === 80 && s.settings.body.goalDate === '2026-11-27', 'goalKg (in kg) and goalDate are saved in settings.body', s.settings.body);
  ok(/80 kg/.test(await text(pg, '#stGoal')) && /late November/.test(await text(pg, '#stGoal')), 'the row shows it', await text(pg, '#stGoal'));
  await tab(pg, 'progress'); await pg.waitForSelector('#goalCard'); await pg.waitForTimeout(300);
  const g = await text(pg, '#goalCard');
  ok(/4 kg to go · about 0\.5 kg a week lately · around late November/.test(g), 'Progress > Body shows the goal summary', g);
  ok(/Right on pace for late November/.test(g), 'and a gentle on-pace note', g);
  await pg.click('#chips .chip[data-metric="weight"]'); await pg.waitForTimeout(500);
  const leg = await pg.$eval('#chartLegend', e => ({ hidden: e.hidden, text: e.textContent.trim() }));
  ok(!leg.hidden && leg.text === 'Goal 80 kg', 'the weight chart labels its dashed goal line "Goal 80 kg"', leg);
  const ds = await pg.evaluate(() => { const c = Chart.getChart(document.getElementById('chart')); return { n: c.data.datasets.length, dash: c.data.datasets[1] && c.data.datasets[1].borderDash, v: c.data.datasets[1] && c.data.datasets[1].data[0] }; });
  ok(ds.n === 2 && ds.dash && ds.dash.length === 2 && ds.v === 80, 'as a dashed second dataset at 80', ds);
  ok(/Goal 80 kg/.test(await text(pg, '#chartSummary')), 'and in the text summary of the chart');
  await pg.click('#bmiOpen'); await pg.waitForSelector('#bmiGoal');
  const bg = await text(pg, '#bmiGoal');
  ok(/Goal weight/.test(bg) && /4 kg to go/.test(bg) && /BMI at your goal: 25\.2/.test(bg), 'the BMI sheet has a goal row with the BMI at the goal', bg);
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  // changing the unit shows the goal in pounds; the stored value stays in kg
  await gear(pg); await pg.click('#uLb'); await pg.waitForTimeout(300);
  ok(/176\.4 lb/.test(await text(pg, '#stGoal')), 'in pounds the row reads 176.4 lb', await text(pg, '#stGoal'));
  await pg.click('#stGoal'); await pg.waitForSelector('.keypad');
  ok(/^176\.4/.test(await text(pg, '.numdisp .nv')), 'the number pad starts from the current goal in lb', await text(pg, '.numdisp .nv'));
  // clearing removes it
  await pg.click('.keypad .key[aria-label="Delete"]');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  s = await store(pg);
  ok(s.settings.body.goalKg === undefined && s.settings.body.goalDate === undefined, 'clearing the number removes the goal and its date', s.settings.body);
  ok(/Not set/.test(await text(pg, '#stGoal')), 'the row says "Not set" again');
  await tab(pg, 'progress'); await pg.waitForTimeout(300);
  ok((await pg.$('#goalCard')) === null && (await pg.$('#goalSet')) !== null, 'Progress offers "Set a goal weight" instead');
  // a goal entered in pounds is stored in kg
  await pg.click('#goalSet'); await pg.waitForSelector('.keypad'); await enterNumber(pg, '176');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  s = await store(pg);
  ok(Math.abs(s.settings.body.goalKg - 79.83) < 0.02, '176 lb is stored as about 79.83 kg', s.settings.body.goalKg);
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}
{
  // a goal that needs a pace over 1 kg a week says what it would suggest
  const st = Core.defaultSettings(); st.body.heightCm = 178; st.body.goalKg = 80; st.body.goalDate = '2026-10-16';
  const wts = { [-27]: 86, [-20]: 85.5, [-13]: 85, [-6]: 84.5, [0]: 84 };
  const list = []; for (let i = 30; i >= 0; i--) { const k = at(FRI, -i); list.push(mk(k, {}, wts[-i] != null ? { weight: wts[-i] } : {})); }
  const { ctx, pg } = await open({ now: FRI + 'T09:00:00-04:00', days: asDays(list), settings: st });
  await tab(pg, 'progress'); await pg.waitForSelector('#goalCard');
  const g = await text(pg, '#goalCard');
  ok(/you would need about 2 kg a week/.test(g) && /A steady 1 kg a week is the most we would suggest/.test(g), 'a too-fast date is explained, with the safe pace', g);
  await ctx.close();
}

/* ============ data: backup, merge, CSV ============ */
console.log('Backup, sync merge and CSV');
{
  const days = asDays([mk('2026-09-30'), Object.assign(mk('2026-10-01'), { light: true })]);
  const { ctx, pg } = await open({ now: FRI + 'T09:00:00-04:00', days });
  const r = await pg.evaluate(() => {
    const keep = normalizeDay('2026-10-01', { vals: {}, rules: {}, light: true });
    const drop = normalizeDay('2026-10-01', { vals: {}, rules: {}, light: 'yes' });
    const a = { vals: { pushups: 1 }, rules: {}, weight: null, waist: null, note: '', date: 'k', updatedAt: 1000, light: true };
    const b = { vals: { pushups: 2 }, rules: {}, weight: null, waist: null, note: '', date: 'k', updatedAt: 2000 };
    const round = normalizeData(JSON.parse(JSON.stringify(buildData())));
    return {
      keep: keep.light, drop: drop.light, send: dayData(keep).light, notSent: dayData(drop).light,
      newerOff: mergeDayRecords(a, b, 5000).light, newerOn: mergeDayRecords(b, Object.assign({}, a, { updatedAt: 3000 }), 5000).light, sameTime: mergeDayRecords(a, Object.assign({}, b, { updatedAt: 1000 }), 5000).light,
      round: round.days['2026-10-01'].light, roundOther: round.days['2026-09-30'].light,
      csv: buildCsv().replace(/^﻿/, '').trim().split('\r\n')
    };
  });
  ok(r.keep === true && r.drop === undefined, 'normalizeDay keeps light:true and ignores anything else', r);
  ok(r.send === true && r.notSent === undefined, 'the cloud copy of a day carries the flag', r);
  ok(r.newerOff === undefined && r.newerOn === true && r.sameTime === true, 'a merge follows the newer edit (so turning it off sticks), and keeps it when both agree', r);
  ok(r.round === true && r.roundOther === undefined, 'a backup round-trip keeps light days', r);
  const head = r.csv[0].split(','), row = r.csv.find(l => l.startsWith('2026-10-01')).split(',');
  ok(head[2] === 'Light day' && row[2] === 'yes' && row[1] === '', 'the CSV has a Light day column and no score for a light day', [head.slice(0, 4), row.slice(0, 4)]);
  ok(head.slice(-2).join() === 'BMI,Note', 'the other columns are unchanged');
  await ctx.close();
}

/* ============ look: dark, large text ============ */
console.log('Dark mode and large text');
{
  const days = asDays([0, 1, 2].map(n => mk(at('2026-09-21', n))).concat([0, 1, 2, 3, 4].map(n => mk(at('2026-09-28', n), n >= 2 ? { plank: 20 } : {}))));
  days['2026-10-04'] = Object.assign(mk('2026-10-04'), { light: true });
  for (const [scheme, zoom] of [['dark', 0], ['light', 200]]) {
    const { ctx, pg } = await open({ now: MON + 'T09:00:00-04:00', days, scheme, w: 360, h: 800, zoom });
    await pg.waitForSelector('#reviewCard');
    const bad = [];
    let o = await overflow(pg); if (o.sw > o.vw || o.out.length) bad.push(['today', o]);
    await tab(pg, 'progress'); await pg.waitForTimeout(500);
    o = await overflow(pg); if (o.sw > o.vw || o.out.length) bad.push(['progress', o]);
    ok(bad.length === 0, `${scheme}${zoom ? ' at ' + zoom + '% text' : ''}: the review card, week tile and calendar do not overflow`, bad);
    if (scheme === 'dark') {
      const l = await pg.$eval('#heat .hc.l i', e => { const c = getComputedStyle(e); return { st: c.borderTopStyle, col: c.borderTopColor, fg: c.color }; }).catch(() => null);
      ok(l && l.st === 'dashed', 'a light day is still dashed in dark mode', l);
    }
    await ctx.close();
  }
  // reduced motion: nothing here animates, the card still works
  const { ctx, pg, errs } = await open({ now: MON + 'T09:00:00-04:00', days });
  await pg.emulateMedia({ reducedMotion: 'reduce' });
  await pg.waitForSelector('#reviewCard');
  ok(await pg.$eval('#reviewCard', c => getComputedStyle(c).animationName === 'none' || getComputedStyle(c).animationName === ''), 'the review card has no animation');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
