// Progress photos (www/js/photos.js): private, device-only. Pure helpers in node, then the real page against the mocked native
// bridge (Filesystem in Directory.Data) and a plain browser (IndexedDB): add (camera and gallery inputs), scaling and rotation, the
// 3-photo cap, delete with Undo, the viewer, the Progress strip, before/after (keyboard and pointer), the monthly prompt, the
// clean-up of unused files, what is NOT sent to the cloud or put in the CSV, accessibility names and 360 px layout.
// Run: node test/photos-test.mjs
import { createRequire } from 'module';
import { serve, launch, counter, newPage, tab, ready, openBody, sheetGone, settle, MOCK, skipOnboarding, daysAgo, todayKey, ymd } from './helpers.mjs';

const P = createRequire(import.meta.url)('../www/js/photos.js');
const { srv, base } = serve();
const T = counter(); const ok = T.ok;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dlabel = k => { const p = k.split('-').map(Number); return p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0]; };

/* ---------- pure helpers ---------- */
console.log('Pure helpers');
{
  const K = '2026-10-03';
  ok(['2026-10-03.jpg', '2026-10-03-2.jpg', '2026-10-03-3.jpg'].every(P.valid), 'the three kinds of name are valid');
  ok(!['2026-10-03.png', '2026-10-3.jpg', '../2026-10-03.jpg', '2026-10-03-22.jpg', 'a/2026-10-03.jpg', '2026-10-03.jpg ', '', null, 5, {}, undefined, '2026-10-03.JPG'].some(P.valid), 'anything else is not');
  ok(P.dateOf('2026-10-03-2.jpg') === K && P.dateOf('x') === null, 'dateOf reads the day from a name');
  ok(JSON.stringify(P.clean(['2026-10-03.jpg', '2026-10-03.jpg', '2026-10-04.jpg', 'junk', '2026-10-03-2.jpg', '2026-10-03-3.jpg', '2026-10-03-4.jpg'], K)) === JSON.stringify(['2026-10-03.jpg', '2026-10-03-2.jpg', '2026-10-03-3.jpg']), 'clean drops duplicates, other days and junk and stops at 3');
  ok(P.clean('2026-10-03.jpg', K).length === 0 && P.clean(null, K).length === 0 && P.clean({ 0: 'x' }, K).length === 0, 'clean of a non-array is empty');
  ok(P.next(K, []) === '2026-10-03.jpg' && P.next(K, ['2026-10-03.jpg']) === '2026-10-03-2.jpg' && P.next(K, ['2026-10-03.jpg', '2026-10-03-2.jpg']) === '2026-10-03-3.jpg', 'next gives the first free name');
  ok(P.next(K, ['2026-10-03-2.jpg']) === '2026-10-03.jpg', 'next fills a gap first');
  ok(P.next(K, Array.from({ length: 9 }, (_, i) => P.nameFor(K, i + 1))) === null, 'next gives up after nine');
  ok(P.valid(P.nameFor(K, 1)) && P.valid(P.nameFor(K, 3)), 'nameFor makes valid names');
  ok(JSON.stringify(P.merge(['2026-10-03.jpg'], ['2026-10-03-2.jpg', '2026-10-03.jpg'], K)) === JSON.stringify(['2026-10-03.jpg', '2026-10-03-2.jpg']), 'merge is a union without repeats');
  ok(P.merge(['2026-10-03.jpg', '2026-10-03-2.jpg'], ['2026-10-03-3.jpg', '2026-10-03-4.jpg'], K).length === 3, 'merge keeps at most 3');
  ok(JSON.stringify(P.fit(4000, 3000, 1080)) === JSON.stringify({ w: 1080, h: 810 }) && JSON.stringify(P.fit(3000, 4000, 1080)) === JSON.stringify({ w: 810, h: 1080 }), 'fit scales the long side to 1080');
  ok(JSON.stringify(P.fit(600, 400, 1080)) === JSON.stringify({ w: 600, h: 400 }), 'fit never scales up');
  ok(P.QUALITY === 0.82 && P.MAX === 3 && P.MAX_SIDE === 1080, 'limits: 3 a day, 1080 px, quality 0.82');
  const now = 10 * 3600e3, files = [{ name: 'a.jpg', mtime: 0 }, { name: 'b.jpg', mtime: now - 2 * 3600e3 }, { name: 'c.jpg', mtime: now - 60e3 }, { name: 'd.jpg', mtime: now - 3 * 3600e3 }, { name: 'e.jpg' }, { name: 'f.jpg', mtime: now - 5 * 3600e3 }];
  ok(JSON.stringify(P.orphans(files, new Set(['d.jpg']), now, new Set(['f.jpg']))) === JSON.stringify(['b.jpg']), 'orphans: unreferenced, at least an hour old, not waiting for Undo, age known');
  ok(P.promptDue({ on: true, done: '' }, '2026-10-03', false) && !P.promptDue({ on: false, done: '' }, '2026-10-03', false) && !P.promptDue({ on: true, done: '2026-10' }, '2026-10-20', false) && P.promptDue({ on: true, done: '2026-10' }, '2026-11-01', false) && !P.promptDue({ on: true, done: '' }, '2026-10-03', true) && !P.promptDue(null, '2026-10-03', false), 'the monthly card: on, not done this month, no photo yet this month');
}

/* ---------- the page ---------- */
const browser = await launch();
const MKFILE = `window.__mk=async function(w,h,orient,c1){var c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');var g=x.createLinearGradient(0,0,w,h);g.addColorStop(0,c1||'#3388ff');g.addColorStop(1,'#ffaa44');x.fillStyle=g;x.fillRect(0,0,w,h);x.fillStyle='#000';x.fillRect(0,0,w/10,h/10);
 var blob=await new Promise(function(r){c.toBlob(r,'image/jpeg',.7)});var b=new Uint8Array(await blob.arrayBuffer());
 if(orient){var ex=[0xFF,0xE1,0x00,0x22,0x45,0x78,0x69,0x66,0,0,0x4D,0x4D,0,0x2A,0,0,0,8,0,1,0x01,0x12,0,3,0,0,0,1,0,orient,0,0,0,0,0,0];var o=new Uint8Array(b.length+ex.length);o.set(b.subarray(0,2),0);o.set(ex,2);o.set(b.subarray(2),2+ex.length);b=o}
 var s='';for(var i=0;i<b.length;i+=8192)s+=String.fromCharCode.apply(null,b.subarray(i,i+8192));return btoa(s)};
 window.__file=async function(w,h,orient,c1){var s=atob(await window.__mk(w,h,orient,c1));var u=new Uint8Array(s.length);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return new File([u],'cam.jpg',{type:'image/jpeg'})};
 window.__dims=async function(b64){var s=atob(b64),u=new Uint8Array(s.length);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);var bm=await createImageBitmap(new Blob([u],{type:'image/jpeg'}));var r={w:bm.width,h:bm.height,head:b64.slice(0,4)};bm.close();return r}`;

async function open(opts = {}) {
  const errs = [], reqs = [];
  const ctx = await browser.newContext({ viewport: { width: opts.w || 360, height: opts.h || 800 }, colorScheme: opts.dark ? 'dark' : 'light', reducedMotion: opts.reduce ? 'reduce' : 'no-preference' });
  if (opts.web) await skipOnboarding(ctx); else await ctx.route('**/vendor/native.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const pg = await newPage(ctx, errs);
  pg.on('request', r => reqs.push(r.url()));
  await pg.addInitScript(MKFILE);
  if (opts.seed) await pg.addInitScript(sd => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); localStorage.setItem('__mock', JSON.stringify(sd)); } }, opts.seed);
  await pg.goto(base); await ready(pg); await pg.waitForTimeout(500);
  return { ctx, pg, errs, reqs };
}
const mockSt = pg => pg.evaluate(() => window.__mock.st());
const photoKeys = async pg => Object.keys((await mockSt(pg)).fs).filter(k => k.startsWith('DATA/photos/')).sort();
const addPhoto = (pg, k, w = 1600, h = 1200, orient = 0, c1) => pg.evaluate(async ([k, w, h, o, c]) => { const f = await window.__file(w, h, o, c); return await Photos.add(k, f); }, [k, w, h, orient, c1]);
const namesOf = (pg, k) => pg.evaluate(k => days[k] && days[k].photos || [], k);
const logPushups = pg => pg.evaluate(() => commitDay('x', d => { d.vals.pushups = 12; }, true, todayStr()));
const sheetIn = pg => pg.waitForSelector('.sheet-wrap.in .sheet');
const closeSheets = pg => pg.evaluate(() => closeAllLayers()).then(() => pg.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 5000 }));
const openDaySheet = async pg => { await tab(pg, 'today'); await openBody(pg); await pg.click('#rowPhotos'); await sheetIn(pg); await pg.waitForTimeout(200); };
const noOverflow = pg => pg.evaluate(() => { const de = document.documentElement; const sh = document.querySelector('.sheet'); return de.scrollWidth <= window.innerWidth && (!sh || sh.scrollWidth <= sh.clientWidth + 1); });
const names = pg => pg.evaluate(() => {
  const nm = e => (e.getAttribute('aria-label') || '').trim() || (e.getAttribute('aria-labelledby') ? (document.getElementById(e.getAttribute('aria-labelledby')) || {}).textContent : '') || (e.labels && e.labels[0] ? e.labels[0].textContent.trim() : '') || (e.tagName === 'BUTTON' ? e.textContent.trim() : '');
  return [...document.querySelectorAll('.sheet button, .sheet input, .sheet select, .sheet [role=slider], #photoCard button, #photoCard input, #photoPromptSlot button')].filter(e => e.type !== 'hidden').map(e => ({ tag: e.tagName, role: e.getAttribute('role'), name: nm(e).replace(/\s+/g, ' ') }));
});

/* ---------- Today: the row, adding, scaling, rotation, the cap ---------- */
console.log('Today: add, scale, rotate, cap');
{
  const { ctx, pg, errs, reqs } = await open();
  const TK = todayKey();
  await openBody(pg);
  const row = await pg.$eval('#rowPhotos', e => ({ lab: e.querySelector('.row-label').textContent, sub: e.querySelector('.row-sub').textContent, aria: e.getAttribute('aria-label'), h: e.getBoundingClientRect().height, ic: !!e.querySelector('.row-ic svg path, .row-ic svg circle') }));
  ok(row.lab === 'Photos' && /private/i.test(row.sub) && /Photos\./.test(row.aria) && row.h >= 44 && row.ic, 'Body and notes has a Photos row with an icon, a label and a 44px target', row);
  await pg.click('#rowPhotos'); await sheetIn(pg);
  const sh = await pg.evaluate(() => ({ title: document.querySelector('.sheet h2').textContent, note: document.querySelector('.ph-note').textContent, take: document.getElementById('phTake').textContent.trim(), pick: document.getElementById('phPick').textContent.trim(), cam: [document.getElementById('phInCam').accept, document.getElementById('phInCam').getAttribute('capture')], gal: [document.getElementById('phInPick').accept, document.getElementById('phInPick').getAttribute('capture')], empty: document.querySelector('.ph-empty') && document.querySelector('.ph-empty').textContent }));
  ok(/^Photos · /.test(sh.title) && /not synced to the cloud and not in backups/.test(sh.note), 'the sheet says photos stay on this phone, not in the cloud or in backups', sh);
  ok(sh.take === 'Take a photo' && sh.pick === 'Choose from gallery' && sh.cam[0] === 'image/*' && sh.cam[1] === 'environment' && sh.gal[0] === 'image/*' && sh.gal[1] === null, 'camera input has accept=image/* capture, the gallery input is a plain image picker', sh);
  ok(/No photos/.test(sh.empty), 'empty state is gentle');

  // camera: 2000 x 1000 -> 1080 x 540 JPEG
  const jpg = await pg.evaluate(async () => (await window.__mk(2000, 1000)));
  await pg.setInputFiles('#phInCam', { name: 'cam.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await pg.waitForFunction(() => document.querySelector('.ph-status').textContent === 'Photo added.', null, { timeout: 8000 });
  let keys = await photoKeys(pg);
  ok(JSON.stringify(keys) === JSON.stringify(['DATA/photos/' + TK + '.jpg']), 'the picture is stored in private app storage (Directory.Data, folder photos), named by day', keys);
  const st1 = await mockSt(pg);
  ok(!Object.keys(st1.fs).some(k => /^DOCUMENTS\//.test(k) && /photo|\.jpg/.test(k)) && !Object.keys(st1.fs).some(k => /^CACHE\//.test(k) && /\.jpg/.test(k)), 'nothing was written to Documents or the cache');
  const dm = await pg.evaluate(async k => await window.__dims(Object.values(window.__mock.st().fs)[0] && window.__mock.st().fs[k]), 'DATA/photos/' + TK + '.jpg');
  ok(dm.w === 1080 && dm.h === 540 && dm.head === '/9j/', 'scaled so the long side is 1080 px, saved as a JPEG', dm);
  ok(JSON.stringify(await namesOf(pg, TK)) === JSON.stringify([TK + '.jpg']), 'the day holds the file name');
  await settle(pg);
  const saved = JSON.parse((await mockSt(pg)).prefs.comeback).days;
  ok(JSON.stringify(saved[TK].photos) === JSON.stringify([TK + '.jpg']), 'the name is saved with the day');
  const tile = await pg.waitForSelector('.ph-tile .ph-open.ok img', { timeout: 5000 });
  ok((await tile.getAttribute('src')).startsWith('blob:'), 'the thumbnail is a blob URL');
  const rowSub = await pg.evaluate(() => { document.querySelector('.sheet-wrap') && 0; return document.querySelector('#rowPhotos .row-sub').textContent; });
  ok(/1 photo/.test(rowSub), 'the row now shows the count', rowSub);

  // gallery: a phone photo that is rotated by its EXIF tag (orientation 6 = rotate 90): 2000 x 1000 file shows as 1000 x 2000 -> 540 x 1080
  const rot = await pg.evaluate(async () => (await window.__mk(2000, 1000, 6)));
  await pg.setInputFiles('#phInPick', { name: 'g.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(rot, 'base64') });
  await pg.waitForFunction(() => document.querySelectorAll('.ph-tile').length === 2, null, { timeout: 8000 });
  keys = await photoKeys(pg);
  ok(keys.length === 2 && keys.some(k => k.endsWith(TK + '-2.jpg')), 'a second photo gets the -2 name', keys);
  const dm2 = await pg.evaluate(async k => await window.__dims(window.__mock.st().fs['DATA/photos/' + k + '-2.jpg']), TK);
  ok(dm2.w === 540 && dm2.h === 1080, 'the EXIF rotation is respected (portrait result)', dm2);

  // a third one; then the cap
  await pg.setInputFiles('#phInPick', { name: 'g3.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await pg.waitForFunction(() => document.querySelectorAll('.ph-tile').length === 3, null, { timeout: 8000 });
  ok(JSON.stringify(await namesOf(pg, TK)) === JSON.stringify([TK + '.jpg', TK + '-2.jpg', TK + '-3.jpg']), 'three photos: .jpg, -2, -3');
  const dis = await pg.evaluate(() => [document.getElementById('phTake').disabled, document.getElementById('phPick').disabled, [...document.querySelectorAll('.ph-note')].filter(n => !n.hidden).map(n => n.textContent).join('|')]);
  ok(dis[0] && dis[1] && /3 photos is the most/.test(dis[2]), 'at 3 photos both add buttons are off and a gentle line explains', dis);
  const over = await addPhoto(pg, TK);
  ok(over.ok === false && /3 photos/.test(over.message) && (await photoKeys(pg)).length === 3 && (await namesOf(pg, TK)).length === 3, 'a 4th photo is refused and nothing is written', over);
  await pg.waitForFunction(() => document.querySelectorAll('.ph-tile .ph-open.ok img').length === 3, null, { timeout: 5000 });
  ok(true, 'all three thumbnails load');
  ok(await noOverflow(pg), 'no sideways scrolling at 360 px with the day sheet open');
  const sizes = await pg.evaluate(() => [...document.querySelectorAll('.sheet button, .sheet .btn')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.className, Math.round(r.width), Math.round(r.height)]; }));
  ok(sizes.every(s => s[1] >= 44 && s[2] >= 44), 'every button in the sheet is at least 44 x 44', sizes.filter(s => s[1] < 44 || s[2] < 44));
  const nm = await names(pg);
  ok(nm.length >= 9 && nm.every(n => n.name), 'every control in the sheet has an accessible name', nm.filter(n => !n.name));
  ok(nm.some(n => /^Delete photo 1 of 3$/.test(n.name)) && nm.some(n => /^Photo 2 of 3, \d+ \w+ \d{4}\. Open full size$/.test(n.name)), 'tiles are named by position and date');
  await pg.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  ok(await noOverflow(pg), 'no sideways scrolling at 200% text');
  await pg.evaluate(() => { document.documentElement.style.fontSize = ''; });

  // delete -> Undo restores it in place, file kept meanwhile
  await pg.click('.ph-tile:nth-child(1) .ph-del');
  let after = await namesOf(pg, TK);
  ok(JSON.stringify(after) === JSON.stringify([TK + '-2.jpg', TK + '-3.jpg']), 'delete takes the photo off the day at once');
  ok((await photoKeys(pg)).length === 3, 'the file is kept while the Undo toast is showing');
  const toastNow = await pg.evaluate(() => ({ show: document.getElementById('toast').classList.contains('show'), msg: document.getElementById('toastMsg').textContent, undo: !document.getElementById('toastUndo').hidden }));
  ok(toastNow.show && toastNow.msg === 'Photo deleted' && toastNow.undo, 'a toast with Undo appears', toastNow);
  ok(await pg.evaluate(() => document.querySelectorAll('.ph-tile').length === 2), 'the sheet redraws');
  const inl = await pg.evaluate(() => { const u = document.querySelector('.ph-undo'); return { hidden: u.hidden, txt: u.textContent, h: u.querySelector('button').getBoundingClientRect().height }; });
  ok(!inl.hidden && /Photo deleted/.test(inl.txt) && inl.h >= 44, 'the sheet itself shows an Undo (a toast sits under an open sheet)', inl);
  await pg.click('.ph-undo button');
  await pg.waitForFunction(() => document.querySelectorAll('.ph-tile').length === 3);
  ok(JSON.stringify(await namesOf(pg, TK)) === JSON.stringify([TK + '.jpg', TK + '-2.jpg', TK + '-3.jpg']), 'Undo puts it back in its place');
  ok(await pg.evaluate(() => document.querySelector('.ph-undo').hidden), 'and the Undo bar goes');
  // delete again, close the sheet and use the toast's Undo
  await pg.click('.ph-tile:nth-child(3) .ph-del');
  await closeSheets(pg);
  await pg.click('#toastUndo');
  await pg.waitForFunction(k => (days[k].photos || []).length === 3, TK);
  ok(JSON.stringify(await namesOf(pg, TK)) === JSON.stringify([TK + '.jpg', TK + '-2.jpg', TK + '-3.jpg']), 'the toast\'s Undo works too');
  await pg.click('#rowPhotos'); await sheetIn(pg); await pg.waitForTimeout(200);
  await pg.waitForTimeout(10500);
  ok((await photoKeys(pg)).length === 3, 'after Undo the file is still there once the timer would have fired');
  // delete for good: the file goes when the toast has expired
  await pg.click('.ph-tile:nth-child(2) .ph-del');
  ok(JSON.stringify(await pg.evaluate(() => Photos._state().pending)) === JSON.stringify([TK + '-2.jpg']), 'one file is waiting for its Undo to expire');
  const reuse = await addPhoto(pg, TK);
  ok(reuse.ok && reuse.name === TK + '-4.jpg' || reuse.ok && reuse.name !== TK + '-2.jpg', 'a new photo never takes the name of one waiting for Undo', reuse);
  await pg.waitForFunction(k => !Object.keys(window.__mock.st().fs).includes('DATA/photos/' + k + '-2.jpg'), TK, { timeout: 15000 });
  ok(true, 'the deleted file is removed once the toast has expired');
  ok(JSON.stringify(await pg.evaluate(() => Photos._state().pending)) === '[]', 'nothing is left waiting');

  // viewer
  await pg.click('.ph-tile:nth-child(1) .ph-open');
  await pg.waitForFunction(() => document.querySelectorAll('.sheet').length === 2 && document.querySelector('.ph-full img:not([hidden])'), null, { timeout: 5000 });
  const vw = await pg.evaluate(() => { const i = document.querySelector('.ph-full img'); return { alt: i.alt, src: i.src.slice(0, 5), title: [...document.querySelectorAll('.sheet h2')].pop().textContent, share: !!document.getElementById('phShare'), del: !!document.getElementById('phDelete') }; });
  ok(vw.alt === 'Photo from ' + dlabel(TK) && vw.src === 'blob:' && vw.title === vw.alt && vw.share && vw.del, 'the viewer shows the full picture with a text alternative, Share and Delete', vw);
  await pg.click('#phShare');
  await pg.waitForFunction(() => window.__mock.st().calls.some(c => c.n === 'share'), null, { timeout: 4000 });
  const sc = (await mockSt(pg)).calls.find(c => c.n === 'share');
  ok(sc.a.files.length === 1 && /photo-share-/.test(sc.a.files[0]) && !/DOCUMENTS|Documents/.test(sc.a.files[0]), 'Share sends one copy of the file from the cache, only when tapped', sc.a);
  const vimg = await pg.evaluate(() => document.querySelector('.ph-full img').src);
  await pg.click('#phDelete');
  await pg.waitForFunction(() => document.querySelectorAll('.sheet').length === 1);
  ok((await namesOf(pg, TK)).length === 2, 'Delete from the viewer works and closes it');
  await pg.keyboard.press('Escape').catch(() => {});
  await closeSheets(pg);
  const revoked = await pg.evaluate(async u => { try { await fetch(u); return false; } catch (e) { return true; } }, vimg);
  ok(revoked, 'the viewer revoked its blob URL when it closed');

  // nothing left the phone
  const ext = reqs.filter(u => !u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:'));
  ok(ext.length === 0, 'no network request outside the app', ext);
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ---------- data: normalizeDay, merge, sync payload, CSV, backup ---------- */
console.log('Data: whitelist, merge, cloud payload, CSV, backup');
{
  const { ctx, pg, errs } = await open();
  const K = '2026-10-03';
  const r = await pg.evaluate(k => {
    const base = { vals: { pushups: 3 }, rules: {}, weight: null, waist: null, note: '', updatedAt: 5 };
    const n = x => normalizeDay(k, Object.assign({}, base, x));
    return {
      good: n({ photos: [k + '.jpg', k + '-2.jpg'] }).photos,
      cap: n({ photos: [k + '.jpg', k + '-2.jpg', k + '-3.jpg', k + '-4.jpg'] }).photos,
      dup: n({ photos: [k + '.jpg', k + '.jpg'] }).photos,
      bad: n({ photos: ['../x.jpg', 'evil.png', '2026-10-04.jpg', 7, null, k + '.jpg.exe'] }).photos,
      str: 'photos' in n({ photos: k + '.jpg' }),
      none: 'photos' in n({}),
      photo: 'photo' in n({ photo: k + '.jpg' }),
      u: n({ photos: [k + '.jpg'], extra: 1 }).extra,
      merged: mergeDayRecords(Object.assign({ date: k }, base, { photos: [k + '.jpg'] }), Object.assign({ date: k }, base, { updatedAt: 9, photos: [k + '-2.jpg', k + '.jpg', k + '-3.jpg', k + '-4.jpg'] })).photos,
      mergedOne: mergeDayRecords(Object.assign({ date: k }, base, { photos: [k + '.jpg'] }), Object.assign({ date: k }, base, { updatedAt: 9 })).photos,
      mergedNone: 'photos' in mergeDayRecords(Object.assign({ date: k }, base), Object.assign({ date: k }, base, { updatedAt: 9 })),
      data: JSON.stringify(dayData(Object.assign({ date: k }, base, { photos: [k + '.jpg'] }))),
      restored: normalizeData({ version: 2, settings: buildData().settings, days: { [k]: { vals: {}, photos: [k + '.jpg'] } } }).days[k].photos
    };
  }, K);
  ok(JSON.stringify(r.good) === JSON.stringify([K + '.jpg', K + '-2.jpg']), 'normalizeDay keeps valid names');
  ok(r.cap.length === 3 && r.dup.length === 1, 'normalizeDay: at most 3, no repeats');
  ok(r.bad === undefined && r.str === false && r.none === false && r.photo === false && r.u === undefined, 'normalizeDay: junk, other days, a single string and unknown fields are dropped; no empty array is stored', r);
  ok(JSON.stringify(r.merged) === JSON.stringify([K + '.jpg', K + '-2.jpg', K + '-3.jpg']), 'mergeDayRecords: union of names, max 3', r.merged);
  ok(JSON.stringify(r.mergedOne) === JSON.stringify([K + '.jpg']) && r.mergedNone === false, 'mergeDayRecords: one side only, and neither');
  ok(!/photo|jpg/.test(r.data), 'dayData (the sync payload) has no photos', r.data);
  ok(JSON.stringify(r.restored) === JSON.stringify([K + '.jpg']), 'a restored backup keeps the names');

  // real sync paths against a tiny fake of the cloud client
  await addPhoto(pg, K); await logPushups(pg); await settle(pg);
  const s = await pg.evaluate(async k => {
    const up = [];
    const mk = rows => ({ from: () => { const q = { select: () => q, eq: () => q, order: () => q, range: () => Promise.resolve({ data: rows, error: null }), maybeSingle: () => Promise.resolve({ data: null, error: null }), upsert: r => { up.push(JSON.stringify(r)); return Promise.resolve({ error: null }); } }; return q; } });
    sync.userId = 'u1';
    const L = days[k], t0 = L.updatedAt;
    sync.seen[k] = t0;
    // only the cloud changed: its copy (which never has photos) replaces the day, but this phone's photo names stay
    sb = mk([{ log_date: k, data: { vals: { pushups: 20 }, rules: {}, weight: null, waist: null, note: 'from cloud' }, updated_at: new Date(t0 + 60000).toISOString() }]);
    await pullAndMerge();
    const afterPull = { note: days[k].note, push: days[k].vals.pushups, photos: days[k].photos };
    // both changed: merged field by field, photo names kept
    days[k].updatedAt = t0 + 100000; days[k].vals.water = 1;
    sb = mk([{ log_date: k, data: { vals: { pushups: 25 }, rules: {}, weight: null, waist: null, note: 'again' }, updated_at: new Date(t0 + 200000).toISOString() }]);
    sync.seen[k] = t0 + 60000;
    await pullAndMerge();
    const afterMerge = { photos: days[k].photos, push: days[k].vals.pushups };
    sync.pendingDays = [k];
    await flushPending();
    return { afterPull, afterMerge, up };
  }, K);
  ok(s.afterPull.note === 'from cloud' && s.afterPull.push === 20, 'a cloud-only change was taken in', s.afterPull);
  ok(JSON.stringify(s.afterPull.photos) === JSON.stringify([K + '.jpg']), 'a day replaced by the cloud copy keeps this phone\'s photo names (they were never in the cloud)', s.afterPull);
  ok(JSON.stringify(s.afterMerge.photos) === JSON.stringify([K + '.jpg']), 'a merged day keeps its photo names', s.afterMerge);
  ok(s.up.length >= 1 && s.up.every(u => !/photo|\.jpg/.test(u)), 'what is uploaded to the cloud has no photo names', s.up.map(u => u.slice(0, 200)));

  const out = await pg.evaluate(() => ({ csv: buildCsv(), json: JSON.stringify(buildData()), head: buildCsv().split('\r\n')[0] }));
  ok(!/photo|jpg/i.test(out.csv), 'the CSV has no photo column or names');
  ok(out.json.includes('"photos"') && !/base64|\/9j\//.test(out.json), 'the JSON backup carries the names only, never the pictures');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ---------- a day whose files are not on this phone (a backup from another phone) ---------- */
console.log('Names without files');
{
  const { ctx, pg, errs } = await open();
  const K = daysAgo(2);
  await pg.evaluate(k => { days[k] = Object.assign(Core.blankDay(k), { vals: { pushups: 4 }, photos: [k + '.jpg'], updatedAt: Date.now() }); Core.invalidate(); renderToday(); renderProgress(); }, K);
  await pg.evaluate(k => goTo(k), K).catch(() => {});
  await openDaySheet(pg);
  await pg.waitForSelector('.ph-open.miss', { timeout: 5000 });
  const m = await pg.evaluate(() => ({ t: document.querySelector('.ph-missing').textContent, a: document.querySelector('.ph-open.miss').getAttribute('aria-label') }));
  ok(m.t === 'Not on this phone' && /not on this phone/.test(m.a), 'the tile says the photo is not on this phone (no error, nothing removed)', m);
  ok((await namesOf(pg, K)).length === 1, 'the name is kept');
  await pg.click('.ph-open.miss'); await pg.waitForSelector('.ph-loading:not(:empty)');
  await pg.waitForFunction(() => /not on this phone/.test(document.querySelector('.ph-loading') ? document.querySelector('.ph-loading').textContent : ''));
  ok(true, 'the viewer explains it');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ---------- failure is gentle ---------- */
console.log('Failures');
{
  const { ctx, pg, errs } = await open();
  const TK = todayKey();
  await pg.evaluate(() => window.__mock.set('failPhoto', true));
  await openDaySheet(pg);
  const jpg = await pg.evaluate(async () => await window.__mk(800, 600));
  await pg.setInputFiles('#phInPick', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await pg.waitForFunction(() => /couldn.t be saved/.test(document.querySelector('.ph-status').textContent), null, { timeout: 6000 });
  const msg = await pg.evaluate(() => ({ t: document.querySelector('.ph-status').textContent, role: document.querySelector('.ph-status').getAttribute('role'), live: document.querySelector('.ph-status').getAttribute('aria-live'), dis: document.getElementById('phTake').disabled }));
  ok(/try again/i.test(msg.t) && msg.role === 'status' && !msg.dis, 'a failed save says so gently, announces it, and lets you try again', msg);
  ok((await namesOf(pg, TK)).length === 0 && (await photoKeys(pg)).length === 0, 'a failed save leaves no name and no file');
  // not an image
  await pg.evaluate(() => window.__mock.set('failPhoto', false));
  await pg.setInputFiles('#phInPick', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not a picture') });
  await pg.waitForFunction(() => /couldn.t be saved/.test(document.querySelector('.ph-status').textContent), null, { timeout: 6000 });
  ok((await namesOf(pg, TK)).length === 0 && (await photoKeys(pg)).length === 0, 'a file that is not a picture is refused without leaving anything behind');
  // a write that works afterwards
  await pg.setInputFiles('#phInPick', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await pg.waitForFunction(() => document.querySelector('.ph-status').textContent === 'Photo added.', null, { timeout: 6000 });
  ok((await photoKeys(pg)).length === 1, 'trying again works');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ---------- Progress: strip, viewer, before/after ---------- */
console.log('Progress: strip and compare');
{
  const { ctx, pg, errs } = await open();
  await logPushups(pg);
  await tab(pg, 'progress');
  const none = await pg.evaluate(() => ({ head: document.querySelector('#photoCard h2') && document.querySelector('#photoCard h2').textContent, txt: document.getElementById('photoCard').textContent, cmp: !!document.getElementById('phCardCmp') }));
  ok(none.head === 'Progress photos' && /No progress photos yet/.test(none.txt) && !none.cmp, 'Progress shows a Progress photos card, with a gentle empty state and no compare button', none);
  const dates = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27].map(daysAgo);
  const colours = ['#ff3355', '#33aa55', '#3355ff', '#ffaa00', '#aa33ff', '#00aaaa', '#775533', '#222222', '#eeeeee', '#ff00ff'];
  for (let i = 0; i < dates.length; i++) await addPhoto(pg, dates[i], 1200, 1600, 0, colours[i]);
  await tab(pg, 'progress');
  await pg.waitForFunction(() => document.querySelectorAll('.ph-item').length === 10);
  const items = await pg.$$eval('.ph-item', els => els.map(e => ({ d: e.querySelector('.ph-date').textContent, lab: e.querySelector('.ph-open').getAttribute('aria-label') })));
  ok(items[0].d === dlabel(dates[0]) && items[9].d === dlabel(dates[9]), 'the strip lists every photo, newest first', items.map(i => i.d));
  ok(items.every(i => /^Photo from \d+ \w+ \d{4}\. Open full size$/.test(i.lab)), 'every thumbnail has a text label with its date');
  await pg.evaluate(() => document.getElementById('photoCard').scrollIntoView());
  await pg.waitForTimeout(600);
  const loaded1 = await pg.$$eval('.ph-item img', ims => ims.map(i => !!i.getAttribute('src')));
  ok(loaded1[0] && !loaded1[9], 'thumbnails load lazily (the ones far off to the side wait)', loaded1);
  await pg.evaluate(() => { const s = document.querySelector('.ph-strip'); s.scrollLeft = s.scrollWidth; });
  await pg.waitForFunction(() => !!document.querySelectorAll('.ph-item img')[9].getAttribute('src'), null, { timeout: 5000 });
  ok(true, 'scrolling the strip loads the rest');
  ok(await noOverflow(pg), 'no sideways scrolling of the page at 360 px with the strip');
  const strip = await pg.evaluate(() => { const s = document.querySelector('.ph-strip'); return { role: s.getAttribute('role'), tab: s.tabIndex, label: s.getAttribute('aria-label'), sw: s.scrollWidth > s.clientWidth }; });
  ok(strip.role === 'list' && strip.tab === 0 && /newest first/.test(strip.label) && strip.sw, 'the strip is a labelled, keyboard-scrollable list', strip);
  const tiles = await pg.$$eval('.ph-item .ph-open', bs => bs.map(b => { const r = b.getBoundingClientRect(); return Math.round(r.width) >= 44 && Math.round(r.height) >= 44; }));
  ok(tiles.every(Boolean), 'thumbnails are at least 44 px');

  await pg.evaluate(() => { document.querySelector('.ph-strip').scrollLeft = 0; });
  await pg.click('.ph-item:nth-child(2) .ph-open');
  await pg.waitForFunction(() => document.querySelector('.ph-full img:not([hidden])'));
  const vt = await pg.evaluate(() => document.querySelector('.ph-full img').alt);
  ok(vt === 'Photo from ' + dlabel(dates[1]), 'tapping a thumbnail opens that photo full size', vt);
  await closeSheets(pg);

  // before / after
  await pg.click('#phCardCmp'); await sheetIn(pg); await pg.waitForTimeout(400);
  const c0 = await pg.evaluate(() => ({ b: document.getElementById('phBefore').selectedOptions[0].textContent, a: document.getElementById('phAfter').selectedOptions[0].textContent, n: document.getElementById('phBefore').options.length, ib: document.querySelector('.ph-img.b').alt, ia: document.querySelector('.ph-img.a').alt, sb: !!document.querySelector('.ph-img.b').getAttribute('src'), sa: !!document.querySelector('.ph-img.a').getAttribute('src'), cap: document.querySelector('.ph-cap').textContent, v: document.querySelector('.ph-handle').getAttribute('aria-valuenow') }));
  ok(c0.n === 10 && c0.b === dlabel(dates[9]) && c0.a === dlabel(dates[0]), 'Before starts at the oldest photo and After at the newest', c0);
  ok(c0.ib === 'Before: photo from ' + dlabel(dates[9]) && c0.ia === 'After: photo from ' + dlabel(dates[0]) && c0.sb && c0.sa, 'both pictures have text alternatives with their dates', c0);
  ok(c0.cap === 'Before ' + dlabel(dates[9]) + ' · After ' + dlabel(dates[0]) && c0.v === '50', 'the caption names both dates; the divider starts in the middle', c0);
  const sl = await pg.evaluate(() => { const h = document.querySelector('.ph-handle'); return { role: h.getAttribute('role'), tab: h.tabIndex, label: h.getAttribute('aria-label'), min: h.getAttribute('aria-valuemin'), max: h.getAttribute('aria-valuemax'), text: h.getAttribute('aria-valuetext') }; });
  ok(sl.role === 'slider' && sl.tab === 0 && /arrow keys/i.test(sl.label) && sl.min === '0' && sl.max === '100' && /50 percent/.test(sl.text), 'the divider is a labelled slider with a text value', sl);
  const val = () => pg.evaluate(() => ({ n: document.querySelector('.ph-handle').getAttribute('aria-valuenow'), t: document.querySelector('.ph-handle').getAttribute('aria-valuetext'), clip: document.querySelector('.ph-img.a').style.clipPath, left: document.querySelector('.ph-handle').style.left }));
  await pg.focus('.ph-handle');
  await pg.keyboard.press('ArrowRight'); let v = await val();
  ok(v.n === '55' && /inset\(0(px)? 0(px)? 0(px)? 55%\)/.test(v.clip) && v.left === '55%', 'ArrowRight moves the divider right by 5', v);
  await pg.keyboard.press('ArrowLeft'); await pg.keyboard.press('ArrowLeft'); v = await val();
  ok(v.n === '45', 'ArrowLeft moves it left', v);
  await pg.keyboard.press('Shift+ArrowRight'); v = await val();
  ok(v.n === '46', 'Shift+Arrow moves it by 1', v);
  await pg.keyboard.press('PageUp'); v = await val();
  ok(v.n === '66', 'PageUp moves it by 20', v);
  await pg.keyboard.press('Home'); v = await val();
  ok(v.n === '0' && /only the After/.test(v.t), 'Home shows only the After photo', v);
  await pg.keyboard.press('ArrowLeft'); v = await val();
  ok(v.n === '0', 'it stops at 0');
  await pg.keyboard.press('End'); v = await val();
  ok(v.n === '100' && /only the Before/.test(v.t), 'End shows only the Before photo', v);
  await pg.keyboard.press('ArrowUp'); v = await val();
  ok(v.n === '100', 'it stops at 100');
  const bb = await (await pg.$('.ph-stage')).boundingBox();
  await pg.mouse.click(bb.x + bb.width * 0.25, bb.y + bb.height * 0.5); v = await val();
  ok(Math.abs(Number(v.n) - 25) <= 2, 'tapping the picture puts the divider there', v);
  await pg.mouse.move(bb.x + bb.width * 0.25, bb.y + 40); await pg.mouse.down(); await pg.mouse.move(bb.x + bb.width * 0.8, bb.y + 60, { steps: 6 }); await pg.mouse.up(); v = await val();
  ok(Math.abs(Number(v.n) - 80) <= 2, 'dragging moves it', v);
  await pg.selectOption('#phBefore', dates[5] + '.jpg'); await pg.waitForTimeout(300);
  const c1 = await pg.evaluate(() => ({ ib: document.querySelector('.ph-img.b').alt, cap: document.querySelector('.ph-cap').textContent }));
  ok(c1.ib === 'Before: photo from ' + dlabel(dates[5]) && c1.cap.startsWith('Before ' + dlabel(dates[5])), 'choosing another Before date swaps the picture and its text', c1);
  ok(await noOverflow(pg), 'no sideways scrolling in the compare sheet at 360 px');
  const nm = await names(pg);
  ok(nm.every(n => n.name) && nm.some(n => n.tag === 'SELECT' && /^Before/.test(n.name)) && nm.some(n => n.tag === 'SELECT' && /^After/.test(n.name)) && nm.some(n => n.role === 'slider'), 'compare controls all have accessible names', nm);
  const urlsBefore = await pg.evaluate(() => [document.querySelector('.ph-img.b').src, document.querySelector('.ph-img.a').src]);
  await closeSheets(pg);
  const rev = await pg.evaluate(async us => { const out = []; for (const u of us) { try { await fetch(u); out.push(false); } catch (e) { out.push(true); } } return out; }, urlsBefore);
  ok(rev.every(Boolean), 'closing the compare sheet revokes its blob URLs', rev);
  // card, with dark colours
  await pg.emulateMedia({ colorScheme: 'dark' });
  const dk = await pg.evaluate(() => { const c = document.querySelector('.ph-card'); const r = c.getBoundingClientRect(); return { w: r.width, within: r.right <= window.innerWidth + 1 && r.left >= 0 }; });
  ok(dk.within, 'the Progress photos card fits in dark mode too', dk);
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ---------- the monthly prompt ---------- */
console.log('Monthly prompt');
{
  const { ctx, pg, errs } = await open();
  const now = new Date(); const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15); const PK = ymd(prev);
  await logPushups(pg);
  await addPhoto(pg, PK);
  await tab(pg, 'today');
  ok(await pg.evaluate(() => !document.querySelector('.ph-prompt')), 'off by default: no card on Today');
  await tab(pg, 'progress');
  const sw = await pg.evaluate(() => { const s = document.getElementById('phPromptOn'); return { role: s.getAttribute('role'), name: s.getAttribute('aria-label'), on: s.checked, dis: s.disabled }; });
  ok(sw.role === 'switch' && /Progress photo day/.test(sw.name) && !sw.on && !sw.dis, 'the Progress card has the "Progress photo day" switch (off)', sw);
  await pg.click('#phPromptOn');
  await pg.waitForFunction(() => (JSON.parse(window.__mock.st().prefs.comeback_photo_prompt || '{}')).on === true);
  await tab(pg, 'today');
  const card = await pg.evaluate(() => { const c = document.querySelector('.ph-prompt'); return c ? { t: c.textContent.replace(/\s+/g, ' '), role: c.getAttribute('role'), label: c.getAttribute('aria-label'), notif: window.__mock.st().calls.filter(x => /schedule/.test(x.n)).length } : null; });
  ok(card && /Progress photo day/.test(card.t) && /stays on this phone/.test(card.t) && card.role === 'region' && card.label === 'Progress photo day', 'on: a small card appears on Today', card);
  ok(card && card.notif === 0, 'it is a card only: no notification is scheduled', card);
  const nm = await pg.evaluate(() => [...document.querySelectorAll('#photoPromptSlot button')].map(b => (b.getAttribute('aria-label') || b.textContent).trim()));
  ok(nm.length === 2 && nm.every(Boolean), 'its buttons have names', nm);
  await pg.reload(); await ready(pg); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => !!document.querySelector('.ph-prompt')), 'it is still there after a restart (first open of the month)');
  await pg.click('#phPromptLater');
  ok(await pg.evaluate(() => !document.querySelector('.ph-prompt')), 'Not now dismisses it');
  const done = await pg.evaluate(() => JSON.parse(window.__mock.st().prefs.comeback_photo_prompt));
  ok(done.on === true && done.done === ymd(now).slice(0, 7), 'the dismissal is remembered for this month', done);
  await pg.reload(); await ready(pg); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => !document.querySelector('.ph-prompt')), 'it stays away after a restart');
  // prompt: Add photo opens today's sheet, and a photo this month ends it
  await pg.evaluate(() => window.__mock.set('prefs', Object.assign(window.__mock.st().prefs, { comeback_photo_prompt: JSON.stringify({ on: true, done: '' }) })));
  await pg.reload(); await ready(pg); await pg.waitForTimeout(500);
  await pg.click('#phPromptAdd'); await sheetIn(pg);
  ok(/Photos · /.test(await pg.textContent('.sheet h2')), 'Add photo opens today\'s photo sheet');
  await pg.setInputFiles('#phInPick', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await pg.evaluate(async () => await window.__mk(600, 800)), 'base64') });
  await pg.waitForFunction(() => document.querySelector('.ph-status').textContent === 'Photo added.', null, { timeout: 8000 });
  await closeSheets(pg);
  ok(await pg.evaluate(() => !document.querySelector('.ph-prompt')), 'a photo taken this month ends the prompt');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ---------- clean-up of files no day refers to ---------- */
console.log('Orphan clean-up');
{
  const { ctx, pg, errs } = await open();
  const K1 = daysAgo(1), K2 = daysAgo(2);
  await logPushups(pg);
  await addPhoto(pg, K1); await addPhoto(pg, K2);
  const put = (name, ageMs) => pg.evaluate(async ([n, a]) => { await ComebackNative.Filesystem.writeFile({ path: 'photos/' + n, data: 'AAAA', directory: 'DATA', recursive: true }); if (a) window.__mock.age('DATA/photos/' + n, a); }, [name, ageMs]);
  await put('2020-01-01.jpg', 2 * 3600e3);       // unused and old
  await put('2020-01-02.jpg', 0);                // unused but brand new: could be a photo being saved
  await put('2020-01-03-2.jpg', 5 * 864e5);      // unused and very old
  await put('junk.tmp', 3 * 3600e3);             // not even one of ours
  await pg.evaluate(() => window.__mock.age('DATA/photos/' + Object.keys(window.__mock.st().fs).find(k => /photos\/\d{4}-\d{2}-\d{2}\.jpg$/.test(k) && !/2020/.test(k)).split('/').pop(), 5 * 864e5));   // a referenced file that is old
  let r = await pg.evaluate(() => Photos.cleanup(true));
  let keys = (await photoKeys(pg)).map(k => k.split('/').pop());
  ok(r.deleted === 3, 'the clean-up removed the three old unused files', r);
  ok(keys.includes('2020-01-02.jpg') && !keys.includes('2020-01-01.jpg') && !keys.includes('2020-01-03-2.jpg') && !keys.includes('junk.tmp'), 'files younger than an hour are never removed; old unused ones are', keys);
  ok(keys.includes(K1 + '.jpg') && keys.includes(K2 + '.jpg'), 'files a day refers to stay, however old');
  r = await pg.evaluate(() => Photos.cleanup(false));
  ok(r.skipped === 'recent', 'without force it runs at most once a day', r);
  await pg.evaluate(() => window.__mock.set('prefs', Object.assign(window.__mock.st().prefs, { comeback_photo_clean: String(Date.now() - 2 * 864e5) })));
  await put('2020-02-02.jpg', 4 * 3600e3);
  r = await pg.evaluate(() => Photos.cleanup(false));
  ok(r.deleted === 1, 'a day later it runs again', r);
  // a photo waiting for its Undo is not an orphan
  await pg.evaluate(k => Photos.remove(k, k + '.jpg'), K1);
  await pg.evaluate(n => window.__mock.age('DATA/photos/' + n, 5 * 864e5), K1 + '.jpg');
  r = await pg.evaluate(() => Photos.cleanup(true));
  ok((await photoKeys(pg)).some(k => k.endsWith(K1 + '.jpg')), 'a file waiting for its Undo is kept', r);
  // safety valves: unreadable data, an empty history
  await put('2020-03-03.jpg', 9 * 3600e3);
  r = await pg.evaluate(() => { dataLocked = true; return Photos.cleanup(true); });
  ok(r.skipped === 'locked' && (await photoKeys(pg)).some(k => k.endsWith('2020-03-03.jpg')), 'nothing is removed while the saved data could not be read', r);
  await pg.evaluate(() => { dataLocked = false; loadNotice = 'one day was set aside'; });
  r = await pg.evaluate(() => Photos.cleanup(true));
  ok(r.skipped === 'unreadable', 'nothing is removed while days are set aside (their photos may still be wanted)', r);
  await pg.evaluate(() => { loadNotice = ''; });
  const saveDays = await pg.evaluate(() => { const d = days; days = {}; window.__saved = d; return Photos.cleanup(true); });
  ok(saveDays.skipped === 'nodays' && (await photoKeys(pg)).some(k => k.endsWith('2020-03-03.jpg')), 'an empty history never decides what to delete', saveDays);
  await pg.evaluate(() => { days = window.__saved; });
  r = await pg.evaluate(() => Photos.cleanup(true));
  ok(r.deleted >= 1 && !(await photoKeys(pg)).some(k => k.endsWith('2020-03-03.jpg')), 'with the data back, it works again', r);

  // at start-up
  await put('2020-04-04.jpg', 6 * 3600e3);
  await pg.evaluate(() => { const p = window.__mock.st().prefs; delete p.comeback_photo_clean; window.__mock.set('prefs', p); });
  await pg.waitForTimeout(800); // let any pending save settle
  await pg.reload(); await ready(pg);
  await pg.waitForFunction(() => !Object.keys(window.__mock.st().fs).some(k => /2020-04-04/.test(k)), null, { timeout: 8000 });
  ok(true, 'the clean-up runs when the app starts');
  ok(JSON.stringify((await namesOf(pg, K2))) === JSON.stringify([K2 + '.jpg']) && (await photoKeys(pg)).some(k => k.endsWith(K2 + '.jpg')), 'and keeps what days refer to');
  const stamp = await pg.evaluate(() => Number(window.__mock.st().prefs.comeback_photo_clean));
  ok(Date.now() - stamp < 60000, 'it records when it ran', stamp);

  // the camera app's leftover picture in the app's external folder is removed after a photo is added
  await pg.evaluate(async () => { await ComebackNative.Filesystem.writeFile({ path: 'Pictures/JPEG_20261003_101010_123.jpg', data: 'AAAA', directory: 'EXTERNAL' }); });
  await addPhoto(pg, daysAgo(5));
  await pg.waitForFunction(() => !Object.keys(window.__mock.st().fs).some(k => /EXTERNAL\/Pictures\/JPEG_/.test(k)), null, { timeout: 5000 });
  ok(true, 'the camera\'s temporary full-size picture is deleted once the scaled copy is saved');
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ---------- a plain browser: IndexedDB with the same behaviour ---------- */
console.log('Browser fallback');
{
  const { ctx, pg, errs, reqs } = await open({ web: true });
  const TK = todayKey();
  ok(await pg.evaluate(() => !IS_NATIVE && typeof Photos === 'object'), 'running without the native bridge');
  const r = await addPhoto(pg, TK, 1400, 700);
  ok(r.ok === true && r.name === TK + '.jpg', 'add works in a browser', r);
  const rec = await pg.evaluate(() => new Promise(res => { const q = indexedDB.open('comeback_photos', 1); q.onsuccess = () => { const g = q.result.transaction('f').objectStore('f').getAll(); g.onsuccess = async () => res(await Promise.all(g.result.map(async x => ({ name: x.name, mtime: typeof x.mtime, dims: await window.__dims(x.data) })))); }; }));
  ok(rec.length === 1 && rec[0].name === TK + '.jpg' && rec[0].mtime === 'number' && rec[0].dims.w === 1080 && rec[0].dims.h === 540, 'it is stored in IndexedDB, scaled to 1080 px', rec);
  ok(await pg.evaluate(() => !Object.keys(localStorage).some(k => /photo|\.jpg/i.test(k) && k !== 'CapacitorStorage.comeback' && !/comeback/.test(k))), 'nothing about the pictures is in localStorage');
  await tab(pg, 'today'); await openBody(pg); await pg.click('#rowPhotos'); await sheetIn(pg);
  await pg.waitForSelector('.ph-tile .ph-open.ok img', { timeout: 5000 });
  ok(true, 'the thumbnail loads from IndexedDB');
  const share = await pg.evaluate(() => 0);
  await pg.click('.ph-tile .ph-open'); await pg.waitForSelector('.ph-full img:not([hidden])');
  ok(await pg.evaluate(() => !document.getElementById('phShare')), 'no Share button without the native app');
  await closeSheets(pg);
  // an old unused record is cleaned, a new one is not
  await pg.evaluate(() => new Promise(res => { const q = indexedDB.open('comeback_photos', 1); q.onsuccess = () => { const t = q.result.transaction('f', 'readwrite'); const s = t.objectStore('f'); s.put({ name: '2020-01-01.jpg', data: 'AAAA', mtime: Date.now() - 3 * 3600e3 }); s.put({ name: '2020-01-02.jpg', data: 'AAAA', mtime: Date.now() }); t.oncomplete = res; }; }));
  await logPushups(pg);
  const cr = await pg.evaluate(() => Photos.cleanup(true));
  const left = await pg.evaluate(() => new Promise(res => { const q = indexedDB.open('comeback_photos', 1); q.onsuccess = () => { const g = q.result.transaction('f').objectStore('f').getAllKeys(); g.onsuccess = () => res(g.result.sort()); }; }));
  ok(cr.deleted === 1 && JSON.stringify(left) === JSON.stringify(['2020-01-02.jpg', TK + '.jpg']), 'the same clean-up rule applies to IndexedDB', [cr, left]);
  await pg.click('#rowPhotos').catch(() => {});
  ok(reqs.filter(u => !u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:')).length === 0, 'no network request outside the app', reqs.filter(u => !u.startsWith(base)));
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

/* ---------- look: dark, reduced motion ---------- */
console.log('Look');
{
  const { ctx, pg, errs } = await open({ dark: true, reduce: true });
  await openDaySheet(pg);
  await addPhoto(pg, todayKey());
  await pg.waitForSelector('.ph-open.ok img', { timeout: 5000 });
  const lk = await pg.evaluate(() => { const note = document.querySelector('.ph-note'); const img = document.querySelector('.ph-open img'); const sheetBg = getComputedStyle(document.querySelector('.sheet')).backgroundColor; return { color: getComputedStyle(note).color, bg: sheetBg, tr: getComputedStyle(img).transitionDuration }; });
  const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  ok(cr(lk.color, lk.bg) >= 4.5, 'the note text has AA contrast on the dark sheet', lk);
  ok(parseFloat(lk.tr) < 0.001, 'reduced motion: no fade on thumbnails', lk.tr);
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${T.pass} passed, ${T.fail} failed`);
process.exit(T.fail ? 1 : 0);
