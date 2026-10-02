// End-to-end test against the REAL Supabase project configured in www/config.js.
// Needs E2E_EMAIL / E2E_PASSWORD of an existing confirmed user. Prints a summary of what
// should now be in the cloud so it can be checked with SQL. Run: npm run test:real
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');
const mime = { '.js': 'text/javascript', '.woff2': 'font/woff2', '.html': 'text/html' };
const srv = http.createServer((q, r) => {
  let f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (f.endsWith(path.sep)) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
const base = `http://localhost:${srv.address().port}/`;
const EMAIL = process.env.E2E_EMAIL, PW = process.env.E2E_PASSWORD;
if (!EMAIL || !PW) { console.error('Set E2E_EMAIL and E2E_PASSWORD'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, proxy });
void proxy;
const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
let blocked = false;
// The sandbox browser doesn't trust the egress proxy's CA, so Supabase calls are made from Node
// (which does) and handed back to the page. The page still talks to the real project.
await ctx.route(/supabase\.co/, async r => {
  if (blocked) return r.abort('internetdisconnected');
  try { await r.fulfill({ response: await r.fetch() }); } catch (e) { await r.abort('failed'); }
});
const errs = [];
const pg = await ctx.newPage();
pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
pg.on('dialog', d => d.accept());
const tab = t => pg.click(`nav button[data-tab="${t}"]`);
const status = () => pg.textContent('#syncStatus');
const stored = () => pg.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.resetlog')));
const waitStatus = (re, t = 20000) => pg.waitForFunction(r => new RegExp(r).test(document.getElementById('syncStatus').textContent), re.source, { timeout: t }).catch(async e => { console.log('  (status was: ' + (await status()) + ')'); throw e; });
const authMsg = () => pg.$eval('#authMsg', e => ({ t: e.textContent, bad: e.classList.contains('bad') }));
async function logDay(date, steps, weight, note) {
  await tab('today');
  await pg.fill('#dateInput', date); await pg.dispatchEvent('#dateInput', 'change');
  await pg.fill('#habitList .habit:nth-child(1) input', String(steps));
  await pg.fill('#weight', String(weight));
  await pg.fill('#note', note);
  await pg.click('#saveBtn');
  await pg.waitForFunction(() => document.getElementById('banner').classList.contains('done'));
}
async function signIn(email, pw, mode = 'in') {
  if (await pg.$eval('#authModal', e => e.hidden)) { await tab('setup'); await pg.click('#signInBtn'); }
  await pg.fill('#authEmail', email); await pg.fill('#authPw', pw);
  await pg.click(mode === 'up' ? '#authUp' : '#authIn');
}
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const D1 = fmt(now), D2 = fmt(new Date(now.getTime() - 864e5)), D3 = '2026-09-20', D4 = '2026-09-21';

console.log('Real Supabase: sign up screen');
await pg.goto(base); await pg.waitForSelector('#sDays', { state: 'attached' });
await tab('setup');
ok(await pg.isVisible('#signInBtn'), 'app is configured: "Sign in to sync" is offered');
await logDay(D1, 8000, 87, 'e2e local one');
await logDay(D2, 7000, 87.5, 'e2e local two');
await signIn('bad', PW, 'up');
ok(/valid email/.test((await authMsg()).t), 'invalid email blocked');
await signIn(EMAIL, 'wrong-password-123');
await pg.waitForFunction(() => /Wrong email or password/.test(document.getElementById('authMsg').textContent), null, { timeout: 20000 });
ok(true, 'real Supabase wrong password -> "Wrong email or password."');
blocked = true;
await signIn(EMAIL, PW);
await pg.waitForFunction(() => /No internet/.test(document.getElementById('authMsg').textContent), null, { timeout: 20000 });
ok(true, 'blocked network -> "No internet connection" on sign in');
blocked = false;
const signupEmail = `resetlog-signup-${Date.now()}@example.com`;
await signIn(signupEmail, PW, 'up');
await pg.waitForFunction(() => document.getElementById('authMsg').textContent.length > 0 && document.getElementById('authMsg').textContent !== 'Working…', null, { timeout: 30000 });
const su = await authMsg();
console.log('  (real sign up result:', JSON.stringify(su), 'for', signupEmail + ')');
ok(/Check your email to confirm/.test(su.t) || su.bad, 'sign up either asks to confirm the email or shows a clear error');

console.log('Real Supabase: first sign in uploads local data');
await signIn(EMAIL, PW);
await pg.waitForFunction(() => document.getElementById('authModal').hidden, null, { timeout: 30000 });
await waitStatus(/Synced at/);
ok(await pg.isVisible('#signOutBtn') && (await pg.textContent('#acctEmail')) === EMAIL, 'signed in with the real project');

console.log('Real Supabase: save, wipe, sign in again');
await logDay(D3, 9100, 86.1, 'e2e third day');
await waitStatus(/Synced at/);
await tab('setup');
await pg.fill('#setHabits .list-item:nth-child(1) input', '9999'); await pg.press('#setHabits .list-item:nth-child(1) input', 'Tab');
await waitStatus(/Synced at/); await pg.waitForTimeout(800); await waitStatus(/Synced at/);
const before = await stored();
await pg.reload(); await pg.waitForSelector('#sDays', { state: 'attached' }); await tab('setup');
await waitStatus(/Synced at/);
ok(await pg.isVisible('#signOutBtn'), 'login survives an app restart');
await pg.evaluate(() => localStorage.clear());
await pg.reload(); await pg.waitForSelector('#sDays', { state: 'attached' }); await tab('setup');
ok((await pg.textContent('#sDays')) === '0', 'wiped: local data gone');
await signIn(EMAIL, PW);
await pg.waitForFunction(() => document.getElementById('authModal').hidden, null, { timeout: 30000 });
await waitStatus(/Synced at/);
const after = await stored();
ok(Object.keys(after.days).sort().join() === Object.keys(before.days).sort().join() && Object.keys(after.days).length === 3, 'all 3 days came back from the cloud', Object.keys(after.days));
ok(after.settings.habits[0].target === 9999 && after.days[D3].note === 'e2e third day' && after.days[D3].weight === 86.1, 'settings and day contents restored');
ok(Object.keys(after.days).every(k => after.days[k].updatedAt === before.days[k].updatedAt), 'timestamps identical after the round trip');

console.log('Real Supabase: offline queue');
blocked = true; await ctx.setOffline(true);
await logDay(D4, 5000, 85, 'e2e saved offline');
await waitStatus(/1 change is waiting to sync/);
ok(true, 'offline save is queued ("1 change is waiting to sync")');
await ctx.setOffline(false);
await pg.reload(); await pg.waitForSelector('#sDays', { state: 'attached' }); await tab('setup');
await waitStatus(/1 change is waiting to sync/);
ok(true, 'queue survives an app restart while offline');
await ctx.setOffline(true); await pg.waitForTimeout(200);
blocked = false; await ctx.setOffline(false);
await waitStatus(/Synced at/, 30000);
ok(true, 'network back: queued day uploaded automatically');

const fin = await stored();
console.log('\nEXPECTED_CLOUD ' + JSON.stringify({ email: EMAIL, days: Object.fromEntries(Object.entries(fin.days).map(([k, v]) => [k, v.note])), updatedAt: Object.fromEntries(Object.entries(fin.days).map(([k, v]) => [k, v.updatedAt])), signupEmail }));
ok(errs.length === 0, 'no JS errors', errs);
await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
