// Cloud-sync tests. The page runs the real supabase-js bundle; the Supabase server is an
// in-memory fake (auth + PostgREST, rows filtered by the caller's user id like RLS does).
// Run: npm run test:sync
import crypto from 'crypto';
import { serve, launch, counter, newPage, skipOnboarding, tab, gear, ready, stored, sheetGone, settle, setHabit, setBody, setNote, goDate, actionChoose, logDay, todayKey } from './helpers.mjs';

const { srv, base } = serve();
const API = 'https://fake.supabase.test';
const T = counter();
const ok = T.ok;

/* ---------- fake Supabase ---------- */
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const fake = { users: new Map(), days: [], settings: [], offline: false, confirmEmail: true, calls: [] };
const jwt = u => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const userObj = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.confirmed ? new Date().toISOString() : null, identities: [{ id: u.id }], app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const sessionObj = u => ({ access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + u.id, user: userObj(u) });
const subOf = req => { const a = req.headers()['authorization'] || ''; const t = a.replace('Bearer ', '').split('.')[1]; try { return JSON.parse(Buffer.from(t, 'base64url').toString()).sub; } catch { return null; } };

async function handler(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (fake.offline) return route.abort('internetdisconnected');
  const send = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
  const p = url.pathname;
  fake.calls.push(req.method() + ' ' + p);
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const byEmail = e => [...fake.users.values()].find(u => u.email === e);

  if (p === '/auth/v1/signup') {
    if (fake.signupError) return send(400, fake.signupError);
    const ex = byEmail(body.email);
    if (ex) return send(200, { ...userObj(ex), identities: [] }); // what Supabase returns when confirmation is on
    const u = { id: crypto.randomUUID(), email: body.email, password: body.password, confirmed: !fake.confirmEmail };
    fake.users.set(u.id, u);
    return send(200, fake.confirmEmail ? userObj(u) : sessionObj(u));
  }
  if (p === '/auth/v1/token') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const u = byEmail(body.email);
      if (!u || u.password !== body.password) return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      if (!u.confirmed) return send(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
      return send(200, sessionObj(u));
    }
    const u = [...fake.users.values()].find(x => 'r-' + x.id === body.refresh_token);
    return u ? send(200, sessionObj(u)) : send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
  }
  if (p === '/auth/v1/logout') return send(204);
  if (p === '/auth/v1/user') { const u = fake.users.get(subOf(req)); return u ? send(200, userObj(u)) : send(401, { code: 401, msg: 'invalid JWT' }); }

  if (p.startsWith('/rest/v1/')) {
    const uid = subOf(req);
    if (!uid || !fake.users.has(uid)) return send(401, { message: 'JWT expired', code: 'PGRST301' });
    const table = p.split('/').pop();
    const store = table === 'day_logs' ? fake.days : fake.settings;
    if (req.method() === 'GET') {
      let rows = store.filter(r => r.user_id === uid); // row level security
      const f = url.searchParams.get('user_id');
      if (f && f !== 'eq.' + uid) rows = [];
      rows = rows.slice().sort((a, b) => String(a.log_date).localeCompare(String(b.log_date)));
      const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 100000);
      return send(200, rows.slice(off, off + lim));
    }
    if (req.method() === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      if (rows.some(r => r.user_id !== uid)) return send(403, { code: '42501', message: 'new row violates row-level security policy for table "' + table + '"' });
      rows.forEach(r => {
        const i = store.findIndex(x => x.user_id === r.user_id && (table === 'user_settings' || x.log_date === r.log_date));
        if (i >= 0) store[i] = r; else store.push(r);
      });
      return send(201);
    }
  }
  return send(404, { message: 'not found ' + p });
}

/* ---------- helpers ---------- */
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
await skipOnboarding(ctx);
await ctx.route(API + '/**', handler);
await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.COMEBACK_CONFIG={SUPABASE_URL:'${API}',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fake'}` }));
const errs = [];
const pg = await newPage(ctx, errs);

const status = () => pg.textContent('#syncStatus');
const waitStatus = (re, t = 8000) => pg.waitForFunction(r => new RegExp(r).test(document.getElementById('syncStatus').textContent), re.source, { timeout: t }).catch(async e => { console.log('  (status was: ' + (await status()) + ')'); throw e; });
const authMsg = () => pg.$eval('#authMsg', e => ({ t: e.textContent, bad: e.classList.contains('bad') }));
const authOpen = () => pg.$('#authEmail').then(x => !!x);
async function auth(mode, email, pw) {
  if (!(await authOpen())) { await gear(pg); await pg.click('#signInBtn'); await pg.waitForSelector('#authEmail'); }
  await pg.fill('#authEmail', email); await pg.fill('#authPw', pw);
  await pg.click(mode === 'up' ? '#authUp' : '#authIn');
}
const authClosed = () => pg.waitForFunction(() => !document.getElementById('authEmail'), null, { timeout: 8000 });
const waitAuthText = re => pg.waitForFunction(r => new RegExp(r, 'i').test((document.getElementById('authMsg') || {}).textContent || ''), re.source, { timeout: 8000 });
const tk = todayKey();
const EMAIL = 'tester@example.com', PW = 'correct horse 9';
const cloud = () => fake.calls.filter(c => c.includes('/rest/')).length;

/* ---------- 1. works without an account ---------- */
console.log('Signed out (local only)');
await pg.goto(base); await ready(pg);
await gear(pg);
ok(await pg.isVisible('#signInBtn') && !(await pg.isVisible('#signOutBtn')), 'Plan shows "Sign in to sync" when signed out');
await logDay(pg, { reps: 8000, weight: 87, note: 'local one' });
await pg.click('#prevDay');
await logDay(pg, { reps: 7000, weight: 87.5, note: 'local two' });
await pg.waitForTimeout(300);
ok(cloud() === 0, 'changing data while signed out makes no cloud requests');
ok(Object.keys((await stored(pg)).days).length === 2, 'local days saved');

/* ---------- 2. sign up / sign in errors ---------- */
console.log('Account sheet');
await auth('up', 'not-an-email', PW);
ok((await authMsg()).bad && /valid email/.test((await authMsg()).t), 'invalid email is rejected');
await auth('up', EMAIL, '123');
ok(/at least 6/.test((await authMsg()).t), 'short password is rejected');
fake.signupError = { code: 400, error_code: 'email_address_not_authorized', msg: 'Email address "tester@example.com" cannot be used as it is not authorized' };
await auth('up', EMAIL, PW);
await waitAuthText(/email service/);
ok((await authMsg()).bad && /contact the app owner/.test((await authMsg()).t), 'default-SMTP "email not authorized" error is explained clearly');
fake.signupError = { code: 400, error_code: 'email_address_invalid', msg: 'Email address "tester@example.com" is invalid' };
await auth('up', EMAIL, PW);
await waitAuthText(/isn't accepted/);
ok((await authMsg()).bad, 'invalid-domain error is explained clearly');
fake.signupError = null;
fake.offline = true;
await auth('up', EMAIL, PW);
await waitAuthText(/No internet/);
ok((await authMsg()).bad, 'offline sign up shows a clear "No internet" message');
fake.offline = false;
await auth('up', EMAIL, PW);
await waitAuthText(/confirm/);
ok(/Check your email to confirm your account, then sign in\./.test((await authMsg()).t) && await authOpen(), 'email confirmation required: clear message, sheet stays open');
await pg.click('#authIn');
await waitAuthText(/confirm/);
ok((await authMsg()).bad, 'signing in before confirming says to confirm the email');
await auth('up', EMAIL, PW);
await waitAuthText(/already exists/);
ok((await authMsg()).bad, 'email already used: clear message');
fake.users.get([...fake.users.keys()][0]).confirmed = true; // user clicks the email link
await auth('in', EMAIL, 'wrong password');
await waitAuthText(/Wrong email or password/);
ok((await authMsg()).bad, 'wrong password: clear message');

/* ---------- 3. first sign in uploads local data ---------- */
console.log('First sign in with local data');
await auth('in', EMAIL, PW);
await authClosed();
await waitStatus(/Synced at/);
const uid = [...fake.users.keys()][0];
ok(fake.days.length === 2 && fake.days.every(r => r.user_id === uid), 'both local days uploaded to the cloud', fake.days.length);
ok(fake.settings.length === 1 && Array.isArray(fake.settings[0].data.habits) && fake.settings[0].data.v === 2 && !('rules' in fake.settings[0].data), 'settings uploaded (new structure)');
const loc = await stored(pg);
const row = fake.days.find(r => r.log_date === tk);
ok(row && Object.keys(row.data).sort().join() === 'note,rules,vals,waist,weight' && row.data.note === 'local one' && row.data.vals.pushups === 8000, 'cloud row data has exactly vals/rules/weight/waist/note', row && row.data);
ok(row && Date.parse(row.updated_at) === loc.days[tk].updatedAt, 'cloud updated_at equals the local updatedAt');
ok(await pg.isVisible('#signOutBtn') && (await pg.textContent('#acctEmail')) === EMAIL, 'signed-in rows show the email and Sign out');

/* ---------- 4. save while online ---------- */
console.log('Changing data while signed in');
await goDate(pg, '2026-09-20');
await logDay(pg, { reps: 9100, weight: 86.1, note: 'third day' });
await gear(pg); await waitStatus(/Synced at/);
ok(fake.days.some(r => r.log_date === '2026-09-20' && r.data.note === 'third day'), 'a new change is upserted right away (after the auto-save)');
ok(!fake.days.some(r => r.user_id !== uid), 'every cloud row belongs to the signed-in user');
await tab(pg, 'setup'); await pg.click('#planSections .swipe[data-id="steps"] .row'); await pg.fill('#fTarget', '9999'); await pg.click('.sheet .txtbtn.strong'); await sheetGone(pg); await gear(pg);
await pg.waitForTimeout(700); await waitStatus(/Synced at/);
ok(fake.settings[0].data.habits[0].target === 9999, 'changed settings are upserted');

/* ---------- 5. stay logged in; new phone ---------- */
console.log('Persistent login and new phone');
await pg.reload(); await ready(pg); await gear(pg);
await waitStatus(/Synced at/);
ok(await pg.isVisible('#signOutBtn'), 'still signed in after closing and reopening the app (session kept in Preferences)');
const before = await stored(pg);
fake.calls.length = 0;
await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('__ob', '1'); localStorage.setItem('CapacitorStorage.comeback_onboarded', '1'); });
await pg.reload(); await ready(pg); await gear(pg);
ok((await pg.textContent('#sDays')) === '0' && await pg.isVisible('#signInBtn'), 'wiped phone: empty and signed out');
await auth('in', EMAIL, PW);
await authClosed();
await waitStatus(/Synced at/);
const after = await stored(pg);
ok(Object.keys(after.days).sort().join() === Object.keys(before.days).sort().join() && Object.keys(after.days).length === 3, 'signing in on a new phone downloads the full history', Object.keys(after.days));
ok(after.settings.habits[0].target === 9999 && after.days[tk].note === 'local one' && after.days[tk].updatedAt === before.days[tk].updatedAt, 'settings and day contents (including updatedAt) match');
await tab(pg, 'progress'); await pg.waitForTimeout(400);
ok((await pg.textContent('#sDays')) === '3', 'Progress shows the downloaded days');

/* ---------- 6. offline queue ---------- */
console.log('Offline queue');
fake.offline = true; await ctx.setOffline(true);
await tab(pg, 'today');
await logDay(pg, { reps: 5000, weight: 85, note: 'saved offline' });
await gear(pg);
await waitStatus(/1 change is waiting to sync/);
ok(/Offline|waiting to sync/.test(await status()), 'status says a change is waiting', await status());
ok(!fake.days.some(r => r.data.note === 'saved offline'), 'nothing reached the cloud while offline');
ok(await pg.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.comeback_sync')).pendingDays.length === 1), 'pending queue is stored in Preferences');
await ctx.setOffline(false); // the page itself must load; the cloud stays unreachable
await pg.reload(); await ready(pg); await gear(pg);
await waitStatus(/1 change is waiting to sync/);
ok(true, 'queue survives restarting the app while still offline');
await ctx.setOffline(true); await pg.waitForTimeout(200);
fake.offline = false; await ctx.setOffline(false); // network comes back (fires the browser's online event)
await waitStatus(/Synced at/, 10000);
ok(fake.days.some(r => r.data.note === 'saved offline'), 'when the network returns the queued day is uploaded automatically');

/* ---------- 7. newest wins ---------- */
console.log('Conflicts');
const cur = await stored(pg);
const kOld = '2026-09-20', rowOld = fake.days.find(r => r.log_date === kOld);
fake.days[fake.days.indexOf(rowOld)] = { ...rowOld, data: { ...rowOld.data, note: 'edited on other phone', weight: 80 }, updated_at: new Date(Date.now() + 60000).toISOString() };
const rowT = fake.days.find(r => r.log_date === tk);
const newerLocalAt = cur.days[tk].updatedAt;
fake.days[fake.days.indexOf(rowT)] = { ...rowT, data: { ...rowT.data, note: 'STALE cloud copy' }, updated_at: new Date(newerLocalAt - 100000).toISOString() };
await gear(pg); await pg.click('#syncNowBtn');
await waitStatus(/Synced at/); await pg.waitForTimeout(400);
const merged = await stored(pg);
ok(merged.days[kOld].note === 'edited on other phone' && merged.days[kOld].weight === 80, 'newer cloud day replaces the older local day');
ok(merged.days[tk].note === cur.days[tk].note && fake.days.find(r => r.log_date === tk).data.note === cur.days[tk].note && cur.days[tk].note !== 'STALE cloud copy', 'newer local day replaces the older cloud day');
fake.settings[0] = { ...fake.settings[0], data: { ...fake.settings[0].data, habits: fake.settings[0].data.habits.filter(h => h.id !== 'nolate' && h.id !== 'nomaida') }, updated_at: new Date(Date.now() + 120000).toISOString() };
await pg.click('#syncNowBtn'); await pg.waitForTimeout(700); await waitStatus(/Synced at/);
ok((await stored(pg)).settings.habits.filter(h => h.type === 'yesno').length === 2, 'newer cloud settings replace local settings');
await tab(pg, 'today'); await pg.waitForTimeout(200);
ok((await pg.$$('#sections .yrow')).length === 2, 'the screen refreshes after a cloud change');

/* ---------- 8. restore pushes to the cloud ---------- */
console.log('Restore while signed in');
await gear(pg);
const bk = { version: 1, settings: merged.settings, days: { '2025-01-02': { vals: { steps: 1234 }, rules: {}, weight: 90, waist: null, note: 'from old backup', date: '2025-01-02', updatedAt: 5 } } };
await pg.setInputFiles('#restoreFile', { name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bk)) });
await actionChoose(pg, 'Continue');
ok(/sent to your cloud copy/.test(await pg.textContent('.asheet .ah')), 'the restore dialog says the data is also sent to the cloud');
await actionChoose(pg, 'Merge');
await pg.waitForFunction(() => /Merged/.test(document.getElementById('bkMsg').textContent));
await waitStatus(/Synced at/); await pg.waitForTimeout(300);
ok(fake.days.some(r => r.log_date === '2025-01-02' && r.data.note === 'from old backup'), 'restored day is pushed to the cloud even though its timestamp was old');
await pg.click('#syncNowBtn'); await waitStatus(/Synced at/);
ok(Object.keys((await stored(pg)).days).includes('2025-01-02'), 'and it stays after the next sync');

/* ---------- 9. sign out ---------- */
console.log('Sign out');
const keep = Object.keys((await stored(pg)).days).length;
await pg.click('#signOutBtn');
await pg.waitForSelector('.asheet');
ok(/Sign out\?/.test(await pg.textContent('.asheet .ah')) && await pg.$eval('.asheet .ab.destructive', e => /Sign out/.test(e.textContent)), 'sign out asks first (red destructive option)');
await actionChoose(pg, 'Sign out');
await pg.waitForSelector('#signInBtn', { state: 'visible' });
fake.calls.length = 0;
ok(Object.keys((await stored(pg)).days).length === keep && keep >= 4, 'signing out keeps local data on the phone');
await logDay(pg, { reps: 4000, weight: 84, note: 'after sign out' });
await pg.waitForTimeout(300);
ok(cloud() === 0 && !fake.days.some(r => r.data.note === 'after sign out'), 'after sign out, changes stay local');
await pg.reload(); await ready(pg); await gear(pg);
ok(await pg.isVisible('#signInBtn'), 'stays signed out after restart');

/* ---------- 10. different account on the same phone ---------- */
console.log('Second account');
fake.confirmEmail = false;
await auth('up', 'other@example.com', PW);
await pg.waitForSelector('.asheet', { timeout: 8000 });
ok(/another account/.test(await pg.textContent('.asheet .ah')), 'a different account on a phone with synced entries asks what to do');
await actionChoose(pg, 'Cancel and sign out');
await pg.waitForSelector('#signInBtn', { state: 'visible' });
ok(fake.days.every(r => r.user_id === uid), 'cancelling uploads nothing to the other account');

ok(errs.length === 0, 'no JS errors', errs);
await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
