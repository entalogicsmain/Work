/* Settings, in this order: reminder, units, body, suggestions, appearance (theme, simple look), security (app lock), step tracking health, permissions, advanced, backup, account and sync, about.
   Opened from the gear in the top bar. Goals (habits, targets, schedules) live in Plan (plan.js). */

let settingsFrom='today';
function openSettings(){
  if(activeTab==='settings')return;
  closeAllLayers();settingsFrom=activeTab;haptic('light');
  showTab('settings');
  renderSettings();
  if(stepsAvailable())renderStepGroup(true);
}
function closeSettings(){if(activeTab==='settings')showTab(settingsFrom&&settingsFrom!=='settings'?settingsFrom:'today')}
$('gearBtn').addEventListener('click',openSettings);
$('navBack').addEventListener('click',()=>{haptic('light');closeSettings()});

const advOpen={v:false};
const permState={activity:null,notifications:null,battery:null};

function settingRow(o){return stepRow(o)}
function switchRow(o){
  const r=h('<label class="row"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><input type="checkbox" class="switch" role="switch"></label>');
  r.querySelector('.row-ic').innerHTML=icon(o.icon);
  r.querySelector('.row-label').textContent=o.label;
  const sub=r.querySelector('.row-sub');if(o.sub)sub.textContent=o.sub;else sub.remove();
  const box=r.querySelector('input');box.checked=!!o.on;box.setAttribute('aria-label',o.label);
  if(o.id)r.id=o.id;if(o.boxId)box.id=o.boxId;
  box.addEventListener('change',()=>o.onChange(box.checked,box));
  return r;
}

/* ---------- step tracking (Android app only) ---------- */
function renderStepGroup(fetchStatus){
  const head=$('stepHead'),g=$('stepGroup'),foot=$('stepFoot'),msg=$('stMsg');
  const show=stepsAvailable()&&!!stepsHabit();
  [head,g,foot,msg].forEach(e=>{if(e)e.hidden=!show});
  if(!show){renderPermissions();return}
  if(fetchStatus!==false)stepsPlugin().getStatus().then(s=>{stepStatus=s;stepHealthKey=s.health||stepHealthKey;renderStepGroup(false)}).catch(()=>{});
  g.innerHTML='';
  const auto=stepsAuto();
  if(!auto){
    g.appendChild(stepRow({id:'stTurnOn',icon:'footprints',tint:'orange',label:'Turn on step counting',chev:true,sub:'Counts steps with your phone\'s motion sensor.',onTap:turnOnStepCounting}));
    foot.textContent='Steps come only from your phone. Nothing is shared with other apps.';
  }else{
    const hk=HEALTH_TEXT[stepHealthKey]?stepHealthKey:'working';
    const hi=HEALTH_ICON[hk];
    g.appendChild(stepRow({id:'stHealth',static:true,icon:hi[0],tint:hi[1],label:'Step tracking health',sub:HEALTH_TEXT[hk]}));
    if(hk==='permission_missing')g.appendChild(stepRow({id:'stFix',icon:'shield-check',label:'Allow permission',chev:true,onTap:fixStepHealth}));
    if(hk==='paused_battery')g.appendChild(stepRow({id:'stFix',icon:'battery-low',label:'Fix battery settings',chev:true,onTap:fixStepHealth}));
    const todayMeta=days[todayStr()]&&days[todayStr()].steps_meta;
    const filt=(stepStatus&&stepStatus.filteredToday)!=null?stepStatus.filteredToday:0;
    g.appendChild(stepRow({id:'stFiltered',static:true,icon:'car',label:'Steps filtered out today',sub:'Vehicle vibration and short shuffles are not counted',val:String(todayMeta?todayMeta.filtered:filt)}));
    foot.textContent='Steps are counted by your phone all day, even when the app is closed. They can\'t be typed in. Set the daily target in Plan.';
  }
  renderPermissions();renderAdvanced();
}

/* ---------- permissions ---------- */
async function readPermissions(){
  const P=stepsPlugin();if(!P)return;
  try{const s=await P.getStatus();permState.activity=!!s.activityPermission}catch(e){}
  try{if(Native.LocalNotifications){const p=await Native.LocalNotifications.checkPermissions();permState.notifications=p.display==='granted'}}catch(e){}
  try{const i=await P.getDeviceInfo();permState.battery=!!i.batteryIgnored}catch(e){}
}
function renderPermissions(){
  const head=$('permHead'),g=$('permGroup'),foot=$('permFoot');
  const show=stepsAvailable();
  [head,g,foot].forEach(e=>{e.hidden=!show});
  if(!show)return;
  g.innerHTML='';
  const st=v=>v==null?'':v?'Allowed':'Not allowed';
  const row=(id,ic,label,sub,key,onTap)=>{
    const r=stepRow({id,icon:ic,tint:permState[key]===false?'orange':permState[key]?'green':'',label,sub,val:st(permState[key]),chev:true,onTap});
    g.appendChild(r);
  };
  row('pmActivity','footprints','Physical activity','Counts your steps.','activity',async()=>{await askStepPermission();await readPermissions();renderPermissions();renderStepGroup(true)});
  row('pmNotif','bell','Notifications','Daily reminder and the step counter notification.','notifications',async()=>{
    try{
      let p=await Native.LocalNotifications.checkPermissions();
      if(p.display!=='granted')p=await Native.LocalNotifications.requestPermissions();
      if(p.display!=='granted')try{await stepsPlugin().openSettings({target:'app'})}catch(e){}
    }catch(e){}
    await readPermissions();renderPermissions();
  });
  row('pmBattery','battery-low','Battery','Lets counting keep running in the background.','battery',async()=>{await batterySetup();await readPermissions();renderPermissions();renderStepGroup(true)});
  foot.textContent='You can change these here or in Android settings at any time.';
}

/* ---------- units ---------- */
function segRow(o){
  const r=h('<div class="row segrow"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span></span><div class="seg mini" role="radiogroup"></div></div>');
  r.querySelector('.row-ic').innerHTML=icon(o.icon);
  r.querySelector('.row-label').textContent=o.label;
  const seg=r.querySelector('.seg');seg.setAttribute('aria-label',o.label);seg.setAttribute('role','radiogroup');
  if(o.id)r.id=o.id;
  o.options.forEach(op=>{
    const b=h('<button role="radio"></button>');b.textContent=op.label;b.dataset.v=op.value;if(op.id)b.id=op.id;
    b.setAttribute('aria-checked',String(op.value===o.value));
    b.addEventListener('click',()=>{if(op.value!==o.value){haptic('light');o.onPick(op.value)}});
    seg.appendChild(b);
  });
  return r;
}
async function setUnits(patch,msg){
  settings.units=Object.assign({},settings.units,patch);
  await saveSettingsQuiet();
  refreshAll();
  if(msg)toast(msg,{icon:'ruler'});
}
function renderUnits(){
  const g=$('unitGroup');g.innerHTML='';
  g.appendChild(segRow({id:'unitWeight',icon:'scale',label:'Weight',value:wUnit(),options:[{value:'kg',label:'kg',id:'uKg'},{value:'lb',label:'lb',id:'uLb'}],onPick:v=>setUnits({weight:v})}));
  g.appendChild(segRow({id:'unitLength',icon:'ruler',label:'Height and waist',value:unitsOf().length,options:[{value:'cm',label:'cm',id:'uCm'},{value:'ftin',label:'ft / in',id:'uFt'}],onPick:v=>setUnits({length:v})}));
}

/* ---------- body ---------- */
function renderBodyGroup(){
  const g=$('bodyGroup');g.innerHTML='';
  g.appendChild(stepRow({id:'stHeight',icon:'user',label:'Height',val:heightCm()!=null?fmtHeight(heightCm()):'Not set',chev:true,sub:'Used for BMI and to estimate distance walked',onTap:heightSheet}));
  const gd=settings.body.goalDate;
  g.appendChild(stepRow({id:'stGoal',icon:'target',label:'Goal weight',val:settings.body.goalKg!=null?fmtWeight(settings.body.goalKg):'Not set',chev:true,sub:settings.body.goalKg!=null?(gd?'By '+Core.approxDate(gd,todayStr())+'. Shown on your weight chart':'Shown on your weight chart'):'Optional. A gentle line on your weight chart',onTap:goalSheet}));
  g.appendChild(segRow({id:'bmiScaleRow',icon:'activity',label:'BMI scale',value:bmiScale(),options:[{value:'standard',label:'Standard',id:'scStd'},{value:'asian',label:'Asian',id:'scAsia'}],onPick:async v=>{
    settings.body=Object.assign({},settings.body,{scale:v});await saveSettingsQuiet();refreshAll();toast('BMI scale: '+Core.BMI_SCALES[v].name,{icon:'activity'});
  }}));
  $('bodyFoot').textContent=bmiScale()==='asian'?'Asian (WHO Asia-Pacific): healthy range 18.5 to 22.9. Often recommended for South, East and Southeast Asian backgrounds.':'Standard (WHO): healthy range 18.5 to 24.9. Choose Asian if your background is South, East or Southeast Asian.';
}

/* ---------- appearance: "Simple look" (device-local, kept in Preferences, not in the synced settings) ---------- */
const SIMPLE_KEY='comeback_simple_look';
const AUTO_LITE=document.documentElement.classList.contains('lite');   // the low-end-phone heuristic in ui.js stays on whatever this is set to
let simpleLook=false;
function applySimpleLook(on){simpleLook=!!on;document.documentElement.classList.toggle('lite',simpleLook||AUTO_LITE)}
function renderAppearance(){
  const g=$('appearGroup');if(!g)return;g.innerHTML='';
  // Theme (theme.js): System follows the phone's dark mode; Light and Dark override it. Device-local, applied at once.
  g.appendChild(segRow({id:'themeRow',icon:'moon',label:'Theme',value:Theme.get(),options:[{value:'system',label:'System',id:'thSystem'},{value:'light',label:'Light',id:'thLight'},{value:'dark',label:'Dark',id:'thDark'}],onPick:v=>{
    Theme.set(v);   // fires 'comeback-theme', which draws this group again (below)
    const b=$({system:'thSystem',light:'thLight',dark:'thDark'}[v]);if(b)b.focus({preventScroll:true});
  }}));
  g.appendChild(switchRow({id:'simpleRow',boxId:'simpleOn',icon:'eye',label:'Simple look',sub:'Solid bars and sheets, no blur, no wiggle',on:simpleLook,onChange:async on=>{
    applySimpleLook(on);try{await prefSet(SIMPLE_KEY,on?'1':'0')}catch(e){}
  }}));
}
try{prefGet(SIMPLE_KEY).then(v=>{applySimpleLook(v==='1');renderAppearance()}).catch(()=>{})}catch(e){}
window.addEventListener('comeback-theme',()=>{if(typeof activeTab!=='undefined'&&activeTab==='settings')renderAppearance()});   // the stored choice arrived after the page was shown

/* ---------- suggestions ---------- */
function renderSuggestions(){
  const g=$('sugGroup');g.innerHTML='';
  g.appendChild(switchRow({id:'sugRow',boxId:'sugOn',icon:'trending-up',label:'Target suggestions',sub:'Offer to raise a target after 5 good days in a row',on:settings.prefs.suggestions!==false,onChange:async on=>{
    settings.prefs=Object.assign({},settings.prefs,{suggestions:on});await saveSettingsQuiet();renderToday();
  }}));
  // only people who started with a plan on a new install have the first-week ramp (Core.applyStarterPlan sets it); everyone else never sees this
  if(settings.prefs.ramp!==undefined)g.appendChild(switchRow({id:'rampRow',boxId:'rampOn',icon:'leaf',label:'Ease me in during the first week',sub:'Shows 3 habits at first, and the rest when you are ready',on:settings.prefs.ramp===true,onChange:async on=>{
    settings.prefs=Object.assign({},settings.prefs,{ramp:on});await saveSettingsQuiet();renderToday(true);
  }}));
}

/* ---------- advanced (collapsed) ---------- */
function renderAdvanced(){
  const head=$('advHead'),g=$('advGroup'),foot=$('advFoot');
  const show=stepsAvailable()&&stepsAuto()&&!!stepsHabit();
  head.hidden=!show;g.hidden=!show;foot.hidden=!show||!advOpen.v;
  if(!show)return;
  g.innerHTML='';
  const tog=h('<button class="row" id="advToggle" aria-expanded="false"><span class="row-ic"></span><span class="row-body"><span class="row-label">Step detection</span><span class="row-sub">Vehicle filter, sensitivity, location</span></span><svg data-ic="chevron-down" class="chev"></svg></button>');
  tog.querySelector('.row-ic').innerHTML=icon('sliders-horizontal');
  tog.setAttribute('aria-expanded',String(advOpen.v));tog.classList.toggle('open',advOpen.v);
  tog.addEventListener('click',()=>{advOpen.v=!advOpen.v;renderAdvanced()});
  hydrate(tog);g.appendChild(tog);
  if(!advOpen.v)return;
  g.appendChild(stepRow({id:'stStrict',icon:'shield-check',label:'Vehicle filter',val:STRICT_NAME[meta.steps.strictness],chev:true,sub:'How careful to be about false steps',onTap:async()=>{
    const r=await actionSheet({title:'Vehicle filter strictness',message:'Relaxed counts shorter walks but may count a few extra steps on bumpy rides. Strict needs a longer steady walk and filters more.',
      actions:['relaxed','balanced','strict'].map(k=>({label:STRICT_NAME[k]+(meta.steps.strictness===k?'  ✓':''),value:k}))});
    if(r==='cancel')return;
    meta.steps.strictness=r;await saveStepMeta();try{await configureSteps()}catch(e){}renderAdvanced();
  }}));
  if(stepStatus&&stepStatus.source==='accelerometer'){
    g.appendChild(stepRow({id:'stSens',icon:'activity',label:'Accelerometer sensitivity',val:SENS_NAME[meta.steps.sensitivity],chev:true,sub:'This phone has no step counter chip, so steps come from the accelerometer',onTap:async()=>{
      const r=await actionSheet({title:'Sensitivity',message:'Higher counts gentler steps (phone in hand). Lower ignores light movement.',actions:['low','normal','high'].map(k=>({label:SENS_NAME[k]+(meta.steps.sensitivity===k?'  ✓':''),value:k}))});
      if(r==='cancel')return;
      meta.steps.sensitivity=r;await saveStepMeta();try{await configureSteps()}catch(e){}renderAdvanced();
    }}));
  }
  const loc=switchRow({id:'stLoc',boxId:'stLocOn',icon:'map-pin',label:'Use location to improve accuracy in vehicles',sub:'Off by default. Speed above about 15 km/h for 30 seconds pauses counting.',on:!!meta.steps.useLocation,onChange:(on,box)=>setStepLocation(on,box)});
  g.appendChild(loc);
  if(typeof travelSettingsRows==='function'&&stepsAuto())travelSettingsRows().forEach(r=>g.appendChild(r));
  foot.textContent='These are the defaults for most people. Change them only if steps look wrong.';
}

/* "Back up now" (shown while there has been no backup yet) is the JSON export */
$('backupNow').addEventListener('click',()=>$('expJson').click());

/* ---------- reminder group (markup is in index.html; the logic is in logic.js) ---------- */
initTime12($('remMornTime'),'Morning cue time');
function renderReminderGroup(){
  const r=meta.reminder;
  $('remOn').checked=!!r.enabled;$('remTime').value=r.time;
  $('remIfOpen').checked=r.onlyIfOpen!==false;
  $('remMornOn').checked=!!r.morning.enabled;$('remMornTime').value=r.morning.time;
}

/* ---------- the whole screen ---------- */
function renderSettings(){
  renderReminderGroup();
  $('appVersion').textContent=APP_VERSION;
  renderAccount();
  renderUnits();renderBodyGroup();renderSuggestions();renderAppearance();
  if(typeof renderSecurity==='function')renderSecurity();   // lock.js: the Security group (Android app only)
  renderStepGroup(false);
  $('storeNote').textContent=IS_NATIVE?'Entries are saved on this phone and copied to Documents/Comeback after every change.':'Entries are saved in this browser only.';
  $('bkHint').textContent=IS_NATIVE?'Your entries live on this phone. A copy is also saved to Documents/Comeback after every change. Export one to keep it somewhere safe.':'Your entries live in this browser. Export a copy to keep it somewhere safe.';
  if(stepsAvailable())readPermissions().then(()=>{if(activeTab==='settings')renderPermissions()});
}
