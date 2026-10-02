// Pull-to-refresh on Today: the panel and its line, nudges from your data, the 20-pull no-repeat rule, one read of the step plugin,
// a sync only when the last one is over 5 minutes old, timing (1 to 2.5 s), haptic, reduced motion.
// Real touch gestures are sent through the DevTools protocol. Run: npm run test:refresh
import fs from 'fs';
import { serve, launch, counter, newPage, tab, ready, MOCK, todayKey, daysAgo, root } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const tk = todayKey();
const STEPS = { activityGranted: true, locationGranted: true, batteryIgnored: false, brand: 'other', health: 'working', source: 'counter', days: {}, filteredToday: 0, cfg: { enabled: false } };
const HOURLY = Array.from({ length: 24 }, (_, i) => (i === 18 ? 1240 : 0));
const SET2 = { habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }, { id: 'pushups', name: 'Pushups', unit: 'reps', target: 10 }, { id: 'water', name: 'Water', unit: 'litres', target: 2 }], rules: [] };
const day = (k, vals) => ({ vals, rules: {}, weight: null, waist: null, note: '', date: k, updatedAt: 1e12 });

async function open({ data, steps, native = true, reduced = false, cloud = false } = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, hasTouch: true, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  if (native) await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const prefs = { comeback_onboarded: '1' }; if (data) prefs.comeback = JSON.stringify(data);
  await ctx.addInitScript(sd => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); if (sd.native) localStorage.setItem('__mock', JSON.stringify({ prefs: sd.prefs, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0, steps: sd.steps })); else { for (const k of Object.keys(sd.prefs)) localStorage.setItem('CapacitorStorage.' + k, sd.prefs[k]); } } }, { native, prefs, steps: Object.assign({}, STEPS, steps || {}) });
  if (cloud) { await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.COMEBACK_CONFIG={SUPABASE_URL:'https://x.supabase.test',SUPABASE_PUBLISHABLE_KEY:'k'}" })); await ctx.route(/supabase\.test/, r => r.abort('internetdisconnected')); }
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await ready(pg); await pg.waitForTimeout(native ? 900 : 300);
  const cdp = await ctx.newCDPSession(pg);
  return { ctx, pg, cdp, errs };
}
const mock = pg => pg.evaluate(() => window.__mock.st());
const calls = async (pg, n) => (await mock(pg)).calls.filter(c => c.n === n);
const touch = (cdp, type, y, x = 200) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
/** Drag down by dy px from y0 in small steps. hold: keep the finger down this long (ms) before lifting. */
async function pull(cdp, dy, { y0 = 140, steps = 12, hold = 0, release = true } = {}) {
  await touch(cdp, 'touchStart', y0);
  for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', y0 + dy * i / steps);
  if (hold) await new Promise(r => setTimeout(r, hold));
  if (release) await touch(cdp, 'touchEnd', y0 + dy);
}
const panel = pg => pg.evaluate(() => { const p = document.getElementById('ptr'); return { hold: p.classList.contains('hold'), ready: p.classList.contains('ready'), h: parseFloat(getComputedStyle(p).height), text: document.getElementById('ptrText').textContent, cs: p.className }; });
const waitClosed = pg => pg.waitForFunction(() => { const p = document.getElementById('ptr'); return !p.classList.contains('hold') && parseFloat(getComputedStyle(p).height) < 1; }, null, { timeout: 8000 });
const NUDGES = JSON.parse(fs.readFileSync(root + '/data/nudges.json', 'utf8')).lines;

/* ---------- the lines file ---------- */
console.log('Lines file');
{
  ok(NUDGES.length >= 55 && NUDGES.length <= 70, `about 60 lines (${NUDGES.length})`);
  ok(NUDGES.every(l => typeof l === 'string' && l.length > 0 && l.length < 60), 'every line is under 60 characters', NUDGES.filter(l => l.length >= 60));
  ok(new Set(NUDGES).size === NUDGES.length, 'no duplicate lines');
  ok(!NUDGES.some(l => /["“”—–]|\s-\s|said|according/i.test(l)), 'no quotes attributed to anyone');
  ok(!NUDGES.some(l => /\b(lazy|fail|failure|miss(ed)?|behind|should|must|guilt|shame|excuse|fat|weak|only)\b/i.test(l)), 'no guilt wording', NUDGES.filter(l => /\b(lazy|fail|failure|miss(ed)?|behind|should|must|guilt|shame|excuse|fat|weak|only)\b/i.test(l)));
  ok(!NUDGES.some(l => /liver|cholesterol|doctor|disease|cure|treat|medic|diabet|blood|pressure|cancer|heart|weight loss|lose weight/i.test(l)), 'no medical claims');
  ok(['Small steps still move you forward.', 'Show up today. That\'s the win.', 'Progress beats perfect.'].every(l => NUDGES.includes(l)), 'the three example lines are included');
}

/* ---------- the pull gesture ---------- */
console.log('Pull gesture');
{
  const { ctx, pg, cdp, errs } = await open({ data: { version: 1, settings: SET2, days: { [tk]: day(tk, { steps: 6760, pushups: 3, water: 1 }) } } });
  await pg.waitForFunction(() => window.__mock.st().calls.some(c => c.n === 'stepsConfigure' && c.a.enabled));
  await pg.waitForTimeout(2000);   // the first delayed read after switching counting on
  const before = await pg.evaluate(() => document.querySelector('.large-title').getBoundingClientRect().top);
  ok((await panel(pg)).h < 1, 'the panel is closed and takes no room at rest');
  // a short pull does nothing
  const reads0 = (await calls(pg, 'stepsGetDays')).length, imp0 = (await calls(pg, 'impact')).length;
  await pull(cdp, 40); await pg.waitForTimeout(700);
  ok((await calls(pg, 'stepsGetDays')).length === reads0 && (await calls(pg, 'impact')).length === imp0 && (await panel(pg)).h < 1, 'a short pull below the threshold does not refresh, buzz, or leave the panel open');
  // mid-pull: the panel opens following the finger, ready flag + haptic at the threshold
  await pull(cdp, 150, { hold: 250, release: false });
  const mid = await panel(pg);
  ok(mid.ready && mid.h > 30 && mid.text.length > 0, 'while pulling past the threshold the panel is open, armed, and already shows a line', mid);
  ok((await calls(pg, 'impact')).length === imp0 + 1, 'one light haptic tap when the threshold is reached');
  const moved = await pg.evaluate(() => document.querySelector('.large-title').getBoundingClientRect().top);
  ok(moved > before + 20, 'the content is pushed down by the open panel', [before, moved]);
  // release: refresh runs, step count read once, card updates
  await pg.evaluate(() => window.__mock.steps({ days: { [new Date().toISOString().slice(0, 0) || '']: {} } }));
  await pg.evaluate(([k, h]) => window.__mock.steps({ days: { [k]: { steps: 7100, filtered: 12, hourly: h } } }), [tk, HOURLY]);
  const t0 = Date.now();
  await touch(cdp, 'touchEnd', 290);
  await pg.waitForFunction(() => document.getElementById('ptr').classList.contains('hold'));
  const held = await panel(pg);
  ok(held.hold && held.h > 40 && held.text.length > 0 && held.text.length < 60, 'on release the panel holds with one short line', held);
  await pg.waitForFunction(() => document.querySelector('#habitList .hcard[data-id="steps"] .hval').textContent === '7,100', null, { timeout: 4000 });
  ok(true, 'the Steps card shows the freshly read count (7,100)');
  ok((await calls(pg, 'stepsGetDays')).length === reads0 + 1, 'the step plugin was read exactly once for this pull', (await calls(pg, 'stepsGetDays')).length - reads0);
  ok(/6 PM|1,240|km/.test(await pg.textContent('#habitList .hcard[data-id="steps"] .hsrc')) || /km/.test(await pg.textContent('#habitList .hcard[data-id="steps"] .hsrc')), 'distance updates with it');
  ok((await pg.textContent('#headScore')) !== '0%', 'the ring is updated');
  await waitClosed(pg);
  const shown = Date.now() - t0;
  ok(shown >= 950 && shown <= 3300, 'a fast refresh keeps the panel open about 1 second', shown);
  const after = await pg.evaluate(() => document.querySelector('.large-title').getBoundingClientRect().top);
  await pg.waitForTimeout(500);
  const after2 = await pg.evaluate(() => document.querySelector('.large-title').getBoundingClientRect().top);
  ok(Math.abs(after2 - before) < 2, 'the panel closes smoothly and the content returns to where it was', [before, after, after2]);
  ok(errs.length === 0, 'no JS errors (pull)', errs);
  await ctx.close();
}

/* ---------- timing: a slow read never keeps the panel open past ~2.5 s ---------- */
console.log('Timing');
{
  const { ctx, pg, cdp, errs } = await open({ data: { version: 1, settings: SET2, days: { [tk]: day(tk, { steps: 100 }) } } });
  await pg.waitForTimeout(2000);
  await pg.evaluate(() => { const P = window.ComebackNative.Steps, o = P.getDays; P.getDays = () => new Promise(r => setTimeout(() => o().then(r), 6000)); });
  await pull(cdp, 160);
  const t0 = Date.now();
  await pg.waitForFunction(() => document.getElementById('ptr').classList.contains('hold'));
  await pg.waitForFunction(() => !document.getElementById('ptr').classList.contains('hold'), null, { timeout: 6000 });
  const t = Date.now() - t0;
  ok(t >= 2300 && t <= 3100, 'a slow refresh closes the panel after at most about 2.5 seconds', t);
  ok(errs.length === 0, 'no JS errors (slow)', errs);
  await ctx.close();
}

/* ---------- sync only when the last one is over 5 minutes old ---------- */
console.log('Sync throttle');
{
  const { ctx, pg, cdp, errs } = await open({ cloud: true, native: false, data: { version: 1, settings: SET2, days: { [tk]: day(tk, { steps: 100 }) } } });
  await pg.waitForTimeout(2000);
  await pg.evaluate(() => { window.__sync = 0; sync.signedIn = true; window.syncSoon = () => { window.__sync++; return Promise.resolve(); }; sync.lastSyncAt = Date.now() - 60 * 1000; });
  await pull(cdp, 160); await waitClosed(pg);
  ok((await pg.evaluate(() => window.__sync)) === 0, 'last sync 1 minute ago: no sync');
  await pg.evaluate(() => { sync.lastSyncAt = Date.now() - 4.5 * 60 * 1000; });
  await pull(cdp, 160); await waitClosed(pg);
  ok((await pg.evaluate(() => window.__sync)) === 0, 'last sync 4.5 minutes ago: still no sync');
  await pg.evaluate(() => { sync.lastSyncAt = Date.now() - 6 * 60 * 1000; });
  await pull(cdp, 160); await waitClosed(pg);
  ok((await pg.evaluate(() => window.__sync)) === 1, 'last sync 6 minutes ago: one sync');
  await pg.evaluate(() => { sync.signedIn = false; sync.lastSyncAt = 0; });
  await pull(cdp, 160); await waitClosed(pg);
  ok((await pg.evaluate(() => window.__sync)) === 1, 'signed out: never syncs');
  ok(errs.length === 0, 'no JS errors (sync)', errs);
  await ctx.close();
}

/* ---------- where the gesture works ---------- */
console.log('Where it works');
{
  const { ctx, pg, cdp, errs } = await open({ data: { version: 1, settings: SET2, days: { [tk]: day(tk, { steps: 100 }) } } });
  await pg.waitForTimeout(2000);
  const reads = async () => (await calls(pg, 'stepsGetDays')).length;
  let r0 = await reads();
  await tab(pg, 'progress'); await pg.waitForTimeout(400); await pull(cdp, 160); await pg.waitForTimeout(900);
  ok((await reads()) === r0 && (await panel(pg)).h < 1, 'on Progress the pull does nothing');
  await tab(pg, 'setup'); await pg.waitForTimeout(300); await pull(cdp, 160); await pg.waitForTimeout(900);
  ok((await reads()) === r0, 'on Plan the pull does nothing');
  await tab(pg, 'today'); await pg.waitForTimeout(300);
  await pg.evaluate(() => window.scrollTo(0, 300)); await pg.waitForTimeout(200);
  await pull(cdp, 160); await pg.waitForTimeout(900);
  ok((await reads()) === r0 && (await panel(pg)).h < 1, 'when Today is scrolled down the pull scrolls instead of refreshing');
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.click('#habitList .hcard:nth-child(2)'); await pg.waitForSelector('.keypad');
  await pull(cdp, 160, { y0: 60 }); await pg.waitForTimeout(900);
  ok((await reads()) === r0, 'with a sheet open the pull does nothing');
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await pg.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  // horizontal drags are ignored
  await touch(cdp, 'touchStart', 200); for (let i = 1; i <= 10; i++) await touch(cdp, 'touchMove', 200 + i, 200 + i * 5); await touch(cdp, 'touchEnd', 210, 250); await pg.waitForTimeout(500);
  ok((await reads()) === r0, 'a sideways swipe is not a pull');
  ok(errs.length === 0, 'no JS errors (where)', errs);
  await ctx.close();
}

/* ---------- nudges from your data ---------- */
console.log('Nudges');
async function nudgeIn(data, steps) {
  const { ctx, pg } = await open({ data, steps });
  await pg.waitForFunction(() => window.__mock.st().calls.some(c => c.n === 'stepsConfigure' && c.a.enabled));
  await pg.evaluate(() => { Math.random = () => 0; });
  await pg.waitForTimeout(1800);
  const n = await pg.evaluate(() => chooseNudge());
  await ctx.close();
  return n;
}
const mk = (days, settings = SET2) => ({ version: 1, settings, days });
{
  // steps to go (the phone reports 6,760 today)
  const { ctx, pg } = await open({ data: mk({ [tk]: day(tk, { pushups: 10, water: 2 }) }) });
  await pg.waitForFunction(() => window.__mock.st().calls.some(c => c.n === 'stepsConfigure' && c.a.enabled));
  await pg.evaluate(([k, h]) => { window.__mock.steps({ days: { [k]: { steps: 6760, filtered: 0, hourly: h } } }); window.__mock.fire('stepsChanged', { days: { [k]: { steps: 6760, filtered: 0, hourly: h } }, health: 'working' }); }, [tk, HOURLY]);
  await pg.waitForTimeout(1600);
  await pg.evaluate(() => { Math.random = () => 0; });
  const n1 = await pg.evaluate(() => chooseNudge());
  ok(n1.text === '1,240 steps to today\'s goal' && n1.icon === 'footprints', 'steps to the goal: "1,240 steps to today\'s goal"', n1);
  await ctx.close();
}
{
  const n = await nudgeIn(mk({ [tk]: day(tk, { steps: 8000, pushups: 0, water: 2 }) }), { days: { [tk]: { steps: 8000, filtered: 0, hourly: HOURLY } } });
  ok(n.text === 'Pushups not logged yet today', 'an unlogged target: "Pushups not logged yet today"', n);
}
{
  const n = await nudgeIn(mk({ [daysAgo(2)]: day(daysAgo(2), { steps: 9000, pushups: 12, water: 2 }), [daysAgo(1)]: day(daysAgo(1), { steps: 9000, pushups: 12, water: 2 }), [tk]: day(tk, { steps: 8000, pushups: 5, water: 1 }) }), { days: { [tk]: { steps: 8000, filtered: 0, hourly: HOURLY } } });
  ok(n.text === '3-day streak. Keep it going.' && n.icon === 'flame', 'a running streak: "3-day streak. Keep it going."', n);
}
{
  const n = await nudgeIn(mk({ [daysAgo(1)]: day(daysAgo(1), { steps: 9000, pushups: 12, water: 2 }), [tk]: day(tk, { steps: 8000, pushups: 10, water: 2 }) }), { days: { [tk]: { steps: 8000, filtered: 0, hourly: HOURLY } } });
  ok(n.text === 'Strong day. Your comeback is on track.' && n.icon === 'trophy', 'all targets met: "Strong day. Your comeback is on track."', n);
}
{
  // nothing applies: no steps habit, a tiny log (score under 50 so no streak), every target already has a value
  const set = { habits: [{ id: 'pushups', name: 'Pushups', unit: 'reps', target: 100 }], rules: [] };
  const n = await nudgeIn(mk({ [tk]: day(tk, { pushups: 1 }) }, set), undefined);
  ok(NUDGES.includes(n.text) && n.icon === 'sparkles', 'nothing contextual applies: a general line from the file', n);
}

/* ---------- never the same line twice within 20 pulls ---------- */
console.log('No repeats');
{
  const set = { habits: [{ id: 'pushups', name: 'Pushups', unit: 'reps', target: 100 }], rules: [] };
  const { ctx, pg, cdp, errs } = await open({ data: mk({ [tk]: day(tk, { pushups: 1 }) }, set) });
  await pg.waitForTimeout(1500);
  // 60 picks straight from the chooser: no line may reappear within the 20 before it
  const seq = await pg.evaluate(async () => { const out = []; for (let i = 0; i < 80; i++) out.push((await chooseNudge()).text); return out; });
  let bad = null;
  for (let i = 0; i < seq.length && !bad; i++) for (let j = Math.max(0, i - 20); j < i; j++) if (seq[j] === seq[i]) { bad = [i, j, seq[i]]; break; }
  ok(!bad, 'in 80 picks no line comes back within the last 20', bad);
  ok(new Set(seq.slice(0, 20)).size === 20, 'the first 20 are all different');
  const saved = JSON.parse((await mock(pg)).prefs.comeback_meta).nudges;
  ok(Array.isArray(saved) && saved.length === 20 && saved.join() === seq.slice(-20).join(), 'the last 20 shown are remembered on the phone', saved.length);
  // real pulls: texts differ and the history survives a restart
  const texts = [];
  for (let i = 0; i < 3; i++) { await pull(cdp, 160); await pg.waitForFunction(() => document.getElementById('ptr').classList.contains('hold')); texts.push((await panel(pg)).text); await waitClosed(pg); }
  ok(new Set(texts).size === 3 && texts.every(t => !seq.slice(-20).includes(t)), 'three real pulls show three different lines, none from the last 20', texts);
  await pg.reload(); await ready(pg); await pg.waitForTimeout(800);
  const hist = await pg.evaluate(() => meta.nudges.slice());
  ok(hist.length === 20 && texts.every(t => hist.includes(t)), 'after a restart the history is still there', hist.length);
  ok(errs.length === 0, 'no JS errors (repeats)', errs);
  await ctx.close();
}

/* ---------- reduce motion ---------- */
console.log('Reduce motion');
{
  const { ctx, pg, cdp, errs } = await open({ reduced: true, data: mk({ [tk]: day(tk, { steps: 100 }) }) });
  await pg.waitForTimeout(2000);
  const css = await pg.evaluate(() => { const p = document.getElementById('ptr'); return { tr: getComputedStyle(p).transitionDuration, inner: getComputedStyle(p.querySelector('.ptr-in')).transform }; });
  ok(/^0(\.0+1)?m?s/.test(css.tr) || parseFloat(css.tr) < 0.02, 'reduce motion: no spring or height animation', css);
  await pull(cdp, 60, { hold: 100, release: false });
  ok((await panel(pg)).h < 1, 'reduce motion: the panel does not follow the finger');
  await pull(cdp, 160, { y0: 140, hold: 100, release: false });
  const p = await panel(pg);
  ok(p.ready && p.h >= 50 && p.text.length > 0, 'it fades in once the pull is far enough', p);
  await touch(cdp, 'touchEnd', 300);
  await pg.waitForFunction(() => document.getElementById('ptr').classList.contains('hold'));
  await waitClosed(pg);
  ok(true, 'and closes again after the refresh');
  ok(errs.length === 0, 'no JS errors (reduce motion)', errs);
  await ctx.close();
}

/* ---------- plain browser and no libraries ---------- */
console.log('Browser and libraries');
{
  const { ctx, pg, cdp, errs } = await open({ native: false, data: mk({ [tk]: day(tk, { pushups: 5 }) }) });
  await pull(cdp, 160); await pg.waitForFunction(() => document.getElementById('ptr').classList.contains('hold'));
  ok((await panel(pg)).text.length > 0, 'in a browser (no step plugin) the panel still shows a line');
  await waitClosed(pg);
  const srcs = await pg.evaluate(() => [...document.scripts].map(s => s.getAttribute('src')));
  ok(srcs.every(s => /^(config\.js|vendor\/(icons|chart\.umd|native)\.js|js\/(logic|steps|ui|ptr)\.js)$/.test(s)), 'no animation library: only the app\'s own scripts and Chart.js load', srcs);
  const css = fs.readFileSync(root + '/css/app.css', 'utf8');
  ok(/\.ptr\{[^}]*transition:height/.test(css) && /@keyframes ptrpop/.test(css), 'the panel is animated with CSS transitions and keyframes');
  ok(errs.length === 0, 'no JS errors (browser)', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
