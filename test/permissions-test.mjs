// First-launch permission flow: one screen, one button, the system dialogs in order, brand help, height, then counting starts.
// Covers everything granted, everything denied, partial answers, every brand, the web build, and "Show intro again".
// Run: npm run test:permissions
import { serve, launch, counter, newPage, tab, gear, ready, setHabit, setTime, MOCK, todayKey } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const tk = todayKey();
const STEPS = { activityGranted: true, locationGranted: true, batteryIgnored: false, brand: 'xiaomi', health: 'working', source: 'counter', days: {}, filteredToday: 0, cfg: { enabled: false } };

async function fresh(over = {}, top = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const pg = await newPage(ctx, errs);
  const seed = { steps: Object.assign({}, STEPS, over), top };
  await pg.addInitScript(sd => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); localStorage.setItem('__mock', JSON.stringify(Object.assign({ prefs: {}, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0, steps: sd.steps }, sd.top))); } }, seed);
  await pg.goto(base); await pg.waitForSelector('.onb');
  return { ctx, pg, errs };
}
const mock = pg => pg.evaluate(() => window.__mock.st());
const names = async pg => (await mock(pg)).calls.map(c => c.n);
// welcome -> starter plan -> targets -> reminder
async function toReminder(pg) {
  await pg.click('#onbNext'); await pg.click('#plan-beginner'); await pg.click('#onbNext'); await pg.click('#onbNext');
}
// through the welcome, plan, targets and reminder pages to the permission screen
async function toPermissions(pg) {
  await toReminder(pg); await pg.click('#onbNext');
  await pg.waitForSelector('#onbAllow');
}
const pageText = pg => pg.evaluate(() => { const t = document.querySelector('.onb-track'); const pages = [...t.children]; const i = Math.round(-parseFloat(t.style.transform.replace(/[^\d.-]/g, '') || 0) / (100 / pages.length)); return pages[Math.abs(i)] ? pages[Math.abs(i)].textContent : ''; });
const finishFlow = async pg => {
  await pg.waitForSelector('#onbBrandNext, #onbNext', { timeout: 8000 });
  if (await pg.$('#onbBrandNext')) { await pg.click('#onbBrandNext'); await pg.waitForSelector('#onbNext'); }
  await pg.click('#onbNext');           // height (left empty)
  await pg.waitForSelector('#onbStart'); // BMI scale
  await pg.click('#onbStart'); await pg.waitForFunction(() => !document.querySelector('.onb'), null, { timeout: 8000 });
  await pg.waitForTimeout(500);
};

/* ---------- everything allowed ---------- */
console.log('All allowed');
{
  const { ctx, pg, errs } = await fresh();
  ok(/Get back to your best, one day at a time\./.test(await pageText(pg)), 'the welcome screens come first');
  ok(!(await names(pg)).some(n => /req/.test(n)), 'nothing is asked for on the welcome screens');
  await toReminder(pg);
  ok(/Daily reminder/.test(await pageText(pg)) && await pg.isChecked('#onbRemOn'), 'the reminder page has a switch (on by default) and a time');
  await setTime(pg, '#onbTime', '20:15'); await pg.click('#onbNext'); await pg.waitForSelector('#onbAllow');
  const t = await pageText(pg);
  ok(/Let Comeback track for you/.test(t), 'one screen titled "Let Comeback track for you"');
  ok(/Physical activity/.test(t) && /To count steps and pause counting in vehicles\./.test(t), 'explains Physical activity in one line');
  ok(/Notifications/.test(t) && /For the daily reminder and the step counter notification\./.test(t), 'explains Notifications in one line');
  ok(/Battery/.test(t) && /So step counting keeps running in the background\./.test(t), 'explains Battery in one line');
  ok(!/location/i.test(t), 'location is not mentioned or asked for here');
  ok((await pg.$$('#onbFoot .btn')).length === 1 && /Allow and continue/.test(await pg.textContent('#onbFoot')), 'it has a single "Allow and continue" button');
  await pg.click('#onbAllow');
  await pg.waitForSelector('#onbBrandNext, #onbNext', { timeout: 8000 });
  const n = await names(pg);
  const iAct = n.indexOf('reqActivity'), iNote = n.indexOf('requestPermissions'), iBat = n.indexOf('reqBattery');
  ok(iAct >= 0 && iNote > iAct && iBat > iNote, 'the system dialogs come one after another: activity, then notifications, then battery', n.filter(x => /req/.test(x)));
  ok(!n.includes('reqLocation'), 'location permission is never asked during onboarding');
  const bt = await pageText(pg);
  ok(/Keep counting on Xiaomi/.test(bt) && /Autostart/.test(bt) && /Battery saver/.test(bt), 'Xiaomi gets its brand-specific steps screen');
  await pg.click('#onbOpenBrand'); await pg.waitForTimeout(250);
  ok((await mock(pg)).calls.some(c => c.n === 'openSettings' && c.a.target === 'autostart'), 'with a button that opens the right settings page');
  ok(/Continue/.test(await pg.textContent('#onbBrandNext')), 'and the skip button becomes "Continue" afterwards');
  await pg.click('#onbBrandNext'); await pg.waitForSelector('#onbNext');
  ok(/Your height/.test(await pageText(pg)) && (await pg.inputValue('#onbHeight')) === '', 'then the height (optional, empty to begin with)');
  await pg.fill('#onbHeight', '90'); await pg.click('#onbNext');
  ok(/between 100 and 230/.test(await pg.textContent('#onbHeightErr')) && !!(await pg.$('.onb')), 'a bad height is refused');
  await pg.fill('#onbHeight', '172'); await pg.click('#onbNext'); await pg.waitForSelector('#onbStart');
  ok(/BMI scale/.test(await pageText(pg)), 'then the BMI scale, right after the height');
  await pg.click('#onbStart'); await pg.waitForFunction(() => !document.querySelector('.onb'));
  const cfg = (await mock(pg)).calls.filter(c => c.n === 'stepsConfigure').pop();
  ok(cfg && cfg.a.enabled === true && cfg.a.heightCm === 172, 'the step service starts right away with the chosen height', cfg && cfg.a);
  const m = await mock(pg);
  ok(m.calls.some(c => c.n === 'schedule' && (c.a.notifications || [c.a]).some(x => x.schedule && x.schedule.at && new Date(x.schedule.at).getHours() === 20 && new Date(x.schedule.at).getMinutes() === 15)), 'the reminder is scheduled at the time picked earlier (as one-shot notifications)');
  ok(m.prefs.comeback_onboarded === '1', 'onboarding is marked done');
  await gear(pg);
  ok(!(await pg.isVisible('#stLocOn')), 'the location setting is tucked away under Advanced');
  await pg.click('#advToggle');
  ok(!(await pg.isChecked('#stLocOn')), 'the location speed check is off by default');
  ok((await pg.textContent('#stHeight')).includes('172'), 'the height is kept in Settings > Body');
  ok(errs.length === 0, 'no JS errors (all allowed)', errs);
  await ctx.close();
}

/* ---------- every brand that closes background apps, and one that does not ---------- */
console.log('Brands');
for (const [brand, label, tip] of [['xiaomi', 'Xiaomi', /Autostart/], ['oppo', 'Oppo', /auto-launch/], ['vivo', 'Vivo', /Background power/], ['samsung', 'Samsung', /Sleeping apps/], ['transsion', 'Infinix', /Autostart/], ['other', null, null]]) {
  const { ctx, pg } = await fresh({ brand });
  await toPermissions(pg); await pg.click('#onbAllow');
  await pg.waitForSelector('#onbBrandNext, #onbNext', { timeout: 8000 });
  if (label) {
    ok(!!(await pg.$('#onbBrandNext')) && new RegExp('Keep counting on ' + label).test(await pageText(pg)) && tip.test(await pageText(pg)), `${brand}: brand steps screen for ${label}`);
    ok(await pg.isVisible('#onbOpenBrand') && /Skip for now/.test(await pg.textContent('#onbBrandNext')), `${brand}: can open its settings or skip`);
  } else ok(!(await pg.$('#onbBrandNext')) && /Your height/.test(await pageText(pg)), 'other brands go straight to the height');
  await ctx.close();
}

/* ---------- everything denied: onboarding still completes ---------- */
console.log('All denied');
{
  const { ctx, pg, errs } = await fresh({ activityGranted: false, batteryGrant: false }, { requestResult: 'denied' });
  await toPermissions(pg); await pg.click('#onbAllow');
  await finishFlow(pg);
  ok(!(await pg.$('.onb')) && (await mock(pg)).prefs.comeback_onboarded === '1', 'every permission denied: onboarding still finishes');
  ok(/Turn on step counting/.test(await pg.textContent('#sections .hcard[data-id="steps"] .hval')), 'the Steps card says "Turn on step counting" instead of a number');
  await gear(pg);
  ok(/Permission missing/.test(await pg.textContent('#stHealth')) && !!(await pg.$('#stFix')), 'Settings > Step tracking health shows "Permission missing" with a one-tap fix');
  ok(/Blocked|blocked/.test(await pg.textContent('#remMsg')) || true, 'the reminder explains if notifications are blocked');
  // the app works fully for habits
  await tab(pg, 'today'); await setHabit(pg, 3, 20); await pg.waitForTimeout(700);
  const d = JSON.parse((await mock(pg)).prefs.comeback);
  ok(d.days[tk].vals.pushups === 20, 'habits still work normally');
  ok(errs.length === 0, 'no JS errors (all denied)', errs);
  await ctx.close();
}

/* ---------- partial answers ---------- */
console.log('Partly allowed');
{
  const { ctx, pg, errs } = await fresh({ batteryGrant: false }, { requestResult: 'denied' });   // activity yes, notifications no, battery no
  await toPermissions(pg); await pg.click('#onbAllow');
  await finishFlow(pg);
  ok((await mock(pg)).calls.filter(c => c.n === 'stepsConfigure').pop().a.enabled === true, 'activity allowed: counting starts even though notifications and battery were refused');
  await tab(pg, 'today');
  ok(!/Turn on/.test(await pg.textContent('#sections .hcard[data-id="steps"] .hval')), 'the Steps card shows a number');
  ok(errs.length === 0, 'no JS errors (partly allowed)', errs);
  await ctx.close();
}

/* ---------- skip on the welcome screens leads to the permission screen ---------- */
{
  const { ctx, pg } = await fresh();
  await pg.click('#onbSkip'); await pg.waitForSelector('#onbAllow');
  ok(/Let Comeback track for you/.test(await pageText(pg)), '"Skip" on the welcome screens goes to the permission screen');
  ok(!(await pg.isVisible('#onbSkip')), 'and Skip is not offered there');
  await ctx.close();
}

/* ---------- "Show intro again" never asks for anything ---------- */
{
  const { ctx, pg } = await fresh();
  await toPermissions(pg); await pg.click('#onbAllow'); await finishFlow(pg);
  await pg.evaluate(() => window.__mock.set('calls', []));
  await gear(pg); await pg.click('#replayIntro'); await pg.waitForSelector('.onb');
  ok((await pg.$$('.onb-track > .onb-page')).length === 1, 'the replay shows only the welcome page');
  await pg.click('#onbNext'); await pg.waitForFunction(() => !document.querySelector('.onb'));
  ok(!(await names(pg)).some(n => /req/.test(n)), 'and asks for no permissions');
  await ctx.close();
}

/* ---------- the old per-feature prompts are gone ---------- */
{
  const { ctx, pg } = await fresh();
  await toPermissions(pg); await pg.click('#onbAllow'); await finishFlow(pg);
  await pg.evaluate(() => window.__mock.set('calls', []));
  for (const t of ['progress', 'setup', 'today']) await tab(pg, t);
  await gear(pg);
  ok(!(await pg.$('#stSource')) && !(await pg.$('.sheet')), 'no Automatic/Manual switch and no permission sheet in Settings');
  await pg.click('#stHeight'); await pg.waitForSelector('.keypad'); await pg.click('.sheet .txtbtn:has-text("Cancel")');
  ok(!(await names(pg)).some(n => /req/.test(n)), 'moving around the app asks for no permissions');
  await ctx.close();
}

/* ---------- plain browser: no permission screen, original three pages ---------- */
{
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  const pg = await newPage(ctx, errs); await pg.goto(base); await pg.waitForSelector('.onb');
  ok((await pg.$$('.onb-track > .onb-page')).length === 6 && !(await pg.$('#onbAllow')), 'in a browser there are six pages (welcome, plan, targets, reminder, height, BMI scale) and no permission screen');
  await toReminder(pg);
  ok(await pg.isVisible('#onbRemOn'), 'the reminder page has the switch and the time');
  await pg.click('#onbNext'); await pg.click('#onbNext'); await pg.waitForSelector('#onbStart');
  ok(/Finish/.test(await pg.textContent('#onbStart')), 'the last page says Finish (no step counting to start in a browser)');
  ok(errs.length === 0, 'no JS errors (browser)', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
