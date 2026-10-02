/* Step counting from the phone's own motion sensor. Steps cannot be typed in.
   The native plugin ("Steps") counts all day and keeps per-day totals. This file:
   - turns counting on (permissions are asked once, in the onboarding screen) and fixes problems later,
   - merges the counted totals into the day records (days entered by hand before steps became phone-only are kept),
   - shows the Steps card state, the read-only detail sheet and the "Step tracking" section in Plan.
   Device settings live in meta.steps (this phone only: not in backups, not synced). */

const stepsPlugin=()=>IS_NATIVE&&Native.Steps?Native.Steps:null;
const stepsAvailable=()=>!!stepsPlugin();
/** Counting has been switched on for this phone (the permission screen was completed, even if some answers were No). */
const stepsAuto=()=>stepsAvailable()&&meta.steps.enabledAt!=null;
const stepsHabit=()=>settings.habits.find(h=>h.type==='steps');
const strideCm=()=>stepHeightCm()*0.415;
const kmFor=n=>Math.round(n*strideCm()/100000*100)/100;
const fmtKm=k=>(Math.round(k*10)/10).toLocaleString(undefined,{maximumFractionDigits:1})+'\u00A0km'; // non-breaking so "4 km" never splits across lines
const stepsEnabledDay=()=>meta.steps.enabledAt?ymd(new Date(meta.steps.enabledAt)):null;
const newStepsMeta=()=>({source:'auto',counted:0,distance_km:0,filtered:0,hourly:new Array(24).fill(0)});
const blankDayFor=k=>({vals:{},rules:{},weight:null,waist:null,note:'',date:k,updatedAt:0});
let stepStatus=null;      // last Steps.getStatus()
let stepHealthKey='off';
const saveStepMeta=()=>store.saveMeta();
const withTimeout=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(()=>r(null),ms))]);

/** Where this day's steps came from: 'counted' (phone), 'manual' (typed in before steps became phone-only) or '' (nothing). */
function stepsLabelFor(k){
  const d=days[k];
  if(d&&d.steps_meta)return d.steps_meta.source==='auto'?'counted':'manual';
  if(d&&d.vals&&d.vals.steps>0)return 'manual';
  return stepsAuto()&&k===todayStr()?'counted':'';
}
const MANUAL_OLD='Entered manually (old)';

/** What the Steps card on Today should show for day k: 'turnon' (counting is off or lacks permission), 'phoneonly' (browser) or 'value'. */
function stepsCardKind(k){
  const d=days[k],has=d&&d.vals&&d.vals.steps>0;
  if(!stepsAvailable())return has?'value':'phoneonly';
  if(k===todayStr()&&(!stepsAuto()||stepHealthKey==='permission_missing'))return 'turnon';
  return 'value';
}

/* ---------- merge what the phone counted into the days ---------- */
const normHourly=h=>{const a=new Array(24).fill(0);if(Array.isArray(h))for(let i=0;i<24;i++)a[i]=Math.max(0,Math.round(Number(h[i])||0));return a};
function applyNativeDays(res){
  if(!stepsAuto()||!res||!res.days||!stepsHabit())return false;
  const from=stepsEnabledDay()||'0000-00-00',today=todayStr();
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
      // a number typed in before steps became phone-only stays on past days
      if(nd.vals.steps!=null&&nd.vals.steps>0&&nd.vals.steps!==steps&&k!==today)m.source='manual';
    }
    if(m.source==='manual'&&k===today)m.source='auto';   // today is still being counted: the phone's number takes over
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
let stepsLoop=null;
/** One read of today's numbers from the phone. Used by the 60 s foreground refresh and by pull-to-refresh. */
async function refreshSteps(){
  if(!stepsAuto())return false;
  try{
    const res=await stepsPlugin().getDays();
    stepHealthKey=res.health||stepHealthKey;
    const changed=applyNativeDays(res);
    refreshAfterStepsChange();
    renderStepGroup(false);
    return changed;
  }catch(e){return false}
}
function refreshAfterStepsChange(){renderToday(true);if(activeTab==='progress')renderProgress();if(activeTab==='setup')renderStepGroup(false)}
/* The page only polls while it is on screen. In the background the foreground service counts and the WebView is paused. */
function startStepsLoop(){
  stopStepsLoop();
  if(!stepsAuto()||document.hidden)return;
  stepsLoop=setInterval(()=>{if(!document.hidden)refreshSteps()},60_000);
}
function stopStepsLoop(){if(stepsLoop){clearInterval(stepsLoop);stepsLoop=null}}
function stepsOnForeground(){if(stepsAuto()){startStepsLoop();refreshSteps()}}
function stepsOnBackground(){stopStepsLoop();clearTimeout(autoSyncTimer);autoSyncTimer=null}
document.addEventListener('visibilitychange',()=>{if(document.hidden)stepsOnBackground();else if(stepsAuto())startStepsLoop()});

async function configureSteps(extra){
  const s=meta.steps;
  return stepsPlugin().configure(Object.assign({enabled:meta.steps.enabledAt!=null,heightCm:Math.round(stepHeightCm()),strictness:s.strictness,sensitivity:s.sensitivity,useLocation:s.useLocation},extra||{}));
}
async function initSteps(){
  if(!stepsAvailable())return;
  try{stepsPlugin().addListener('stepsChanged',ev=>{if(stepsAuto()&&!document.hidden){const prev=stepHealthKey;stepHealthKey=ev.health||stepHealthKey;if(applyNativeDays(ev))refreshAfterStepsChange();else if(stepHealthKey!==prev)renderToday(true);renderStepGroup(false)}})}catch(e){}
  try{stepStatus=await stepsPlugin().getStatus();stepHealthKey=stepStatus.health||stepHealthKey}catch(e){}
  if(stepsAuto()){
    try{await configureSteps();stepStatus=await stepsPlugin().getStatus();stepHealthKey=stepStatus.health}catch(e){}
    startStepsLoop();
    await refreshSteps();
  }
  renderStepGroup(false);renderToday(true);
}

/* ---------- setup: brand help, permissions, height ---------- */
const BRANDS={
  xiaomi:{name:'Xiaomi / Redmi / POCO',tips:['Open Settings > Apps > Manage apps > Comeback.','Turn on Autostart.','Set Battery saver to "No restrictions".']},
  oppo:{name:'Oppo / Realme / OnePlus',tips:['Open Settings > Battery > Comeback (or App battery management).','Allow background activity and auto-launch.','Turn off "Optimize battery use".']},
  vivo:{name:'Vivo / iQOO',tips:['Open Settings > Battery > Background power consumption.','Find Comeback and allow high background power use.','Turn on Autostart in the phone manager.']},
  samsung:{name:'Samsung',tips:['Open Settings > Battery > Background usage limits.','Remove Comeback from "Sleeping apps" and "Deep sleeping apps".','Set Comeback to "Unrestricted" battery use.']},
  huawei:{name:'Huawei / Honor',tips:['Open Settings > Apps > App launch > Comeback.','Turn off "Manage automatically".','Turn on Auto-launch, Secondary launch and Run in background.']},
  transsion:{name:'Infinix / Tecno / itel',tips:['Open Phone Master (or Settings) > App management > Autostart.','Allow Comeback to autostart.','Set battery use for Comeback to "No restrictions".']},
  other:{name:'Your phone',tips:['Open Settings > Apps > Comeback > Battery.','Choose "Unrestricted" (or "Don\'t optimize").','If your phone has an Autostart or Background apps list, allow Comeback there.']}
};
/** Brands whose phone software closes background apps, so they get the extra steps screen. */
const AGGRESSIVE_BRANDS=['xiaomi','oppo','vivo','samsung','transsion','huawei'];

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

/** The one permission round used by the onboarding screen: Physical activity, then Notifications, then the battery exemption.
    Every answer is optional. Never throws. */
async function requestAllStepPermissions(){
  const P=stepsPlugin(),out={activity:false,notifications:false,battery:false};
  if(!P)return out;
  try{out.activity=!!(await P.requestActivityPermission()).granted}catch(e){}
  try{
    if(Native.LocalNotifications){
      let p=await Native.LocalNotifications.checkPermissions();
      if(p.display!=='granted')p=await Native.LocalNotifications.requestPermissions();
      out.notifications=p.display==='granted';
    }
  }catch(e){}
  try{
    const r=await withTimeout(P.requestIgnoreBatteryOptimizations(),120000);
    out.battery=!!(r&&r.granted);
    if(!out.battery){const i=await P.getDeviceInfo();out.battery=!!i.batteryIgnored}
  }catch(e){}
  return out;
}

/** Switch counting on (or re-apply settings). The service starts right away when Physical activity is allowed. */
async function enableStepCounting(heightCm){
  if(!stepsAvailable())return;
  meta.steps=Object.assign({},meta.steps,{heightCm:heightCm?Math.round(heightCm):meta.steps.heightCm,enabledAt:meta.steps.enabledAt||Date.now(),setupShown:true});
  if(heightCm&&settings.body.heightCm!==heightCm){settings.body.heightCm=heightCm;try{await saveSettingsQuiet()}catch(e){}}
  await saveStepMeta();
  try{stepStatus=await configureSteps();stepHealthKey=(stepStatus&&stepStatus.health)||stepHealthKey}catch(e){}
  startStepsLoop();
  refreshAll();renderStepGroup(false);
  setTimeout(refreshSteps,1500);
}

/** Existing users: the permission screen shows once if Physical activity is not allowed yet. If it already is, counting just starts. */
async function maybeShowPermissionSetup(){
  if(!stepsAvailable()||meta.steps.setupShown)return false;
  let st=null;try{st=await stepsPlugin().getStatus()}catch(e){}
  if(st&&st.activityPermission){await enableStepCounting();toast('Step counting is on',{icon:'footprints'});return false}
  meta.steps.setupShown=true;await saveStepMeta();
  showPermissionSetup();
  return true;
}

async function askStepPermission(){
  const P=stepsPlugin();
  const r=await P.requestActivityPermission();
  if(r.granted)return true;
  const c=await infoSheet({title:'Permission needed',icon:'shield-check',paragraphs:['Comeback needs the "Physical activity" permission to read your phone\'s step sensor. Without it, steps can\'t be counted.','You can try again, or allow it in Android settings.'],primary:'Try again',secondary:'Open app settings'});
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
      paragraphs:['Many phones close background apps to save battery. Let Comeback keep running so your steps are counted all day.'+(ignored?' Battery optimisation is already off for Comeback.':'')],
      list:b.tips.map((t,i)=>(i+1)+'. '+t),
      primary:ignored?'Continue':'Allow background activity',secondary:info.brand==='other'?'Open battery settings':'Open '+b.name.split(' / ')[0]+' settings',tertiary:ignored?undefined:'Skip for now'});
    if(c==='primary'&&!ignored){try{await withTimeout(P.requestIgnoreBatteryOptimizations(),120000)}catch(e){}try{ignored=!!(await P.getDeviceInfo()).batteryIgnored}catch(e){}continue}
    if(c==='primary')return;
    if(c==='secondary'){try{await P.openSettings({target:info.brand==='other'?'battery':'autostart'})}catch(e){}continue}
    return; // skip / cancel
  }
}

/** Tapped from the Today card or Plan when counting is off or lacks a permission. */
async function turnOnStepCounting(){
  if(!stepsAvailable())return;
  if(!stepsAuto()){showPermissionSetup();return}
  await fixStepHealth(true);
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

/** One-tap fix for whatever is stopping the count. */
async function fixStepHealth(){
  const k=stepHealthKey;
  const reread=async()=>{try{stepStatus=await stepsPlugin().getStatus();stepHealthKey=stepStatus.health;renderStepGroup(false);renderToday(true)}catch(e){}};
  if(k==='permission_missing'){
    try{if(await askStepPermission()){stepStatus=await configureSteps();stepHealthKey=stepStatus.health;renderStepGroup(false);renderToday(true);setTimeout(refreshSteps,1000)}}catch(e){}
  }else if(k==='paused_battery'){
    await batterySetup();setTimeout(reread,500);
  }
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

/* ---------- hourly chart (Progress and the Steps detail sheet) ---------- */
const HOUR_LABEL=i=>i===0?'12 AM':i===12?'12 PM':i<12?i+' AM':(i-12)+' PM';
function makeHoursChart(canvas,hourly,when){
  const L=chartLook(),accent=L.accent,muted=L.muted,sep=L.sep;
  const labels=hourly.map((_,i)=>HOUR_LABEL(i));
  const best=hourly.indexOf(Math.max(...hourly)),total=hourly.reduce((a,b)=>a+b,0);
  const summary='Steps counted by your phone '+(when||'today')+' by hour: '+fmt(total)+' in total. Most active hour: '+labels[best]+' with '+fmt(hourly[best])+' steps.';
  canvas.removeAttribute('role');canvas.removeAttribute('aria-label');canvas.setAttribute('aria-hidden','true');   // the summary text next to the chart says it
  const fnt=L.font;
  const chart=new Chart(canvas,{type:'bar',data:{labels,datasets:[{data:hourly,backgroundColor:accent,borderRadius:3,maxBarThickness:14}]},
    options:{responsive:true,maintainAspectRatio:false,animation:reduced()?false:{duration:400},plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>labels[i[0].dataIndex],label:c=>fmt(c.parsed.y)+' steps'}}},
      scales:{x:{grid:{display:false},border:{display:false},ticks:{color:muted,maxRotation:0,autoSkip:false,font:fnt,callback:(v,i)=>i%6===0?labels[i]:''}},y:{grid:{color:sep},border:{display:false},beginAtZero:true,ticks:{color:muted,maxTicksLimit:4,font:fnt}}}}});
  return{chart,summary};
}

/* ---------- read-only detail for the Steps card ---------- */
function stepsDetailSheet(k){
  const x=stepsHabit();if(!x)return;
  const d=days[k],v=Number((d&&d.vals&&d.vals.steps)||0),m=d&&d.steps_meta;
  const lab=stepsLabelFor(k),isToday=k===todayStr(),kind=stepsCardKind(k);
  const root=h('<div></div>');
  const big=h('<div class="numdisp"><span class="nv num"></span><span class="nu"></span></div>');
  big.querySelector('.nv').textContent=kind==='turnon'||kind==='phoneonly'?'–':fmt(v);
  big.querySelector('.nu').textContent='of '+fmt(x.target)+' '+x.unit+(x.target>0&&v>0?' · '+Math.min(999,Math.round(v/x.target*100))+'%':'');
  root.appendChild(big);
  if(kind==='turnon'||kind==='phoneonly'){
    const p=h('<p class="info" style="text-align:center"></p>');
    p.textContent=kind==='phoneonly'?'Steps are counted by the Android app, from your phone\'s motion sensor.':'Steps are off right now. Turn on step counting to count them from your phone.';
    root.appendChild(p);
    if(kind==='turnon'){const b=h('<button class="btn" id="stDetailTurnOn"></button>');b.textContent='Turn on step counting';b.addEventListener('click',()=>{sh.close('cancel');turnOnStepCounting()});root.appendChild(b)}
  }
  const g=h('<div class="group" style="margin:0 0 var(--s3)"></div>');
  const row=(label,val,sub)=>{const r=h('<div class="row"><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="row-val"></span></div>');r.querySelector('.row-label').textContent=label;const s=r.querySelector('.row-sub');if(sub)s.textContent=sub;else s.remove();r.querySelector('.row-val').textContent=val;g.appendChild(r)};
  if(v>0||kind==='value')row('Distance',v>0?'About '+fmtKm(kmFor(v)):'–','Estimated from your height ('+fmtHeight(stepHeightCm())+')');
  if(lab)row('Source',lab==='counted'?'Counted by phone':MANUAL_OLD);
  if(m&&lab==='counted')row('Filtered out',fmt(m.filtered||0),'Vehicle vibration and short shuffles are not counted');
  else if(isToday&&stepsAuto())row('Filtered out',fmt((stepStatus&&stepStatus.filteredToday)||0),'Vehicle vibration and short shuffles are not counted');
  if(isToday&&stepsAuto()){const hk=HEALTH_TEXT[stepHealthKey]?stepHealthKey:'working';row('Step tracking',HEALTH_TEXT[hk])}
  if(g.children.length)root.appendChild(g);
  let hc=null;
  const hourly=m&&m.hourly&&m.hourly.some(n=>n>0)?m.hourly:null;
  if(hourly&&lab==='counted'){
    const box=h('<div class="card" style="margin-bottom:var(--s3)"><div class="chartbox" style="height:11rem"><canvas id="chartStepsSheet" role="img"></canvas></div><p class="t-foot muted" id="stepsSheetSummary" style="margin:12px 0 0"></p></div>');
    root.appendChild(box);
  }else if(lab==='manual'){
    root.appendChild(h('<p class="info">This day was entered by hand before steps became phone-only, so there is no hourly breakdown. The number is kept as it was.</p>'));
  }
  const kill=()=>{if(hc){hc.destroy();hc=null}};
  const sh=openSheet({title:isToday?'Steps today':'Steps · '+nice(k),left:null,right:'Done',content:root,onDone:kill,onCancel:kill});
  if(hourly&&lab==='counted'&&window.Chart){const r=makeHoursChart(root.querySelector('#chartStepsSheet'),hourly,isToday?'today':'on this day');hc=r.chart;root.querySelector('#stepsSheetSummary').textContent=r.summary}
  return sh;
}
