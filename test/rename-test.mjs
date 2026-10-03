// Checks for the rename from "Reset Log" to "Comeback": old saved data moves to the new keys, old backup files still restore,
// the new copy is in place, and no leftover old name or medical wording shows on any screen.
// Run: npm run test:rename
import { serve, launch, counter, newPage, tab, gear, getTime, openBody, ready, sheetGone, settle, actionChoose, MOCK, todayKey, daysAgo, same } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const tk = todayKey();

const SETTINGS = { habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }, { id: 'water', name: 'Water', unit: 'glasses', target: 8 }], rules: [{ id: 'nofried', name: 'No fried food' }] };
const day = (k, steps, weight, note = '') => ({ vals: { steps }, rules: { nofried: true }, weight, waist: null, note, date: k, updatedAt: 1700000000000 });
const OLD_DATA = { version: 1, settings: SETTINGS, days: { [daysAgo(2)]: day(daysAgo(2), 9000, 88.5, 'old phone day'), [daysAgo(1)]: day(daysAgo(1), 6000, 88.1) } };
const OLD_META = { lastBackup: 1700000000000, reminder: { enabled: true, time: '20:30' }, steps: { source: 'manual', heightCm: 175, strictness: 'balanced', sensitivity: 'normal', useLocation: false, enabledAt: null, setupFailed: false } };
const OLD_SYNC = { signedIn: false, userId: null, email: '', lastSyncAt: null, settingsUpdatedAt: 0, pendingDays: [], pendingSettings: false };

async function open({ native, prefs, plain, init } = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, acceptDownloads: true });
  if (native) await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const seed = { native: !!native, prefs: prefs || null, plain: plain || null };
  await ctx.addInitScript(s => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    if (s.native && s.prefs) localStorage.setItem('__mock', JSON.stringify({ prefs: s.prefs, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0 }));
    if (s.plain) for (const k of Object.keys(s.plain)) localStorage.setItem('CapacitorStorage.' + k, s.plain[k]);
  }, seed);
  const pg = await newPage(ctx, errs);
  if (init) await pg.addInitScript(init);
  await pg.goto(base);
  return { ctx, pg, errs };
}
const mock = pg => pg.evaluate(() => window.__mock.st());
const webKeys = pg => pg.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('CapacitorStorage.')).map(k => [k.slice(17), localStorage.getItem(k)])));

// ---------- 1. old Preferences keys move to the new keys (native bridge) ----------
{
  const prefs = { resetlog: JSON.stringify(OLD_DATA), resetlog_meta: JSON.stringify(OLD_META), resetlog_migrated: '1', resetlog_sync: JSON.stringify(OLD_SYNC), resetlog_onboarded: '1', resetlog_unreadable_1700: '{"broken' };
  const { ctx, pg, errs } = await open({ native: true, prefs });
  await ready(pg); await settle(pg);
  let p = (await mock(pg)).prefs;
  { const mig = JSON.parse(p.comeback);
    ok(same(mig.days, OLD_DATA.days) && mig.version === 2 && mig.settings.v === 2, 'native: old "resetlog" data now lives under "comeback" (days unchanged, settings moved to the new structure)');
    ok(['steps', 'water', 'nofried'].every(id => mig.settings.habits.some(h => h.id === id)) && mig.settings.habits.find(h => h.id === 'nofried').type === 'yesno' && mig.settings.habits.find(h => h.id === 'steps').type === 'steps', 'native: the old targets and the old rule became habits (steps, water, and the rule as Yes/No)'); }
  // the reminder settings gained "only if something is left" and the morning cue; the old switch and time carry over unchanged
  ok(JSON.parse(p.comeback_meta).reminder.enabled === OLD_META.reminder.enabled && JSON.parse(p.comeback_meta).reminder.time === OLD_META.reminder.time && JSON.parse(p.comeback_meta).lastBackup === OLD_META.lastBackup, 'native: settings and reminder moved to comeback_meta');
  ok(p.comeback_migrated === '1' && p.comeback_onboarded === '1' && same(JSON.parse(p.comeback_sync), OLD_SYNC), 'native: migrated flag, onboarding flag and sync state moved');
  ok(p.comeback_unreadable_1700 === '{"broken', 'native: a kept unreadable copy moved too');
  ok(!Object.keys(p).some(k => k.startsWith('resetlog')), 'native: every old "resetlog" key was removed', Object.keys(p));
  ok(!(await pg.$('.onb')), 'the intro does not show again after the move');
  await tab(pg, 'progress');
  ok((await pg.textContent('#sDays')).trim() === '2', 'both old days show in Progress');
  await gear(pg);
  ok((await getTime(pg, '#remTime')) === '20:30' && await pg.$eval('#remOn', e => e.checked), 'the old reminder time and switch carried over');
  const before = JSON.stringify((await mock(pg)).prefs);
  await pg.reload(); await ready(pg); await settle(pg);
  const after = JSON.stringify((await mock(pg)).prefs);
  ok(before === after, 'running the move again changes nothing (safe to repeat)', (() => { const a = JSON.parse(before), b = JSON.parse(after); return Object.keys(a).filter(k => a[k] !== b[k]).map(k => [k, String(a[k]).slice(0, 200), String(b[k]).slice(0, 200)]); })());
  ok(errs.length === 0, 'no page errors during the move', errs);
  await ctx.close();
}

// ---------- 2. both old and new exist and differ: nothing is lost ----------
{
  const NEW_DATA = { version: 1, settings: SETTINGS, days: { [tk]: day(tk, 100, null) } };
  const prefs = { resetlog: JSON.stringify(OLD_DATA), comeback: JSON.stringify(NEW_DATA), comeback_onboarded: '1' };
  const { ctx, pg } = await open({ native: true, prefs });
  await ready(pg); await settle(pg);
  const p = (await mock(pg)).prefs;
  ok(p.resetlog && same(JSON.parse(p.resetlog), OLD_DATA), 'conflict: the old copy is kept, not deleted');
  ok(Object.keys(JSON.parse(p.comeback).days).includes(tk), 'conflict: the new copy stays in use');
  await ctx.close();
}

// ---------- 3. browser-only mode (no native bridge) ----------
{
  const plain = { resetlog: JSON.stringify(OLD_DATA), resetlog_onboarded: '1', resetlog_migrated: '1' };
  const { ctx, pg } = await open({ plain });
  await ready(pg); await settle(pg);
  const k = await webKeys(pg);
  ok(same(JSON.parse(k.comeback).days, OLD_DATA.days) && !Object.keys(k).some(x => x.startsWith('resetlog')), 'browser: old keys moved to comeback and removed');
  await ctx.close();
}

// ---------- 4. restore still accepts old resetlog-backup files ----------
{
  const { ctx, pg, errs } = await open({ native: true, prefs: { comeback_onboarded: '1' } });
  await ready(pg); await gear(pg);
  const OLD_BACKUP = { version: 1, settings: SETTINGS, days: { '2026-02-03': day('2026-02-03', 7777, 90.2, 'from the old app') } };
  await pg.setInputFiles('#restoreFile', { name: 'resetlog-backup-2026-02-04.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(OLD_BACKUP)) });
  await actionChoose(pg, 'Continue'); await actionChoose(pg, 'Replace everything');
  await pg.waitForFunction(() => /Replaced everything/.test(document.getElementById('bkMsg').textContent));
  const d = JSON.parse((await mock(pg)).prefs.comeback);
  ok(d.days['2026-02-03'] && d.days['2026-02-03'].vals.steps === 7777 && d.days['2026-02-03'].note === 'from the old app', 'an old resetlog-backup file restores with all its data');
  // an even older backup without a version number
  const NOVER = { settings: SETTINGS, days: { '2026-02-05': day('2026-02-05', 5000, null) } };
  await pg.setInputFiles('#restoreFile', { name: 'resetlog-backup-2026-02-06.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(NOVER)) });
  await actionChoose(pg, 'Continue'); await actionChoose(pg, 'Merge');
  await pg.waitForFunction(() => /Merged/.test(document.getElementById('bkMsg').textContent));
  const d2 = JSON.parse((await mock(pg)).prefs.comeback);
  ok(d2.days['2026-02-03'] && d2.days['2026-02-05'], 'an old backup without a version number merges too');
  ok(errs.length === 0, 'no page errors while restoring', errs);
  await ctx.close();
}

// ---------- 5. new copy ----------
{
  const FIRST = daysAgo(4);
  const data = { version: 1, settings: SETTINGS, days: { [FIRST]: day(FIRST, 9000, null) } };
  const { ctx, pg } = await open({ native: true, prefs: { comeback: JSON.stringify(data), comeback_onboarded: '1' } });
  await ready(pg); await settle(pg);
  ok((await pg.textContent('#todaySub')).trim() === 'Day 5 of your comeback', 'Today subtitle counts days since the first log', await pg.textContent('#todaySub'));
  ok(/Every comeback has restarts\. Start again today\./.test(await pg.textContent('#todayHint')), 'a broken streak gets the gentle restart message');
  await tab(pg, 'progress');
  ok(/Every comeback has restarts\. Start again today\./.test(await pg.textContent('#streakNote')), 'Progress shows the gentle restart note');
  await ctx.close();
}
{
  const { ctx, pg } = await open({ native: true, prefs: { comeback_onboarded: '1' } });
  await ready(pg); await settle(pg);
  ok((await pg.textContent('#todaySub')).trim() === 'Day 1 of your comeback', 'a new install starts at Day 1');
  await tab(pg, 'progress');
  ok(/Log your first day to start your comeback\./.test(await pg.textContent('#progEmpty')), 'empty Progress screen copy');
  await ctx.close();
}

// ---------- 6. no old name or medical wording on any screen ----------
{
  const { ctx, pg } = await open({ native: true, prefs: {} });   // fresh install, so the intro shows
  await ready(pg);
  const texts = [];
  const grab = async () => texts.push(await pg.evaluate(() => document.documentElement.innerText + ' ' + [...document.querySelectorAll('[aria-label],[title],[placeholder]')].map(e => e.getAttribute('aria-label') + ' ' + e.title + ' ' + (e.placeholder || '')).join(' ')));
  await pg.waitForSelector('.onb'); await grab();
  // walk every onboarding page: welcome, plan, reminder, permissions, brand help, height
  await pg.click('#onbNext'); await grab(); await pg.click('#plan-beginner'); await pg.click('#onbNext'); await grab(); await pg.click('#onbNext'); await grab();
  await pg.click('#onbAllow'); await pg.waitForSelector('#onbBrandNext, #onbStart'); await grab();
  if (await pg.$('#onbBrandNext')) { await pg.click('#onbBrandNext'); await pg.waitForSelector('#onbStart'); await grab(); }
  await pg.waitForSelector('#onbStart'); await grab();
  await pg.click('#onbStart'); await pg.waitForFunction(() => !document.querySelector('.onb'));
  await pg.waitForTimeout(400);
  for (const t of ['today', 'progress', 'setup']) { await tab(pg, t); await grab(); }
  await gear(pg); await grab();
  // the Steps sheet, the habit library and the BMI sheet
  await tab(pg, 'today'); await pg.click('#sections .hcard[data-id="steps"] .hc-main'); await pg.waitForSelector('.sheet'); await pg.waitForTimeout(500); await grab();
  await pg.click('.sheet .txtbtn.strong'); await pg.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  await tab(pg, 'setup'); await pg.click('#addHabitRow'); await pg.waitForSelector('.library'); await pg.waitForTimeout(400); await grab();
  await pg.click('.sheet .txtbtn.strong'); await pg.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  await tab(pg, 'today'); await openBody(pg); await pg.click('#rowBmi'); await pg.waitForSelector('.sheet'); await pg.waitForTimeout(400); await grab();
  await pg.click('.sheet .txtbtn.strong'); await pg.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  const html = await pg.content();
  const all = texts.join('\n') + html;
  ok(!/reset\s*-?\s*log/i.test(all), 'no "Reset Log" text on any screen or in the page', (all.match(/.{20}reset\s*-?\s*log.{20}/i) || [])[0]);
  ok(!/liver|cholesterol|triglycerid|\bALT\b|\bHDL\b|\bLFTs?\b|lipid|fatty/i.test(all), 'no medical wording anywhere in the app');
  ok(/Welcome to Comeback/.test(texts[0]) && texts.some(t => /About Comeback/.test(t)), 'the app name shows as Comeback (intro and Settings)');
  const title = await pg.title();
  ok(title === 'Comeback', 'page title is Comeback', title);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
