// Smarter reminders (only if something is left, morning cue, per-habit reminders), the timer for Duration habits, quick-add amounts for
// water and other counts, anchors and the first-week ramp. The browser runs with a mocked native bridge (it records every notification
// that is scheduled or cancelled) and a fixed clock: Friday 2 October 2026, 2:00 PM.
// Run: node test/reminders-test.mjs
import { createRequire } from 'module';
import { serve, launch, counter, newPage, skipOnboarding, tab, gear, ready, sheetGone, settle, setHabit, cardSel, setTime, getTime, actionChoose, MOCK } from './helpers.mjs';

const Core = createRequire(import.meta.url)('../www/js/core.js');
const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const NOW = new Date(2026, 9, 2, 14, 0, 0), TK = '2026-10-02';
const KEY = 'CapacitorStorage.comeback';

const day = (k, vals = {}, rules = {}, extra = {}) => ({ vals, rules, weight: null, waist: null, note: '', date: k, updatedAt: 1e12, ...extra });
const plan = (ids, fn) => { const s = Core.defaultSettings(); s.habits = s.habits.filter(h => ids.includes(h.id) || h.type === 'measure'); if (fn) fn(s); return s; };
const H = (s, id) => s.habits.find(h => h.id === id);

async function open({ data, native = true, scheme = 'light', still = false, w = 390, h = 900, time = NOW, stubs = false, onboard = false } = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: still ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 }); });
  if (stubs) await ctx.addInitScript(() => {
    navigator.vibrate = p => { window.__vib = (window.__vib || []).concat([p]); return true; };
    window.__wl = 0; window.__wlr = 0;
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__wl++; return { release() { window.__wlr++; }, addEventListener() {} }; } } });
  });
  if (time) await ctx.clock.setFixedTime(time);
  if (native) await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  if (!onboard && !native) await skipOnboarding(ctx);
  if (data && native) await ctx.addInitScript(d => { if (!localStorage.getItem('__d')) { localStorage.setItem('__d', '1'); localStorage.setItem('__mock', JSON.stringify({ prefs: { comeback_onboarded: '1', comeback: JSON.stringify(d) }, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0 })); } }, data);
  else if (data) await ctx.addInitScript(([d, key]) => { if (!localStorage.getItem('__d')) { localStorage.setItem('__d', '1'); localStorage.setItem(key, JSON.stringify(d)); } }, [data, KEY]);
  const pg = await newPage(ctx, errs);
  await pg.goto(base);
  if (!onboard) await pg.waitForSelector('#sections .tsec', { state: 'attached' });
  return { ctx, pg, errs };
}
const mock = pg => pg.evaluate(() => window.__mock.st());
// the saved data: in the mocked Android app it is in Preferences, in a plain browser in localStorage
const stored = pg => pg.evaluate(() => { const m = window.__mock && window.__mock.st(); return JSON.parse(m && m.prefs.comeback ? m.prefs.comeback : localStorage.getItem('CapacitorStorage.comeback')); });
const pendingList = async pg => Object.values((await mock(pg)).pending || {});
const pendingIds = async pg => (await pendingList(pg)).map(n => n.id).sort((a, b) => a - b);
const calls = async (pg, n) => (await mock(pg)).calls.filter(c => c.n === n);
const until = async (pg, fn, arg, ms = 6000) => { try { await pg.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } };
const hasIds = (pg, ids) => until(pg, ids => { const p = Object.keys(window.__mock.st().pending).map(Number); return ids.every(i => (i >= 0 ? p.includes(i) : !p.includes(-i))); }, ids);
const hours = n => { const d = new Date(n.schedule.at); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
const days3 = data => ({ version: 2, settings: data.settings, days: data.days || {} });
const grant = pg => pg.evaluate(() => { window.__mock.set('perm', 'granted'); });
// write through the page's own Preferences so a later write by the page cannot overwrite it with an older copy
const setPref = (pg, k, v) => pg.evaluate(([k, v]) => prefSet(k, v), [k, v]);

/* ================= the evening reminder only comes when something is left ================= */
console.log('Evening reminder: only if something is left');
{
  const s = plan(['water', 'walk', 'pushups'], x => { H(x, 'water').target = 2; });
  const meta = { reminder: { enabled: true, time: '21:00' } };
  const { ctx, pg, errs } = await open({ data: days3({ settings: s, days: { [TK]: day(TK, { water: 2 }) } }) });
  await grant(pg);
  await pg.evaluate(m => prefSet('comeback_meta', JSON.stringify(m)), meta);
  await pg.reload(); await ready(pg);
  ok(await hasIds(pg, [1001, 1002, 1003]), 'on start the reminder is planned for tonight and the next two days');
  let pl = (await pendingList(pg)).filter(n => n.id >= 1001 && n.id <= 1003).sort((a, b) => a.id - b.id);
  ok(pl.every(n => n.schedule.at && !n.schedule.on && hours(n) === '21:00' && n.title === 'Comeback' && n.channelId === 'daily-reminder' && n.isExactNotification === false && n.schedule.allowWhileIdle === true), 'each one is a one-shot at 9:00 PM, inexact and allowed while idle', pl.map(n => n.schedule));
  ok(pl[0].body === 'Brisk walk and Pushups are still open. A quick one counts.', "tonight's reminder names what is still open", pl[0].body);
  ok(/Time to log today/.test(pl[1].body), 'the days after use the plain text');
  // finishing the day takes tonight's reminder away; tomorrow's stays
  await setHabit(pg, 'pushups', 30); await setHabit(pg, 'walk', 30);
  ok(await hasIds(pg, [-1001, 1002, 1003]), 'everything done today: tonight is dropped, tomorrow stays');
  // undoing brings it back
  await pg.click('#toastUndo');
  ok(await hasIds(pg, [1001]) && /Brisk walk is still open/.test((await pendingList(pg)).find(n => n.id === 1001).body), 'undo puts it back, naming what is left again');
  // a light day
  await pg.evaluate(k => { days[k].light = true; scheduleSave(k); }, TK);
  ok(await hasIds(pg, [-1001, 1002]), 'a light day skips tonight');
  await pg.evaluate(k => { delete days[k].light; scheduleSave(k); }, TK);
  ok(await hasIds(pg, [1001]), 'and it comes back when the day is no longer light');
  // restart: re-armed
  const before = (await calls(pg, 'schedule')).length;
  await pg.reload(); await ready(pg);
  ok(await until(pg, n => window.__mock.st().calls.filter(c => c.n === 'schedule').length > n, before) && (await pendingIds(pg)).filter(i => i < 1100).join() === '1001,1002,1003', 'opening the app plans the reminders again');
  // coming back to the app
  const b2 = (await calls(pg, 'schedule')).length;
  await pg.evaluate(() => window.__mock.fire('appStateChange', { isActive: true }));
  ok(await until(pg, n => window.__mock.st().calls.filter(c => c.n === 'schedule').length > n, b2), 'coming back to the app plans them again');
  // settings
  await gear(pg);
  ok(await pg.isChecked('#remIfOpen') && !(await pg.isChecked('#remMornOn')) && await pg.isChecked('#remOn'), 'Settings: "Only remind me if something is left" is on by default, the morning cue is off');
  ok((await pg.$$('#remTime select')).length === 3 && (await pg.$$('#remMornTime select')).length === 3 && (await pg.$eval('#remMornTime .t12-p', e => [...e.options].map(o => o.value).join())) === 'AM,PM' && (await getTime(pg, '#remMornTime')) === '08:00', 'both times are 12-hour pickers (the morning one starts at 8:00 AM)');
  ok(/Only remind me if something is left/.test(await pg.textContent('#remIfOpenRow')) && (await pg.getAttribute('#remIfOpen', 'role')) === 'switch' && (await pg.getAttribute('#remMornOn', 'aria-label')) === 'Morning cue', 'the new rows are labelled switches');
  await pg.uncheck('#remIfOpen'); await until(pg, () => window.__mock.st().pending[1001] && window.__mock.st().pending[1001].schedule.on);
  pl = await pendingList(pg);
  const rep = pl.filter(n => n.id >= 1001 && n.id <= 1003);
  ok(rep.length === 1 && rep[0].id === 1001 && rep[0].schedule.on.hour === 21 && rep[0].schedule.on.minute === 0 && !rep[0].schedule.at && /Time to log today/.test(rep[0].body), 'switched off: it is the old repeating daily reminder (one notification, id 1001)', rep);
  ok(!!(await stored(pg)) && JSON.parse((await mock(pg)).prefs.comeback_meta).reminder.onlyIfOpen === false, 'the choice is remembered');
  await pg.check('#remIfOpen'); await until(pg, () => !!window.__mock.st().pending[1002]);
  // morning cue
  await pg.check('#remMornOn'); await hasIds(pg, [1012]);
  pl = (await pendingList(pg)).filter(n => n.id >= 1011 && n.id <= 1013).sort((a, b) => a.id - b.id);
  ok(pl.length === 2 && pl.every(n => hours(n) === '8:00' && n.title === 'Comeback' && /^Good morning\. Today's easiest win: .+\.$/.test(n.body)), "the morning cue: one a day at 8:00 AM (this morning is past), with the day's easiest win", pl.map(n => [n.id, hours(n), n.body]));
  await setTime(pg, '#remMornTime', '06:45'); await until(pg, () => Object.values(window.__mock.st().pending).some(n => n.id >= 1011 && n.id < 1020 && new Date(n.schedule.at).getHours() === 6));
  ok((await pendingList(pg)).filter(n => n.id >= 1011 && n.id <= 1013).every(n => hours(n) === '6:45'), 'changing the morning time plans it again');
  await pg.uncheck('#remMornOn'); await hasIds(pg, [-1012, -1013]);
  ok(/Morning cue is off/.test(await pg.textContent('#remMsg')), 'turning it off says so');
  // turning the evening reminder off cancels it
  await pg.uncheck('#remOn'); await hasIds(pg, [-1001, -1002, -1003]);
  ok((await pendingIds(pg)).filter(i => i < 1100).length === 0, 'the evening reminder off: nothing of it is left scheduled');
  ok(errs.length === 0, 'no JS errors (evening reminder)', errs);
  await ctx.close();
}
console.log('A rest day, and permission');
{
  const s = plan(['water', 'pushups'], x => { x.habits.forEach(h => { if (h.type !== 'measure') h.schedule = { kind: 'days', days: [6] }; }); });
  const { ctx, pg, errs } = await open({ data: days3({ settings: s }) });
  await gear(pg);
  await pg.evaluate(() => window.__mock.set('requestResult', 'denied'));
  await pg.click('#remMornOn'); await until(pg, () => document.getElementById('remMsg').textContent.length > 0);
  ok(!(await pg.isChecked('#remMornOn')) && /blocked/i.test(await pg.textContent('#remMsg')) && (await pendingIds(pg)).length === 0, 'permission refused: the morning cue switch goes back off with a gentle message and nothing is scheduled');
  await pg.evaluate(() => { window.__mock.set('requestResult', 'granted'); window.__mock.set('perm', 'prompt'); });
  await pg.check('#remOn'); await until(pg, () => !!window.__mock.st().pending[1002]);
  ok((await pendingIds(pg)).join() === '1002', 'a rest day (Friday) and the Sunday after it are skipped: only Saturday evening is planned', await pendingIds(pg));
  ok(errs.length === 0, 'no JS errors (rest day)', errs);
  await ctx.close();
}
console.log('The morning cue is offered once');
{
  const s = plan(['water', 'pushups']);
  const ds = {}; for (const k of ['2026-09-29', '2026-09-30', '2026-10-01']) ds[k] = day(k, { water: 1 });
  const { ctx, pg, errs } = await open({ data: days3({ settings: s, days: ds }) });
  await grant(pg);
  await pg.evaluate(() => prefSet('comeback_meta', JSON.stringify({ reminder: { enabled: true, time: '21:00' } })));
  await pg.reload(); await ready(pg);
  await pg.waitForSelector('.asheet', { timeout: 6000 });
  ok(/good-morning nudge/.test(await pg.textContent('.asheet')) && /Not now/.test(await pg.textContent('.asheet')) && /Yes, at 8:00 AM/.test(await pg.textContent('.asheet')), 'after the third logged day, a gentle one-time offer for the morning cue (Not now, or Yes at 8:00 AM)');
  await actionChoose(pg, 'Not now');
  await pg.reload(); await ready(pg); await pg.waitForTimeout(3500);
  ok(!(await pg.$('.asheet')) && JSON.parse((await mock(pg)).prefs.comeback_meta).reminder.morningOffered === true, 'it is not offered again');
  ok(errs.length === 0, 'no JS errors (offer)', errs);
  await ctx.close();
}

/* ================= reminders for one habit, anchors ================= */
console.log('Habit reminders and anchors (the form)');
{
  const s = plan(['pushups', 'walk', 'nosugar'], x => { x.habits.push(Core.libEntry('nosugar') && { id: 'nosugar', name: 'No sugar', icon: 'candy-off', type: 'yesno', unit: '', target: 1, section: 'food', schedule: { kind: 'daily' } }); });
  const { ctx, pg, errs } = await open({ data: days3({ settings: s }) });
  await grant(pg);
  await tab(pg, 'setup');
  await pg.click('#planSections .swipe[data-id="pushups"] .row');
  await pg.waitForSelector('#fName');
  ok(await pg.isVisible('#fRemWrap') && await pg.isVisible('#fAnchor') && (await pg.$$('#fAnchorChips .fchip')).length === 5 && !(await pg.isVisible('#fRemList .remrow')), 'the form has Remind me, When (with chips) and Quick add amounts');
  await pg.click('#fAnchorChips .fchip:has-text("After lunch")');
  ok((await pg.inputValue('#fAnchor')) === 'After lunch' && (await pg.getAttribute('#fAnchorChips .fchip:has-text("After lunch")', 'aria-pressed')) === 'true', 'an anchor chip fills the box');
  await pg.click('#fRemAdd'); await pg.click('#fRemAdd'); await pg.click('#fRemAdd');
  ok((await pg.$$('#fRemList .remrow')).length === 3 && !(await pg.isVisible('#fRemAdd')), 'up to 3 reminder times');
  ok((await pg.$$('#fRemList .remrow:first-child select')).length === 3 && (await pg.$eval('#fRemList .remrow:first-child .t12-p', e => [...e.options].map(o => o.value).join())) === 'AM,PM', 'each time is a 12-hour picker (hour, minute, AM/PM)');
  await pg.click('#fRemList .remrow:last-child .iconbtn');
  ok((await pg.$$('#fRemList .remrow')).length === 2 && await pg.isVisible('#fRemAdd'), 'a time can be removed again');
  await setTime(pg, '#fRemList .remrow:nth-child(1) .remtime', '07:30'); await setTime(pg, '#fRemList .remrow:nth-child(2) .remtime', '18:00');
  ok(await pg.isVisible('#fRemSkip'), 'a "Skip if already done" switch appears');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  const h = (await stored(pg)).settings.habits.find(z => z.id === 'pushups');
  ok(h.anchor === 'After lunch' && JSON.stringify(h.remind) === '{"times":["07:30","18:00"],"skipIfDone":true}', 'saved on the habit: anchor and reminder times (24-hour, sorted)', h);
  ok(await until(pg, () => Object.keys(window.__mock.st().pending).some(i => Number(i) >= 2000)), 'its reminders are scheduled');
  const hp = (await pendingList(pg)).filter(n => n.id >= 2000);
  ok(hp.length === 5 && hp.every(n => n.body === 'After lunch: 30 pushups.' && n.title === 'Comeback' && n.schedule.at) && hp.filter(n => hours(n) === '18:00').length === 3 && hp.filter(n => hours(n) === '7:30').length === 2, 'one-shots for 7:30 AM and 6:00 PM over the next 3 days (this morning is past), with the anchor in the text', hp.map(n => [n.id, hours(n), n.body]));
  await tab(pg, 'today');
  ok(!!(await pg.$(`${cardSel('pushups')} .hbell`)) && !(await pg.$(`${cardSel('walk')} .hbell`)), 'a small bell shows on the card of a habit with reminders');
  ok(/After lunch/.test(await pg.textContent(`${cardSel('pushups')} .hsrc`)), 'the anchor is the card subtitle');
  ok(/reminder at 7:30 AM and 6:00 PM/.test(await pg.getAttribute(`${cardSel('pushups')} .hc-main`, 'aria-label')) && /reminder at 7:30 AM and 6:00 PM/.test(await pg.getAttribute(`${cardSel('pushups')} .hbell`, 'aria-label')), 'and its label says when it will remind you');
  await tab(pg, 'setup');
  ok(/After lunch · Reminder 7:30 AM, 6:00 PM/.test(await pg.textContent('#planSections .swipe[data-id="pushups"] .row-sub')), 'Plan shows the anchor and the reminder times');
  // met today: no reminder today (skip if done)
  await tab(pg, 'today'); await setHabit(pg, 'pushups', 30);
  ok(await until(pg, () => !Object.values(window.__mock.st().pending).some(n => n.id >= 2000 && n.id < 2012 && new Date(n.schedule.at).getDate() === 2)), "once its target is met, today's habit reminder is dropped");
  // remove the reminders
  await tab(pg, 'setup'); await pg.click('#planSections .swipe[data-id="pushups"] .row'); await pg.waitForSelector('#fName');
  await pg.click('#fRemList .remrow .iconbtn'); await pg.click('#fRemList .remrow .iconbtn');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  ok(await until(pg, () => !Object.keys(window.__mock.st().pending).some(i => Number(i) >= 2000)) && !('remind' in (await stored(pg)).settings.habits.find(z => z.id === 'pushups')), 'removing the times removes the reminders');
  // an anchor is only ever text
  await pg.click('#planSections .swipe[data-id="pushups"] .row'); await pg.waitForSelector('#fName');
  await pg.fill('#fAnchor', '<b>bold</b> <img src=x onerror="window.__xss=1">'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await tab(pg, 'today');
  if (await pg.$('#sections .drow[data-id="pushups"]')) await pg.click('#sections .drow[data-id="pushups"]');
  ok(!(await pg.$(`${cardSel('pushups')} b`)) && !(await pg.$(`${cardSel('pushups')} img`)) && /<b>bold<\/b>/.test(await pg.textContent(`${cardSel('pushups')} .hsrc`)) && !(await pg.evaluate(() => window.__xss)), 'an anchor is shown as text only (and cut at 30 characters)');
  // permission refused when saving a reminder
  await pg.evaluate(() => { window.__mock.set('perm', 'prompt'); window.__mock.set('requestResult', 'denied'); });
  await tab(pg, 'setup'); await pg.click('#planSections .swipe[data-id="walk"] .row'); await pg.waitForSelector('#fName');
  await pg.click('#fRemAdd'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  ok(await until(pg, () => /Notifications are off/.test(document.getElementById('toastMsg').textContent)), 'if notifications are refused, a gentle toast says the reminder cannot ring yet');
  ok(errs.length === 0, 'no JS errors (habit reminders)', errs);
  await ctx.close();
}
console.log('Habit reminders: repeating and weekly');
{
  const s = plan(['pushups', 'plank', 'squats'], x => {
    H(x, 'pushups').remind = { times: ['08:00'], skipIfDone: false };
    H(x, 'plank').remind = { times: ['09:15'], skipIfDone: false }; H(x, 'plank').schedule = { kind: 'days', days: [1, 3, 5] };
    H(x, 'squats').remind = { times: ['17:00'], skipIfDone: false }; H(x, 'squats').schedule = { kind: 'weekly', times: 3 };
  });
  const { ctx, pg, errs } = await open({ data: days3({ settings: s }) });
  await grant(pg); await pg.reload(); await ready(pg);
  ok(await until(pg, () => Object.keys(window.__mock.st().pending).length > 0), 'reminders are planned on start');
  const hp = await pendingList(pg);
  const by = id => hp.filter(n => n.id >= 2000);
  const pushups = hp.filter(n => /Pushups/.test(n.body)), plank = hp.filter(n => /Plank/.test(n.body)), squats = hp.filter(n => /Squats/.test(n.body));
  ok(pushups.length === 1 && pushups[0].schedule.on.hour === 8 && pushups[0].schedule.on.minute === 0 && !pushups[0].schedule.at && pushups[0].body === 'Pushups: 30 reps.', 'a daily habit that does not skip: one repeating notification (not one-shots)', pushups);
  ok(plank.length === 3 && plank.map(n => n.schedule.on.weekday).sort().join() === '2,4,6' && plank.every(n => n.schedule.on.hour === 9 && n.schedule.on.minute === 15), 'a Mon, Wed, Fri habit: one repeating notification per weekday', plank.map(n => n.schedule));
  ok(squats.length === 3 && squats.every(n => n.schedule.at && !n.schedule.on), 'a times-a-week habit is planned day by day', squats);
  ok(new Set(hp.map(n => n.id)).size === hp.length && hp.every(n => n.id >= 2000), 'every id is unique and 2000 or more');
  // deleting the habit cancels its reminders (all habit reminders are replaced in one place)
  await tab(pg, 'setup');
  await pg.evaluate(() => { settings.habits = settings.habits.filter(h => h.id !== 'pushups'); return persistSettings(); });
  ok(await until(pg, () => !Object.values(window.__mock.st().pending).some(n => /Pushups/.test(n.body))), 'removing a habit cancels its reminders');
  ok(errs.length === 0, 'no JS errors (repeating)', errs);
  await ctx.close();
}

/* ================= quick-add amounts ================= */
console.log('Quick add: water and other counts');
{
  const s = plan(['water', 'pushups'], x => { x.habits.push({ id: 'glasses', name: 'Glasses', icon: 'glass-water', type: 'count', unit: 'glasses', target: 8, section: 'health', schedule: { kind: 'daily' } }); });
  const { ctx, pg, errs } = await open({ data: days3({ settings: s }), native: false });
  const chips = id => pg.$$eval(`${cardSel(id)} .chipbtn`, e => e.map(b => b.textContent));
  ok((await chips('water')).join() === '+0.25 L,+0.5 L' && !!(await pg.$(`${cardSel('water')} .cbtn.minus`)) && !!(await pg.$(`${cardSel('water')} .cbtn.plus`)), 'water in litres: a minus and one-tap chips "+0.25 L" and "+0.5 L"', await chips('water'));
  ok((await chips('glasses')).join() === '+1 glass (250 ml),+2 glasses (500 ml)', 'glasses: "+1 glass (250 ml)"', await chips('glasses'));
  ok((await chips('pushups')).length === 0 && !!(await pg.$(`${cardSel('pushups')} .cbtn.plus`)), 'plain reps keep the + and − buttons');
  await pg.click(`${cardSel('water')} .chipbtn >> nth=1`); await settle(pg);
  ok((await stored(pg)).days[TK].vals.water === 0.5, 'a chip adds its amount');
  await pg.click(`${cardSel('water')} .cbtn.minus`); await settle(pg);
  ok((await stored(pg)).days[TK].vals.water === 0.25, 'minus takes off a quarter litre, not half', (await stored(pg)).days[TK]);
  await pg.click(`${cardSel('water')} .cbtn.plus`); await pg.click(`${cardSel('water')} .cbtn.plus`); await settle(pg);
  ok((await stored(pg)).days[TK].vals.water === 0.75, 'the first chip is the plus button (a quarter litre each tap)', (await stored(pg)).days[TK]);
  // the number sheet shows the amounts too
  await pg.click(`${cardSel('glasses')} .hc-main`); await pg.waitForSelector('.keypad');
  ok((await pg.$$eval('.preset', e => e.map(b => b.textContent))).slice(0, 2).join() === '+1 glass (250 ml),+2 glasses (500 ml)', 'the number sheet offers the same amounts');
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  // the form: own amounts
  await tab(pg, 'setup'); await pg.click('#planSections .swipe[data-id="water"] .row'); await pg.waitForSelector('#fName');
  ok(await pg.isVisible('#fPresetWrap') && (await pg.$$('#fPresetChips .fchip')).length === 0 && /usual amounts/.test(await pg.textContent('#fPresetHelp')), 'Quick add amounts: empty means the usual amounts for the unit');
  for (const v of ['0.33', '0.5', '0.2', '1']) { await pg.fill('#fPresetIn', v); await pg.click('#fPresetAdd'); }
  ok((await pg.$$eval('#fPresetChips .fchip', e => e.map(b => b.textContent.trim()))).join() === '+0.2 L,+0.33 L,+0.5 L,+1 L' && (await pg.isDisabled('#fPresetAdd')), 'up to 4 amounts, smallest first');
  await pg.click('#fPresetChips .fchip >> nth=3');
  ok((await pg.$$('#fPresetChips .fchip')).length === 3 && !(await pg.isDisabled('#fPresetAdd')), 'a chip removes itself when tapped');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  ok(JSON.stringify((await stored(pg)).settings.habits.find(z => z.id === 'water').presets) === '[0.2,0.33,0.5]', 'saved on the habit as presets', (await stored(pg)).settings.habits.find(z => z.id === 'water'));
  await tab(pg, 'today');
  ok((await chips('water')).join() === '+0.2 L,+0.33 L', 'the card uses them first (two fit)', await chips('water'));
  // the library gives water sensible amounts
  const lib = await pg.evaluate(() => Core.habitFromLibrary({ habits: [] }, Core.libEntry('water')));
  ok(JSON.stringify(lib.presets) === '[0.25,0.5]', 'the library water entry comes with 0.25 and 0.5');
  ok(errs.length === 0, 'no JS errors (quick add)', errs);
  await ctx.close();
}

/* ================= the timer ================= */
console.log('Timer');
{
  const s = plan(['plank', 'walk', 'pushups']);
  const { ctx, pg, errs } = await open({ data: days3({ settings: s }), stubs: true });
  const at = ms => ctx.clock.setFixedTime(new Date(NOW.getTime() + ms));
  const tm = () => pg.textContent('#tmTime');
  const settleTick = () => pg.waitForTimeout(450);
  ok(!!(await pg.$(`${cardSel('plank')} .timerbtn`)) && !!(await pg.$(`${cardSel('walk')} .timerbtn`)) && !(await pg.$(`${cardSel('pushups')} .timerbtn`)), 'Duration cards have a play button, Count cards do not');
  ok(/Start a timer for Plank/.test(await pg.getAttribute(`${cardSel('plank')} .timerbtn`, 'aria-label')) && (await pg.$eval(`${cardSel('plank')} .timerbtn`, e => e.getBoundingClientRect().height)) >= 44, 'it is labelled and at least 44px tall');
  await pg.click(`${cardSel('plank')} .timerbtn`); await pg.waitForSelector('#tmMain');
  ok((await tm()) === '0:00' && /of 1:00/.test(await pg.textContent('#tmSub')) && (await pg.getAttribute('.sheet', 'aria-labelledby')) !== null && /Plank timer/.test(await pg.textContent('.sheet-head h2')), 'the sheet shows 0:00 of the 1:00 target');
  ok(await pg.evaluate(() => window.__wl) >= 1, 'the screen is kept awake while it is open (wake lock)');
  await pg.click('#tmMain');
  ok(await until(pg, () => !!window.__mock.st().prefs.comeback_timer) && Boolean(JSON.parse((await mock(pg)).prefs.comeback_timer).startedAt), 'starting saves {habitId, startedAt, pausedMs} in Preferences');
  await at(42000); await settleTick();
  ok((await tm()) === '0:42', 'the time comes from the clock (0:42 after 42 seconds)', await tm());
  const prgOff = await pg.$eval('#tmPrg', e => Number(e.style.strokeDashoffset));
  ok(prgOff > 0 && prgOff < 326.73 * 0.5, 'the ring is about 70% round', prgOff);
  await pg.click('#tmStop');
  ok(/Add 0:42 to Plank/.test(await pg.textContent('#tmConfirmText')) && await pg.isVisible('#tmAdd') && /Add 0:42/.test(await pg.textContent('#tmAdd')), 'Stop shows "Add 0:42 to Plank"');
  await pg.click('#tmAdd'); await sheetGone(pg); await settle(pg);
  ok((await stored(pg)).days[TK].vals.plank === 42, 'the elapsed seconds are added to the habit', (await stored(pg)).days[TK]);
  ok(!(await mock(pg)).prefs.comeback_timer, 'the saved timer is cleared');
  ok(await pg.evaluate(() => window.__wlr) >= 1, 'the wake lock is let go when the sheet closes');
  // pause and resume leave the paused time out; target reached vibrates
  await at(100000);
  await pg.click(`${cardSel('plank')} .timerbtn`).catch(async () => { await pg.click('#sections .drow[data-id="plank"]'); await pg.click(`${cardSel('plank')} .timerbtn`); });
  await pg.waitForSelector('#tmMain'); await pg.click('#tmMain');
  await at(120000); await settleTick(); await pg.click('#tmMain');           // pause at 20 s
  ok(/Resume/.test(await pg.textContent('#tmMain')) && /Paused/.test(await pg.textContent('#tmStatus')), 'pausing says Paused and the button becomes Resume');
  await at(150000); await settleTick();
  ok((await tm()) === '0:20', 'a paused timer stands still', await tm());
  await pg.click('#tmMain'); await at(190000); await settleTick();            // resumed at 150 s; 40 s later = 20 + 40
  ok((await tm()) === '1:00' && /Target reached/.test(await pg.textContent('#tmStatus')) && await pg.$eval('#tmRing', e => e.classList.contains('reached')), 'the target is reached at 1:00 (the 30 seconds paused are left out)', await tm());
  ok((await pg.evaluate(() => (window.__vib || []).length)) === 1 && (await calls(pg, 'notify')).length >= 1, 'with a vibration and a success haptic');
  await at(200000); await settleTick();
  ok((await tm()) === '1:10', 'it keeps counting past the target', await tm());
  await pg.click('#tmStop');
  ok(/Add 1:10 to Plank/.test(await pg.textContent('#tmConfirmText')), 'stop: Add 1:10 to Plank');
  await pg.click('#tmKeep'); await settleTick();
  ok(/Pause/.test(await pg.textContent('#tmMain')) && !(await pg.isVisible('#tmAdd')), '"Keep going" carries on');
  await pg.click('#tmStop'); await pg.click('#tmDiscard');
  if (await pg.$('.asheet')) await actionChoose(pg, 'Discard');
  await sheetGone(pg); await settle(pg);
  ok((await stored(pg)).days[TK].vals.plank === 42 && !(await mock(pg)).prefs.comeback_timer, 'Discard adds nothing');
  ok(errs.length === 0, 'no JS errors (timer)', errs);
  await ctx.close();
}
console.log('Timer: minutes, countdown, and coming back to it');
{
  const s = plan(['plank', 'walk']);
  const { ctx, pg, errs } = await open({ data: days3({ settings: s }), stubs: true });
  await grant(pg);
  const at = ms => ctx.clock.setFixedTime(new Date(NOW.getTime() + ms));
  const tm = () => pg.textContent('#tmTime');
  await pg.click(`${cardSel('walk')} .timerbtn`); await pg.waitForSelector('#tmMain');
  ok(/of 30:00/.test(await pg.textContent('#tmSub')), 'a minutes habit shows its 30:00 target');
  await pg.click('#tmModes button[data-mode="down"]');
  ok((await tm()) === '30:00' && /left of 30:00/.test(await pg.textContent('#tmSub')) && (await pg.getAttribute('#tmModes button[data-mode="down"]', 'aria-checked')) === 'true', 'Count down starts from the target');
  await pg.click('#tmMain'); await at(750000); await pg.waitForTimeout(450);
  ok((await tm()) === '17:30' && (await pg.isDisabled('#tmModes button[data-mode="up"]')), 'and counts down (17:30 left after 12:30)', await tm());
  ok((await pg.evaluate(() => navigator.vibrate && 1)) === 1, 'vibration is available');
  // leave the sheet while it runs
  await pg.click('#tmClose'); await sheetGone(pg);
  ok(/keeps running/.test(await pg.textContent('#toastMsg')) && !!(await pg.$(`${cardSel('walk')} .timerbtn.on`)), 'closing the sheet keeps the timer running (the card says so)');
  ok(await until(pg, () => Object.keys(window.__mock.st().pending).includes('1900')), 'a notification for the moment the target is reached is scheduled (Android app, when notifications are allowed)');
  // the app is closed and opened again 12:30 later: a gentle prompt
  await pg.reload(); await ready(pg);
  await pg.waitForSelector('.asheet', { timeout: 6000 });
  ok(/Your Brisk walk timer is still here/.test(await pg.textContent('.asheet')) && /12:30/.test(await pg.textContent('.asheet')), 'reopening the app offers to pick the timer up, with the time so far', await pg.textContent('.asheet'));
  await actionChoose(pg, 'Open the timer'); await pg.waitForSelector('#tmMain');
  ok((await tm()) === '17:30', 'it carries on from the saved timestamps', await tm());
  await at(900000); await pg.waitForTimeout(450); await pg.click('#tmStop');
  ok(/Add 15:00 to Brisk walk/.test(await pg.textContent('#tmConfirmText')), 'stop: "Add 15:00 to Brisk walk"');
  await pg.click('#tmAdd'); await sheetGone(pg); await settle(pg);
  ok((await stored(pg)).days[TK].vals.walk === 15 && !(await mock(pg)).pending[1900], 'minutes are added as 15 and the target notification is cancelled', (await stored(pg)).days[TK]);
  // a very short run adds nothing
  await at(1000000);
  await pg.click(`${cardSel('walk')} .timerbtn`); await pg.waitForSelector('#tmMain'); await pg.click('#tmMain'); await pg.click('#tmStop');
  ok(/too short/.test(await pg.textContent('#tmConfirmText')) && !(await pg.isVisible('#tmAdd')), 'a run of under a second says it was too short to add');
  await pg.click('#tmDiscard'); await sheetGone(pg);
  ok(errs.length === 0, 'no JS errors (timer 2)', errs);
  await ctx.close();
}
console.log('Timer: reduced motion and large text');
{
  const s = plan(['plank']);
  const { ctx, pg, errs } = await open({ data: days3({ settings: s }), still: true, scheme: 'dark', w: 320, h: 640 });
  await pg.evaluate(() => { document.documentElement.style.fontSize = '160%'; });
  await pg.click(`${cardSel('plank')} .timerbtn`); await pg.waitForSelector('#tmMain');
  ok((await pg.$eval('#tmPrg', e => getComputedStyle(e).transitionDuration)).split(',').every(x => parseFloat(x) < 0.001), 'reduced motion: the ring does not animate');
  const small = await pg.evaluate(() => [...document.querySelectorAll('.timer button,.sheet .txtbtn')].filter(e => e.offsetParent !== null).map(e => ({ n: e.id || e.textContent.slice(0, 12), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })).filter(x => x.h < 44 || x.w < 44));
  ok(small.length === 0, 'every timer button is at least 44px at 160% text', small);
  ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), 'nothing scrolls sideways on a narrow screen');
  await pg.click('#tmClose'); await sheetGone(pg);
  ok(errs.length === 0, 'no JS errors (timer a11y)', errs);
  await ctx.close();
}

/* ================= the first-week ramp ================= */
console.log('First-week ramp');
{
  const { ctx, pg, errs } = await open({ native: false, onboard: true });
  await pg.waitForSelector('#onbNext');
  await pg.click('#onbNext'); await pg.click('#plan-desk'); await pg.click('#onbNext'); await pg.click('#onbStart');
  await pg.waitForFunction(() => !document.querySelector('.onb')); await ready(pg);
  ok((await pg.$$eval('#sections .titem', e => e.map(x => x.dataset.id))).filter(i => !['weight', 'waist'].includes(i)).join() === 'steps,walk,standups', 'a new install with a starter plan shows only the first three habits on Today');
  ok(/More when you're ready \(4\)/.test(await pg.textContent('#rampMore')) && (await pg.getAttribute('#rampMore', 'aria-label')).includes('4 more'), 'and a "More when you\'re ready (4)" row');
  await gear(pg);
  ok(await pg.isChecked('#rampOn') && /Ease me in during the first week/.test(await pg.textContent('#rampRow')), 'Settings > Suggestions has "Ease me in during the first week", on');
  await pg.uncheck('#rampOn'); await tab(pg, 'today').catch(() => {}); if (await pg.isVisible('#navBack')) await pg.click('#navBack');
  await pg.waitForFunction(() => document.querySelectorAll('#sections .titem').length > 4);
  ok(!(await pg.$('#rampMore')) && (await stored(pg)).settings.prefs.ramp === false, 'turning it off shows everything');
  await gear(pg); await pg.check('#rampOn'); await pg.click('#navBack');
  await pg.waitForSelector('#rampMore');
  await pg.click('#rampMore');
  ok(await until(pg, () => document.querySelectorAll('#sections .titem').length > 4) && !(await pg.$('#rampMore')) && (await stored(pg)).settings.prefs.ramp === false, 'tapping the row shows the rest and ends the ramp');
  ok(errs.length === 0, 'no JS errors (ramp)', errs);
  await ctx.close();
}
console.log('First-week ramp: day 4 and existing users');
{
  const s = Core.defaultSettings(); s.prefs = { suggestions: true, ramp: true, rampStart: '2026-09-29' };      // day 4 on Friday 2 October
  const { ctx, pg, errs } = await open({ data: days3({ settings: s, days: { '2026-10-01': day('2026-10-01', { walk: 10 }) } }), native: false });
  ok((await pg.$$('#sections .hcard, #sections .yrow, #sections .drow')).length === 3 + 0 || (await pg.$$eval('#sections .titem', e => e.filter(x => !['weight', 'waist'].includes(x.dataset.id)).length)) === 3, 'three habits show');
  ok(await pg.isVisible('#rampOffer') && /Add another habit\?/.test(await pg.textContent('#rampOffer')), 'on day 4: "Add another habit?"');
  await pg.click('#rampAddOne'); await settle(pg);
  ok((await pg.$$eval('#sections .titem', e => e.filter(x => !['weight', 'waist'].includes(x.dataset.id)).length)) === 4 && !(await pg.$('#rampOffer')), 'Add one shows one more habit and the offer is gone');
  await pg.reload(); await ready(pg);
  ok(!(await pg.$('#rampOffer')) && (await stored(pg)).settings.prefs.rampLimit === 4, 'it is offered once');
  await ctx.close();
  const old = await open({ native: false });
  ok(!(await old.pg.$('#rampMore')) && (await old.pg.$$eval('#sections .titem', e => e.length)) > 8, 'an existing user (no ramp setting) sees every habit');
  await gear(old.pg);
  ok(!(await old.pg.$('#rampOn')), 'and never sees the ramp switch');
  ok(errs.length === 0 && old.errs.length === 0, 'no JS errors (day 4)', [...errs, ...old.errs]);
  await old.ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
