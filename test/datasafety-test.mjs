// Data-safety tests: what happens when the phone's saved copy is damaged.
//  A. one bad day among good ones: the bad day is set aside (and kept), everything else loads, a message says so
//  B. the whole copy is unreadable: nothing is written over it, the automatic backup files are left alone, new work is kept
//     apart and survives a restart, and Settings > Backup offers to recover what was kept
//  C. kept copies are capped, and restarting does not pile up more of them
// Run: npm run test:datasafety
import { createRequire } from 'module';
import { serve, launch, counter, newPage, skipOnboarding, tab, gear, ready, stored, settle, setHabit, actionChoose, MOCK } from './helpers.mjs';

const Core = createRequire(import.meta.url)('../www/js/core.js');
const { srv, base } = serve();
const T = counter();
const ok = T.ok;
const browser = await launch();
const errs = [];

const good = (k, over) => ({ vals: { pushups: 20 }, rules: {}, weight: null, waist: null, note: 'note ' + k, date: k, updatedAt: 1000, ...over });
const settings = Core.defaultSettings();
const lsKeys = pg => pg.evaluate(() => Object.keys(localStorage));
const lsGet = (pg, k) => pg.evaluate(k => localStorage.getItem(k), k);

/* ---------- A. one bad day ---------- */
console.log('One bad day among good ones');
{
  const data = { version: 2, settings, days: {
    '2026-09-01': good('2026-09-01'),
    '2026-09-02': good('2026-09-02', { vals: { pushups: 'lots' } }),   // a value that is not a number
    '2026-09-03': good('2026-09-03'),
    '2026-09-04': good('2026-09-04', { weight: 'heavy' }),
    'not-a-date': good('2026-09-05') } };
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
  await skipOnboarding(ctx);
  await ctx.addInitScript(d => { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem('CapacitorStorage.comeback', d); } }, JSON.stringify(data));
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await ready(pg); await settle(pg);
  const loaded = await pg.evaluate(() => Object.keys(days).sort());
  ok(loaded.join() === '2026-09-01,2026-09-03', 'the good days load and the bad ones are skipped', loaded);
  const msg = await pg.$eval('#bkMsg', e => ({ t: e.textContent, bad: e.classList.contains('bad') }));
  ok(msg.bad && /3 days couldn't be read/.test(msg.t) && /2026-09-02/.test(msg.t) && /Everything else loaded/.test(msg.t), 'Settings > Backup says which days were set aside', msg.t);
  const qk = (await lsKeys(pg)).filter(k => k.startsWith('CapacitorStorage.comeback_quarantine_'));
  ok(qk.length === 1, 'the skipped days were kept under a separate key', qk);
  const q = JSON.parse(await lsGet(pg, qk[0]));
  ok(q.quarantinedDays['2026-09-02'].vals.pushups === 'lots' && q.quarantinedDays['2026-09-04'].weight === 'heavy' && 'not-a-date' in q.quarantinedDays, 'the kept copy holds the raw records', Object.keys(q.quarantinedDays));
  const main = await stored(pg);
  ok(Object.keys(main.days).sort().join() === '2026-09-01,2026-09-03', 'the saved copy keeps the good days (nothing was lost, nothing blocked)');
  ok(await pg.evaluate(() => dataLocked) === false, 'saving is not blocked');
  await tab(pg, 'today'); await setHabit(pg, 3, 7); await settle(pg);
  ok(Object.keys((await stored(pg)).days).length === 3, 'new entries save normally afterwards');
  await pg.reload(); await ready(pg); await settle(pg);
  ok((await lsKeys(pg)).filter(k => k.startsWith('CapacitorStorage.comeback_quarantine_')).length === 1, 'restarting does not pile up more kept copies');
  ok((await pg.textContent('#bkMsg')) === '', 'and the notice is gone once the bad days are out of the saved copy');
  // strict validation is still used for backup files
  const strict = await pg.evaluate(d => { try { normalizeData(JSON.parse(d)); return 'accepted'; } catch (e) { return e.message; } }, JSON.stringify(data));
  ok(/Day 2026-09-02|not a valid date/.test(strict), 'restoring a backup FILE with a bad day is still refused as a whole', strict);
  await ctx.close();
}

/* ---------- C. kept copies are capped ---------- */
console.log('Kept copies are capped');
{
  const data = { version: 2, settings, days: { '2026-09-01': good('2026-09-01') } };
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
  await skipOnboarding(ctx);
  await ctx.addInitScript(d => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1'); localStorage.setItem('CapacitorStorage.comeback', d);
    for (let i = 1; i <= 6; i++) { localStorage.setItem('CapacitorStorage.comeback_unreadable_17000000000' + i + '0', 'old copy ' + i); localStorage.setItem('CapacitorStorage.comeback_quarantine_17000000000' + i + '0', '{"quarantinedDays":{"x":' + i + '}}'); }
  }, JSON.stringify(data));
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await ready(pg); await settle(pg);
  const keys = await lsKeys(pg);
  const un = keys.filter(k => k.includes('comeback_unreadable_')).sort(), qu = keys.filter(k => k.includes('comeback_quarantine_')).sort();
  ok(un.length === 3 && un.every(k => /17000000000[456]0$/.test(k)), 'only the newest 3 unreadable copies are kept', un);
  ok(qu.length === 3 && qu.every(k => /17000000000[456]0$/.test(k)), 'only the newest 3 set-aside copies are kept', qu);
  await ctx.close();
}

/* ---------- B. the whole copy is unreadable ---------- */
console.log('Whole copy unreadable (native bridge)');
const mkNative = async prefs => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  await ctx.addInitScript(p => {
    if (localStorage.getItem('__mock')) return;
    const fs = { 'DOCUMENTS/Comeback/comeback-autobackup.json': 'GOOD-BACKUP-CONTENT', 'DOCUMENTS/Comeback/comeback-autobackup-2026-08-01.json': 'GOOD-BACKUP-CONTENT' };
    localStorage.setItem('__mock', JSON.stringify({ prefs: Object.assign({ comeback_onboarded: '1' }, p), fs, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0 }));
  }, prefs);
  const pg = await newPage(ctx, errs);
  const mock = () => pg.evaluate(() => window.__mock.st());
  return { ctx, pg, mock };
};
{
  // the plan is damaged (a habit without a name) but two days are fine and one is not
  const raw = JSON.stringify({ version: 2, settings: { v: 2, habits: [{ id: 'x' }], sections: [] }, days: { '2026-09-01': good('2026-09-01'), '2026-09-02': good('2026-09-02', { vals: { pushups: 'lots' } }), '2026-09-03': good('2026-09-03') } });
  const { ctx, pg, mock } = await mkNative({ comeback: raw });
  await pg.goto(base); await ready(pg); await settle(pg);
  const msg = await pg.$eval('#bkMsg', e => ({ t: e.textContent, bad: e.classList.contains('bad') }));
  ok(msg.bad && /couldn't be read/.test(msg.t) && /nothing was overwritten/.test(msg.t), 'Settings > Backup explains that the saved data could not be read and was not overwritten', msg.t);
  let m = await mock();
  ok(m.prefs.comeback === raw, 'the unreadable copy is still exactly as it was');
  const un = Object.keys(m.prefs).filter(k => k.startsWith('comeback_unreadable_'));
  ok(un.length === 1 && m.prefs[un[0]] === raw, 'and a kept copy exists', un);
  ok(await pg.evaluate(() => dataLocked) === true, 'saving to the normal copy is locked');
  await gear(pg);
  ok(await pg.isVisible('#recoverBtn'), 'Settings > Backup shows a Recover row');
  await tab(pg, 'today');
  await setHabit(pg, 3, 5); await settle(pg);
  m = await mock();
  ok(m.prefs.comeback === raw, 'logging something does not write over the unreadable copy');
  ok(m.fs['DOCUMENTS/Comeback/comeback-autobackup.json'] === 'GOOD-BACKUP-CONTENT' && m.fs['DOCUMENTS/Comeback/comeback-autobackup-2026-08-01.json'] === 'GOOD-BACKUP-CONTENT' && !Object.keys(m.fs).some(k => /autobackup-\d{4}-\d{2}-\d{2}\.json$/.test(k) && !k.includes('2026-08-01')), 'the automatic backup files are left alone');
  const safe = JSON.parse(m.prefs.comeback_safe || 'null');
  ok(safe && Object.values(safe.days).some(d => d.vals.pushups === 5), 'the new entry is saved apart so it is not lost', safe && Object.keys(safe.days));
  await pg.reload(); await ready(pg); await settle(pg);
  m = await mock();
  ok(Object.keys(m.prefs).filter(k => k.startsWith('comeback_unreadable_')).length === 1, 'restarting does not keep another copy of the same unreadable data');
  ok(await pg.evaluate(() => Object.values(days).some(d => d.vals.pushups === 5)), 'the new entry is back after a restart');
  ok(/couldn't be read/.test(await pg.textContent('#bkMsg')) && m.prefs.comeback === raw, 'the notice stays until the data is recovered');
  // recover through the restore flow: good days come back, the damaged day and plan are reported
  await gear(pg);
  await pg.click('#recoverBtn');
  await pg.waitForSelector('.asheet');
  ok(/plan couldn't be read/.test(await pg.textContent('.asheet')) && /1 day couldn't be read/.test(await pg.textContent('.asheet')), 'the dialog says the plan could not be read and a day is left out');
  await actionChoose(pg, 'Continue');
  await actionChoose(pg, 'Replace everything');
  await pg.waitForFunction(() => /Replaced everything/.test(document.getElementById('bkMsg').textContent), null, { timeout: 5000 });
  await settle(pg);
  m = await mock();
  const main = JSON.parse(m.prefs.comeback);
  ok(Object.keys(main.days).sort().join() === '2026-09-01,2026-09-03' && main.settings.habits.length > 5, 'the readable days came back into the normal saved copy', Object.keys(main.days));
  ok(await pg.evaluate(() => dataLocked) === false && !(await pg.$('#recoverBtn')) && !('comeback_safe' in m.prefs), 'saving is unlocked and the Recover row is gone');
  ok(m.fs['DOCUMENTS/Comeback/comeback-autobackup.json'] !== 'GOOD-BACKUP-CONTENT', 'the automatic backup works again');
  await pg.reload(); await ready(pg); await settle(pg);
  ok((await pg.textContent('#bkMsg')) === '' && Object.keys(await pg.evaluate(() => days)).length === 2, 'after a restart everything loads normally');
  ok(errs.length === 0, 'no JS errors', errs);
  await ctx.close();
}
{
  // a copy that is not even JSON cannot be recovered from the app: say so, change nothing
  const raw = '{"version":2,"settings":{"v":2,"habits":[';
  const { ctx, pg, mock } = await mkNative({ comeback: raw });
  await pg.goto(base); await ready(pg); await settle(pg);
  await gear(pg);
  await pg.click('#recoverBtn');
  await pg.waitForFunction(() => /valid JSON/.test(document.getElementById('bkMsg').textContent), null, { timeout: 5000 });
  const m = await mock();
  ok(m.prefs.comeback === raw && await pg.isVisible('#recoverBtn'), 'a copy that is not valid JSON is reported, nothing changes and Recover stays');
  // a normal backup file still restores into the locked app and unlocks it
  const bk = { version: 2, settings, days: { '2026-09-09': good('2026-09-09') } };
  await pg.setInputFiles('#restoreFile', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bk)) });
  await actionChoose(pg, 'Continue'); await actionChoose(pg, 'Merge');
  await pg.waitForFunction(() => /Merged/.test(document.getElementById('bkMsg').textContent), null, { timeout: 5000 });
  await settle(pg);
  const m2 = await mock();
  ok(JSON.parse(m2.prefs.comeback).days['2026-09-09'] && !(await pg.$('#recoverBtn')), 'restoring from a backup file replaces the unreadable copy and unlocks saving');
  ok(errs.length === 0, 'no JS errors', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
