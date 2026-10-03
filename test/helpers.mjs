// Shared helpers: static server, page drivers for the redesigned UI, and the mock native bridge.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };
export function serve() {
  const srv = http.createServer((q, r) => {
    let f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (f.endsWith(path.sep)) f += 'index.html';
    fs.readFile(f, (e, d) => {
      if (e) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
      r.end(d);
    });
  }).listen(0);
  return { srv, base: `http://localhost:${srv.address().port}/` };
}
export const launch = () => chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());

export function counter() {
  const c = { pass: 0, fail: 0 };
  c.ok = (cond, name, extra) => { if (cond) { c.pass++; console.log('  PASS', name); } else { c.fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
  return c;
}
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
export const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => ymd(new Date());
export const daysAgo = n => ymd(new Date(Date.now() - n * 864e5));

export async function newPage(ctx, errs, opts = {}) {
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource|ERR_INTERNET/.test(m.text())) errs.push('console: ' + m.text()); });
  if (opts.dialogs !== false) pg.on('dialog', d => d.accept());
  return pg;
}
// skips onboarding unless asked to show it
export const skipOnboarding = ctx => ctx.addInitScript(() => { if (!localStorage.getItem('__ob')) { localStorage.setItem('__ob', '1'); localStorage.setItem('CapacitorStorage.comeback_onboarded', '1'); } });

// Settings opens from the gear in the top bar (it is not a tab)
export const gear = async pg => { if (await pg.isVisible('#gearBtn')) await pg.click('#gearBtn'); await pg.waitForSelector('#p-settings.on'); };
export const tab = (pg, t) => pg.click(`.tab[data-tab="${t}"]`);
// the original eight habits by their old position on Today (1 = Steps), and the four original food rules
export const HABIT_IDS = ['steps', 'walk', 'pushups', 'pullups', 'squats', 'plank', 'water', 'sleep'];
export const RULE_IDS = ['nofried', 'nosugar', 'nomaida', 'nolate'];
export const hid = i => typeof i === 'number' ? HABIT_IDS[i - 1] : i;
export const cardSel = i => `#sections .hcard[data-id="${hid(i)}"]`;
export const ready = pg => pg.waitForSelector('#sections .titem', { state: 'attached' });
export const stored = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.comeback')));
export const sheetGone = pg => pg.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 5000 });
export const settle = pg => pg.waitForTimeout(750); // auto-save debounce (400ms) + write

export async function enterNumber(pg, text) {
  for (const ch of String(text)) await pg.click(`.keypad .key[aria-label="${ch === '.' ? 'Decimal point' : ch}"]`);
}
export async function setHabit(pg, idx, value) {
  // a card that already hit its target shrinks to one line; tap it to open it again
  const done = `#sections .drow[data-id="${hid(idx)}"]`;
  if (await pg.$(done)) await pg.click(done);
  await pg.click(`${cardSel(idx)} .hc-main`);
  await pg.waitForSelector('.keypad');
  await enterNumber(pg, value);
  await pg.click('.sheet .txtbtn.strong');
  await sheetGone(pg);
}
// the Body and notes section starts collapsed; open it (and keep it open)
export async function openBody(pg) {
  const t = '.tsec[data-sec="body"] .tsec-toggle[aria-expanded="false"]';
  if (await pg.$(t)) { await pg.click(t); await pg.waitForSelector('.tsec[data-sec="body"] .tsec-toggle[aria-expanded="true"]'); }
}
export async function setBody(pg, which, value) {
  await openBody(pg);
  await pg.click(which === 'weight' ? '#rowWeight' : '#rowWaist');
  await pg.waitForSelector('.keypad');
  await enterNumber(pg, value);
  await pg.click('.sheet .txtbtn.strong');
  await sheetGone(pg);
}
export async function setNote(pg, text) {
  await openBody(pg);
  await pg.click('#rowNote');
  await pg.fill('#noteTa', text);
  await pg.click('.sheet .txtbtn.strong');
  await sheetGone(pg);
}
export async function toggleRule(pg, idx) { await pg.click(`#sections .yrow[data-id="${typeof idx === 'number' ? RULE_IDS[idx - 1] : idx}"] .row`); }
export async function goDate(pg, date) {
  await tab(pg, 'today');
  await pg.click('#dayLabel');
  await pg.fill('#dateIn', date);
  await pg.click('.sheet .txtbtn.strong');
  await sheetGone(pg);
}
export async function actionChoose(pg, label) {
  // wait for exactly the sheet we mean, mark it, click, then wait for that one sheet to go (a follow-up sheet may appear)
  await pg.waitForFunction(l => [...document.querySelectorAll('.asheet')].filter(a => !a.dataset.picked && a.textContent.includes(l)).length === 1, label, { timeout: 5000 });
  await pg.evaluate(l => { [...document.querySelectorAll('.asheet')].filter(a => !a.dataset.picked && a.textContent.includes(l))[0].dataset.picked = '1'; }, label);
  await pg.click(`.asheet[data-picked] .ab:has-text("${label}")`);
  await pg.waitForFunction(() => !document.querySelector('.asheet[data-picked]'), null, { timeout: 5000 });
}
// habit + body + note in one go, like logging a day
// (steps cannot be typed in any more, so "reps" logs Pushups, the third target)
export async function logDay(pg, { reps, weight, note }) {
  await tab(pg, 'today');
  if (reps != null) await setHabit(pg, 3, reps);
  if (weight != null) await setBody(pg, 'weight', weight);
  if (note != null) await setNote(pg, note);
  await settle(pg);
}

/* ---------- mock native bridge (replaces vendor/native.js) ---------- */
export const MOCK = `
(function(){
  var KEY='__mock';
  var st=JSON.parse(localStorage.getItem(KEY)||'null')||{prefs:{comeback_onboarded:'1'},fs:{},calls:[],perm:'prompt',requestResult:'granted',failWrite:false,shareMode:'ok',exit:0};
  if(!st.pending)st.pending={};   // notifications that are scheduled right now, by id (schedule adds, cancel removes)
  if(!st.steps)st.steps={activityGranted:true,locationGranted:true,batteryIgnored:false,brand:'xiaomi',health:'working',source:'counter',days:{},filteredToday:0,cfg:{enabled:false}};
  function save(){localStorage.setItem(KEY,JSON.stringify(st))}
  function rec(n,a){st.calls.push({n:n,a:a});save()}
  var listeners={};
  window.__mock={st:function(){return JSON.parse(localStorage.getItem(KEY))},
    fire:function(ev,p){(listeners[ev]||[]).forEach(function(f){f(p||{})})},
    set:function(k,v){st[k]=v;save()},
    steps:function(p){Object.assign(st.steps,p);save()}};
  window.ComebackNative={
    isNative:true,
    Preferences:{get:async function(o){return{value:o.key in st.prefs?st.prefs[o.key]:null}},set:async function(o){st.prefs[o.key]=o.value;save()},remove:async function(o){delete st.prefs[o.key];save()},keys:async function(){return{keys:Object.keys(st.prefs)}}},
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
      cancel:async function(o){rec('cancel',o);(o.notifications||[]).forEach(function(n){delete st.pending[n.id]});save()},createChannel:async function(o){rec('createChannel',o)},
      schedule:async function(o){rec('schedule',o);(o.notifications||[]).forEach(function(n){st.pending[n.id]=n});save();return{notifications:[]}},
      getPending:async function(){return{notifications:Object.keys(st.pending).map(function(k){return st.pending[k]})}},
      addListener:async function(ev,f){(listeners[ev]=listeners[ev]||[]).push(f);return{remove:function(){}}}
    },
    App:{addListener:async function(ev,f){(listeners[ev]=listeners[ev]||[]).push(f);return{remove:function(){}}},exitApp:async function(){st.exit++;save()}},
    StatusBar:{setStyle:async function(o){rec('statusStyle',o)},setBackgroundColor:async function(o){rec('statusBg',o)}},
    Steps:(function(){
      function hk(){return st.steps.activityGranted===false?'permission_missing':st.steps.health}
      function status(){var c=st.steps.cfg;return{supported:{stepCounter:st.steps.source==='counter',stepDetector:true,accelerometer:true,activityRecognition:!st.steps.noAR},source:st.steps.source,enabled:!!c.enabled,health:hk(),inVehicle:st.steps.health==='paused_vehicle',activityPermission:st.steps.activityGranted,locationPermission:st.steps.locationGranted,batteryIgnored:st.steps.batteryIgnored,brand:st.steps.brand,manufacturer:'Test',model:'Mock',sdk:35,todaySteps:0,filteredToday:st.steps.filteredToday,travelDistance:!!c.travelDistance,config:c}}
      return{
        getStatus:async function(){return status()},
        configure:async function(o){rec('stepsConfigure',o);st.steps.cfg=Object.assign({},st.steps.cfg,o);save();return status()},
        requestActivityPermission:async function(){rec('reqActivity');if(st.steps.activityGranted===false&&st.steps.grantOnRequest){st.steps.activityGranted=true;st.steps.health='working';save()}return{granted:st.steps.activityGranted!==false}},
        requestLocationPermission:async function(){rec('reqLocation');return{granted:st.steps.locationGranted!==false}},
        setTravelDistance:async function(o){rec('setTravelDistance',o);var ok=!!o.enabled&&st.steps.locationGranted!==false;st.steps.cfg=Object.assign({},st.steps.cfg,{travelDistance:ok});save();return{enabled:ok,locationPermission:st.steps.locationGranted!==false}},
        requestIgnoreBatteryOptimizations:async function(){rec('reqBattery');var ok=st.steps.batteryGrant!==false;if(ok)st.steps.batteryIgnored=true;save();return{result:'dialog',granted:ok}},
        openSettings:async function(o){rec('openSettings',o);return{result:'ok'}},
        getDeviceInfo:async function(){return{brand:st.steps.brand,manufacturer:'Test',model:'Mock',sdk:35,batteryIgnored:st.steps.batteryIgnored}},
        getDays:async function(){rec('stepsGetDays');return{days:st.steps.days,health:hk(),inVehicle:st.steps.health==='paused_vehicle'}},
        addListener:async function(ev,f){(listeners[ev]=listeners[ev]||[]).push(f);return{remove:function(){}}}
      }
    })(),
    Haptics:{impact:async function(o){rec('impact',o)},notification:async function(o){rec('notify',o)}},
    ImpactStyle:{Light:'LIGHT',Medium:'MEDIUM'},NotificationType:{Success:'SUCCESS'}
  };
})();`;

// The reminder time is a 12-hour picker (hour, minute, AM/PM); .value is still "HH:MM"
export const getTime = (pg, sel) => pg.$eval(sel, e => e.value);
export const setTime = (pg, sel, hhmm) => pg.$eval(sel, (e, v) => { e.value = v; e.querySelector('select').dispatchEvent(new Event('change', { bubbles: true })); }, hhmm);
