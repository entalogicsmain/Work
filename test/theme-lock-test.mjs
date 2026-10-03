// Theme choice (System / Light / Dark) and the app lock (Settings > Appearance > Theme, Settings > Security).
// Theme: tokens flip, the choice persists across reloads and is applied before the first paint, System follows the phone, charts and the status bar follow isDark().
// Lock: refuses to turn on when the phone cannot check, locks at start and after the chosen delay, focus-trapped and inert behind, never traps anyone,
// device-local only. Run: node test/theme-lock-test.mjs
import { serve, launch, counter, newPage, gear, ready, MOCK, ymd } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();

const LIGHT_BG = '#E9EFF9', DARK_BG = '#070C0F';
const tok = (pg, name) => pg.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const attr = pg => pg.evaluate(() => document.documentElement.getAttribute('data-theme'));

/* ---------- a plain browser page (no native bridge) ---------- */
async function browserPage(scheme, seed) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, colorScheme: scheme || 'light' });
  await ctx.addInitScript(sd => { if (!localStorage.getItem('__s')) { localStorage.setItem('__s', '1'); localStorage.setItem('CapacitorStorage.comeback_onboarded', '1'); if (sd) localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(sd)); } }, seed || null);
  await ctx.addInitScript(() => {
    window.__themeEvents = 0; window.addEventListener('comeback-theme', () => { window.__themeEvents++; });
    document.addEventListener('DOMContentLoaded', () => { window.__earlyTheme = document.documentElement.getAttribute('data-theme'); });
  });
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await pg.waitForSelector('#sections .titem', { state: 'attached' });
  return { ctx, pg, errs };
}

console.log('Theme: tokens, choice, persistence');
{
  const { ctx, pg, errs } = await browserPage('light');
  ok(await attr(pg) === null, 'System is the default: no data-theme on <html>');
  ok(await tok(pg, '--bg') === LIGHT_BG, 'System + light phone: light tokens');
  await pg.emulateMedia({ colorScheme: 'dark' });
  ok(await tok(pg, '--bg') === DARK_BG, 'System + dark phone: dark tokens');
  ok(await pg.evaluate(() => isDark()) === true, 'isDark() is true when System follows a dark phone');
  await pg.emulateMedia({ colorScheme: 'light' });
  ok(await pg.evaluate(() => isDark()) === false, 'isDark() is false when System follows a light phone');
  const ev0 = await pg.evaluate(() => window.__themeEvents);
  await pg.emulateMedia({ colorScheme: 'dark' }); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => window.__themeEvents) > ev0, 'the phone changing its dark mode fires comeback-theme while the choice is System');
  await pg.emulateMedia({ colorScheme: 'light' });

  await gear(pg);
  const grp = '#themeRow .seg[role=radiogroup]';
  ok(await pg.isVisible('#themeRow') && (await pg.$$(grp + ' [role=radio]')).length === 3, 'Settings > Appearance has a Theme radiogroup with three radios');
  ok(await pg.$eval('#thSystem', e => e.getAttribute('aria-checked')) === 'true' && await pg.$eval('#thDark', e => e.getAttribute('aria-checked')) === 'false', 'System is selected by default (aria-checked)');
  ok((await pg.$$eval('#themeRow button', bs => bs.map(b => b.textContent.trim()))).join() === 'System,Light,Dark', 'the options read System, Light, Dark');
  ok(await pg.$eval('#themeRow .seg', e => e.getAttribute('aria-label')) === 'Theme', 'the group is labelled "Theme"');
  ok(await pg.$$eval('#themeRow button', bs => bs.every(b => b.getBoundingClientRect().height >= 44)), 'the options are at least 44px tall');

  await pg.click('#thDark');
  ok(await attr(pg) === 'dark' && await tok(pg, '--bg') === DARK_BG, 'choosing Dark on a light phone flips the tokens');
  ok(await pg.evaluate(() => getComputedStyle(document.documentElement).colorScheme) === 'dark', 'color-scheme is dark too (form controls, scrollbars)');
  ok(await pg.$eval('#thDark', e => e.getAttribute('aria-checked')) === 'true' && await pg.$eval('#thSystem', e => e.getAttribute('aria-checked')) === 'false', 'the radio updates (aria-checked)');
  ok(await pg.evaluate(() => document.activeElement && document.activeElement.id) === 'thDark', 'keyboard focus stays on the radio that was chosen');
  ok(await pg.evaluate(() => isDark()) === true, 'isDark() is true for a Dark choice on a light phone');
  ok(await pg.evaluate(() => localStorage.getItem('comeback_theme_cache')) === 'dark', 'the choice is cached in localStorage for the next start');
  ok(await pg.evaluate(() => localStorage.getItem('CapacitorStorage.comeback_theme')) === 'dark', 'the choice is stored with prefSet (device-side Preferences) under comeback_theme');

  await pg.click('#thLight');
  await pg.emulateMedia({ colorScheme: 'dark' });
  ok(await attr(pg) === 'light' && await tok(pg, '--bg') === LIGHT_BG && await pg.evaluate(() => isDark()) === false, 'Light stays light on a dark phone');
  ok(await pg.evaluate(() => getComputedStyle(document.documentElement).colorScheme) === 'light', 'color-scheme is light');
  // the same tokens whether dark comes from the phone or from the choice
  const names = ['--bg', '--card', '--label', '--label2', '--accent', '--green', '--orange', '--red', '--scrim', '--toast', '--bmi-over'];
  await pg.click('#thSystem'); const sysDark = await Promise.all(names.map(n => tok(pg, n)));
  await pg.click('#thDark'); const pickDark = await Promise.all(names.map(n => tok(pg, n)));
  ok(JSON.stringify(sysDark) === JSON.stringify(pickDark), 'Dark chosen and a dark phone give identical colours', { sysDark, pickDark });

  // persistence: reload keeps Dark, and it is on <html> before the page finished loading
  await pg.reload(); await pg.waitForSelector('#sections .titem', { state: 'attached' });
  ok(await pg.evaluate(() => window.__earlyTheme) === 'dark' && await attr(pg) === 'dark', 'after a reload Dark is applied before DOMContentLoaded (no flash)');
  // cache gone (storage cleared by the browser): Preferences still has it
  await pg.evaluate(() => localStorage.removeItem('comeback_theme_cache')); await pg.reload(); await pg.waitForSelector('#sections .titem', { state: 'attached' });
  await pg.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 3000 }).catch(() => {});
  ok(await attr(pg) === 'dark', 'with the cache gone the stored Preferences value still brings Dark back');
  ok(await pg.evaluate(() => localStorage.getItem('comeback_theme_cache')) === 'dark', 'and rewrites the cache');
  // junk values fall back to System
  await pg.evaluate(() => { localStorage.setItem('comeback_theme_cache', 'purple'); localStorage.setItem('CapacitorStorage.comeback_theme', 'purple'); });
  await pg.reload(); await pg.waitForSelector('#sections .titem', { state: 'attached' });
  ok(await attr(pg) === null, 'an unknown stored value means System');
  // storage that throws must not break the page
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  const errs2 = []; const pg2 = await ctx2.newPage(); pg2.on('pageerror', e => errs2.push(String(e)));
  await pg2.goto(base); await pg2.waitForTimeout(500);
  ok(await pg2.evaluate(() => typeof Theme === 'object' && typeof isDark === 'function'), 'theme.js loads even when localStorage throws');
  ok(!errs2.some(e => /theme/i.test(e)), 'no theme errors when storage is blocked', errs2);
  await ctx2.close();
  ok(errs.length === 0, 'no JS errors (theme)', errs);
  await ctx.close();
}

console.log('Theme: more contrast and less transparency still win over the dark tokens');
{
  const { ctx, pg } = await browserPage('light');
  await pg.evaluate(() => Theme.set('dark'));
  await pg.emulateMedia({ colorScheme: 'light', contrast: 'more' }).catch(() => {});
  const solid = await tok(pg, '--solid'), card = await tok(pg, '--card');
  ok(card === solid || card === 'var(--solid)', 'Dark + more contrast: cards are solid', { card, solid });
  await ctx.close();
}

console.log('Theme: charts redraw');
{
  const now = Date.now(); const days = {};
  for (let i = 0; i < 20; i++) { const k = ymd(new Date(now - i * 864e5)); days[k] = { vals: { pushups: 20 + i, water: 2 }, rules: {}, weight: 85 - i * .1, waist: null, note: '', date: k, updatedAt: now - i * 864e5 }; }
  const { ctx, pg, errs } = await browserPage('light', { version: 1, settings: { habits: [{ id: 'pushups', name: 'Pushups', unit: 'reps', target: 30 }, { id: 'water', name: 'Water', unit: 'litres', target: 2.5 }], rules: [] }, days });
  await pg.click('.tab[data-tab="progress"]'); await pg.waitForFunction(() => window.Chart && Chart.getChart(document.getElementById('chart')), null, { timeout: 5000 });
  const tick = () => pg.evaluate(() => Chart.getChart(document.getElementById('chart')).options.scales.x.ticks.color);
  const lightTick = await tick(); const lightL2 = await tok(pg, '--label2');
  ok(lightTick === lightL2, 'the chart uses the light secondary label colour', { lightTick, lightL2 });
  await pg.evaluate(() => Theme.set('dark')); await pg.waitForTimeout(150);
  const darkTick = await tick(); const darkL2 = await tok(pg, '--label2');
  ok(darkTick === darkL2 && darkTick !== lightTick, 'choosing Dark redraws the chart in the dark colours', { darkTick, darkL2 });
  await pg.evaluate(() => Theme.set('system')); await pg.waitForTimeout(150);
  ok(await tick() === lightTick, 'back to System on a light phone redraws it light');
  ok(errs.length === 0, 'no JS errors (charts)', errs);
  await ctx.close();
}

/* ---------- native app with the mocked bridge ---------- */
async function nativePage(scheme, mockInit) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, colorScheme: scheme || 'light' });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  if (mockInit) await ctx.addInitScript(init => { if (!localStorage.getItem('__mock')) localStorage.setItem('__mock', JSON.stringify(Object.assign({ prefs: { comeback_onboarded: '1' }, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0 }, init))); }, mockInit);
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await pg.waitForSelector('#sections .titem', { state: 'attached' });
  await pg.waitForTimeout(300);
  return { ctx, pg, errs };
}
const mock = pg => pg.evaluate(() => window.__mock.st());
const calls = async (pg, n) => (await mock(pg)).calls.filter(c => c.n === n);
const setLock = (pg, patch) => pg.evaluate(p => { const l = window.__mock.st().lock; window.__mock.set('lock', Object.assign(l, p)); }, patch);
const reload = async pg => { await pg.reload(); await pg.waitForSelector('#sections .titem', { state: 'attached' }); await pg.waitForTimeout(500); };
const lockUp = pg => pg.evaluate(() => { const e = document.getElementById('lockScreen'); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; });
const inertBehind = pg => pg.evaluate(() => ['#screens', '.tabbar', '.navbar'].map(s => document.querySelector(s).hasAttribute('inert')));
const stateEvt = (pg, isActive) => pg.evaluate(a => window.__mock.fire('appStateChange', { isActive: a }), isActive);
const waitLock = (pg, up, ms = 3000) => pg.waitForFunction(u => { const e = document.getElementById('lockScreen'); const shown = !!e && !e.hidden; return shown === u; }, up, { timeout: ms }).then(() => true).catch(() => false);

console.log('Theme: status bar follows isDark()');
{
  const { ctx, pg, errs } = await nativePage('light');
  const lastStyle = async () => { const c = (await mock(pg)).calls.filter(x => x.n === 'statusStyle'); return c.length ? c[c.length - 1].a.style : null; };
  const lastBg = async () => { const c = (await mock(pg)).calls.filter(x => x.n === 'statusBg'); return c.length ? c[c.length - 1].a.color : null; };
  ok(await lastStyle() === 'LIGHT' && await lastBg() === LIGHT_BG, 'System + light phone: status bar LIGHT with the light background');
  await gear(pg);
  await pg.click('#thDark'); await pg.waitForTimeout(150);
  ok(await lastStyle() === 'DARK' && await lastBg() === DARK_BG, 'choosing Dark on a light phone: status bar DARK with the dark background');
  await pg.emulateMedia({ colorScheme: 'dark' }); await pg.click('#thLight'); await pg.waitForTimeout(150);
  ok(await lastStyle() === 'LIGHT' && await lastBg() === LIGHT_BG, 'choosing Light on a dark phone: status bar LIGHT');
  await pg.click('#thSystem'); await pg.waitForTimeout(150);
  ok(await lastStyle() === 'DARK', 'System on a dark phone: DARK');
  await pg.emulateMedia({ colorScheme: 'light' }); await pg.waitForTimeout(200);
  ok(await lastStyle() === 'LIGHT' && await lastBg() === LIGHT_BG, 'System follows the phone back to light: status bar LIGHT');
  ok((await mock(pg)).prefs.comeback_theme === 'system', 'the choice is in Preferences (comeback_theme)');
  await pg.click('#thDark'); await reload(pg);
  ok(await attr(pg) === 'dark' && (await mock(pg)).prefs.comeback_theme === 'dark', 'native: Dark survives a restart');
  ok(errs.length === 0, 'no JS errors (status bar)', errs);
  await ctx.close();
}

console.log('Lock: the pure delay rule');
{
  const { ctx, pg } = await nativePage('light');
  const MIN = 60000, t0 = 1800000000000;
  // the same table as LockPolicyTest.kt
  const rows = [
    [false, null, t0, 0, false], [false, t0 - 10 * MIN, t0, MIN, false],
    [true, t0, t0, 0, true], [true, t0 - 1, t0, 0, true],
    [true, t0 - 59999, t0, MIN, false], [true, t0 - 60000, t0, MIN, true], [true, t0 - 61000, t0, MIN, true],
    [true, t0 - 4 * MIN, t0, 5 * MIN, false], [true, t0 - 5 * MIN, t0, 5 * MIN, true],
    [true, null, t0, 5 * MIN, true], [true, 0, t0, 5 * MIN, true], [true, t0 + 1, t0, 5 * MIN, true]
  ];
  const got = await pg.evaluate(rs => rs.map(r => Lock.shouldLock(r[0], r[1], r[2], r[3])), rows);
  ok(got.every((g, i) => g === rows[i][4]), 'Lock.shouldLock matches the shared table', got.map((g, i) => g === rows[i][4] ? '' : i).filter(String));
  const dm = await pg.evaluate(() => [null, '', 'abc', '7', '-5', '0', ' 0 ', '1', '5'].map(v => Lock.delayMinutes(v)));
  ok(dm.join() === '1,1,1,1,1,0,0,1,5', 'unknown delays fall back to 1 minute', dm);
  ok(await pg.evaluate(() => Lock.delayMs('5')) === 5 * MIN, 'delayMs(5) is five minutes');
  await ctx.close();
}

console.log('Lock: a plain browser has no Security group');
{
  const { ctx, pg, errs } = await browserPage('light');
  await gear(pg);
  ok(!(await pg.isVisible('#secGroup')) && !(await pg.isVisible('#secHead')), 'the Security group is hidden in a browser');
  ok(!(await pg.$('#lockScreen')), 'no lock screen exists in a browser');
  ok(errs.length === 0, 'no JS errors (browser lock)', errs);
  await ctx.close();
}

console.log('Lock: turning it on');
{
  const { ctx, pg, errs } = await nativePage('light');
  await gear(pg);
  ok(await pg.isVisible('#secHead') && await pg.isVisible('#lockRow'), 'native: the Security group shows "Lock Comeback"');
  const heads = await pg.$$eval('.group-head [role=heading]', es => es.map(e => e.textContent.trim()));
  ok(heads.indexOf('Security') === heads.indexOf('Appearance') + 1, 'Security comes right after Appearance', heads);
  ok(await pg.$eval('#lockOn', e => e.getAttribute('role') === 'switch' && !e.checked && e.getAttribute('aria-label') === 'Lock Comeback'), 'the switch is off by default and labelled');
  ok(!(await pg.$('#lockDelayRow')), '"Lock after" only shows once the lock is on');
  ok((await mock(pg)).prefs.comeback_lock == null, 'nothing is stored while it is off');

  // the phone has no screen lock
  await setLock(pg, { available: false, reason: 'none_enrolled' });
  await pg.click('#lockRow');
  await pg.waitForFunction(() => /screen lock/i.test(document.getElementById('secMsg').textContent), null, { timeout: 3000 }).catch(() => {});
  ok(!(await pg.isChecked('#lockOn')) && /screen lock/i.test(await pg.textContent('#secMsg')), 'refused with a clear message when the phone has no screen lock');
  ok((await mock(pg)).prefs.comeback_lock == null && (await calls(pg, 'lockAuth')).length === 0, 'nothing stored, and the person was not even asked to authenticate');
  // sensor busy
  await setLock(pg, { available: false, reason: 'hw_unavailable' });
  await pg.click('#lockRow'); await pg.waitForTimeout(300);
  ok(!(await pg.isChecked('#lockOn')) && /busy|moment/i.test(await pg.textContent('#secMsg')), 'a busy sensor gets its own gentle message');
  // available, but the person backs out of the confirmation
  await setLock(pg, { available: true, reason: 'ok', result: 'canceled' });
  await pg.click('#lockRow'); await pg.waitForTimeout(300);
  ok(!(await pg.isChecked('#lockOn')) && (await mock(pg)).prefs.comeback_lock == null, 'backing out of the confirmation leaves the lock off');
  // success
  await setLock(pg, { result: 'ok' });
  await pg.click('#lockRow'); await pg.waitForSelector('#lockDelayRow');
  const m = await mock(pg);
  ok(await pg.isChecked('#lockOn'), 'the switch turns on after the person passes the check once');
  ok(m.prefs.comeback_lock === '1' && m.prefs.comeback_lock_delay === '1' && /^\d+$/.test(m.prefs.comeback_last_active), 'device-local keys written: comeback_lock, comeback_lock_delay (1), comeback_last_active');
  ok(m.lock.secure === true && (await calls(pg, 'lockSecure')).some(c => c.a.enabled === true), 'FLAG_SECURE is requested (setSecure enabled)');
  ok(await pg.evaluate(() => localStorage.getItem('comeback_lock_cache')) === '1', 'the start-up cache is set');
  ok(await pg.$$eval('#lockDelayRow button', bs => bs.map(b => b.textContent.trim()).join()) === 'Immediately,1 minute,5 minutes', '"Lock after" offers Immediately, 1 minute, 5 minutes');
  ok(await pg.$eval('#lk1', e => e.getAttribute('aria-checked')) === 'true', '1 minute is the default');
  await pg.click('#lk5'); await pg.waitForTimeout(150);
  ok((await mock(pg)).prefs.comeback_lock_delay === '5' && await pg.$eval('#lk5', e => e.getAttribute('aria-checked')) === 'true', 'choosing 5 minutes is stored');
  // never synced or backed up
  const exported = await pg.evaluate(() => JSON.stringify(buildData()) + JSON.stringify(meta));
  ok(!/comeback_lock|last_active|"lock/i.test(exported), 'the lock is not in the synced data, the backup or the phone meta');
  ok(!(await pg.evaluate(() => /lock/i.test(JSON.stringify(settings)))), 'nor in the synced settings object');
  // turning off asks again; backing out keeps it on
  await setLock(pg, { result: 'canceled' });
  await pg.click('#lockRow'); await pg.waitForTimeout(300);
  ok(await pg.isChecked('#lockOn') && (await mock(pg)).prefs.comeback_lock === '1', 'turning it off needs the check; backing out leaves it on');
  await setLock(pg, { result: 'ok' });
  await pg.click('#lockRow'); await pg.waitForFunction(() => !document.getElementById('lockDelayRow'));
  const m2 = await mock(pg);
  ok(m2.prefs.comeback_lock === '0' && m2.lock.secure === false && !(await pg.isChecked('#lockOn')), 'off again: stored 0, FLAG_SECURE cleared');
  ok(errs.length === 0, 'no JS errors (turning on)', errs);
  await ctx.close();
}

console.log('Lock: at start');
{
  const { ctx, pg, errs } = await nativePage('light', { prefs: { comeback_onboarded: '1', comeback_lock: '1', comeback_lock_delay: '1' } });
  // the page unlocked itself because the mock says OK straight away; check the call and the state
  ok((await calls(pg, 'lockAuth')).length >= 1, 'the app asks for authentication when it starts');
  ok((await calls(pg, 'lockAuth'))[0].a.title === 'Unlock Comeback', 'with a plain title');
  ok(!(await lockUp(pg)) && (await inertBehind(pg)).every(v => !v), 'after a successful check the lock screen goes and the app is usable');
  ok((await mock(pg)).lock.secure === true, 'FLAG_SECURE is set at start while the lock is on');

  // cancelled: lock screen stays
  await setLock(pg, { queue: ['canceled'], authDelay: 0 });
  await reload(pg);
  ok(await lockUp(pg), 'cancelling the prompt leaves the lock screen up');
  ok(await pg.$eval('#lockScreen', e => e.getAttribute('role') === 'dialog' && e.getAttribute('aria-modal') === 'true' && !!e.getAttribute('aria-labelledby')), 'it is a modal dialog with a label');
  ok((await inertBehind(pg)).every(v => v), 'the screens, tab bar and top bar are inert behind it');
  ok(/Comeback is locked/.test(await pg.textContent('#lockTitle')) && /Tap Unlock/.test(await pg.textContent('#lockMsg')), 'gentle wording: "Comeback is locked", "Tap Unlock when you are ready"');
  ok(await pg.$eval('#lockUnlock', e => e.getBoundingClientRect().height >= 44), 'the Unlock button is at least 44px tall');
  ok(await pg.evaluate(() => document.activeElement.id) === 'lockUnlock', 'focus is on the Unlock button');
  // focus trap
  const trapped = [];
  for (let i = 0; i < 6; i++) { await pg.keyboard.press('Tab'); trapped.push(await pg.evaluate(() => !!document.activeElement.closest('#lockScreen'))); }
  for (let i = 0; i < 3; i++) { await pg.keyboard.press('Shift+Tab'); trapped.push(await pg.evaluate(() => !!document.activeElement.closest('#lockScreen'))); }
  ok(trapped.every(Boolean), 'Tab and Shift+Tab never leave the lock screen', trapped);
  // taps behind do nothing
  const covered = await pg.evaluate(() => { const g = document.getElementById('gearBtn').getBoundingClientRect(); const e = document.elementFromPoint(g.x + g.width / 2, g.y + g.height / 2); return !!e.closest('#lockScreen'); });
  ok(covered, 'the lock screen covers the whole page (a tap on the gear lands on it)');
  // back button on the lock screen leaves the app
  const ex0 = (await mock(pg)).exit;
  await pg.evaluate(() => window.__mock.fire('backButton', {}));
  await pg.waitForTimeout(150);
  ok((await mock(pg)).exit === ex0 + 1, 'Back on the lock screen leaves the app instead of moving around behind it');
  // Unlock re-prompts
  const a0 = (await calls(pg, 'lockAuth')).length;
  await setLock(pg, { queue: [], result: 'ok' });
  await pg.click('#lockUnlock'); ok(await waitLock(pg, false), 'Unlock asks again and, on success, opens the app');
  ok((await calls(pg, 'lockAuth')).length === a0 + 1 && (await inertBehind(pg)).every(v => !v), 'one new prompt; nothing is inert any more');
  ok(await pg.evaluate(() => !document.getElementById('lockScreen').contains(document.activeElement)), 'focus left the hidden lock screen');
  ok(errs.length === 0, 'no JS errors (start)', errs);
  await ctx.close();
}

console.log('Lock: lockout and failure wording');
{
  const { ctx, pg } = await nativePage('light', { prefs: { comeback_onboarded: '1', comeback_lock: '1', comeback_lock_delay: '1' }, lock: { available: true, reason: 'ok', result: 'lockout', queue: [], authDelay: 0, secure: false } });
  ok(await lockUp(pg) && /Too many tries/.test(await pg.textContent('#lockMsg')), 'too many tries: a calm message to wait');
  ok(await pg.$eval('#lockOff', e => e.hidden), 'but no way to switch the lock off from there (the phone can still check)');
  await setLock(pg, { result: 'failed' });
  await pg.click('#lockUnlock'); await pg.waitForTimeout(300);
  ok(await lockUp(pg) && /did not work/.test(await pg.textContent('#lockMsg')), 'a failure says "That did not work" and keeps the lock');
  await ctx.close();
}

console.log('Lock: coming back after the chosen time');
{
  // controllable clock
  const clockInit = () => { const real = Date.now.bind(Date); window.__off = 0; Date.now = () => real() + window.__off; };
  for (const [delay, label] of [['1', '1 minute'], ['5', '5 minutes'], ['0', 'Immediately']]) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
    await ctx.addInitScript(clockInit);
    await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
    await ctx.addInitScript(d => { if (!localStorage.getItem('__mock')) localStorage.setItem('__mock', JSON.stringify({ prefs: { comeback_onboarded: '1', comeback_lock: '1', comeback_lock_delay: d }, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0 })); }, delay);
    const pg = await newPage(ctx, errs);
    await pg.goto(base); await pg.waitForSelector('#sections .titem', { state: 'attached' }); await pg.waitForTimeout(600);
    await pg.waitForTimeout(1700);   // app-state changes in the 1.5 s after a prompt are the prompt's own (Android 9 and 10 pause the app for the credential page)
    ok(!(await lockUp(pg)), `[${label}] unlocked after the start check`);
    const a0 = (await calls(pg, 'lockAuth')).length;
    if (delay === '0') {
      await stateEvt(pg, false); await pg.waitForTimeout(100);
      ok(await lockUp(pg), `[${label}] the lock screen is already up when the app goes to the background`);
      await stateEvt(pg, true); ok(await waitLock(pg, false), `[${label}] and the prompt opens it again when the app returns`);
      ok((await calls(pg, 'lockAuth')).length === a0 + 1, `[${label}] with one prompt`);
    } else {
      const ms = Number(delay) * 60000;
      await stateEvt(pg, false); await pg.evaluate(v => { window.__off += v; }, ms - 5000); await stateEvt(pg, true); await pg.waitForTimeout(500);
      ok(!(await lockUp(pg)) && (await calls(pg, 'lockAuth')).length === a0, `[${label}] away for just under the time: no lock`);
      await stateEvt(pg, false); await pg.evaluate(v => { window.__off += v; }, ms + 1000); await stateEvt(pg, true);
      ok(await waitLock(pg, false) && (await calls(pg, 'lockAuth')).length === a0 + 1, `[${label}] away for longer than the time: locks and prompts (then unlocks with the mock)`);
      await pg.waitForTimeout(1700);
      await setLock(pg, { result: 'canceled' });
      await stateEvt(pg, false); await pg.evaluate(v => { window.__off += v; }, ms + 1000); await stateEvt(pg, true); await pg.waitForTimeout(500);
      ok(await lockUp(pg), `[${label}] the lock stays when the person cancels`);
      // leaving and coming back while still locked asks again
      await setLock(pg, { result: 'ok' }); await pg.waitForTimeout(1700);
      await stateEvt(pg, false); await stateEvt(pg, true);
      ok(await waitLock(pg, false), `[${label}] coming back while locked asks again`);
      await pg.waitForTimeout(1700);
    }
    // a share sheet / permission dialog is not "leaving"
    const a1 = (await calls(pg, 'lockAuth')).length;
    await pg.evaluate(() => { Native.Share.share({ title: 'x' }); });   // the share sheet: the app goes away and comes back
    await stateEvt(pg, false); await pg.evaluate(() => { window.__off += 3600000; }); await stateEvt(pg, true); await pg.waitForTimeout(400);
    ok(!(await lockUp(pg)) && (await calls(pg, 'lockAuth')).length === a1, `[${label}] returning from the share sheet does not lock`, { up: await lockUp(pg) });
    ok(errs.length === 0, `[${label}] no JS errors`, errs);
    await ctx.close();
  }
}

console.log('Lock: never traps anyone');
{
  // the phone lost its screen lock while the lock was on
  const { ctx, pg, errs } = await nativePage('light', { prefs: { comeback_onboarded: '1', comeback_lock: '1', comeback_lock_delay: '1' }, lock: { available: false, reason: 'none_enrolled', result: 'unavailable', queue: [], authDelay: 0, secure: false } });
  ok(await lockUp(pg), 'the lock screen is up');
  ok(!(await pg.$eval('#lockOff', e => e.hidden)) && /no longer has a screen lock/.test(await pg.textContent('#lockMsg')), 'it explains that the phone has no screen lock any more and offers to turn the lock off');
  ok(await pg.$eval('#lockOff', e => e.getBoundingClientRect().height >= 44), 'the button is at least 44px tall');
  await pg.click('#lockOff');
  ok(await waitLock(pg, false), 'turning it off opens the app');
  const m = await mock(pg);
  ok(m.prefs.comeback_lock === '0' && m.lock.secure === false, 'and the lock is off for good (stored 0, FLAG_SECURE cleared)');
  await reload(pg);
  ok(!(await lockUp(pg)), 'a restart no longer locks');
  await gear(pg);
  ok(!(await pg.isChecked('#lockOn')), 'the switch shows off');
  ok(errs.length === 0, 'no JS errors (unavailable)', errs);
  await ctx.close();
}
{
  // sensor busy: temporary, so no way out is offered, only "try again"
  const { ctx, pg } = await nativePage('light', { prefs: { comeback_onboarded: '1', comeback_lock: '1' }, lock: { available: false, reason: 'hw_unavailable', result: 'unavailable', queue: [], authDelay: 0, secure: false } });
  ok(await lockUp(pg) && await pg.$eval('#lockOff', e => e.hidden) && /not ready/.test(await pg.textContent('#lockMsg')), 'a busy sensor only asks for a moment; the lock cannot be dropped that way');
  await ctx.close();
}

console.log('Lock: first paint and small screens');
{
  const { ctx, pg } = await nativePage('dark', { prefs: { comeback_onboarded: '1', comeback_lock: '1', comeback_lock_delay: '1' }, lock: { available: true, reason: 'ok', result: 'canceled', queue: [], authDelay: 0, secure: false } });
  await pg.setViewportSize({ width: 280, height: 560 });
  ok(await lockUp(pg), 'dark: the lock screen is up');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.getElementById('lockScreen').scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 280px');
  await pg.evaluate(() => { document.documentElement.style.fontSize = '160%'; });
  ok(await pg.evaluate(() => { const c = document.querySelector('.lock-card').getBoundingClientRect(); return c.left >= 0 && c.right <= window.innerWidth; }), 'the card fits at 160% text');
  const bg = await pg.evaluate(() => getComputedStyle(document.getElementById('lockScreen')).backgroundColor);
  ok(bg !== 'rgba(0, 0, 0, 0)', 'the lock screen is opaque (nothing shows through)', bg);
  // the cache lets the overlay go up before Preferences is read
  ok(await pg.evaluate(() => localStorage.getItem('comeback_lock_cache')) === '1', 'the start-up cache is on, so nothing flashes before Preferences is read');
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
