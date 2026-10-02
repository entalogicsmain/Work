/* Automatic step counting (phone motion sensor) on the web side.
   The native plugin ("Steps") counts all day and keeps per-day totals. This file:
   - sets Automatic up (explanation, permission, battery help, height),
   - merges the counted totals into the day records without ever overwriting a manual edit,
   - shows the "Step tracking" section in Plan and the health status.
   Device settings live in meta.steps (this phone only: not in backups, not synced). */

const stepsPlugin=()=>IS_NATIVE&&Native.Steps?Native.Steps:null;
const stepsAvailable=()=>!!stepsPlugin();
const stepsAuto=()=>stepsAvailable()&&meta.steps.source==='auto';
const stepsHabit=()=>settings.habits.find(h=>h.id==='steps');
const strideCm=()=>meta.steps.heightCm*0.415;
const kmFor=n=>Math.round(n*strideCm()/100000*100)/100;
const fmtKm=k=>(Math.round(k*10)/10).toLocaleString(undefined,{maximumFractionDigits:1})+'\u00A0km'; // non-breaking so "4 km" never splits across lines
const stepsEnabledDay=()=>meta.steps.enabledAt?ymd(new Date(meta.steps.enabledAt)):null;
const dayInAutoRange=k=>stepsAuto()&&!!stepsEnabledDay()&&k>=stepsEnabledDay();
const newStepsMeta=()=>({source:'auto',counted:0,distance_km:0,filtered:0,hourly:new Array(24).fill(0)});
const blankDayFor=k=>({vals:{},rules:{},weight:null,waist:null,note:'',date:k,updatedAt:0});
let stepStatus=null;      // last Steps.getStatus()
let stepHealthKey='off';
const saveStepMeta=()=>store.saveMeta();

/* ---------- editing steps by hand (override) ---------- */
/** Used for every manual change to the Steps value. d is the cloned day inside commitDay. */
function setStepsValue(d,v){
  if(v==null)delete d.vals.steps;else d.vals.steps=v;
  if(d.steps_meta){d.steps_meta.source='manual';d.steps_meta.distance_km=kmFor(v||0)}
  else if(dayInAutoRange(d.date||current)){const m=newStepsMeta();m.source='manual';m.distance_km=kmFor(v||0);d.steps_meta=m}
}
function useCountedSteps(d){
  const m=d.steps_meta;if(!m)return;
  d.vals.steps=m.counted;m.source='auto';m.distance_km=kmFor(m.counted);
}
function setHabitValue(d,x,v){if(x.id==='steps')setStepsValue(d,v);else if(v==null)delete d.vals[x.id];else d.vals[x.id]=v}
/** Text for the small label on the Steps card, or '' when the day is not counted by the phone. */
function stepsLabelFor(k){
  const d=days[k];
  if(d&&d.steps_meta)return d.steps_meta.source==='auto'?'counted':'manual';
  return dayInAutoRange(k)?'counted':'';
}

/* ---------- merge what the phone counted into the days ---------- */
const normHourly=h=>{const a=new Array(24).fill(0);if(Array.isArray(h))for(let i=0;i<24;i++)a[i]=Math.max(0,Math.round(Number(h[i])||0));return a};
function applyNativeDays(res){
  if(!stepsAuto()||!res||!res.days||!stepsHabit())return false;
  const from=stepsEnabledDay()||'0000-00-00';
  const changed=[];
  Object.keys(res.days).forEach(k=>{
    if(k<from||!validDateKey(k))return;
    const info=res.days[k]||{};
    const steps=Math.max(0,Math.round(Number(info.steps)||0)),filtered=Math.max(0,Math.round(Number(info.filtered)||0));
    const d=days[k];
    if(!d&&steps<=0&&filtered<=0)return;
    const before=d?JSON.stringify([d.vals&&d.vals.steps,d.steps_meta]):'';
    const nd=d?clone(d):blankDayFor(k);
    let m=nd.steps_meta;
    if(!m){
      m=newStepsMeta();
      // a number typed in by hand before counting started stays: never overwrite a manual day
      if(nd.vals.steps!=null&&nd.vals.steps>0&&nd.vals.steps!==steps)m.source='manual';
    }
    m.counted=steps;m.filtered=filtered;m.hourly=normHourly(info.hourly);
    if(m.source==='auto'&&(steps>0||nd.vals.steps!=null))nd.vals.steps=steps;
    m.distance_km=kmFor(nd.vals.steps||0);
    nd.steps_meta=m;
    if(JSON.stringify([nd.vals.steps,nd.steps_meta])!==before){nd.updatedAt=Date.now();days[k]=nd;changed.push(k)}
  });
  if(changed.length){autoPersist(changed);return true}
  return false;
}

/* ---------- saving and syncing automatic updates (gently) ---------- */
const AUTO_SYNC_MS=15*60*1000,AUTO_BACKUP_MS=15*60*1000;
let autoSaveTimer=null,lastAutoSync=0,lastAutoBackup=0,autoSyncTimer=null;
const autoPendingKeys=new Set();
function autoPersist(keys){keys.forEach(k=>autoPendingKeys.add(k));clearTimeout(autoSaveTimer);autoSaveTimer=setTimeout(flushAuto,800)}
async function flushAuto(){
  const keys=[...autoPendingKeys];autoPendingKeys.clear();
  if(!keys.length)return;
  try{
    await store.persist();
    keys.forEach(markDayDirty);
    if(Date.now()-lastAutoBackup>=AUTO_BACKUP_MS){lastAutoBackup=Date.now();autoBackup()}
    autoSyncKick();
  }catch(e){keys.forEach(k=>autoPendingKeys.add(k));setTimeout(flushAuto,5000)}
}
/** Automatic updates reach the cloud at most once every 15 minutes (queued changes wait their turn). */
function autoSyncKick(){
  const wait=Math.max(0,lastAutoSync+AUTO_SYNC_MS-Date.now());
  if(wait===0){lastAutoSync=Date.now();syncSoon(false)}
  else if(!autoSyncTimer)autoSyncTimer=setTimeout(()=>{autoSyncTimer=null;lastAutoSync=Date.now();syncSoon(false)},wait);
}

/* ---------- reading the plugin ---------- */
let stepsLoop=null,lastStepsRefresh=0;
async function refreshSteps(){
  if(!stepsAuto())return;
  lastStepsRefresh=Date.now();
  try{
    const res=await stepsPlugin().getDays();
    stepHealthKey=res.health||stepHealthKey;
    if(applyNativeDays(res))refreshAfterStepsChange();
    renderStepGroup(false);
  }catch(e){}
}
function refreshAfterStepsChange(){renderToday(true);if(activeTab==='progress')renderProgress();if(activeTab==='setup')renderStepGroup(false)}
function startStepsLoop(){
  stopStepsLoop();
  if(!stepsAuto())return;
  stepsLoop=setInterval(()=>{if(!document.hidden)refreshSteps()},60_000);
}
function stopStepsLoop(){if(stepsLoop){clearInterval(stepsLoop);stepsLoop=null}}
function stepsOnForeground(){if(stepsAuto())refreshSteps()}

async function configureSteps(extra){
  const s=meta.steps;
  return stepsPlugin().configure(Object.assign({enabled:s.source==='auto',heightCm:s.heightCm,strictness:s.strictness,sensitivity:s.sensitivity,useLocation:s.useLocation},extra||{}));
}
async function initSteps(){
  if(!stepsAvailable())return;
  try{stepsPlugin().addListener('stepsChanged',ev=>{if(stepsAuto()){stepHealthKey=ev.health||stepHealthKey;if(applyNativeDays(ev))refreshAfterStepsChange();renderStepGroup(false)}})}catch(e){}
  try{stepStatus=await stepsPlugin().getStatus()}catch(e){}
  if(stepsAuto()){
    try{await configureSteps();stepStatus=await stepsPlugin().getStatus();stepHealthKey=stepStatus.health}catch(e){}
    startStepsLoop();
    await refreshSteps();
  }
  renderStepGroup(false);
}

/* ---------- setup flow ---------- */
const BRANDS={
  xiaomi:{name:'Xiaomi / Redmi / POCO',tips:['Open Settings > Apps > Manage apps > Reset Log.','Turn on Autostart.','Set Battery saver to "No restrictions".']},
  oppo:{name:'Oppo / Realme / OnePlus',tips:['Open Settings > Battery > Reset Log (or App battery management).','Allow background activity and auto-launch.','Turn off "Optimize battery use".']},
  vivo:{name:'Vivo / iQOO',tips:['Open Settings > Battery > Background power consumption.','Find Reset Log and allow high background power use.','Turn on Autostart in the phone manager.']},
  samsung:{name:'Samsung',tips:['Open Settings > Battery > Background usage limits.','Remove Reset Log from "Sleeping apps" and "Deep sleeping apps".','Set Reset Log to "Unrestricted" battery use.']},
  huawei:{name:'Huawei / Honor',tips:['Open Settings > Apps > App launch > Reset Log.','Turn off "Manage automatically".','Turn on Auto-launch, Secondary launch and Run in background.']},
  transsion:{name:'Infinix / Tecno / itel',tips:['Open Phone Master (or Settings) > App management > Autostart.','Allow Reset Log to autostart.','Set battery use for Reset Log to "No restrictions".']},
  other:{name:'Your phone',tips:['Open Settings > Apps > Reset Log > Battery.','Choose "Unrestricted" (or "Don\'t optimize").','If your phone has an Autostart or Background apps list, allow Reset Log there.']}
};

/** Small sheet with text and one or two buttons. Resolves 'primary' | 'secondary' | 'cancel'. */
function infoSheet(o){
  return new Promise(res=>{
    const root=h('<div></div>');
    if(o.icon){const a=h('<div class="onb-art" style="margin:var(--s2) 0 var(--s4)"></div>');a.innerHTML=icon(o.icon);root.appendChild(a)}
    (o.paragraphs||[o.body]).forEach(t=>{const p=h('<p class="info" style="margin:0 var(--s1) var(--s3)"></p>');p.textContent=t;root.appendChild(p)});
    if(o.list){const g=h('<div class="group" style="margin:0 0 var(--s3)"></div>');o.list.forEach(t=>{const r=h('<div class="row"><span class="row-label" style="font-size:.9375rem"></span></div>');r.querySelector('.row-label').textContent=t;g.appendChild(r)});root.appendChild(g)}
    const acts=h('<div class="sheet-actions"></div>');root.appendChild(acts);
    let done=false;
    const sheet=openSheet({title:o.title,left:'Cancel',right:null,content:root,onCancel:()=>{if(!done){done=true;res('cancel')}}});
    const mk=(label,val,cls)=>{const b=h('<button class="btn'+(cls?' '+cls:'')+'"></button>');b.textContent=label;b.addEventListener('click',()=>{if(done)return;done=true;res(val);sheet.close('cancel')});acts.appendChild(b);return b};
    if(o.primary)mk(o.primary,'primary');
    if(o.secondary)mk(o.secondary,'secondary','secondary');
    if(o.tertiary)mk(o.tertiary,'tertiary','secondary');
  });
}

async function askStepPermission(){
  const P=stepsPlugin();
  const r=await P.requestActivityPermission();
  // Android 13+: the quiet "Counting steps" notification needs this; counting works without it
  try{if(Native.LocalNotifications){const p=await Native.LocalNotifications.checkPermissions();if(p.display!=='granted')await Native.LocalNotifications.requestPermissions()}}catch(e){}
  if(r.granted){meta.steps.setupFailed=false;return true}
  meta.steps.setupFailed=true;await saveStepMeta();renderStepGroup(false);
  const c=await infoSheet({title:'Permission needed',icon:'shield-check',paragraphs:['Reset Log needs the "Physical activity" permission to read your phone\'s step sensor. Without it, steps stay on Manual.','You can try again, or allow it in Android settings.'],primary:'Try again',secondary:'Open app settings'});
  if(c==='primary')return askStepPermission();
  if(c==='secondary'){try{await P.openSettings({target:'app'})}catch(e){}}
  return false;
}

async function batterySetup(){
  const P=stepsPlugin();
  let info={brand:'other',batteryIgnored:false};
  try{info=await P.getDeviceInfo()}catch(e){}
  const b=BRANDS[info.brand]||BRANDS.other;
  let ignored=!!info.batteryIgnored;
  for(;;){
    const c=await infoSheet({title:'Keep counting all day',icon:'battery-low',
      paragraphs:['Many phones close background apps to save battery. Let Reset Log keep running so your steps are counted all day.'+(ignored?' Battery optimisation is already off for Reset Log.':'')],
      list:b.tips.map((t,i)=>(i+1)+'. '+t),
      primary:ignored?'Continue':'Allow background activity',secondary:info.brand==='other'?'Open battery settings':'Open '+b.name.split(' / ')[0]+' settings',tertiary:ignored?undefined:'Skip for now'});
    if(c==='primary'&&!ignored){try{await P.requestIgnoreBatteryOptimizations()}catch(e){}try{ignored=!!(await P.getDeviceInfo()).batteryIgnored}catch(e){}continue}
    if(c==='primary')return;
    if(c==='secondary'){try{await P.openSettings({target:info.brand==='other'?'battery':'autostart'})}catch(e){}continue}
    return; // skip / cancel
  }
}

function askHeight(){
  return new Promise(res=>{
    let ok=false;
    numberSheet({title:'Your height',value:meta.steps.heightCm,unitLine:'cm · used to estimate distance',step:1,min:0,
      validate:v=>v==null||v<100||v>230?'Enter a height between 100 and 230 cm':'',
      onDone:v=>{ok=true;res(v)},onCancel:()=>{if(!ok)res(null)}});
  });
}

async function startAutoSetup(){
  const P=stepsPlugin();if(!P)return;
  try{
    const go=await infoSheet({title:'Count steps automatically',icon:'footprints',
      paragraphs:["Reset Log counts your steps using your phone's motion sensor. Nothing is shared with other apps.",'Counting starts from the moment you turn this on. Earlier days stay as they are, and you can still change any day by hand.'],primary:'Continue'});
    if(go!=='primary')return;
    if(!(await askStepPermission()))return;
    await batterySetup();
    const hgt=await askHeight();
    if(hgt==null)return;
    meta.steps=Object.assign({},meta.steps,{source:'auto',heightCm:hgt,enabledAt:Date.now(),setupFailed:false});
    await saveStepMeta();
    stepStatus=await configureSteps();
    stepHealthKey=stepStatus.health||'working';
    startStepsLoop();
    refreshAll();renderStepGroup(false);
    toast('Counting steps from now',{icon:'footprints'});
    setTimeout(refreshSteps,1500);
  }catch(e){
    meta.steps.source='manual';try{await saveStepMeta()}catch(x){}
    renderStepGroup(false);
    setMsg('stMsg',"Couldn't turn on automatic steps: "+errText(e)+'. Steps stay on Manual.',true);
  }
}

async function switchStepsToManual(){
  try{await stepsPlugin().configure({enabled:false})}catch(e){}
  meta.steps.source='manual';await saveStepMeta();stopStepsLoop();
  refreshAll();renderStepGroup(false);
  toast('Steps are manual again',{icon:'pencil'});
}

async function chooseStepSource(){
  const r=await actionSheet({title:'Steps source',message:'Automatic counts with your phone\'s motion sensor. Manual works as before: you type the number.',
    actions:[{label:'Automatic (phone sensor)'+(meta.steps.source==='auto'?'  ✓':''),value:'auto'},{label:'Manual'+(meta.steps.source==='manual'?'  ✓':''),value:'manual'}]});
  if(r==='auto'&&meta.steps.source!=='auto')startAutoSetup();
  else if(r==='manual'&&meta.steps.source==='auto')switchStepsToManual();
}

/* ---------- Plan: Step tracking section ---------- */
const HEALTH_TEXT={working:'Working',paused_battery:'Paused by battery settings',permission_missing:'Permission missing',paused_vehicle:'Steps paused while in vehicle'};
const HEALTH_ICON={working:['circle-check','green'],paused_battery:['battery-low','orange'],permission_missing:['triangle-alert','red'],paused_vehicle:['car','']};
const STRICT_NAME={relaxed:'Relaxed',balanced:'Balanced',strict:'Strict'};
const SENS_NAME={low:'Low',normal:'Normal',high:'High'};

function stepRow(o){
  const r=h(o.static?'<div class="row"></div>':'<button class="row"></button>');
  r.innerHTML='<span class="row-ic'+(o.tint?' '+o.tint:'')+'"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="row-val"></span>'+(o.chev?'<svg data-ic="chevron-right" class="chev"></svg>':'');
  r.querySelector('.row-ic').innerHTML=icon(o.icon);
  r.querySelector('.row-label').textContent=o.label;
  const sub=r.querySelector('.row-sub');if(o.sub)sub.textContent=o.sub;else sub.remove();
  const val=r.querySelector('.row-val');if(o.val!=null)val.textContent=o.val;else val.remove();
  if(o.id)r.id=o.id;
  if(o.onTap)r.addEventListener('click',o.onTap);
  hydrate(r);return r;
}

async function fixStepHealth(){
  const k=stepHealthKey;
  if(k==='permission_missing'){
    try{if(await askStepPermission()){stepStatus=await stepsPlugin().configure({});stepHealthKey=stepStatus.health;renderStepGroup(false);setTimeout(refreshSteps,1000)}}catch(e){}
  }else if(k==='paused_battery'){
    await batterySetup();setTimeout(async()=>{try{stepStatus=await stepsPlugin().getStatus();stepHealthKey=stepStatus.health;renderStepGroup(false)}catch(e){}},500);
  }
}

function renderStepGroup(fetchStatus){
  const head=$('stepHead'),g=$('stepGroup'),foot=$('stepFoot'),msg=$('stMsg');
  const show=stepsAvailable()&&!!stepsHabit();
  [head,g,foot,msg].forEach(e=>{if(e)e.hidden=!show});
  if(!show)return;
  if(fetchStatus!==false)stepsPlugin().getStatus().then(s=>{stepStatus=s;stepHealthKey=s.health||stepHealthKey;renderStepGroup(false)}).catch(()=>{});
  g.innerHTML='';
  const auto=stepsAuto();
  g.appendChild(stepRow({id:'stSource',icon:'footprints',label:'Source',val:auto?'Automatic':'Manual',chev:true,sub:auto?'Phone sensor':(meta.steps.setupFailed?'Needs permission. Tap to try again.':'You type the number'),onTap:chooseStepSource}));
  if(auto){
    g.appendChild(stepRow({id:'stHeight',icon:'user',label:'Height',val:meta.steps.heightCm+' cm',chev:true,sub:'Used to estimate distance',onTap:async()=>{
      const v=await askHeight();if(v==null)return;
      meta.steps.heightCm=v;await saveStepMeta();try{await configureSteps()}catch(e){}
      renderStepGroup(false);renderToday(true);if(activeTab==='progress')renderProgress();
    }}));
    g.appendChild(stepRow({id:'stStrict',icon:'shield-check',label:'Detection',val:STRICT_NAME[meta.steps.strictness],chev:true,sub:'How careful to be about false steps',onTap:async()=>{
      const r=await actionSheet({title:'Detection strictness',message:'Relaxed counts shorter walks but may count a few extra steps on bumpy rides. Strict needs a longer steady walk and filters more.',
        actions:['relaxed','balanced','strict'].map(k=>({label:STRICT_NAME[k]+(meta.steps.strictness===k?'  ✓':''),value:k}))});
      if(r==='cancel')return;
      meta.steps.strictness=r;await saveStepMeta();try{await configureSteps()}catch(e){}renderStepGroup(false);
    }}));
    if(stepStatus&&stepStatus.source==='accelerometer'){
      g.appendChild(stepRow({id:'stSens',icon:'activity',label:'Sensitivity',val:SENS_NAME[meta.steps.sensitivity],chev:true,sub:'This phone has no step counter chip, so steps come from the accelerometer',onTap:async()=>{
        const r=await actionSheet({title:'Sensitivity',message:'Higher counts gentler steps (phone in hand). Lower ignores light movement.',actions:['low','normal','high'].map(k=>({label:SENS_NAME[k]+(meta.steps.sensitivity===k?'  ✓':''),value:k}))});
        if(r==='cancel')return;
        meta.steps.sensitivity=r;await saveStepMeta();try{await configureSteps()}catch(e){}renderStepGroup(false);
      }}));
    }
    // location (optional speed check)
    const loc=h('<label class="row" id="stLoc"><span class="row-ic"></span><span class="row-body"><span class="row-label">Use location to improve accuracy in vehicles</span><span class="row-sub">Off by default. Speed above about 15 km/h for 30 seconds pauses counting.</span></span><input type="checkbox" class="switch" role="switch" id="stLocOn" aria-label="Use location to improve accuracy in vehicles"></label>');
    loc.querySelector('.row-ic').innerHTML=icon('map-pin');
    const box=loc.querySelector('input');box.checked=!!meta.steps.useLocation;
    box.addEventListener('change',()=>setStepLocation(box.checked,box));
    g.appendChild(loc);
    // health
    const hk=HEALTH_TEXT[stepHealthKey]?stepHealthKey:'working';
    const hi=HEALTH_ICON[hk];
    g.appendChild(stepRow({id:'stHealth',static:true,icon:hi[0],tint:hi[1],label:'Step tracking health',sub:HEALTH_TEXT[hk]}));
    if(hk==='permission_missing')g.appendChild(stepRow({id:'stFix',icon:'shield-check',label:'Allow permission',onTap:fixStepHealth}));
    if(hk==='paused_battery')g.appendChild(stepRow({id:'stFix',icon:'battery-low',label:'Fix battery settings',onTap:fixStepHealth}));
    const filt=(stepStatus&&stepStatus.filteredToday)!=null?stepStatus.filteredToday:((days[todayStr()]&&days[todayStr()].steps_meta&&days[todayStr()].steps_meta.filtered)||0);
    const todayMeta=days[todayStr()]&&days[todayStr()].steps_meta;
    g.appendChild(stepRow({id:'stFiltered',static:true,icon:'car',label:'Steps filtered out today',sub:'Vehicle vibration and short shuffles are not counted',val:String(todayMeta?todayMeta.filtered:filt)}));
  }
  foot.textContent=auto?'Steps are counted by your phone all day, even when the app is closed. Tap the Steps card on Today to change a day by hand.':'Switch to Automatic to count steps with your phone\'s motion sensor. Nothing is shared with other apps.';
}

async function setStepLocation(on,box){
  setMsg('stMsg','');
  try{
    if(on){
      const r=await stepsPlugin().requestLocationPermission();
      if(!r.granted){box.checked=false;setMsg('stMsg','Location permission was not allowed, so the speed check stays off.',true);return}
    }
    meta.steps.useLocation=on;await saveStepMeta();await configureSteps();
    setMsg('stMsg',on?'Speed check is on.':'Speed check is off.');
  }catch(e){box.checked=!on;setMsg('stMsg',"Couldn't change that: "+errText(e),true)}
}
