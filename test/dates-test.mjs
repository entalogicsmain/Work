// Dates: calendar-day maths that must not care about daylight-saving changes (run under several time zones), "Yesterday" right after a
// clock change, and the midnight rollover while the app stays open (a faked clock in a browser set to New York).
// Run: npm run test:dates
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { serve, launch, counter, newPage, skipOnboarding, ready, stored, settle } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const corePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www', 'js', 'core.js');
const KEY = 'CapacitorStorage.comeback';
const Core = createRequire(import.meta.url)('../www/js/core.js');

/* ---------- Core date maths under different time zones (a child process per zone, TZ set before node starts) ---------- */
console.log('Calendar maths in other time zones');
const CHECK = `
const C=require(${JSON.stringify(corePath)});
const utc=(k,n)=>{const p=k.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2]+n)).toISOString().slice(0,10)};
const dowOf=k=>{const p=k.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2])).getUTCDay()};
const bad=[];let k='2024-01-01';
for(let i=0;i<1100;i++){
  const next=utc(k,1);
  if(C.addDays(k,1)!==next)bad.push(['+1',k,C.addDays(k,1),next]);
  if(C.addDays(next,-1)!==k)bad.push(['-1',next,C.addDays(next,-1),k]);
  if(C.addDays(k,7)!==utc(k,7))bad.push(['+7',k]);
  if(C.addDays(k,-30)!==utc(k,-30))bad.push(['-30',k]);
  if(C.daysBetween(k,next)!==1||C.daysBetween(next,k)!==-1)bad.push(['between',k]);
  if(C.dow(k)!==dowOf(k))bad.push(['dow',k]);
  const ws=C.weekStart(k);if(dowOf(ws)!==1||C.daysBetween(ws,k)<0||C.daysBetween(ws,k)>6)bad.push(['weekStart',k,ws]);
  if(C.ymd(C.parse(k))!==k)bad.push(['roundtrip',k]);
  k=next;
}
const all=[C.daysBetween('2026-01-01','2027-01-01'),C.daysBetween('2026-03-07','2026-03-09'),C.daysBetween('2026-10-31','2026-11-02')];
console.log(JSON.stringify({bad:bad.slice(0,3),n:bad.length,all}));
`;
for (const tz of ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Pacific/Auckland', 'Australia/Lord_Howe', 'America/Sao_Paulo', 'America/Santiago', 'Africa/Cairo', 'UTC']) {
  let out;
  try { out = JSON.parse(execFileSync(process.execPath, ['-e', CHECK], { env: { ...process.env, TZ: tz }, encoding: 'utf8' })); } catch (e) { out = { n: -1, err: String(e.message).slice(0, 200) }; }
  ok(out.n === 0 && out.all.join() === '365,2,2', `${tz}: addDays, daysBetween, weekStart and weekdays are exact for 3 years`, out);
}

/* ---------- the browser, in New York, with a faked clock ---------- */
const browser = await launch();
const day = (k, vals = {}, rules = {}) => ({ vals, rules, weight: null, waist: null, note: '', date: k, updatedAt: 1e12 });
async function open(now, days) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'America/New_York', locale: 'en-US' });
  await skipOnboarding(ctx);
  if (days) await ctx.addInitScript(([d, key]) => { if (!localStorage.getItem('__d')) { localStorage.setItem('__d', '1'); localStorage.setItem(key, JSON.stringify(d)); } }, [{ version: 2, settings: Core.defaultSettings(), days }, KEY]);
  const pg = await newPage(ctx, errs);
  await pg.clock.install({ time: new Date(now) });
  await pg.goto(base); await ready(pg);
  return { ctx, pg, errs };
}
const full = k => day(k, { pushups: 30, pullups: 5, squats: 30, plank: 60, walk: 30, water: 2.5, sleep: 7 }, { nofried: true, nosugar: true, nomaida: true, nolate: true });

console.log('"Yesterday" right after a clock change');
{
  // New York springs forward on 2026-03-08 at 2 am. It is now 12:30 am on the 9th (04:30 UTC): 24 hours earlier is still the 7th.
  const { ctx, pg, errs } = await open('2026-03-09T04:30:00Z');
  const r = await pg.evaluate(() => ({ today: todayStr(), y: relLabel('2026-03-08'), d7: relLabel('2026-03-07'), t: relLabel('2026-03-09') }));
  ok(r.today === '2026-03-09' && r.t === 'Today', 'the faked clock says 9 March', r);
  ok(r.y === 'Yesterday', '8 March is "Yesterday" on 9 March, even though 24 hours back lands on the 7th', r);
  ok(r.d7 !== 'Yesterday', 'and 7 March is not', r);
  await pg.click('#prevDay');
  ok((await pg.textContent('#dayLabelText')) === 'Yesterday', 'the day picker label says Yesterday after stepping back');
  ok(errs.length === 0, 'no JS errors', errs);
  await ctx.close();
}
{
  // and after the clocks go back (2026-11-01 at 2 am)
  const { ctx, pg, errs } = await open('2026-11-02T00:30:00-05:00');
  const r = await pg.evaluate(() => ({ y: relLabel('2026-11-01'), d: relLabel('2026-10-31'), c: comebackDay('2026-11-02') }));
  ok(r.y === 'Yesterday' && r.d !== 'Yesterday', '"Yesterday" is right after the clocks go back too', r);
  await ctx.close();
}
{
  // the comeback day counter counts calendar days across a clock change
  const { ctx, pg } = await open('2026-03-10T12:00:00-04:00', { '2026-03-07': day('2026-03-07', { pushups: 5 }) });
  ok(await pg.evaluate(() => comebackDay('2026-03-10')) === 4, 'Day 4 of the comeback is 3 calendar days after the first log, across the spring change');
  await ctx.close();
}

console.log('Midnight with the app open');
{
  const days = { '2026-10-01': full('2026-10-01'), '2026-09-30': full('2026-09-30') };
  const { ctx, pg, errs } = await open('2026-10-02T23:59:30-04:00', days);
  ok(/October 2/.test(await pg.textContent('#todayTitle')) && (await pg.textContent('#dayLabelText')) === 'Today', 'before midnight it is 2 October');
  ok(/2-day streak · today still open/.test(await pg.textContent('#streakLine')), 'the streak line says the day is still open', await pg.textContent('#streakLine'));
  await pg.clock.runFor(61000);
  const now = await pg.evaluate(() => ({ cur: current, today: todayStr() }));
  ok(now.today === '2026-10-03' && now.cur === '2026-10-03', 'after the minute timer fires, the screen moves to 3 October', now);
  ok(/October 3/.test(await pg.textContent('#todayTitle')) && (await pg.textContent('#dayLabelText')) === 'Today', 'the title and the Today label follow');
  ok(/Start again today/.test(await pg.textContent('#streakLine')), 'a missed 2 October ends the streak: "Start again today"', await pg.textContent('#streakLine'));
  ok(await pg.$eval('#nextDay', e => e.disabled), 'you cannot go past today');
  ok(errs.length === 0, 'no JS errors', errs);
  await ctx.close();
}
{
  // viewing yesterday at midnight: the screen stays where the person is
  const { ctx, pg } = await open('2026-10-02T23:59:30-04:00');
  await pg.click('#prevDay');
  ok(await pg.evaluate(() => current) === '2026-10-01', 'viewing 1 October');
  await pg.clock.runFor(61000);
  ok(await pg.evaluate(() => current) === '2026-10-01', 'midnight does not move you off the day you are looking at');
  ok((await pg.textContent('#dayLabelText')) !== 'Today' && !(await pg.$eval('#nextDay', e => e.disabled)), '1 October is no longer "Yesterday" and the arrow forward works');
  await ctx.close();
}
{
  // a tap after midnight, before any timer ran, lands on the new day (commitDay rolls the day forward first)
  const { ctx, pg, errs } = await open('2026-10-02T23:59:50-04:00');
  await pg.clock.setSystemTime(new Date('2026-10-03T00:00:20-04:00'));
  await pg.click('#sections .hcard[data-id="pushups"] .cbtn.plus');
  await pg.clock.runFor(1500);
  const st = await stored(pg);
  ok(st && st.days['2026-10-03'] && st.days['2026-10-03'].vals.pushups === 1 && !st.days['2026-10-02'], 'the change is saved on 3 October, not on the day the screen still showed', st && Object.keys(st.days));
  ok(await pg.evaluate(() => current) === '2026-10-03' && /October 3/.test(await pg.textContent('#todayTitle')), 'and the screen shows 3 October');
  ok(errs.length === 0, 'no JS errors', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
