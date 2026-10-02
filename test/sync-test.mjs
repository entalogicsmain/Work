// Cloud-sync tests. The page runs the real supabase-js bundle; the Supabase server is an
// in-memory fake (auth + PostgREST, rows filtered by the caller's user id like RLS does).
// Run: npm run test:sync
import crypto from 'crypto';
import { createRequire } from 'module';
import { serve, launch, counter, newPage, skipOnboarding, tab, gear, ready, stored, sheetGone, settle, setHabit, setBody, setNote, goDate, actionChoose, logDay, todayKey } from './helpers.mjs';

const Core = createRequire(import.meta.url)('../www/js/core.js');
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


/* ================= more phones: onboarding, per-key day merge, settings versions, open sheets ================= */
async function phone({ onboard = false } = {}) {
  const c = await browser.newContext({ viewport: { width: 400, height: 800 } });
  if (!onboard) await skipOnboarding(c);
  await c.route(API + '/**', handler);
  await c.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.COMEBACK_CONFIG={SUPABASE_URL:'${API}',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fake'}` }));
  const p = await newPage(c, errs);
  return { c, p };
}
const mkUser = email => { const u = { id: crypto.randomUUID(), email, password: PW, confirmed: true }; fake.users.set(u.id, u); return u.id; };
async function signInUI(p, email) {
  await gear(p); await p.click('#signInBtn'); await p.waitForSelector('#authEmail');
  await p.fill('#authEmail', email); await p.fill('#authPw', PW); await p.click('#authIn');
  await p.waitForFunction(() => !document.getElementById('authEmail'), null, { timeout: 8000 });
  await p.waitForFunction(() => /Synced at/.test(document.getElementById('syncStatus').textContent), null, { timeout: 8000 });
}
const syncNow = p => p.evaluate(() => syncSoon(true));
const cloudDay = (uid, k) => fake.days.find(r => r.user_id === uid && r.log_date === k);
const putDay = (uid, k, data, at) => { const i = fake.days.findIndex(r => r.user_id === uid && r.log_date === k); const row = { user_id: uid, log_date: k, data: { vals: {}, rules: {}, weight: null, waist: null, note: '', ...data }, updated_at: new Date(at).toISOString() }; if (i >= 0) fake.days[i] = row; else fake.days.push(row); };
const putSettings = (uid, data, at) => { const i = fake.settings.findIndex(r => r.user_id === uid); const row = { user_id: uid, data, updated_at: new Date(at).toISOString() }; if (i >= 0) fake.settings[i] = row; else fake.settings.push(row); };
const settingsRow = uid => fake.settings.find(r => r.user_id === uid);

/* ---------- 11. onboarding (starter plan) then sign in to an account that already has settings ---------- */
console.log('Onboard signed out, then sign in to an existing account');
{
  const uid = mkUser('existing@example.com');
  const cs = Core.defaultSettings();
  cs.habits = cs.habits.filter(h => ['steps', 'water', 'nosugar', 'weight', 'waist'].includes(h.id));
  cs.habits.find(h => h.id === 'water').target = 4;
  cs.habits.find(h => h.id === 'steps').target = 12000;
  cs.habits.find(h => h.id === 'nosugar').schedule = { kind: 'days', days: [1, 3, 5] };
  cs.habits.find(h => h.id === 'nosugar').section = 'mine';
  cs.sections.splice(1, 0, { id: 'mine', name: 'My stuff' });
  cs.sections = cs.sections.filter(x => x.id !== 'workout' && x.id !== 'health');
  cs.habits.find(h => h.id === 'water').section = 'mine';
  const cloudSettingsAt = Date.now() - 3600e3;
  putSettings(uid, cs, cloudSettingsAt);
  putDay(uid, '2026-09-01', { vals: { water: 3 }, note: 'cloud day' }, Date.now() - 7200e3);
  const snapshot = JSON.stringify(settingsRow(uid).data);
  const { c, p } = await phone({ onboard: true });
  await p.goto(base); await p.waitForSelector('.onb');
  await p.click('#onbNext'); await p.click('#plan-beginner'); await p.click('#onbNext');
  await p.click('#onbNext'); await p.click('#onbNext'); await p.click('#onbNext');
  await p.click('#onbStart'); await p.waitForFunction(() => !document.querySelector('.onb'));
  await settle(p);
  ok((await stored(p)).settings.habits.some(h => h.id === 'pushups'), 'the phone has the starter plan after onboarding');
  ok(await p.evaluate(() => sync.settingsUpdatedAt) === 0, 'onboarding while signed out does not stamp the settings as "edited"');
  await signInUI(p, 'existing@example.com');
  const st = await stored(p);
  ok(st.settings.habits.map(h => h.id).join() === cs.habits.map(h => h.id).join(), 'cloud habits win over the starter plan', st.settings.habits.map(h => h.id));
  ok(st.settings.sections.map(x => x.id).join() === cs.sections.map(x => x.id).join(), 'cloud sections win over the starter plan', st.settings.sections.map(x => x.id));
  ok(JSON.stringify(st.settings.habits.find(h => h.id === 'nosugar').schedule) === '{"kind":"days","days":[1,3,5]}' && st.settings.habits.find(h => h.id === 'water').target === 4, 'cloud schedules and targets are kept');
  ok(JSON.stringify(settingsRow(uid).data) === snapshot && settingsRow(uid).updated_at === new Date(cloudSettingsAt).toISOString(), 'the cloud settings were not overwritten by the starter plan');
  ok(!!st.days['2026-09-01'] && st.days['2026-09-01'].note === 'cloud day', 'cloud days still arrive');
  await c.close();
}

/* ---------- 11b. a deliberate settings edit while signed out still counts ---------- */
console.log('Deliberate edit while signed out');
{
  const uid = mkUser('edited@example.com');
  const cs = Core.defaultSettings(); cs.habits.find(h => h.id === 'steps').target = 5555;
  putSettings(uid, cs, Date.now() - 3600e3);
  const { c, p } = await phone();
  await p.goto(base); await ready(p);
  await logDay(p, { reps: 12 });
  await tab(p, 'setup'); await p.click('#planSections .swipe[data-id="walk"] .row'); await p.fill('#fTarget', '41'); await p.click('.sheet .txtbtn.strong'); await sheetGone(p);
  await settle(p);
  ok(await p.evaluate(() => sync.settingsUpdatedAt) > 0, 'a Plan edit made after onboarding is stamped');
  await signInUI(p, 'edited@example.com');
  ok((await stored(p)).settings.habits.find(h => h.id === 'walk').target === 41 && settingsRow(uid).data.habits.find(h => h.id === 'walk').target === 41, 'the phone with real local days and a deliberate edit keeps its plan and uploads it');
  await c.close();
}

/* ---------- 12. a day edited on two phones keeps both phones' fields ---------- */
console.log('Per-key day merge');
{
  const uid = mkUser('merge@example.com');
  const { c, p } = await phone();
  await p.goto(base); await ready(p);
  await logDay(p, { reps: 30 });
  await signInUI(p, 'merge@example.com');
  const k = tk;
  // this phone goes offline and records weight and steps; the other phone, meanwhile, logs water and a note
  fake.offline = true;
  await p.evaluate(k => { const d = clone(days[k]); d.weight = 80.5; d.vals.steps = 6000; d.steps_meta = { source: 'auto', counted: 6000, distance_km: 4.2, filtered: 10, hourly: new Array(24).fill(250) }; d.updatedAt = Date.now(); days[k] = d; markDayDirty(k); return store.persist(); }, k);
  const base0 = cloudDay(uid, k);
  putDay(uid, k, { ...base0.data, vals: { ...base0.data.vals, water: 2, steps: 4000 }, steps_meta: { source: 'auto', counted: 4000, distance_km: 2.8, filtered: 0, hourly: new Array(24).fill(166) }, note: 'from phone B' }, Date.now() + 1500);
  fake.offline = false;
  await syncNow(p);
  const m = (await stored(p)).days[k], cr = cloudDay(uid, k).data;
  ok(m.vals.pushups === 30 && m.vals.water === 2 && m.weight === 80.5, 'fields changed on only one phone are all kept (pushups, water, weight)', m);
  ok(m.vals.steps === 6000 && m.steps_meta.counted === 6000, 'steps keep the higher count with its richer step details', m.steps_meta);
  ok(m.note === 'from phone B', 'a note from the newer side wins when it is not empty');
  ok(cr.vals.water === 2 && cr.weight === 80.5 && cr.vals.steps === 6000 && cr.note === 'from phone B', 'the merged day is uploaded so the cloud has everything too', cr);
  // a plain, one-sided change still behaves as before (including removing things)
  await p.evaluate(k => { const d = clone(days[k]); delete d.vals.water; d.updatedAt = Date.now(); days[k] = d; markDayDirty(k); return store.persist(); }, k);
  await syncNow(p);
  ok(!('water' in cloudDay(uid, k).data.vals) && !('water' in (await stored(p)).days[k].vals), 'removing a value on one phone is not undone by the old cloud copy');
  await c.close();
}

console.log('Clocks and unknown timestamps');
{
  const uid = mkUser('clock@example.com');
  const { c, p } = await phone();
  await p.goto(base); await ready(p);
  await logDay(p, { reps: 20 });
  await signInUI(p, 'clock@example.com');
  const k = tk, now = Date.now();
  // another phone with its clock a day ahead wrote this day while this phone also changed it
  fake.offline = true;
  await p.evaluate(k => { const d = clone(days[k]); d.weight = 79; d.updatedAt = Date.now(); days[k] = d; markDayDirty(k); return store.persist(); }, k);
  putDay(uid, k, { vals: { pushups: 25, water: 1 }, note: 'future clock' }, now + 86400e3);
  fake.offline = false;
  await syncNow(p);
  const cr = cloudDay(uid, k), loc = (await stored(p)).days[k];
  ok(Date.parse(cr.updated_at) <= Date.now() + 5 * 60e3 + 2000 && loc.updatedAt <= Date.now() + 5 * 60e3 + 2000, 'a phone with its clock in the future cannot keep a timestamp more than 5 minutes ahead', { cloud: Date.parse(cr.updated_at) - Date.now(), local: loc.updatedAt - Date.now() });
  ok(loc.weight === 79 && loc.vals.water === 1 && loc.vals.pushups === 25, 'both phones\' fields are merged with the future-clock phone', loc);
  // a future-clock day that this phone only receives is also pulled back to "now" in the cloud
  const k2 = '2026-09-02';
  putDay(uid, k2, { vals: { water: 1.5 } }, now + 5 * 86400e3);
  await syncNow(p);
  ok((await stored(p)).days[k2].updatedAt <= Date.now() + 5 * 60e3 + 2000 && Date.parse(cloudDay(uid, k2).updated_at) <= Date.now() + 5 * 60e3 + 2000, 'a future timestamp that only arrives from the cloud is clamped there too');
  // later edits on this phone win over that clamped copy
  await p.evaluate(k => { const d = clone(days[k]); d.vals.water = 4; d.updatedAt = Date.now() + 10 * 60e3; days[k] = d; markDayDirty(k); return store.persist(); }, k2);
  await syncNow(p);
  ok(cloudDay(uid, k2).data.vals.water === 4, 'but a real later edit still reaches the cloud');
  // updatedAt 0 / missing = unknown: it is merged, not replaced
  const k3 = '2026-09-03';
  putDay(uid, k3, { vals: { pushups: 22 }, note: 'cloud only note' }, Date.now() - 1000);
  await p.evaluate(k3 => { days[k3] = { vals: { water: 2.5 }, rules: {}, weight: 70, waist: null, note: '', date: k3, updatedAt: 0 }; return store.persist(); }, k3);
  const k4 = '2026-09-04';
  await p.evaluate(k4 => { days[k4] = { vals: { sleep: 7 }, rules: {}, weight: null, waist: null, note: 'only here', date: k4, updatedAt: 0 }; return store.persist(); }, k4);
  await syncNow(p);
  const l3 = (await stored(p)).days[k3], c3 = cloudDay(uid, k3).data;
  ok(l3.vals.water === 2.5 && l3.weight === 70 && l3.vals.pushups === 22 && l3.note === 'cloud only note', 'a local day with an unknown timestamp is merged with the cloud row, not blindly replaced', l3);
  ok(c3.vals.water === 2.5 && c3.vals.pushups === 22, 'and the merged result is in the cloud', c3);
  const c4 = cloudDay(uid, k4);
  ok(c4 && c4.data.note === 'only here' && Date.parse(c4.updated_at) > 1e12, 'an unknown-timestamp day that the cloud lacks is uploaded with a real timestamp', c4 && c4.updated_at);
  await c.close();
}

/* ---------- 13. settings versions in the cloud ---------- */
console.log('Old-shape cloud settings');
{
  const uid = mkUser('legacy@example.com');
  const { c, p } = await phone();
  await p.goto(base); await ready(p);
  await logDay(p, { reps: 10 });
  await signInUI(p, 'legacy@example.com');
  // customise the layout on this phone
  await p.evaluate(() => { settings.units.weight = 'lb'; settings.body.scale = 'asian'; settings.habits.find(h => h.id === 'walk').hidden = true; settings.habits.find(h => h.id === 'pushups').schedule = { kind: 'days', days: [1, 3] }; Core.ensureSection(settings, 'mine', 'Mine'); settings.habits.find(h => h.id === 'pullups').section = 'mine'; return saveSettingsQuiet(); });
  await settle(p); await syncNow(p);
  ok(settingsRow(uid).data.v === 2 && settingsRow(uid).data.units.weight === 'lb', 'this phone\'s plan is in the cloud as version 2');
  // an old app (version 1 shape) uploads a newer copy: a changed target, a new habit, and a rule whose id clashes with a habit
  putSettings(uid, { habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 12000 }, { id: 'zumba', name: 'Zumba', unit: 'min', target: 40 }, { id: 'water', name: 'Water', unit: 'litres', target: 2.5 }], rules: [{ id: 'water', name: 'Drank water rule' }, { id: 'nosugar', name: 'No sugar!' }] }, Date.now() + 60e3);
  putDay(uid, '2026-09-10', { vals: { zumba: 40 }, rules: { water: true, nosugar: true }, note: 'old app day' }, Date.now() + 60e3);
  await syncNow(p);
  const st = (await stored(p));
  ok(st.settings.v === 2 && st.settings.units.weight === 'lb' && st.settings.body.scale === 'asian', 'a version-1 cloud copy does not reset units and body settings', { u: st.settings.units, b: st.settings.body });
  ok(st.settings.habits.find(h => h.id === 'walk').hidden === true && JSON.stringify(st.settings.habits.find(h => h.id === 'pushups').schedule) === '{"kind":"days","days":[1,3]}' && st.settings.habits.find(h => h.id === 'pullups').section === 'mine' && st.settings.sections.some(x => x.id === 'mine'), 'nor does it reset hidden habits, schedules and sections');
  ok(st.settings.habits.some(h => h.id === 'zumba') && st.settings.habits.find(h => h.id === 'steps').target === 12000 && st.settings.habits.some(h => h.id === 'pushups'), 'habits are merged by id: the new one is added, a changed target arrives, the rest stay');
  ok(st.settings.habits.find(h => h.id === 'nosugar').name === 'No sugar!' && st.settings.habits.some(h => h.id === 'water-rule'), 'rules from the old app become Yes/No habits (a clashing id gets a new one)');
  ok(st.days['2026-09-10'] && st.days['2026-09-10'].rules['water-rule'] === true && !('water' in st.days['2026-09-10'].rules) && st.days['2026-09-10'].rules.nosugar === true, 'old-app days get their rule ids remapped', st.days['2026-09-10'] && st.days['2026-09-10'].rules);
  const up = settingsRow(uid).data;
  ok(up.v === 2 && !('rules' in up) && up.units.weight === 'lb', 'the merged settings are written back to the cloud as version 2', Object.keys(up));
  // an old-shape copy that is OLDER than this phone's last edit is ignored (and replaced by version 2)
  await p.evaluate(() => { settings.habits.find(h => h.id === 'steps').target = 9000; return saveSettingsQuiet(); });
  await settle(p); await syncNow(p);
  putSettings(uid, { habits: [{ id: 'steps', name: 'Steps', unit: 'steps', target: 1 }], rules: [] }, Date.now() - 3600e3);
  await syncNow(p);
  ok((await stored(p)).settings.habits.find(h => h.id === 'steps').target === 9000 && settingsRow(uid).data.v === 2 && settingsRow(uid).data.habits.find(h => h.id === 'steps').target === 9000, 'an older version-1 copy never overwrites newer local settings; the cloud is upgraded');
  await c.close();
}

/* ---------- 14. an open edit sheet survives a cloud pull ---------- */
console.log('Open edit sheet and a cloud pull');
{
  const uid = mkUser('sheet@example.com');
  const { c, p } = await phone();
  await p.goto(base); await ready(p);
  await logDay(p, { reps: 10 });
  await signInUI(p, 'sheet@example.com');
  await tab(p, 'setup');
  await p.click('#planSections .swipe[data-id="pushups"] .row');
  await p.waitForSelector('#fTarget');
  // another phone changes a different habit while the sheet is open
  const cur = JSON.parse(JSON.stringify(settingsRow(uid).data));
  cur.habits.find(h => h.id === 'walk').target = 45;
  putSettings(uid, cur, Date.now() + 30e3);
  await syncNow(p);
  ok((await p.evaluate(() => settings.habits.find(h => h.id === 'walk').target)) === 45, 'the cloud change arrived while the sheet was open');
  await p.fill('#fTarget', '55'); await p.fill('#fName', 'Push-ups plus');
  await p.click('.sheet .txtbtn.strong'); await sheetGone(p);
  await settle(p);
  const st = await stored(p);
  ok(st.settings.habits.find(h => h.id === 'pushups').target === 55 && st.settings.habits.find(h => h.id === 'pushups').name === 'Push-ups plus' && st.settings.habits.find(h => h.id === 'walk').target === 45, 'Done saves the edit into the live settings (and keeps the other phone\'s change)', st.settings.habits.find(h => h.id === 'pushups'));
  await syncNow(p);
  ok(settingsRow(uid).data.habits.find(h => h.id === 'pushups').target === 55 && settingsRow(uid).data.habits.find(h => h.id === 'walk').target === 45, 'both changes reach the cloud');
  // the cloud removes the habit being edited: the edit is not silently lost
  await p.click('#planSections .swipe[data-id="plank"] .row'); await p.waitForSelector('#fTarget');
  const cur2 = JSON.parse(JSON.stringify(settingsRow(uid).data));
  cur2.habits = cur2.habits.filter(h => h.id !== 'plank');
  putSettings(uid, cur2, Date.now() + 60e3);
  await syncNow(p);
  await p.fill('#fTarget', '90'); await p.click('.sheet .txtbtn.strong'); await sheetGone(p); await settle(p);
  ok((await stored(p)).settings.habits.some(h => h.id === 'plank' && h.target === 90), 'editing a habit that another phone just removed keeps what you typed');
  await c.close();
}

ok(errs.length === 0, 'no JS errors', errs);
await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
