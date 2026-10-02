// Web-side tests for the Travel record (Progress card, trips sheet, vehicle labels, settings rows, normalising), with the mocked native bridge.
// The recording itself (transitions, trips, distance) is tested with simulated data in android/app/src/test (npm run test:android).
// Run: node test/travel-test.mjs
import { serve, launch, counter, newPage, tab, ready, sheetGone, settle, actionChoose, MOCK, skipOnboarding, daysAgo } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();

const MOCK_STEPS = { activityGranted: true, locationGranted: true, batteryIgnored: false, brand: 'xiaomi', health: 'working', source: 'counter', days: {}, filteredToday: 0, cfg: { enabled: false } };
const META_ON = { steps: { heightCm: 180, strictness: 'balanced', sensitivity: 'normal', useLocation: false, enabledAt: Date.now() - 100 * 864e5, setupShown: true } };
const META_OFF = { steps: { heightCm: 180, strictness: 'balanced', sensitivity: 'normal', useLocation: false, enabledAt: null, setupShown: true } };

async function open(opts = {}) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const pg = await newPage(ctx, errs);
  const seed = { steps: Object.assign({}, MOCK_STEPS, opts.steps || {}), prefs: Object.assign({ comeback_onboarded: '1', comeback_meta: JSON.stringify(opts.meta || META_ON) }, opts.prefs || {}) };
  await pg.addInitScript(sd => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); localStorage.setItem('__mock', JSON.stringify({ prefs: sd.prefs, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0, steps: sd.steps })); } }, seed);
  await pg.goto(base); await ready(pg); await pg.waitForTimeout(500);
  return { ctx, pg, errs };
}
const mock = pg => pg.evaluate(() => window.__mock.st());
const stored = async pg => { const v = (await mock(pg)).prefs.comeback; return v ? JSON.parse(v) : null; };
const calls = async (pg, n) => (await mock(pg)).calls.filter(c => c.n === n);
const sendDays = (pg, days) => pg.evaluate(d => { window.__mock.steps({ days: d, health: 'working' }); window.__mock.fire('stepsChanged', { days: d, health: 'working' }); }, days);
const sheetOpen = pg => pg.waitForFunction(() => { const s = document.querySelectorAll('.sheet'); return s.length === 1 && document.querySelector('.sheet-wrap.in'); }, null, { timeout: 6000 });
const cardText = pg => pg.evaluate(() => (document.getElementById('travelCard').textContent || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim());
const tile = (pg, id) => pg.evaluate(i => { const e = document.getElementById('tv-' + i); return e ? { v: e.querySelector('b').textContent, s: e.querySelector('small').textContent.replace(/[  ]/g, ' ') } : null; }, id);
const at = (off, h, m) => { const d = new Date(); d.setDate(d.getDate() - off); d.setHours(h, m, 0, 0); return d.getTime(); };
const MIN = 60000;
const HOURLY = new Array(24).fill(0);

// four days of recorded travel (what the Android plugin returns from getDays)
const T0 = { start: at(0, 7, 40), end: at(0, 8, 15) };
const NATIVE = {
  [daysAgo(0)]: { steps: 5000, filtered: 0, hourly: HOURLY, travel: { walk_min: 70, run_min: 0, bike_min: 0, vehicle_min: 35, trips: [{ mode: 'vehicle', start: T0.start, end: T0.end, min: 35 }] } },
  [daysAgo(3)]: { steps: 4000, filtered: 0, hourly: HOURLY, travel: { walk_min: 20, run_min: 25, bike_min: 30, vehicle_min: 50, trips: [
    { mode: 'bike', start: at(3, 18, 5), end: at(3, 18, 35), min: 30 },
    { mode: 'vehicle', start: at(3, 12, 30), end: at(3, 13, 20), min: 50, km: 41.5, avg_kmh: 52.3 }] } },
  [daysAgo(20)]: { steps: 3000, filtered: 0, hourly: HOURLY, travel: { walk_min: 15, run_min: 0, bike_min: 0, vehicle_min: 10, trips: [{ mode: 'vehicle', start: at(20, 9, 0), end: at(20, 9, 10), min: 10, km: 12.4, avg_kmh: 38 }] } },
  [daysAgo(60)]: { steps: 2000, filtered: 0, hourly: HOURLY, travel: { walk_min: 0, run_min: 0, bike_min: 0, vehicle_min: 60, trips: [{ mode: 'vehicle', start: at(60, 14, 0), end: at(60, 15, 0), min: 60 }] } },
};

async function showProgress(pg, native) {
  await sendDays(pg, native);
  await pg.waitForFunction(k => days[k] && days[k].travel, Object.keys(native)[0], { timeout: 5000 });
  await tab(pg, 'progress');
  await pg.waitForSelector('#travelCard .tv-card');
}

/* ---------- the card ---------- */
console.log('Travel card');
{
  const { ctx, pg, errs } = await open();
  await showProgress(pg, NATIVE);
  ok(await pg.isVisible('#travelCard'), 'the Travel card is on Progress');
  const t = Object.fromEntries(await Promise.all(['walk', 'run', 'bike', 'vehicle'].map(async i => [i, await tile(pg, i)])));
  ok(t.walk.v === '1 h 45 min', 'walk minutes for the month (70 + 20 + 15)', t.walk);
  ok(t.run.v === '25 min', 'run minutes', t.run);
  ok(t.bike.v === '30 min', 'bike minutes', t.bike);
  ok(t.vehicle.v === '1 h 35 min', 'vehicle minutes (35 + 50 + 10)', t.vehicle);
  ok(/about .* km from steps/.test(t.walk.s), 'walk distance comes from steps (kmFor)', t.walk);
  const expectKm = await pg.evaluate(() => (Math.round(kmFor(5000 + 4000 + 3000) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }));
  ok(t.walk.s.includes(expectKm + ' km'), 'walk km = steps x stride', [t.walk.s, expectKm]);
  ok(t.vehicle.s === '3 trips · 53.9 km', 'vehicle trips and the km that were recorded', t.vehicle);
  ok(t.bike.s === 'minutes only', 'bike has no distance while trip distance is off', t.bike);
  const bars = await pg.$$eval('#travelCard .tv-day', e => e.length);
  ok(bars === 30, 'one bar per day for the month', bars);
  const aria = await pg.getAttribute('#travelCard .tv-bars', 'aria-label');
  ok(/Time on the move per day/.test(aria) && /walking 1 h 45 min/.test(aria) && /4 trips/.test(aria), 'the bars have a text summary for screen readers', aria);
  ok(/Distance of vehicle trips is off/.test(await cardText(pg)), 'says trip distance is off and where to turn it on');
  const noClock24 = !/\b(1[3-9]|2[0-3]):[0-5]\d\b/.test(await cardText(pg));
  ok(noClock24, 'no 24-hour times on the card');

  // never part of the score or the streak
  const same = await pg.evaluate(k => { const d = days[k], a = scoreOf(d), s1 = streak(); const c = JSON.parse(JSON.stringify(d)); delete c.travel; return a === scoreOf(c) && s1 === streak(); }, daysAgo(0));
  ok(same, 'travel does not change the daily score or the streak');

  /* range switching */
  await pg.click('#seg button[data-range="7"]');
  await pg.waitForFunction(() => document.querySelectorAll('#travelCard .tv-day').length === 7);
  let w = await tile(pg, 'walk'), v = await tile(pg, 'vehicle');
  ok(w.v === '1 h 30 min' && v.v === '1 h 25 min', 'week: only the last 7 days count', [w, v]);
  ok(/3 trips|2 trips/.test(v.s) && (await pg.textContent('#travelTripsBtn')) === 'See trips (3)', 'week: trip count', [v, await pg.textContent('#travelTripsBtn')]);
  await pg.click('#seg button[data-range="90"]');
  await pg.waitForFunction(() => document.querySelectorAll('#travelCard .tv-day').length === 90);
  v = await tile(pg, 'vehicle');
  ok(v.v === '2 h 35 min' && (await pg.textContent('#travelTripsBtn')) === 'See trips (5)', '3 months: includes the older day', [v, await pg.textContent('#travelTripsBtn')]);
  await pg.click('#seg button[data-range="30"]');
  await pg.waitForFunction(() => document.querySelectorAll('#travelCard .tv-day').length === 30);
  ok((await pg.textContent('#travelTripsBtn')) === 'See trips (4)', 'back to the month');

  /* trips sheet: 12-hour times, mode, minutes, km */
  await pg.click('#travelTripsBtn');
  await sheetOpen(pg);
  const rows = await pg.$$eval('.sheet .tv-trip', els => els.map(e => ({ start: e.dataset.start, label: e.querySelector('.row-label').textContent.replace(/\s+/g, ' '), sub: e.querySelector('.row-sub').textContent.replace(/[  ]/g, ' '), tag: e.tagName })));
  ok(rows.length === 4, 'the sheet lists the 4 trips in range', rows);
  ok(rows[0].label === '7:40 AM – 8:15 AM' && rows[0].sub === 'Car · 35 min', 'first trip: 12-hour time range, default vehicle, minutes', rows[0]);
  ok(rows[1].label === '6:05 PM – 6:35 PM' && rows[1].sub === 'Bike · 30 min' && rows[1].tag === 'DIV', 'a bike trip is labelled Bike and is not relabelable', rows[1]);
  ok(rows[2].label === '12:30 PM – 1:20 PM' && /Car · 50 min · 41\.5 km · avg 52 km\/h/.test(rows[2].sub), 'noon is 12:30 PM, km and average speed shown', rows[2]);
  const sheetText = await pg.evaluate(() => document.querySelector('.sheet').textContent);
  ok(!/\b(1[3-9]|2[0-3]):[0-5]\d\b/.test(sheetText) && /\b\d{1,2}:\d{2}\s?(AM|PM)\b/.test(sheetText), 'all times are 12-hour with AM/PM');
  ok(/not a car from a motorbike/.test(sheetText), 'the sheet says honestly that Android cannot tell a car from a motorbike');

  /* relabel */
  await pg.click(`.sheet .tv-trip[data-start="${T0.start}"]`);
  await actionChoose(pg, 'Motorbike');
  await settle(pg);
  const lab = await pg.$eval(`.sheet .tv-trip[data-start="${T0.start}"] .row-sub`, e => e.textContent);
  ok(/^Motorbike · 35 min/.test(lab), 'the row shows the new vehicle', lab);
  const st = await stored(pg);
  ok(st.days[daysAgo(0)].travel.trips[0].vehicle === 'motorbike', 'the label is saved in the day record (travel.trips[0].vehicle)', st.days[daysAgo(0)].travel);
  ok(st.days[daysAgo(3)].travel.trips.every(x => x.vehicle == null), 'other trips are untouched');
  await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg);
  // the phone sends the same trips again (without the label): the label stays
  await sendDays(pg, NATIVE); await pg.waitForTimeout(200);
  const kept = await pg.evaluate(k => days[k].travel.trips[0].vehicle, daysAgo(0));
  ok(kept === 'motorbike', 'a fresh update from the phone keeps the vehicle you chose', kept);
  // and survives a restart (needs the normalizeDay hook in logic.js, which the integrator adds)
  const hooked0 = await pg.evaluate(() => !!normalizeDay('2026-01-01', { vals: {}, travel: { walk_min: 5 } }).travel);
  await pg.reload(); await ready(pg); await pg.waitForTimeout(600);
  const after = await pg.evaluate(k => days[k] && days[k].travel && days[k].travel.trips[0] && days[k].travel.trips[0].vehicle, daysAgo(0));
  if (hooked0) ok(after === 'motorbike', 'the label survives a restart', after);
  else console.log('  SKIP  restart check (normalizeDay hook not in yet)');
  ok(errs.length === 0, 'no JS errors (card)', errs);
  await ctx.close();
}

/* ---------- merging from the phone ---------- */
console.log('Merging');
{
  const { ctx, pg, errs } = await open();
  await sendDays(pg, { [daysAgo(1)]: { steps: 0, travel: { vehicle_min: 40, trips: [] } }, [daysAgo(2)]: { steps: 1500, travel: { walk_min: 20, trips: [] } }, [daysAgo(120)]: { steps: 900, travel: { walk_min: 9, trips: [] } } });
  await pg.waitForTimeout(300);
  const r = await pg.evaluate(([a, b, c]) => ({ a: !!days[a], b: days[b] && days[b].travel && days[b].travel.walk_min, c: !!days[c] }), [daysAgo(1), daysAgo(2), daysAgo(120)]);
  ok(r.a === false, 'a day with travel but no steps and no entry does not become a logged day', r);
  ok(r.b === 20, 'a day with steps gets its travel record', r);
  ok(r.c === false, 'days from before counting was switched on are ignored', r);
  // changed values replace; empty updates change nothing
  await sendDays(pg, { [daysAgo(2)]: { steps: 1500, travel: { walk_min: 35, trips: [] } } });
  await pg.waitForTimeout(200);
  ok((await pg.evaluate(k => days[k].travel.walk_min, daysAgo(2))) === 35, 'newer minutes replace older ones');
  await sendDays(pg, { [daysAgo(2)]: { steps: 1500 } });
  await pg.waitForTimeout(200);
  ok((await pg.evaluate(k => days[k].travel.walk_min, daysAgo(2))) === 35, 'an update without travel keeps what is stored');
  const d = await pg.evaluate(() => { const x = { vals: {}, rules: {} }; return [applyNativeTravel(x, { travel: { walk_min: 5 } }), applyNativeTravel(x, { travel: { walk_min: 5 } }), applyNativeTravel(x, {}), x.travel.walk_min]; });
  ok(d[0] === true && d[1] === false && d[2] === false && d[3] === 5, 'applyNativeTravel(dayRecord, nativeDay) reports whether the record changed', d);
  ok(errs.length === 0, 'no JS errors (merge)', errs);
  await ctx.close();
}

/* ---------- off states ---------- */
console.log('Off states');
{
  // plain browser: nothing to show
  const errs = []; const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } }); await skipOnboarding(ctx);
  const pg = await newPage(ctx, errs); await pg.goto(base); await ready(pg);
  await pg.evaluate(k => { days[k] = { vals: { pushups: 10 }, rules: {}, weight: null, waist: null, note: '', date: k, updatedAt: Date.now() }; refreshAll(); }, daysAgo(0));
  await tab(pg, 'progress'); await pg.waitForTimeout(200);
  ok(await pg.isHidden('#travelCard'), 'in a browser the Travel card is not shown');
  ok(errs.length === 0, 'no JS errors (browser)', errs);
  await ctx.close();
}
const seedDay = pg => pg.evaluate(k => { days[k] = { vals: { pushups: 10 }, rules: {}, weight: null, waist: null, note: '', date: k, updatedAt: Date.now() }; refreshAll(); }, daysAgo(0));
{
  const { ctx, pg, errs } = await open({ meta: META_OFF });
  await seedDay(pg); await tab(pg, 'progress'); await pg.waitForSelector('#travelCard .tv-card');
  const txt = await cardText(pg);
  ok(/Turn on step counting/.test(txt) && !(await pg.$('#tv-walk')), 'step counting off: the card explains and offers to turn it on, no numbers', txt);
  ok(errs.length === 0, 'no JS errors (steps off)', errs);
  await ctx.close();
}
{
  const { ctx, pg, errs } = await open({ steps: { noAR: true } });
  await seedDay(pg); await tab(pg, 'progress'); await pg.waitForFunction(() => /Google Play services/.test(document.getElementById('travelCard').textContent), null, { timeout: 5000 });
  ok(!(await pg.$('#tv-walk')) && !(await pg.$('#travelCard button')), 'no Play services: the card explains and offers nothing', await cardText(pg));
  ok(errs.length === 0, 'no JS errors (no activity recognition)', errs);
  await ctx.close();
}
{
  const { ctx, pg, errs } = await open({ steps: { activityGranted: false } });
  await seedDay(pg); await tab(pg, 'progress'); await pg.waitForFunction(() => /Physical activity/.test(document.getElementById('travelCard').textContent), null, { timeout: 5000 });
  ok(!(await pg.$('#tv-walk')), 'permission missing: the card says so instead of showing zeros', await cardText(pg));
  await ctx.close();
}
{
  const { ctx, pg, errs } = await open();
  await seedDay(pg); await tab(pg, 'progress'); await pg.waitForFunction(() => /Nothing recorded/.test(document.getElementById('travelCard').textContent), null, { timeout: 5000 });
  ok(!(await pg.$('#travelTripsBtn')) && !(await pg.$('.tv-bars')), 'counting on but nothing recorded yet: a short note, no empty chart', await cardText(pg));
  ok(errs.length === 0, 'no JS errors (no data)', errs);
  await ctx.close();
}

/* ---------- settings rows (mounted by Settings > Advanced) ---------- */
console.log('Settings rows');
const mount = pg => pg.evaluate(() => {
  document.getElementById('tvTestGroup')?.remove();
  const g = document.createElement('div'); g.id = 'tvTestGroup'; g.className = 'group'; g.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:var(--solid)';
  document.body.appendChild(g); const rows = travelSettingsRows(); rows.forEach(r => g.appendChild(r)); return rows.length;
});
{
  const { ctx, pg, errs } = await open();
  await showProgress(pg, NATIVE);
  ok((await mount(pg)) === 2, 'travelSettingsRows() returns the distance switch and the default vehicle row');
  ok(!(await pg.isChecked('#travelDistOn')), 'trip distance is off by default');
  ok((await calls(pg, 'setTravelDistance')).length === 0 && (await calls(pg, 'reqLocation')).length === 0, 'location is not asked for until the switch is turned on');
  await pg.click('#travelDistRow');
  await pg.waitForFunction(() => window.__mock.st().calls.some(c => c.n === 'setTravelDistance'));
  ok((await calls(pg, 'reqLocation')).length === 1 && (await calls(pg, 'setTravelDistance')).pop().a.enabled === true, 'turning it on asks for location, then enables it');
  await pg.waitForTimeout(200);
  ok(await pg.isChecked('#travelDistOn') && !/Distance of vehicle trips is off/.test(await cardText(pg)), 'the switch stays on and the card stops saying it is off');
  ok((await tile(pg, 'bike')).s === 'no distance yet', 'bike says no distance yet once trip distance is on');
  await pg.click('#travelDistRow');
  await pg.waitForFunction(() => window.__mock.st().calls.filter(c => c.n === 'setTravelDistance').length === 2);
  ok((await calls(pg, 'setTravelDistance')).pop().a.enabled === false, 'turning it off tells the phone');
  // default vehicle
  await pg.click('#travelVehRow'); await actionChoose(pg, 'Motorbike'); await settle(pg);
  const prefs = (await mock(pg)).prefs.comeback_travel_prefs;
  ok(prefs && JSON.parse(prefs).defaultVehicle === 'motorbike', "the default vehicle is saved on this phone ('comeback_travel_prefs')", prefs);
  ok((await pg.textContent('#travelVehRow .row-val')) === 'Motorbike', 'the row shows it');
  await pg.click('#travelTripsBtn'); await sheetOpen(pg);
  const sub = await pg.$eval(`.sheet .tv-trip[data-start="${T0.start}"] .row-sub`, e => e.textContent);
  ok(/^Motorbike/.test(sub), 'trips without a label use the default vehicle', sub);
  ok(errs.length === 0, 'no JS errors (settings rows)', errs);
  await ctx.close();
}
{
  const { ctx, pg, errs } = await open({ steps: { locationGranted: false } });
  await showProgress(pg, NATIVE);
  await mount(pg);
  await pg.click('#travelDistRow'); await pg.waitForTimeout(400);
  ok(!(await pg.isChecked('#travelDistOn')) && (await calls(pg, 'setTravelDistance')).length === 0, 'location refused: the switch goes back off and nothing is enabled');
  ok(/not allowed/.test(await pg.textContent('#stMsg')), 'and says why');
  ok(errs.length === 0, 'no JS errors (location refused)', errs);
  await ctx.close();
}

/* ---------- normalizeTravel and the CSV cells ---------- */
console.log('normalizeTravel');
{
  const { ctx, pg, errs } = await open();
  const n = x => pg.evaluate(v => normalizeTravel(v), x);
  ok((await n(null)) === null && (await n(5)) === null && (await n('x')) === null && (await n([])) === null && (await n({})) === null, 'not an object, or empty: nothing');
  ok((await n({ walk_min: 0, trips: [] })) === null, 'all zero and no trips: nothing');
  const a = await n({ walk_min: -5, run_min: 'NaN', bike_min: 12.6, vehicle_min: 99999, extra: 'x', trips: [] });
  ok(a.walk_min === 0 && a.run_min === 0 && a.bike_min === 13 && a.vehicle_min === 1440 && !('extra' in a), 'minutes: negatives and junk become 0, rounded, capped at one day, unknown fields dropped', a);
  const trips = Array.from({ length: 80 }, (_, i) => ({ mode: 'vehicle', start: 1.7e12 + i * 600000, end: 1.7e12 + i * 600000 + 300000 }));
  const b = await n({ vehicle_min: 5, trips });
  ok(b.trips.length === 50, 'at most 50 trips a day', b.trips.length);
  const c = await n({ trips: [
    { mode: 'vehicle', start: 1.7e12, end: 1.7e12 + 600000, min: 10, km: 3.456, avg_kmh: 20.04, vehicle: 'car', junk: 1 },
    { mode: 'plane', start: 1.7e12 + 1e7, end: 1.7e12 + 2e7 },
    { mode: 'bike', start: 1.7e12 + 3e7, end: 1.7e12 + 3.6e7, vehicle: 'car' },
    { mode: 'vehicle', start: 'soon', end: 5 }, { mode: 'vehicle', start: 5, end: 1 }, { mode: 'vehicle', start: -1, end: 1 }, null, 'x',
    { mode: 'vehicle', start: 1.7e12 + 5e7, end: 1.7e12 + 5.1e7, km: -3, avg_kmh: 9999, vehicle: '<b>' },
    { mode: 'vehicle', start: 1.7e12, end: 1.7e12 + 1000 }
  ] });
  ok(c.trips.length === 3, 'bad modes, bad times, junk entries and duplicate starts are dropped', c.trips);
  ok(c.trips[0].km === 3.46 && c.trips[0].avg_kmh === 20 && c.trips[0].vehicle === 'car' && !('junk' in c.trips[0]), 'good trip: km and speed rounded, vehicle kept, unknown fields dropped', c.trips[0]);
  ok(!('vehicle' in c.trips[1]), 'a bike trip has no vehicle label', c.trips[1]);
  ok(!('km' in c.trips[2]) && !('avg_kmh' in c.trips[2]) && !('vehicle' in c.trips[2]), 'negative km, absurd speed and an unknown vehicle are dropped', c.trips[2]);
  const d = await n({ trips: [{ mode: 'vehicle', start: 1.7e12 + 6e5, end: 1.7e12 + 12e5 }, { mode: 'vehicle', start: 1.7e12, end: 1.7e12 + 6e5 }] });
  ok(d.trips[0].start < d.trips[1].start && d.trips[0].min === 10, 'trips are sorted by start, minutes are worked out when missing', d.trips);
  ok(JSON.stringify(await n(a)) === JSON.stringify(a), 'normalising twice changes nothing (idempotent)');
  // the hooks in logic.js (normalizeDay, dayData, buildCsv) are added by the integrator: check them when they are there
  const hooked = await pg.evaluate(() => !!normalizeDay('2026-01-01', { vals: {}, travel: { walk_min: 5 } }).travel);
  if (hooked) {
    const dd = await pg.evaluate(() => { const o = normalizeDay('2026-01-01', { vals: {}, travel: { walk_min: 5, bogus: 1, trips: [{ mode: 'x' }] } }); return [o.travel, dayData(o).travel]; });
    ok(dd[0].walk_min === 5 && !('bogus' in dd[0]) && dd[0].trips.length === 0 && dd[1] && dd[1].walk_min === 5, 'normalizeDay whitelists travel and the sync payload carries it', dd);
    const csv = await pg.evaluate(() => { days['2026-01-01'] = { vals: {}, rules: {}, weight: null, waist: null, note: 'trip day', date: '2026-01-01', updatedAt: 1, travel: { walk_min: 5, run_min: 1, bike_min: 2, vehicle_min: 30, trips: [{ mode: 'vehicle', start: 1.7e12, end: 1.7e12 + 6e5, min: 10, km: 4.5 }] } }; return buildCsv(); });
    ok(/Walk \(min\),Run \(min\),Bike \(min\),Vehicle \(min\),Vehicle \(km\)/.test(csv) && /5,1,2,30,4\.5/.test(csv), 'the CSV has the travel columns');
  } else console.log('  SKIP  logic.js hooks (normalizeDay, dayData, buildCsv) are not in yet');
  const cells = await pg.evaluate(() => [travelCsvCells({}), travelCsvCells({ travel: { walk_min: 5, run_min: 1, bike_min: 2, vehicle_min: 30, trips: [{ mode: 'vehicle', km: 4.5 }, { mode: 'vehicle', km: 1.25 }, { mode: 'bike', km: 9 }] } }), travelCsvCells({ travel: { walk_min: 5, trips: [{ mode: 'vehicle' }] } }), TRAVEL_CSV_HEAD]);
  ok(cells[0].join() === ',,,,' && cells[1].join() === '5,1,2,30,5.75' && cells[2][4] === '' && cells[3].join() === 'Walk (min),Run (min),Bike (min),Vehicle (min),Vehicle (km)', 'CSV cells: blank without travel, vehicle km summed (bike excluded)', cells);
  ok(errs.length === 0, 'no JS errors (normalize)', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
