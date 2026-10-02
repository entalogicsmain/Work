/* Data, storage, backup, reminder and cloud-sync logic. No layout code lives here: the UI hooks it calls
   (setMsg, askModal, refreshAll, renderAccount, ...) are defined in ui.js. */
const DEFAULT_SETTINGS={
  habits:[
    {id:'steps',name:'Steps',unit:'steps',target:8000},
    {id:'walk',name:'Brisk walk',unit:'min',target:30},
    {id:'pushups',name:'Pushups',unit:'reps',target:30},
    {id:'pullups',name:'Pull-ups',unit:'reps',target:5},
    {id:'squats',name:'Squats',unit:'reps',target:30},
    {id:'plank',name:'Plank',unit:'sec',target:60},
    {id:'water',name:'Water',unit:'litres',target:2.5},
    {id:'sleep',name:'Sleep',unit:'hours',target:7}
  ],
  rules:[
    {id:'nofried',name:'No fried food (zinger, fries, samosa)'},
    {id:'nosugar',name:'No cold drinks, juice or sugar in tea'},
    {id:'nomaida',name:'No maida (buns, naan, bakery)'},
    {id:'nolate',name:'Nothing eaten after 10 pm'}
  ]
};
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

function scoreOf(d){
  if(!d)return null;
  const parts=[];
  settings.habits.forEach(h=>{const v=Number((d.vals||{})[h.id]||0);parts.push(h.target>0?Math.min(v/h.target,1):0)});
  settings.rules.forEach(r=>parts.push((d.rules||{})[r.id]?1:0));
  if(!parts.length)return 0;
  return Math.round(parts.reduce((a,b)=>a+b,0)/parts.length*100);
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
   { version:1, settings:{habits:[...],rules:[...]}, days:{ "YYYY-MM-DD":{vals,rules,weight,waist,note,date,updatedAt} } } */
const DATA_KEY='comeback', META_KEY='comeback_meta', MIGRATED_KEY='comeback_migrated';
const buildData=()=>({version:1,settings,days});
const ID_RE=/^[A-Za-z0-9_-]{1,64}$/, DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const num=v=>typeof v==='number'&&isFinite(v);

function validDateKey(k){if(!DATE_RE.test(k))return false;const d=parse(k);return ymd(d)===k}

function normalizeSettings(s){
  if(!s||typeof s!=='object'||!Array.isArray(s.habits)||!Array.isArray(s.rules))throw new Error('The backup is missing its settings (habits and rules).');
  const seen=new Set();
  const habits=s.habits.map((h,i)=>{
    if(!h||typeof h.id!=='string'||!ID_RE.test(h.id)||typeof h.name!=='string'||!h.name.trim())throw new Error('Habit #'+(i+1)+' in the backup is not valid.');
    if(!num(h.target)||h.target<=0)throw new Error('Habit "'+h.name.slice(0,40)+'" has an invalid target.');
    return{id:h.id,name:h.name,unit:typeof h.unit==='string'&&h.unit?h.unit:'times',target:h.target};
  }).filter(h=>!seen.has(h.id)&&seen.add(h.id));
  const seenR=new Set();
  const rules=s.rules.map((r,i)=>{
    if(!r||typeof r.id!=='string'||!ID_RE.test(r.id)||typeof r.name!=='string'||!r.name.trim())throw new Error('Rule #'+(i+1)+' in the backup is not valid.');
    return{id:r.id,name:r.name};
  }).filter(r=>!seenR.has(r.id)&&seenR.add(r.id));
  return{habits,rules};
}
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
  return out;
}
/* Throws an Error with a readable message when the object is not a Comeback backup. */
function normalizeData(obj){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error("This isn't a Comeback backup (expected a JSON object).");
  if(obj.version!=null&&obj.version!==1)throw new Error(typeof obj.version==='number'&&obj.version>1?'This backup was made by a newer version of Comeback (version '+obj.version+'). Update the app first.':'Unknown backup version: '+esc(String(obj.version)).slice(0,20)+'.');
  const settings=normalizeSettings(obj.settings);
  if(!obj.days||typeof obj.days!=='object'||Array.isArray(obj.days))throw new Error("The backup is missing its 'days' section.");
  const outDays={};
  Object.keys(obj.days).forEach(k=>{outDays[k]=normalizeDay(k,obj.days[k])});
  return{version:1,settings,days:outDays};
}

function mergeData(local,inc){
  const outDays=Object.assign({},local.days);let added=0,updated=0,kept=0;
  Object.keys(inc.days).forEach(k=>{
    const cur=outDays[k],d=inc.days[k];
    if(!cur){outDays[k]=d;added++}
    else if((d.updatedAt||0)>(cur.updatedAt||0)){outDays[k]=d;updated++}
    else kept++;
  });
  const hs=local.settings.habits.slice(),rs=local.settings.rules.slice();
  inc.settings.habits.forEach(h=>{if(!hs.some(x=>x.id===h.id))hs.push(h)});
  inc.settings.rules.forEach(r=>{if(!rs.some(x=>x.id===r.id))rs.push(r)});
  return{data:{version:1,settings:{habits:hs,rules:rs},days:outDays},added,updated,kept};
}

/* ---------- storage (Capacitor Preferences) ---------- */
let meta={lastBackup:null,reminder:{enabled:false,time:'21:00'},steps:{source:'manual',heightCm:180,strictness:'balanced',sensitivity:'normal',useLocation:false,enabledAt:null,setupFailed:false}};
let loadProblem='';
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

store={
  queue:Promise.resolve(),
  persist(){
    const json=JSON.stringify(buildData());
    const p=this.queue.then(()=>prefSet(DATA_KEY,json));
    this.queue=p.catch(()=>{});
    return p;
  },
  async load(){
    await migrateLegacyKeys();
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
    try{const m=await prefGet(META_KEY);if(m){const mm=JSON.parse(m);meta.lastBackup=num(mm.lastBackup)?mm.lastBackup:null;if(mm.steps&&typeof mm.steps==='object'){const st=mm.steps;meta.steps={source:st.source==='auto'?'auto':'manual',heightCm:num(st.heightCm)&&st.heightCm>=100&&st.heightCm<=230?st.heightCm:180,strictness:['relaxed','balanced','strict'].includes(st.strictness)?st.strictness:'balanced',sensitivity:['low','normal','high'].includes(st.sensitivity)?st.sensitivity:'normal',useLocation:!!st.useLocation,enabledAt:num(st.enabledAt)?st.enabledAt:null,setupFailed:!!st.setupFailed}}if(mm.reminder&&typeof mm.reminder==='object')meta.reminder={enabled:!!mm.reminder.enabled,time:/^\d{2}:\d{2}$/.test(mm.reminder.time)?mm.reminder.time:'21:00'}}}catch(e){}
    try{const sv=await prefGet(SYNC_KEY);if(sv){const ss=JSON.parse(sv);sync.signedIn=!!ss.signedIn;sync.userId=typeof ss.userId==='string'?ss.userId:null;sync.email=typeof ss.email==='string'?ss.email:'';sync.lastSyncAt=num(ss.lastSyncAt)?ss.lastSyncAt:null;sync.settingsUpdatedAt=num(ss.settingsUpdatedAt)?ss.settingsUpdatedAt:0;sync.pendingDays=Array.isArray(ss.pendingDays)?ss.pendingDays.filter(k=>typeof k==='string'):[];sync.pendingSettings=!!ss.pendingSettings}}catch(e){}
    if(raw==null)return{migrated};
    try{
      const norm=normalizeData(JSON.parse(raw));
      return{data:norm,migrated};
    }catch(e){
      // keep the unreadable copy instead of overwriting it with an empty one
      try{await prefSet('comeback_unreadable_'+Date.now(),raw)}catch(e2){}
      loadProblem="Your saved data couldn't be read ("+errText(e)+"). A copy was kept. Use Restore from backup to bring your entries back.";
      return{migrated};
    }
  },
  async saveMeta(){await prefSet(META_KEY,JSON.stringify(meta))}
};

/* ---------- files: export, auto backup ---------- */
const DIR='Comeback';
const fmtWhen=t=>new Date(t).toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
function showLastBackup(){$('lastBackup').textContent='Last backup: '+(meta.lastBackup?fmtWhen(meta.lastBackup):'never')}
async function markBackup(){meta.lastBackup=Date.now();showLastBackup();try{await store.saveMeta()}catch(e){}}

const FS=()=>Native.Filesystem;
async function writeDocs(name,text){
  return FS().writeFile({path:DIR+'/'+name,data:text,directory:Native.Directory.Documents,encoding:Native.Encoding.UTF8,recursive:true});
}

let autoQueue=Promise.resolve(),autoErrText='';
function autoFail(text){autoErrText=text;setMsg('bkMsg',text,true)}
function autoBackup(){
  if(!IS_NATIVE)return Promise.resolve();
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
function stepsSourceOf(d){return d.steps_meta?(d.steps_meta.source==='auto'?'counted':'manual'):(d.vals&&d.vals.steps!=null?'manual':'')}
function buildCsv(){
  const head=['Date','Score %'].concat(settings.habits.map(h=>h.name+' ('+h.unit+')'),settings.rules.map(r=>r.name),['Steps source','Distance (km)','Filtered steps','Weight (kg)','Waist (cm)','Note']);
  const rows=Object.keys(days).sort().map(k=>{
    const d=days[k];
    return [k,scoreOf(d)].concat(
      settings.habits.map(h=>d.vals&&d.vals[h.id]!=null?d.vals[h.id]:''),
      settings.rules.map(r=>d.rules&&d.rules[r.id]?'yes':'no'),
      [stepsSourceOf(d),d.steps_meta?d.steps_meta.distance_km:'',d.steps_meta?d.steps_meta.filtered:'',d.weight==null?'':d.weight,d.waist==null?'':d.waist,d.note||'']);
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
    inc=normalizeData(obj);
  }catch(e){setMsg('bkMsg',"Couldn't restore: "+errText(e),true);return}
  const n=Object.keys(inc.days).length;
  const body=(file.name||'This file')+' has '+n+' logged '+(n===1?'day':'days')+(n?' ('+range(Object.keys(inc.days))+')':'')+', '+inc.settings.habits.length+(inc.settings.habits.length===1?' item':' items')+' and '+inc.settings.rules.length+(inc.settings.rules.length===1?' rule':' rules')+'. This phone has '+Object.keys(days).length+' logged days.';
  if(await askModal('Restore this backup?',body,[{label:'Continue',value:'go'},{label:'Cancel',value:'cancel'}])!=='go')return;
  const mode=await askModal('How should it be restored?','Merge keeps what is on this phone and adds the backup. If a day is in both, the newer save wins. Replace everything deletes what is on this phone and uses only the backup.'+(signedIn()?' The restored data is also sent to your cloud copy; days that exist only in the cloud will come back on the next sync.':''),[{label:'Merge',value:'merge'},{label:'Replace everything',value:'replace',cls:'danger'},{label:'Cancel',value:'cancel'}]);
  if(mode!=='merge'&&mode!=='replace')return;
  let warn='';
  if(IS_NATIVE){try{await writeDocs('comeback-before-restore.json',JSON.stringify(buildData(),null,2))}catch(e){warn=" Couldn't save a safety copy of your old data first ("+errText(e)+")."}}
  const before=buildData();let summary;
  try{
    let next;
    if(mode==='replace'){next=inc;summary='Replaced everything with the backup: '+n+(n===1?' day.':' days.')}
    else{const m=mergeData(before,inc);next=m.data;summary='Merged: '+m.added+' new, '+m.updated+' updated, '+m.kept+' kept as they were.'}
    settings=next.settings;days=next.days;
    await store.persist();
  }catch(e){settings=before.settings;days=before.days;setMsg('bkMsg',"Couldn't restore: "+errText(e)+' Nothing was changed.',true);return}
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
const fmtTime=t=>{const [h,m]=t.split(':').map(Number);return new Date(2000,0,1,h,m).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})};
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
let sync={signedIn:false,userId:null,email:'',lastSyncAt:null,settingsUpdatedAt:0,pendingDays:[],pendingSettings:false};
let syncRunning=null,syncAgain=false,wantFull=false,syncError='',syncOffline=false,lastFullAt=0;
const cloudConfigured=()=>!!(CFG.SUPABASE_URL&&CFG.SUPABASE_PUBLISHABLE_KEY&&Native.createClient);
const signedIn=()=>cloudConfigured()&&sync.signedIn;
const saveSync=()=>prefSet(SYNC_KEY,JSON.stringify(sync));
const pendingCount=()=>sync.pendingDays.length+(sync.pendingSettings?1:0);
const isDefaultSettings=()=>JSON.stringify(settings)===JSON.stringify(DEFAULT_SETTINGS);
const dayData=d=>{const o={vals:d.vals||{},rules:d.rules||{},weight:d.weight==null?null:d.weight,waist:d.waist==null?null:d.waist,note:d.note||''};if(d.steps_meta)o.steps_meta=d.steps_meta;return o};
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
function markSettingsDirty(){sync.settingsUpdatedAt=Date.now();if(signedIn())sync.pendingSettings=true;saveSync().catch(()=>{})}

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
  let changed=false,skipped=0;
  const cloud={};
  rows.forEach(r=>{cloud[r.log_date]=Date.parse(r.updated_at)});
  rows.forEach(r=>{
    const ts=Date.parse(r.updated_at),local=days[r.log_date];
    if(!local||ts>(local.updatedAt||0)){
      try{days[r.log_date]=normalizeDay(r.log_date,Object.assign({},r.data,{updatedAt:ts}));changed=true}catch(e){skipped++}
    }
  });
  // first sign in with customised local settings: they count as newer than an untouched cloud copy
  if(!sync.settingsUpdatedAt&&!isDefaultSettings())sync.settingsUpdatedAt=Date.now();
  const cts=srow?Date.parse(srow.updated_at):null;
  if(srow&&cts>sync.settingsUpdatedAt){
    try{settings=normalizeSettings(srow.data);sync.settingsUpdatedAt=cts;sync.pendingSettings=false;changed=true}catch(e){skipped++}
  }else if(!srow||sync.settingsUpdatedAt>cts)sync.pendingSettings=true;
  else sync.pendingSettings=false;
  // everything the cloud lacks or has an older copy of still has to go up
  sync.pendingDays=Object.keys(days).filter(k=>cloud[k]==null||(days[k].updatedAt||0)>cloud[k]);
  if(changed){await store.persist();refreshAfterCloudChange()}
  if(skipped)throw new Error(skipped+' cloud '+(skipped===1?'row was':'rows were')+' skipped because it could not be read.');
}

async function flushPending(){
  const uid=sync.userId;
  const sent=sync.pendingDays.filter(k=>days[k]).map(k=>({k,at:days[k].updatedAt||0}));
  for(let i=0;i<sent.length;i+=200){
    const chunk=sent.slice(i,i+200);
    const {error}=await sb.from('day_logs').upsert(chunk.map(x=>({user_id:uid,log_date:x.k,data:dayData(days[x.k]),updated_at:new Date(x.at).toISOString()})),{onConflict:'user_id,log_date'});
    if(error)throw error;
    chunk.forEach(x=>{if(days[x.k]&&(days[x.k].updatedAt||0)===x.at)sync.pendingDays=sync.pendingDays.filter(d=>d!==x.k)});
    await saveSync();
  }
  sync.pendingDays=sync.pendingDays.filter(k=>days[k]);
  if(sync.pendingSettings){
    const at=sync.settingsUpdatedAt;
    const {error}=await sb.from('user_settings').upsert({user_id:uid,data:settings,updated_at:new Date(at).toISOString()},{onConflict:'user_id'});
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
    if(pick==='replace'){days={};settings=clone(DEFAULT_SETTINGS);sync.settingsUpdatedAt=0;try{await store.persist()}catch(e){setMsg('acctMsg',"Couldn't clear the old entries: "+errText(e),true);return}refreshAfterCloudChange()}
  }
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
