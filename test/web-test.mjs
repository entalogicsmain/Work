// Headless-browser tests for the redesigned UI (www/).
//  Part A: real web build (browser fallbacks): logging, auto-save + undo, Plan edits, export/restore, onboarding,
//          Progress, celebrations, accessibility (names, tap targets, large text), themes.
//  Part B: same pages with a mocked native bridge: auto backup + rotation, share flow, reminder, back button, haptics.
// Run: npm run test:web
import fs from 'fs';
import { serve, launch, counter, same, newPage, skipOnboarding, tab, ready, stored, sheetGone, settle, setHabit, setBody, setNote, toggleRule, goDate, actionChoose, logDay, cardSel, openBody, gear, getTime, setTime, MOCK, todayKey, daysAgo, ymd } from './helpers.mjs';

const { srv, base } = serve();
const T = counter();
const ok = T.ok;
const browser = await launch();
const tk = todayKey();
const bkMsg = pg => pg.$eval('#bkMsg', e => ({ text: e.textContent, bad: e.classList.contains('bad') }));
const waitMsg = (pg, id = 'bkMsg') => pg.waitForFunction(i => document.getElementById(i).textContent.length > 0, id, { timeout: 5000 });

/* =============== Part A: real web build =============== */
console.log('Part A: web build');
{
  const errs = [];
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 360, height: 800 } });
  await skipOnboarding(ctx);
  const pg = await newPage(ctx, errs);

  // the very old browser copy (localStorage key "resetlog", from before the Comeback rename) is migrated once (old shape: no version, no settings)
  await pg.addInitScript(() => {
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('__seeded', '1');
      localStorage.setItem('resetlog', JSON.stringify({ settings: null, days: { '2026-09-01': { vals: { steps: 9000 }, rules: { nofried: true }, weight: 88.5, waist: null, note: 'old day', date: '2026-09-01', updatedAt: 1000 } } }));
    }
  });
  await pg.goto(base); await ready(pg);
  await pg.waitForFunction(() => document.getElementById('sDays') && document.querySelector('#logList .row'), null, { timeout: 5000 }).catch(() => {});
  let d = await stored(pg);
  ok(d && d.version === 2 && d.days['2026-09-01'] && d.days['2026-09-01'].weight === 88.5, 'old localStorage data migrated into Preferences (now version 2) with the day kept', d);
  ok(d.settings.v === 2 && d.settings.habits.length === 14 && d.settings.habits.filter(h => h.type === 'yesno').length === 4 && !d.settings.rules, 'default settings (8 habits, 4 food rules, weight, waist) used when old data had none');
  ok(await pg.evaluate(() => localStorage.getItem('CapacitorStorage.comeback_migrated') === '1'), 'migration flag set (runs once)');
  const html = await pg.content();
  ok(!/googleapis|cdnjs|window\.claude/.test(html + (await pg.evaluate(() => [...document.scripts].map(s => s.src).join()))), 'no CDN / claude references left in the page');

  // shell: tab bar, large title, ring, no Save button
  ok((await pg.$$('.tabbar .tab')).length === 3 && (await pg.getAttribute('.tab[data-tab="today"]', 'aria-current')) === 'page', 'bottom tab bar with 3 tabs, Today current');
  ok((await pg.textContent('.tab[data-tab="progress"]')).trim() === 'Progress' && (await pg.$('.tab svg.ic')) !== null, 'tabs have an icon and a label');
  ok(!(await pg.$('#saveBtn')), 'there is no Save button (changes save themselves)');
  ok(/^\d+ (January|February|March|April|May|June|July|August|September|October|November|December)$|^(January|February|March|April|May|June|July|August|September|October|November|December) \d+$/.test(await pg.textContent('#todayTitle')), "today's date is the large title", await pg.textContent('#todayTitle'));
  ok(await pg.isVisible('#ring'), 'progress ring is shown');

  // large title collapses into the centred nav title on scroll
  ok(!(await pg.$eval('#navbar', e => e.classList.contains('compact'))), 'nav title is hidden at the top of the screen');
  await pg.evaluate(() => window.scrollTo(0, 400)); await pg.waitForTimeout(150);
  ok(await pg.$eval('#navbar', e => e.classList.contains('compact')) && (await pg.textContent('#navTitle')) === (await pg.textContent('#todayTitle')), 'large title collapses into a small centred title on scroll');
  await pg.evaluate(() => window.scrollTo(0, 0));

  // log a day through the sheets, auto-saved
  await setHabit(pg, 3, 25);
  ok((await pg.textContent(`${cardSel(3)} .hval`)) === '25', 'habit card shows the new value');
  ok(await pg.$eval('#savedInd', e => e.classList.contains('on')) || true, '"Saved" indicator element exists');
  await settle(pg);
  d = await stored(pg);
  ok(d.days[tk] && d.days[tk].vals.pushups === 25, 'value auto-saved (no Save tap)', d.days[tk]);
  ok((await pg.textContent('#headScore')) !== '0%', 'ring score updated');
  await toggleRule(pg, 1);
  await setBody(pg, 'weight', '87.2');
  await setBody(pg, 'waist', '97.5');
  await setNote(pg, 'Daal, roti, "quoted", comma');
  await settle(pg);
  d = await stored(pg);
  ok(d.days[tk].rules.nofried === true && d.days[tk].weight === 87.2 && d.days[tk].waist === 97.5 && d.days[tk].note === 'Daal, roti, "quoted", comma', 'rule, weight, waist (decimal keypad) and note saved', d.days[tk]);

  // undo toast
  await setHabit(pg, 2, 20);
  await pg.waitForSelector('#toast.show #toastUndo:not([hidden])');
  ok(/Brisk walk updated/.test(await pg.textContent('#toastMsg')), 'undo toast appears after a change');
  await pg.click('#toastUndo'); await settle(pg);
  d = await stored(pg);
  ok(d.days[tk].vals.walk === undefined && (await pg.textContent(`${cardSel(2)} .hval`)) === '0', 'Undo reverts the last change', d.days[tk].vals);
  ok(await pg.$eval('#toast', e => e.classList.contains('show')), 'undo confirmation toast shown');

  // keypad behaviour + validation
  await pg.click('#rowWeight'); await pg.waitForSelector('.keypad');
  for (const c of ['2', '0']) await pg.click(`.keypad .key[aria-label="${c}"]`);
  ok(/Check the weight value/.test(await pg.textContent('.sheet .err')) && await pg.$eval('.sheet .txtbtn.strong', b => b.disabled), 'impossible weight shows an error and disables Done');
  await pg.click('.keypad .key[aria-label="Delete"]'); await pg.click('.keypad .key[aria-label="Delete"]');
  ok(await pg.$eval('.sheet .nv', e => e.classList.contains('empty-v')), 'backspace clears the number (placeholder shows the last value)', await pg.textContent('.sheet .nv'));
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  await settle(pg);
  ok((await stored(pg)).days[tk].weight === 87.2, 'Cancel discards the sheet edit');
  await pg.click('#rowWeight'); await pg.waitForSelector('.keypad');
  await pg.click('.preset >> nth=0'); // "Use last" or none; presets exist only when a last value exists
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);

  // count cards: + and - buttons; duration cards: quick +5 / +10 chips; the Steps card has no buttons
  await pg.click(`${cardSel(3)} .cbtn.plus`); await settle(pg);
  ok((await stored(pg)).days[tk].vals.pushups === 26 && (await pg.textContent(`${cardSel(3)} .hval`)) === '26', 'the + button adds one rep');
  await pg.click(`${cardSel(3)} .cbtn.minus`); await settle(pg);
  ok((await stored(pg)).days[tk].vals.pushups === 25, 'the - button takes one away');
  await pg.click(`${cardSel(2)} .chipbtn >> nth=1`); await settle(pg);
  ok((await stored(pg)).days[tk].vals.walk === 10, 'a duration card has +5 and +10 minute chips');
  await pg.click('#toastUndo'); await settle(pg);
  ok(!(await pg.$(`${cardSel(1)} .cbtn`)), 'the read-only Steps card has no + or - buttons');

  // day navigation: previous day
  await pg.click('#prevDay'); await pg.waitForTimeout(100);
  ok((await pg.textContent('#dayLabelText')) === 'Yesterday' && !(await pg.$eval('#nextDay', b => b.disabled)) === true, 'day switcher moves to yesterday');
  await setHabit(pg, 3, 15); await setBody(pg, 'weight', '87.6'); await setNote(pg, '- starts with dash'); await settle(pg);
  d = await stored(pg);
  ok(Object.keys(d.days).length === 3 && d.days[daysAgo(1)], 'two new days saved next to the migrated day', Object.keys(d.days));
  ok(await pg.$eval('#nextDay', b => !b.disabled), 'next day is available when viewing the past');
  await pg.click('#nextDay'); await pg.waitForTimeout(100);
  ok((await pg.textContent('#dayLabelText')) === 'Today' && await pg.$eval('#nextDay', b => b.disabled), 'cannot go past today');

  // Plan: add / edit / reorder / swipe to delete (goals only)
  await tab(pg, 'setup');
  await pg.click('#createHabitRow');
  await pg.click('.sheet .txtbtn.strong');
  ok(/Enter a name first/.test(await pg.textContent('#fErr')), 'adding a habit needs a name');
  await pg.fill('#fName', 'Cycling'); await pg.click('.sheet .txtbtn.strong');
  ok(/Enter a target above 0/.test(await pg.textContent('#fErr')), 'a Count habit needs a target above 0');
  await pg.fill('#fTarget', '20'); await pg.fill('#fUnit', 'km'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  await pg.click('#createHabitRow'); await pg.click('#fType button[data-type="yesno"]'); await pg.fill('#fName', 'No chips'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  await pg.click('#planSections .swipe[data-id="steps"] .row'); await pg.fill('#fTarget', '9500'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  await settle(pg);
  d = await stored(pg);
  ok(d.settings.habits.some(h => h.name === 'Cycling' && h.type === 'count' && h.target === 20 && h.unit === 'km') && d.settings.habits.find(h => h.id === 'steps').target === 9500 && d.settings.habits.some(h => h.name === 'No chips' && h.type === 'yesno'), 'custom Count habit, Yes/No habit and edited target persisted', d.settings);
  // reorder by dragging the handle (inside a section)
  await pg.click('#reorderBtn');
  ok(await pg.$eval('#planSections .plan-group', e => e.classList.contains('reorder')) && (await pg.textContent('#reorderBtn')) === 'Done', 'Reorder shows drag handles');
  const hb = await (await pg.$('#planSections .swipe[data-id="pushups"] .handle')).boundingBox();
  await pg.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await pg.mouse.down();
  await pg.mouse.move(hb.x + hb.width / 2, hb.y + hb.height * 2.2, { steps: 8 }); await pg.mouse.up();
  await pg.waitForTimeout(300);
  const ord = (await stored(pg)).settings.habits.map(h => h.id);
  ok(ord.indexOf('pullups') < ord.indexOf('pushups'), 'dragging a handle reorders the habits', ord);
  await pg.click('#reorderBtn');
  await tab(pg, 'today');
  ok((await pg.textContent('.tsec[data-sec="workout"] .hcard:nth-of-type(1) .hname')) === 'Pull-ups', 'new order shows on Today');
  await tab(pg, 'setup');
  // swipe left to remove
  await pg.$eval('#planSections .swipe[data-id="nolate"]', e => e.scrollIntoView({ block: 'center' })); await pg.waitForTimeout(250);
  const rb = await (await pg.$('#planSections .swipe[data-id="nolate"] .row')).boundingBox();
  const swipe = async () => { await pg.mouse.move(rb.x + rb.width - 30, rb.y + rb.height / 2); await pg.mouse.down(); await pg.mouse.move(rb.x + 60, rb.y + rb.height / 2, { steps: 8 }); await pg.mouse.up(); await pg.waitForTimeout(350); };
  await swipe();
  ok(await pg.isVisible('#planSections .swipe[data-id="nolate"] .swipe-del'), 'swiping a row left reveals Remove');
  // Remove is immediate (no confirmation sheet) and the toast offers Undo, which puts the habit back where it was
  const idsBefore = (await stored(pg)).settings.habits.map(h => h.id);
  await pg.click('#planSections .swipe[data-id="nolate"] .swipe-del'); await settle(pg);
  ok(!(await pg.$('.asheet')) && !(await stored(pg)).settings.habits.some(r => r.id === 'nolate'), 'Remove deletes at once, with no confirmation sheet');
  ok(/Removed/.test(await pg.textContent('#toastMsg')) && await pg.isVisible('#toastUndo'), 'and the toast says so and offers Undo');
  await pg.click('#toastUndo'); await settle(pg);
  ok(same((await stored(pg)).settings.habits.map(h => h.id), idsBefore), 'Undo puts the habit back in the same place');
  await swipe();
  await pg.click('#planSections .swipe[data-id="nolate"] .swipe-del'); await settle(pg);
  ok(!(await stored(pg)).settings.habits.some(r => r.id === 'nolate'), 'removing it again sticks');
  // add it back so the backup below has everything
  await pg.click('#createHabitRow'); await pg.click('#fType button[data-type="yesno"]'); await pg.fill('#fName', 'Nothing eaten after 10 pm'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  const before = await stored(pg);
  const keys = Object.keys(before.days).sort();
  ok(keys.every(k => { const x = before.days[k]; return x.date === k && 'vals' in x && 'rules' in x && 'weight' in x && 'waist' in x && 'note' in x && 'updatedAt' in x; }), 'every day keeps the exact shape vals/rules/weight/waist/note/date/updatedAt');

  // export JSON (Backup is in Settings)
  await gear(pg);
  let [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#expJson')]);
  ok(dl.suggestedFilename() === `comeback-backup-${tk}.json`, 'JSON export file name', dl.suggestedFilename());
  const jsonPath = await dl.path();
  ok(same(JSON.parse(fs.readFileSync(jsonPath, 'utf8')), before), 'exported JSON equals stored data (version, settings, days)');
  ok(!(await pg.textContent('#lastBackup')).includes('never'), 'Last backup time shown after export');
  // export CSV
  [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#expCsv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  ok(dl.suggestedFilename() === `comeback-${tk}.csv` && lines.length === 4, 'CSV: file name and one row per day', [dl.suggestedFilename(), lines.length]);
  ok(lines[0].startsWith('Date,Score %,') && lines[0].includes('Cycling (km)') && lines[0].includes('No chips') && lines[0].endsWith('Weight (kg),Waist (cm),BMI,Note'), 'CSV header has habits, rules, weight, waist, BMI, note', lines[0]);
  ok(lines[1].startsWith('2026-09-01,') && csv.includes('"Daal, roti, ""quoted"", comma"') && csv.includes("'- starts with dash"), 'CSV escapes commas/quotes and guards formula-like notes');

  // wipe, then restore (Replace) through action sheets
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('__seeded', '1'); localStorage.setItem('__ob', '1'); localStorage.setItem('CapacitorStorage.comeback_onboarded', '1'); });
  await pg.reload(); await ready(pg);
  await tab(pg, 'progress');
  ok(await pg.isVisible('#progEmpty') && /Log your first day/.test(await pg.textContent('#progEmpty')), 'empty state invites the first log (no blank screen)');
  await gear(pg);
  await pg.setInputFiles('#restoreFile', jsonPath);
  await pg.waitForSelector('.asheet');
  ok(/has 3 logged days/.test(await pg.textContent('.asheet .ah')), 'confirmation shows number of days in the file', await pg.textContent('.asheet .ah'));
  await actionChoose(pg, 'Continue');
  await pg.waitForSelector('.asheet .ab:has-text("Merge")');
  ok((await pg.$$('.asheet .ab')).length === 3 && await pg.$eval('.asheet .ab:has-text("Replace everything")', e => e.classList.contains('destructive')), 'second step: Merge / Replace everything (red) / Cancel');
  await actionChoose(pg, 'Replace everything');
  await waitMsg(pg);
  { const after = await stored(pg), diffs = []; const df = (x, y, p) => { if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) { if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push(p + ' ' + JSON.stringify(x) + ' vs ' + JSON.stringify(y)); return; } for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) df(x[k], y[k], p + '.' + k); }; df(before, after, ''); ok(same(after, before), 'after restore, stored data is identical to the backup (all days + settings)', diffs.slice(0, 5)); }
  await tab(pg, 'progress'); await pg.waitForTimeout(300);
  ok((await pg.textContent('#sDays')) !== '0', 'Progress shows the restored days');
  await tab(pg, 'setup');
  ok((await pg.textContent('#planSections')).includes('Cycling') && (await pg.textContent('#planSections')).includes('No chips') && (await pg.textContent('#planSections .swipe[data-id="steps"]')).includes('9,500'), 'habits, custom habits and edited target restored in Plan');
  await gear(pg);

  // merge: newer updatedAt wins per day
  await pg.setInputFiles('#restoreFile', { name: 'older.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, settings: before.settings, days: {
    [tk]: { ...before.days[tk], weight: 99, updatedAt: 1 },
    '2026-09-01': { ...before.days['2026-09-01'], weight: 70, updatedAt: before.days['2026-09-01'].updatedAt + 5 },
    '2026-08-01': { vals: { steps: 100 }, rules: {}, weight: null, waist: null, note: 'extra', date: '2026-08-01', updatedAt: 5 } } })) });
  await actionChoose(pg, 'Continue'); await actionChoose(pg, 'Merge');
  await pg.waitForFunction(() => /Merged/.test(document.getElementById('bkMsg').textContent));
  const merged = await stored(pg);
  ok(merged.days[tk].weight === before.days[tk].weight && merged.days['2026-09-01'].weight === 70 && merged.days['2026-08-01'] && Object.keys(merged.days).length === 4, 'Merge: newer wins per day, older ignored, new days added');
  ok(/1 new, 1 updated, 1 kept/.test((await bkMsg(pg)).text), 'Merge summary message', (await bkMsg(pg)).text);
  await pg.setInputFiles('#restoreFile', jsonPath);
  await actionChoose(pg, 'Continue'); await actionChoose(pg, 'Cancel');
  ok(same(await stored(pg), merged), 'Cancel leaves data untouched');

  // invalid files => inline errors, no change
  const bad = [
    ['not json', 'junk.json', 'this is not json', /isn't valid JSON/], ['wrong shape', 'arr.json', '[1,2,3]', /expected a JSON object/],
    ['no days', 'nodays.json', JSON.stringify({ version: 1, settings: { habits: [], rules: [] } }), /'days'/],
    ['bad date key', 'baddate.json', JSON.stringify({ version: 1, settings: { habits: [], rules: [] }, days: { yesterday: {} } }), /not a valid date/],
    ['bad value', 'badval.json', JSON.stringify({ version: 1, settings: { habits: [], rules: [] }, days: { '2026-01-01': { vals: { steps: 'x' } } } }), /non-numeric/],
    ['newer version', 'v9.json', JSON.stringify({ version: 9, settings: { habits: [], rules: [] }, days: {} }), /newer version/],
    ['html in id', 'xss.json', JSON.stringify({ version: 1, settings: { habits: [{ id: '"><img src=x onerror=alert(1)>', name: 'x', unit: 'u', target: 1 }], rules: [] }, days: {} }), /Habit #1/]];
  for (const [label, name, content, re] of bad) {
    await pg.evaluate(() => { document.getElementById('bkMsg').textContent = ''; });
    await pg.setInputFiles('#restoreFile', { name, mimeType: 'application/json', buffer: Buffer.from(content) });
    await waitMsg(pg);
    const m = await bkMsg(pg);
    ok(m.bad && re.test(m.text) && !(await pg.$('.asheet')), `invalid file rejected with message: ${label}`, m.text);
  }
  ok(same(await stored(pg), merged), 'invalid files never change stored data');
  ok(errs.length === 0, 'no JS errors in Part A (main flow)', errs);
  await ctx.close();
}

/* ---------- sheets behave like sheets ---------- */
console.log('Sheets and gestures');
{
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await skipOnboarding(ctx);
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await ready(pg);
  await pg.click(`${cardSel(3)} .hc-main`); await pg.waitForSelector('.sheet-wrap.in');
  ok(await pg.isVisible('.sheet .grabber') && (await pg.textContent('.sheet-head')).includes('Cancel') && (await pg.textContent('.sheet-head')).includes('Done'), 'sheet has a grabber, Cancel and Done');
  await pg.waitForTimeout(500); // let the slide-in finish
  const g = await (await pg.$('.sheet .grabber')).boundingBox();
  await pg.mouse.move(g.x + g.width / 2, g.y + 4); await pg.mouse.down(); await pg.mouse.move(g.x + g.width / 2, g.y + 260, { steps: 8 }); await pg.mouse.up();
  await sheetGone(pg);
  ok(true, 'swiping down on the grabber dismisses the sheet');
  await pg.click(`${cardSel(3)} .hc-main`); await pg.waitForSelector('.sheet-wrap.in');
  await pg.keyboard.press('Escape'); await sheetGone(pg);
  ok(true, 'Escape dismisses a sheet');
  await pg.click(`${cardSel(3)} .hc-main`); await pg.waitForSelector('.sheet-wrap.in');
  await pg.mouse.click(180, 60); await sheetGone(pg);
  ok(true, 'tapping the dimmed area dismisses a sheet');
  await settle(pg);
  ok((await stored(pg)) === null || !(await stored(pg)).days[tk], 'dismissing without Done saved nothing');
  ok(errs.length === 0, 'no JS errors (sheets)', errs);
  await ctx.close();
}

/* ---------- onboarding ---------- */
console.log('Onboarding');
{
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await pg.waitForSelector('.onb');
  ok((await pg.$$('.onb-page')).length === 3 && await pg.isVisible('#onbSkip'), 'first launch is short: welcome, starter plan and reminder, with Skip (height and BMI scale are asked later, where they are used)', (await pg.$$('.onb-page')).length);
  ok(/Get back to your best, one day at a time\./.test(await pg.textContent('.onb-page:nth-child(1)')) && /Tap \+ to log\. Tick your rules\. Hold a card to edit\./.test(await pg.textContent('.onb-page:nth-child(1)')), 'page 1 says how it works in three short sentences');
  await pg.click('#onbNext');
  ok(/Pick a starting plan/.test(await pg.textContent('.onb-page:nth-child(2)')) && (await pg.$$('.onb-page:nth-child(2) .planopt')).length === 4, 'page 2: four starter plans');
  ok(await pg.$eval('#onbNext', b => b.disabled) && /Pick one to continue/.test(await pg.textContent('#onbPlanHelp')) && await pg.isVisible('#onbPlanHelp'), 'Next waits until a plan is picked, and a line says "Pick one to continue"');
  await pg.click('#plan-beginner');
  ok(!(await pg.$eval('#onbNext', b => b.disabled)) && /Beginner fitness is picked/.test(await pg.textContent('#onbPlanHelp')), 'picking a plan enables Next and the helper line confirms it');
  await pg.click('#onbNext');
  ok(/Never miss a day/.test(await pg.textContent('.onb-page:nth-child(3)')) && await pg.isVisible('#onbRemOn') && /Finish/.test(await pg.textContent('#onbStart')), 'page 3: reminder switch, and it is the last page (Finish)');
  ok(!(await pg.$('#onbHeight')) && !(await pg.$('#scale-asian')), 'no height or BMI scale pages on first run in a browser');
  await pg.click('#onbRemOn'); await pg.click('#onbStart'); await pg.waitForFunction(() => !document.querySelector('.onb'));
  await settle(pg);
  const d = await stored(pg);
  ok(d && d.settings.habits.map(h => h.id).join() === 'steps,pushups,squats,plank,water,sleep,weight,waist', 'the chosen plan is saved (weight and waist stay available, hidden)', d.settings.habits.map(h => h.id));
  ok(d.settings.body.heightCm === null && d.settings.body.scale === 'standard', 'height stays empty and the scale Standard until BMI is opened', d.settings.body);
  ok(await pg.evaluate(() => localStorage.getItem('CapacitorStorage.comeback_onboarded') === '1'), 'intro is marked as seen');
  await pg.reload(); await ready(pg); await pg.waitForTimeout(400);
  ok(!(await pg.$('.onb')), 'intro does not come back');
  await gear(pg); await pg.click('#replayIntro');
  await pg.waitForSelector('.onb'); await pg.click('#onbNext'); await pg.waitForFunction(() => !document.querySelector('.onb'));
  ok(true, '"Show intro again" in Settings replays the welcome page only');
  ok(errs.length === 0, 'no JS errors (onboarding)', errs);
  await ctx.close();
  // skipping the whole intro keeps the default plan and the Standard scale
  const c2 = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const p2 = await newPage(c2, errs);
  await p2.goto(base); await p2.waitForSelector('.onb'); await p2.click('#onbSkip');
  await p2.waitForFunction(() => !document.querySelector('.onb'));
  await settle(p2);
  const d2 = await p2.evaluate(() => ({ n: settings.habits.length, body: settings.body }));
  ok(d2.n === 14 && d2.body.heightCm === null && d2.body.scale === 'standard', 'skipping keeps the full default plan, no height, Standard scale', d2);
  await c2.close();
}

/* ---------- Progress screen ---------- */
console.log('Progress');
const seedDays = (n, scoreAt) => {
  const settings = { habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }, { id: 'pushups', name: 'Pushups', unit: 'reps', target: 30 }], rules: [{ id: 'r1', name: 'No sugar' }] };
  const days = {};
  for (let i = 1; i <= n; i++) {
    if (i % 5 === 0) continue;
    const k = daysAgo(i), q = scoreAt(i);
    days[k] = { vals: { steps: Math.round(8000 * q), pushups: Math.round(30 * q) }, rules: { r1: q > .5 }, weight: Math.round((88 - i * 0.05) * 10) / 10, waist: i % 7 === 0 ? 96 - i / 20 : null, note: '', date: k, updatedAt: 1e12 + i };
  }
  return { version: 1, settings, days };
};
{
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await skipOnboarding(ctx);
  const data = seedDays(60, i => 0.5 + 0.5 * Math.abs(Math.sin(i)));
  await ctx.addInitScript(d => { if (!localStorage.getItem('__d')) { localStorage.setItem('__d', '1'); localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(d)); } }, data);
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await ready(pg);
  await tab(pg, 'progress'); await pg.waitForTimeout(700);
  ok((await pg.$$('#seg button')).length === 3 && (await pg.getAttribute('#seg button[data-range="30"]', 'aria-checked')) === 'true', 'segmented control: Week / Month / 3 Months (Month selected)');
  ok((await pg.$$('.stat')).length === 6, 'six stat tiles (streak, days logged, weight, waist, average steps, average distance)');
  ok(/^−?\+?[\d.]+ kg$|^[+−][\d.]+ kg$/.test(await pg.textContent('#sWeight')), 'weight change tile shows a signed value', await pg.textContent('#sWeight'));
  ok((await pg.$$('#heat .hc')).length === 35, 'Month calendar has 35 squares');
  ok(await pg.evaluate(() => !!Chart.getChart('chart')) , 'trend chart is drawn');
  const countHeat = async r => { await pg.click(`#seg button[data-range="${r}"]`); await pg.waitForTimeout(200); return (await pg.$$('#heat .hc')).length; };
  ok((await countHeat(7)) === 7 && (await countHeat(90)) === 91, 'Week shows 7 squares, 3 Months shows 91');
  ok(/last 3 months/.test(await pg.textContent('#sDaysSub')), 'stats follow the selected range');
  await pg.click('#seg button[data-range="30"]');
  await pg.click('.chip:has-text("Weight")'); await pg.waitForTimeout(500);
  ok((await pg.getAttribute('.chip:has-text("Weight")', 'aria-pressed')) === 'true' && /kg/.test(await pg.textContent('#readout')), 'metric chips switch the chart (readout shows kg)');
  ok(/Weight over the last month: \d+ entries/.test(await pg.textContent('#chartSummary')) && (await pg.getAttribute('#chart', 'aria-hidden')) === 'true', 'chart has a text summary for screen readers (the canvas itself is hidden from them)', await pg.textContent('#chartSummary'));
  await pg.evaluate(() => document.getElementById('chart').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(250);   // the week tile above the chart moves it, so scroll to it rather than to a fixed offset
  const cb = await (await pg.$('#chart')).boundingBox();
  await pg.mouse.move(cb.x + cb.width * 0.4, cb.y + cb.height / 2); await pg.waitForTimeout(250);
  ok(!/Latest/.test(await pg.textContent('#readout')), 'scrubbing across the chart shows the exact value for that day', await pg.textContent('#readout'));
  await pg.mouse.move(cb.x + cb.width * 0.4, cb.y - 60); await pg.mouse.move(5, 5); await pg.waitForTimeout(250);
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.evaluate(() => window.scrollTo(0, 600));
  await pg.click('#heat .hc.g, #heat .hc.o, #heat .hc.r >> nth=0'); await pg.waitForSelector('.sheet');
  ok(/Daily score/.test(await pg.textContent('.sheet')) && /Steps/.test(await pg.textContent('.sheet')) && await pg.isVisible('.sheet .btn'), 'tapping a calendar day opens that day in a sheet');
  await pg.click('.sheet .btn'); await pg.waitForFunction(() => document.getElementById('p-today').classList.contains('on'));
  ok(true, '"Edit this day" jumps to Today');
  ok(!!(await pg.$('#ringCard')) && (await pg.textContent('#dayLabelText')) !== 'Today', 'Today shows the chosen past day');
  await tab(pg, 'progress'); await pg.evaluate(() => window.scrollTo(0, 99999));
  await pg.click('#logList .row >> nth=0'); await pg.waitForSelector('.sheet'); await pg.click('.sheet .txtbtn:has-text("Done")'); await sheetGone(pg);
  ok(true, 'recent days open the same sheet');
  ok(errs.length === 0, 'no JS errors (progress)', errs);
  await ctx.close();
}

/* ---------- celebrations and streaks ---------- */
console.log('Positive reinforcement');
{
  const errs = [];
  const mk = async reduce => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    await skipOnboarding(ctx);
    const settings = { habits: [{ id: 'a', name: 'Pushups', unit: 'reps', target: 10 }, { id: 'b', name: 'Water', unit: 'litres', target: 2 }], rules: [{ id: 'r', name: 'No sugar' }] };
    const day = (k, v, r) => ({ vals: v, rules: r, weight: null, waist: null, note: '', date: k, updatedAt: 1e12 });
    const days = { [daysAgo(1)]: day(daysAgo(1), { a: 10, b: 2 }, { r: true }), [daysAgo(2)]: day(daysAgo(2), { a: 10, b: 2 }, { r: true }), [tk]: day(tk, { a: 10 }, { r: true }) };
    await ctx.addInitScript(d => { if (!localStorage.getItem('__d')) { localStorage.setItem('__d', '1'); localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(d)); } }, { version: 1, settings, days });
    const pg = await newPage(ctx, errs); await pg.goto(base); await ready(pg); await pg.waitForTimeout(600);
    return { ctx, pg };
  };
  let { ctx, pg } = await mk(false);
  ok(/3-day streak/.test(await pg.textContent('#streakLine')), 'streak shown on Today', await pg.textContent('#streakLine'));
  await setHabit(pg, 'b', 2);
  await pg.waitForTimeout(150);
  ok(await pg.$eval('#ring', e => e.classList.contains('done')) && /Strong day\. Your comeback is on track\./.test(await pg.textContent('#toastMsg')), 'completing every target and rule closes the ring and says so');
  ok(!!(await pg.$('.confetti')), 'a short confetti moment plays');
  ok((await pg.textContent('#ringCap')) === 'All done' && (await pg.textContent('#headScore')) === '100%', 'ring reads 100% / All done');
  await ctx.close();
  ({ ctx, pg } = await mk(true));
  await setHabit(pg, 'b', 2); await pg.waitForTimeout(150);
  ok(!(await pg.$('.confetti')) && await pg.$eval('#ring', e => e.classList.contains('done')), 'reduced motion: no confetti, the completion still shows');
  await ctx.close();
  // streak milestone + goal hit wording
  const ctx3 = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await skipOnboarding(ctx3);
  await ctx3.addInitScript(d => { if (!localStorage.getItem('__d')) { localStorage.setItem('__d', '1'); localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(d)); } }, (() => {
    const settings = { habits: [{ id: 'a', name: 'Pushups', unit: 'reps', target: 10 }, { id: 'b', name: 'Water', unit: 'litres', target: 2 }], rules: [{ id: 'r', name: 'No sugar' }] };
    const day = (k, v, r) => ({ vals: v, rules: r, weight: null, waist: null, note: '', date: k, updatedAt: 1e12 });
    return { version: 1, settings, days: { [daysAgo(1)]: day(daysAgo(1), { a: 10, b: 2 }, { r: true }), [daysAgo(2)]: day(daysAgo(2), { a: 10, b: 2 }, { r: true }) } };
  })());
  const p3 = await newPage(ctx3, errs); await p3.goto(base); await ready(p3);
  await setHabit(p3, 'a', 10); await toggleRule(p3, 'r'); await p3.waitForTimeout(150);
  ok(/3-day streak/.test(await p3.textContent('#toastMsg')), 'a streak milestone is celebrated ("3-day streak")', await p3.textContent('#toastMsg'));
  await ctx3.close();
  const ctx4 = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await skipOnboarding(ctx4);
  const p4 = await newPage(ctx4, errs); await p4.goto(base); await ready(p4);
  await setHabit(p4, 2, 30); await p4.waitForTimeout(150);
  ok(/Brisk walk goal hit/.test(await p4.textContent('#toastMsg')), 'reaching a target says "<item> goal hit"', await p4.textContent('#toastMsg'));
  { const html4 = (await p4.content()).replace(/<script[\s\S]*?<\/script>/g, ''); ok(!/\bmiss(ed|ing)?\b|fail|bad|lazy|shame/i.test(html4), 'no guilt language anywhere in the page', (() => { const i = html4.search(/\bmiss(ed|ing)?\b|fail|bad|lazy|shame/i); return i < 0 ? '' : html4.slice(Math.max(0, i - 60), i + 60); })()); }
  ok(/Not logged|Start again|Log a day to start|Reach 50% today/.test(await p4.textContent('#streakLine')), 'neutral wording for no streak', await p4.textContent('#streakLine'));
  await ctx4.close();
  ok(errs.length === 0, 'no JS errors (celebrations)', errs);
}

/* ---------- accessibility, tap targets, large text, themes ---------- */
console.log('Accessibility and theming');
{
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await skipOnboarding(ctx);
  const data = seedDays(40, i => 0.45 + 0.5 * Math.abs(Math.sin(i * 1.7)));
  await ctx.addInitScript(d => { if (!localStorage.getItem('__d')) { localStorage.setItem('__d', '1'); localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(d)); } }, data);
  const pg = await newPage(ctx, errs); await pg.goto(base); await ready(pg); await pg.waitForTimeout(500);
  const audit = async tabName => {
    if (tabName === 'settings') await gear(pg); else await tab(pg, tabName);
    await pg.waitForTimeout(500);
    return pg.evaluate(() => {
      const bad = [], small = [];
      const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && e.closest('.screen.on, .tabbar, .navbar'); };
      document.querySelectorAll('button, [role=button], input:not([type=file]), textarea, [role=switch], canvas[role=img]').forEach(e => {
        if (!vis(e)) return;
        const lab = e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent.trim()) || e.textContent.trim() || e.getAttribute('placeholder');
        if (!lab) bad.push(e.outerHTML.slice(0, 90));
      });
      document.querySelectorAll('.tab,.row,.hcard,.hc-main,.cbtn,.drow,.tsec-title-btn,.iconbtn,.txtbtn,.btn,.seg button,.hc,.key,.step,.daypill').forEach(e => {
        if (!vis(e)) return; const r = e.getBoundingClientRect();
        if (Math.min(r.width, r.height) < 43.5) small.push(e.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      return { bad, small };
    });
  };
  for (const t of ['today', 'progress', 'setup', 'settings']) {
    const r = await audit(t);
    ok(r.bad.length === 0, `every control on ${t} has an accessible name`, r.bad);
    ok(r.small.length === 0, `every tap target on ${t} is at least 44x44`, r.small);
  }
  // sheets too
  await tab(pg, 'today'); await pg.click('#sections .hcard:not([data-id="steps"]) .hc-main'); await pg.waitForSelector('.keypad');
  const sh = await pg.evaluate(() => [...document.querySelectorAll('.sheet button')].map(b => { const r = b.getBoundingClientRect(); return { n: b.getAttribute('aria-label') || b.textContent.trim(), w: r.width, h: r.height }; }).filter(x => !x.n || Math.min(x.w, x.h) < 43.5));
  ok(sh.length === 0, 'number sheet: named controls, 44px+ targets', sh);
  await pg.keyboard.press('Escape'); await sheetGone(pg);
  ok(await pg.$eval('#ring', e => e.getAttribute('role') === 'img' && /score \d+ percent/.test(e.getAttribute('aria-label'))), 'ring has a spoken summary', await pg.getAttribute('#ring', 'aria-label'));
  ok(await pg.$eval('#sections .hcard:not([data-id="steps"]) .hc-main', e => /of .* \w+/.test(e.getAttribute('aria-label'))) && await pg.$eval('#sections .hcard[data-id="steps"] .hc-main', e => /Steps/.test(e.getAttribute('aria-label'))), 'habit cards describe value and target (Steps card is described too)');
  ok(await pg.$eval('#sections .yrow input.switch', e => e.getAttribute('role') === 'switch'), 'rules are real switches');
  // status is never colour alone: heat cells and pills carry text
  await tab(pg, 'progress');
  ok(await pg.$$eval('#heat .hc', cs => cs.every(c => /percent|not logged/.test(c.getAttribute('aria-label')))) && await pg.$$eval('#logList .pill', ps => ps.every(p => /%$/.test(p.textContent))), 'calendar cells and score pills state their value in text, not colour alone');
  ok(await pg.$eval('.legend', l => /80% or more/.test(l.textContent) && /Under 40%/.test(l.textContent)), 'legend names each status');
  // large text (130%)
  await pg.addStyleTag({ content: 'html{font-size:130%}' }); await pg.waitForTimeout(500);
  for (const t of ['today', 'progress', 'setup', 'settings']) {
    if (t === 'settings') await gear(pg); else await tab(pg, t);
    await pg.waitForTimeout(500);
    const o = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(o <= 0, `no horizontal overflow at 130% text on ${t}`, o);
  }
  ok(errs.length === 0, 'no JS errors (a11y)', errs);
  await ctx.close();
  // light / dark tokens
  for (const [scheme, bg, card] of [['light', 'rgb(233, 239, 249)', 'rgba(255, 255, 255, 0.72)'], ['dark', 'rgb(7, 12, 15)', 'rgba(255, 255, 255, 0.055)']]) {
    const c2 = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: scheme });
    await skipOnboarding(c2);
    const p2 = await newPage(c2, errs); await p2.goto(base); await ready(p2);
    const got = await p2.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, card: getComputedStyle(document.querySelector('.hcard')).backgroundColor }));
    ok(got.bg === bg && got.card === card, `${scheme} mode: background ${bg}, glass cards ${card}`, got);
    await c2.close();
  }
}

/* =============== Part B: mocked native bridge =============== */
console.log('Part B: mocked native bridge');
{
  const errs = [];
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 360, height: 800 } });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const pg = await newPage(ctx, errs);
  const mock = () => pg.evaluate(() => window.__mock.st());
  const calls = async n => (await mock()).calls.filter(c => c.n === n);
  await pg.addInitScript(() => {
    if (!localStorage.getItem('__mock')) {
      const fsx = {};
      for (let i = 1; i <= 9; i++) fsx[`DOCUMENTS/Comeback/comeback-autobackup-2026-08-0${i}.json`] = '{}';
      fsx['DOCUMENTS/Comeback/comeback-backup-2026-08-01.json'] = '{"manual":true}';
      localStorage.setItem('__mock', JSON.stringify({ prefs: { comeback_onboarded: '1' }, fs: fsx, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0 }));
    }
  });
  await pg.goto(base); await ready(pg);
  await gear(pg);
  ok((await pg.textContent('#storeNote')).includes('Documents/Comeback'), 'native mode note mentions Documents/Comeback');
  ok((await pg.textContent('#lastBackup')) === 'Last backup: never', 'Last backup shows "never" at first');

  // haptics
  await tab(pg, 'today');
  ok((await calls('impact')).length > 0, 'tapping gives a light haptic');
  // save -> auto backup
  await setHabit(pg, 4, 3); await setNote(pg, 'native day'); await settle(pg);
  await pg.waitForFunction(() => !document.getElementById('lastBackup').textContent.includes('never'));
  let m = await mock();
  const pref = JSON.parse(m.prefs.comeback);
  ok(pref.version === 2 && pref.settings.v === 2 && pref.days[tk], 'Preferences holds the data object (version 2) after a change');
  const auto = m.fs['DOCUMENTS/Comeback/comeback-autobackup.json'];
  ok(auto && same(JSON.parse(auto), pref), 'Documents/Comeback/comeback-autobackup.json written with full data');
  ok(m.fs[`DOCUMENTS/Comeback/comeback-autobackup-${tk}.json`] === auto, "today's dated copy written");
  const dated = Object.keys(m.fs).filter(k => /comeback-autobackup-\d{4}-\d{2}-\d{2}\.json$/.test(k)).map(k => k.split('-autobackup-')[1].slice(0, 10)).sort();
  ok(dated.length === 7 && dated.includes(tk) && !dated.includes('2026-08-01') && !dated.includes('2026-08-03') && dated.includes('2026-08-04'), 'only the newest 7 dated copies are kept', dated);
  ok('DOCUMENTS/Comeback/comeback-backup-2026-08-01.json' in m.fs, 'manual exports are never pruned');
  ok((await bkMsg(pg)).text === '', 'no error shown after a good auto backup');

  // goal haptic
  await setHabit(pg, 3, 30); await pg.waitForTimeout(150);
  ok((await calls('notify')).length > 0 && /goal hit/.test(await pg.textContent('#toastMsg')), 'reaching a target gives a success haptic');

  // failures are visible
  await pg.evaluate(() => window.__mock.set('failWrite', true));
  await setNote(pg, 'second save'); await settle(pg);
  await gear(pg); await waitMsg(pg);
  const e1 = await bkMsg(pg);
  ok(e1.bad && /Automatic backup failed: EACCES/.test(e1.text), 'failed auto backup shows an inline error', e1.text);
  await pg.evaluate(() => { document.getElementById('bkMsg').textContent = ''; });
  await pg.click('#expJson');
  await pg.waitForFunction(() => /Documents|share|Shared/i.test(document.getElementById('bkMsg').textContent));
  const e2 = await bkMsg(pg), shares = await calls('share');
  ok(/Couldn't save a copy in Documents \(EACCES/.test(e2.text) && shares.length === 1 && /Cache\//.test(shares[0].a.files[0]), 'export falls back to a temp copy and reports the Documents error', e2.text);
  await pg.evaluate(() => window.__mock.set('failWrite', false));
  await pg.evaluate(() => { document.getElementById('bkMsg').textContent = ''; });
  await pg.click('#expJson');
  await pg.waitForFunction(() => /Shared\./.test(document.getElementById('bkMsg').textContent));
  m = await mock();
  const sh = (await calls('share')).pop().a;
  ok(sh.files.length === 1 && sh.files[0].endsWith(`/Documents/Comeback/comeback-backup-${tk}.json`), 'JSON export shared from Documents/Comeback with the right name', sh.files);
  ok(same(JSON.parse(m.fs[`DOCUMENTS/Comeback/comeback-backup-${tk}.json`]), JSON.parse(m.prefs.comeback)), 'exported JSON contains the full data object');
  ok(!(await bkMsg(pg)).bad && (await bkMsg(pg)).text.includes(`Saved to Documents/Comeback/comeback-backup-${tk}.json`), 'success message names the saved file');
  await pg.click('#expCsv');
  await pg.waitForFunction(() => /comeback-.*\.csv/.test(document.getElementById('bkMsg').textContent));
  m = await mock();
  ok(m.fs[`DOCUMENTS/Comeback/comeback-${tk}.csv`].startsWith('﻿Date,Score %') && (await calls('share')).pop().a.files[0].endsWith('.csv'), 'CSV written to Documents and shared');
  await pg.evaluate(() => window.__mock.set('shareMode', 'cancel'));
  await pg.click('#expJson'); await pg.waitForFunction(() => /cancelled/.test(document.getElementById('bkMsg').textContent));
  ok(!(await bkMsg(pg)).bad, 'cancelling the share sheet is not an error');
  await pg.evaluate(() => window.__mock.set('shareMode', 'fail'));
  await pg.click('#expJson'); await pg.waitForFunction(() => /share sheet/.test(document.getElementById('bkMsg').textContent));
  ok((await bkMsg(pg)).bad && /No share targets/.test((await bkMsg(pg)).text), 'share failure is shown inline');
  await pg.evaluate(() => window.__mock.set('shareMode', 'ok'));

  // restore writes a safety copy first
  const snapshot = JSON.parse((await mock()).prefs.comeback);
  await pg.setInputFiles('#restoreFile', { name: 'new-phone.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, settings: snapshot.settings, days: { '2026-01-05': { vals: { steps: 1 }, rules: {}, weight: 90, waist: 100, note: '', date: '2026-01-05', updatedAt: 3 } } })) });
  await actionChoose(pg, 'Continue'); await actionChoose(pg, 'Replace everything');
  await pg.waitForFunction(() => /Replaced everything/.test(document.getElementById('bkMsg').textContent));
  m = await mock();
  ok(same(JSON.parse(m.fs['DOCUMENTS/Comeback/comeback-before-restore.json']), snapshot), 'safety copy of the old data saved before restoring');
  ok(Object.keys(JSON.parse(m.prefs.comeback).days).join() === '2026-01-05', 'Replace everything leaves only the backup days');
  ok(same(JSON.parse(m.fs['DOCUMENTS/Comeback/comeback-autobackup.json']), JSON.parse(m.prefs.comeback)), 'auto backup refreshed after restore');

  // reminder: denied, then granted
  await gear(pg);
  await pg.evaluate(() => window.__mock.set('requestResult', 'denied'));
  await pg.click('#remOn'); await pg.waitForFunction(() => document.getElementById('remMsg').textContent.length > 0);
  const r1 = await pg.$eval('#remMsg', e => ({ t: e.textContent, bad: e.classList.contains('bad') }));
  ok(r1.bad && /blocked/i.test(r1.t) && !(await pg.isChecked('#remOn')) && (await calls('schedule')).length === 0, 'denied permission: switch reverts and a message is shown', r1);
  await pg.evaluate(() => { window.__mock.set('requestResult', 'granted'); window.__mock.set('perm', 'prompt'); });
  ok((await getTime(pg, '#remTime')) === '21:00' && (await pg.$eval('#remTime .t12-p', e => e.value)) === 'PM' && (await pg.$eval('#remTime .t12-h', e => e.value)) === '9', 'default reminder time is 9:00 PM');
  await pg.check('#remOn'); await pg.waitForFunction(() => /Reminder set/.test(document.getElementById('remMsg').textContent));
  // the reminder only comes when something is left (default), so it is planned as one-shot notifications (schedule.at) for today and the next days
  const evenings = list => list.filter(n => n.id >= 1001 && n.id <= 1003);
  let sch = evenings((await calls('schedule')).pop().a.notifications);
  const at = n => new Date(n.schedule.at);
  ok(sch.length >= 2 && sch.every(n => n.title === 'Comeback' && !n.schedule.on && at(n).getHours() === 21 && at(n).getMinutes() === 0 && /\S/.test(n.body)), 'one-shot notifications at 21:00 titled Comeback, for the next days', sch);
  ok(sch.every(n => n.isExactNotification === false && n.schedule.allowWhileIdle === true && n.channelId === 'daily-reminder'), 'inexact, doze-friendly, own channel');
  await setTime(pg, '#remTime', '07:30'); await pg.waitForFunction(() => /moved to/i.test(document.getElementById('remMsg').textContent));
  sch = evenings((await calls('schedule')).pop().a.notifications);
  ok(sch.length >= 2 && sch.every(n => at(n).getHours() === 7 && at(n).getMinutes() === 30), 'changing the time reschedules', sch.map(n => n.schedule));
  const nBefore = (await calls('schedule')).length;
  await pg.reload(); await ready(pg); await gear(pg); await pg.waitForTimeout(400);
  ok((await pg.isChecked('#remOn')) && (await getTime(pg, '#remTime')) === '07:30' && (await calls('schedule')).length === nBefore + 1, 'reminder settings survive a restart and are re-armed');
  await pg.uncheck('#remOn'); await pg.waitForFunction(() => /off/i.test(document.getElementById('remMsg').textContent));
  ok(!JSON.parse((await mock()).prefs.comeback_meta).reminder.enabled, 'turning the reminder off cancels it');

  // back button: sheet first, then Today, then exit
  await tab(pg, 'progress'); await gear(pg);
  await pg.evaluate(() => window.__mock.fire('backButton'));
  ok((await pg.getAttribute('.tab[data-tab="progress"]', 'aria-current')) === 'page' && (await mock()).exit === 0, 'back from Settings returns to the screen it was opened from');
  await pg.evaluate(() => window.__mock.fire('backButton'));
  ok((await pg.getAttribute('.tab[data-tab="today"]', 'aria-current')) === 'page' && (await mock()).exit === 0, 'back from another tab goes to Today first');
  await pg.click(`${cardSel(1)} .hc-main`); await pg.waitForSelector('.sheet-wrap.in');
  await pg.evaluate(() => window.__mock.fire('backButton')); await sheetGone(pg);
  ok((await mock()).exit === 0, 'back closes an open sheet first');
  await pg.evaluate(() => window.__mock.fire('backButton'));
  ok((await mock()).exit === 1, 'back on Today exits the app');
  await tab(pg, 'setup'); await pg.click('#addHabitRow'); await pg.waitForSelector('.sheet-wrap.in');
  await pg.evaluate(() => window.__mock.fire('localNotificationActionPerformed', { actionId: 'tap' }));
  await sheetGone(pg);
  ok((await pg.getAttribute('.tab[data-tab="today"]', 'aria-current')) === 'page', 'tapping the notification closes sheets and opens Today');
  ok((await calls('statusBg')).length > 0 && (await calls('statusStyle')).length > 0, 'status bar colour/style synced with the theme');
  ok(errs.length === 0, 'no JS errors in Part B', errs);
  await ctx.close();
}

// status bar follows light/dark
for (const [scheme, color, style] of [['dark', '#070c0f', 'DARK'], ['light', '#e9eff9', 'LIGHT']]) {
  const errs = [];
  const ctx = await browser.newContext({ colorScheme: scheme });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const pg = await newPage(ctx, errs); await pg.goto(base); await ready(pg);
  const st = await pg.evaluate(() => window.__mock.st().calls);
  const bg = st.filter(x => x.n === 'statusBg').pop(), sy = st.filter(x => x.n === 'statusStyle').pop();
  ok(bg && bg.a.color.toLowerCase() === color && sy.a.style === style, `${scheme} mode: status bar ${color} with ${style === 'DARK' ? 'light' : 'dark'} icons`, bg);
  ok(errs.length === 0, `no JS errors (${scheme} status bar)`, errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
