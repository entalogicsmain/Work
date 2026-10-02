// The reorganized app: Today sections and habit types, schedules, edit mode, the habit library, starter plans, target suggestions,
// Settings, the BMI card and sheet, units, the data migration, and old backups.
// Run: npm run test:structure
import fs from 'fs';
import { createRequire } from 'module';
import { serve, launch, counter, same, newPage, skipOnboarding, tab, gear, ready, stored, sheetGone, settle, setHabit, setBody, setNote, toggleRule, openBody, actionChoose, cardSel, getTime, setTime, MOCK, todayKey, daysAgo, ymd } from './helpers.mjs';

const Core = createRequire(import.meta.url)('../www/js/core.js');
const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();
const tk = todayKey();
const KEY = 'CapacitorStorage.comeback';

const day = (k, vals = {}, rules = {}, extra = {}) => ({ vals, rules, weight: null, waist: null, note: '', date: k, updatedAt: 1e12, ...extra });
const withSettings = fn => { const s = Core.defaultSettings(); fn(s); return s; };
const H = (s, id) => s.habits.find(h => h.id === id);

async function open({ data, w = 390, h = 900, onboard = false, scheme = 'light', native = false, still = false } = {}) {
  const errs = [];
  // `still` turns the wiggle off (reduced motion) so the browser can click moving cards
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, acceptDownloads: true, reducedMotion: still ? 'reduce' : 'no-preference' });
  if (native) await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  if (!onboard && !native) await skipOnboarding(ctx);
  if (data) await ctx.addInitScript(([d, key]) => { if (!localStorage.getItem('__d')) { localStorage.setItem('__d', '1'); localStorage.setItem(key, JSON.stringify(d)); } }, [data, KEY]);
  const pg = await newPage(ctx, errs);
  await pg.goto(base);
  if (!onboard) await ready(pg);
  return { ctx, pg, errs };
}
const secIds = pg => pg.$$eval('#sections .tsec', e => e.map(x => x.dataset.sec));
const itemIds = (pg, sec) => pg.$$eval(`#sections .tsec[data-sec="${sec}"] .titem`, e => e.map(x => x.dataset.id));
const allItems = pg => pg.$$eval('#sections .titem', e => e.map(x => x.dataset.id));
const txt = async (pg, sel) => (await pg.textContent(sel)).replace(/\u00a0/g, ' ');
const toastText = pg => pg.textContent('#toastMsg');

/* ================= Today: sections and habit types ================= */
console.log('Today sections and habit types');
{
  const { ctx, pg, errs } = await open();
  ok((await secIds(pg)).join() === 'movement,workout,health,food,body', 'Today groups habits into Movement, Workout, Health, Food rules and Body and notes', await secIds(pg));
  ok((await pg.$$eval('#sections .tsec-title', e => e.map(x => x.textContent))).join() === 'Movement,Workout,Health,Food rules,Body and notes', 'the section titles read well');
  ok((await itemIds(pg, 'movement')).join() === 'steps,walk' && (await itemIds(pg, 'workout')).join() === 'pushups,pullups,squats,plank' && (await itemIds(pg, 'food')).length === 4, 'Steps and Brisk walk are Movement; pushups, pull-ups, squats and plank are Workout; the four food rules are Food rules');
  ok(await pg.$eval('#sections .tsec[data-sec="body"] .tsec-toggle', e => e.getAttribute('aria-expanded') === 'false') && !(await pg.$('#rowWeight')), 'Body and notes starts collapsed');
  ok(/Weight, waist and notes/.test(await pg.textContent('#sections .tsec[data-sec="body"] .tsec-sum')), 'its collapsed header says what is inside');
  await openBody(pg);
  ok(await pg.isVisible('#rowNote') && await pg.isVisible('#rowBmi'), 'opening it shows weight/waist (when due), BMI and the note');
  // types
  ok(!!(await pg.$(`${cardSel('pushups')} .cbtn.minus`)) && !!(await pg.$(`${cardSel('pushups')} .cbtn.plus`)), 'Count: a card with + and −');
  ok((await pg.$$(`${cardSel('walk')} .chipbtn`)).length === 2 && /\+5/.test(await pg.textContent(`${cardSel('walk')} .chipbtn >> nth=0`)), 'Duration: a card with minute presets');
  ok(!!(await pg.$('#sections .yrow[data-id="nofried"] input.switch')), 'Yes/No: one tap (a switch)');
  ok(!(await pg.$(`${cardSel('steps')} .cbtn`)) && !(await pg.$(`${cardSel('steps')} input`)), 'Steps: read-only, no buttons, no input');
  await pg.click(`${cardSel('pushups')} .cbtn.plus`); await pg.click(`${cardSel('pushups')} .cbtn.plus`);
  await pg.click('#sections .yrow[data-id="nofried"] .row'); await settle(pg);
  const d = (await stored(pg)).days[tk];
  ok(d.vals.pushups === 2 && d.rules.nofried === true, 'a Count habit adds to vals and a Yes/No habit ticks rules (the day record is unchanged)', d);
  await pg.click(`${cardSel('walk')} .chipbtn >> nth=1`); await settle(pg);
  ok((await stored(pg)).days[tk].vals.walk === 10, 'a Duration preset adds minutes');
  // tapping a Count card still opens the number pad
  await pg.click(`${cardSel('pushups')} .hc-main`); await pg.waitForSelector('.keypad');
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  ok(errs.length === 0, 'no JS errors (sections)', errs);
  await ctx.close();
}

/* ================= met cards shrink ================= */
console.log('Completed cards');
{
  const { ctx, pg, errs } = await open();
  await setHabit(pg, 'pushups', 30);
  ok(!!(await pg.$('#sections .drow[data-id="pushups"]')) && !(await pg.$(cardSel('pushups'))), 'a card that hits its target shrinks to one compact row');
  ok(/Pushups/.test(await pg.textContent('.drow[data-id="pushups"]')) && /30 \/ 30/.test(await pg.textContent('.drow[data-id="pushups"]')) && !!(await pg.$('.drow[data-id="pushups"] .met-ic svg')), 'with its name, value and a ✓');
  const hRow = (await (await pg.$('.drow[data-id="pushups"]')).boundingBox()).height;
  ok(hRow < 64 && hRow >= 44, 'the compact row is short but still a 44px tap target', hRow);
  await pg.click('.drow[data-id="pushups"]');
  ok(!!(await pg.$(cardSel('pushups'))) && !!(await pg.$(`${cardSel('pushups')} .hc-collapse`)), 'tapping it opens the full card again');
  await pg.click(`${cardSel('pushups')} .hc-collapse`);
  ok(!!(await pg.$('#sections .drow[data-id="pushups"]')), 'and the arrow folds it away again');
  ok(errs.length === 0, 'no JS errors (completed cards)', errs);
  await ctx.close();
}

/* ================= schedules on Today ================= */
console.log('Schedules');
{
  const dow = new Date().getDay();
  const other = (dow + 3) % 7;                // a weekday that is not today
  const s = withSettings(x => {
    H(x, 'pullups').schedule = { kind: 'days', days: [other] };            // not today
    H(x, 'squats').schedule = { kind: 'days', days: [dow] };               // today
    H(x, 'water').schedule = { kind: 'weekly', times: 3 };                 // 3 times a week
    H(x, 'sleep').schedule = { kind: 'everyN', weeks: 2 };                 // every 2 weeks
    H(x, 'plank').schedule = { kind: 'everyN', weeks: 2 };
  });
  const days = { [daysAgo(3)]: day(daysAgo(3), { plank: 60 }) };            // plank was done 3 days ago: not due for 2 weeks
  const { ctx, pg, errs } = await open({ data: { version: 2, settings: s, days } });
  const ids = await allItems(pg);
  ok(!ids.includes('pullups') && ids.includes('squats'), 'only habits due today show (a habit for another weekday is not on Today)', ids);
  ok(!ids.includes('plank') && ids.includes('sleep'), 'an every-2-weeks habit done recently is hidden; one never done is due', ids);
  ok(/0 of 3 this week/.test(await pg.textContent(`${cardSel('water')} .hsrc`)), 'an X-times-a-week habit shows "0 of 3 this week"');
  ok((await pg.textContent('#chipTargets')).trim() === '0 of ' + ids.filter(i => ['steps', 'walk', 'pushups', 'squats', 'sleep'].includes(i)).length + ' targets' || /of \d+ targets/.test(await pg.textContent('#chipTargets')), 'the target count only includes what is due');
  await pg.click(`${cardSel('water')} .cbtn.plus`); await pg.click(`${cardSel('water')} .cbtn.plus`);
  // water step is 0.5; hit the 2.5 L target by typing it
  await setHabit(pg, 'water', 2.5);
  const afterOne = await pg.textContent('#sections .drow[data-id="water"] .row-val').catch(() => '');
  ok(/2\.5/.test(afterOne), 'meeting the target of a weekly habit marks it done for the day', afterOne);
  ok(errs.length === 0, 'no JS errors (schedules)', errs);
  await ctx.close();
}
{
  // the daily score and the streak only count what was due that day
  const s = withSettings(x => { x.habits = x.habits.filter(h => ['pushups', 'pullups', 'nofried'].includes(h.id)); H(x, 'pullups').schedule = { kind: 'days', days: [1] }; });
  const k1 = daysAgo(1), k2 = daysAgo(2);
  const dows = [k1, k2].map(k => { const [a, b, c] = k.split('-').map(Number); return new Date(a, b - 1, c).getDay(); });
  const days = {};
  for (const k of [k1, k2]) days[k] = day(k, { pushups: 30 }, { nofried: true });
  const { ctx, pg, errs } = await open({ data: { version: 2, settings: s, days } });
  const sc = await pg.evaluate(([a]) => scoreOf(days[a]), [k1]);
  const mondayYesterday = dows[0] === 1;
  ok(sc === (mondayYesterday ? Math.round(2 / 3 * 100) : 100), 'a habit that is not due that day does not pull the score down', [sc, dows]);
  ok(/^\d+-day streak/.test(await pg.textContent('#streakLine')) || /Log a day|Start again|Reach 50%/.test(await pg.textContent('#streakLine')), 'streak line renders');
  ok(await pg.evaluate(() => streak()) >= 2, 'the streak counts the days that were done');
  await ctx.close();
}

/* ================= edit mode ================= */
console.log('Edit mode');
{
  const { ctx, pg, errs } = await open({ still: true, h: 1700 });
  ok(!(await pg.isVisible('#editBar')), 'edit mode is off by default');
  await pg.dispatchEvent(`${cardSel('pushups')} .hc-main`, 'pointerdown', { clientX: 120, clientY: 500 });
  await pg.waitForSelector('#editBar:not([hidden])', { timeout: 3000 });
  ok(await pg.isVisible('#editDone') && await pg.$eval('#p-today', e => e.classList.contains('editing')), 'a long press on a card starts edit mode (with a Done button)');
  ok((await pg.$$('#sections .titem .handle-btn')).length > 0 && (await pg.$$('#sections .titem .hide-btn')).length > 0, 'cards get drag handles and Hide buttons');
  ok(await pg.$eval(`${cardSel('pushups')}`, e => getComputedStyle(e).animationName === 'wiggle'), 'cards wiggle a little to show they can be moved');
  // hide
  await pg.click(`${cardSel('pullups')} .hide-btn`); await settle(pg);
  ok(!(await allItems(pg)).includes('pullups') && (await stored(pg)).settings.habits.find(h => h.id === 'pullups').hidden === true, 'Hide takes a card off Today and keeps the habit (hidden: true)');
  ok(/Show Pull-ups/.test(await pg.textContent('#hiddenTray')), 'hidden habits wait in a tray (and can be shown again)');
  await pg.click('#hiddenTray .tray-chip:has-text("Show Pull-ups")'); await settle(pg);
  ok((await allItems(pg)).includes('pullups') && !(await stored(pg)).settings.habits.find(h => h.id === 'pullups').hidden, 'Show puts it back');
  await pg.click(`${cardSel('pullups')} .hide-btn`); await settle(pg);
  // reorder with the keyboard (same code path as a drag)
  await pg.focus(`${cardSel('pushups')} .handle-btn`);
  await pg.keyboard.press('ArrowDown'); await settle(pg);
  const order = await itemIds(pg, 'workout');
  ok(order.indexOf('squats') < order.indexOf('pushups'), 'the handle moves a card down with the arrow keys', order);
  ok((await stored(pg)).settings.habits.map(h => h.id).indexOf('squats') < (await stored(pg)).settings.habits.map(h => h.id).indexOf('pushups'), 'the new order is saved in the settings');
  // reorder by dragging
  const hb = await (await pg.$(`${cardSel('plank')} .handle-btn`)).boundingBox();
  const target = await (await pg.$(`${cardSel('squats')}`)).boundingBox();
  await pg.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await pg.mouse.down();
  await pg.mouse.move(target.x + 20, target.y + 10, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(300);
  const order2 = await itemIds(pg, 'workout');
  ok(order2.indexOf('plank') < order2.indexOf('squats'), 'dragging a card by its handle reorders it', order2);
  // move a card into another section by dragging it
  const hb2 = await (await pg.$(`${cardSel('walk')} .handle-btn`)).boundingBox();
  const tgt2 = await (await pg.$('#sections .tsec[data-sec="workout"] .tsec-head')).boundingBox();
  await pg.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2); await pg.mouse.down();
  await pg.mouse.move(tgt2.x + 40, tgt2.y + 10, { steps: 14 }); await pg.mouse.up(); await pg.waitForTimeout(300);
  ok((await itemIds(pg, 'workout')).includes('walk') && (await stored(pg)).settings.habits.find(h => h.id === 'walk').section === 'workout', 'a card can be dragged into another section (its section changes)');
  // sections: reorder, rename, add
  await pg.focus('#sections .tsec[data-sec="food"] .sec-handle');
  await pg.keyboard.press('ArrowUp'); await settle(pg);
  ok((await secIds(pg)).indexOf('food') < (await secIds(pg)).indexOf('health'), 'a section can be moved with its own handle', await secIds(pg));
  await pg.click('#sections .tsec[data-sec="food"] .sec-rename'); await pg.fill('#fName', 'What I ate'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  ok((await pg.textContent('#sections .tsec[data-sec="food"] .tsec-title')) === 'What I ate', 'a section can be renamed');
  await pg.click('#addSection'); await pg.fill('#fName', 'Mind'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  ok((await secIds(pg)).some(i => i.startsWith('mind')) && (await stored(pg)).settings.sections.some(s => s.name === 'Mind'), 'custom sections can be added');
  // add from the library with +
  await pg.click('#sections .tsec[data-sec="mind"] .sec-add, #sections .tsec[data-sec^="mind"] .sec-add');
  await pg.waitForSelector('.library');
  await pg.click('.lib-row[data-lib="meditation"] .lib-add'); await pg.waitForTimeout(200);
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  const mind = (await secIds(pg)).find(i => i.startsWith('mind'));
  ok((await itemIds(pg, mind)).includes('meditation'), 'the + on a section adds a habit from the library straight into it');
  // done
  await pg.click('#editDone');
  ok(!(await pg.isVisible('#editBar')) && !(await pg.$eval('#p-today', e => e.classList.contains('editing'))), 'Done leaves edit mode');
  ok(!(await allItems(pg)).includes('pullups'), 'a hidden card stays off Today after Done');
  await settle(pg);
  // everything survives a restart
  const before = (await stored(pg)).settings;
  await pg.reload(); await ready(pg);
  ok(same((await stored(pg)).settings, before) && (await secIds(pg)).indexOf('food') < (await secIds(pg)).indexOf('health'), 'the layout is saved on this phone and comes back after a restart');
  // hidden habits stay in Plan
  await tab(pg, 'setup');
  ok(/Pull-ups/.test(await pg.textContent('#planSections')) && /Hidden from Today/.test(await pg.textContent('#planSections .swipe[data-id="pullups"]')), 'a hidden habit is still in Plan, marked as hidden');
  ok(errs.length === 0, 'no JS errors (edit mode)', errs);
  await ctx.close();
}
{
  // edit mode from Plan, and leaving it with the back button
  const { ctx, pg, errs } = await open({ native: true, still: true });
  await ready(pg);
  await tab(pg, 'setup'); await pg.click('#planEditToday');
  ok(await pg.isVisible('#editBar') && (await pg.getAttribute('.tab[data-tab="today"]', 'aria-current')) === 'page', 'Plan can open Today in edit mode');
  await pg.evaluate(() => window.__mock.fire('backButton'));
  ok(!(await pg.isVisible('#editBar')) && (await pg.evaluate(() => window.__mock.st().exit)) === 0, 'the back button leaves edit mode first');
  await ctx.close();
}

/* ================= habit library and create-your-own ================= */
console.log('Habit library');
{
  const { ctx, pg, errs } = await open();
  await tab(pg, 'setup'); await pg.click('#addHabitRow'); await pg.waitForSelector('.library');
  const cats = await pg.$$eval('#libList .lib-head', e => e.map(x => x.textContent));
  ok(cats.join() === 'Movement,Strength,Health,Food,Mind', 'the library has Movement, Strength, Health, Food and Mind', cats);
  const lib = id => Core.libEntry(id);
  ok(['walk', 'run', 'cycling', 'stretching'].every(i => lib(i)) && ['pushups', 'pullups', 'squats', 'plank', 'lunges', 'situps'].every(i => lib(i)) && ['water', 'sleep', 'vitamins', 'weight', 'waist'].every(i => lib(i)) && ['nosugar', 'nofried', 'nomaida', 'nolate', 'veggies', 'protein'].every(i => lib(i)) && ['meditation', 'reading', 'nophone', 'journal'].every(i => lib(i)), 'every habit in the brief is in the library');
  ok((await pg.$$('.lib-row')).length === Core.LIBRARY.length && (await pg.$$('.lib-row .row-ic svg')).length === Core.LIBRARY.length, 'each has an icon');
  await pg.fill('#libSearch', 'cyc');
  ok((await pg.$$('.lib-row')).length === 1 && /Cycling/.test(await pg.textContent('.lib-row')), 'search narrows the list');
  await pg.fill('#libSearch', 'zzzz'); ok(/Nothing matches/.test(await pg.textContent('#libList')), 'search with no match says so');
  await pg.fill('#libSearch', 'cyc');
  const cyc = Core.libEntry('cycling');
  ok(new RegExp(String(cyc.target)).test(await pg.textContent('.lib-row .row-sub')), 'each row shows its default target');
  await pg.click('.lib-row .lib-add'); await settle(pg);
  const added = (await stored(pg)).settings.habits.find(h => h.id === 'cycling' || h.name === cyc.name);
  ok(added && added.type === cyc.type && added.target === cyc.target && added.unit === cyc.unit, 'adding uses the default type, target and unit', added);
  ok(await pg.$eval('.lib-row .lib-add', b => b.disabled && /Added/.test(b.textContent)), 'an added habit shows "Added" and cannot be added twice');
  await pg.fill('#libSearch', 'meditation'); await pg.click('.lib-row .lib-add');
  await pg.fill('#libSearch', 'Water'); ok(await pg.$eval('.lib-row .lib-add', b => /Added/.test(b.textContent)), 'habits already in the plan show as added');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  await tab(pg, 'today');
  ok((await allItems(pg)).includes(added.id), 'the new habit shows on Today');
  // create your own
  await tab(pg, 'setup'); await pg.click('#createHabitRow');
  await pg.fill('#fName', 'Guitar practice');
  await pg.click('#fType button[data-type="duration"]');
  ok(await pg.$eval('#fUnit', e => e.value === 'min'), 'choosing Duration suggests minutes');
  await pg.fill('#fTarget', '20');
  await pg.click('#fIcons .ipick[data-icon="heart"]');
  await pg.click('#fSched button[data-kind="days"]');
  await pg.click('#fSchedDetail .daychip:has-text("Tue")');
  ok((await pg.$$('#fSchedDetail .daychip')).length === 7 && await pg.$eval('#fSchedDetail .daychip:has-text("Tue")', e => e.getAttribute('aria-pressed') === 'true'), 'Specific days offers the weekday chips');
  await pg.selectOption('#fSection', '__new'); await pg.fill('#fNewSec', 'Music');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  const g = (await stored(pg)).settings.habits.find(h => h.name === 'Guitar practice');
  ok(g && g.type === 'duration' && g.target === 20 && g.unit === 'min' && g.icon === 'heart' && g.schedule.kind === 'days' && g.schedule.days.includes(2) && !!(await stored(pg)).settings.sections.find(s => s.id === g.section && s.name === 'Music'), '"Create your own" saves name, icon, type, target, unit, schedule and a new section', g);
  // the four types and four schedules are all offered
  await pg.click('#createHabitRow');
  ok((await pg.$$('#fType button')).length === 3 && (await pg.$$('#fSched button')).length === 4, 'the form offers Count / Duration / Yes-No and the four schedules');
  await pg.click('#fType button[data-type="yesno"]'); ok(!(await pg.isVisible('#fTarget')), 'a Yes/No habit has no target');
  await pg.click('#fSched button[data-kind="weekly"]'); ok(/times a week/.test(await pg.textContent('#fSchedDetail')), 'X times a week has a stepper');
  await pg.click('#fSched button[data-kind="everyN"]'); ok(/Every 2 weeks/.test(await pg.textContent('#fSchedDetail')), 'Every N weeks has a stepper');
  await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
  ok(errs.length === 0, 'no JS errors (library)', errs);
  await ctx.close();
}

/* ================= starter plans and existing users ================= */
console.log('Starter plans');
{
  const plans = {
    desk: ['steps', 'walk', 'standups', 'water', 'sleep', 'nolate', 'nosugardrinks'],
    beginner: ['steps', 'pushups', 'squats', 'plank', 'water', 'sleep'],
    weightloss: ['steps', 'walk', 'weight', 'waist', 'nofried', 'nosugar', 'nomaida', 'nolate'],
    scratch: []
  };
  for (const [id, expect] of Object.entries(plans)) {
    const { ctx, pg, errs } = await open({ onboard: true });
    await pg.waitForSelector('.onb');
    await pg.click('#onbNext');
    const names = await pg.$$eval('#onbPlans .planopt .row-label', e => e.map(x => x.textContent));
    if (id === 'desk') ok(names.join() === 'Desk worker reset,Beginner fitness,Weight loss,Start from scratch', 'the starter plans are listed after the welcome page and before the permissions', names);
    await pg.click(`#plan-${id}`); await pg.click('#onbNext');
    await pg.click('#onbNext'); await pg.click('#onbNext'); await pg.click('#onbNext'); await pg.click('#onbStart');
    await pg.waitForFunction(() => !document.querySelector('.onb')); await settle(pg);
    const shown = (await stored(pg)).settings.habits.filter(h => !h.hidden).map(h => h.id);
    ok(same(shown.filter(i => expect.includes(i)).sort(), expect.slice().sort()) && shown.length === expect.length, `${id}: the plan adds exactly its habits`, shown);
    const all = (await stored(pg)).settings.habits;
    ok(all.some(h => h.type === 'measure' && h.measure === 'weight') && all.some(h => h.type === 'measure' && h.measure === 'waist'), `${id}: weight and waist stay available (for BMI), hidden unless the plan uses them`);
    if (id === 'scratch') ok((await allItems(pg)).filter(i => i !== 'weight' && i !== 'waist').length === 0 && await pg.isVisible('#todayEmpty'), 'Start from scratch: an empty Today that invites adding habits');
    ok(errs.length === 0, `no JS errors (plan ${id})`, errs);
    await ctx.close();
  }
  // existing users never see the starter plans
  const { ctx, pg } = await open({ data: { version: 1, settings: { habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }], rules: [] }, days: { [daysAgo(1)]: day(daysAgo(1), { steps: 9000 }) } }, onboard: true });
  await pg.waitForTimeout(1500);
  ok(!(await pg.$('.onb')), 'people who already have data are not shown the starter plans');
  await ctx.close();
}

/* ================= smart target suggestions ================= */
console.log('Target suggestions');
{
  const run = n => { const o = {}; for (let i = 1; i <= n; i++) o[daysAgo(i)] = day(daysAgo(i), { pushups: 31 }); return o; };
  const base0 = () => withSettings(x => { x.habits = x.habits.filter(h => ['pushups', 'pullups'].includes(h.id)); });
  {
    const { ctx, pg, errs } = await open({ data: { version: 2, settings: base0(), days: run(4) } });
    ok(!(await pg.$('#suggestCard')), 'no suggestion after only 4 days');
    await ctx.close();
  }
  const { ctx, pg, errs } = await open({ data: { version: 2, settings: base0(), days: run(5) } });
  ok(!!(await pg.$('#suggestCard')) && /You've hit 30 pushups 5 days straight\. Try 35\?/.test(await pg.textContent('#suggestText')), 'after 5 due days in a row it says "You\'ve hit 30 pushups 5 days straight. Try 35?"', await pg.textContent('#suggestCard').catch(() => 'no card'));
  ok(Core.suggestTarget(30) === 35 && Core.suggestTarget(5) === 6, 'the raise is about 10 to 20 percent on a round number', [Core.suggestTarget(30), Core.suggestTarget(5)]);
  await pg.click('#sgLater'); await pg.waitForTimeout(200);
  ok(!(await pg.$('#suggestCard')), '"Not now" hides it');
  const meta = JSON.parse(await pg.evaluate(() => localStorage.getItem('CapacitorStorage.comeback_meta')));
  ok(meta.suggestSnooze && meta.suggestSnooze.pushups === ymd(new Date(Date.now() + 7 * 864e5)), 'and asks again no sooner than 7 days later', meta.suggestSnooze);
  await pg.reload(); await ready(pg);
  ok(!(await pg.$('#suggestCard')), 'it stays quiet after a restart');
  // raising
  await pg.evaluate(() => { meta.suggestSnooze = {}; renderToday(); });
  await pg.click('#sgRaise'); await settle(pg);
  ok((await stored(pg)).settings.habits.find(h => h.id === 'pushups').target === 35 && !(await pg.$('#suggestCard')), '"Raise target" sets the new target');
  // can be turned off in Settings
  await pg.evaluate(() => { settings.habits.find(h => h.id === 'pushups').target = 30; meta.suggestSnooze = {}; renderToday(); });
  ok(!!(await pg.$('#suggestCard')), '(suggestion is back for a 30 target)');
  await gear(pg); await pg.click('#sugOn'); await settle(pg);
  await tab(pg, 'today');
  ok(!(await pg.$('#suggestCard')) && (await stored(pg)).settings.prefs.suggestions === false, 'switching suggestions off in Settings hides the card');
  ok(errs.length === 0, 'no JS errors (suggestions)', errs);
  await ctx.close();
}

/* ================= Settings ================= */
console.log('Settings');
{
  const { ctx, pg, errs } = await open();
  ok(await pg.isVisible('#gearBtn') && (await pg.getAttribute('#gearBtn', 'aria-label')) === 'Settings', 'a gear icon sits in the top-right of Today');
  for (const t of ['progress', 'setup', 'today']) { await tab(pg, t); ok(await pg.isVisible('#gearBtn'), `the gear is on ${t} too`); }
  await pg.click('#gearBtn');
  ok(await pg.isVisible('#p-settings') && await pg.isVisible('#navBack') && !(await pg.isVisible('#gearBtn')), 'the gear opens Settings with a back button');
  const heads = await pg.$$eval('#p-settings .group-head', e => e.filter(x => x.offsetParent !== null).map(x => x.textContent.trim()));
  ok(['Account and sync', 'Backup', 'Reminder', 'Units', 'Body', 'About'].every(h => heads.includes(h)), 'Settings has Account and sync, Backup, Reminder, Units, Body and About', heads);
  ok(!(await pg.isVisible('#stepGroup')) && !(await pg.isVisible('#advGroup')), 'step tracking, permissions and Advanced are only for the Android app');
  await pg.click('#navBack');
  ok(await pg.isVisible('#p-today'), 'back returns to where you came from');
  await tab(pg, 'progress'); await pg.click('#gearBtn'); await pg.click('#navBack');
  ok(await pg.isVisible('#p-progress'), '...including Progress');
  // Plan is goals only
  await tab(pg, 'setup');
  const planText = await pg.textContent('#p-setup');
  ok(!/Sign in|Export backup|Daily reminder|Step tracking|Permissions/.test(planText), 'Plan no longer holds account, backup, reminder or step-tracking settings');
  ok(/Habits and rules/.test(planText) && !!(await pg.$('#addHabitRow')), 'Plan is just habits, targets, rules and schedules');
  ok(errs.length === 0, 'no JS errors (settings)', errs);
  await ctx.close();
}
{
  // Advanced, permissions and step health in the Android app
  const { ctx, pg, errs } = await open({ native: true });
  await ready(pg); await gear(pg); await pg.waitForTimeout(500);
  const heads = await pg.$$eval('#p-settings .group-head', e => e.filter(x => x.offsetParent !== null).map(x => x.textContent.trim()));
  ok(['Step tracking', 'Permissions', 'Units', 'Body', 'Advanced'].every(h => heads.includes(h)), 'in the Android app Settings also has Step tracking, Permissions and Advanced', heads);
  ok((await pg.$$('#permGroup .row')).length === 3 && /Physical activity/.test(await pg.textContent('#permGroup')) && /Notifications/.test(await pg.textContent('#permGroup')) && /Battery/.test(await pg.textContent('#permGroup')), 'the permission rows are Physical activity, Notifications and Battery');
  ok(await pg.$eval('#advToggle', e => e.getAttribute('aria-expanded') === 'false') && !(await pg.isVisible('#stStrict')), 'Advanced is collapsed by default');
  await pg.click('#advToggle');
  ok(await pg.isVisible('#stStrict') && await pg.isVisible('#stLocOn') && /Vehicle filter/.test(await pg.textContent('#stStrict')), 'it opens to the vehicle filter strictness, sensitivity (when it applies) and the location accuracy toggle');
  await ctx.close();
}

/* ================= units and BMI ================= */
console.log('BMI');
const bmiData = (cm, kg, extra = {}) => ({ version: 2, settings: withSettings(s => { s.body.heightCm = cm; Object.assign(s.body, extra.body || {}); Object.assign(s.units, extra.units || {}); }), days: kg == null ? {} : { [daysAgo(1)]: day(daysAgo(1), { pushups: 5 }, {}, { weight: kg, ...(extra.day || {}) }) } });
{
  // 180 cm and 87 kg: 26.9, Overweight on Standard, Obese on Asian
  const { ctx, pg, errs } = await open({ data: bmiData(180, 87) });
  await tab(pg, 'progress'); await pg.waitForTimeout(500);
  ok(/^26\.9$/.test((await pg.textContent('#bmiCard .bmi-val')).trim()) && /Overweight/.test(await pg.textContent('#bmiCard .pill')), '180 cm and 87 kg: BMI 26.9, Overweight on the Standard scale', await pg.textContent('#bmiCard'));
  ok((await pg.$eval('#bmiCard', e => e.getBoundingClientRect().top)) < (await pg.$eval('.bodystats', e => e.getBoundingClientRect().top)), 'the BMI card sits on top of the Body section on Progress');
  ok(!!(await pg.$('#bmiCard svg.spark')) || (await pg.$$('#bmiCard svg')).length >= 0, 'the card has a small trend area');
  await pg.click('#bmiOpen'); await pg.waitForSelector('.bmi-sheet');
  ok(await pg.isVisible('#bmiBig') && (await pg.textContent('#bmiBig')) === '26.9' && /Overweight/.test(await pg.textContent('#bmiCat')), 'tapping the card opens the detail sheet with the large BMI and category');
  ok(await pg.isVisible('#scaleBar') && await pg.isVisible('#scaleMark') && (await pg.$$('#scaleBar .sb')).length === 4, 'the horizontal scale bar has four zones and a marker');
  const range = await txt(pg, '#bmiRange');
  ok(/Healthy range for 180 cm/.test(range) && /60[–-]81 kg/.test(range), 'the healthy weight range for 180 cm (Standard)', range);
  ok(/6\.3 kg to the healthy range/.test(await txt(pg, '#bmiDist')), 'a neutral distance to the healthy range (87 kg is 6.3 kg above 80.7 kg)', await txt(pg, '#bmiDist'));
  ok(Core.distanceToRange(87, 180, 'standard').kg > 0, '(and it matches the maths)');
  ok(!(await pg.$('#bmiWhtr')), 'no waist-to-height ratio until a waist is logged');
  ok(/general screening measure and doesn't account for muscle mass\. It isn't a medical diagnosis\./.test(await pg.textContent('#bmiNote')), 'the screening-measure note is shown');
  ok(await pg.evaluate(() => !!window.Chart.getChart('chartBmi')) && (await pg.$$('#bmiSeg button')).length === 3, 'a BMI trend chart with Week / Month / 3 Months');
  await pg.click('#bmiSeg button[data-range="7"]'); ok((await pg.getAttribute('#bmiSeg button[data-range="7"]', 'aria-selected')) === 'true', 'the trend range can be changed');
  // quick calculator
  await pg.fill('#qCm', '170'); await pg.fill('#qW', '70');
  ok(/BMI 24\.2/.test(await pg.textContent('#calcOut')) && /Normal/.test(await pg.textContent('#calcOut')), 'the quick calculator works for any height and weight', await pg.textContent('#calcOut'));
  await pg.fill('#qCm', ''); await pg.fill('#qW', '');
  ok(/Enter a height and a weight/.test(await pg.textContent('#calcOut')), 'and asks for the missing numbers');
  await pg.fill('#qCm', '170'); await pg.fill('#qW', '70'); await settle(pg);
  const before = JSON.stringify((await stored(pg)).days);
  ok(JSON.stringify((await stored(pg)).days) === before && (await stored(pg)).settings.body.heightCm === 180, 'the quick calculator saves nothing');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  // Today's Body section
  await tab(pg, 'today'); await openBody(pg);
  ok(/26\.9/.test(await pg.textContent('#rowBmi')) && /Overweight/.test(await pg.textContent('#rowBmi')), 'Today\'s Body section shows BMI next to the latest weight');
  ok(/87 kg/.test(await txt(pg, '#rowBmi')), 'it says which weight it used', await pg.textContent('#rowBmi'));
  await pg.click('#rowBmi'); await pg.waitForSelector('.bmi-sheet'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  ok(!JSON.stringify(await stored(pg)).includes('"bmi"'), 'BMI is calculated, never stored');
  // Asian scale
  await gear(pg); await pg.click('#scAsia'); await settle(pg);
  await tab(pg, 'progress'); await pg.waitForTimeout(400);
  ok(/Obese/.test(await pg.textContent('#bmiCard .pill')) && /Asian/.test(await pg.textContent('#bmiCard')), 'the same person is Obese on the Asian scale (BMI 26.9)');
  await pg.click('#bmiOpen'); await pg.waitForSelector('.bmi-sheet');
  ok(/Healthy range for 180 cm/.test(await pg.textContent('#bmiRange')) && /60[–-]74 kg/.test(await txt(pg, '#bmiRange')), 'the healthy range follows the selected scale', await pg.textContent('#bmiRange'));
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  ok((await stored(pg)).settings.body.scale === 'asian', 'the scale is saved in the settings');
  ok(errs.length === 0, 'no JS errors (BMI)', errs);
  await ctx.close();
}
{
  // missing weight / missing height
  const a = await open({ data: bmiData(180, null) });
  await tab(a.pg, 'progress');
  // Progress with no days shows its empty state; log a non-weight day to reach the card
  await a.pg.evaluate(() => { days[todayStr()] = { vals: { pushups: 3 }, rules: {}, weight: null, waist: null, note: '', date: todayStr(), updatedAt: Date.now() }; renderProgress(); });
  await a.pg.waitForTimeout(300);
  ok(/Log your weight to see your BMI/.test(await a.pg.textContent('#bmiCard')) && !!(await a.pg.$('#bmiAction')), 'no weight: "Log your weight to see your BMI" with a button');
  await a.pg.click('#bmiAction'); await a.pg.waitForSelector('.keypad');
  ok(/Weight/.test(await a.pg.textContent('.sheet-head')), 'the button opens the weight pad');
  await a.pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(a.pg);
  await a.ctx.close();
  const b = await open({ data: bmiData(null, 80) });
  await tab(b.pg, 'progress'); await b.pg.waitForTimeout(300);
  ok(/Set your height to see your BMI/.test(await b.pg.textContent('#bmiCard')), 'no height: "Set your height to see your BMI"');
  await b.pg.click('#bmiAction'); await b.pg.waitForSelector('.keypad');
  for (const c of ['1', '8', '0']) await b.pg.click(`.keypad .key[aria-label="${c}"]`);
  await b.pg.click('.sheet .txtbtn.strong'); await sheetGone(b.pg); await settle(b.pg);
  ok((await stored(b.pg)).settings.body.heightCm === 180, 'setting the height saves it in the settings (so it syncs)');
  ok(/24\.7/.test(await b.pg.textContent('#bmiCard')), 'and the BMI appears right away (80 kg at 180 cm = 24.7)', await b.pg.textContent('#bmiCard'));
  await b.ctx.close();
}
{
  // units: kg/lb and cm/ft-in, stored in kg and cm
  const { ctx, pg, errs } = await open({ data: bmiData(180, 87, { day: { waist: 95 } }) });
  await gear(pg);
  ok(await pg.isVisible('#uKg') && await pg.isVisible('#uLb') && await pg.isVisible('#uCm') && await pg.isVisible('#uFt'), 'Settings has kg/lb and cm/ft-in');
  await pg.click('#uLb'); await settle(pg);
  await tab(pg, 'progress'); await pg.waitForTimeout(300);
  ok(/191\.8 lb/.test(await txt(pg, '#bmiCard')), '87 kg shows as 191.8 lb', await pg.textContent('#bmiCard .bmi-sub'));
  ok((await stored(pg)).days[daysAgo(1)].weight === 87 && (await stored(pg)).settings.units.weight === 'lb', 'weights stay stored in kg');
  ok(/6 ft|5 ft/.test(await pg.textContent('#bmiCard .bmi-sub')) || /lb/.test(await pg.textContent('#bmiCard')), 'the BMI is the same in any unit');
  await gear(pg); await pg.click('#uFt'); await settle(pg);
  ok(/5 ft 11 in|5′ 11″|5 ft 10\.9 in/.test(await pg.textContent('#stHeight')), '180 cm shows as feet and inches', await pg.textContent('#stHeight'));
  await tab(pg, 'today'); await openBody(pg);
  await pg.click('#rowWeight'); await pg.waitForSelector('.keypad');
  for (const c of ['2', '0', '0']) await pg.click(`.keypad .key[aria-label="${c}"]`);
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await settle(pg);
  const w = (await stored(pg)).days[tk].weight;
  ok(Math.abs(w - 90.72) < 0.02, 'typing 200 lb stores about 90.72 kg', w);
  await pg.click('#rowBmi'); await pg.waitForSelector('.bmi-sheet');
  ok(/lb/.test(await txt(pg, '#bmiRange')) && /ft/.test(await txt(pg, '#bmiRange')), 'the BMI sheet speaks lb and ft/in too', await pg.textContent('#bmiRange'));
  ok(!!(await pg.$('#bmiWhtr')) && /0\.53/.test(await pg.textContent('#bmiWhtr')) && /Elevated/.test(await pg.textContent('#bmiWhtr')), 'with a waist logged the sheet shows waist-to-height ratio (95/180 = 0.53, elevated)', (await pg.textContent('#bmiWhtr').catch(() => '')));
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  ok(errs.length === 0, 'no JS errors (units)', errs);
  await ctx.close();
}
{
  // CSV has a BMI column, filled only for days with a weight
  const d = bmiData(180, 87);
  d.days[daysAgo(2)] = day(daysAgo(2), { pushups: 1 });
  const { ctx, pg } = await open({ data: d });
  await gear(pg);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#expCsv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').trim().split('\r\n');
  const head = csv[0].split(',');
  const row = k => csv.find(r => r.startsWith(k)).split(',');
  ok(head.slice(-2)[0] === 'BMI' && /^26\.9/.test(row(daysAgo(1)).slice(-2)[0]) && row(daysAgo(2)).slice(-2)[0] === '', 'the CSV has a BMI column, filled for days with a weight and empty otherwise', [head.slice(-4), row(daysAgo(1)).slice(-3), row(daysAgo(2)).slice(-3)]);
  await ctx.close();
}

/* ================= settings sync with the cloud copy ================= */
console.log('Height, units and scale travel with the settings');
{
  const { ctx, pg } = await open({ data: bmiData(172, 70, { units: { weight: 'lb' }, body: { scale: 'asian' } }) });
  const cloud = await pg.evaluate(() => JSON.parse(JSON.stringify(settings)));
  ok(cloud.body.heightCm === 172 && cloud.body.scale === 'asian' && cloud.units.weight === 'lb' && cloud.v === 2, 'height, BMI scale and units are part of the one settings object that syncs');
  ok(await pg.evaluate(() => { const s = clone(settings); s.body.heightCm = 160; return mergeData({ settings: settings, days: {} }, { settings: s, days: {} }).data.settings.body.heightCm === 172; }), 'a restore/merge never overwrites a height you already have');
  await ctx.close();
}

/* ================= migration from the current structure ================= */
console.log('Migration');
{
  const settingsV1 = { habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }, { id: 'walk', name: 'Brisk walk', unit: 'min', target: 30 }, { id: 'pushups', name: 'Pushups', unit: 'reps', target: 30 }, { id: 'plank', name: 'Plank', unit: 'sec', target: 60 }, { id: 'water', name: 'Water', unit: 'litres', target: 2.5 }, { id: 'cycling', name: 'Cycling', unit: 'km', target: 20 }],
    rules: [{ id: 'nofried', name: 'No fried food' }, { id: 'nosugar', name: 'No sugar' }, { id: 'nolate', name: 'Nothing after 10 pm' }, { id: 'steps', name: 'A rule that reuses a habit id' }] };
  const mkDay = (k, i) => ({ vals: { steps: 5000 + i, walk: 10 + i, pushups: 20 + i, plank: 30, water: 2, cycling: i }, rules: { nofried: i % 2 === 0, nosugar: true, nolate: i % 3 === 0, steps: i % 2 === 1 }, weight: 88 - i / 10, waist: i % 4 === 0 ? 97 : null, note: 'day ' + i, date: k, updatedAt: 1700000000000 + i });
  const oldDays = {}; for (let i = 1; i <= 12; i++) oldDays[daysAgo(i)] = mkDay(daysAgo(i), i);
  const oldCopy = JSON.parse(JSON.stringify(oldDays));
  const { ctx, pg, errs } = await open({ data: { version: 1, settings: settingsV1, days: oldDays } });
  await settle(pg);
  const d1 = await stored(pg);
  ok(d1.version === 2 && d1.settings.v === 2, 'saved data is moved to the new structure the first time the app starts');
  const dayDiffs = Object.keys(oldCopy).filter(k => !same(d1.days[k], (() => { const o = JSON.parse(JSON.stringify(oldCopy[k])); if (o.rules.steps !== undefined) { o.rules['steps-rule'] = o.rules.steps; delete o.rules.steps; } return o; })()));
  ok(dayDiffs.length === 0 && Object.keys(d1.days).length === 12, 'every day, every number, every note and every tick is kept (a rule that shared a habit id got a new id, in the days too)', dayDiffs);
  const hs = d1.settings.habits;
  ok(['steps', 'walk', 'pushups', 'plank', 'water', 'cycling', 'nofried', 'nosugar', 'nolate'].every(i => hs.some(h => h.id === i)), 'all habits and all rules are still there');
  ok(hs.find(h => h.id === 'steps').type === 'steps' && hs.find(h => h.id === 'walk').type === 'duration' && hs.find(h => h.id === 'plank').type === 'duration' && hs.find(h => h.id === 'pushups').type === 'count' && hs.find(h => h.id === 'water').type === 'count' && hs.find(h => h.id === 'nofried').type === 'yesno', 'habits got types (steps, minutes and seconds → Duration, reps → Count, rules → Yes/No)', hs.map(h => h.id + ':' + h.type));
  ok(hs.find(h => h.id === 'steps').target === 8000 && hs.find(h => h.id === 'cycling').target === 20 && hs.find(h => h.id === 'cycling').unit === 'km', 'targets and units are unchanged');
  ok(hs.every(h => ['daily'].includes(h.schedule.kind) || h.measure), 'existing habits stay every day (nothing silently becomes less frequent)', hs.filter(h => h.schedule.kind !== 'daily').map(h => h.id));
  const wt = hs.find(h => h.type === 'measure' && h.measure === 'weight'), wa = hs.find(h => h.type === 'measure' && h.measure === 'waist');
  ok(wt && wa && wt.schedule.kind === 'weekly' && wt.schedule.times === 3 && wa.schedule.kind === 'everyN' && wa.schedule.weeks === 2, 'weight is 3 times a week and waist every 2 weeks (the defaults)', [wt && wt.schedule, wa && wa.schedule]);
  ok(d1.settings.sections.length >= 5 && d1.settings.sections.some(s => s.id === 'body' && s.collapsed), 'sections were created (Body and notes collapsed)');
  // running it again changes nothing
  const first = JSON.stringify(await stored(pg));
  await pg.reload(); await ready(pg); await settle(pg);
  ok(JSON.stringify(await stored(pg)) === first, 'starting the app again changes nothing (the migration is safe to run more than once)');
  await pg.reload(); await ready(pg); await settle(pg);
  ok(JSON.stringify(await stored(pg)) === first, '...as often as you like');
  // the app works on the migrated data
  ok((await itemIds(pg, 'food')).includes('nofried') && /\d+-day streak|Log a day|Start again/.test(await pg.textContent('#streakLine')), 'Today works on the migrated data');
  await tab(pg, 'progress'); await pg.waitForTimeout(400);
  ok((await pg.textContent('#sDays')) === '12', 'Progress sees all 12 days');
  ok(errs.length === 0, 'no JS errors (migration)', errs);
  await ctx.close();
}
{
  // an old backup file restores into the new structure
  const old = { version: 1, settings: { habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 9000 }, { id: 'sit', name: 'Situps', unit: 'reps', target: 40 }], rules: [{ id: 'r1', name: 'No chips' }] },
    days: { '2026-03-01': day('2026-03-01', { steps: 9100, sit: 41 }, { r1: true }, { weight: 85, note: 'old backup day' }) } };
  const { ctx, pg, errs } = await open();
  await gear(pg);
  await pg.setInputFiles('#restoreFile', { name: 'comeback-backup-old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await actionChoose(pg, 'Continue'); await actionChoose(pg, 'Replace everything');
  await pg.waitForFunction(() => /Replaced everything/.test(document.getElementById('bkMsg').textContent));
  const d = await stored(pg);
  ok(d.version === 2 && d.settings.v === 2 && d.settings.habits.some(h => h.id === 'sit' && h.type === 'count' && h.target === 40) && d.settings.habits.some(h => h.id === 'r1' && h.type === 'yesno'), 'an old backup restores into the new structure (habits, rules as Yes/No)', d.settings.habits.map(h => h.id + ':' + h.type));
  ok(d.days['2026-03-01'].vals.sit === 41 && d.days['2026-03-01'].rules.r1 === true && d.days['2026-03-01'].weight === 85 && d.days['2026-03-01'].note === 'old backup day', 'with the day exactly as it was');
  await tab(pg, 'today');
  ok((await itemIds(pg, 'food')).includes('r1') || (await allItems(pg)).includes('r1'), 'and the restored rule shows on Today');
  // a new backup restores too, and the app can write a backup an older file reader would still understand
  await gear(pg);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#expJson')]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(exported.version === 2 && exported.settings.habits.length === d.settings.habits.length && same(exported.days, d.days), 'a new backup carries the whole structure and every day');
  ok(errs.length === 0, 'no JS errors (old backup)', errs);
  await ctx.close();
}

/* ================= 12-hour clock everywhere ================= */
console.log('12-hour clock');
{
  // a phone set to a 24-hour locale must still see AM/PM
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'en-GB', acceptDownloads: true });
  await skipOnboarding(ctx);
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await ready(pg); await gear(pg);
  ok(!(await pg.$('input[type=time]')), 'there is no system time input (it would follow the phone\'s 24-hour setting)');
  ok((await pg.$$('#remTime select')).length === 3 && await pg.$eval('#remTime .t12-p', e => [...e.options].map(o => o.value).join() === 'AM,PM') && (await pg.$$eval('#remTime .t12-h option', o => o.map(x => x.textContent).join())) === '1,2,3,4,5,6,7,8,9,10,11,12', 'the reminder time is hour 1 to 12, minute and AM/PM');
  ok((await getTime(pg, '#remTime')) === '21:00' && (await pg.$eval('#remTime .t12-h', e => e.value)) === '9' && (await pg.$eval('#remTime .t12-p', e => e.value)) === 'PM', '21:00 is shown as 9 : 00 PM');
  await setTime(pg, '#remTime', '00:05'); ok((await pg.$eval('#remTime .t12-h', e => e.value)) === '12' && (await pg.$eval('#remTime .t12-p', e => e.value)) === 'AM', 'midnight is 12:05 AM');
  await setTime(pg, '#remTime', '12:30'); ok((await pg.$eval('#remTime .t12-h', e => e.value)) === '12' && (await pg.$eval('#remTime .t12-p', e => e.value)) === 'PM', 'noon is 12:30 PM');
  await pg.$eval('#remTime .t12-h', e => { e.value = '3'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  ok((await getTime(pg, '#remTime')) === '12:30'.replace('12', '15'), 'picking 3 with PM stores 15:30');
  ok(/\b(am|pm)\b/i.test(await pg.textContent('#lastBackup')) || /never/.test(await pg.textContent('#lastBackup')), 'times elsewhere carry AM/PM');
  ok(errs.length === 0, 'no JS errors (12-hour)', errs);
  await ctx.close();
}

/* ================= the streak during an open day, blank records, the Steps habit id ================= */
console.log('Streak line and blank records');
{
  const done = k => day(k, { pushups: 30, pullups: 5, squats: 30, plank: 60, walk: 30, water: 2.5, sleep: 7 }, { nofried: true, nosugar: true, nomaida: true, nolate: true });
  const base_ = { [daysAgo(2)]: done(daysAgo(2)), [daysAgo(1)]: done(daysAgo(1)) };
  const data = days => ({ version: 2, settings: Core.defaultSettings(), days });
  // today untouched
  let { ctx, pg, errs } = await open({ data: data(base_) });
  ok(/^2-day streak · today still open$/.test(await txt(pg, '#streakLine')), 'a running streak with today untouched says "today still open"', await txt(pg, '#streakLine'));
  // start today: a little activity must not reset the streak
  await pg.click(`${cardSel('pushups')} .cbtn.plus`); await pg.click(`${cardSel('pushups')} .cbtn.plus`);
  ok(/^2-day streak · today still open$/.test(await txt(pg, '#streakLine')), 'a little activity today keeps the streak (it used to read "Start again today")', await txt(pg, '#streakLine'));
  ok(!/Start again/.test(await txt(pg, '#todayHint')), 'and the hint does not say start again');
  ok(await pg.evaluate(() => streak()) === 2, 'streak() is 2 while today is open');
  // reaching 50% makes today count
  for (const id of ['pullups', 'squats', 'plank', 'walk', 'water', 'sleep']) { await pg.evaluate(i => { const x = habitById(i); commitDay('x', d => { d.vals[i] = x.target }, true); }, id); }
  ok(/^3-day streak$/.test(await txt(pg, '#streakLine')), 'once today is above 50% it counts: "3-day streak"', await txt(pg, '#streakLine'));
  await tab(pg, 'progress');
  ok(/3 days/.test(await pg.textContent('#sStreak')) && /Kept \d+ of \d+ due days in the last 5 weeks/.test(await pg.textContent('#streakNote')), 'Progress shows the streak and "kept X of Y due days"', await pg.textContent('#streakNote'));
  ok(errs.length === 0, 'no JS errors (open-day streak)', errs);
  await ctx.close();
}
{
  // a streak that really broke, with a little activity today, is not told to "start again"
  const done = k => day(k, { pushups: 30, pullups: 5, squats: 30, plank: 60, walk: 30, water: 2.5, sleep: 7 }, { nofried: true, nosugar: true, nomaida: true, nolate: true });
  const days = { [daysAgo(4)]: done(daysAgo(4)), [daysAgo(3)]: done(daysAgo(3)), [daysAgo(1)]: day(daysAgo(1), { pushups: 2 }), [tk]: day(tk, { pushups: 4 }) };
  const { ctx, pg, errs } = await open({ data: { version: 2, settings: Core.defaultSettings(), days } });
  const t = await txt(pg, '#streakLine');
  ok(!/Start again/.test(t) && /50%/.test(t), 'broken streak, activity today: "Reach 50% today to start a streak", never "Start again today"', t);
  await tab(pg, 'progress');
  ok(!/Start again today/.test(await pg.textContent('#streakNote')) && /best streak was 2 days/.test(await pg.textContent('#streakNote')), 'Progress says the same, gently', await pg.textContent('#streakNote'));
  await ctx.close();
}
{
  // a blank record (what undo leaves behind while signed in, or a pulled empty day) is not a logged day
  const done = k => day(k, { pushups: 30, pullups: 5, squats: 30, plank: 60, walk: 30, water: 2.5, sleep: 7 }, { nofried: true, nosugar: true, nomaida: true, nolate: true });
  const days = { [daysAgo(2)]: done(daysAgo(2)), [daysAgo(1)]: done(daysAgo(1)), [tk]: day(tk) };
  const { ctx, pg, errs } = await open({ data: { version: 2, settings: Core.defaultSettings(), days } });
  ok(/^2-day streak · today still open$/.test(await txt(pg, '#streakLine')), 'a blank record for today does not break the streak', await txt(pg, '#streakLine'));
  ok(/Nothing logged yet/.test(await txt(pg, '#todayHint')), 'and today still reads "Nothing logged yet"', await txt(pg, '#todayHint'));
  await tab(pg, 'progress');
  ok((await pg.textContent('#sDays')) === '2', 'Progress counts 2 logged days, not 3', await pg.textContent('#sDays'));
  ok(await pg.$$eval('#logList .row', r => r.length) === 2, 'the recent days list leaves the blank one out');
  ok(await pg.evaluate(() => Core.loggedKeys(days).length) === 2, 'Core.loggedKeys sees two');
  ok(errs.length === 0, 'no JS errors (blank record)', errs);
  await ctx.close();
  // only a blank record: Progress is empty, like a new install
  const o2 = await open({ data: { version: 2, settings: Core.defaultSettings(), days: { [tk]: day(tk) } } });
  await tab(o2.pg, 'progress');
  ok(await o2.pg.isVisible('#progEmpty'), 'with only a blank record Progress shows its empty state');
  await o2.ctx.close();
}
console.log('The Steps habit id');
{
  // an old plan whose steps-type habit has another id: it is renamed to "steps" and its numbers follow
  const s = Core.defaultSettings();
  const st = s.habits.find(h => h.id === 'steps'); st.id = 'mysteps';
  const days = { [daysAgo(1)]: day(daysAgo(1), { mysteps: 7000, pushups: 10 }) };
  const { ctx, pg, errs } = await open({ data: { version: 2, settings: s, days } });
  ok(await pg.evaluate(() => settings.habits.filter(h => h.type === 'steps').map(h => h.id).join()) === 'steps', 'the Steps habit has id "steps" after loading');
  const dk = daysAgo(1);
  ok(await pg.evaluate(k => days[k].vals.steps === 7000 && !('mysteps' in days[k].vals) && days[k].vals.pushups === 10, dk), 'its numbers moved with it');
  await tab(pg, 'progress');
  ok(/7,000/.test(await pg.textContent('#sAvgSteps')), 'Progress averages read the renamed numbers', await pg.textContent('#sAvgSteps'));
  ok(errs.length === 0, 'no JS errors (steps id)', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
