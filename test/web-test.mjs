// Headless-browser tests for www/index.html.
//  Part A: real web build (browser fallbacks): save, export, wipe, restore, migration, CSV.
//  Part B: same page with a mocked native bridge: auto backup + rotation, share flow,
//          reminder scheduling, back button, notification tap, error messages.
// Run: npm run test:web
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };
const srv = http.createServer((q, r) => {
  let f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (f.endsWith(path.sep)) f += 'index.html';
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
    r.end(d);
  });
}).listen(0);
const base = `http://localhost:${srv.address().port}/`;

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());

async function newPage(ctx, errs) {
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push('console: ' + m.text()); });
  pg.on('dialog', d => d.accept());
  return pg;
}
const tab = (pg, t) => pg.click(`nav button[data-tab="${t}"]`);
const bkMsg = pg => pg.$eval('#bkMsg', e => ({ text: e.textContent, bad: e.classList.contains('bad') }));
const waitMsg = (pg, id = 'bkMsg') => pg.waitForFunction(i => document.getElementById(i).textContent.length > 0, id, { timeout: 5000 });
const stored = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.resetlog')));

async function logDay(pg, { steps, weight, note }) {
  await pg.fill('#habitList .habit:nth-child(1) input', String(steps));
  await pg.check('#ruleList .rule:nth-child(1) input');
  await pg.fill('#weight', String(weight));
  await pg.fill('#note', note);
  await pg.click('#saveBtn');
  await pg.waitForFunction(() => document.getElementById('banner').classList.contains('done'));
}

/* =============== Part A: real web build =============== */
console.log('Part A: web build');
{
  const errs = [];
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 400, height: 800 } });
  const pg = await newPage(ctx, errs);

  // migration from old localStorage key "resetlog" (old shape, no version)
  await pg.addInitScript(() => {
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('__seeded', '1');
      localStorage.setItem('resetlog', JSON.stringify({
        settings: null,
        days: { '2026-09-01': { vals: { steps: 9000 }, rules: { nofried: true }, weight: 88.5, waist: null, note: 'old day', date: '2026-09-01', updatedAt: 1000 } }
      }));
    }
  });
  await pg.goto(base);
  await pg.waitForFunction(() => document.getElementById('sDays').textContent !== '0');
  let d = await stored(pg);
  ok(d && d.version === 1 && d.days['2026-09-01'] && d.days['2026-09-01'].weight === 88.5, 'old localStorage data migrated into Preferences with version 1', d);
  ok(d.settings.habits.length === 8 && d.settings.rules.length === 4, 'default settings used when old data had none');
  ok(await pg.evaluate(() => localStorage.getItem('CapacitorStorage.resetlog_migrated') === '1'), 'migration flag set (runs once)');
  ok(!(await pg.evaluate(() => document.documentElement.outerHTML)).match(/googleapis|cdnjs|window\.claude/), 'no CDN / claude references left in page');

  // customise settings
  await tab(pg, 'setup');
  await pg.fill('#nhName', 'Cycling'); await pg.fill('#nhTarget', '20'); await pg.fill('#nhUnit', 'km');
  await pg.click('#addHabit');
  await pg.fill('#nrName', 'No chips'); await pg.click('#addRule');
  await pg.fill('#setHabits .list-item:nth-child(1) input', '9500');
  await pg.press('#setHabits .list-item:nth-child(1) input', 'Tab');
  await pg.waitForTimeout(150);

  // log two days
  await tab(pg, 'today');
  await logDay(pg, { steps: 8500, weight: 87.2, note: 'Daal, roti, "quoted", comma' });
  await pg.click('#prevDay');
  await logDay(pg, { steps: 7000, weight: 87.6, note: '- starts with dash' });
  d = await stored(pg);
  const today = new Date(); const pad = n => String(n).padStart(2, '0');
  const tk = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  ok(Object.keys(d.days).length === 3 && d.days[tk], 'two new days saved next to migrated day', Object.keys(d.days));
  ok(d.settings.habits.some(h => h.name === 'Cycling' && h.target === 20) && d.settings.habits[0].target === 9500 && d.settings.rules.some(r => r.name === 'No chips'), 'custom item, rule and edited target persisted');
  const keys = Object.keys(d.days).sort();
  ok(keys.every(k => { const x = d.days[k]; return x.date === k && 'vals' in x && 'rules' in x && 'weight' in x && 'waist' in x && 'note' in x && 'updatedAt' in x; }), 'every day has the exact shape vals/rules/weight/waist/note/date/updatedAt');
  const before = d;

  // export JSON
  await tab(pg, 'setup');
  let [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#expJson')]);
  ok(dl.suggestedFilename() === `resetlog-backup-${tk}.json`, 'JSON export file name', dl.suggestedFilename());
  const jsonPath = await dl.path();
  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  ok(same(exported, before), 'exported JSON equals stored data (version, settings, days)');
  ok((await pg.textContent('#lastBackup')).startsWith('Last backup: ') && !(await pg.textContent('#lastBackup')).includes('never'), 'Last backup time shown after export');

  // export CSV
  [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#expCsv')]);
  ok(dl.suggestedFilename() === `resetlog-${tk}.csv`, 'CSV export file name', dl.suggestedFilename());
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  ok(lines.length === 4, 'CSV has header + one row per day', lines.length);
  ok(lines[0].startsWith('Date,Score %,Steps (steps),Brisk walk (min),') && lines[0].includes('Cycling (km)') && lines[0].includes('No chips') && lines[0].endsWith('Weight (kg),Waist (cm),Note'), 'CSV header has every habit, rule, weight, waist, note', lines[0]);
  ok(lines[1].startsWith('2026-09-01,') && lines[1].includes(',yes,') , 'CSV rows sorted by date with yes/no rules', lines[1]);
  ok(csv.includes('"Daal, roti, ""quoted"", comma"') && csv.includes("'- starts with dash"), 'CSV escapes commas/quotes and guards formula-like notes');

  // wipe, then restore (Replace)
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('__seeded', '1'); });
  await pg.reload();
  await pg.waitForSelector('#sDays',{state:'attached'});
  ok((await pg.textContent('#sDays')) === '0', 'wiped: app is empty after clearing storage');
  await tab(pg, 'setup');
  await pg.setInputFiles('#restoreFile', jsonPath);
  await pg.waitForSelector('#modal:not([hidden])');
  const body1 = await pg.textContent('#mBody');
  ok(/has 3 logged days/.test(body1), 'confirmation shows number of days in the file', body1);
  await pg.click('#mBtns button:has-text("Continue")');
  await pg.waitForSelector('#mBtns button:has-text("Merge")');
  ok((await pg.$$('#mBtns button')).length === 3, 'second step offers Merge / Replace everything / Cancel');
  await pg.click('#mBtns button:has-text("Replace everything")');
  await pg.waitForFunction(() => document.getElementById('modal').hidden);
  await waitMsg(pg);
  const after = await stored(pg);
  ok(same(after, before), 'after restore, stored data is identical to the backup (all days + settings)');
  ok((await pg.textContent('#sDays')) === '3', 'Progress shows 3 days again');
  ok((await pg.inputValue('#setHabits .list-item:nth-child(1) input')) === '9500' && (await pg.textContent('#setHabits')).includes('Cycling') && (await pg.textContent('#setRules')).includes('No chips'), 'targets, custom item and rule restored in My plan');

  // cancel does nothing; Merge: newer updatedAt wins per day
  await pg.setInputFiles('#restoreFile', {
    name: 'older.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1, settings: before.settings,
      days: {
        [tk]: { ...before.days[tk], weight: 99, updatedAt: 1 },               // older -> local kept
        '2026-09-01': { ...before.days['2026-09-01'], weight: 70, updatedAt: before.days['2026-09-01'].updatedAt + 5 }, // newer -> wins
        '2026-08-01': { vals: { steps: 100 }, rules: {}, weight: null, waist: null, note: 'extra', date: '2026-08-01', updatedAt: 5 } // new -> added
      }
    }))
  });
  await pg.click('#mBtns button:has-text("Continue")');
  await pg.click('#mBtns button:has-text("Merge")');
  await pg.waitForFunction(() => document.getElementById('modal').hidden && /Merged/.test(document.getElementById('bkMsg').textContent));
  const merged = await stored(pg);
  ok(merged.days[tk].weight === before.days[tk].weight && merged.days['2026-09-01'].weight === 70 && merged.days['2026-08-01'] && Object.keys(merged.days).length === 4, 'Merge: newer wins per day, older ignored, new days added', { m: merged.days[tk].weight });
  ok(/1 new, 1 updated, 1 kept/.test((await bkMsg(pg)).text), 'Merge summary message', (await bkMsg(pg)).text);

  // cancel path
  await pg.setInputFiles('#restoreFile', jsonPath);
  await pg.click('#mBtns button:has-text("Continue")');
  await pg.click('#mBtns button:has-text("Cancel")');
  ok(same(await stored(pg), merged), 'Cancel leaves data untouched');

  // invalid files => clear inline errors, no data change
  const bad = [
    ['not json', 'junk.json', 'this is not json', /isn't valid JSON/],
    ['wrong shape', 'arr.json', '[1,2,3]', /expected a JSON object/],
    ['no days', 'nodays.json', JSON.stringify({ version: 1, settings: { habits: [], rules: [] } }), /'days'/],
    ['bad date key', 'baddate.json', JSON.stringify({ version: 1, settings: { habits: [], rules: [] }, days: { 'yesterday': {} } }), /not a valid date/],
    ['bad value', 'badval.json', JSON.stringify({ version: 1, settings: { habits: [], rules: [] }, days: { '2026-01-01': { vals: { steps: 'x' } } } }), /non-numeric/],
    ['newer version', 'v9.json', JSON.stringify({ version: 9, settings: { habits: [], rules: [] }, days: {} }), /newer version/],
    ['html in id', 'xss.json', JSON.stringify({ version: 1, settings: { habits: [{ id: '"><img src=x onerror=alert(1)>', name: 'x', unit: 'u', target: 1 }], rules: [] }, days: {} }), /Habit #1/]
  ];
  for (const [label, name, content, re] of bad) {
    await pg.evaluate(() => { document.getElementById('bkMsg').textContent = ''; });
    await pg.setInputFiles('#restoreFile', { name, mimeType: 'application/json', buffer: Buffer.from(content) });
    await waitMsg(pg);
    const m = await bkMsg(pg);
    ok(m.bad && re.test(m.text) && !(await pg.$('#modal:not([hidden])')), `invalid file rejected with message: ${label}`, m.text);
  }
  ok(same(await stored(pg), merged), 'invalid files never change stored data');
  ok(errs.length === 0, 'no JS errors in Part A', errs);
  await ctx.close();
}

/* =============== Part B: mocked native bridge =============== */
console.log('Part B: mocked native bridge');
const MOCK = `
(function(){
  var KEY='__mock';
  var st=JSON.parse(localStorage.getItem(KEY)||'null')||{prefs:{},fs:{},calls:[],perm:'prompt',requestResult:'granted',failWrite:false,shareMode:'ok',exit:0};
  function save(){localStorage.setItem(KEY,JSON.stringify(st))}
  function rec(n,a){st.calls.push({n:n,a:a});save()}
  var listeners={};
  window.__mock={st:function(){return JSON.parse(localStorage.getItem(KEY))},
    fire:function(ev,p){(listeners[ev]||[]).forEach(function(f){f(p||{})})},
    set:function(k,v){st[k]=v;save()}};
  window.ResetNative={
    isNative:true,
    Preferences:{get:async function(o){return{value:o.key in st.prefs?st.prefs[o.key]:null}},set:async function(o){st.prefs[o.key]=o.value;save()}},
    Directory:{Documents:'DOCUMENTS',Cache:'CACHE'},Encoding:{UTF8:'utf8'},
    Filesystem:{
      writeFile:async function(o){
        if(st.failWrite&&o.directory==='DOCUMENTS')throw new Error('EACCES: permission denied');
        var p=o.directory+'/'+o.path;st.fs[p]=o.data;save();return{uri:'file:///storage/emulated/0/'+(o.directory==='DOCUMENTS'?'Documents':'Cache')+'/'+o.path}},
      readdir:async function(o){var pre=o.directory+'/'+o.path+'/';return{files:Object.keys(st.fs).filter(function(k){return k.indexOf(pre)===0&&k.slice(pre.length).indexOf('/')<0}).map(function(k){return{name:k.slice(pre.length),type:'file',size:st.fs[k].length}})}},
      deleteFile:async function(o){var p=o.directory+'/'+o.path;if(!(p in st.fs))throw new Error('missing');delete st.fs[p];rec('deleteFile',o.path)}
    },
    Share:{share:async function(o){rec('share',o);if(st.shareMode==='cancel')throw new Error('Share canceled');if(st.shareMode==='fail')throw new Error('No share targets');return{}}},
    LocalNotifications:{
      checkPermissions:async function(){return{display:st.perm}},
      requestPermissions:async function(){rec('requestPermissions');if(st.requestResult==='granted')st.perm='granted';else st.perm='denied';save();return{display:st.perm}},
      cancel:async function(o){rec('cancel',o)},createChannel:async function(o){rec('createChannel',o)},
      schedule:async function(o){rec('schedule',o);return{notifications:[]}},
      addListener:async function(ev,f){(listeners[ev]=listeners[ev]||[]).push(f);return{remove:function(){}}}
    },
    App:{addListener:async function(ev,f){(listeners[ev]=listeners[ev]||[]).push(f);return{remove:function(){}}},exitApp:async function(){st.exit++;save()}},
    StatusBar:{setStyle:async function(o){rec('statusStyle',o)},setBackgroundColor:async function(o){rec('statusBg',o)}}
  };
})();`;

{
  const errs = [];
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 400, height: 800 } });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const pg = await newPage(ctx, errs);
  const mock = () => pg.evaluate(() => window.__mock.st());
  const calls = async n => (await mock()).calls.filter(c => c.n === n);
  const today = new Date(); const pad = n => String(n).padStart(2, '0');
  const tk = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  // seed 9 older dated auto-backups + an unrelated manual export before first load
  await pg.addInitScript(() => {
    if (!localStorage.getItem('__mock')) {
      const fsx = {};
      for (let i = 1; i <= 9; i++) fsx[`DOCUMENTS/ResetLog/resetlog-autobackup-2026-08-0${i}.json`] = '{}';
      fsx['DOCUMENTS/ResetLog/resetlog-backup-2026-08-01.json'] = '{"manual":true}';
      localStorage.setItem('__mock', JSON.stringify({ prefs: {}, fs: fsx, calls: [], perm: 'prompt', requestResult: 'granted', failWrite: false, shareMode: 'ok', exit: 0 }));
    }
  });
  await pg.goto(base);
  await pg.waitForSelector('#sDays',{state:'attached'});
  ok((await pg.textContent('#storeNote')).includes('Documents/ResetLog'), 'native mode note mentions Documents/ResetLog');
  ok((await pg.textContent('#lastBackup')) === 'Last backup: never', 'Last backup shows "never" at first');

  // save -> auto backup
  await logDay(pg, { steps: 8000, weight: 87, note: 'native day' });
  await pg.waitForFunction(() => !document.getElementById('lastBackup').textContent.includes('never'));
  let m = await mock();
  const pref = JSON.parse(m.prefs.resetlog);
  ok(pref.version === 1 && pref.days[tk], 'Preferences holds the data object (version 1) after save');
  const auto = m.fs['DOCUMENTS/ResetLog/resetlog-autobackup.json'];
  ok(auto && same(JSON.parse(auto), pref), 'Documents/ResetLog/resetlog-autobackup.json written with full data');
  ok(m.fs[`DOCUMENTS/ResetLog/resetlog-autobackup-${tk}.json`] === auto, "today's dated copy written");
  const dated = Object.keys(m.fs).filter(k => /resetlog-autobackup-\d{4}-\d{2}-\d{2}\.json$/.test(k)).map(k => k.split('-autobackup-')[1].slice(0, 10)).sort();
  ok(dated.length === 7 && dated.includes(tk) && !dated.includes('2026-08-01') && !dated.includes('2026-08-03') && dated.includes('2026-08-04'), 'only the newest 7 dated copies are kept', dated);
  ok('DOCUMENTS/ResetLog/resetlog-backup-2026-08-01.json' in m.fs, 'manual exports are never pruned');
  ok((await bkMsg(pg)).text === '', 'no error shown after a good auto backup');

  // auto backup failure is visible
  await pg.evaluate(() => window.__mock.set('failWrite', true));
  await tab(pg, 'today');
  await pg.fill('#note', 'second save');
  await pg.click('#saveBtn');
  await waitMsg(pg);
  const e1 = await bkMsg(pg);
  ok(e1.bad && /Automatic backup failed: EACCES/.test(e1.text), 'failed auto backup shows an inline error', e1.text);

  // JSON export with failing Documents -> error text + temp copy still shared
  await tab(pg, 'setup');
  await pg.evaluate(() => { document.getElementById('bkMsg').textContent = ''; });
  await pg.click('#expJson');
  await pg.waitForFunction(() => /Documents|share|Shared/i.test(document.getElementById('bkMsg').textContent));
  const e2 = await bkMsg(pg);
  const shares = await calls('share');
  ok(/Couldn't save a copy in Documents \(EACCES/.test(e2.text) && shares.length === 1 && /Cache\//.test(shares[0].a.files[0]), 'export falls back to a temp copy and reports the Documents error', e2.text);
  await pg.evaluate(() => window.__mock.set('failWrite', false));

  // JSON export happy path
  await pg.evaluate(() => { document.getElementById('bkMsg').textContent = ''; });
  await pg.click('#expJson');
  await pg.waitForFunction(() => /Shared\./.test(document.getElementById('bkMsg').textContent));
  m = await mock();
  const sh = (await calls('share')).pop().a;
  ok(sh.files.length === 1 && sh.files[0].endsWith(`/Documents/ResetLog/resetlog-backup-${tk}.json`), 'JSON export shared from Documents/ResetLog with the right name', sh.files);
  ok(same(JSON.parse(m.fs[`DOCUMENTS/ResetLog/resetlog-backup-${tk}.json`]), JSON.parse(m.prefs.resetlog)), 'exported JSON contains the full data object');
  const m1 = await bkMsg(pg);
  ok(!m1.bad && m1.text.includes(`Saved to Documents/ResetLog/resetlog-backup-${tk}.json`), 'success message names the saved file', m1.text);

  // CSV via share
  await pg.click('#expCsv');
  await pg.waitForFunction(() => /resetlog-.*\.csv/.test(document.getElementById('bkMsg').textContent));
  const csvKey = `DOCUMENTS/ResetLog/resetlog-${tk}.csv`;
  m = await mock();
  ok(m.fs[csvKey] && m.fs[csvKey].startsWith('﻿Date,Score %') && (await calls('share')).pop().a.files[0].endsWith('.csv'), 'CSV written to Documents and shared');

  // share cancelled / share failure
  await pg.evaluate(() => window.__mock.set('shareMode', 'cancel'));
  await pg.click('#expJson');
  await pg.waitForFunction(() => /cancelled/.test(document.getElementById('bkMsg').textContent));
  ok(!(await bkMsg(pg)).bad, 'cancelling the share sheet is not an error');
  await pg.evaluate(() => window.__mock.set('shareMode', 'fail'));
  await pg.click('#expJson');
  await pg.waitForFunction(() => /share sheet/.test(document.getElementById('bkMsg').textContent));
  const e3 = await bkMsg(pg);
  ok(e3.bad && /No share targets/.test(e3.text), 'share failure is shown inline', e3.text);
  await pg.evaluate(() => window.__mock.set('shareMode', 'ok'));

  // restore on native writes a safety copy first
  const snapshot = JSON.parse((await mock()).prefs.resetlog);
  await pg.setInputFiles('#restoreFile', { name: 'new-phone.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, settings: snapshot.settings, days: { '2026-01-05': { vals: { steps: 1 }, rules: {}, weight: 90, waist: 100, note: '', date: '2026-01-05', updatedAt: 3 } } })) });
  await pg.click('#mBtns button:has-text("Continue")');
  await pg.click('#mBtns button:has-text("Replace everything")');
  await pg.waitForFunction(() => /Replaced everything/.test(document.getElementById('bkMsg').textContent), null, { timeout: 5000 }).catch(async e => { console.log('DEBUG bkMsg:', JSON.stringify(await bkMsg(pg)), JSON.stringify(errs)); throw e; });
  m = await mock();
  ok(same(JSON.parse(m.fs['DOCUMENTS/ResetLog/resetlog-before-restore.json']), snapshot), 'safety copy of the old data saved before restoring');
  ok(Object.keys(JSON.parse(m.prefs.resetlog).days).join() === '2026-01-05', 'Replace everything leaves only the backup days');
  ok(same(JSON.parse(m.fs['DOCUMENTS/ResetLog/resetlog-autobackup.json']), JSON.parse(m.prefs.resetlog)), 'auto backup refreshed after restore');

  // reminder: denied, then granted
  await tab(pg, 'setup');
  await pg.evaluate(() => window.__mock.set('requestResult', 'denied'));
  await pg.click('#remOn'); // handler reverts the box, so click rather than check()
  await pg.waitForFunction(() => document.getElementById('remMsg').textContent.length > 0);
  const r1 = await pg.$eval('#remMsg', e => ({ t: e.textContent, bad: e.classList.contains('bad') }));
  ok(r1.bad && /blocked/i.test(r1.t) && !(await pg.isChecked('#remOn')) && (await calls('schedule')).length === 0, 'denied permission: toggle reverts and a message is shown', r1);
  await pg.evaluate(() => { window.__mock.set('requestResult', 'granted'); window.__mock.set('perm', 'prompt'); });
  ok((await pg.inputValue('#remTime')) === '21:00', 'default reminder time is 9:00 PM');
  await pg.check('#remOn');
  await pg.waitForFunction(() => /Reminder set/.test(document.getElementById('remMsg').textContent));
  let sch = (await calls('schedule')).pop().a.notifications[0];
  ok(sch.schedule.on.hour === 21 && sch.schedule.on.minute === 0 && sch.body === 'Time to log today. How did your workout and food go?' && sch.title === 'Reset Log', 'daily repeating schedule at 21:00 with the requested text', sch);
  ok(sch.isExactNotification === false && sch.schedule.allowWhileIdle === true && sch.channelId === 'daily-reminder', 'inexact, doze-friendly, own channel');
  ok((await calls('requestPermissions')).length >= 2, 'permission requested when the toggle is turned on');
  await pg.fill('#remTime', '07:30');
  await pg.waitForFunction(() => /moved to/i.test(document.getElementById('remMsg').textContent));
  sch = (await calls('schedule')).pop().a.notifications[0];
  ok(sch.schedule.on.hour === 7 && sch.schedule.on.minute === 30, 'changing the time reschedules', sch.schedule);
  // persists + re-armed on next launch
  const nBefore = (await calls('schedule')).length;
  await pg.reload();
  await pg.waitForSelector('#sDays',{state:'attached'});
  await tab(pg, 'setup');
  await pg.waitForFunction(() => true);
  await pg.waitForTimeout(300);
  ok((await pg.isChecked('#remOn')) && (await pg.inputValue('#remTime')) === '07:30', 'reminder settings survive a restart');
  ok((await calls('schedule')).length === nBefore + 1, 'reminder is re-armed on launch');
  await pg.uncheck('#remOn');
  await pg.waitForFunction(() => /off/i.test(document.getElementById('remMsg').textContent));
  ok((await calls('cancel')).length >= 3 && !JSON.parse((await mock()).prefs.resetlog_meta).reminder.enabled, 'turning off cancels the notification');

  // back button + notification tap
  await tab(pg, 'progress');
  await pg.evaluate(() => window.__mock.fire('backButton'));
  ok((await pg.getAttribute('nav button[data-tab="today"]', 'aria-selected')) === 'true' && (await mock()).exit === 0, 'back from another tab goes to Today first');
  await pg.evaluate(() => window.__mock.fire('backButton'));
  ok((await mock()).exit === 1, 'back on Today exits the app');
  await tab(pg, 'setup');
  await pg.setInputFiles('#restoreFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, settings: { habits: [], rules: [] }, days: {} })) });
  await pg.waitForSelector('#modal:not([hidden])');
  await pg.evaluate(() => window.__mock.fire('backButton'));
  ok(await pg.$eval('#modal', e => e.hidden) && (await pg.getAttribute('nav button[data-tab="setup"]', 'aria-selected')) === 'true' && (await mock()).exit === 1, 'back closes an open dialog first');
  await tab(pg, 'progress');
  await pg.evaluate(() => window.__mock.fire('localNotificationActionPerformed', { actionId: 'tap' }));
  ok((await pg.getAttribute('nav button[data-tab="today"]', 'aria-selected')) === 'true', 'tapping the notification opens the Today tab');
  ok((await calls('statusBg')).length > 0 && (await calls('statusStyle')).length > 0, 'status bar colour/style synced with the theme');
  ok(errs.length === 0, 'no JS errors in Part B', errs);
  await ctx.close();
}

// dark mode: status bar colour follows the background
{
  const errs = [];
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const pg = await newPage(ctx, errs);
  await pg.goto(base);
  await pg.waitForSelector('#sDays',{state:'attached'});
  const c = (await pg.evaluate(() => window.__mock.st())).calls.filter(x => x.n === 'statusBg').pop();
  const s = (await pg.evaluate(() => window.__mock.st())).calls.filter(x => x.n === 'statusStyle').pop();
  ok(c && c.a.color.toLowerCase() === '#121718' && s.a.style === 'DARK', 'dark mode: status bar #121718 with light icons', c);
  await ctx.close();
  const ctx2 = await browser.newContext({ colorScheme: 'light' });
  await ctx2.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const p2 = await newPage(ctx2, errs);
  await p2.goto(base);
  await p2.waitForSelector('#sDays',{state:'attached'});
  const c2 = (await p2.evaluate(() => window.__mock.st())).calls.filter(x => x.n === 'statusBg').pop();
  ok(c2 && c2.a.color.toLowerCase() === '#f3f4ef', 'light mode: status bar #F3F4EF', c2);
  ok(errs.length === 0, 'no JS errors in theme checks', errs);
  await ctx2.close();
}

await browser.close();
srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
