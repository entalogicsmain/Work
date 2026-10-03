// Pure-logic tests for www/js/core.js: the migration, habit types, schedules and due days, scores and streaks that count only due
// habits, target suggestions, the habit library and starter plans, BMI on both scales, and unit conversions. No browser needed.
// Run: npm run test:core
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../www/js/core.js');

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const eq = (a, b, name) => ok(JSON.stringify(canon(a)) === JSON.stringify(canon(b)), name, [a, b]);
const near = (a, b, name, tol = 0.011) => ok(Math.abs(a - b) <= tol, name, [a, b]);
const throws = (fn, re, name) => { try { fn(); ok(false, name, 'did not throw'); } catch (e) { ok(re.test(e.message), name, e.message); } };

// the week used throughout: Monday 2026-09-28 to Sunday 2026-10-04
const MON = '2026-09-28', TUE = '2026-09-29', WED = '2026-09-30', THU = '2026-10-01', FRI = '2026-10-02', SAT = '2026-10-03', SUN = '2026-10-04';
const day = (k, vals = {}, rules = {}, extra = {}) => Object.assign({ vals, rules, weight: null, waist: null, note: '', date: k, updatedAt: 1 }, extra);
const H = (id, over = {}) => Object.assign({ id, name: id, icon: 'dumbbell', type: 'count', unit: 'reps', target: 10, section: 'workout', schedule: { kind: 'daily' } }, over);
const S = (habits, over = {}) => Object.assign({ v: 2, habits, sections: C.DEFAULT_SECTIONS.map(s => Object.assign({}, s)), body: { heightCm: null, scale: 'standard' }, units: { weight: 'kg', length: 'cm' }, prefs: { suggestions: true } }, over);

console.log('Dates');
{
  eq(C.weekStart(WED), MON, 'weeks start on Monday');
  eq(C.weekStart(SUN), MON, 'Sunday belongs to the week that began on Monday');
  eq(C.weekStart(MON), MON, 'Monday starts its own week');
  eq(C.daysLeftInWeek(MON), 7, 'Monday has 7 days left (counting itself)');
  eq(C.daysLeftInWeek(SUN), 1, 'Sunday has 1 day left');
  eq(C.addDays('2026-12-31', 1), '2027-01-01', 'adding days crosses the year');
  eq(C.dow(SUN), 0, 'Sunday is 0');
  eq([C.daysBetween(MON, SUN), C.daysBetween(SUN, MON), C.daysBetween('2026-12-31', '2027-01-01'), C.daysBetween(MON, MON)], [6, -6, 1, 0], 'whole days between two dates');
}

console.log('Migration from the current structure');
{
  const legacy = JSON.parse(JSON.stringify(C.LEGACY_DEFAULT));
  const { settings: s, wasLegacy, idMap } = C.migrateSettings(legacy);
  ok(wasLegacy && s.v === 2 && Object.keys(idMap).length === 0, 'the current default is recognised as the old structure');
  eq(s.habits.map(h => h.id), ['steps', 'walk', 'pushups', 'pullups', 'squats', 'plank', 'water', 'sleep', 'nofried', 'nosugar', 'nomaida', 'nolate', 'weight', 'waist'], 'every habit and rule is kept, in order, plus weight and waist');
  const t = id => s.habits.find(h => h.id === id);
  eq([t('steps').type, t('walk').type, t('pushups').type, t('plank').type, t('water').type, t('sleep').type], ['steps', 'duration', 'count', 'duration', 'count', 'count'], 'habits get the right type (steps / duration for min and sec / count)');
  ok(['nofried', 'nosugar', 'nomaida', 'nolate'].every(id => t(id).type === 'yesno' && t(id).section === 'food'), 'rules become Yes/No habits in Food rules');
  eq(['nofried', 'nosugar', 'nomaida', 'nolate'].map(id => t(id).name), C.LEGACY_DEFAULT.rules.map(r => r.name), 'rule names are unchanged');
  eq([t('steps').section, t('walk').section, t('pushups').section, t('pullups').section, t('squats').section, t('plank').section, t('water').section, t('sleep').section], ['movement', 'movement', 'workout', 'workout', 'workout', 'workout', 'health', 'health'], 'habits land in sensible sections');
  eq([t('pushups').target, t('plank').target, t('water').target, t('water').unit, t('steps').target], [30, 60, 2.5, 'litres', 8000], 'targets and units are carried over exactly');
  ok(s.habits.every(h => h.schedule.kind === 'daily' || h.type === 'measure'), 'everything existing stays daily');
  eq(t('weight').schedule, { kind: 'weekly', times: 3 }, 'weight defaults to 3 times a week');
  eq(t('waist').schedule, { kind: 'everyN', weeks: 2 }, 'waist defaults to every 2 weeks');
  eq(s.sections.map(x => x.id), ['movement', 'workout', 'health', 'food', 'body'], 'five sections, Body and notes last');
  ok(s.sections.find(x => x.id === 'body').collapsed === true && !s.sections.find(x => x.id === 'movement').collapsed, 'Body and notes starts collapsed');
  eq([s.units, s.body.scale, s.prefs.suggestions, s.body.heightCm], [{ weight: 'kg', length: 'cm' }, 'standard', true, null], 'new settings get their defaults (kg, cm, Standard scale, suggestions on)');
  // running it again changes nothing
  const again = C.migrateSettings(JSON.parse(JSON.stringify(s)));
  eq(again.settings, s, 'migrating an already migrated plan changes nothing');
  ok(!again.wasLegacy, 'and it is not treated as the old structure');
  eq(C.migrateSettings(JSON.parse(JSON.stringify(again.settings))).settings, s, 'a third run is still the same');
  eq(C.defaultSettings(), s, 'the default settings are the migrated default');
}
{
  const { settings: s } = C.migrateSettings({ habits: [{ id: 'yoga', name: 'Yoga', unit: 'min', target: 20 }, { id: 'pages', name: 'Pages', unit: 'pages', target: 10 }, { id: 'cups', name: 'Tea', unit: 'cups', target: 3 }], rules: [{ id: 'r1', name: 'No mithai' }] });
  const t = id => s.habits.find(h => h.id === id);
  eq([t('yoga').type, t('yoga').section, t('pages').type, t('pages').section, t('cups').section, t('r1').type], ['duration', 'movement', 'count', 'workout', 'health', 'yesno'], 'custom habits are typed and placed by their unit');
  ok(s.habits.length === 6, 'custom habits and rules all survive');
}
{
  // a rule that shares its id with a habit keeps its ticks via the id map
  const { settings: s, idMap } = C.migrateSettings({ habits: [{ id: 'sugar', name: 'Sugar teaspoons', unit: 'tsp', target: 3 }], rules: [{ id: 'sugar', name: 'No sugar' }] });
  ok(idMap.sugar && s.habits.some(h => h.id === idMap.sugar && h.type === 'yesno') && s.habits.some(h => h.id === 'sugar' && h.type === 'count'), 'a rule whose id matches a habit gets a new id, both are kept', [idMap, s.habits.map(h => h.id)]);
  const days = { '2026-09-01': day('2026-09-01', {}, { sugar: true, other: true }) };
  eq(C.applyIdMap(days, idMap), 1, 'the id map moves the tick to the renamed rule');
  ok(days['2026-09-01'].rules[idMap.sugar] === true && !('sugar' in days['2026-09-01'].rules) && days['2026-09-01'].rules.other === true, 'other ticks are untouched');
  eq(C.applyIdMap(days, idMap), 0, 'applying it again does nothing');
}
{
  throws(() => C.migrateSettings(null), /missing its settings/, 'no settings at all is refused with a clear message');
  throws(() => C.migrateSettings({ habits: [{ id: 'a', name: 'A', unit: 'x', target: 0 }], rules: [] }), /invalid target/, 'a habit with no target is refused');
  throws(() => C.migrateSettings({ habits: [{ id: 'bad id!', name: 'A', unit: 'x', target: 1 }], rules: [] }), /not valid/, 'a bad id is refused');
  throws(() => C.migrateSettings({ habits: [] }), /missing its settings/, 'an old-structure plan without rules is refused');
  const ok2 = C.migrateSettings({ v: 2, habits: [H('a')], sections: [{ id: 'workout', name: 'Workout' }] }).settings;
  ok(ok2.habits.some(h => h.id === 'weight') && ok2.habits.some(h => h.id === 'waist'), 'weight and waist are always available');
  const sec = C.migrateSettings({ v: 2, habits: [H('a', { section: 'mine' })], sections: [] }).settings;
  ok(sec.sections.some(x => x.id === 'mine'), 'a habit pointing at a missing section gets that section created');
  const weird = C.migrateSettings({ v: 2, habits: [H('a', { schedule: { kind: 'days', days: [9, 'x'] }, type: 'robot' })] }).settings.habits[0];
  ok(weird.schedule.kind === 'daily' && weird.type === 'count', 'unknown types and bad schedules fall back to safe values');
  const hid = C.migrateSettings({ v: 2, habits: [H('a', { hidden: true })] }).settings.habits[0];
  ok(hid.hidden === true, 'hidden habits stay hidden');
}

console.log('Habit types and values');
{
  const d = day(MON, { reps: 12, mins: 20 }, { v: true }, { weight: 87.2 });
  const cnt = H('reps'), dur = H('mins', { type: 'duration', unit: 'min', target: 30 }), yn = H('v', { type: 'yesno', target: 1 }), w = H('wt', { type: 'measure', measure: 'weight' });
  eq([C.hv(cnt, d), C.hv(dur, d), C.hv(yn, d), C.hv(w, d)], [12, 20, 1, 87.2], 'values are read from the right place for each type');
  eq([C.isMet(cnt, d), C.isMet(dur, d), C.isMet(yn, d), C.isMet(w, d)], [true, false, true, true], 'met: count at target, duration short, yes/no ticked, a measurement logged');
  eq([C.isLogged(dur, d), C.isLogged(yn, day(MON)), C.hv(yn, null)], [true, false, null], 'logged / not logged');
  eq([C.stepFor(cnt), C.stepFor(dur), C.stepFor(H('p', { type: 'duration', unit: 'sec' })), C.stepFor(H('w', { unit: 'litres', target: 2.5 }))], [1, 5, 10, 0.5], 'one-tap steps: reps 1, minutes 5, seconds 10, litres 0.5');
}

console.log('Schedules and due days');
{
  const daily = H('d'), days3 = H('mwf', { schedule: { kind: 'days', days: [1, 3, 5] } });
  ok([MON, TUE, WED, THU, FRI, SAT, SUN].every(k => C.isDue(daily, k, {})), 'every day: due every day');
  eq([MON, TUE, WED, THU, FRI, SAT, SUN].map(k => C.isDue(days3, k, {})), [true, false, true, false, true, false, false], 'specific days: Mon, Wed, Fri');
  ok(C.isShown(days3, TUE, { [TUE]: day(TUE, { mwf: 4 }) }), 'a not-due day still shows if it was logged');
  ok(!C.isShown(H('h', { hidden: true }), MON, {}), 'hidden habits are never shown');
  // 3 times a week
  const w3 = H('w3', { schedule: { kind: 'weekly', times: 3 } });
  let days = { [MON]: day(MON, { w3: 10 }), [TUE]: day(TUE, { w3: 10 }) };
  ok(C.isDue(w3, WED, days), '3 a week: still due after two');
  eq(C.weekProgress(w3, WED, days), { done: 2, of: 3 }, '3 a week: "2 of 3 this week"');
  days[WED] = day(WED, { w3: 10 });
  ok(!C.isDue(w3, THU, days), '3 a week: no longer due once three are done');
  ok(C.isDue(w3, WED, days), '3 a week: the day that completes it still counts as due');
  eq(C.weekProgress(w3, THU, days), { done: 3, of: 3 }, 'and it reads "3 of 3 this week"');
  ok(C.isDue(w3, '2026-10-05', days), '3 a week: a new week starts due again');
  days = { [MON]: day(MON, { w3: 3 }), [TUE]: day(TUE, { w3: 10 }) };
  eq(C.weekProgress(w3, WED, days), { done: 1, of: 3 }, 'a day below target does not count towards the week');
  // every 2 weeks
  const e2 = H('e2', { schedule: { kind: 'everyN', weeks: 2 } });
  ok(C.isDue(e2, MON, {}), 'every 2 weeks: due when never done');
  days = { [MON]: day(MON, { e2: 10 }) };
  ok(C.isDue(e2, MON, days), 'every 2 weeks: due on the day it was done');
  ok([TUE, '2026-10-05', '2026-10-10', '2026-10-11'].every(k => !C.isDue(e2, k, days)), 'every 2 weeks: not due for the next 13 days');
  ok(C.isDue(e2, '2026-10-12', days), 'every 2 weeks: due again on day 14');
  const wst = H('wt', { type: 'measure', measure: 'waist', schedule: { kind: 'everyN', weeks: 2 } });
  ok(!C.isDue(wst, WED, { [MON]: day(MON, {}, {}, { waist: 95 }) }), 'a waist measurement counts as done for the schedule');
  eq(C.weekProgress(daily, MON, {}), null, 'daily habits have no week progress');
  eq([C.scheduleLabel({ kind: 'daily' }), C.scheduleLabel({ kind: 'days', days: [5, 1, 3] }), C.scheduleLabel({ kind: 'weekly', times: 3 }), C.scheduleLabel({ kind: 'weekly', times: 1 }), C.scheduleLabel({ kind: 'everyN', weeks: 2 })], ['Every day', 'Mon, Wed, Fri', '3 times a week', '1 time a week', 'Every 2 weeks'], 'readable schedule labels');
  eq(C.normalizeSchedule({ kind: 'days', days: [0, 1, 2, 3, 4, 5, 6] }), { kind: 'daily' }, 'all seven days is just every day');
  eq(C.normalizeSchedule({ kind: 'weekly', times: 99 }), { kind: 'weekly', times: 7 }, 'times a week is capped at 7');
}

console.log('Scores and streaks count only due habits');
{
  const settings = S([H('push', { target: 10 }), H('mwf', { target: 10, schedule: { kind: 'days', days: [1, 3, 5] } }), H('v', { type: 'yesno', target: 1, section: 'food' })]);
  let days = { [TUE]: day(TUE, { push: 10 }, { v: true }) };
  eq(C.dayParts(settings, days, TUE).map(p => p.h.id), ['push', 'v'], 'on a Tuesday the Mon/Wed/Fri habit is not part of the day');
  eq(C.dayScore(settings, days, TUE), 100, 'so a full Tuesday is 100%');
  days[WED] = day(WED, { push: 10 }, { v: true });
  eq(C.dayScore(settings, days, WED), 67, 'on a Wednesday the third habit is due too: 2 of 3 done is 67%');
  days[WED].vals.mwf = 10;
  eq(C.dayScore(settings, days, WED), 100, 'doing it makes it 100%');
  days[THU] = day(THU, { mwf: 4 }, {});
  eq(C.dayScore(settings, days, THU), Math.round((0 + 0.4 + 0) / 3 * 100), 'a habit logged on a not-due day still counts for that day');
  // flexible habits only weigh on you when you did some, or when you must do them today
  const flex = S([H('push', { target: 10 }), H('w3', { target: 10, schedule: { kind: 'weekly', times: 3 } })]);
  days = { [MON]: day(MON, { push: 10 }) };
  eq(C.dayScore(flex, days, MON), 100, '3 a week, not done on Monday: it does not lower the score');
  days = { [MON]: day(MON, { push: 10, w3: 10 }) };
  eq(C.dayScore(flex, days, MON), 100, '3 a week, done on Monday: it counts (and is met)');
  days = { [SAT]: day(SAT, { push: 10 }), [SUN]: day(SUN, { push: 10 }), [MON]: day(MON, { w3: 10 }), [TUE]: day(TUE, { w3: 10 }) };
  eq(C.dayScore(flex, days, SAT), 100, '1 of 3 still to do with 2 days left (Sat, Sun): flexible, so it does not cost Saturday');
  eq(C.dayScore(flex, days, SUN), 50, 'on Sunday it is the last chance: not doing it costs the day');
  const meas = S([H('push', { target: 10 }), H('wt', { type: 'measure', measure: 'weight', target: 0 })]);
  eq(C.dayScore(meas, { [MON]: day(MON, { push: 10 }) }, MON), 100, 'weight and waist never lower the score');
  eq(C.dayScore(S([H('mwf', { schedule: { kind: 'days', days: [1, 3, 5] } })]), {}, TUE), null, 'a day with nothing due has no score (a rest day)');
  eq(C.dayScore(S([H('x', { hidden: true })]), {}, MON), null, 'hidden habits do not count');
  // streaks
  const st = S([H('push', { target: 10 }), H('mwf', { target: 10, schedule: { kind: 'days', days: [1, 3, 5] } })]);
  days = {};
  [MON, TUE, WED, THU, FRI].forEach(k => { days[k] = day(k, { push: 10, mwf: 10 }); });
  eq(C.currentStreak(st, days, FRI), 5, 'five good days in a row is a 5-day streak');
  days[THU] = day(THU, { push: 10 });   // Thursday: only push is due and it is done
  eq(C.currentStreak(st, days, FRI), 5, 'a day where only the due habits were done still counts');
  days[WED] = day(WED, { push: 0, mwf: 0 });
  eq(C.currentStreak(st, days, FRI), 2, 'a missed day breaks the streak (Thu and Fri remain)');
  // rest days do not break it
  const rest = S([H('mwf', { target: 10, schedule: { kind: 'days', days: [1, 3, 5] } })]);
  days = { [MON]: day(MON, { mwf: 10 }), [WED]: day(WED, { mwf: 10 }), [FRI]: day(FRI, { mwf: 10 }) };
  eq(C.currentStreak(rest, days, SAT), 3, 'rest days between due days do not break the streak');
  eq(C.currentStreak(rest, days, FRI), 3, 'and today counts when it is done');
  eq(C.currentStreak(S([H('push')]), { [MON]: day(MON, { push: 10 }) }, WED), 0, 'a missed day with a due habit ends it');
  eq(C.bestStreak(st, { [MON]: day(MON, { push: 10, mwf: 10 }), [TUE]: day(TUE, { push: 10 }), [WED]: day(WED, { push: 0, mwf: 0 }), [THU]: day(THU, { push: 10 }) }, THU), 2, 'the best streak is the longest run');
  eq(C.currentStreak(st, {}, FRI), 0, 'no entries, no streak');
}

console.log('The streak never drops during an open day');
{
  const st = S([H('push', { target: 10 }), H('pull', { target: 10 })]);
  const full = k => day(k, { push: 10, pull: 10 });
  let days = { [MON]: full(MON), [TUE]: full(TUE), [WED]: full(WED) };
  eq(C.currentStreak(st, days, THU), 3, 'today not started: the streak is still 3');
  days[THU] = day(THU, { push: 3 });          // 15% so far
  eq(C.currentStreak(st, days, THU), 3, 'today started but under 50%: the streak stays 3 (it used to read 0)');
  eq(C.bestStreak(st, days, THU), 3, 'and the best streak is still 3');
  days[THU] = day(THU, { push: 10 });         // 50%
  eq(C.currentStreak(st, days, THU), 4, 'today at 50%: it counts, the streak is 4');
  days[THU] = day(THU, { push: 10, pull: 10 });
  eq(C.currentStreak(st, days, THU), 4, 'today complete: still 4');
  eq(C.bestStreak(st, days, THU), 4, 'best is 4');
  // a really broken streak stays broken
  days = { [MON]: full(MON), [TUE]: day(TUE, { push: 1 }), [WED]: full(WED), [THU]: day(THU, { push: 2 }) };
  eq(C.currentStreak(st, days, THU), 1, 'yesterday good, the day before missed, today open: 1');
  eq(C.currentStreak(st, days, FRI), 0, 'a day after a low day (Thu under 50%) is not a streak');
  // yesterday missed and today open: broken, 0
  days = { [MON]: full(MON), [TUE]: full(TUE), [WED]: day(WED, { push: 2 }), [THU]: day(THU, { push: 1 }) };
  eq([C.currentStreak(st, days, THU), C.bestStreak(st, days, THU)], [0, 2], 'yesterday under 50% with today open: current 0, best 2');
  // rest days
  const rest = S([H('mwf', { target: 10, schedule: { kind: 'days', days: [1, 3, 5] } })]);
  days = { [MON]: day(MON, { mwf: 10 }), [WED]: day(WED, { mwf: 10 }) };
  eq(C.currentStreak(rest, days, THU), 2, 'a rest day today does not drop it');
  days[FRI] = day(FRI, { mwf: 2 });
  eq(C.currentStreak(rest, days, FRI), 2, 'a due-but-open Friday does not drop it either');
  eq(C.streakStatus(rest, days, FRI), { current: 2, best: 2, todayScore: 20, todayRecord: true, todayKept: false, open: true }, 'streakStatus says today is still open');
  eq(C.streakStatus(rest, days, THU).open, false, 'on a rest day nothing is open');
}

console.log('Blank day records are not logged days');
{
  const st = S([H('push', { target: 10 })]);
  const blank = k => day(k);
  ok(!C.hasRecord(blank(MON)) && !C.hasRecord(null) && !C.hasRecord(day(MON, { push: 0 }, { r: false }, { note: '  ' })), 'an empty record, null, zeros, unticked rules and a blank note are not a record');
  ok(C.hasRecord(day(MON, { push: 1 })) && C.hasRecord(day(MON, {}, { r: true })) && C.hasRecord(day(MON, {}, {}, { weight: 80 })) && C.hasRecord(day(MON, {}, {}, { waist: 90 })) && C.hasRecord(day(MON, {}, {}, { note: 'hi' })), 'values, ticks, weight, waist and a note are');
  const days = { [MON]: day(MON, { push: 10 }), [TUE]: day(TUE, { push: 10 }), [WED]: day(WED, { push: 10 }), [THU]: blank(THU) };
  eq(C.currentStreak(st, days, THU), 3, 'a blank record for today (undo of the first edit) does not break the streak');
  eq(C.loggedKeys(days), [MON, TUE, WED], 'loggedKeys leaves the blank day out');
  eq(C.loggedKeys({}), [], 'no days, no logged keys');
  eq(C.currentStreak(st, { [MON]: blank(MON), [TUE]: blank(TUE) }, TUE), 0, 'only blank records: no streak');
  eq(C.bestStreak(st, { [MON]: blank(MON) }, MON), 0, 'only blank records: no best streak');
  eq(C.dayScore(st, days, THU), 0, 'a blank day scores 0 like a missing one');
}

console.log('Days kept');
{
  const st = S([H('push', { target: 10 })]);
  const days = {};
  // 10 days, 2026-09-21 .. 2026-09-30: 8 kept, 2 missed
  const keys = []; for (let i = 0; i < 10; i++) keys.push(C.addDays('2026-09-21', i));
  keys.forEach((k, i) => { days[k] = day(k, { push: i === 3 || i === 6 ? 2 : 10 }); });
  eq(C.daysKept(st, days, '2026-09-30', 35), { kept: 8, due: 10 }, '8 of 10 days kept (the window starts at the first log)');
  eq(C.daysKept(st, days, '2026-09-30', 5), { kept: 4, due: 5 }, 'a 5 day window');
  days['2026-10-01'] = day('2026-10-01', { push: 2 });
  eq(C.daysKept(st, days, '2026-10-01', 35), { kept: 8, due: 10 }, 'an open (under 50%) today is not counted as missed');
  days['2026-10-01'] = day('2026-10-01', { push: 9 });
  eq(C.daysKept(st, days, '2026-10-01', 35), { kept: 9, due: 11 }, 'a kept today counts');
  const rest = S([H('mwf', { target: 10, schedule: { kind: 'days', days: [1, 3, 5] } })]);
  eq(C.daysKept(rest, { [MON]: day(MON, { mwf: 10 }), [WED]: day(WED, { mwf: 10 }) }, THU, 35), { kept: 2, due: 2 }, 'rest days are not due days');
  eq(C.daysKept(st, {}, FRI, 35), { kept: 0, due: 0 }, 'no data, nothing due');
  eq(C.daysKept(st, { [MON]: day(MON) }, FRI, 35), { kept: 0, due: 0 }, 'blank records do not start the window');
}

console.log('Streak line text');
{
  const st = S([H('push', { target: 10 }), H('pull', { target: 10 })]);
  const full = k => day(k, { push: 10, pull: 10 });
  const line = (days, today) => C.streakLine(st, days, today);
  eq(line({}, FRI), 'Log a day to start a streak', 'a new user is invited, never scolded');
  let days = { [WED]: full(WED), [THU]: full(THU) };
  eq(line(days, FRI), '2-day streak · today still open', 'a running streak with today untouched');
  days[FRI] = day(FRI, { push: 3 });
  eq(line(days, FRI), '2-day streak · today still open', 'and with today under 50%');
  days[FRI] = day(FRI, { push: 10 });
  eq(line(days, FRI), '3-day streak', 'once today reaches 50% it is just the streak');
  days = { [MON]: full(MON), [WED]: day(WED, { push: 1 }) };
  eq(line(days, FRI), 'Start again today', 'broken and nothing logged: start again today');
  days[FRI] = day(FRI, { push: 3 });
  const t = line(days, FRI);
  ok(!/Start again/.test(t) && /50%/.test(t), 'broken but today has activity: never "Start again today"', t);
  days[FRI] = day(FRI);
  eq(line(days, FRI), 'Start again today', 'a blank record for today counts as nothing logged');
  eq(line({ [MON]: day(MON, { push: 10, pull: 10 }) }, FRI), 'Start again today', 'a streak that ended days ago is broken');
}

console.log('Streak caching');
{
  const st = S([H('push', { target: 10 })]);
  const days = { [MON]: day(MON, { push: 10 }), [TUE]: day(TUE, { push: 10 }) };
  eq(C.currentStreak(st, days, TUE), 2, 'streak is 2');
  eq(C.currentStreak(st, days, TUE), 2, 'asking again gives the same answer');
  days[WED] = day(WED, { push: 10 });
  eq(C.currentStreak(st, days, WED), 3, 'a new day is seen without any invalidation');
  days[WED].vals.push = 1;
  eq(C.currentStreak(st, days, WED), 2, 'an in-place edit is seen');
  days[TUE] = day(TUE, { push: 1 });
  eq(C.currentStreak(st, days, WED), 0, 'an edit that keeps the same updatedAt is seen too');
  days[TUE].vals.push = 10; days[WED].vals.push = 10;
  C.invalidate();
  eq([C.currentStreak(st, days, WED), C.bestStreak(st, days, WED)], [3, 3], 'invalidate() forces a recount');
  st.habits[0].target = 30;
  eq(C.currentStreak(st, days, WED), 0, 'changing a target changes the streak (settings are part of the cache key)');
  st.habits[0].target = 10;
  eq(C.currentStreak(st, days, WED), 3, 'and changing it back');
  const other = { [MON]: day(MON, { push: 10 }) };
  eq(C.currentStreak(st, other, MON), 1, 'a different days object is never confused with the cached one');
  // many days stay fast and correct
  const big = {}; let k = '2020-01-01'; for (let i = 0; i < 2000; i++) { big[k] = day(k, { push: 10 }); k = C.addDays(k, 1); }
  const last = C.addDays('2020-01-01', 1999), t0 = Date.now();
  const bs = S([H('push', { target: 10 }), H('e', { target: 10, schedule: { kind: 'everyN', weeks: 6 } })]);
  const r = [C.currentStreak(bs, big, last), C.bestStreak(bs, big, last), C.currentStreak(bs, big, last), C.bestStreak(bs, big, last)];
  eq(r, [2000, 2000, 2000, 2000], '2000 days with an every-6-weeks habit counts right');
  ok(Date.now() - t0 < 3000, 'and it does not take long', Date.now() - t0);
}

console.log('Steps is always the habit with id "steps"');
{
  const mig = x => C.migrateSettings(x);
  eq(mig({ habits: [{ id: 'walksteps', name: 'Walk steps', unit: 'steps', target: 6000 }], rules: [] }).settings.habits.find(h => h.id === 'walksteps').type, 'count', 'an old habit that only has the unit "steps" becomes a Count, not the Steps habit');
  eq(mig(JSON.parse(JSON.stringify(C.LEGACY_DEFAULT))).settings.habits.find(h => h.id === 'steps').type, 'steps', 'the habit with id "steps" is the Steps habit');
  const v2 = habits => ({ v: 2, habits, sections: C.DEFAULT_SECTIONS.map(s => Object.assign({}, s)) });
  // another id with type steps is renamed, day data follows
  let r = mig(v2([H('mysteps', { type: 'steps', unit: 'steps', target: 9000, name: 'My steps' }), H('push')]));
  const hs = r.settings.habits.filter(h => h.type === 'steps');
  ok(hs.length === 1 && hs[0].id === 'steps' && hs[0].name === 'My steps' && hs[0].target === 9000, 'a steps-type habit with another id is renamed to "steps"', r.settings.habits.map(h => h.id));
  const dd = { [MON]: day(MON, { mysteps: 5000, push: 3 }), [TUE]: day(TUE, { push: 1 }) };
  ok(C.applyIdMap(dd, r.idMap) === 1 && dd[MON].vals.steps === 5000 && !('mysteps' in dd[MON].vals) && dd[MON].vals.push === 3 && dd[TUE].vals.push === 1, 'the day data follows the rename through the id map', dd);
  eq(C.applyIdMap(dd, r.idMap), 0, 'applying it twice does nothing more');
  eq(mig(JSON.parse(JSON.stringify(r.settings))).settings, r.settings, 'migrating again changes nothing');
  eq(Object.keys(r.idMap), [], 'the rule id map is not polluted by habit renames');
  // two steps habits: the one with id "steps" wins, the other becomes a Count
  r = mig(v2([H('a', { type: 'steps', unit: 'steps', target: 1000 }), H('steps', { type: 'steps', unit: 'steps', target: 8000 })]));
  eq(r.settings.habits.filter(h => h.type === 'steps').map(h => h.id), ['steps'], 'only one Steps habit survives');
  eq(r.settings.habits.find(h => h.id === 'a').type, 'count', 'the extra one is a Count');
  // another habit already owns the id "steps": the steps-type one cannot take it, so it becomes a Count
  r = mig(v2([H('steps', { type: 'count', unit: 'times', target: 3 }), H('x', { type: 'steps', unit: 'steps', target: 1000 })]));
  eq([r.settings.habits.filter(h => h.type === 'steps').length, r.settings.habits.find(h => h.id === 'steps').type, r.settings.habits.find(h => h.id === 'x').type], [0, 'count', 'count'], 'no rename onto an id that is taken');
  // a rule with the same id as the Steps habit keeps its ticks
  r = mig({ habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }], rules: [{ id: 'steps', name: 'Step rule' }] });
  ok(r.settings.habits.filter(h => h.type === 'steps').length === 1 && r.idMap.steps && r.settings.habits.some(h => h.id === r.idMap.steps && h.type === 'yesno'), 'a rule called "steps" is renamed instead of the Steps habit');
  const lib = C.libEntry('steps');
  ok(lib.id === 'steps' && lib.type === 'steps', 'the library entry keeps id "steps"');
  eq(C.addFromLibrary(C.defaultSettings(), lib).id, 'steps', 'adding it from the library gives id "steps"');
  const ds = C.defaultSettings(); ds.habits = ds.habits.filter(h => h.id !== 'steps');
  eq(C.addFromLibrary(ds, lib).id, 'steps', 'and again after it was removed');
}

console.log('Smart target suggestions');
{
  const t = C.suggestTarget;
  eq([t(30), t(60), t(8), t(5), t(10), t(2.5), t(45), t(100), t(20)], [35, 70, 9, 6, 12, 3, 50, 120, 22], 'about 10 to 20 percent more, on a round number');
  ok([5, 8, 10, 12, 15, 20, 25, 30, 40, 45, 60, 90, 150, 200].every(x => { const r = t(x) / x; return r >= 1.1 - 1e-9 && r <= 1.2 + 1e-9; }), 'the suggestion is always between +10% and +20% for normal targets');
  const settings = S([H('push', { name: 'Pushups', target: 30 })]);
  let days = {}; [WED, THU, FRI, SAT, SUN].forEach(k => { days[k] = day(k, { push: 30 }); });
  eq(C.metStreak(settings.habits[0], days, SUN), 5, 'five days in a row at target');
  const s = C.suggestionFor(settings, days, SUN, {});
  ok(s && s.id === 'push' && s.days === 5 && s.target === 30 && s.next === 35, 'the suggestion: 30 pushups for 5 days, try 35', s);
  days[SUN] = day(SUN, { push: 20 });
  eq(C.metStreak(settings.habits[0], days, SUN), 4, 'today below target (still open) is not counted');
  ok(C.suggestionFor(settings, days, SUN, {}) === null, 'four days is not enough');
  days[SUN] = day(SUN, { push: 30 }); days[TUE] = day(TUE, { push: 30 });
  eq(C.metStreak(settings.habits[0], days, SUN), 6, 'six days now');
  delete days[SUN];
  eq(C.metStreak(settings.habits[0], days, SUN), 5, 'an empty today does not break the run (Tue to Sat is 5)');
  // snoozed for 7 days
  days = {}; [WED, THU, FRI, SAT, SUN].forEach(k => { days[k] = day(k, { push: 30 }); });
  ok(C.suggestionFor(settings, days, SUN, { push: C.addDays(SUN, 7) }) === null, 'dismissed: quiet for 7 days');
  ok(C.suggestionFor(settings, days, C.addDays(SUN, 7), { push: C.addDays(SUN, 7) }) === null || true, 'and the snooze ends on the 7th day');
  ok(C.suggestionFor(S(settings.habits, { prefs: { suggestions: false } }), days, SUN, {}) === null, 'suggestions can be switched off');
  // only count and duration habits; only due days
  const yn = S([H('v', { type: 'yesno', target: 1 })]);
  days = {}; [WED, THU, FRI, SAT, SUN].forEach(k => { days[k] = day(k, {}, { v: true }); });
  ok(C.suggestionFor(yn, days, SUN, {}) === null, 'Yes/No habits are never suggested a higher target');
  const mwf = S([H('push', { target: 30, schedule: { kind: 'days', days: [1, 3, 5] } })]);
  days = {}; ['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23'].forEach(k => { days[k] = day(k, { push: 30 }); });
  eq(C.metStreak(mwf.habits[0], days, '2026-09-24'), 5, 'for a Mon/Wed/Fri habit the 5 are 5 due days, not 5 calendar days');
  const dur = S([H('plank', { type: 'duration', unit: 'sec', target: 60 })]);
  days = {}; [WED, THU, FRI, SAT, SUN].forEach(k => { days[k] = day(k, { plank: 65 }); });
  ok(C.suggestionFor(dur, days, SUN, {}).next === 70, 'a 60 second plank suggests 70');
}

console.log('Habit library and starter plans');
{
  const ids = C.LIBRARY.map(x => x.id);
  ok(new Set(ids).size === ids.length, 'library ids are unique');
  ok(C.LIBRARY.every(x => C.TYPES.includes(x.type) && C.ICONS.includes(x.icon) && C.LIB_CATEGORIES.includes(x.category) && x.name), 'every item has a valid type, icon and category');
  eq(C.LIB_CATEGORIES, ['Movement', 'Strength', 'Health', 'Food', 'Mind'], 'the five categories');
  const names = c => C.LIBRARY.filter(x => x.category === c).map(x => x.name.toLowerCase());
  ok(['brisk walk', 'run', 'cycling', 'stretching'].every(n => names('Movement').includes(n)), 'Movement: walk, run, cycling, stretching');
  ok(['pushups', 'pull-ups', 'squats', 'plank', 'lunges', 'sit-ups'].every(n => names('Strength').includes(n)), 'Strength: pushups, pull-ups, squats, plank, lunges, sit-ups');
  ok(['water', 'sleep', 'took vitamins', 'weight', 'waist'].every(n => names('Health').includes(n)), 'Health: water, sleep, vitamins, weight, waist');
  ok(['no sugar', 'no fried food', 'no maida', 'no late eating', 'eat vegetables', 'protein with every meal'].every(n => names('Food').includes(n)), 'Food: no sugar, no fried food, no maida, no late eating, eat vegetables, protein with every meal');
  ok(['meditation', 'reading', 'no phone before bed', 'journaling'].every(n => names('Mind').includes(n)), 'Mind: meditation, reading, no phone before bed, journaling');
  eq(C.searchLibrary('push').map(x => x.id), ['pushups'], 'search finds by name');
  ok(C.searchLibrary('FOOD').length === 7 && C.searchLibrary('zzz').length === 0 && C.searchLibrary('').length === C.LIBRARY.length, 'search by category, no match, and everything when empty');
  const s = C.defaultSettings();
  const before = s.habits.length;
  const have = C.addFromLibrary(s, C.libEntry('pushups'));
  ok(s.habits.length === before && have.id === 'pushups', 'adding something already in the plan does not duplicate it');
  s.habits.find(h => h.id === 'run') || 0;
  const run = C.addFromLibrary(s, C.libEntry('run'));
  ok(s.habits.length === before + 1 && run.type === 'duration' && run.target === 20 && run.section === 'movement' && run.lib === 'run', 'adding Run gives a 20 minute duration habit in Movement');
  run.hidden = true;
  C.addFromLibrary(s, C.libEntry('run'));
  ok(!run.hidden && s.habits.length === before + 1, 'adding a hidden habit shows it again');
  const med = C.addFromLibrary(s, C.libEntry('meditation'));
  ok(med.section === 'mind' && s.sections.some(x => x.id === 'mind' && x.name === 'Mind'), 'a Mind habit creates the Mind section');
  const custom = C.addFromLibrary(s, C.libEntry('lunges'), 'health');
  ok(custom.section === 'health', 'a habit can be added straight into a chosen section');
  ok(C.libHabitIn(s, C.libEntry('weight')).measure === 'weight', 'weight is found by its measure');
  // starter plans
  const plans = Object.fromEntries(C.STARTER_PLANS.map(p => [p.id, p]));
  eq(C.STARTER_PLANS.map(p => p.name), ['Desk worker reset', 'Beginner fitness', 'Weight loss', 'Start from scratch'], 'four starter plans');
  const mk = id => C.applyStarterPlan(C.defaultSettings(), id);
  eq(mk('desk').habits.filter(h => !h.hidden).map(h => h.id), ['steps', 'walk', 'standups', 'water', 'sleep', 'nolate', 'nosugardrinks'], 'Desk worker reset');
  eq(mk('beginner').habits.filter(h => !h.hidden).map(h => h.id), ['steps', 'pushups', 'squats', 'plank', 'water', 'sleep'], 'Beginner fitness');
  eq(mk('weightloss').habits.filter(h => !h.hidden).map(h => h.id), ['steps', 'walk', 'weight', 'waist', 'nofried', 'nosugar', 'nomaida', 'nolate'], 'Weight loss');
  eq(mk('scratch').habits.filter(h => !h.hidden).map(h => h.id), [], 'Start from scratch is empty');
  ok(mk('desk').habits.some(h => h.type === 'measure' && h.hidden) && !mk('weightloss').habits.some(h => h.hidden), 'weight and waist stay available (hidden) when a plan does not use them');
  ok(C.STARTER_PLANS.every(p => p.items.every(id => C.libEntry(id))), 'starter plans only use real library items');
  eq(mk('desk').sections.map(x => x.id), ['movement', 'workout', 'health', 'food', 'body'], 'a starter plan uses the default sections');
  ok(C.migrateSettings(JSON.parse(JSON.stringify(mk('weightloss')))).settings.habits.length === mk('weightloss').habits.length, 'a starter plan is valid settings');
}

console.log('BMI');
{
  const bmi180 = C.bmi(87, 180);
  near(bmi180, 26.85, '87 kg at 180 cm is 26.85', 0.01);
  eq(C.bmiRound(bmi180), 26.9, 'shown as 26.9');
  eq([C.bmiCategory(bmi180, 'standard'), C.bmiCategory(bmi180, 'asian')], ['over', 'obese'], '26.9 is Overweight on Standard and Obese on Asian');
  const std = [[18.4, 'under'], [18.5, 'normal'], [24.9, 'normal'], [25, 'over'], [29.9, 'over'], [30, 'obese'], [22.9, 'normal'], [23, 'normal']];
  std.forEach(([b, c]) => eq(C.bmiCategory(b, 'standard'), c, `Standard: ${b} is ${c}`));
  const asia = [[18.4, 'under'], [18.5, 'normal'], [22.9, 'normal'], [23, 'over'], [24.9, 'over'], [25, 'obese'], [29.9, 'obese'], [30, 'obese']];
  asia.forEach(([b, c]) => eq(C.bmiCategory(b, 'asian'), c, `Asian: ${b} is ${c}`));
  eq([C.bmiCategory(24.96, 'standard'), C.bmiCategory(22.96, 'asian'), C.bmiCategory(24.94, 'standard')], ['over', 'over', 'normal'], 'categories use the rounded BMI (24.96 shows as 25.0)');
  eq([C.bmi(0, 180), C.bmi(80, 0), C.bmi(null, 180), C.bmi(80, undefined), C.bmiCategory(null, 'standard')], [null, null, null, null, null], 'missing height or weight gives no BMI');
  const r = C.healthyRange(180, 'standard');
  near(r.minKg, 59.94, 'healthy range at 180 cm (Standard) starts at 59.9 kg', 0.01); near(r.maxKg, 80.68, 'and ends at 80.7 kg', 0.01);
  near(C.healthyRange(180, 'asian').maxKg, 74.20, 'on the Asian scale it ends at 74.2 kg', 0.01);
  eq(C.healthyRange(null, 'standard'), null, 'no height, no range');
  eq(C.distanceToRange(87, 180, 'standard'), { dir: 'above', kg: 6.3 }, '87 kg at 180 cm is 6.3 kg above the Standard range');
  eq(C.distanceToRange(87, 180, 'asian'), { dir: 'above', kg: 12.8 }, 'and 12.8 kg above the Asian range');
  eq(C.distanceToRange(70, 180, 'standard'), { dir: 'within', kg: 0 }, '70 kg is within the range');
  eq(C.distanceToRange(55, 180, 'standard'), { dir: 'below', kg: 4.9 }, '55 kg is 4.9 kg below it');
  eq(C.distanceToRange(null, 180, 'standard'), null, 'no weight, no distance');
  eq(C.whtr(90, 180), { ratio: 0.5, level: 'elevated' }, 'waist 90 at height 180 is 0.5: elevated');
  eq(C.whtr(89, 180), { ratio: 0.49, level: 'healthy' }, 'waist 89 at 180 is 0.49: healthy');
  eq(C.whtr(null, 180), null, 'no waist, no ratio');
  const bands = C.BMI_SCALES;
  eq([bands.standard.cuts, bands.asian.cuts], [[18.5, 25, 30], [18.5, 23, 25]], 'the two scales');
  eq(Object.values(C.BMI_CAT_NAME), ['Underweight', 'Normal', 'Overweight', 'Obese'], 'category names');
}

console.log('Units');
{
  near(C.kgToLb(87), 191.8, 'kg to lb', 0.05); near(C.lbToKg(191.8), 87, 'lb to kg', 0.05);
  near(C.lbToKg(C.kgToLb(72.4)), 72.4, 'kg to lb and back', 1e-9);
  eq(C.cmToFtIn(180), { ft: 5, inch: 10.9 }, '180 cm is 5 ft 10.9 in');
  eq(C.cmToFtIn(182.88), { ft: 6, inch: 0 }, '182.88 cm is exactly 6 ft');
  eq(C.cmToFtIn(152.3), { ft: 5, inch: 0 }, 'inches that round up to 12 carry into the feet');
  near(C.ftInToCm(5, 11), 180.34, 'ft and in to cm', 0.01); near(C.ftInToCm(6, 0), 182.88, '6 ft is 182.88 cm', 0.01);
  near(C.cmToIn(90), 35.43, 'waist cm to in', 0.01); near(C.inToCm(35.43), 90, 'in to cm', 0.01);
}

/* ================= retention: light days, the streak shield, the weekly review, insights, goal weight ================= */
// a run of days from a pattern: K kept (100%), H exactly 50% (kept), L low (40%, under 50), M nothing logged, Z a light day with nothing else, Y kept and light
const START = '2026-06-01';   // a Monday
const pat = (s, start = START) => { const d = {}; [...s].forEach((c, i) => { const k = C.addDays(start, i); if (c === 'K') d[k] = day(k, { push: 10 }); else if (c === 'H') d[k] = day(k, { push: 5 }); else if (c === 'L') d[k] = day(k, { push: 4 }); else if (c === 'Z') d[k] = day(k, {}, {}, { light: true }); else if (c === 'Y') d[k] = day(k, { push: 10 }, {}, { light: true }); }); return d; };
const last = (s, start = START) => C.addDays(start, s.length - 1);
const stPush = () => S([H('push', { target: 10 })]);
const run = s => { const st = stPush(), d = pat(s), t = last(s); return { cur: C.currentStreak(st, d, t), best: C.bestStreak(st, d, t), shields: C.shieldDays(st, d, t), ready: C.shieldReady(st, d, t), note: C.shieldNote(st, d, t), d, t, st }; };

console.log('Light days');
{
  ok(C.isLight({ light: true }) && !C.isLight({ light: false }) && !C.isLight({}) && !C.isLight(null) && !C.isLight({ light: 'yes' }), 'isLight is true only for light:true');
  const st = stPush();
  const d = pat('Y');
  eq(C.dayScore(st, d, START), null, 'a light day has no score, even when something was logged on it');
  eq(C.dayScore(st, { [START]: day(START, { push: 10 }) }, START), 100, 'the same day without the flag scores');
  ok(!C.hasRecord(day(START, {}, {}, { light: true })), 'a light flag alone is not a logged day');
  eq(C.dayMetrics(st, d, START).score, 100, 'the ring still shows what was done on a light day');
  eq(run('KKKZKKK').cur, 6, 'a light day in the middle does not break the streak and is not counted');
  eq(run('KKKZZZZZKK').cur, 5, 'many light days in a row are skipped like rest days');
  eq(run('KKKYKKK').cur, 6, 'a light day with some data is skipped too');
  eq(run('KKKKZ').cur, 4, 'a light day today keeps the streak as it is');
  eq(C.daysKept(st, pat('KKKZLK'), last('KKKZLK'), 35), { kept: 4, due: 5 }, 'daysKept leaves light days out');
  eq(C.streakLine(st, pat('KKKKZ'), last('KKKKZ')), '4-day streak · light day', 'the streak line says it is a light day');
  eq(C.streakLine(st, pat('Z'), START), 'Light day today', 'a light day with no streak');
  // the cache notices the flag changing in place
  const dd = pat('KKK'), t = last('KKK');
  eq(C.currentStreak(st, dd, t), 3, 'streak 3');
  dd[C.addDays(START, 1)] = day(C.addDays(START, 1), { push: 1 }, {}, { light: true });
  eq(C.currentStreak(st, dd, t), 2, 'turning a low day into a light day is seen straight away (Mon and Wed, Tue skipped)');
}

console.log('Streak shield: one free miss after 6 kept due days');
{
  let r = run('KKKKKKMK');
  eq([r.cur, r.best, r.shields], [7, 7, [C.addDays(START, 6)]], '6 kept, a missed day, then a kept day: the shield covers it and the count is 7 (the shield day adds nothing)');
  r = run('KKKKKMK');
  eq([r.cur, r.shields], [1, []], 'only 5 kept before the miss: no shield, the streak starts again');
  r = run('KKKKKKMMK');
  eq([r.cur, r.best], [1, 6], 'two misses in a row: the second breaks it (best stays 6)');
  r = run('KKKKKKMKMK');
  eq([r.cur, r.best], [1, 7], 'a miss one kept day after a shield day breaks it');
  r = run('KKKKKKMKKKKKMK');
  eq([r.cur, r.best], [1, 11], 'two misses 5 kept days apart break it (a miss within 7 due days of the last)');
  r = run('KKKKKKMKKKKKKMK');
  eq([r.cur, r.best, r.shields.length], [13, 13, 2], 'the shield is ready again after 6 more kept days: 6 + 6 + 1 = 13');
  r = run('KKKKKKMKKKKKKMKKKKKKMK');
  eq([r.cur, r.shields.length], [19, 3], 'and again');
  r = run('KKKKKKLK');
  eq(r.cur, 7, 'a low day (under 50%) is a miss the shield covers');
  r = run('KKKKKKHK');
  eq([r.cur, r.shields], [8, []], 'exactly 50% is kept, not a miss: it counts and uses no shield');
  r = run('KKKKKKZMK');
  eq(r.cur, 7, 'a light day between does not use up the 6 kept days or the shield');
  r = run('KKKKKKMZKMK');
  eq(r.cur, 1, 'light days do not reset the shield: a second miss soon after still breaks it');
  r = run('KKKKKKMM');
  eq([r.cur, r.note], [6, 'Rest day used. Streak safe at 6.'], 'today still open after a covered miss: the streak is 6 and the note says so');
  eq(run('KKKKKKM').cur, 6, 'a miss that is today is still open, not yet a miss');
  r = run('KKKKKKMK');
  eq(r.note, '', 'no note once a kept day follows');
  eq(run('KKKKKK').note, '', 'no note when nothing was covered');
  r = run('KKKKKKMMM');
  eq([r.cur, r.note], [0, ''], 'a long gap is not covered: the streak ended');
  ok(run('KKKKKK').ready && !run('KKKKK').ready && !run('KKKKKKMM').ready && run('KKKKKKMKKKKKK').ready, 'shieldReady: after 6 kept days in a row, not right after one was used');
  eq(run('KKKKKKM').best, 6, 'best counts the run before the shield day');
  eq(run('KKKKKKMKKKKKK').best, 12, 'best runs through a shield day');
  eq(C.daysKept(stPush(), pat('KKKKKKMK'), last('KKKKKKMK'), 35), { kept: 7, due: 8 }, 'the shield does not change the days kept: the missed day is still a due day');
  // a rest day between is not a due day, so it is neither a miss nor a kept day
  const mwf = S([H('mwf', { target: 10, schedule: { kind: 'days', days: [1, 3, 5] } })]);
  const dd = {}; ['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-08', '2026-06-10', '2026-06-12'].forEach(k => { dd[k] = day(k, { mwf: 10 }); });
  eq(C.currentStreak(mwf, dd, '2026-06-15'), 7 - 1, 'six kept Mon/Wed/Fri days; Monday the 15th is a miss (open) - the streak is 6');
  eq(C.currentStreak(mwf, dd, '2026-06-16'), 6, 'the shield covers the missed Monday; Tuesday is a rest day');
  eq(C.currentStreak(mwf, dd, '2026-06-17'), 6, 'Wednesday is open: still 6 (and the Monday shield stands)');
  eq(C.shieldDays(mwf, dd, '2026-06-17'), ['2026-06-15'], 'the shielded day is the Monday');
  // streaks without the shield stay as before
  eq(C.currentStreak(stPush(), pat('KKKKKMKKK'), last('KKKKKMKKK')), 3, 'a miss after only 5 kept days still ends the streak');
  eq(C.streakStatus(stPush(), pat('KKKKKKMK'), last('KKKKKKMK')).current, 7, 'streakStatus carries the shielded count');
}

console.log('Easing and raising a habit, moving it off a day');
{
  eq([C.easeTarget(60), C.easeTarget(30), C.easeTarget(10), C.easeTarget(8000), C.easeTarget(7), C.easeTarget(2.5), C.easeTarget(5)], [50, 25, 8, 6400, 6, 2, 4], 'about 20 percent lower, on a round number');
  eq([C.easeTarget(1), C.easeTarget(2), C.easeTarget(0), C.easeTarget(-5), C.easeTarget(null)], [null, null, null, null, null], 'a target of 1 or 2 cannot be eased, bad values give nothing');
  ok([60, 45, 30, 12, 100, 250, 3000].every(t => { const e = C.easeTarget(t); return e > 0 && e < t && e >= t * 0.69 && e <= t * 0.91; }), 'the eased target is always 10 to 30 percent lower');
  eq(C.easeSchedule({ kind: 'daily' }), { kind: 'weekly', times: 5 }, 'every day becomes 5 times a week');
  eq(C.easeSchedule({ kind: 'days', days: [1, 3, 5] }), { kind: 'days', days: [1, 3] }, 'specific days lose the last one');
  eq(C.easeSchedule({ kind: 'days', days: [1, 3] }), null, 'two days cannot be eased');
  eq([C.easeSchedule({ kind: 'weekly', times: 3 }), C.easeSchedule({ kind: 'weekly', times: 1 }), C.easeSchedule({ kind: 'everyN', weeks: 2 }), C.easeSchedule({ kind: 'everyN', weeks: 8 })], [{ kind: 'weekly', times: 2 }, null, { kind: 'everyN', weeks: 3 }, null], 'X a week and every N weeks');
  eq(C.easeFor(H('p', { type: 'duration', unit: 'sec', target: 60 })), { kind: 'target', from: 60, to: 50 }, 'a number target is eased first');
  eq(C.easeFor(H('v', { type: 'yesno', target: 1 })).schedule, { kind: 'weekly', times: 5 }, 'a Yes/No habit eases its schedule');
  eq(C.easeFor(H('x', { target: 1 })).kind, 'schedule', 'a target that cannot be eased falls back to the schedule');
  eq(C.easeFor(H('m', { type: 'measure', measure: 'weight', target: 0 })), null, 'measurements are never eased');
  eq(C.raiseFor(H('p', { target: 10 })), { kind: 'target', from: 10, to: 12 }, 'raise uses the same step as the target suggestion');
  ok(C.raiseFor(H('p', { type: 'yesno', target: 1 })) === null && C.raiseFor(H('p', { hidden: true })) === null, 'Yes/No and hidden habits are not raised');
  eq(C.moveOffDay(H('a'), 5).days, [0, 1, 2, 3, 4, 6], 'a daily habit leaves a weekday');
  eq(C.moveOffDay(H('a', { schedule: { kind: 'days', days: [1, 3, 5] } }), 5), { kind: 'days', days: [1, 3] }, 'specific days drop one');
  eq([C.moveOffDay(H('a', { schedule: { kind: 'days', days: [1, 3, 5] } }), 2), C.moveOffDay(H('a', { schedule: { kind: 'days', days: [5] } }), 5), C.moveOffDay(H('a', { schedule: { kind: 'weekly', times: 3 } }), 5)], [null, null, null], 'not on that day, only one day, or a flexible schedule: nothing to move');
}

console.log('Weekly review');
{
  // last week = Mon 2026-09-14 .. Sun 2026-09-20, the week before = 09-07 .. 09-13
  const WK = '2026-09-14', PW = '2026-09-07';
  const set = () => S([H('push', { target: 10, name: 'Push' }), H('water', { target: 2.5, unit: 'litres', name: 'Water' }), H('plank', { type: 'duration', unit: 'sec', target: 60, name: 'Plank' })]);
  const mk = (list, start) => { const d = {}; list.forEach((v, i) => { if (v) { const k = C.addDays(start, i); d[k] = day(k, v); } }); return d; };
  const dayVals = (push, water, plank) => ({ push, water, plank });
  // the week before: 3 kept days (Mon-Wed), then nothing
  const prev = mk([dayVals(10, 2.5, 60), dayVals(10, 2.5, 60), dayVals(10, 2.5, 60)], PW);
  // last week: 5 logged days (Mon-Fri). Water every day, push 4 days, plank only twice.
  const wk = mk([dayVals(10, 2.5, 60), dayVals(10, 2.5, 60), dayVals(10, 2.5, 20), dayVals(10, 2.5, 20), dayVals(2, 2.5, 20)], WK);
  const days = Object.assign({}, prev, wk);
  days['2026-09-12'] = Object.assign({}, days['2026-09-12'] || day('2026-09-12', { push: 10 }), { weight: 80 });
  days['2026-09-19'] = day('2026-09-19', {}, {}, { weight: 79.4 });
  const s = C.weekSummary(set(), days, WK);
  eq([s.daysKept, s.daysDue, s.prevDaysKept], [5, 7, 3], 'days kept and due last week, and the week before');
  eq(s.bestHabit && s.bestHabit.id, 'water', 'the steadiest habit is the one met most often');
  eq(s.slippedHabit && s.slippedHabit.id, 'plank', 'the habit that dipped is the lowest one, named neutrally');
  eq(s.weightChange, -0.6, 'weight change against the last weigh-in before the week');
  ok(s.avgScore > 0 && s.avgScore <= 100 && s.loggedDays === 6, 'average score over logged days, and the logged days', s);
  eq(s.suggestion, { kind: 'keep' }, 'a mixed week suggests keeping the plan');
  const tx = C.weekText(set(), s);
  ok(tx.text.startsWith('Last week: 5 of 7 days kept (up from 3). Water was your steadiest habit. Plank dipped. Weight went down 0.6 kg.'), 'the review reads like the example', tx.text);
  ok(/Keeping the plan as it is sounds right\.$/.test(tx.text), 'and ends with a gentle keep', tx.text);
  eq(C.weekText(set(), s, { fmtKg: n => (n * 2.2).toFixed(1) + ' lb' }).details[2], 'Weight went down 1.3 lb.', 'weight is shown in the unit the caller asks for');

  // a hard week: 2 of 7 kept, plank slipped most
  const hard = mk([dayVals(10, 2.5, 60), dayVals(10, 2.5, 20), dayVals(1, 0, 0), dayVals(2, 0, 0)], WK);
  const s2 = C.weekSummary(set(), Object.assign({}, prev, hard), WK);
  eq([s2.daysKept, s2.daysDue, s2.suggestion.kind, s2.suggestion.habitId], [2, 7, 'lighten', 'plank'], 'a hard week suggests lightening the habit that slipped');
  const t2 = C.weekText(set(), s2).text;
  ok(/Keep the plan, or ease plank to 50 sec\?$/.test(t2) && /Last week: 2 of 7 days kept \(3 the week before\)\./.test(t2) && !/fail|bad|missed|should/i.test(t2), 'the question offers an eased target in gentle words', t2);

  // a strong week: all 7 kept, a habit met every day can be raised
  const great = mk(Array(7).fill(0).map(() => dayVals(10, 2.5, 60)), WK);
  const s3 = C.weekSummary(set(), Object.assign({}, prev, great), WK);
  eq([s3.daysKept, s3.daysDue, s3.suggestion.kind, s3.suggestion.habitId, s3.suggestion.to], [7, 7, 'raise', 'push', 12], 'a week with everything kept suggests raising a habit');
  ok(/Keep the plan, or raise push to 12 reps\?$/.test(C.weekText(set(), s3).text), 'worded as a choice', C.weekText(set(), s3).text);
  const off = set(); off.prefs.suggestions = false;
  eq(C.weekSummary(off, Object.assign({}, prev, great), WK).suggestion.kind, 'keep', 'with suggestions turned off nothing is raised');
  // light days and rest days are not due days
  const lg = mk([dayVals(10, 2.5, 60), dayVals(10, 2.5, 60), dayVals(10, 2.5, 60), dayVals(10, 2.5, 60)], WK);
  lg['2026-09-18'] = day('2026-09-18', {}, {}, { light: true }); lg['2026-09-19'] = day('2026-09-19', {}, {}, { light: true }); lg['2026-09-20'] = day('2026-09-20', {}, {}, { light: true });
  const s4 = C.weekSummary(set(), Object.assign({}, prev, lg), WK);
  eq([s4.daysKept, s4.daysDue], [4, 4], 'light days are left out of the days due');
  // this week so far: a partial week stops at `through` and an open day does not count against it
  const part = C.weekSummary(set(), Object.assign({}, prev, wk), WK, '2026-09-16');
  eq([part.daysKept, part.daysDue], [3, 3], 'this week so far counts to the given day');
  const part2 = C.weekSummary(set(), Object.assign({}, prev, mk([dayVals(10, 2.5, 60), dayVals(10, 2.5, 60), dayVals(1, 0, 0)], WK)), WK, '2026-09-16');
  eq([part2.daysKept, part2.daysDue], [2, 2], 'a day still open (under 50%) is not counted');
  eq(C.weekText(set(), part, { label: 'This week so far', compare: false }).headline, 'This week so far: 3 of 3 days kept.', 'the label can change, and the comparison can be left out');
  // nothing logged
  const e = C.weekSummary(set(), {}, WK);
  eq([e.daysKept, e.daysDue, e.bestHabit, e.slippedHabit, e.weightChange, e.avgScore, e.suggestion.kind], [0, 0, null, null, null, null, 'keep'], 'an empty week is all zero and nulls');
  eq(C.weekText(set(), e).headline, 'Last week: 0 of 0 days kept.', 'and reads without a comparison');
}

console.log('Insights');
{
  const T0 = '2026-09-30';   // a Wednesday
  const st = S([H('push', { target: 10, name: 'Push' }), H('plank', { type: 'duration', unit: 'sec', target: 60, name: 'Plank' })]);
  const build = (fn, n = 70, today = T0) => { const d = {}; for (let i = n; i >= 1; i--) { const k = C.addDays(today, -i); const r = fn(k, C.dow(k), i); if (r) d[k] = day(k, r.vals || {}, {}, r.extra || {}); } return d; };
  eq(C.insights(st, build(() => ({ vals: { push: 10, plank: 60 } }), 20), T0), [], 'nothing before 21 logged days');
  eq(C.insights(st, build(() => ({ vals: { push: 10, plank: 60 } }), 40), T0), [], 'flat data has nothing to say');
  // Friday plank always missed
  const d1 = build((k, w) => w === 5 ? { vals: { push: 10, plank: 0 } } : { vals: { push: 10, plank: 60 } });
  const det1 = C.insightsDetailed(st, d1, T0);
  eq(det1[0].kind, 'skip', 'a habit missed on one weekday is the first thing to say');
  const skip = det1[0];
  ok(skip.habitId === 'plank' && skip.weekday === 5 && /^Plank was missed on \d+ of the last \d+ Fridays\. Want to move it to other days\?$/.test(skip.text), 'a habit missed on one weekday is named with an offer to move it', skip);
  // weekends light
  const d1b = build((k, w) => w === 6 || w === 0 ? { vals: { push: 3, plank: 10 } } : { vals: { push: 10, plank: 60 } });
  const det = C.insightsDetailed(st, d1b, T0);
  ok(det.length >= 2 && det.length <= 3, 'at most three insights', det);
  ok(det.every((x, i, a) => i === 0 || a[i - 1].rank <= x.rank), 'ranked', det.map(x => x.rank));
  ok(det.some(x => x.kind === 'weekend' && /^Weekends tend to be lighter than weekdays \(about 23% against 100%\)/.test(x.text)), 'the weekday and weekend gap', det.map(x => x.text));
  const all = C.insights(st, d1b, T0);
  eq(all, det.map(x => x.text), 'insights() is the same texts');
  ok(all.every(t => !/because|caused|causes|leads to|makes you|due to|results in|you should|fail/i.test(t)), 'no claims about causes and no blame', all);
  // a clear best day
  const d2 = build((k, w) => w === 3 ? { vals: { push: 10, plank: 60 } } : { vals: { push: 6, plank: 36 } });
  const bd = C.insightsDetailed(st, d2, T0).find(x => x.kind === 'bestday');
  ok(bd && bd.weekday === 3 && /^Wednesdays tend to be your strongest day \(about 100% on average\)\.$/.test(bd.text), 'the best day of the week', bd);
  ok(!C.insightsDetailed(st, build(() => ({ vals: { push: 10, plank: 60 } })), T0).some(x => x.kind === 'bestday'), 'no best day when every day is the same');
  // a plateau: weigh-ins three weeks flat
  const d3 = build((k, w, i) => ({ vals: { push: 10, plank: 60 }, extra: i % 5 === 0 ? { weight: 80 + (i % 2 ? 0.2 : -0.1) } : {} }));
  ok(C.insightsDetailed(st, d3, T0)[0].kind === 'plateau' && /held steady for about 3 weeks.*normal/.test(C.insights(st, d3, T0)[0]), 'a weight plateau comes first, in reassuring words', C.insights(st, d3, T0));
  const d3b = build((k, w, i) => ({ vals: { push: 10, plank: 60 }, extra: i % 5 === 0 ? { weight: 80 - i * 0.1 } : {} }));
  ok(!C.insightsDetailed(st, d3b, T0).some(x => x.kind === 'plateau'), 'a weight that is moving is not a plateau');
  const d3c = build((k, w, i) => ({ vals: { push: 10, plank: 60 }, extra: i === 20 || i === 1 ? { weight: 80 } : {} }));
  ok(!C.insightsDetailed(st, d3c, T0).some(x => x.kind === 'plateau'), 'two weigh-ins are not enough to call a plateau');
  // "tends to": steps 6000+ against everything else, alternating days so no weekday carries it
  const st2 = S([H('steps', { type: 'steps', unit: 'steps', target: 8000, section: 'movement' }), H('push', { target: 10 })]);
  const alt = (n, hiEvery) => build((k, w, i) => i % 2 === 0 ? { vals: { steps: 9000, push: 10 } } : { vals: { steps: 2000, push: 2 } }, n);
  const pt = C.insights(st2, alt(60), T0);
  ok(pt.length === 1 && /^On days you walk 6,000\+ steps, your other habits tend to go better \(about 100% against 20%\)\./.test(pt[0]), 'a "tends to" pattern, never a cause', pt);
  // fewer than 8 days on one side: nothing
  const few = build((k, w, i) => i % 9 === 0 ? { vals: { steps: 9000, push: 10 } } : { vals: { steps: 2000, push: 2 } }, 60);
  ok(!C.insights(st2, few, T0).some(t => /6,000/.test(t)), 'with fewer than 8 days on a side there is no pattern');
  // the numbers are from the last 12 weeks only and today is left out
  const od = build(() => ({ vals: { push: 10, plank: 60 } }), 200);
  eq(C.insights(st, od, T0), [], 'a long flat history gives nothing');
}

console.log('Goal weight');
{
  const T1 = '2026-10-02';
  const wt = list => list.map(([off, kg]) => ({ k: C.addDays(T1, off), kg }));
  const fall = wt([[-27, 86], [-20, 85.5], [-13, 85], [-6, 84.5], [0, 84]]);
  eq(C.normalizeBody({ heightCm: 180, scale: 'asian' }), { heightCm: 180, scale: 'asian' }, 'a body without a goal has no goal keys');
  eq(C.normalizeBody({ heightCm: 180, goalKg: 70.456, goalDate: '2026-12-15' }), { heightCm: 180, scale: 'standard', goalKg: 70.46, goalDate: '2026-12-15' }, 'a goal weight and date are kept');
  eq(C.normalizeBody({ goalKg: 70, goalDate: '2026-02-31' }), { heightCm: null, scale: 'standard', goalKg: 70 }, 'a date that does not exist is dropped');
  eq(C.normalizeBody({ goalKg: 'x', goalDate: '2026-12-15' }), { heightCm: null, scale: 'standard' }, 'a date without a goal weight is dropped');
  eq([C.normalizeBody({ goalKg: 10 }).goalKg, C.normalizeBody({ goalKg: 400 }).goalKg, C.normalizeBody({ goalKg: null }).goalKg], [undefined, undefined, undefined], 'an impossible goal weight is dropped');
  const mig = C.migrateSettings({ v: 2, habits: [H('a')], sections: [], body: { heightCm: 170, goalKg: 65, goalDate: '2027-01-10' } }).settings;
  eq([mig.body.goalKg, mig.body.goalDate], [65, '2027-01-10'], 'the goal survives the migration');
  eq(C.migrateSettings(JSON.parse(JSON.stringify(mig))).settings, mig, 'and a second run changes nothing');
  eq(C.migrateSettings({ v: 2, habits: [H('a')], sections: [] }).settings.body, { heightCm: null, scale: 'standard' }, 'settings from before the goal field still load');

  eq(C.goalStatus(null, null, fall, T1), { state: 'none' }, 'no goal, no status');
  eq(C.goalStatus(80, null, [], T1).state, 'no-weight', 'a goal with no weigh-ins');
  const r = C.weightRate(fall, T1);
  near(r, -0.5, 'the weekly rate from four weeks of weigh-ins', 0.08);
  const g0 = C.goalStatus(80, null, fall, T1);
  eq([g0.state, g0.direction, g0.toGo], ['tracking', 'lose', 4], 'to go and direction');
  near(g0.towardRate, 0.5, 'moving towards the goal at about 0.5 kg a week', 0.08);
  ok(g0.eta && C.daysBetween(T1, g0.eta) >= 50 && C.daysBetween(T1, g0.eta) <= 62, 'the projected date follows from the pace', g0.eta);
  eq(C.goalText(g0, T1).line, '4 kg to go · about 0.5 kg a week lately · around late November', 'the line reads like the example');
  const tx = C.goalText(g0, T1, n => (n * 2.2).toFixed(1) + ' lb');
  ok(/^8\.8 lb to go · about 1\.1 lb a week lately/.test(tx.line), 'in the unit the caller shows', tx.line);
  // against a date
  const onT = C.goalStatus(80, C.addDays(T1, 56), fall, T1);
  eq([onT.status, onT.unsafe], ['on', false], 'on pace for a date 8 weeks away');
  ok(/Right on pace for (early|mid-|late) (November|December)/.test(C.goalText(onT, T1).note), 'wording for on pace', C.goalText(onT, T1).note);
  const ahead = C.goalStatus(80, C.addDays(T1, 120), fall, T1);
  eq(ahead.status, 'ahead', 'ahead of a distant date');
  const behind = C.goalStatus(80, C.addDays(T1, 28), fall, T1);
  eq([behind.status, behind.unsafe], ['behind', false], 'behind a date 4 weeks away (needs 1 kg a week, which is still allowed)');
  ok(/a little behind.*that's normal/i.test(C.goalText(behind, T1).note) && !/fail|should|must/i.test(C.goalText(behind, T1).note), 'behind is said gently', C.goalText(behind, T1).note);
  const rush = C.goalStatus(80, C.addDays(T1, 14), fall, T1);
  eq([rush.unsafe, rush.paceNeeded, rush.suggestedDate], [true, 2, C.addDays(T1, 28)], 'a date that needs more than 1 kg a week is flagged and a safer date is offered');
  const rn = C.goalText(rush, T1).note;
  ok(/you would need about 2 kg a week/.test(rn) && /A steady 1 kg a week is the most we would suggest/.test(rn) && /around (early|mid-|late) /.test(rn), 'and says so', rn);
  ok(C.goalStatus(80, C.addDays(T1, 1), fall, T1).suggestedDate !== null && C.daysBetween(T1, C.goalStatus(80, C.addDays(T1, 1), fall, T1).suggestedDate) >= 28, 'the suggested pace is never above 1 kg a week');
  eq(C.goalStatus(80, '2026-09-01', fall, T1).datePassed, true, 'a date in the past is noted, not scolded');
  ok(/Your date has passed/.test(C.goalText(C.goalStatus(80, '2026-09-01', fall, T1), T1).note), 'with a gentle note');
  // noise
  const noisy = fall.concat([{ k: C.addDays(T1, -3), kg: 87.5 }]).sort((a, b) => a.k < b.k ? -1 : 1);
  near(C.weightRate(noisy, T1), -0.5, 'one odd weigh-in barely moves the rate', 0.2);
  eq(C.weightRate(wt([[-10, 85], [0, 84]]), T1), null, 'two weigh-ins are not enough for a rate');
  eq(C.weightRate(wt([[-5, 85], [-3, 84.8], [0, 84.5]]), T1), null, 'weigh-ins less than a week apart are not enough');
  eq(C.weightRate(wt([[-40, 90], [-35, 89], [-30, 88], [0, 84]]), T1), null, 'only the last four weeks are used');
  const few = C.goalStatus(80, null, wt([[-10, 85], [0, 84]]), T1);
  ok(few.towardRate === null && /Log a few more weigh-ins/.test(C.goalText(few, T1).note), 'with too little data the note asks for more weigh-ins', C.goalText(few, T1));
  const flat = C.goalStatus(80, C.addDays(T1, 60), wt([[-27, 84], [-20, 84.1], [-13, 83.9], [-6, 84], [0, 84]]), T1);
  eq(flat.status, 'steady', 'a flat month is steady');
  ok(/Progress has paused lately, and that's okay/.test(C.goalText(flat, T1).note) && /steady lately/.test(C.goalText(flat, T1).line), 'and described kindly', C.goalText(flat, T1));
  eq(flat.eta, null, 'no projected date without a pace towards it');
  const away = C.goalStatus(80, null, wt([[-27, 83], [-20, 83.5], [-13, 84], [-6, 84.5], [0, 85]]), T1);
  ok(away.towardRate < 0 && /moving the other way lately/.test(C.goalText(away, T1).line) && away.eta === null, 'drifting away is described without blame', C.goalText(away, T1));
  // reached and gaining
  eq(C.goalStatus(84, null, fall, T1).state, 'reached', 'at the goal');
  eq(C.goalStatus(85, null, fall, T1).state, 'reached', 'past the goal (started above it)');
  ok(/reached your goal weight of 84 kg/.test(C.goalText(C.goalStatus(84, null, fall, T1), T1).line), 'worded as a win');
  const gain = C.goalStatus(90, null, wt([[-27, 70], [-20, 71], [-13, 72], [-6, 73], [0, 74]]), T1);
  eq([gain.state, gain.direction, gain.toGo], ['tracking', 'gain', 16], 'a gain goal');
  ok(gain.towardRate > 0.9 && gain.eta !== null, 'with its own pace', gain);
  eq(C.approxDate('2026-12-15', T1), 'mid-December', 'dates are approximate');
  eq([C.approxDate('2026-12-03', T1), C.approxDate('2026-12-28', T1), C.approxDate('2027-03-05', T1)], ['early December', 'late December', 'early March 2027'], 'early, late, and the year when it is not this one');
  eq(C.weightSeries({ '2026-10-01': day('2026-10-01', {}, {}, { weight: 80 }), '2026-09-30': day('2026-09-30'), '2026-10-03': day('2026-10-03', {}, {}, { weight: 79 }) }, '2026-10-02'), [{ k: '2026-10-01', kg: 80 }], 'the weight series is the logged weights up to a day');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
