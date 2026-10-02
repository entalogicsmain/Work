// Responsive and glass checks across phone, foldable, tablet, landscape and desktop sizes, in light and dark.
// For every size: no sideways scrolling, nothing sticks out of the screen, the right navigation (bottom pill or side rail),
// the last item can scroll clear of the bars, big tap targets, sheets fit on screen, and 130% text still fits.
// Run: npm run test:responsive
import { serve, launch, counter, newPage, tab, gear, ready, sheetGone, todayKey } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const browser = await launch();

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const settings = { habits: [
  { id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }, { id: 'walk', name: 'Brisk walk', unit: 'min', target: 30 }, { id: 'pushups', name: 'Pushups', unit: 'reps', target: 30 },
  { id: 'pullups', name: 'Pull-ups', unit: 'reps', target: 5 }, { id: 'squats', name: 'Squats', unit: 'reps', target: 30 }, { id: 'plank', name: 'Plank', unit: 'sec', target: 60 },
  { id: 'water', name: 'Water', unit: 'litres', target: 2.5 }, { id: 'sleep', name: 'Sleep', unit: 'hours', target: 7 }],
  rules: [{ id: 'nofried', name: 'No fried food (zinger, fries, samosa)' }, { id: 'nosugar', name: 'No cold drinks, juice or sugar in tea' }, { id: 'nomaida', name: 'No maida (buns, naan, bakery)' }, { id: 'nolate', name: 'Nothing eaten after 10 pm' }] };
const days = {}; const now = Date.now();
for (let i = 0; i < 40; i++) { const k = ymd(new Date(now - i * 864e5)); const q = .45 + .5 * Math.abs(Math.sin(i * 1.7));
  days[k] = { vals: { steps: Math.round(9000 * q), walk: Math.round(35 * q), pushups: Math.round(34 * q), pullups: Math.round(6 * q), squats: Math.round(32 * q), plank: Math.round(70 * q), water: Math.round(2.8 * q * 10) / 10, sleep: Math.round(8 * q * 10) / 10 },
    rules: { nofried: q > .55, nosugar: q > .5, nomaida: q > .7, nolate: q > .6 }, weight: Math.round((89 - i * .07) * 10) / 10, waist: null, note: i % 6 === 0 ? 'A long note about the day that has plenty of words in it so it has to wrap on narrow phones' : '', date: k, updatedAt: now - i * 864e5 }; }
const DATA = { version: 1, settings, days };

const SIZES = [[280, 653, 'folded cover screen'], [320, 568, 'small phone'], [360, 800, 'phone'], [412, 915, 'large phone'], [600, 960, 'small tablet'], [768, 1024, 'tablet portrait'],
  [1024, 768, 'tablet landscape'], [915, 412, 'phone landscape'], [1280, 800, 'laptop'], [1920, 1080, 'desktop']];

async function open(w, h, scheme, extra) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 900, isMobile: false });
  await ctx.addInitScript(d => { if (!localStorage.getItem('__s')) { localStorage.setItem('__s', '1'); localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(d)); localStorage.setItem('CapacitorStorage.comeback_onboarded', '1'); } }, DATA);
  if (extra) await ctx.addInitScript(extra);
  const pg = await newPage(ctx, errs);
  await pg.goto(base); await ready(pg); await pg.waitForTimeout(600);
  return { ctx, pg, errs };
}
const overflow = pg => pg.evaluate(() => {
  const vw = document.documentElement.clientWidth, out = [];
  for (const el of document.querySelectorAll('.screen.on *, .navbar *, .tabbar *')) {
    if (el.closest('.chips') || el.closest('svg') || el.tagName === 'CANVAS') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el); if (cs.position === 'fixed' && !el.closest('.navbar,.tabbar')) continue;
    if (r.right > vw + 1 || r.left < -1) out.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ' ' + Math.round(r.left) + '-' + Math.round(r.right));
  }
  return { sw: document.documentElement.scrollWidth, vw, out: out.slice(0, 4) };
});

for (const scheme of ['light', 'dark']) {
  console.log(`\n== ${scheme} mode`);
  for (const [w, h, label] of SIZES) {
    const { ctx, pg, errs } = await open(w, h, scheme);
    const name = `${w}x${h} ${label}, ${scheme}`;
    // navigation style
    const nav = await pg.evaluate(() => { const r = document.querySelector('.tabbar-in').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, vh: innerHeight, vw: innerWidth }; });
    if (w >= 840) ok(nav.l < 130 && nav.h > nav.w * 0.9 || nav.h > 120, `${name}: navigation is a side rail`, nav);
    else ok(nav.t > nav.vh / 2 && nav.w <= nav.vw, `${name}: navigation is a floating bar at the bottom`, nav);
    for (const t of ['today', 'progress', 'setup', 'settings']) {
      if (t === 'settings') await gear(pg); else await tab(pg, t);
      await pg.waitForTimeout(450);
      const o = await overflow(pg);
      ok(o.sw <= o.vw && o.out.length === 0, `${name}: ${t} has no sideways overflow`, o);
      // scroll to the bottom: the last thing must clear the bars
      await pg.evaluate(() => window.scrollTo(0, 1e6)); await pg.waitForTimeout(250);
      const clear = await pg.evaluate(() => {
        const tb = document.querySelector('.tabbar-in').getBoundingClientRect();
        const items = [...document.querySelectorAll('.screen.on .group, .screen.on .group-foot, .screen.on .card, .screen.on .hcard, .screen.on .yrow, .screen.on .drow, .screen.on .mrow, .screen.on .today-foot')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().height > 0);
        const last = items.map(e => e.getBoundingClientRect().bottom).sort((a, b) => b - a)[0];
        const railed = tb.height > tb.width;
        return { last, barTop: tb.top, railed, vh: innerHeight };
      });
      ok(clear.railed ? clear.last <= clear.vh + 1 : clear.last <= clear.barTop + 1, `${name}: ${t} last item scrolls clear of the bars`, clear);
      await pg.evaluate(() => window.scrollTo(0, 0));
    }
    // tap targets on Today
    await tab(pg, 'today'); await pg.waitForTimeout(300);
    const small = await pg.evaluate(() => [...document.querySelectorAll('.tab,.hcard,.hc-main,.cbtn,.drow,.iconbtn,.daypill,.txtbtn')].filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return { n: (e.className || e.tagName).toString().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.w < 44 || x.h < 44));
    ok(small.length === 0, `${name}: tap targets are at least 44 px`, small.slice(0, 4));
    // a sheet fits on screen and its Done button can be reached
    await pg.click('#sections .hcard[data-id="pushups"] .hc-main'); await pg.waitForSelector('.keypad'); await pg.waitForTimeout(600);
    const sh = await pg.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); const d = document.querySelector('.sheet .txtbtn.strong').getBoundingClientRect(); return { top: Math.round(s.top), bottom: Math.round(s.bottom), left: Math.round(s.left), right: Math.round(s.right), vh: innerHeight, vw: innerWidth, doneTop: Math.round(d.top), doneBottom: Math.round(d.bottom) }; });
    ok(sh.top >= 0 && sh.bottom <= sh.vh + 1 && sh.left >= -1 && sh.right <= sh.vw + 1 && sh.doneTop >= 0 && sh.doneBottom <= sh.vh, `${name}: the number sheet fits on screen`, sh);
    const reach = await pg.evaluate(() => { const k = document.querySelector('.keypad .key[aria-label="0"]'); k.scrollIntoView({ block: 'nearest' }); const r = k.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === k || k.contains(hit)) && r.bottom <= innerHeight + 1; });
    ok(reach, `${name}: keypad keys can be pressed`);
    await pg.click('.sheet .txtbtn:has-text("Cancel")'); await sheetGone(pg);
    ok(errs.length === 0, `${name}: no page errors`, errs);
    await ctx.close();
  }
}

// ---- larger text still fits (130%, 160% and 200%) ----
for (const [w, h] of [[320, 568], [360, 800], [412, 915]]) for (const scale of [130, 160, 200]) {
  const { ctx, pg } = await open(w, h, 'light');
  await pg.addStyleTag({ content: `html{font-size:${scale}% !important}` }); await pg.waitForTimeout(300);
  let bad = [];
  for (const t of ['today', 'progress', 'setup', 'settings']) { if (t === 'settings') await gear(pg); else await tab(pg, t); await pg.waitForTimeout(350); const o = await overflow(pg); if (o.sw > o.vw || o.out.length) bad.push([t, o]); }
  ok(bad.length === 0, `${w}x${h} at ${scale}% text: nothing overflows sideways`, bad);
  await ctx.close();
}

// ---- glass look ----
{
  const { ctx, pg } = await open(412, 915, 'light', () => { Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 }); });
  const g = await pg.evaluate(() => {
    const cs = e => getComputedStyle(e);
    const f = e => (cs(e).backdropFilter || cs(e).webkitBackdropFilter || 'none');
    return { card: f(document.querySelector('.ringcard')), hcard: f(document.querySelector('.hcard')), pill: f(document.querySelector('.tabbar-in')),
      cardBg: cs(document.querySelector('.hcard')).backgroundColor, bodyAurora: getComputedStyle(document.body, '::before').backgroundImage.includes('radial-gradient'), border: cs(document.querySelector('.hcard')).borderTopWidth };
  });
  ok(g.card === 'none' && g.hcard === 'none' && /blur/.test(g.pill), 'glass: cards are plain translucent (no backdrop blur); the tab bar blurs what is behind it', g);
  ok(/rgba\(/.test(g.cardBg) && g.cardBg.endsWith('0.72)') , 'glass: card surfaces are translucent', g.cardBg);
  ok(g.bodyAurora && g.border === '1px', 'glass: aurora backdrop and edge border are in place', g);
  await ctx.close();
}
{
  const { ctx, pg } = await open(412, 915, 'light', () => { Object.defineProperty(navigator, 'deviceMemory', { value: 2 }); });
  const lite = await pg.evaluate(() => ({ cls: document.documentElement.classList.contains('lite'), hcard: getComputedStyle(document.querySelector('.hcard')).backdropFilter, pill: getComputedStyle(document.querySelector('.tabbar-in')).backdropFilter, glass: getComputedStyle(document.documentElement).getPropertyValue('--glass').trim() }));
  ok(lite.cls && lite.hcard === 'none' && lite.pill === 'none', 'low-end phones: no blur anywhere, the bars turn solid', lite);
  await ctx.close();
}
// the aurora backdrop must not scroll or move with content
{
  const { ctx, pg } = await open(360, 800, 'dark');
  const pos = await pg.evaluate(() => getComputedStyle(document.body, '::before').position);
  ok(pos === 'fixed', 'glass: the backdrop stays fixed while content scrolls', pos);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
