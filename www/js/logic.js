/* Data, storage, backup, reminder and cloud-sync logic. No layout code lives here: the UI hooks it calls
   (setMsg, askModal, refreshAll, renderAccount, ...) are defined in ui.js. */
/* The plan (habits with a type, section and schedule; sections; body settings; units) lives in core.js. The default is what
   every earlier version shipped with, moved into the new structure. */
const DEFAULT_SETTINGS=Core.defaultSettings();
let settings=JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
let days={};
let store=null;
let current=null;
let dirty=false; // kept for the sync code; the redesigned UI saves every change, so nothing stays unsaved

const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse=s=>{const[a,b,c]=s.split('-').map(Number);return new Date(a,b-1,c)};
const todayStr=()=>ymd(new Date());
const nice=s=>parse(s).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
const r1=n=>Math.round(n*10)/10;
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30)+'-'+Date.now().toString(36);

/* Score for one day (0-100). Only habits that were due that day count; a day with nothing due scores 0 here (see Core.dayScore for null). */
function scoreOf(d){
  if(!d)return null;
  const k=d.date||current;
  const all=days[k]===d?days:Object.assign({},days,{[k]:d});
  const sc=Core.dayScore(settings,all,k);
  return sc==null?0:sc;
}
/* ---------- platform ---------- */
const Native=window.ComebackNative||{isNative:false};
const IS_NATIVE=!!Native.isNative;
const localShim={
  async get({key}){try{return{value:localStorage.getItem('CapacitorStorage.'+key)}}catch(e){return{value:null}}},
  async set({key,value}){localStorage.setItem('CapacitorStorage.'+key,value)},
  async remove({key}){localStorage.removeItem('CapacitorStorage.'+key)},
  async keys(){const out=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.indexOf('CapacitorStorage.')===0)out.push(k.slice(17))}}catch(e){}return{keys:out}}
};
const Prefs=Native.Preferences||localShim;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const errText=e=>String((e&&(e.message||e.errorMessage))||e||'Unknown error');
const clone=o=>JSON.parse(JSON.stringify(o));

/* ---------- data shape ----------
   { version:2, settings:{v:2,habits:[{id,name,icon,type,unit,target,section,schedule}],sections,body,units,prefs},
     days:{ "YYYY-MM-DD":{vals,rules,weight,waist,note,date,updatedAt,light?} } }
   A day may carry light:true ("Take it easy today"): it is left out of scoring like a rest day (Core.isLight). settings.body may carry goalKg and goalDate.
   Count, duration and steps habits keep their number in a day's "vals"; Yes/No habits keep a tick in "rules" (so every day
   record from an earlier version stays valid); weight and waist are the day's "weight" and "waist". Version 1 data (backups,
   the phone's saved copy, the cloud) is migrated into this structure whenever it is read. */
const DATA_KEY='comeback', META_KEY='comeback_meta', MIGRATED_KEY='comeback_migrated';
const buildData=()=>({version:2,settings,days});
const ID_RE=/^[A-Za-z0-9_-]{1,64}$/, DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const num=v=>typeof v==='number'&&isFinite(v);

function validDateKey(k){if(!DATE_RE.test(k))return false;const d=parse(k);return ymd(d)===k}

/* Settings in either structure -> the current one (the cloud copy may still be the old one). */
function normalizeSettings(s){return Core.migrateSettings(s).settings}
/* Optional per-day step-tracking details: { source:'auto'|'manual', counted, distance_km, filtered, hourly:[24] } */
function normalizeStepsMeta(m,k){
  if(m==null)return undefined;
  if(typeof m!=='object'||Array.isArray(m))throw new Error('Day '+k+' has invalid step details.');
  if(m.source!=='auto'&&m.source!=='manual')throw new Error('Day '+k+' has an unknown step source.');
  const nn=(v,what)=>{if(v==null)return 0;if(!num(v)||v<0)throw new Error('Day '+k+' has an invalid '+what+'.');return v};
  let hourly=new Array(24).fill(0);
  if(m.hourly!=null){
    if(!Array.isArray(m.hourly)||m.hourly.length!==24||m.hourly.some(v=>!num(v)||v<0))throw new Error('Day '+k+' has invalid hourly steps.');
    hourly=m.hourly.slice();
  }
  return{source:m.source,counted:Math.round(nn(m.counted,'counted steps')),distance_km:nn(m.distance_km,'distance'),filtered:Math.round(nn(m.filtered,'filtered steps')),hourly};
}
function normalizeDay(k,d){
  if(!validDateKey(k))throw new Error('"'+String(k).slice(0,30)+'" is not a valid date (expected YYYY-MM-DD).');
  if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('Day '+k+' is not valid.');
  const vals={},rl={};
  if(d.vals!=null){if(typeof d.vals!=='object'||Array.isArray(d.vals))throw new Error('Day '+k+' has invalid values.');Object.keys(d.vals).forEach(id=>{if(!num(d.vals[id]))throw new Error('Day '+k+' has a non-numeric value for "'+id.slice(0,30)+'".');vals[id]=d.vals[id]})}
  if(d.rules!=null){if(typeof d.rules!=='object'||Array.isArray(d.rules))throw new Error('Day '+k+' has invalid rules.');Object.keys(d.rules).forEach(id=>{rl[id]=!!d.rules[id]})}
  if(d.weight!=null&&!num(d.weight))throw new Error('Day '+k+' has an invalid weight.');
  if(d.waist!=null&&!num(d.waist))throw new Error('Day '+k+' has an invalid waist.');
  const out={vals,rules:rl,weight:d.weight==null?null:d.weight,waist:d.waist==null?null:d.waist,note:typeof d.note==='string'?d.note:'',date:k,updatedAt:num(d.updatedAt)?d.updatedAt:0};
  const sm=normalizeStepsMeta(d.steps_meta,k);
  if(sm)out.steps_meta=sm;
  const tv=normalizeTravel(d.travel);if(tv)out.travel=tv;
  if(d.light===true)out.light=true;
  return out;
}
/* Throws an Error with a readable message when the object is not a Comeback backup. Restoring from a file is strict: one bad day
   refuses the whole file. Loading the phone's own saved copy is lenient (lenient=true): a bad day is set aside on its own
   (returned in "skipped", keyed by date, with its raw record) and every other day still loads. */
function normalizeData(obj,lenient){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error("This isn't a Comeback backup (expected a JSON object).");
  if(obj.version!=null&&obj.version!==1&&obj.version!==2)throw new Error(typeof obj.version==='number'&&obj.version>2?'This backup was made by a newer version of Comeback (version '+obj.version+'). Update the app first.':'Unknown backup version: '+esc(String(obj.version)).slice(0,20)+'.');
  const mig=Core.migrateSettings(obj.settings);
  if(!obj.days||typeof obj.days!=='object'||Array.isArray(obj.days))throw new Error("The backup is missing its 'days' section.");
  const outDays={},skipped={};
  Object.keys(obj.days).forEach(k=>{
    if(!lenient){outDays[k]=normalizeDay(k,obj.days[k]);return}
    try{outDays[k]=normalizeDay(k,obj.days[k])}catch(e){skipped[k]={raw:obj.days[k],error:errText(e)}}
  });
  Core.applyIdMap(outDays,mig.idMap);
  const out={version:2,settings:mig.settings,days:outDays};
  if(lenient)out.skipped=skipped;
  return out;
}

/* ---------- merging a day that two places changed ----------
   Timestamps are phone clocks, so one phone with a wrong clock must not win forever: any timestamp is read as at most 5 minutes
   ahead of now. A timestamp of 0 or none means "unknown" (an old backup, a day made before saving began). */
const SKEW_MS=5*60*1000;
const clampTs=(t,now)=>num(t)&&t>0?Math.min(t,(now==null?Date.now():now)+SKEW_MS):0;
const canonJson=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o,q)=>{o[q]=x[q];return o},{}):x);
const sameDay=(a,b)=>canonJson(dayData(a))===canonJson(dayData(b));
/* How much step detail a day has: the count first, then the hourly buckets. */
const metaWeight=m=>m?[m.counted||0,(m.hourly||[]).reduce((x,y)=>x+y,0)]:[-1,-1];
/* Merge two records of the same day key by key: the union of values and rules (where both have a key, the side with the newer day
   timestamp wins), the higher step count with the richer step details, and the newer weight, waist and note unless it is empty. */
function mergeDayRecords(a,b,now){
  const ta=clampTs(a.updatedAt,now),tb=clampTs(b.updatedAt,now);
  const nw=tb>ta?b:a,od=nw===a?b:a;
  const out={vals:Object.assign({},od.vals,nw.vals),rules:Object.assign({},od.rules,nw.rules),
    weight:nw.weight!=null?nw.weight:od.weight,waist:nw.waist!=null?nw.waist:od.waist,note:nw.note?nw.note:(od.note||''),date:a.date||b.date,updatedAt:Math.max(ta,tb)};
  if(ta===tb?(a.light===true||b.light===true):nw.light===true)out.light=true;   // a light day follows the newer edit (so turning it off sticks)
  const sa=a.vals&&a.vals.steps,sb=b.vals&&b.vals.steps;
  if(num(sa)&&num(sb))out.vals.steps=Math.max(sa,sb);
  const ma=a.steps_meta,mb=b.steps_meta;
  if(ma||mb){
    const wa=metaWeight(ma),wb=metaWeight(mb);
    const aWins=!mb||(ma&&(wa[0]>wb[0]||(wa[0]===wb[0]&&(wa[1]>wb[1]||(wa[1]===wb[1]&&nw===a)))));
    out.steps_meta=clone(aWins?ma:mb);
  }
  // travel: the side that recorded more wins whole (a relabelled trip is kept with it)
  const tvA=a.travel,tvB=b.travel;
  if(tvA||tvB){
    const tw=t=>t?(t.walk_min||0)+(t.run_min||0)+(t.bike_min||0)+(t.vehicle_min||0)+(t.trips||[]).length:-1;
    out.travel=clone(!tvB||(tvA&&(tw(tvA)>tw(tvB)||(tw(tvA)===tw(tvB)&&nw===a)))?tvA:tvB);
  }
  return out;
}

/* Best effort for the copy kept when the phone's saved data couldn't be read: every day that is fine is taken; if the plan itself is
   what is broken, the default plan stands in for it (Merge keeps the plan that is on this phone). inc.salvaged says what was left out. */
function salvageData(obj){
  let inc,planLost=false;
  try{inc=normalizeData(obj,true)}
  catch(e){
    if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error("That copy isn't a Comeback backup.");
    planLost=true;
    inc=normalizeData(Object.assign({},obj,{version:2,settings:clone(DEFAULT_SETTINGS)}),true);
  }
  const bad=Object.keys(inc.skipped||{}).length,notes=[];
  if(planLost)notes.push("Its plan couldn't be read, so the default plan is used (Merge keeps the plan on this phone).");
  if(bad)notes.push(bad+(bad===1?' day':' days')+" couldn't be read and "+(bad===1?'is':'are')+' left out.');
  inc.salvaged=notes.join(' ');
  return inc;
}

function mergeData(local,inc){
  const outDays=Object.assign({},local.days);let added=0,updated=0,kept=0;
  Object.keys(inc.days).forEach(k=>{
    const cur=outDays[k],d=inc.days[k];
    if(!cur){outDays[k]=d;added++;return}
    const m=mergeDayRecords(cur,d);
    if(sameDay(m,cur))kept++;else{outDays[k]=m;updated++}
  });
  // habits and sections the backup has and this phone lacks are added; what is here (order, targets, schedules, units) wins
  const ls=local.settings,merged=clone(ls);
  inc.settings.habits.forEach(h=>{if(!merged.habits.some(x=>x.id===h.id)){merged.habits.push(clone(h));Core.ensureSection(merged,h.section,((inc.settings.sections||[]).find(x=>x.id===h.section)||{}).name)}});
  (inc.settings.sections||[]).forEach(x=>{if(!merged.sections.some(y=>y.id===x.id))merged.sections.push(clone(x))});
  if(merged.body.heightCm==null&&inc.settings.body&&inc.settings.body.heightCm!=null)merged.body.heightCm=inc.settings.body.heightCm;
  if(merged.body.goalKg==null&&inc.settings.body&&inc.settings.body.goalKg!=null){merged.body.goalKg=inc.settings.body.goalKg;if(inc.settings.body.goalDate)merged.body.goalDate=inc.settings.body.goalDate}
  return{data:{version:2,settings:merged,days:outDays},added,updated,kept};
}

/* ---------- storage (Capacitor Preferences) ---------- */
let meta={lastBackup:null,reminder:{enabled:false,time:'21:00'},steps:{heightCm:180,strictness:'balanced',sensitivity:'normal',useLocation:false,enabledAt:null,setupShown:false},nudges:[],suggestSnooze:{},heightChecked:false};
let loadProblem='';
/* Height used to live in this phone's step settings. It is now part of the synced settings (and is the BMI height). */
function adoptDeviceHeight(){
  if(meta.heightChecked)return false;           // only the first launch after the upgrade looks at the old phone-only height
  meta.heightChecked=true;store.saveMeta().catch(()=>{});
  if(settings.body.heightCm!=null||meta.steps.enabledAt==null)return false;
  const hh=meta.steps.heightCm;
  if(!(num(hh)&&hh>=100&&hh<=230))return false;
  settings.body.heightCm=hh;return true;
}
const prefGet=async k=>(await Prefs.get({key:k})).value;
const prefSet=(k,v)=>Prefs.set({key:k,value:v});

/* Before the app was renamed Comeback it saved under "resetlog" keys. On launch those move to the "comeback" keys and
   the old ones are removed. Safe to run any number of times: a key is only removed once its value is stored under the new name,
   and when both names exist with different values neither is touched, so nothing can be lost. */
const LEGACY_PREFIX='resetlog';
const LEGACY_KEYS=[[LEGACY_PREFIX,'comeback'],[LEGACY_PREFIX+'_meta','comeback_meta'],[LEGACY_PREFIX+'_migrated','comeback_migrated'],[LEGACY_PREFIX+'_sync','comeback_sync'],[LEGACY_PREFIX+'_onboarded','comeback_onboarded']];
async function migrateLegacyKeys(){
  const pairs=LEGACY_KEYS.slice();
  try{((await Prefs.keys()).keys||[]).forEach(k=>{if(k.indexOf(LEGACY_PREFIX+'_unreadable_')===0)pairs.push([k,'comeback_unreadable_'+k.slice((LEGACY_PREFIX+'_unreadable_').length)])})}catch(e){}
  let moved=0;
  for(const[oldK,newK]of pairs){
    try{
      const ov=await prefGet(oldK);if(ov==null)continue;
      const nv=await prefGet(newK);
      if(nv==null){await prefSet(newK,ov);moved++}
      else if(nv!==ov)continue;
      await Prefs.remove({key:oldK});
    }catch(e){}
  }
  return moved;
}

/* When the saved copy couldn't be read at all (loadProblem), the app must not write over it, and must not replace the files of the
   automatic backup with an empty copy. While "dataLocked", new work is saved under SAFE_KEY (it comes back on the next start) and
   the automatic backup is paused until the data is restored (see recoverUnreadable and restoreFromFile). */
let dataLocked=false;
const SAFE_KEY='comeback_safe',UNREAD_PREFIX='comeback_unreadable_',QUAR_PREFIX='comeback_quarantine_',KEEP_COPIES=3;
/* Keeps only the newest KEEP_COPIES keys that start with prefix (their suffix is the time they were made). */
async function capKeys(prefix){
  try{
    const ks=((await Prefs.keys()).keys||[]).filter(k=>k.indexOf(prefix)===0).sort((a,b)=>(Number(b.slice(prefix.length))||0)-(Number(a.slice(prefix.length))||0));
    for(const k of ks.slice(KEEP_COPIES))await Prefs.remove({key:k});
  }catch(e){}
}
/* Writes a kept copy under prefix+time, unless the newest one is identical already (so restarting doesn't pile up copies). */
async function keepCopy(prefix,text){
  try{
    const ks=((await Prefs.keys()).keys||[]).filter(k=>k.indexOf(prefix)===0);
    for(const k of ks)if(await prefGet(k)===text)return k;
    const key=prefix+Date.now();
    await prefSet(key,text);
    await capKeys(prefix);
    return key;
  }catch(e){return null}
}
async function newestUnreadable(){
  try{
    const ks=((await Prefs.keys()).keys||[]).filter(k=>k.indexOf(UNREAD_PREFIX)===0).sort((a,b)=>(Number(b.slice(UNREAD_PREFIX.length))||0)-(Number(a.slice(UNREAD_PREFIX.length))||0));
    return ks.length?await prefGet(ks[0]):null;
  }catch(e){return null}
}
let loadNotice='';

store={
  queue:Promise.resolve(),
  persist(){
    const json=JSON.stringify(buildData());
    const key=dataLocked?SAFE_KEY:DATA_KEY;
    const p=this.queue.then(()=>prefSet(key,json));
    this.queue=p.catch(()=>{});
    return p;
  },
  async load(){
    await migrateLegacyKeys();
    await capKeys(UNREAD_PREFIX);await capKeys(QUAR_PREFIX);
    let raw=await prefGet(DATA_KEY),migrated=0;
    if(await prefGet(MIGRATED_KEY)==null){
      // one-time move of the old browser copy (localStorage "resetlog", from before Preferences was used) into Preferences
      let old=null;try{old=localStorage.getItem(LEGACY_PREFIX)}catch(e){}
      if(raw==null&&old){
        try{
          const parsed=JSON.parse(old);
          if(!parsed.settings)parsed.settings=clone(DEFAULT_SETTINGS);
          const norm=normalizeData(parsed);
          raw=JSON.stringify(norm);await prefSet(DATA_KEY,raw);migrated=Object.keys(norm.days).length;
        }catch(e){loadProblem="Couldn't move your old saved entries: "+errText(e)}
      }
      if(!loadProblem)await prefSet(MIGRATED_KEY,'1');
    }
    try{const m=await prefGet(META_KEY);if(m){const mm=JSON.parse(m);meta.lastBackup=num(mm.lastBackup)?mm.lastBackup:null;if(mm.steps&&typeof mm.steps==='object'){const st=mm.steps;meta.steps={heightCm:num(st.heightCm)&&st.heightCm>=100&&st.heightCm<=230?st.heightCm:180,strictness:['relaxed','balanced','strict'].includes(st.strictness)?st.strictness:'balanced',sensitivity:['low','normal','high'].includes(st.sensitivity)?st.sensitivity:'normal',useLocation:!!st.useLocation,enabledAt:num(st.enabledAt)?st.enabledAt:null,setupShown:!!st.setupShown}}if(Array.isArray(mm.nudges))meta.nudges=mm.nudges.filter(t=>typeof t==='string').slice(-20);if(mm.heightChecked===true)meta.heightChecked=true;if(mm.suggestSnooze&&typeof mm.suggestSnooze==='object'&&!Array.isArray(mm.suggestSnooze)){const o={};Object.keys(mm.suggestSnooze).forEach(k=>{if(ID_RE.test(k)&&DATE_RE.test(String(mm.suggestSnooze[k])))o[k]=mm.suggestSnooze[k]});meta.suggestSnooze=o}if(mm.reminder&&typeof mm.reminder==='object')meta.reminder={enabled:!!mm.reminder.enabled,time:/^\d{2}:\d{2}$/.test(mm.reminder.time)?mm.reminder.time:'21:00'}}}catch(e){}
    try{const sv=await prefGet(SYNC_KEY);if(sv){const ss=JSON.parse(sv);sync.signedIn=!!ss.signedIn;sync.userId=typeof ss.userId==='string'?ss.userId:null;sync.email=typeof ss.email==='string'?ss.email:'';sync.lastSyncAt=num(ss.lastSyncAt)?ss.lastSyncAt:null;sync.settingsUpdatedAt=num(ss.settingsUpdatedAt)?ss.settingsUpdatedAt:0;sync.pendingDays=Array.isArray(ss.pendingDays)?ss.pendingDays.filter(k=>typeof k==='string'):[];sync.pendingSettings=!!ss.pendingSettings;sync.seen={};if(ss.seen&&typeof ss.seen==='object'&&!Array.isArray(ss.seen))Object.keys(ss.seen).forEach(k=>{if(num(ss.seen[k]))sync.seen[k]=ss.seen[k]})}}catch(e){}
    if(raw==null)return{migrated};
    try{
      const parsed=JSON.parse(raw);
      const norm=normalizeData(parsed,true);
      const bad=Object.keys(norm.skipped);
      if(bad.length){
        // a bad day is set aside on its own (kept as it was) and the rest loads; the next save no longer contains it
        const kept=await keepCopy(QUAR_PREFIX,JSON.stringify({quarantinedDays:Object.keys(norm.skipped).reduce((o,k)=>{o[k]=norm.skipped[k].raw;return o},{})}));
        const list=bad.sort();
        loadNotice=bad.length+(bad.length===1?' day':' days')+" couldn't be read and "+(bad.length===1?'was':'were')+' set aside ('+list.slice(0,3).join(', ')+(list.length>3?' and '+(list.length-3)+' more':'')+'). Everything else loaded fine.'+(kept?' A copy of '+(bad.length===1?'it':'them')+' was kept on this phone.':'');
      }
      return{data:norm,migrated,quarantined:bad,upgraded:bad.length>0||!(parsed&&parsed.version===2&&parsed.settings&&parsed.settings.v===2)};
    }catch(e){
      // the whole copy is unreadable: keep it as it is, and do not write over it or over the automatic backup
      await keepCopy(UNREAD_PREFIX,raw);
      dataLocked=true;
      loadProblem="Your saved data couldn't be read ("+errText(e)+"). A copy was kept and nothing was overwritten. Use Restore from backup (or Recover below) to bring your entries back.";
      try{ // work done since then was saved apart; pick it up again
        const w=await prefGet(SAFE_KEY);
        if(w){const n=normalizeData(JSON.parse(w),true);return{data:n,migrated}}
      }catch(e2){}
      return{migrated};
    }
  },
  async saveMeta(){await prefSet(META_KEY,JSON.stringify(meta))}
};

/* ---------- files: export, auto backup ---------- */
const DIR='Comeback';
const fmtWhen=t=>new Date(t).toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
function showLastBackup(){$('lastBackup').textContent='Last backup: '+(meta.lastBackup?fmtWhen(meta.lastBackup):'never')}
async function markBackup(){meta.lastBackup=Date.now();showLastBackup();try{await store.saveMeta()}catch(e){}}

const FS=()=>Native.Filesystem;
async function writeDocs(name,text){
  return FS().writeFile({path:DIR+'/'+name,data:text,directory:Native.Directory.Documents,encoding:Native.Encoding.UTF8,recursive:true});
}

let autoQueue=Promise.resolve(),autoErrText='';
function autoFail(text){autoErrText=text;setMsg('bkMsg',text,true)}
function autoBackup(){
  if(!IS_NATIVE||dataLocked)return Promise.resolve();   // while the saved copy is unreadable the backup files are left alone
  autoQueue=autoQueue.then(async()=>{
    try{
      const text=JSON.stringify(buildData(),null,2);
      await writeDocs('comeback-autobackup.json',text);
      await writeDocs('comeback-autobackup-'+todayStr()+'.json',text);
      try{
        const list=await FS().readdir({path:DIR,directory:Native.Directory.Documents});
        const dated=list.files.map(f=>f.name).filter(n=>/^comeback-autobackup-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse();
        for(const n of dated.slice(7))await FS().deleteFile({path:DIR+'/'+n,directory:Native.Directory.Documents});
      }catch(e){await markBackup();autoFail("Backup saved, but cleaning up old copies failed: "+errText(e));return}
      await markBackup();
      if(autoErrText&&$('bkMsg').textContent===autoErrText){setMsg('bkMsg','')}autoErrText='';
    }catch(e){autoFail("Automatic backup failed: "+errText(e)+". Your entry is saved in the app; use Export backup to keep a copy.")}
  });
  return autoQueue;
}

async function exportFile(name,text,mime,label){
  if(!IS_NATIVE){
    const url=URL.createObjectURL(new Blob([text],{type:mime}));
    const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    await markBackup();return 'Downloaded '+name+'.';
  }
  let uri,note='';
  try{uri=(await writeDocs(name,text)).uri;await markBackup()}
  catch(e){
    note="Couldn't save a copy in Documents ("+errText(e)+"). ";
    try{uri=(await FS().writeFile({path:name,data:text,directory:Native.Directory.Cache,encoding:Native.Encoding.UTF8})).uri}
    catch(e2){throw new Error("Couldn't write the file: "+errText(e2))}
  }
  const where=note?'':'Saved to Documents/'+DIR+'/'+name+'. ';
  try{
    await Native.Share.share({title:label,text:label,files:[uri],dialogTitle:'Share '+label});
    return note+where+'Shared.';
  }catch(e){
    if(/cancel/i.test(errText(e)))return note+where+'Sharing was cancelled.';
    const err=new Error(note+where+"Couldn't open the share sheet: "+errText(e));err.partial=!note;throw err;
  }
}

function csvCell(v){
  if(v==null)return'';
  let s=String(v);
  if(typeof v==='string'&&/^[=+\-@\t\r]/.test(s))s="'"+s;
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
/** 'counted' (phone sensor), 'manual', or '' when the day has no steps */
/* 'counted' = read by the phone. 'manual' only ever appears on days entered by hand before steps became phone-only; those rows keep it. */
function stepsSourceOf(d){return d.steps_meta?(d.steps_meta.source==='auto'?'counted':'manual'):(d.vals&&d.vals.steps!=null?'manual':'')}
function buildCsv(){
  const cols=settings.habits.filter(h=>h.type!=='measure');
  const head=['Date','Score %','Light day'].concat(cols.map(h=>h.type==='yesno'?h.name:h.name+' ('+h.unit+')'),TRAVEL_CSV_HEAD,['Steps source','Distance (km)','Filtered steps','Weight (kg)','Waist (cm)','BMI','Note']);
  const keys=Object.keys(days).filter(k=>Core.hasRecord(days[k])||Core.isLight(days[k])).sort();
  const rows=keys.map(k=>{
    const d=days[k],b=Core.bmi(d.weight,settings.body.heightCm),lt=Core.isLight(d);
    return [k,lt?'':scoreOf(d),lt?'yes':''].concat(
      cols.map(h=>h.type==='yesno'?(d.rules&&d.rules[h.id]?'yes':'no'):(d.vals&&d.vals[h.id]!=null?d.vals[h.id]:'')),
      travelCsvCells(d),[stepsSourceOf(d),d.steps_meta?d.steps_meta.distance_km:'',d.steps_meta?d.steps_meta.filtered:'',d.weight==null?'':d.weight,d.waist==null?'':d.waist,b==null?'':Core.bmiRound(b),d.note||'']);
  });
  return '﻿'+[head].concat(rows).map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

async function runExport(btn,fn){
  btn.disabled=true;setMsg('bkMsg','');
  try{setMsg('bkMsg',await fn())}catch(e){setMsg('bkMsg',errText(e),true)}
  btn.disabled=false;
}

/* ---------- restore ---------- */
function readText(file){
  if(file.text)return file.text();
  return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=()=>rej(fr.error);fr.readAsText(file)});
}
const fmtD=k=>parse(k).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
const range=ks=>{ks=ks.slice().sort();return ks.length?fmtD(ks[0])+' to '+fmtD(ks[ks.length-1]):''};

async function restoreFromFile(file){
  setMsg('bkMsg','');
  let inc;
  try{
    let obj;
    try{obj=JSON.parse(await readText(file))}catch(e){throw new Error("That file isn't valid JSON, so it can't be a Comeback backup.")}
    inc=file.salvage?salvageData(obj):normalizeData(obj);
  }catch(e){setMsg('bkMsg',"Couldn't restore: "+errText(e),true);return}
  const n=Core.loggedKeys(inc.days).length;
  const body=(file.name||'This file')+' has '+n+' logged '+(n===1?'day':'days')+(n?' ('+range(Object.keys(inc.days))+')':'')+', '+inc.settings.habits.filter(h=>h.type!=='measure').length+' habits and rules. This phone has '+Object.keys(days).length+' logged days.'+(inc.salvaged?' '+inc.salvaged:'');
  if(await askModal('Restore this backup?',body,[{label:'Continue',value:'go'},{label:'Cancel',value:'cancel'}])!=='go')return;
  const mode=await askModal('How should it be restored?','Merge keeps what is on this phone and adds the backup. If a day is in both, the newer save wins. Replace everything deletes what is on this phone and uses only the backup.'+(signedIn()?' The restored data is also sent to your cloud copy; days that exist only in the cloud will come back on the next sync.':''),[{label:'Merge',value:'merge'},{label:'Replace everything',value:'replace',cls:'danger'},{label:'Cancel',value:'cancel'}]);
  if(mode!=='merge'&&mode!=='replace')return;
  let warn='';
  if(IS_NATIVE&&!dataLocked){try{await writeDocs('comeback-before-restore.json',JSON.stringify(buildData(),null,2))}catch(e){warn=" Couldn't save a safety copy of your old data first ("+errText(e)+")."}}
  const before=buildData(),wasLocked=dataLocked;let summary;
  try{
    let next;
    if(mode==='replace'){next=inc;summary='Replaced everything with the backup: '+n+(n===1?' day.':' days.')}
    else{const m=mergeData(before,inc);next=m.data;summary='Merged: '+m.added+' new, '+m.updated+' updated, '+m.kept+' kept as they were.'}
    settings=next.settings;days=next.days;
    dataLocked=false;   // the restored data is good, so saving goes back to the normal copy
    await store.persist();
  }catch(e){settings=before.settings;days=before.days;dataLocked=wasLocked;setMsg('bkMsg',"Couldn't restore: "+errText(e)+' Nothing was changed.',true);return}
  if(wasLocked){loadProblem='';try{await Prefs.remove({key:SAFE_KEY})}catch(e){}hideRecoverRow()}
  if(!signedIn())markSettingsDirty(true);   // a restored plan is a deliberate choice: it counts as edited when you sign in later
  if(signedIn()){
    // restored data counts as a fresh write, so it also wins over older cloud copies
    const now=Date.now();
    Object.keys(days).forEach(k=>{if(mode==='replace'||days[k]!==before.days[k]){days[k]=Object.assign({},days[k],{updatedAt:now});markDayDirty(k)}});
    markSettingsDirty();
    try{await store.persist()}catch(e){}
  }
  refreshAll();
  setMsg('bkMsg',summary+warn,!!warn);
  autoBackup();
  syncSoon(false);
}

/* When the saved copy couldn't be read, Settings > Backup gets a "Recover" row. It offers the copy that was kept through the same
   restore flow as a backup file (so it is checked, and Merge or Replace is chosen the same way). */
async function recoverUnreadable(){
  const raw=await newestUnreadable();
  if(raw==null){setMsg('bkMsg','No kept copy was found on this phone. Use Restore from backup with a backup file.',true);return}
  await restoreFromFile({name:'The copy kept on this phone',text:async()=>raw,salvage:true});
}
function showRecoverRow(){
  const g=$('bkGroup');if(!g||$('recoverBtn'))return;
  const b=h('<button class="row" id="recoverBtn"><span class="row-ic orange"><svg data-ic="upload"></svg></span><span class="row-body"><span class="row-label">Recover the unreadable copy</span><span class="row-sub">Tries to bring back the entries that were kept</span></span><svg data-ic="chevron-right" class="chev"></svg></button>');
  b.addEventListener('click',recoverUnreadable);
  g.appendChild(b);hydrate(b);
}
function hideRecoverRow(){const b=$('recoverBtn');if(b)b.remove()}
/* Called once after the saved data has been read: says what, if anything, could not be loaded. */
function showLoadNotice(){
  if(loadProblem){setMsg('bkMsg',loadProblem,true);if(dataLocked)showRecoverRow()}
  else if(loadNotice)setMsg('bkMsg',loadNotice,true);
}

/* ---------- daily reminder ---------- */
const REM_ID=1001,REM_CHANNEL='daily-reminder';
const LN=()=>Native.LocalNotifications;
async function scheduleReminder(time){
  const [h,m]=time.split(':').map(Number);
  await LN().cancel({notifications:[{id:REM_ID}]});
  await LN().createChannel({id:REM_CHANNEL,name:'Daily reminder',description:'Reminds you to log your day',importance:4,visibility:1});
  await LN().schedule({notifications:[{
    id:REM_ID,title:'Comeback',body:'Time to log today. How did your comeback go?',
    channelId:REM_CHANNEL,smallIcon:'ic_stat_comeback',
    schedule:{on:{hour:h,minute:m},allowWhileIdle:true},isExactNotification:false,
    extra:{tab:'today'}
  }]});
}
const BLOCKED="Notifications are blocked for Comeback. Turn them on in Android Settings > Apps > Comeback > Notifications, then switch this on again.";
async function setReminder(on){
  const box=$('remOn');setMsg('remMsg','');
  try{
    if(on){
      if(!IS_NATIVE){box.checked=false;setMsg('remMsg','Reminders only work in the Android app.',true);return}
      let p=await LN().checkPermissions();
      if(p.display!=='granted')p=await LN().requestPermissions();
      if(p.display!=='granted'){box.checked=false;meta.reminder.enabled=false;await store.saveMeta();setMsg('remMsg',BLOCKED,true);return}
      await scheduleReminder($('remTime').value);
      meta.reminder={enabled:true,time:$('remTime').value};await store.saveMeta();
      setMsg('remMsg','Reminder set for '+fmtTime($('remTime').value)+' every day.');
    }else{
      if(IS_NATIVE)await LN().cancel({notifications:[{id:REM_ID}]});
      meta.reminder.enabled=false;await store.saveMeta();
      setMsg('remMsg','Reminder is off.');
    }
  }catch(e){
    box.checked=!on;
    setMsg('remMsg',"Couldn't "+(on?'set':'turn off')+' the reminder: '+errText(e),true);
  }
}
const fmtTime=t=>{const [h,m]=t.split(':').map(Number);return new Date(2000,0,1,h,m).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',hour12:true})};
async function onRemTimeChange(e){
  const t=e.target.value;
  if(!/^\d{2}:\d{2}$/.test(t)){e.target.value=meta.reminder.time;return}
  const was=meta.reminder.time;
  if(!$('remOn').checked){meta.reminder.time=t;try{await store.saveMeta()}catch(x){}return}
  try{await scheduleReminder(t);meta.reminder.time=t;await store.saveMeta();setMsg('remMsg','Reminder moved to '+fmtTime(t)+' every day.')}
  catch(x){e.target.value=was;setMsg('remMsg',"Couldn't change the time: "+errText(x),true)}
}
async function initReminder(){
  $('remOn').checked=meta.reminder.enabled;$('remTime').value=meta.reminder.time;
  if(!IS_NATIVE){if(!meta.reminder.enabled)setMsg('remMsg','Reminders only work in the Android app.')}
  if(!IS_NATIVE||!meta.reminder.enabled)return;
  try{
    const p=await LN().checkPermissions();
    if(p.display==='granted')await scheduleReminder(meta.reminder.time); // re-arms the alarm after app updates
    else setMsg('remMsg',BLOCKED,true);
  }catch(e){setMsg('remMsg',"Couldn't check the reminder: "+errText(e),true)}
}

/* ---------- cloud sync (Supabase, optional) ----------
   Local Preferences stay the source the UI reads. Supabase is the cloud copy.
   Saves go to the cloud right away when online; otherwise the day is queued in
   Preferences and sent later. A full sync (open, sign in, foreground, network back,
   "Sync now") pulls every cloud row and keeps whichever side has the newer timestamp. */
const CFG=window.COMEBACK_CONFIG||{};
const SYNC_KEY='comeback_sync';
let sb=null,session=null;
let sync={signedIn:false,userId:null,email:'',lastSyncAt:null,settingsUpdatedAt:0,pendingDays:[],pendingSettings:false,seen:{}};   // seen: for each day, the cloud timestamp this phone last took in or wrote (tells "the cloud changed" from "only I changed")
let syncRunning=null,syncAgain=false,wantFull=false,syncError='',syncOffline=false,lastFullAt=0;
const cloudConfigured=()=>!!(CFG.SUPABASE_URL&&CFG.SUPABASE_PUBLISHABLE_KEY&&Native.createClient);
const signedIn=()=>cloudConfigured()&&sync.signedIn;
const saveSync=()=>prefSet(SYNC_KEY,JSON.stringify(sync));
const pendingCount=()=>sync.pendingDays.length+(sync.pendingSettings?1:0);
const dayData=d=>{const o={vals:d.vals||{},rules:d.rules||{},weight:d.weight==null?null:d.weight,waist:d.waist==null?null:d.waist,note:d.note||''};if(d.steps_meta)o.steps_meta=d.steps_meta;if(d.travel)o.travel=d.travel;if(d.light===true)o.light=true;return o};
const isNetErr=e=>!!e&&(e.name==='AuthRetryableFetchError'||e.status===0||/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(String(e.message||e)));
function syncErrText(e){
  if(isNetErr(e))return 'No internet connection.';
  const m=errText(e);
  return /jwt|token/i.test(m)?m+' Try signing out and in again.':m;
}

const authStorage={
  getItem:async k=>(await Prefs.get({key:'sb:'+k})).value,
  setItem:async(k,v)=>{await Prefs.set({key:'sb:'+k,value:v})},
  removeItem:async k=>{await Prefs.remove({key:'sb:'+k})}
};

function markDayDirty(k){if(signedIn()&&!sync.pendingDays.includes(k)){sync.pendingDays.push(k);saveSync().catch(()=>{})}}
const inOnboarding=()=>{try{return typeof onb!=='undefined'&&!!onb}catch(e){return false}};
/* A settings change counts as "edited" (it can then beat the cloud copy) when it is deliberate: made while signed in, after
   onboarding, or forced (a restore). The starter plan and targets picked during onboarding are not an edit, so signing in later
   to an account that already has settings brings that account's plan instead of replacing it. */
function markSettingsDirty(force){
  const signed=signedIn();
  if(signed||force||!inOnboarding())sync.settingsUpdatedAt=Date.now();
  if(signed)sync.pendingSettings=true;
  saveSync().catch(()=>{});
}
let cloudSettingsFuture=false;   // the cloud copy is from a newer app version: read nothing from it and write nothing over it

/* Applying settings from the cloud changes the live objects in place (the same settings object, habits array, habit objects and
   section objects), so anything that still holds one of them (an open edit sheet, an undo toast) keeps writing to the live plan. */
function replaceProps(o,n){Object.keys(o).forEach(k=>{if(!(k in n))delete o[k]});Object.assign(o,n)}
function applySettingsInPlace(next){
  const cur=settings,byId=(list)=>new Map(list.map(x=>[x.id,x]));
  const hs=byId(cur.habits),ss=byId(cur.sections);
  const habits=next.habits.map(nh=>{const o=hs.get(nh.id);if(!o)return clone(nh);replaceProps(o,clone(nh));return o});
  const sections=next.sections.map(ns=>{const o=ss.get(ns.id);if(!o)return clone(ns);replaceProps(o,clone(ns));return o});
  cur.habits.splice(0,cur.habits.length,...habits);
  cur.sections.splice(0,cur.sections.length,...sections);
  ['body','units','prefs'].forEach(k=>{if(cur[k]&&typeof cur[k]==='object')replaceProps(cur[k],clone(next[k]));else cur[k]=clone(next[k])});
  cur.v=2;
}
/* An older app (version 1: just habits and rules) uploaded this copy after this phone's last change. Take what it can have changed
   (names, targets, units, new habits and rules) and keep this phone's layout: sections, order, schedules, icons, hidden habits, units, body, preferences. */
function mergeLegacySettings(inc){
  inc.habits.forEach(ih=>{
    const lh=settings.habits.find(x=>x.id===ih.id);
    if(lh){
      lh.name=ih.name;
      if(lh.type===ih.type&&(lh.type==='count'||lh.type==='duration'||lh.type==='steps')){lh.target=ih.target;if(lh.type!=='steps')lh.unit=ih.unit}
    }else if(!(ih.type==='measure'&&settings.habits.some(x=>x.type==='measure'&&x.measure===ih.measure))){
      settings.habits.push(clone(ih));
      Core.ensureSection(settings,ih.section,((inc.sections||[]).find(x=>x.id===ih.section)||{}).name);
    }
  });
}

async function fetchAllDays(){
  const out=[];
  for(let from=0;;from+=1000){
    const {data,error}=await sb.from('day_logs').select('log_date,data,updated_at').eq('user_id',sync.userId).order('log_date').range(from,from+999);
    if(error)throw error;
    out.push(...data);
    if(data.length<1000)break;
  }
  return out;
}

async function pullAndMerge(){
  const rows=await fetchAllDays();
  const {data:srow,error:serr}=await sb.from('user_settings').select('data,updated_at').eq('user_id',sync.userId).maybeSingle();
  if(serr)throw serr;
  const now=Date.now();
  // a phone that has never synced and has nothing logged only holds the plan from onboarding: the cloud copy is the real one
  const firstPull=!sync.lastSyncAt&&Object.keys(days).length===0;
  let changed=false,skipped=0;
  // settings first: an old-shape (version 1) cloud copy also says how to rename rule ids that clash with habit ids, in its days
  let mig=null;cloudSettingsFuture=false;
  if(srow){
    const v=srow.data&&srow.data.v;
    if(num(v)&&v>2)cloudSettingsFuture=true;
    else{try{mig=Core.migrateSettings(srow.data)}catch(e){skipped++}}
  }
  const cloud={},unreadable=new Set();
  rows.forEach(r=>{
    const k=r.log_date,raw=Date.parse(r.updated_at)||0,ts=clampTs(raw,now);
    cloud[k]=raw;
    let inc;
    try{
      inc=normalizeDay(k,Object.assign({},r.data,{updatedAt:ts}));
      if(mig&&mig.wasLegacy)Core.applyIdMap({[k]:inc},mig.idMap);
    }catch(e){skipped++;unreadable.add(k);return}
    const L=days[k],seen=sync.seen[k];
    sync.seen[k]=raw;
    if(!L){days[k]=inc;changed=true;return}
    const cloudChanged=seen!==raw,localChanged=L.updatedAt!==(seen===undefined?raw:seen);
    if(!cloudChanged)return;                       // the cloud is as this phone last left it: keep the phone's copy (it goes up if it changed)
    const lts=clampTs(L.updatedAt,now);
    if(!localChanged){if(ts>lts){days[k]=inc;changed=true}return}   // only the cloud changed (a copy that looks older leaves this phone's day alone)
    if(sameDay(L,inc)){L.updatedAt=ts;return}      // both changed it the same way
    // both changed it (or this phone cannot tell): keep the fields from both
    const mg=mergeDayRecords(L,inc,now);
    mg.updatedAt=Math.max(mg.updatedAt+1,now);   // a new version: it differs from the cloud's timestamp, so every phone can tell it is new
    days[k]=mg;changed=true;
  });
  // settings: the newer side wins, but an older-shaped cloud copy never wipes the layout kept on this phone
  const cts=srow?clampTs(Date.parse(srow.updated_at)||0,now):null;
  if(mig){
    const legacy=mig.wasLegacy;
    if(firstPull||cts>sync.settingsUpdatedAt){
      if(legacy&&!firstPull)mergeLegacySettings(mig.settings);else applySettingsInPlace(mig.settings);
      sync.settingsUpdatedAt=cts;sync.pendingSettings=legacy;changed=true;   // a version-1 copy is replaced by version 2 right away
      if(adoptDeviceHeight())sync.pendingSettings=true;
    }else sync.pendingSettings=sync.settingsUpdatedAt>cts||legacy;
  }else if(!srow)sync.pendingSettings=true;
  // everything the cloud lacks or holds a different copy of still has to go up (a future timestamp in the cloud is put right too)
  sync.pendingDays=Object.keys(days).filter(k=>!unreadable.has(k)&&(cloud[k]==null||days[k].updatedAt!==cloud[k]));
  if(changed){await store.persist();refreshAfterCloudChange()}
  if(cloudSettingsFuture)throw new Error('Your cloud settings were saved by a newer version of Comeback. Update the app to sync them.');
  if(skipped)throw new Error(skipped+' cloud '+(skipped===1?'row was':'rows were')+' skipped because it could not be read.');
}

async function flushPending(){
  const uid=sync.userId,now=Date.now();
  let stamped=false;
  // outgoing timestamps are never more than 5 minutes ahead, and a day with an unknown one (0) gets a real one
  const sent=sync.pendingDays.filter(k=>days[k]).map(k=>{
    const d=days[k],at=d.updatedAt>0?Math.min(d.updatedAt,now+SKEW_MS):now;
    if(at!==d.updatedAt){d.updatedAt=at;stamped=true}
    return{k,at};
  });
  if(stamped)try{await store.persist()}catch(e){}
  for(let i=0;i<sent.length;i+=200){
    const chunk=sent.slice(i,i+200);
    const {error}=await sb.from('day_logs').upsert(chunk.map(x=>({user_id:uid,log_date:x.k,data:dayData(days[x.k]),updated_at:new Date(x.at).toISOString()})),{onConflict:'user_id,log_date'});
    if(error)throw error;
    chunk.forEach(x=>{sync.seen[x.k]=x.at;if(days[x.k]&&(days[x.k].updatedAt||0)===x.at)sync.pendingDays=sync.pendingDays.filter(d=>d!==x.k)});
    await saveSync();
  }
  sync.pendingDays=sync.pendingDays.filter(k=>days[k]);
  if(sync.pendingSettings&&!cloudSettingsFuture){
    if(!sync.settingsUpdatedAt)sync.settingsUpdatedAt=now;   // the first plan to reach an empty cloud becomes its copy
    if(sync.settingsUpdatedAt>now+SKEW_MS)sync.settingsUpdatedAt=now+SKEW_MS;
    const at=sync.settingsUpdatedAt;
    const {error}=await sb.from('user_settings').upsert({user_id:uid,data:Object.assign({},settings,{v:2}),updated_at:new Date(at).toISOString()},{onConflict:'user_id'});
    if(error)throw error;
    if(sync.settingsUpdatedAt===at)sync.pendingSettings=false;
  }
}

async function doSync(full){
  syncError='';syncOffline=false;
  try{
    if(Native.Network&&!(await Native.Network.getStatus()).connected){syncOffline=true;return}
    renderSyncStatus();
    if(full){await pullAndMerge();lastFullAt=Date.now()}
    await flushPending();
    sync.lastSyncAt=Date.now();
  }catch(e){syncError=syncErrText(e);if(isNetErr(e))syncOffline=true}
  try{await saveSync()}catch(e){}
}
function syncSoon(full){
  if(!signedIn()||!sb)return Promise.resolve();
  if(full)wantFull=true;
  if(syncRunning){syncAgain=true;return syncRunning}
  syncRunning=(async()=>{
    do{syncAgain=false;const f=wantFull;wantFull=false;renderSyncStatus();await doSync(f)}while(syncAgain);
  })().finally(()=>{syncRunning=null;renderSyncStatus()});
  renderSyncStatus();
  return syncRunning;
}
function syncOnResume(){if(signedIn()&&(pendingCount()||Date.now()-lastFullAt>30000))syncSoon(true)}

/* ---------- account: sign up / sign in / out ---------- */
function authErrText(e){
  const c=String((e&&e.code)||''),m=String((e&&e.message)||e);
  if(c==='invalid_credentials'||/invalid login credentials/i.test(m))return 'Wrong email or password.';
  if(c==='email_not_confirmed'||/email not confirmed/i.test(m))return 'Check your email to confirm your account, then sign in.';
  if(c==='user_already_exists'||/already (registered|been registered|exists)/i.test(m))return 'An account with this email already exists. Try signing in.';
  if(c==='weak_password'||/password should|password is too/i.test(m))return 'That password is too weak. '+m;
  if(/rate.?limit|too many|security purposes/i.test(c+' '+m))return 'Too many attempts. Wait a few minutes and try again.';
  if(c==='signup_disabled')return 'New sign ups are turned off for this project.';
  if(c==='email_address_not_authorized'||/not authorized|not part of the project/i.test(m))return "Sign up emails can't be sent to this address yet because the app's email service isn't fully set up. Please contact the app owner.";
  if(c==='email_address_invalid'||/email address .* is invalid/i.test(m))return "That email address isn't accepted. Use a real address that can receive mail.";
  if(isNetErr(e))return 'No internet connection. Check your connection and try again.';
  return m;
}
async function doAuth(mode){
  const email=$('authEmail').value.trim(),pw=$('authPw').value;
  if(!/^\S+@\S+\.\S+$/.test(email)){setMsg('authMsg','Enter a valid email address.',true);return}
  if(pw.length<6){setMsg('authMsg','Password must be at least 6 characters.',true);return}
  ['authIn','authUp'].forEach(i=>{const e=$(i);if(e)e.disabled=true});setMsg('authMsg','Working…');
  try{
    let res;
    if(mode==='up'){
      res=await sb.auth.signUp({email,password:pw});
      if(res.error)throw res.error;
      if(res.data.user&&Array.isArray(res.data.user.identities)&&res.data.user.identities.length===0)throw {code:'user_already_exists',message:'User already registered'};
      if(!res.data.session){setMsg('authMsg','Check your email to confirm your account, then sign in.');return}
    }else{
      res=await sb.auth.signInWithPassword({email,password:pw});
      if(res.error)throw res.error;
    }
    closeAuth();
    await onSignedIn(res.data.session);
  }catch(e){setMsg('authMsg',authErrText(e),true)}
  finally{['authIn','authUp'].forEach(i=>{const e=$(i);if(e)e.disabled=false})} // the sheet may already be closed
}
async function onSignedIn(s){
  const uid=s.user.id;
  if(sync.userId&&sync.userId!==uid&&Object.keys(days).length){
    const pick=await askModal('Different account','The entries on this phone were synced with another account. Add them to this account too, or use only this account\'s data?',[{label:'Add this phone\'s entries to this account',value:'merge'},{label:'Use only this account\'s data',value:'replace',cls:'danger'},{label:'Cancel and sign out',value:'cancel'}]);
    if(pick!=='merge'&&pick!=='replace'){try{await sb.auth.signOut({scope:'local'})}catch(e){}sync.signedIn=false;renderAccount();return}
    if(pick==='replace'){days={};applySettingsInPlace(clone(DEFAULT_SETTINGS));sync.settingsUpdatedAt=0;try{await store.persist()}catch(e){setMsg('acctMsg',"Couldn't clear the old entries: "+errText(e),true);return}refreshAfterCloudChange()}
  }
  if(sync.userId!==uid){sync.seen={};sync.lastSyncAt=null}   // what was synced with another account says nothing about this one
  Object.assign(sync,{signedIn:true,userId:uid,email:s.user.email||'',pendingDays:[],pendingSettings:false});
  session=s;await saveSync();
  renderAccount();setMsg('acctMsg','');
  syncSoon(true);
}
async function signOut(){
  try{await sb.auth.signOut({scope:'local'})}catch(e){}
  Object.assign(sync,{signedIn:false,email:''});session=null;
  try{await saveSync()}catch(e){}
  renderAccount();setMsg('acctMsg','Signed out. Your entries stay on this phone.');
}

async function initSync(){
  renderAccount();
  if(!cloudConfigured())return;
  sb=Native.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_PUBLISHABLE_KEY,{auth:{storage:authStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  sb.auth.onAuthStateChange((ev,s)=>{
    session=s;
    if(ev==='SIGNED_OUT'&&sync.signedIn){sync.signedIn=false;renderAccount()} // token revoked or removed elsewhere
  });
  try{
    const {data,error}=await sb.auth.getSession();
    if(data.session){session=data.session;if(!sync.signedIn||sync.userId!==data.session.user.id){sync.signedIn=true;sync.userId=data.session.user.id;sync.email=data.session.user.email||'';await saveSync()}}
    else if(!error&&sync.signedIn){sync.signedIn=false;await saveSync()} // no stored session any more
    // a network error while refreshing keeps us "signed in" and retries when back online
  }catch(e){}
  renderAccount();
  syncSoon(true);
}

/* ---------- native glue: status bar, back button, notification tap, resume ---------- */
function syncBars(){
  if(!IS_NATIVE||!Native.StatusBar)return;
  try{
    const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#F2F2F7';
    const dark=window.matchMedia('(prefers-color-scheme: dark)').matches;
    Native.StatusBar.setStyle({style:dark?'DARK':'LIGHT'}).catch(()=>{});
    Native.StatusBar.setBackgroundColor({color:bg}).catch(()=>{});
  }catch(e){}
}

/* ---------- wiring for the buttons that call the logic above ---------- */
function bindLogic(){
  $('expJson').addEventListener('click',e=>runExport(e.currentTarget,()=>exportFile('comeback-backup-'+todayStr()+'.json',JSON.stringify(buildData(),null,2),'application/json','Comeback backup')));
  $('expCsv').addEventListener('click',e=>runExport(e.currentTarget,()=>exportFile('comeback-'+todayStr()+'.csv',buildCsv(),'text/csv','Comeback spreadsheet')));
  $('restoreBtn').addEventListener('click',()=>$('restoreFile').click());
  $('restoreFile').addEventListener('change',async e=>{
    const f=e.target.files&&e.target.files[0];
    if(f)await restoreFromFile(f);
    e.target.value='';
  });
  $('remOn').addEventListener('change',e=>setReminder(e.target.checked));
  $('remTime').addEventListener('change',onRemTimeChange);
  $('syncNowBtn').addEventListener('click',()=>syncSoon(true));
}
