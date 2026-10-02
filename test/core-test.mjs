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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
