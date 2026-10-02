// End-to-end test against the REAL Supabase project configured in www/config.js.
// Needs E2E_EMAIL / E2E_PASSWORD of an existing confirmed user. Run: npm run test:real
import fs from 'fs';
import { chromium } from 'playwright';
import { serve, counter, newPage, skipOnboarding, tab, ready, stored, logDay, goDate, daysAgo, todayKey } from './helpers.mjs';

const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const EMAIL = process.env.E2E_EMAIL, PW = process.env.E2E_PASSWORD;
if (!EMAIL || !PW) { console.error('Set E2E_EMAIL and E2E_PASSWORD'); process.exit(2); }

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, proxy });
const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
await skipOnboarding(ctx);
let blocked = false;
// The sandbox browser doesn't trust the egress proxy's CA, so Supabase calls are made from Node
// (which does) and handed back to the page. The page still talks to the real project.
await ctx.route(/supabase\.co/, async r => {
  if (blocked) return r.abort('internetdisconnected');
  try { await r.fulfill({ response: await r.fetch() }); } catch (e) { await r.abort('failed'); }
});
const errs = [];
const pg = await newPage(ctx, errs);
const status = () => pg.textContent('#syncStatus');
const waitStatus = (re, t = 25000) => pg.waitForFunction(r => new RegExp(r).test(document.getElementById('syncStatus').textContent), re.source, { timeout: t }).catch(async e => { console.log('  (status was: ' + (await status()) + ')'); throw e; });
const authMsg = () => pg.$eval('#authMsg', e => ({ t: e.textContent, bad: e.classList.contains('bad') }));
async function signIn(email, pw, mode = 'in') {
  if (!(await pg.$('#authEmail'))) { await tab(pg, 'setup'); await pg.click('#signInBtn'); await pg.waitForSelector('#authEmail'); }
  await pg.fill('#authEmail', email); await pg.fill('#authPw', pw);
  await pg.click(mode === 'up' ? '#authUp' : '#authIn');
}
const authClosed = () => pg.waitForFunction(() => !document.getElementById('authEmail'), null, { timeout: 30000 });
const D3 = '2026-09-20', D4 = '2026-09-21';
const RUN = Date.now() % 900; // unique values each run so the offline change is always a real change

console.log('Real Supabase: account sheet');
await pg.goto(base); await ready(pg);
await tab(pg, 'setup');
ok(await pg.isVisible('#signInBtn'), 'app is configured: "Sign in to sync" is offered');
await logDay(pg, { steps: 8000, weight: 87, note: 'e2e local one' });
await pg.click('#prevDay');
await logDay(pg, { steps: 7000, weight: 87.5, note: 'e2e local two' });
await signIn('bad', PW, 'up');
ok(/valid email/.test((await authMsg()).t), 'invalid email blocked');
await signIn(EMAIL, 'wrong-password-123');
await pg.waitForFunction(() => /Wrong email or password/.test(document.getElementById('authMsg').textContent), null, { timeout: 25000 });
ok(true, 'real Supabase wrong password -> "Wrong email or password."');
blocked = true;
await signIn(EMAIL, PW);
await pg.waitForFunction(() => /No internet/.test(document.getElementById('authMsg').textContent), null, { timeout: 25000 });
ok(true, 'blocked network -> "No internet connection" on sign in');
blocked = false;
await signIn(`resetlog-signup-${Date.now()}@example.com`, PW, 'up');
await pg.waitForFunction(() => { const t = document.getElementById('authMsg').textContent; return t.length > 0 && t !== 'Working…'; }, null, { timeout: 30000 });
const su = await authMsg();
console.log('  (real sign up result:', JSON.stringify(su) + ')');
ok(/Check your email to confirm/.test(su.t) || su.bad, 'sign up either asks to confirm the email or shows a clear error');

console.log('Real Supabase: sign in uploads local data');
await signIn(EMAIL, PW);
await authClosed();
await waitStatus(/Synced at/);
ok(await pg.isVisible('#signOutBtn') && (await pg.textContent('#acctEmail')) === EMAIL, 'signed in with the real project');

console.log('Real Supabase: change, wipe, sign in again');
await goDate(pg, D3);
await logDay(pg, { steps: 9100, weight: 86.1, note: 'e2e third day' });
await tab(pg, 'setup'); await waitStatus(/Synced at/);
await pg.click('#setHabits .swipe:nth-child(1) .row'); await pg.fill('#fTarget', '9999'); await pg.click('.sheet .txtbtn.strong');
await pg.waitForTimeout(900); await waitStatus(/Synced at/);
const before = await stored(pg);
await pg.reload(); await ready(pg); await tab(pg, 'setup');
await waitStatus(/Synced at/);
ok(await pg.isVisible('#signOutBtn'), 'login survives an app restart');
await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('__ob', '1'); localStorage.setItem('CapacitorStorage.resetlog_onboarded', '1'); });
await pg.reload(); await ready(pg); await tab(pg, 'setup');
ok((await pg.textContent('#sDays')) === '0' && await pg.isVisible('#signInBtn'), 'wiped: local data gone and signed out');
await signIn(EMAIL, PW);
await authClosed();
await waitStatus(/Synced at/);
const after = await stored(pg);
ok(Object.keys(after.days).sort().join() === Object.keys(before.days).sort().join() && Object.keys(after.days).length >= 3, 'all days came back from the cloud', Object.keys(after.days));
ok(after.settings.habits[0].target === 9999 && after.days[D3].note === 'e2e third day' && after.days[D3].weight === 86.1, 'settings and day contents restored');
ok(Object.keys(after.days).every(k => after.days[k].updatedAt === before.days[k].updatedAt), 'timestamps identical after the round trip');

console.log('Real Supabase: offline queue');
blocked = true; await ctx.setOffline(true);
await goDate(pg, D4);
await logDay(pg, { steps: 5000 + RUN, weight: 80 + (RUN % 100) / 10, note: 'e2e saved offline ' + RUN });
await tab(pg, 'setup'); await waitStatus(/1 change is waiting to sync/);
ok(true, 'offline change is queued ("1 change is waiting to sync")');
await ctx.setOffline(false);
await pg.reload(); await ready(pg); await tab(pg, 'setup');
await waitStatus(/1 change is waiting to sync/);
ok(true, 'queue survives an app restart while offline');
await ctx.setOffline(true); await pg.waitForTimeout(200);
blocked = false; await ctx.setOffline(false);
await waitStatus(/Synced at/, 30000);
ok(true, 'network back: queued day uploaded automatically');

const fin = await stored(pg);
console.log('\nEXPECTED_CLOUD ' + JSON.stringify({ email: EMAIL, days: Object.fromEntries(Object.entries(fin.days).map(([k, v]) => [k, v.note])), updatedAt: Object.fromEntries(Object.entries(fin.days).map(([k, v]) => [k, v.updatedAt])) }));
ok(errs.length === 0, 'no JS errors', errs);
await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
