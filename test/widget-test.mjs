// Web-side tests for the home-screen widget feed (www/js/widget.js), with the mocked native bridge (st.widget.snapshots).
// What the widget draws, the arc geometry and the staleness rule are tested on the JVM (android/app/src/test/.../widget).
// Run: node test/widget-test.mjs
import { createRequire } from 'module';
import { serve, launch, counter, newPage, ready, settle, cardSel, MOCK, todayKey, daysAgo } from './helpers.mjs';

const Core = createRequire(import.meta.url)('../www/js/core.js');
const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const tk = todayKey();

const MOCK_STEPS = { activityGranted: true, locationGranted: true, batteryIgnored: false, brand: 'xiaomi', health: 'working', source: 'counter', days: {}, filteredToday: 0, cfg: { enabled: false } };
const META_ON = { steps: { heightCm: 180, strictness: 'balanced', sensitivity: 'normal', useLocation: false, enabledAt: Date.now() - 100 * 864e5, setupShown: true } };

const day = (k, vals = {}, rules = {}, extra = {}) => ({ vals, rules, weight: null, waist: null, note: '', date: k, updatedAt: 1e12, ...extra });
/** Every habit that can be met is met: the scoring habits at their target, the food rules ticked. */
const fullDay = (settings, k) => {
  const vals = {}, rules = {};
  settings.habits.forEach(h => { if (h.type === 'yesno') rules[h.id] = true; else if (h.type !== 'measure') vals[h.id] = h.target; });
  return day(k, vals, rules);
};

/** opts.days / opts.settings: what is saved; opts.native false = no mock bridge (a plain browser); opts.mock replaces the bridge text; opts.init runs before the page. */
async function open(opts = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  if (opts.native !== false) await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: opts.mock || MOCK }));
  const pg = await newPage(ctx, errs);
  const settings = opts.settings || Core.defaultSettings();
  const prefs = { comeback_onboarded: '1', comeback_meta: JSON.stringify(META_ON) };
  if (opts.days) prefs.comeback = JSON.stringify({ version: 2, settings, days: opts.days });
  const seed = { steps: MOCK_STEPS, prefs };
  if (opts.native !== false) await pg.addInitScript(sd => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); localStorage.setItem('__mock', JSON.stringify({ prefs: sd.prefs, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0, steps: sd.steps })); } }, seed);
  else await pg.addInitScript(() => { try { localStorage.setItem('CapacitorStorage.comeback_onboarded', '1'); localStorage.setItem('__ob', '1'); } catch (e) { } });
  if (opts.init) await pg.addInitScript(opts.init);
  await pg.goto(base); if (opts.hideAll) await pg.waitForTimeout(600); else await ready(pg);
  // the page has read its saved entries and any message waiting for the 1.5 s debounce has gone out
  if (opts.native !== false) await pg.waitForFunction(() => widgetReady && widgetTimer === null, null, { timeout: 15000 });
  return { ctx, pg, errs, settings };
}
const snaps = pg => pg.evaluate(() => (window.__mock.st().widget || { snapshots: [] }).snapshots);
const quiet = pg => pg.waitForTimeout(2300);   // the page waits 1.5 s before it sends
const sendDays = (pg, d) => pg.evaluate(x => { window.__mock.steps({ days: x, health: 'working' }); window.__mock.fire('stepsChanged', { days: x, health: 'working' }); }, d);
const HOURLY = new Array(24).fill(0);

/* ---------- what is in the snapshot ---------- */
console.log('Snapshot content');
{
  // an empty day
  const { ctx, pg, errs } = await open();
  const s = await snaps(pg);
  ok(s.length === 1, 'one snapshot after start-up (not one per draw)', s.length);
  const a = s[0];
  ok(Object.keys(a).sort().join() === 'date,label,openHabit,score,steps,stepsTarget,updatedAt', 'it has exactly the agreed fields', Object.keys(a));
  ok(a.date === tk && /^\d{4}-\d{2}-\d{2}$/.test(a.date), 'date is today as YYYY-MM-DD', a.date);
  ok(a.score === 0 && a.steps === 0 && a.label === null, 'empty day: score 0, no steps, no streak label', a);
  ok(a.stepsTarget === 8000, 'steps target comes from the Steps habit', a.stepsTarget);
  ok(typeof a.openHabit === 'string' && a.openHabit.length > 0 && a.openHabit !== 'Steps', 'next open habit is a name (not Steps, which has its own line)', a.openHabit);
  ok(Math.abs(a.updatedAt - Date.now()) < 60000, 'updatedAt is a recent time stamp in milliseconds', a.updatedAt);
  const first = await pg.evaluate(() => settings.habits.find(h => !h.hidden && h.type !== 'steps' && h.type !== 'measure').name);
  ok(a.openHabit === first, 'it is the first open habit in the plan order', [a.openHabit, first]);
  ok(errs.length === 0, 'no JS errors (empty day)', errs);
  await ctx.close();
}
{
  // a streak of 12 days and a partly done today. The first snapshot must already hold the saved entries, not the empty start-up screen.
  const settings = Core.defaultSettings();
  const d = {}; for (let i = 1; i <= 12; i++) d[daysAgo(i)] = fullDay(settings, daysAgo(i));
  d[tk] = day(tk, { pushups: 20, steps: 3000 });
  const { ctx, pg, errs } = await open({ days: d, settings });
  const s = await snaps(pg);
  ok(s.length === 1, 'saved entries: still one snapshot (the empty first draw is not sent)', s.map(x => [x.score, x.label]));
  const a = s[s.length - 1];
  ok(a.label === '12-day streak', 'label is the streak', a.label);
  ok(a.score > 0 && a.score < 100, 'partial day: a score between 0 and 100', a.score);
  const expected = await pg.evaluate(() => dayMetrics(days[todayStr()], todayStr()).score);
  ok(a.score === expected, 'the score is the one the ring on Today shows', [a.score, expected]);
  ok(a.steps === 3000 && a.stepsTarget === 8000, 'steps and target', a);
  ok(typeof a.openHabit === 'string' && a.openHabit !== 'Steps', 'there is still something open', a.openHabit);
  const ringText = (await pg.textContent('#headScore')).trim();
  ok(ringText === a.score + '%', 'same number as the ring text', ringText);
  ok(errs.length === 0, 'no JS errors (partial)', errs);
  await ctx.close();
}
{
  // a full day: everything met, score 100, nothing left open
  const settings = Core.defaultSettings();
  const d = {}; for (let i = 1; i <= 3; i++) d[daysAgo(i)] = fullDay(settings, daysAgo(i));
  d[tk] = fullDay(settings, tk);
  const { ctx, pg, errs } = await open({ days: d, settings });
  const a = (await snaps(pg)).pop();
  ok(a.score === 100 && a.openHabit === null, 'full day: 100 and nothing open', a);
  ok(a.label === '4-day streak', 'today counts in the streak', a.label);
  ok(a.steps === 8000, 'steps at the target', a.steps);
  ok(errs.length === 0, 'no JS errors (full)', errs);
  await ctx.close();
}
{
  // a light day: no score, no open habit
  const settings = Core.defaultSettings();
  const d = {}; for (let i = 1; i <= 5; i++) d[daysAgo(i)] = fullDay(settings, daysAgo(i));
  d[tk] = day(tk, { pushups: 5 }, {}, { light: true });
  const { ctx, pg, errs } = await open({ days: d, settings });
  const a = (await snaps(pg)).pop();
  ok(a.score === null && a.label === 'Light day' && a.openHabit === null, 'light day: no score, label "Light day", nothing open', a);
  ok(errs.length === 0, 'no JS errors (light)', errs);
  await ctx.close();
}
{
  // a rest day: nothing is due
  const settings = Core.defaultSettings();
  settings.habits.forEach(h => { h.hidden = true; });
  const { ctx, pg, errs } = await open({ hideAll: true, settings, days: { [daysAgo(2)]: day(daysAgo(2), { pushups: 10 }) } });
  const a = (await snaps(pg)).pop();
  ok(a.score === null && a.label === 'Rest day' && a.openHabit === null, 'rest day: no score, label "Rest day", nothing open', a);
  ok(a.steps === 0 && a.stepsTarget === 0, 'a hidden Steps habit sends no steps', a);
  ok(errs.length === 0, 'no JS errors (rest)', errs);
  await ctx.close();
}
{
  // long habit names are not cut here (the phone shortens them); the feed never carries a clock time
  const settings = Core.defaultSettings();
  const { ctx, pg } = await open({ settings, days: { [tk]: day(tk, { pushups: 1 }) } });
  const text = JSON.stringify((await snaps(pg)).pop());
  ok(!/\b\d{1,2}:\d{2}\b/.test(text.replace(/"updatedAt":\d+/, '')), 'no clock times in the snapshot');
  await ctx.close();
}

/* ---------- when it is sent ---------- */
console.log('When it is sent');
{
  const { ctx, pg, errs } = await open();
  const n0 = (await snaps(pg)).length;
  // three quick taps on + for Pushups: one message, 1.5 s after the last change
  for (let i = 0; i < 3; i++) await pg.click(`${cardSel('pushups')} .cbtn.plus`);
  await pg.waitForTimeout(500);
  ok((await snaps(pg)).length === n0, 'nothing is sent while changes are still coming in (debounce)');
  await pg.click(`${cardSel('pushups')} .cbtn.plus`);
  await pg.waitForTimeout(1000);
  ok((await snaps(pg)).length === n0, 'still nothing 1 s after the last tap');
  await pg.waitForTimeout(1500);
  const s = await snaps(pg);
  ok(s.length === n0 + 1, 'four taps become one message', s.length - n0);
  const expected = await pg.evaluate(() => dayMetrics(days[todayStr()], todayStr()).score);
  ok(s[s.length - 1].score === expected && expected > 0, 'and it carries the final score', [s[s.length - 1].score, expected]);
  ok(errs.length === 0, 'no JS errors (debounce)', errs);
  await ctx.close();
}
{
  // drawing Today again without a change sends nothing
  const { ctx, pg, errs } = await open();
  const n0 = (await snaps(pg)).length;
  await pg.evaluate(() => { renderToday(true); renderToday(); refreshAll(); });
  await pg.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await sendDays(pg, {});
  await quiet(pg);
  ok((await snaps(pg)).length === n0, 'nothing changed: nothing is sent', (await snaps(pg)).length - n0);
  ok(errs.length === 0, 'no JS errors (no change)', errs);
  await ctx.close();
}
{
  // new steps from the phone reach the snapshot
  const { ctx, pg, errs } = await open();
  const n0 = (await snaps(pg)).length;
  await sendDays(pg, { [tk]: { steps: 4100, filtered: 0, hourly: HOURLY } });
  await quiet(pg);
  const s = await snaps(pg);
  ok(s.length === n0 + 1 && s[s.length - 1].steps === 4100, 'a step update is sent', s.map(x => x.steps));
  ok(s[s.length - 1].score > 0, 'and the score moved with it', s[s.length - 1].score);
  ok(errs.length === 0, 'no JS errors (steps)', errs);
  await ctx.close();
}
{
  // leaving the app: the pending change goes at once, because the page stops running soon after
  const { ctx, pg, errs } = await open();
  const n0 = (await snaps(pg)).length;
  await pg.click(`${cardSel('walk')} .chipbtn >> nth=0`);   // +5 minutes of brisk walk
  await pg.waitForTimeout(300);
  ok((await snaps(pg)).length === n0, 'a change is waiting for its 1.5 s');
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.waitForTimeout(300);
  ok((await snaps(pg)).length === n0 + 1, 'hiding the page sends the pending snapshot straight away');
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
  ok(errs.length === 0, 'no JS errors (hidden)', errs);
  await ctx.close();
}
{
  // a new day: the snapshot follows the date even when the numbers look the same
  const { ctx, pg, errs } = await open();
  const n0 = (await snaps(pg)).length;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 5, 0, 0);
  let clock = true;
  try { await pg.clock.setFixedTime(tomorrow); } catch (e) { clock = false; }
  if (clock) {
    await pg.evaluate(() => { onResume(); });
    await quiet(pg);
    const s = await snaps(pg);
    const k = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
    ok(s.length === n0 + 1 && s[s.length - 1].date === k, 'after midnight a new snapshot with the new date is sent', s.map(x => x.date));
  } else console.log('  SKIP  fake clock not available');
  ok(errs.length === 0, 'no JS errors (new day)', errs);
  await ctx.close();
}
{
  // without the bundled plugin entry the Capacitor global is used
  const mock = MOCK.replace('Widget:{setWidgetSnapshot', 'NotWidget:{setWidgetSnapshot');
  const { ctx, pg, errs } = await open({ mock, init: () => { window.Capacitor = { registerPlugin: name => ({ setWidgetSnapshot: async o => { (window.__cap = window.__cap || []).push({ name, o }); return {}; } }) }; } });
  const cap = await pg.evaluate(() => window.__cap || []);
  ok(cap.length === 1 && cap[0].name === 'Widget' && cap[0].o.date === tk, 'falls back to Capacitor.registerPlugin("Widget")', cap.map(c => c.name));
  ok(errs.length === 0, 'no JS errors (fallback)', errs);
  await ctx.close();
}
{
  // a plugin that rejects does not break the page, and the same snapshot is tried again next time
  const mock = MOCK.replace("Widget:{setWidgetSnapshot:async function(o){", "Widget:{setWidgetSnapshot:async function(o){if(!window.__ok)throw new Error('nope');");
  const { ctx, pg, errs } = await open({ mock });
  ok((await snaps(pg)).length === 0, 'a failing plugin sends nothing and shows no error', errs);
  await pg.evaluate(() => { window.__ok = true; refreshAll(); });
  await quiet(pg);
  ok((await snaps(pg)).length === 1, 'the next change tries again', (await snaps(pg)).length);
  await ctx.close();
}

/* ---------- a plain browser ---------- */
console.log('Browser');
{
  const { ctx, pg, errs } = await open({ native: false });
  await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => ({ plugin: widgetPlugin(), sent: widgetSendNow(), timerBefore: widgetTimer, after: (pushWidgetSnapshot(), widgetTimer), mock: localStorage.getItem('__mock') }));
  ok(r.plugin === null && r.sent === false, 'no plugin and nothing sent', r);
  ok(r.timerBefore === null && r.after === null, 'no timer is ever started', r);
  ok(r.mock === null, 'nothing was stored for a widget', r.mock);
  await pg.click(`${cardSel('pushups')} .cbtn.plus`);
  await quiet(pg);
  ok(await pg.evaluate(() => widgetTimer === null), 'still nothing after logging something');
  ok(errs.length === 0, 'no JS errors (browser)', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
