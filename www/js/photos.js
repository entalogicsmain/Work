/* Progress photos: strictly private, device-only.
   A day may carry `photos: ["2026-10-03.jpg", "2026-10-03-2.jpg"]` (at most 3, names only). The pictures themselves live in the app's
   PRIVATE storage (Capacitor Filesystem, Directory.Data, folder "photos"), never in Documents, never in the cloud (the names are left out of
   the sync payload, see dayData in logic.js) and never in a JSON backup (the backup carries the names, not the files). In a plain
   browser the same API stores them in IndexedDB.
   Two parts:
   1. PhotoNames: pure helpers (names, limits, sizes, the clean-up rule, the monthly prompt rule). Tested in node.
   2. Photos: the screens (Today row, day sheet, viewer, Progress card, before/after, monthly prompt), capture, storage and clean-up.
   Other files reach it through one-line hooks: Photos.row() from sectionEl (today.js), Photos.todayHook(k) from renderToday,
   Photos.progressHook() from renderProgress (ui.js), Photos.init() from app.js. normalizeDay and mergeDayRecords (logic.js) use PhotoNames. */
const PhotoNames=(function(){
'use strict';
const RE=/^(\d{4}-\d{2}-\d{2})(?:-(\d))?\.jpg$/;
const MAX=3,MAX_SIDE=1080,QUALITY=0.82,THUMB_SIDE=240,MIN_AGE_MS=3600000,CLEAN_EVERY_MS=864e5;
const valid=n=>typeof n==='string'&&RE.test(n);
const dateOf=n=>{const m=typeof n==='string'?RE.exec(n):null;return m?m[1]:null};
/** The valid names of day k, once each, in order, at most MAX. A name for another day is dropped. Anything that is not an array gives []. */
function clean(list,k){
  if(!Array.isArray(list))return[];
  const out=[];
  for(const n of list){if(valid(n)&&dateOf(n)===k&&!out.includes(n)){out.push(n);if(out.length>=MAX)break}}
  return out;
}
const merge=(a,b,k)=>clean([].concat(Array.isArray(a)?a:[],Array.isArray(b)?b:[]),k);
const nameFor=(k,i)=>i<=1?k+'.jpg':k+'-'+i+'.jpg';
/** The first free name for day k ("2026-10-03.jpg", then "-2", "-3" ...), or null. `taken` lists names that must not be reused. */
function next(k,taken){for(let i=1;i<=9;i++){const n=nameFor(k,i);if(!(taken||[]).includes(n))return n}return null}
/** Size after scaling the long side down to `max` (never up). */
function fit(w,h,max){
  const s=Math.min(1,max/Math.max(1,w,h));
  return{w:Math.max(1,Math.round(w*s)),h:Math.max(1,Math.round(h*s))};
}
/** Files that no day refers to, are old enough (default one hour) and are not waiting for an Undo. A file without a known age is never removed. */
function orphans(files,referenced,now,keep,minAge){
  const age=minAge==null?MIN_AGE_MS:minAge;
  return(files||[]).filter(f=>f&&typeof f.name==='string'&&f.name.indexOf('/')<0&&!referenced.has(f.name)&&!(keep&&keep.has(f.name))&&typeof f.mtime==='number'&&f.mtime>0&&now-f.mtime>=age).map(f=>f.name);
}
/** Is the monthly "Progress photo day" card due? state = {on, done:"YYYY-MM"}. */
function promptDue(state,today,monthHasPhoto){
  return!!state&&state.on===true&&state.done!==String(today).slice(0,7)&&!monthHasPhoto;
}
return{RE,MAX,MAX_SIDE,QUALITY,THUMB_SIDE,MIN_AGE_MS,CLEAN_EVERY_MS,valid,dateOf,clean,merge,nameFor,next,fit,orphans,promptDue};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=PhotoNames;

if(typeof window!=='undefined'&&typeof document!=='undefined'&&typeof days!=='undefined')window.Photos=(function(){
'use strict';
const PROMPT_KEY='comeback_photo_prompt';      // Preferences: {on:boolean, done:"YYYY-MM"} (this phone only)
const CLEAN_KEY='comeback_photo_clean';        // Preferences: when the last clean-up ran
const DIRNAME='photos';
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PRIVACY='Photos stay on this phone. They are not synced to the cloud and not in backups.';
const dlabel=k=>{const p=String(k).split('-').map(Number);return p[2]+' '+MONTHS[p[1]-1]+' '+p[0]};
const names=k=>(days[k]&&PhotoNames.clean(days[k].photos,k))||[];
const allPairs=()=>{const out=[];Object.keys(days).sort().forEach(k=>names(k).forEach((n,i,a)=>out.push({k,name:n,i,of:a.length})));return out};
const pending=new Map();                        // deleted a moment ago, file kept until the Undo toast is gone: name -> {k,timer}
let busy=false,promptState=null,lastUndo=null;
const views=new Set();                          // open screens that redraw when photos change
const changed=()=>views.forEach(f=>{try{f()}catch(e){}});
const gone=p=>{try{if(p&&p.catch)p.catch(()=>{})}catch(e){}};

/* ---------- bytes <-> base64 / blobs ---------- */
function blobToB64(blob){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{const s=String(r.result||'');const i=s.indexOf(',');res(i>=0?s.slice(i+1):'')};r.onerror=()=>rej(r.error||new Error('read failed'));r.readAsDataURL(blob)});
}
function b64ToBlob(b64,type){
  const bin=atob(b64),u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  return new Blob([u],{type:type||'image/jpeg'});
}

/* ---------- storage: private app files on the phone, IndexedDB in a browser ---------- */
function fsBackend(){
  const F=Native.Filesystem,D=Native.Directory.Data;
  return{
    kind:'files',
    put:(n,b64)=>F.writeFile({path:DIRNAME+'/'+n,data:b64,directory:D,recursive:true}),
    async get(n){const r=await F.readFile({path:DIRNAME+'/'+n,directory:D});return typeof r.data==='string'?r.data:await blobToB64(r.data)},
    del:n=>F.deleteFile({path:DIRNAME+'/'+n,directory:D}),
    async list(){try{const r=await F.readdir({path:DIRNAME,directory:D});return(r.files||[]).filter(f=>f.type!=='directory').map(f=>({name:f.name,mtime:f.mtime}))}catch(e){return[]}}
  };
}
let dbp=null;
function openDb(){
  if(!dbp)dbp=new Promise((res,rej)=>{const r=indexedDB.open('comeback_photos',1);r.onupgradeneeded=()=>{r.result.createObjectStore('f',{keyPath:'name'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('no storage'))});
  return dbp;
}
function idbDo(mode,fn){
  return openDb().then(db=>new Promise((res,rej)=>{const t=db.transaction('f',mode);let out;const rq=fn(t.objectStore('f'));if(rq)rq.onsuccess=()=>{out=rq.result};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error('aborted'))}));
}
const idbBackend={
  kind:'browser',
  put:(n,b64)=>idbDo('readwrite',s=>s.put({name:n,data:b64,mtime:Date.now()})),
  async get(n){const r=await idbDo('readonly',s=>s.get(n));if(!r)throw new Error('File does not exist');return r.data},
  del:n=>idbDo('readwrite',s=>s.delete(n)),
  async list(){try{const all=await idbDo('readonly',s=>s.getAll());return(all||[]).map(r=>({name:r.name,mtime:r.mtime}))}catch(e){return[]}}
};
const useFiles=()=>!!(IS_NATIVE&&Native.Filesystem&&Native.Directory&&Native.Directory.Data);
const backend=()=>useFiles()?fsBackend():idbBackend;

/* ---------- picture handling ---------- */
/** Any chosen image -> base64 JPEG, long side at most 1080 px, quality 0.82, with the camera's rotation applied. */
async function processImage(file){
  let src=null,w=0,hh=0,url=null,bmp=null;
  try{
    if(window.createImageBitmap){try{bmp=await createImageBitmap(file,{imageOrientation:'from-image'})}catch(e){bmp=null}}
    if(bmp){src=bmp;w=bmp.width;hh=bmp.height}
    else{
      url=URL.createObjectURL(file);
      const img=new Image();img.decoding='async';img.src=url;
      await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error('not an image'))});
      src=img;w=img.naturalWidth;hh=img.naturalHeight;
    }
    if(!(w>0&&hh>0))throw new Error('empty image');
    const f=PhotoNames.fit(w,hh,PhotoNames.MAX_SIDE);
    const c=document.createElement('canvas');c.width=f.w;c.height=f.h;
    const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,f.w,f.h);x.drawImage(src,0,0,f.w,f.h);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',PhotoNames.QUALITY));
    if(!blob)throw new Error('could not encode');
    return await blobToB64(blob);
  }finally{try{if(bmp)bmp.close()}catch(e){}if(url)URL.revokeObjectURL(url)}
}
async function makeThumb(blob){
  if(!window.createImageBitmap)return blob;
  let bmp=null;
  try{
    bmp=await createImageBitmap(blob);
    const f=PhotoNames.fit(bmp.width,bmp.height,PhotoNames.THUMB_SIDE);
    const c=document.createElement('canvas');c.width=f.w;c.height=f.h;
    c.getContext('2d').drawImage(bmp,0,0,f.w,f.h);
    return await new Promise(r=>c.toBlob(t=>r(t||blob),'image/jpeg',0.7));
  }catch(e){return blob}finally{try{if(bmp)bmp.close()}catch(e){}}
}
/** Blob URLs made for one screen; closing the screen revokes them all. */
function scope(){
  const urls=new Set(),closers=[];let dead=false;
  const make=async(name,thumb)=>{
    if(dead)return null;
    try{
      let b=b64ToBlob(await backend().get(name));
      if(thumb)b=await makeThumb(b);
      if(dead)return null;
      const u=URL.createObjectURL(b);urls.add(u);return u;
    }catch(e){return null}
  };
  return{thumb:n=>make(n,true),full:n=>make(n,false),
    drop(u){if(u&&urls.delete(u))URL.revokeObjectURL(u)},
    onClose(f){closers.push(f)},
    close(){dead=true;closers.forEach(f=>{try{f()}catch(e){}});urls.forEach(u=>URL.revokeObjectURL(u));urls.clear()}};
}
/** Loads when the element scrolls near the screen. */
function whenVisible(el,sc,fn){
  if(!('IntersectionObserver' in window)){fn();return}
  const io=new IntersectionObserver((es)=>{if(es.some(e=>e.isIntersecting)){io.disconnect();fn()}},{rootMargin:'200px'});
  io.observe(el);sc.onClose(()=>io.disconnect());
}
function fillThumb(btn,img,sc,name,label){
  whenVisible(btn,sc,async()=>{
    const u=await sc.thumb(name);
    if(u){img.src=u;btn.classList.add('ok')}
    else{btn.classList.add('miss');const s=document.createElement('span');s.className='ph-missing';s.textContent='Not on this phone';btn.appendChild(s);btn.setAttribute('aria-label',label+'. This photo is not on this phone.')}
  });
}

/* ---------- add and delete ---------- */
const GENTLE_ERR="That photo couldn't be saved. Please try again, or pick a different one.";
async function tempCleanup(minAge){
  // the camera app's picture is taken into the app's own folder in Android; it is no longer needed once the copy is made
  if(!useFiles()||!Native.Directory.External)return;
  const F=Native.Filesystem,now=Date.now();
  try{
    const r=await F.readdir({path:'Pictures',directory:Native.Directory.External});
    for(const f of r.files||[])if(/^JPEG_\d{8}_\d{6}_.*\.jpg$/.test(f.name)&&(minAge===0||(typeof f.mtime==='number'&&f.mtime>0&&now-f.mtime>=minAge)))try{await F.deleteFile({path:'Pictures/'+f.name,directory:Native.Directory.External})}catch(e){}
  }catch(e){}
  try{
    const r=await F.readdir({path:'',directory:Native.Directory.Cache});
    for(const f of r.files||[])if(/^photo-share-/.test(f.name)&&(minAge===0||(typeof f.mtime==='number'&&f.mtime>0&&now-f.mtime>=minAge)))try{await F.deleteFile({path:f.name,directory:Native.Directory.Cache})}catch(e){}
  }catch(e){}
}
/** Scales, saves and attaches a chosen picture to day k. Resolves {ok,name} or {ok:false,message}. */
async function add(k,file){
  if(busy)return{ok:false,message:'One moment, still saving the last photo.'};
  if(names(k).length>=PhotoNames.MAX)return{ok:false,message:'A day can hold 3 photos. Delete one to add another.'};
  busy=true;changed();
  let name=null,written=false;
  try{
    const b64=await processImage(file);
    const taken=names(k).concat([...pending.entries()].filter(e=>e[1].k===k).map(e=>e[0]));
    name=PhotoNames.next(k,taken);
    if(!name)throw new Error('no free name');
    await backend().put(name,b64);written=true;
    if(names(k).length>=PhotoNames.MAX){try{await backend().del(name)}catch(e){}return{ok:false,message:'A day can hold 3 photos. Delete one to add another.'}}
    commitDay('Photo added',d=>{d.photos=PhotoNames.clean((d.photos||[]).concat([name]),k)},true,k);
    gone(tempCleanup(0));
    return{ok:true,name};
  }catch(e){
    if(written&&name)try{await backend().del(name)}catch(e2){}
    return{ok:false,message:GENTLE_ERR};
  }finally{busy=false;changed()}
}
function dropFile(name){const p=pending.get(name);if(!p)return;clearTimeout(p.timer);pending.delete(name);gone(backend().del(name))}
/** Takes the photo off the day at once; the file stays until the Undo toast is gone. */
function remove(k,name){
  if(!names(k).includes(name))return false;
  const idx=names(k).indexOf(name);
  commitDay('Photo deleted',d=>{d.photos=(d.photos||[]).filter(x=>x!==name);if(!d.photos.length)delete d.photos},true,k);
  const timer=setTimeout(()=>dropFile(name),9500);   // a little longer than the shortest Undo toast (8 s)
  pending.set(name,{k,timer});
  haptic('light');
  const undo=()=>{
    const p=pending.get(name);if(!p)return;
    if(names(k).length>=PhotoNames.MAX){toast('That day already has 3 photos.',{icon:'x'});return}
    clearTimeout(p.timer);pending.delete(name);
    if(lastUndo&&lastUndo.name===name){clearTimeout(lastUndo.t);lastUndo=null}
    commitDay('Photo restored',d=>{const l=(d.photos||[]).slice();l.splice(Math.min(idx,l.length),0,name);d.photos=PhotoNames.clean(l,k)},true,k);
    toast('Photo restored',{icon:'check'});
    changed();
  };
  // a toast sits under an open sheet, so the day sheet also shows its own Undo for a moment
  if(lastUndo)clearTimeout(lastUndo.t);
  lastUndo={k,name,fn:undo,t:setTimeout(()=>{lastUndo=null;changed()},9000)};
  toast('Photo deleted',{icon:'trash-2',undo});
  changed();
  return true;
}

/* ---------- clean-up of files no day refers to ---------- */
async function cleanup(force){
  try{
    if(typeof dataLocked!=='undefined'&&dataLocked)return{skipped:'locked'};
    if((typeof loadProblem!=='undefined'&&loadProblem)||(typeof loadNotice!=='undefined'&&loadNotice))return{skipped:'unreadable'};   // days set aside: their photos are still wanted
    if(!Object.keys(days).length)return{skipped:'nodays'};     // never judge the files by an empty history
    if(!force){const last=Number(await prefGet(CLEAN_KEY));if(last&&Date.now()-last<PhotoNames.CLEAN_EVERY_MS)return{skipped:'recent'}}
    const be=backend(),files=await be.list();
    const ref=new Set();Object.keys(days).forEach(k=>names(k).forEach(n=>ref.add(n)));
    const doomed=PhotoNames.orphans(files,ref,Date.now(),new Set(pending.keys()));
    let n=0;
    for(const name of doomed){try{await be.del(name);n++}catch(e){}}
    await tempCleanup(PhotoNames.MIN_AGE_MS);
    await prefSet(CLEAN_KEY,String(Date.now()));
    return{deleted:n};
  }catch(e){return{error:errText(e)}}
}

/* ---------- the monthly prompt ---------- */
async function loadPrompt(){
  promptState={on:false,done:''};
  try{
    const v=await prefGet(PROMPT_KEY);
    if(v){const o=JSON.parse(v);promptState={on:o&&o.on===true,done:typeof(o&&o.done)==='string'&&/^\d{4}-\d{2}$/.test(o.done)?o.done:''}}
  }catch(e){}
}
const savePrompt=()=>{gone(prefSet(PROMPT_KEY,JSON.stringify(promptState)))};
const monthHasPhoto=today=>Object.keys(days).some(k=>k.slice(0,7)===today.slice(0,7)&&names(k).length>0);
function todayHook(k){
  const slot=$('photoPromptSlot');if(!slot)return;
  const t=todayStr();
  const due=k===t&&!(typeof editing!=='undefined'&&editing)&&PhotoNames.promptDue(promptState,t,monthHasPhoto(t));
  if(!due){slot.innerHTML='';return}
  if(slot.firstChild)return;
  const c=h('<div class="card ph-prompt" role="region" aria-label="Progress photo day"><span class="row-ic"><svg data-ic="camera"></svg></span><div class="ph-prompt-body"><b class="t-head">Progress photo day</b><p class="muted">A photo once a month shows what the numbers can\'t. It stays on this phone.</p><div class="ph-actions"><button class="btn small" id="phPromptAdd">Add photo</button><button class="btn small secondary" id="phPromptLater">Not now</button></div></div></div>');
  c.querySelector('#phPromptAdd').addEventListener('click',()=>{haptic('light');openDay(todayStr())});
  c.querySelector('#phPromptLater').addEventListener('click',()=>{promptState.done=todayStr().slice(0,7);savePrompt();slot.innerHTML='';haptic('light')});
  slot.appendChild(c);
}

/* ---------- Today: the Photos row ---------- */
function row(){
  const k=current,n=names(k).length;
  const r=h('<div class="mrow fixed"><button class="row" id="rowPhotos"><span class="row-ic"></span><span class="row-body"><span class="row-label">Photos</span><span class="row-sub"></span></span><svg data-ic="chevron-right" class="chev"></svg></button></div>');
  r.querySelector('.row-ic').innerHTML=icon('camera','sm');
  r.querySelector('.row-sub').textContent=n?n+(n===1?' photo':' photos')+' · only on this phone':'Add a progress photo. Private to this phone.';
  r.querySelector('.row').setAttribute('aria-label','Photos. '+(n?n+(n===1?' photo':' photos')+' on this day':'None on this day')+'. Open to view or add.');
  r.querySelector('.row').addEventListener('click',()=>{if(!(typeof editing!=='undefined'&&editing))openDay(current)});
  return r;
}

/* ---------- the day sheet ---------- */
function openDay(k){
  const sc=scope();
  const root=h('<div class="ph-sheet"></div>');
  root.appendChild(h('<p class="ph-note"></p>')).textContent=PRIVACY;
  const grid=h('<div class="ph-grid" role="list" aria-label="Photos for this day"></div>');
  const status=h('<p class="ph-status" role="status" aria-live="polite"></p>');
  const undoBar=h('<div class="ph-undo" role="status" aria-live="polite" hidden><span>Photo deleted.</span><button class="txtbtn strong" aria-label="Undo delete">Undo</button></div>');
  const fullNote=h('<p class="ph-note" hidden>3 photos is the most for one day. Delete one to add another.</p>');
  undoBar.querySelector('button').addEventListener('click',()=>{if(lastUndo&&lastUndo.k===k)lastUndo.fn()});
  const acts=h('<div class="ph-actions"><button class="btn" id="phTake"><svg data-ic="camera" class="sm"></svg><span>Take a photo</span></button><button class="btn secondary" id="phPick"><svg data-ic="images" class="sm"></svg><span>Choose from gallery</span></button></div>');
  const inCam=h('<input type="file" accept="image/*" capture="environment" hidden id="phInCam" aria-label="Take a photo">');
  const inPick=h('<input type="file" accept="image/*" hidden id="phInPick" aria-label="Choose a photo from the gallery">');
  const take=acts.querySelector('#phTake'),pick=acts.querySelector('#phPick');
  take.addEventListener('click',()=>inCam.click());pick.addEventListener('click',()=>inPick.click());
  const onFile=async e=>{
    const input=e.target,f=input.files&&input.files[0];input.value='';
    if(!f)return;
    status.textContent='Saving photo…';
    const r=await add(k,f);
    status.textContent=r.ok?'Photo added.':r.message;
    status.classList.toggle('bad',!r.ok);
    if(r.ok)haptic('light');
  };
  inCam.addEventListener('change',onFile);inPick.addEventListener('change',onFile);
  root.append(grid,undoBar,status,fullNote,acts,inCam,inPick);
  function render(){
    const list=names(k),full=list.length>=PhotoNames.MAX;
    take.disabled=pick.disabled=full||busy;
    grid.innerHTML='';
    if(!list.length){grid.appendChild(h('<p class="ph-empty muted" role="listitem">No photos for this day yet.</p>'))}
    list.forEach((n,i)=>{
      const label='Photo '+(i+1)+' of '+list.length+', '+dlabel(k);
      const t=h('<div class="ph-tile" role="listitem"><button class="ph-open"><img alt="" draggable="false"></button><button class="ph-del"><svg data-ic="trash-2" class="sm"></svg></button></div>');
      const ob=t.querySelector('.ph-open'),db=t.querySelector('.ph-del');
      ob.setAttribute('aria-label',label+'. Open full size');
      db.setAttribute('aria-label','Delete photo '+(i+1)+' of '+list.length);
      ob.addEventListener('click',()=>openViewer(n));
      db.addEventListener('click',()=>{remove(k,n);const nb=grid.querySelector('.ph-open');(nb||take).focus({preventScroll:true})});
      fillThumb(ob,t.querySelector('img'),sc,n,label);
      grid.appendChild(t);
    });
    fullNote.hidden=!full;
    undoBar.hidden=!(lastUndo&&lastUndo.k===k);
  }
  const view=()=>{render()};
  views.add(view);render();
  const close=()=>{views.delete(view);sc.close()};
  return openSheet({title:'Photos · '+dlabel(k),left:null,right:'Done',content:root,onDone:close,onCancel:close});
}

/* ---------- full-size viewer ---------- */
function openViewer(name){
  const k=PhotoNames.dateOf(name);if(!k)return null;
  const sc=scope();
  const root=h('<div class="ph-viewer"></div>');
  const label='Photo from '+dlabel(k);
  const box=h('<div class="ph-full"><img alt="" hidden><p class="muted ph-loading">Loading…</p></div>');
  const img=box.querySelector('img'),ld=box.querySelector('.ph-loading');
  root.appendChild(box);
  const acts=h('<div class="ph-actions"></div>');
  if(IS_NATIVE&&Native.Share&&useFiles()){
    const sb=h('<button class="btn secondary" id="phShare"><svg data-ic="share-2" class="sm"></svg><span>Share</span></button>');
    sb.addEventListener('click',async()=>{
      sb.disabled=true;
      try{await shareFile(name)}catch(e){if(!/cancel/i.test(errText(e)))toast("Couldn't open the share sheet.",{icon:'x'})}
      sb.disabled=false;
    });
    acts.appendChild(sb);
  }
  const del=h('<button class="btn secondary danger" id="phDelete"><svg data-ic="trash-2" class="sm"></svg><span>Delete photo</span></button>');
  del.addEventListener('click',()=>{sheet.close('cancel');remove(k,name)});
  acts.appendChild(del);
  root.appendChild(acts);
  const sheet=openSheet({title:label,left:null,right:'Done',content:root,onDone:()=>sc.close(),onCancel:()=>sc.close()});
  sc.full(name).then(u=>{
    if(u){img.src=u;img.alt=label;img.hidden=false;ld.remove()}
    else ld.textContent='This photo is not on this phone. It may have come from a backup made on another phone.';
  });
  return sheet;
}
async function shareFile(name){
  // the Share sheet can only read the app's cache, so a copy goes there for a moment and is removed again
  const b64=await backend().get(name),path='photo-share-'+name;
  const r=await Native.Filesystem.writeFile({path,data:b64,directory:Native.Directory.Cache});
  try{await Native.Share.share({title:'Progress photo',files:[r.uri],dialogTitle:'Share photo'})}
  finally{setTimeout(()=>gone(Native.Filesystem.deleteFile({path,directory:Native.Directory.Cache})),120000)}
}

/* ---------- before and after ---------- */
function openCompare(){
  const pairs=allPairs();
  if(pairs.length<2){toast('Add a second photo to compare.',{icon:'camera'});return null}
  const sc=scope();
  const optText=p=>dlabel(p.k)+(p.of>1?' (photo '+(p.i+1)+')':'');
  const root=h('<div class="ph-cmp"></div>');
  const opts=pairs.map(p=>'<option value="'+p.name+'"></option>').join('');
  const picks=h('<div class="ph-picks"><label class="ph-pick"><span>Before</span><select id="phBefore" aria-label="Before photo date">'+opts+'</select></label><label class="ph-pick"><span>After</span><select id="phAfter" aria-label="After photo date">'+opts+'</select></label></div>');
  picks.querySelectorAll('select').forEach(s=>[...s.options].forEach((o,i)=>{o.textContent=optText(pairs[i])}));
  const sb=picks.querySelector('#phBefore'),sa=picks.querySelector('#phAfter');
  sb.value=pairs[0].name;sa.value=pairs[pairs.length-1].name;
  const stage=h('<div class="ph-stage"><img class="ph-img b" draggable="false" alt=""><img class="ph-img a" draggable="false" alt=""><div class="ph-handle" role="slider" tabindex="0" aria-label="Reveal slider. Left and right arrow keys move the divider." aria-valuemin="0" aria-valuemax="100"><i aria-hidden="true"></i></div></div>');
  const ib=stage.querySelector('.b'),ia=stage.querySelector('.a'),hd=stage.querySelector('.ph-handle');
  const cap=h('<p class="ph-cap" role="status" aria-live="polite"></p>');
  root.append(picks,stage,cap);
  root.appendChild(h('<p class="ph-note"></p>')).textContent='Drag the divider, or use the arrow keys. '+PRIVACY;
  let pos=50;
  const setPos=v=>{
    pos=Math.max(0,Math.min(100,Math.round(v)));
    ia.style.clipPath='inset(0 0 0 '+pos+'%)';hd.style.left=pos+'%';
    hd.setAttribute('aria-valuenow',String(pos));
    hd.setAttribute('aria-valuetext',pos===0?'Showing only the After photo':pos===100?'Showing only the Before photo':'Divider at '+pos+' percent. Before photo on the left, After photo on the right.');
  };
  const keys={ArrowLeft:-5,ArrowDown:-5,ArrowRight:5,ArrowUp:5,PageDown:-20,PageUp:20};
  hd.addEventListener('keydown',e=>{
    if(e.key==='Home'){e.preventDefault();setPos(0)}
    else if(e.key==='End'){e.preventDefault();setPos(100)}
    else if(keys[e.key]){e.preventDefault();setPos(pos+(e.shiftKey?Math.sign(keys[e.key]):keys[e.key]))}
  });
  let drag=false;
  const fromX=x=>{const r=stage.getBoundingClientRect();if(r.width>0)setPos((x-r.left)/r.width*100)};
  stage.addEventListener('pointerdown',e=>{drag=true;try{stage.setPointerCapture(e.pointerId)}catch(x){}fromX(e.clientX);hd.focus({preventScroll:true})});
  stage.addEventListener('pointermove',e=>{if(drag)fromX(e.clientX)});
  const end=()=>{drag=false};
  stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);
  let lastB=null,lastA=null;
  async function show(which){
    const sel=which==='b'?sb:sa,img=which==='b'?ib:ia,name=sel.value,k=PhotoNames.dateOf(name);
    const label=(which==='b'?'Before: ':'After: ')+'photo from '+dlabel(k);
    img.alt=label;
    const u=await sc.full(name);
    if(sel.value!==name){sc.drop(u);return}
    if(which==='b'){sc.drop(lastB);lastB=u}else{sc.drop(lastA);lastA=u}
    if(u)img.src=u;else{img.removeAttribute('src');img.alt=label+' (not on this phone)'}
    cap.textContent='Before '+dlabel(PhotoNames.dateOf(sb.value))+' · After '+dlabel(PhotoNames.dateOf(sa.value));
  }
  sb.addEventListener('change',()=>show('b'));sa.addEventListener('change',()=>show('a'));
  setPos(50);show('b');show('a');
  const sheet=openSheet({title:'Before and after',left:null,right:'Done',content:root,onDone:()=>sc.close(),onCancel:()=>sc.close()});
  setTimeout(()=>{try{hd.focus({preventScroll:true})}catch(e){}},80);
  return sheet;
}

/* ---------- Progress: the Progress photos card ---------- */
let cardScope=null;
function progressHook(){
  const box=$('photoCard');if(!box)return;
  const pairs=allPairs();
  const sig=pairs.map(p=>p.name).join(',')+'|'+(promptState?(promptState.on?1:0):'x')+'|'+(IS_NATIVE?1:0);
  if(box.dataset.sig===sig&&box.firstChild)return;
  box.dataset.sig=sig;
  if(cardScope)cardScope.close();
  const sc=cardScope=scope();
  box.innerHTML='';
  box.appendChild(h('<h2 class="sec-head" id="photoHead">Progress photos</h2>'));
  const card=h('<div class="card ph-card" role="region" aria-labelledby="photoHead"></div>');
  box.appendChild(card);
  const note=h('<p class="ph-note"></p>');note.textContent=PRIVACY+' Restoring a backup on another phone shows the day without its photos.';
  if(!pairs.length){
    card.appendChild(h('<div class="ph-none"><span class="row-ic"><svg data-ic="camera"></svg></span><p class="muted">No progress photos yet. A photo now and then shows change that numbers can\'t.</p></div>'));
  }else{
    const strip=h('<div class="ph-strip" role="list" aria-label="Progress photos, newest first" tabindex="0"></div>');
    pairs.slice().reverse().forEach(p=>{
      const label='Photo from '+dlabel(p.k);
      const it=h('<div class="ph-item" role="listitem"><button class="ph-open"><img alt="" draggable="false"></button><span class="ph-date"></span></div>');
      it.querySelector('.ph-date').textContent=dlabel(p.k);
      const b=it.querySelector('.ph-open');b.setAttribute('aria-label',label+'. Open full size');
      b.addEventListener('click',()=>openViewer(p.name));
      fillThumb(b,it.querySelector('img'),sc,p.name,label);
      strip.appendChild(it);
    });
    card.appendChild(strip);
  }
  const acts=h('<div class="ph-actions"><button class="btn small" id="phCardAdd"><svg data-ic="camera" class="sm"></svg><span>Add photo</span></button><button class="btn small secondary" id="phCardCmp"><svg data-ic="columns-2" class="sm"></svg><span>Before and after</span></button></div>');
  acts.querySelector('#phCardAdd').addEventListener('click',()=>openDay(todayStr()));
  const cmp=acts.querySelector('#phCardCmp');
  if(pairs.length<2)cmp.remove();else cmp.addEventListener('click',()=>openCompare());
  card.appendChild(acts);
  card.appendChild(note);
  const g=h('<div class="group ph-pg"><label class="row"><span class="row-body"><span class="row-label">Progress photo day</span><span class="row-sub">A small card on Today once a month. No notification.</span></span><input type="checkbox" class="switch" role="switch" id="phPromptOn" aria-label="Progress photo day: a small card on Today once a month"></label></div>');
  const sw=g.querySelector('#phPromptOn');sw.checked=!!(promptState&&promptState.on);sw.disabled=!promptState;
  sw.addEventListener('change',()=>{
    if(!promptState)return;
    promptState.on=sw.checked;if(sw.checked)promptState.done='';
    savePrompt();haptic('light');
    const slot=$('photoPromptSlot');if(slot)slot.innerHTML='';
    todayHook(current);
    announce(sw.checked?'Monthly photo card on.':'Monthly photo card off.');
  });
  card.appendChild(g);
}

/* ---------- start-up ---------- */
async function init(){
  await loadPrompt();
  todayHook(current);
  const box=$('photoCard');if(box)delete box.dataset.sig;
  progressHook();
  await cleanup(false);
}

return{row,todayHook,progressHook,init,cleanup,add,remove,names,openDay,openViewer,openCompare,PhotoNames,
  _state:()=>({pending:[...pending.keys()],busy,prompt:promptState})};
})();
