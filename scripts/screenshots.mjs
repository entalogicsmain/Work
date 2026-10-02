// Takes the review screenshots for docs/screenshots (and for checking the UI by eye).
// Usage: node scripts/screenshots.mjs [outDir]
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MOCK } from '../test/helpers.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');
const OUT = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };
const srv = http.createServer((q, r) => {
  let f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (f.endsWith(path.sep)) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
const base = `http://localhost:${srv.address().port}/`;
const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function seedData() {
  const settings = { habits: [
    { id: 'steps', name: 'Steps', unit: 'steps', target: 8000 }, { id: 'walk', name: 'Brisk walk', unit: 'min', target: 30 },
    { id: 'pushups', name: 'Pushups', unit: 'reps', target: 30 }, { id: 'pullups', name: 'Pull-ups', unit: 'reps', target: 5 },
    { id: 'squats', name: 'Squats', unit: 'reps', target: 30 }, { id: 'plank', name: 'Plank', unit: 'sec', target: 60 },
    { id: 'water', name: 'Water', unit: 'litres', target: 2.5 }, { id: 'sleep', name: 'Sleep', unit: 'hours', target: 7 }],
  rules: [{ id: 'nofried', name: 'No fried food (zinger, fries, samosa)' }, { id: 'nosugar', name: 'No cold drinks, juice or sugar in tea' },
    { id: 'nomaida', name: 'No maida (buns, naan, bakery)' }, { id: 'nolate', name: 'Nothing eaten after 10 pm' }] };
  const days = {};
  const now = Date.now();
  for (let i = 1; i <= 44; i++) {
    if (i % 7 === 4 || i === 9) continue; // a few unlogged days
    const d = new Date(now - i * 864e5), k = ymd(d);
    const q = 0.45 + 0.5 * Math.abs(Math.sin(i * 1.7));
    days[k] = { vals: { steps: Math.round(9000 * q), walk: Math.round(35 * q), pushups: Math.round(34 * q), pullups: Math.round(6 * q), squats: Math.round(32 * q), plank: Math.round(70 * q), water: Math.round(2.8 * q * 4) / 4, sleep: Math.round(7.5 * q * 2) / 2 },
      rules: { nofried: q > .55, nosugar: q > .5, nomaida: q > .7, nolate: q > .6 }, weight: Math.round((89.4 - i * 0.07 + Math.sin(i) * 0.3) * 10) / 10, waist: i % 5 === 0 ? 97 - Math.round(i / 10) : null,
      note: i % 6 === 0 ? 'Daal and roti, walked after dinner' : '', date: k, updatedAt: now - i * 864e5 };
  }
  const t = ymd(new Date(now));
  days[t] = { vals: { steps: 5200, walk: 30, pushups: 30, water: 1.5 }, rules: { nofried: true, nosugar: true }, weight: 86.4, waist: null, note: 'Light lunch, long walk', date: t, updatedAt: now - 3e5 };
  return { version: 1, settings, days };
}
const SEED = seedData();
const FULL = JSON.parse(JSON.stringify(SEED));
{ const t = ymd(new Date()); FULL.days[t] = { ...FULL.days[t], vals: { steps: 9100, walk: 35, pushups: 32, pullups: 6, squats: 30, plank: 65, water: 2.5, sleep: 7.5 }, rules: { nofried: true, nosugar: true, nomaida: true, nolate: true } }; }

const SIZES = [[360, 800], [412, 915]];
let count = 0;
async function setup(browserCtxOpts, data, onboarded) {
  const ctx = await browser.newContext({ ...browserCtxOpts, deviceScaleFactor: 2 });
  await ctx.addInitScript(([d, ob]) => {
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('__seeded', '1');
      if (d) localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(d));
      if (ob) localStorage.setItem('CapacitorStorage.comeback_onboarded', '1');
    }
  }, [data, onboarded]);
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.COMEBACK_CONFIG={SUPABASE_URL:'https://x.supabase.test',SUPABASE_PUBLISHABLE_KEY:'k'}" }));
  await ctx.route(/supabase\.test/, r => r.abort('internetdisconnected'));
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  return { ctx, pg, errs };
}
const tab = (pg, t) => pg.click(`.tab[data-tab="${t}"]`);

for (const scheme of ['light', 'dark']) {
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}-${scheme}`;
    const snap = async (pg, name) => { await pg.waitForTimeout(450); await pg.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) }); count++; };
    const opts = { viewport: { width: w, height: h }, colorScheme: scheme };

    // onboarding (fresh install)
    { const { ctx, pg, errs } = await setup(opts, null, false);
      await pg.goto(base); await pg.waitForSelector('.onb'); await snap(pg, '01-onboarding-1-welcome');
      await pg.click('#onbNext'); await snap(pg, '02-onboarding-2-targets');
      await pg.click('#onbNext'); await snap(pg, '03-onboarding-3-reminder');
      await pg.click('#onbLater'); await pg.waitForTimeout(500);
      await snap(pg, '04-today-empty');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }

    // main flows with data
    { const { ctx, pg, errs } = await setup(opts, SEED, true);
      await pg.goto(base); await pg.waitForSelector('#habitList .hcard'); await pg.waitForTimeout(900);
      await snap(pg, '05-today');
      await pg.evaluate(() => window.scrollTo(0, 560)); await snap(pg, '06-today-scrolled');
      await pg.evaluate(() => window.scrollTo(0, 99999)); await snap(pg, '07-today-bottom');
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.click('#habitList .hcard:nth-child(3)'); await snap(pg, '08-sheet-number-keypad');
      await pg.click('.preset >> nth=0'); await pg.click('.sheet .txtbtn.strong'); await pg.waitForTimeout(500);
      await snap(pg, '09-today-after-edit-undo-toast');
      await pg.waitForTimeout(100);
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.dispatchEvent('#habitList .hcard:nth-child(1)', 'pointerdown'); await pg.waitForTimeout(700); await snap(pg, '10-action-sheet-presets');
      await pg.click('.asheet .cancel');
      await pg.evaluate(() => window.scrollTo(0, 99999)); await pg.waitForTimeout(300);
      await pg.click('#rowNote'); await snap(pg, '11-sheet-note'); await pg.click('.sheet .txtbtn:has-text("Cancel")');
      await pg.click('#rowWeight'); await snap(pg, '12-sheet-weight'); await pg.click('.sheet .txtbtn:has-text("Cancel")');
      await pg.evaluate(() => window.scrollTo(0, 0)); await pg.click('#dayLabel'); await snap(pg, '13-sheet-date'); await pg.click('.sheet .txtbtn:has-text("Cancel")');

      await tab(pg, 'progress'); await pg.waitForTimeout(900); await snap(pg, '14-progress-month');
      await pg.evaluate(() => window.scrollTo(0, 620)); await snap(pg, '15-progress-calendar');
      await pg.evaluate(() => window.scrollTo(0, 99999)); await snap(pg, '16-progress-recent');
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.click('#seg button[data-range="7"]'); await pg.waitForTimeout(700); await snap(pg, '17-progress-week');
      await pg.click('#seg button[data-range="90"]'); await pg.waitForTimeout(700); await snap(pg, '18-progress-3months');
      await pg.click('.chip:has-text("Weight")'); await pg.waitForTimeout(700);
      { const box = await pg.$eval('#chart', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
        await pg.evaluate(() => window.scrollTo(0, 200)); await pg.waitForTimeout(300);
        const b2 = await pg.$eval('#chart', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
        await pg.mouse.move(b2.x + b2.w * 0.62, b2.y + b2.h / 2); await snap(pg, '19-progress-chart-scrub'); void box; }
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.click('#seg button[data-range="30"]');
      await pg.evaluate(() => window.scrollTo(0, 560)); await pg.waitForTimeout(300);
      await pg.click('#heat .hc.g >> nth=3'); await snap(pg, '20-sheet-day');
      await pg.click('.sheet .txtbtn:has-text("Done")');

      await tab(pg, 'setup'); await pg.evaluate(() => window.scrollTo(0, 0)); await snap(pg, '21-plan-top');
      await pg.evaluate(() => window.scrollTo(0, 620)); await snap(pg, '22-plan-rules-reminder');
      await pg.evaluate(() => window.scrollTo(0, 1250)); await snap(pg, '23-plan-account-backup');
      await pg.evaluate(() => window.scrollTo(0, 99999)); await snap(pg, '24-plan-about');
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.click('#setHabits .swipe:nth-child(2) .row'); await snap(pg, '25-sheet-edit-target');
      await pg.click('#fRemove'); await snap(pg, '26-action-sheet-remove-confirm'); await pg.click('.asheet .cancel'); await pg.click('.sheet .txtbtn:has-text("Cancel")');
      await pg.click('#addHabitRow'); await snap(pg, '27-sheet-add-target'); await pg.click('.sheet .txtbtn:has-text("Cancel")');
      await pg.click('#reorderBtn'); await snap(pg, '28-plan-reorder-mode'); await pg.click('#reorderBtn');
      { const row = await pg.$('#setHabits .swipe:nth-child(3) .row'); const bb = await row.boundingBox();
        await pg.mouse.move(bb.x + bb.width - 20, bb.y + bb.height / 2); await pg.mouse.down(); await pg.mouse.move(bb.x + 40, bb.y + bb.height / 2, { steps: 6 }); await pg.mouse.up(); await snap(pg, '29-plan-swipe-to-remove'); }
      await pg.evaluate(() => window.scrollTo(0, 99999));
      await pg.evaluate(() => window.scrollTo(0, 1300));
      await pg.click('#signInBtn'); await snap(pg, '30-sheet-sign-in');
      await pg.fill('#authEmail', 'me@example.com'); await pg.fill('#authPw', 'secret12'); await pg.click('#authIn'); await pg.waitForTimeout(1200); await snap(pg, '31-sheet-sign-in-no-internet');
      await pg.click('#authCancel');
      await pg.setInputFiles('#restoreFile', { name: 'comeback-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(SEED)) });
      await pg.waitForSelector('.asheet'); await snap(pg, '32-action-sheet-restore');
      await pg.click('.asheet .ab:has-text("Continue")'); await pg.waitForTimeout(500); await snap(pg, '33-action-sheet-restore-mode');
      await pg.click('.asheet .cancel');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }

    // celebration + all done
    { const { ctx, pg, errs } = await setup(opts, FULL, true);
      await pg.goto(base); await pg.waitForSelector('#habitList .hcard'); await pg.waitForTimeout(1200); await snap(pg, '34-today-all-done'); if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }
  }
}


// ---------- automatic step tracking (Android app only: uses the mocked native bridge) ----------
const SEED_NO_STEPS_TODAY = JSON.parse(JSON.stringify(SEED)); delete SEED_NO_STEPS_TODAY.days[ymd(new Date())].vals.steps;
const HOURLY = Array.from({ length: 24 }, (_, i) => [0, 0, 0, 0, 0, 0, 180, 640, 420, 90, 60, 150, 380, 120, 80, 60, 140, 520, 1240, 610, 220, 90, 0, 0][i]);
for (const scheme of ['light', 'dark']) {
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}-${scheme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2 });
    await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
    await ctx.addInitScript(d => {
      if (!localStorage.getItem('__mock')) localStorage.setItem('__mock', JSON.stringify({ prefs: { comeback_onboarded: '1', comeback: JSON.stringify(d) }, fs: {}, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0,
        steps: { activityGranted: false, grantOnRequest: false, locationGranted: true, batteryIgnored: false, brand: 'xiaomi', health: 'working', source: 'counter', days: {}, filteredToday: 0, cfg: { enabled: false } } }));
    }, SEED_NO_STEPS_TODAY);
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    const snap = async (_p, name) => { await pg.waitForTimeout(450); await pg.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) }); count++; };
    const sheetOnly = text => pg.waitForFunction(t => { const a = document.querySelectorAll('.sheet'); return a.length === 1 && a[0].textContent.includes(t) && document.querySelector('.sheet-wrap.in'); }, text, { timeout: 6000 });
    const btn = label => pg.click(`.sheet .btn:has-text("${label}")`);
    const pickAction = async label => { await pg.click(`.asheet .ab:has-text("${label}")`); await pg.waitForFunction(() => !document.querySelector('.asheet'), null, { timeout: 4000 }); };
    const send = (days, health = 'working') => pg.evaluate(([d, hh]) => { window.__mock.steps({ days: d, health: hh }); window.__mock.fire('stepsChanged', { days: d, health: hh }); }, [days, health]);
    const tk = ymd(new Date());
    await pg.goto(base); await pg.waitForSelector('#habitList .hcard'); await pg.waitForTimeout(600);
    await tab(pg, 'setup'); await pg.evaluate(() => document.getElementById('stepHead').scrollIntoView({ block: 'start' })); await pg.evaluate(() => window.scrollBy(0, -70));
    await snap(pg, '40-plan-step-tracking-manual');
    // setup flow
    await pg.click('#stSource'); await snap(pg, '41-action-sheet-steps-source'); await pickAction('Automatic (phone sensor)');
    await sheetOnly('Count steps automatically'); await snap(pg, '42-sheet-steps-explain'); await btn('Continue');
    await sheetOnly('Permission needed'); await snap(pg, '43-sheet-steps-permission-needed');
    await pg.evaluate(() => window.__mock.steps({ activityGranted: true })); await btn('Try again');
    await sheetOnly('Keep counting all day'); await snap(pg, '44-sheet-steps-battery-xiaomi'); await btn('Skip for now');
    await sheetOnly('Your height'); await snap(pg, '45-sheet-steps-height'); await pg.click('.sheet .txtbtn.strong');
    await pg.waitForFunction(() => /Automatic/.test(document.getElementById('stSource').textContent)); await pg.waitForTimeout(500);
    await pg.evaluate(() => document.getElementById('stepHead').scrollIntoView({ block: 'start' })); await pg.evaluate(() => window.scrollBy(0, -70));
    await snap(pg, '46-plan-step-tracking-automatic');
    // counted steps on Today
    await tab(pg, 'today'); await send({ [tk]: { steps: 5320, filtered: 37, hourly: HOURLY } }); await pg.waitForTimeout(1200);
    await pg.evaluate(() => window.scrollTo(0, 0)); await snap(pg, '47-today-steps-counted-by-phone');
    await pg.click('#habitList .hcard:nth-child(1)'); await pg.waitForSelector('.keypad');
    for (const c of '8000') await pg.click(`.keypad .key[aria-label="${c}"]`);
    await pg.click('.sheet .txtbtn.strong'); await pg.waitForTimeout(700);
    await pg.click('#habitList .hcard:nth-child(1)'); await pg.waitForSelector('.keypad'); await snap(pg, '48-sheet-steps-use-counted');
    await pg.click('.sheet .btn:has-text("Use counted steps")'); await pg.waitForTimeout(800);
    // health states
    await tab(pg, 'setup');
    for (const [k, name] of [['paused_vehicle', '49-plan-health-in-vehicle'], ['paused_battery', '50-plan-health-battery'], ['permission_missing', '51-plan-health-permission']]) {
      await send({ [tk]: { steps: 5320, filtered: 37, hourly: HOURLY } }, k); await pg.waitForTimeout(400);
      await pg.evaluate(() => document.getElementById('stHealth').scrollIntoView({ block: 'center' })); await snap(pg, name);
    }
    await send({ [tk]: { steps: 5320, filtered: 37, hourly: HOURLY } }, 'working');
    // progress
    await tab(pg, 'progress'); await pg.waitForTimeout(900);
    await pg.click('.chip:has-text("Steps")'); await pg.waitForTimeout(500);
    await pg.evaluate(() => window.scrollTo(0, 0)); await snap(pg, '52-progress-average-steps');
    await pg.evaluate(() => document.getElementById('hoursHead').scrollIntoView({ block: 'start' })); await pg.evaluate(() => window.scrollBy(0, -70)); await snap(pg, '53-progress-steps-by-hour');
    if (errs.length) console.log('ERRORS', tag, errs);
    await ctx.close();
  }
}

// large text (130%) check on the main screens
for (const scheme of ['light', 'dark']) {
  const tag = `360x800-${scheme}-text130`;
  const { ctx, pg, errs } = await setup({ viewport: { width: 360, height: 800 }, colorScheme: scheme }, SEED, true);
  await pg.goto(base); await pg.waitForSelector('#habitList .hcard');
  await pg.addStyleTag({ content: 'html{font-size:130%}' }); await pg.waitForTimeout(900);
  const snap = async (_pg, name) => { await pg.waitForTimeout(350); await pg.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) }); count++; };
  await snap(pg, '35-today');
  const over = async n => { const o = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) console.log('HORIZONTAL OVERFLOW', o, 'on', n, tag); };
  await over('today');
  await tab(pg, 'progress'); await pg.waitForTimeout(800); await snap(pg, '36-progress'); await over('progress');
  await tab(pg, 'setup'); await snap(pg, '37-plan'); await over('plan');
  if (errs.length) console.log('ERRORS', tag, errs);
  await ctx.close();
}
await browser.close(); srv.close();
console.log('screenshots:', count, '->', OUT);

// shrink the PNGs so the repo stays small (palette PNG, visually identical for flat UI)
try {
  const { default: sharp } = await import('sharp');
  for (const f of fs.readdirSync(OUT).filter(x => x.endsWith('.png'))) {
    const p = path.join(OUT, f);
    const buf = await sharp(p).png({ palette: true, quality: 90, compressionLevel: 9, effort: 8 }).toBuffer();
    fs.writeFileSync(p, buf);
  }
} catch (e) { console.log('(skipped PNG optimisation:', e.message + ')'); }
