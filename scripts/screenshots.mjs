// Takes the review screenshots for docs/screenshots (and for checking the UI by eye), light and dark.
// Usage: node scripts/screenshots.mjs [outDir]
import { chromium } from 'playwright';
import sharp from 'sharp';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { MOCK } from '../test/helpers.mjs';

const Core = createRequire(import.meta.url)('../www/js/core.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', 'www');
const OUT = process.argv[2] || path.join(here, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|webp)$/.test(f)) fs.rmSync(path.join(OUT, f));   // start clean: the set always matches the current screens
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
const now = Date.now();
const TODAY = ymd(new Date(now));
const HOURS = [0, 0, 0, 0, 0, 0, 180, 640, 420, 90, 60, 150, 380, 120, 80, 60, 140, 520, 1240, 610, 220, 90, 0, 0];

/* A person with 44 days of history: weights drifting down, a waist now and then, a plan that mostly works. */
function seed({ mode = 'normal', height = 180, scale = 'standard', weightToday = true } = {}) {
  const s = Core.defaultSettings();
  s.body.heightCm = height; s.body.scale = scale;
  const med = Core.libEntry('meditation'); Core.addFromLibrary(s, med);
  const days = {};
  for (let i = 1; i <= 44; i++) {
    if ((i % 7 === 4 || i === 9) && !(mode === 'streak' && i <= 6)) continue;
    const k = ymd(new Date(now - i * 864e5)), q = 0.45 + 0.5 * Math.abs(Math.sin(i * 1.7));
    const hit = mode === 'streak' && i <= 6;
    days[k] = { vals: { steps: Math.round(9000 * q), walk: Math.round(35 * q), pushups: hit ? 31 : Math.round(34 * q), pullups: Math.round(6 * q), squats: Math.round(32 * q), plank: Math.round(70 * q), water: Math.round(2.8 * q * 4) / 4, sleep: Math.round(7.5 * q * 2) / 2 },
      rules: { nofried: q > .55, nosugar: q > .5, nomaida: q > .7, nolate: q > .6 }, weight: Math.round((89.4 - i * 0.07 + Math.sin(i) * 0.3) * 10) / 10, waist: i % 5 === 0 ? 97 - Math.round(i / 10) : null,
      note: i % 6 === 0 ? 'Daal and roti, walked after dinner' : '', date: k, updatedAt: now - i * 864e5 };
    days[k].steps_meta = { source: 'auto', counted: days[k].vals.steps, distance_km: Math.round(days[k].vals.steps * height * 0.415 / 1000) / 100, filtered: 12, hourly: HOURS };
  }
  const today = mode === 'done'
    ? { vals: { steps: 9100, walk: 35, pushups: 32, pullups: 6, squats: 30, plank: 65, water: 2.5, sleep: 7.5, meditation: 10 }, rules: { nofried: true, nosugar: true, nomaida: true, nolate: true } }
    : mode === 'empty' ? { vals: {}, rules: {} }
    : { vals: { steps: 5200, walk: 30, pushups: 18, water: 1.5, sleep: 7.5 }, rules: { nofried: true, nosugar: true } };
  days[TODAY] = { ...today, weight: weightToday ? 86.4 : null, waist: null, note: mode === 'empty' ? '' : 'Light lunch, long walk', date: TODAY, updatedAt: now - 3e5,
    steps_meta: { source: 'auto', counted: today.vals.steps || 0, distance_km: Math.round((today.vals.steps || 0) * height * 0.415 / 1000) / 100, filtered: 12, hourly: HOURS } };
  if (!weightToday) for (const k of Object.keys(days)) days[k].weight = null;
  return { version: 2, settings: s, days };
}

let count = 0;
async function setup(opts, { data, onboarded = true, native = false, stepsToday = 0 } = {}) {
  const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1.5 });
  if (native) await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.COMEBACK_CONFIG={SUPABASE_URL:'https://x.supabase.test',SUPABASE_PUBLISHABLE_KEY:'k'}" }));
  await ctx.route(/supabase\.test/, r => r.abort('internetdisconnected'));
  await ctx.addInitScript(([d, ob, nat, steps, hours]) => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    if (nat) {
      const prefs = {}; if (ob) prefs.comeback_onboarded = '1'; if (d) prefs.comeback = JSON.stringify(d);
      if (d) prefs.comeback_meta = JSON.stringify({ lastBackup: Date.now() - 36e5, reminder: { enabled: true, time: '21:00' }, steps: { heightCm: d.settings.body.heightCm || 180, strictness: 'balanced', sensitivity: 'normal', useLocation: false, enabledAt: Date.now() - 864e5 * 30, setupShown: true }, heightChecked: true });
      const days = {}; const t = new Date(); const k = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
      days[k] = { steps, filtered: 12, hourly: hours };
      localStorage.setItem('__mock', JSON.stringify({ prefs, fs: {}, calls: [], perm: 'granted', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0, steps: { activityGranted: true, locationGranted: true, batteryIgnored: true, brand: 'other', health: 'working', source: 'counter', days, filteredToday: 12, cfg: { enabled: false } } }));
    } else {
      if (d) localStorage.setItem('CapacitorStorage.comeback', JSON.stringify(d));
      if (ob) localStorage.setItem('CapacitorStorage.comeback_onboarded', '1');
    }
  }, [data, onboarded, native, stepsToday, HOURS]);
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  return { ctx, pg, errs };
}
const tab = (pg, t) => pg.click(`.tab[data-tab="${t}"]`);
const gear = async pg => { if (await pg.isVisible('#gearBtn')) await pg.click('#gearBtn'); await pg.waitForSelector('#p-settings.on'); };
const closeSheet = async pg => { await pg.click('.sheet .txtbtn.strong, .sheet .txtbtn:has-text("Cancel")'); await pg.waitForFunction(() => !document.querySelector('.sheet-wrap')); };
const openBody = async pg => { const t = '.tsec[data-sec="body"] .tsec-toggle[aria-expanded="false"]'; if (await pg.$(t)) await pg.click(t); await pg.waitForTimeout(250); };

const SIZES = [[360, 800]];
for (const scheme of ['light', 'dark']) {
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}-${scheme}`;
    const opts = { viewport: { width: w, height: h }, colorScheme: scheme };
    const snapper = pg => async name => { await pg.waitForTimeout(500); await pg.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) }); count++; };

    // first launch in a browser: welcome, starter plans, targets, reminder, height, BMI scale
    { const { ctx, pg, errs } = await setup(opts, { onboarded: false }); const snap = snapper(pg);
      await pg.goto(base); await pg.waitForSelector('.onb'); await snap('01-onboarding-welcome');
      await pg.click('#onbNext'); await snap('02-onboarding-starter-plans');
      await pg.click('#plan-beginner'); await snap('03-onboarding-starter-plan-picked');
      await pg.click('#onbNext'); await snap('04-onboarding-targets');
      await pg.click('#onbNext'); await snap('05-onboarding-reminder');
      await pg.click('#onbNext'); await pg.fill('#onbHeight', '180'); await snap('06-onboarding-height');
      await pg.click('#onbNext'); await pg.click('#scale-asian'); await snap('07-onboarding-bmi-scale');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }

    // first launch in the Android app: the one permission screen
    { const { ctx, pg, errs } = await setup(opts, { onboarded: false, native: true }); const snap = snapper(pg);
      await pg.goto(base); await pg.waitForSelector('.onb');
      await pg.click('#onbNext'); await pg.click('#plan-desk'); await pg.click('#onbNext'); await pg.click('#onbNext'); await pg.click('#onbNext'); await pg.waitForSelector('#onbAllow'); await snap('08-onboarding-permissions');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }

    // Today, Plan, Settings, Progress, BMI with a person who has history (Android app, so Steps is live)
    { const { ctx, pg, errs } = await setup(opts, { data: seed(), native: true, stepsToday: 5200 }); const snap = snapper(pg);
      await pg.goto(base); await pg.waitForSelector('#sections .titem'); await pg.waitForTimeout(1500);
      await snap('10-today');
      await pg.evaluate(() => window.scrollTo(0, 620)); await snap('11-today-scrolled');
      await pg.evaluate(() => window.scrollTo(0, 99999)); await snap('12-today-bottom');
      await pg.evaluate(() => window.scrollTo(0, 0));
      await openBody(pg); await pg.evaluate(() => document.querySelector('#rowBmi').scrollIntoView({ block: 'center' })); await snap('13-today-body-bmi');
      await pg.evaluate(() => window.scrollTo(0, 0));
      // edit mode
      await pg.dispatchEvent('#sections .hcard[data-id="pushups"] .hc-main', 'pointerdown'); await pg.waitForSelector('#editBar:not([hidden])'); await pg.waitForTimeout(300);
      await snap('14-today-edit-mode');
      await pg.evaluate(() => window.scrollTo(0, 560)); await snap('15-today-edit-mode-scrolled');
      await pg.click('#sections .tsec[data-sec="workout"] .sec-add'); await pg.waitForSelector('.library'); await snap('16-habit-library');
      await pg.fill('#libSearch', 'wal'); await snap('17-habit-library-search');
      await pg.click('.sheet .txtbtn.strong'); await pg.waitForFunction(() => !document.querySelector('.sheet-wrap'));
      await pg.evaluate(() => window.scrollTo(0, 0)); await pg.click('#editDone'); await pg.waitForTimeout(300);
      await tab(pg, 'setup'); await pg.waitForTimeout(400);
      await snap('20-plan');
      await pg.evaluate(() => window.scrollTo(0, 700)); await snap('21-plan-scrolled');
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.click('#createHabitRow'); await pg.waitForSelector('#fName'); await pg.fill('#fName', 'Guitar practice'); await pg.click('#fType button[data-type="duration"]'); await pg.fill('#fTarget', '20'); await pg.click('#fSched button[data-kind="days"]'); await snap('22-create-your-own');
      await pg.evaluate(() => document.querySelector('.sheet-body').scrollTo(0, 9999)); await snap('23-create-your-own-bottom');
      await pg.click('.sheet .txtbtn:has-text("Cancel")'); await pg.waitForFunction(() => !document.querySelector('.sheet-wrap'));
      await gear(pg); await pg.waitForTimeout(500);
      await snap('30-settings');
      await pg.evaluate(() => window.scrollTo(0, 620)); await snap('31-settings-scrolled');
      await pg.click('#advToggle'); await pg.evaluate(() => document.querySelector('#advToggle').scrollIntoView({ block: 'start' })); await snap('32-settings-advanced');
      await pg.evaluate(() => window.scrollTo(0, 99999)); await snap('33-settings-bottom');
      await pg.click('#navBack');
      await tab(pg, 'progress'); await pg.waitForTimeout(900);
      await snap('40-progress');
      await pg.evaluate(() => document.querySelector('#bmiCard').scrollIntoView({ block: 'start' })); await pg.evaluate(() => window.scrollBy(0, -70)); await snap('41-progress-bmi-card');
      await pg.click('#bmiOpen'); await pg.waitForSelector('.bmi-sheet'); await pg.waitForTimeout(700); await snap('42-bmi-sheet');
      await pg.evaluate(() => document.querySelector('.sheet-body').scrollTo(0, 420)); await snap('43-bmi-sheet-middle');
      await pg.evaluate(() => document.querySelector('.sheet-body').scrollTo(0, 99999)); await pg.fill('#qCm', '170'); await pg.fill('#qW', '70'); await snap('44-bmi-sheet-calculator');
      await pg.click('.sheet .txtbtn.strong'); await pg.waitForFunction(() => !document.querySelector('.sheet-wrap'));
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }

    // the Asian scale: same body, different category
    { const { ctx, pg, errs } = await setup(opts, { data: seed({ scale: 'asian', height: 180 }), native: true, stepsToday: 5200 }); const snap = snapper(pg);
      await pg.goto(base); await pg.waitForSelector('#sections .titem'); await tab(pg, 'progress'); await pg.waitForTimeout(900);
      await pg.evaluate(() => document.querySelector('#bmiCard').scrollIntoView({ block: 'start' })); await pg.evaluate(() => window.scrollBy(0, -70)); await snap('45-progress-bmi-card-asian');
      await pg.click('#bmiOpen'); await pg.waitForSelector('.bmi-sheet'); await pg.waitForTimeout(700); await snap('46-bmi-sheet-asian');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }

    // no weight yet / no height yet
    { const { ctx, pg, errs } = await setup(opts, { data: seed({ weightToday: false }), native: true, stepsToday: 5200 }); const snap = snapper(pg);
      await pg.goto(base); await pg.waitForSelector('#sections .titem'); await tab(pg, 'progress'); await pg.waitForTimeout(900);
      await pg.evaluate(() => document.querySelector('#bmiCard').scrollIntoView({ block: 'start' })); await pg.evaluate(() => window.scrollBy(0, -70)); await snap('47-bmi-no-weight');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }

    // finished cards shrink to one line
    { const { ctx, pg, errs } = await setup(opts, { data: seed({ mode: 'done' }), native: true, stepsToday: 9100 }); const snap = snapper(pg);
      await pg.goto(base); await pg.waitForSelector('#sections .titem'); await pg.waitForTimeout(1500); await snap('50-today-all-done');
      await pg.click('#sections .drow[data-id="pushups"]'); await pg.waitForTimeout(300); await snap('51-today-one-card-opened');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }
    { const { ctx, pg, errs } = await setup(opts, { data: seed({ mode: 'normal' }), native: true, stepsToday: 5200 }); const snap = snapper(pg);
      await pg.goto(base); await pg.waitForSelector('#sections .titem'); await pg.waitForTimeout(1200);
      await pg.evaluate(() => window.scrollTo(0, 420)); await snap('52-today-some-done');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }

    // target suggestion
    { const { ctx, pg, errs } = await setup(opts, { data: seed({ mode: 'streak' }), native: true, stepsToday: 5200 }); const snap = snapper(pg);
      await pg.goto(base); await pg.waitForSelector('#suggestCard'); await pg.waitForTimeout(800); await snap('53-today-target-suggestion');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }

    // an empty plan ("Start from scratch")
    { const s = seed({ mode: 'empty' }); s.settings = Core.applyStarterPlan(Core.defaultSettings(), 'scratch'); s.days = {};
      const { ctx, pg, errs } = await setup(opts, { data: s }); const snap = snapper(pg);
      await pg.goto(base); await pg.waitForSelector('#todayEmpty'); await snap('54-today-start-from-scratch');
      if (errs.length) console.log('ERRORS', tag, errs); await ctx.close(); }
  }

  // tablet and large screens
  for (const [w, h] of [[1024, 768], [600, 960]]) {
    const tag = `${w}x${h}-${scheme}`;
    const snapper = pg => async name => { await pg.waitForTimeout(500); await pg.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) }); count++; };
    const { ctx, pg, errs } = await setup({ viewport: { width: w, height: h }, colorScheme: scheme }, { data: seed(), native: true, stepsToday: 5200 }); const snap = snapper(pg);
    await pg.goto(base); await pg.waitForSelector('#sections .titem'); await pg.waitForTimeout(1500); await snap('60-wide-today');
    await tab(pg, 'progress'); await pg.waitForTimeout(900); await snap('61-wide-progress');
    await tab(pg, 'setup'); await snap('62-wide-plan');
    await gear(pg); await snap('63-wide-settings');
    await pg.click('#navBack'); await tab(pg, 'progress'); await pg.click('#bmiOpen'); await pg.waitForSelector('.bmi-sheet'); await pg.waitForTimeout(600); await snap('64-wide-bmi-sheet');
    if (errs.length) console.log('ERRORS', tag, errs); await ctx.close();
  }
}

// PNG -> WebP (smaller in the repo), keep nothing else
for (const f of fs.readdirSync(OUT)) {
  if (!f.endsWith('.png')) continue;
  const p = path.join(OUT, f);
  fs.writeFileSync(p.replace(/\.png$/, '.webp'), await sharp(p).webp({ quality: 80, effort: 5 }).toBuffer());
  if (process.env.KEEP_PNG !== '1') fs.rmSync(p);
}
console.log(`${count} screenshots in ${OUT}`);
await browser.close(); srv.close();
