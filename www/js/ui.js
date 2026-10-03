/* Comeback UI: tabs, sheets, Today, Progress, Plan, onboarding.
   Presentation only. Data, storage, backup, reminder and sync logic is in logic.js. */

/* ================= basics ================= */
const ICONS=window.CB_ICONS||{};
const icon=(n,cls)=>'<svg class="ic'+(cls?' '+cls:'')+'" viewBox="0 0 24 24" aria-hidden="true">'+(ICONS[n]||'')+'</svg>';
function hydrate(root){(root||document).querySelectorAll('svg[data-ic]').forEach(s=>{s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.classList.add('ic');s.innerHTML=ICONS[s.dataset.ic]||'';s.removeAttribute('data-ic')})}
function h(html){const t=document.createElement('template');t.innerHTML=html.trim();const el=t.content.firstElementChild;hydrate(el);return el}
/* Low-end phones keep the glass look without the expensive blur on every card. */
try{const mem=navigator.deviceMemory,cores=navigator.hardwareConcurrency;if((mem&&mem<=2)||(cores&&cores<=4))document.documentElement.classList.add('lite')}catch(e){}
const reduced=()=>{try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}};
const fmt=n=>Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
let activeTab='today';

/* A 12-hour time picker (hour, minute, AM/PM). The phone's own time input follows the system 24-hour setting, so the app draws its own.
   The element behaves like an input: .value is "HH:MM" (24-hour, for storage) and it fires "change". */
function initTime12(el,label){
  if(!el||el._t12)return el;
  el._t12=true;
  el.classList.add('time12');el.setAttribute('role','group');if(label)el.setAttribute('aria-label',label);
  const mk=(cls,name,opts)=>{const sel=document.createElement('select');sel.className=cls;sel.setAttribute('aria-label',(label?label+' ':'')+name);opts.forEach(o=>{const op=document.createElement('option');op.value=o[0];op.textContent=o[1];sel.appendChild(op)});el.appendChild(sel);return sel};
  const hh=mk('t12-h','hour',Array.from({length:12},(_,i)=>[String(i+1),String(i+1)]));
  const mm=mk('t12-m','minute',Array.from({length:60},(_,i)=>[String(i),String(i).padStart(2,'0')]));
  const ap=mk('t12-p','AM or PM',[['AM','AM'],['PM','PM']]);
  const get=()=>{let h=Number(hh.value)%12;if(ap.value==='PM')h+=12;return String(h).padStart(2,'0')+':'+String(Number(mm.value)).padStart(2,'0')};
  const set=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(v||'');if(!m)return;const h=Number(m[1])%24;hh.value=String(h%12===0?12:h%12);mm.value=String(Number(m[2]));ap.value=h>=12?'PM':'AM'};
  Object.defineProperty(el,'value',{get,set,configurable:true});
  [hh,mm,ap].forEach(x=>x.addEventListener('change',e=>{e.stopPropagation();el.dispatchEvent(new Event('change',{bubbles:true}))}));
  set('21:00');
  return el;
}
initTime12($('remTime'),'Reminder time');

function haptic(kind){
  if(!IS_NATIVE||!Native.Haptics)return;
  try{
    const p=kind==='success'?Native.Haptics.notification({type:Native.NotificationType.Success}):Native.Haptics.impact({style:kind==='medium'?Native.ImpactStyle.Medium:Native.ImpactStyle.Light});
    if(p&&p.catch)p.catch(()=>{});
  }catch(e){}
}

function setMsg(id,text,bad){const el=$(id);if(!el)return;el.textContent=text||'';el.classList.remove('ok','bad');if(text)el.classList.add(bad?'bad':'ok')}

/* ================= layers: sheets and action sheets ================= */
const layerEl=$('layer');
const layers=[];
const modalOpen=()=>layers.length>0;
function closeTopLayer(){const t=layers[layers.length-1];if(!t)return false;t.close('cancel');return true}

/* While a sheet, action sheet or the onboarding is open, everything behind it is inert: no focus, no taps, hidden from screen readers.
   A counter handles stacked layers. */
let bgLocks=0;
const BG_SEL='#screens,.tabbar,.navbar,#saveError';
function lockBackground(){bgLocks++;if(bgLocks===1)document.querySelectorAll(BG_SEL).forEach(e=>e.setAttribute('inert',''))}
function unlockBackground(){bgLocks=Math.max(0,bgLocks-1);if(bgLocks===0)document.querySelectorAll(BG_SEL).forEach(e=>e.removeAttribute('inert'))}
let layerSeq=0;
function mountLayer(wrap,api){
  api._prevFocus=document.activeElement;
  const under=layers[layers.length-1];if(under)under.el.setAttribute('inert','');   // a sheet under an action sheet is inert too
  lockBackground();
  layerEl.appendChild(wrap);layers.push(api);
  layerEl.style.pointerEvents='auto';
  requestAnimationFrame(()=>requestAnimationFrame(()=>wrap.classList.add('in')));
}
function unmountLayer(wrap,api){
  const i=layers.indexOf(api);if(i>=0)layers.splice(i,1);
  const top=layers[layers.length-1];if(top)top.el.removeAttribute('inert');
  wrap.setAttribute('inert','');wrap.classList.remove('in');
  unlockBackground();
  setTimeout(()=>{wrap.remove();if(!layers.length)layerEl.style.pointerEvents='none'},reduced()?160:330);
  try{const f=api._prevFocus;if(f&&f.focus&&document.contains(f))f.focus({preventScroll:true})}catch(e){}
}

/* openSheet({title,left,right,content,onDone,onCancel,leftId}) -> {el,body,close,setDone}
   onDone may return false to keep the sheet open. */
function openSheet(o){
  const wrap=h('<div class="sheet-wrap"><div class="scrim"></div><section class="sheet" role="dialog" aria-modal="true"><div class="grab-zone"><div class="grabber"></div><div class="sheet-head"><span class="l"></span><h2></h2><span class="r"></span></div></div><div class="sheet-body"></div></section></div>');
  const sheet=wrap.querySelector('.sheet'),body=wrap.querySelector('.sheet-body');
  const h2=wrap.querySelector('h2');h2.id='sheetTitle'+(++layerSeq);
  if(o.title)sheet.setAttribute('aria-labelledby',h2.id);else sheet.setAttribute('aria-label','Sheet');
  h2.textContent=o.title||'';
  let closed=false,doneBtn=null;
  const api={el:wrap,body,
    close(reason){
      if(closed)return;
      if(reason==='done'){if(o.onDone&&o.onDone(api)===false)return}
      else if(o.onCancel)o.onCancel(api);
      closed=true;unmountLayer(wrap,api);
    },
    setDone(enabled){if(doneBtn)doneBtn.disabled=!enabled}};
  const left=o.left===undefined?'Cancel':o.left,right=o.right===undefined?'Done':o.right;
  if(left){const b=h('<button class="txtbtn"></button>');b.textContent=left;if(o.leftId)b.id=o.leftId;b.addEventListener('click',()=>api.close('cancel'));wrap.querySelector('.l').appendChild(b)}
  if(right){doneBtn=h('<button class="txtbtn strong"></button>');doneBtn.textContent=right;doneBtn.addEventListener('click',()=>api.close('done'));wrap.querySelector('.r').appendChild(doneBtn)}
  body.appendChild(o.content);
  wrap.querySelector('.scrim').addEventListener('click',()=>api.close('cancel'));
  // swipe down on the grabber/header to dismiss
  const gz=wrap.querySelector('.grab-zone');let sy=0,t0=0,drag=false;
  gz.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;drag=true;sy=e.clientY;t0=e.timeStamp;gz.setPointerCapture(e.pointerId);sheet.classList.add('dragging')});
  gz.addEventListener('pointermove',e=>{if(!drag)return;const dy=Math.max(0,e.clientY-sy);sheet.style.setProperty('--dy',dy+'px')});
  const end=e=>{if(!drag)return;drag=false;sheet.classList.remove('dragging');const dy=Math.max(0,e.clientY-sy),v=dy/Math.max(1,e.timeStamp-t0);
    if(dy>110||(dy>40&&v>0.5))api.close('cancel');else sheet.style.setProperty('--dy','0px')};
  gz.addEventListener('pointerup',end);gz.addEventListener('pointercancel',end);
  mountLayer(wrap,api);
  setTimeout(()=>{const f=body.querySelector('[data-focus]');if(f)f.focus({preventScroll:true});else{const b=wrap.querySelector('.txtbtn');if(b)b.focus({preventScroll:true})}},60);
  return api;
}

/* actionSheet({title,message,actions:[{label,value,destructive}],cancelLabel}) -> Promise<value|'cancel'> */
function actionSheet(o){
  return new Promise(res=>{
    const wrap=h('<div class="sheet-wrap"><div class="scrim"></div><div class="asheet" role="dialog" aria-modal="true"><div class="ag"></div><div class="ag"><button class="ab cancel"></button></div></div></div>');
    const grp=wrap.querySelector('.ag');
    const as=wrap.querySelector('.asheet'),sid=++layerSeq;
    if(o.title)as.setAttribute('aria-labelledby','asTitle'+sid);else as.setAttribute('aria-label','Choose an action');
    if(o.message)as.setAttribute('aria-describedby','asMsg'+sid);
    if(o.title||o.message){const hd=h('<div class="ah"><b></b><span></span></div>');const hb=hd.querySelector('b'),hs=hd.querySelector('span');hb.textContent=o.title||'';hs.textContent=o.message||'';hb.id='asTitle'+sid;hs.id='asMsg'+sid;if(!o.title)hb.remove();if(!o.message)hs.remove();grp.appendChild(hd)}
    let closed=false;
    const api={el:wrap,close(v){if(closed)return;closed=true;unmountLayer(wrap,api);res(v===undefined?'cancel':v)}};
    o.actions.forEach(a=>{const b=h('<button class="ab"></button>');b.textContent=a.label;if(a.destructive)b.classList.add('destructive');b.addEventListener('click',()=>{haptic('light');api.close(a.value)});grp.appendChild(b)});
    const cb=wrap.querySelector('.cancel');cb.textContent=o.cancelLabel||'Cancel';cb.addEventListener('click',()=>api.close('cancel'));
    wrap.querySelector('.scrim').addEventListener('click',()=>api.close('cancel'));
    mountLayer(wrap,api);
    as.tabIndex=-1;setTimeout(()=>{if(!wrap.contains(document.activeElement))as.focus({preventScroll:true})},60);   // the dialog takes focus (not a button, so Enter can't confirm by accident)
  });
}
// logic.js asks its questions through this; it becomes an action sheet
function askModal(title,body,buttons){
  const cancel=buttons.find(b=>b.value==='cancel');
  return actionSheet({title,message:body,actions:buttons.filter(b=>b.value!=='cancel').map(b=>({label:b.label,value:b.value,destructive:b.cls==='danger'})),cancelLabel:cancel?cancel.label:'Cancel'});
}

/* ================= toast, saved indicator, auto-save, undo ================= */
let toastTimer=null,undoFn=null;
function toast(msg,o){
  o=o||{};
  const t=$('toast');$('toastMsg').textContent=msg;
  $('toastIc').innerHTML=ICONS[o.icon||'circle-check']||'';
  const u=$('toastUndo');u.hidden=!o.undo;t.classList.toggle('act',!!o.undo);undoFn=o.undo||null;
  t.classList.add('show');clearTimeout(toastTimer);
  const len=String(msg||'').length;   // long messages stay up longer; undo gets extra time
  toastTimer=setTimeout(()=>{t.classList.remove('show');undoFn=null},o.undo?Math.max(8000,60*len):Math.max(4000,60*len));
}
$('toastUndo').addEventListener('click',()=>{const f=undoFn;undoFn=null;$('toast').classList.remove('show');if(f)f()});
/* The "Saved" text only exists while it is showing, so a screen reader hears it appear (the indicator is a status region). */
let savedTimer=null,savedClear=null;
function flashSaved(){
  const el=$('savedInd'),tx=$('savedTxt');
  clearTimeout(savedClear);tx.textContent='Saved';el.classList.add('on');
  clearTimeout(savedTimer);savedTimer=setTimeout(()=>{el.classList.remove('on');savedClear=setTimeout(()=>{tx.textContent=''},300)},1600);
}
/* A save that keeps failing is not a passing toast: show a banner until it works again. */
function showSaveError(on){
  const b=$('saveError');if(b)b.hidden=!on;
}
$('saveRetry').addEventListener('click',async()=>{
  if(pendingSave.size){flushSave();return}
  try{await store.persist();showSaveError(false);flashSaved()}catch(e){}
});

let saveTimer=null;const pendingSave=new Set();
function scheduleSave(k){pendingSave.add(k);clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,400)}
async function flushSave(){
  clearTimeout(saveTimer);
  if(!pendingSave.size)return;
  const keys=[...pendingSave];pendingSave.clear();
  try{await store.persist();showSaveError(false);flashSaved();keys.forEach(markDayDirty);autoBackup();syncSoon(false);rescheduleReminders()}
  catch(e){keys.forEach(k=>pendingSave.add(k));showSaveError(true);toast("Couldn't save. Trying again.",{icon:'x'});clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,3000)}
}

/* ================= day data helpers ================= */
/* The comeback starts with the first day that has anything logged. */
function firstLogKey(){return Core.loggedKeys(days)[0]||null}
function comebackDay(k){
  const f=firstLogKey()||todayStr();
  if(k<f)return 0;
  return Core.daysBetween(f,k)+1;
}
const GENTLE_RESTART='Every comeback has restarts. Start again today.';
/* One change = one auto-saved write, one undo step, and (maybe) a small celebration. */
function commitDay(label,mutate,quiet,forKey){
  onResume();      // midnight may have passed while the screen stayed on: roll "today" forward first
  const k=forKey||current;
  const prev=days[k]?clone(days[k]):null;
  const before=dayMetrics(prev,k),streakBefore=streak();
  const d=prev?clone(prev):Core.blankDay(k);
  mutate(d);
  d.date=k;d.updatedAt=Date.now();
  days[k]=d;Core.invalidate();
  scheduleSave(k);
  const after=dayMetrics(d,k),streakAfter=streak();
  renderToday(true);renderProgress();
  const undo=()=>{
    if(prev){days[k]=Object.assign(clone(prev),{updatedAt:Date.now()})}
    else if(signedIn()){days[k]=Object.assign(Core.blankDay(k),{updatedAt:Date.now()})}   // an empty record syncs the removal; it is not a logged day (Core.hasRecord)
    else delete days[k];
    Core.invalidate();scheduleSave(k);renderToday();renderProgress();haptic('light');toast('Change undone',{icon:'check'});
  };
  let msg=label,ic='circle-check',ok=false;
  if(after.full&&!before.full){msg='Strong day. Your comeback is on track.';ic='sparkles';ok=true;celebrate()}
  else{
    const MILE=[3,5,7,10,14,21,30,50,100];
    const newlyMet=settings.habits.filter(x=>(x.type==='count'||x.type==='duration'||x.type==='steps')&&Core.isMet(x,d)&&!Core.isMet(x,prev));
    if(streakAfter>streakBefore&&MILE.includes(streakAfter)){msg=streakAfter+'-day streak';ic='flame';ok=true;haptic('success')}
    else if(newlyMet.length){msg=newlyMet[0].name+' goal hit';ic='trophy';ok=true;haptic('success')}
  }
  if(!ok)haptic('light');
  if(!quiet)toast(msg,{undo,icon:ic});
}

function celebrate(){
  haptic('success');
  const ring=$('ring');ring.classList.remove('done');void ring.offsetWidth;ring.classList.add('done');
  if(reduced())return;
  const box=h('<div class="confetti" aria-hidden="true"></div>');
  const cols=['var(--confetti-1)','var(--confetti-2)','var(--confetti-3)','var(--confetti-4)','var(--confetti-5)'];
  for(let i=0;i<28;i++){const c=document.createElement('i');c.style.left=(5+Math.random()*90)+'%';c.style.background=cols[i%cols.length];c.style.setProperty('--dx',(Math.random()*120-60)+'px');c.style.setProperty('--rot',(Math.random()*720-360)+'deg');c.style.animationDelay=(Math.random()*.25)+'s';box.appendChild(c)}
  document.body.appendChild(box);setTimeout(()=>box.remove(),2200);
}

/* ================= number sheet (large number, steppers, presets, keypad) ================= */
function numberSheet(o){
  let buf=o.value==null?'':String(o.value),fresh=true;
  const root=h('<div><div class="numdisp"><span class="nv num" aria-live="polite"></span><span class="nu"></span></div><div class="err" role="alert"></div><div class="stepper"><button class="step" aria-label="Decrease"></button><button class="step" aria-label="Increase"></button></div><div class="presets"></div><div class="keypad"></div></div>');
  const nv=root.querySelector('.nv'),err=root.querySelector('.err');
  root.querySelector('.nu').textContent=o.unitLine||'';
  const [minus,plus]=root.querySelectorAll('.step');minus.innerHTML=icon('minus');plus.innerHTML=icon('plus');
  let sheet;
  function show(){
    nv.textContent=buf===''?(o.placeholder||'0'):buf;nv.classList.toggle('empty-v',buf==='');
    const v=buf===''?null:Number(buf);const e=o.validate?o.validate(v):'';
    err.textContent=e||'';if(sheet)sheet.setDone(!e);
  }
  const num=()=>buf===''?0:Number(buf);
  const set=v=>{buf=String(Math.max(o.min||0,r2(v)));fresh=true;show();haptic('light')};
  minus.addEventListener('click',()=>set(num()-o.step));plus.addEventListener('click',()=>set(num()+o.step));
  (o.presets||[]).forEach(p=>{const b=h('<button class="preset"></button>');b.textContent=p.label;b.addEventListener('click',()=>set(p.apply?p.apply(num()):p.set));root.querySelector('.presets').appendChild(b)});
  if(!(o.presets||[]).length)root.querySelector('.presets').remove();
  (o.extras||[]).forEach(x=>{const b=h('<button class="btn secondary" style="margin-bottom:var(--s3)"></button>');b.textContent=x.label;b.addEventListener('click',()=>x.onClick(sheet));root.insertBefore(b,root.querySelector('.keypad'))});
  const kp=root.querySelector('.keypad');
  ['1','2','3','4','5','6','7','8','9','.','0','del'].forEach(k=>{
    const b=h('<button class="key"></button>');
    if(k==='del'){b.innerHTML=icon('delete');b.setAttribute('aria-label','Delete')}else{b.textContent=k;b.setAttribute('aria-label',k==='.'?'Decimal point':k)}
    b.addEventListener('click',()=>{
      haptic('light');
      if(k==='del'){buf=fresh?'':buf.slice(0,-1);fresh=false}
      else if(k==='.'){if(fresh){buf='0.';fresh=false}else if(!buf.includes('.'))buf=(buf||'0')+'.'}
      else{if(fresh){buf=k;fresh=false}else if(buf.replace('.','').length<7)buf=buf==='0'?k:buf+k}
      show();
    });
    kp.appendChild(b);
  });
  sheet=openSheet({title:o.title,content:root,onCancel:o.onCancel,onDone:()=>{const v=buf===''||buf==='.'?null:Number(buf);if(o.validate&&o.validate(v))return false;o.onDone(v)}});
  show();
  return sheet;
}

$('prevDay').addEventListener('click',()=>{goTo(addDays(current,-1));haptic('light')});
$('nextDay').addEventListener('click',()=>{const n=addDays(current,1);if(n<=todayStr()){goTo(n);haptic('light')}});

/* ================= Progress ================= */
let period=30,metric='score',chart=null;
const rangeKeys=n=>{const out=[],t=todayStr();for(let i=n-1;i>=0;i--)out.push(addDays(t,-i));return out};
const RANGE_NAME={7:'week',30:'month',90:'3 months'};
function metricInfo(m){
  if(m==='score')return{name:'Daily score',unit:'%',get:d=>scoreOf(d)};
  if(m==='weight')return{name:'Weight',unit:wUnit(),get:d=>d.weight==null?null:r1(toDispWeight(d.weight))};
  if(m==='waist')return{name:'Waist',unit:lUnit(),get:d=>d.waist==null?null:r1(toDispWaist(d.waist))};
  const x=settings.habits.find(q=>'h:'+q.id===m&&(q.type==='count'||q.type==='duration'||q.type==='steps'));
  if(x)return{name:x.name,unit:x.unit,get:d=>d.vals&&d.vals[x.id]!=null?d.vals[x.id]:null,target:x.target,note:x.type==='steps'?k=>{const l=stepsLabelFor(k);return l==='counted'?'Counted by phone':l==='manual'?MANUAL_OLD:''}:null};
  return metricInfo('score');
}
function changeIn(keys,key){
  const ks=keys.filter(k=>days[k]&&days[k][key]!=null);
  if(ks.length<2)return null;
  const conv=key==='weight'?toDispWeight:toDispWaist;
  return r1(conv(days[ks[ks.length-1]][key])-conv(days[ks[0]][key]));
}
const signed=(n,u)=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n))+' '+u;
function scoreClass(s){return s>=80?'g':s>=40?'o':'r'}
function renderProgress(){
  const logged=Core.loggedKeys(days),isLogged=k=>Core.hasRecord(days[k]),empty=!logged.length;
  $('progEmpty').hidden=!empty;$('progBody').hidden=empty;
  document.querySelectorAll('#seg button').forEach(b=>b.setAttribute('aria-checked',String(Number(b.dataset.range)===period)));
  $('progressSub').textContent=empty?'':'Last '+(period===7?'7 days':period===30?'30 days':'3 months');
  $('seg').hidden=empty;
  if(empty){if(chart){chart.destroy();chart=null}return}
  const rk=rangeKeys(period),inR=rk.filter(isLogged);
  const st=streak(),best=bestStreak();
  $('sStreak').textContent=st+(st===1?' day':' days');
  $('sDays').textContent=inR.length;$('sDaysSub').textContent='in the last '+RANGE_NAME[period];
  const wc=changeIn(rk,'weight'),wa=changeIn(rk,'waist');
  $('sWeight').textContent=wc==null?'–':signed(wc,wUnit());$('sWeightSub').textContent=wc==null?'Needs 2 entries':'this '+RANGE_NAME[period];
  $('sWaist').textContent=wa==null?'–':signed(wa,lUnit());$('sWaistSub').textContent=wa==null?'Needs 2 entries':'this '+RANGE_NAME[period];
  const withSteps=rk.filter(k=>days[k]&&days[k].vals&&days[k].vals.steps!=null);   // Steps is always the habit with id "steps" (Core.migrateSettings)
  if(withSteps.length){
    const avg=Math.round(withSteps.reduce((a,k)=>a+days[k].vals.steps,0)/withSteps.length);
    $('sAvgSteps').textContent=fmt(avg);$('sAvgStepsSub').textContent='over '+withSteps.length+(withSteps.length===1?' day':' days');
    $('sAvgDist').textContent=fmtKm(kmFor(avg));$('sAvgDistSub').textContent='a day, at '+fmtHeight(stepHeightCm())+' tall';
  }else{$('sAvgSteps').textContent='–';$('sAvgStepsSub').textContent='No steps logged yet';$('sAvgDist').textContent='–';$('sAvgDistSub').textContent=''}
  const ss=Core.streakStatus(settings,days,todayStr()),dk=Core.daysKept(settings,days,todayStr(),35);
  $('streakNote').textContent=(st>0?(best>st?'Your best streak was '+best+' days.':'This is your best streak yet.'):(best>0?(ss.todayRecord&&ss.open?'Reach 50% today to start a new streak.':GENTLE_RESTART)+' Your best streak was '+best+' days.':'Log a day to start your streak.'))+(dk.due>=3?' Kept '+dk.kept+' of '+dk.due+' due days in the last 5 weeks.':'');

  // metric chips
  const opts=[['score','Score'],['weight','Weight'],['waist','Waist']].concat(settings.habits.filter(x=>x.type==='count'||x.type==='duration'||x.type==='steps').map(x=>['h:'+x.id,x.name]));
  if(!opts.some(o=>o[0]===metric))metric='score';
  const ch=$('chips');
  if(ch.dataset.sig!==opts.map(o=>o.join('=')).join('|')){
    ch.dataset.sig=opts.map(o=>o.join('=')).join('|');ch.innerHTML='';
    opts.forEach(o=>{const b=h('<button class="chip"></button>');b.textContent=o[1];b.dataset.metric=o[0];b.addEventListener('click',()=>{metric=o[0];haptic('light');renderProgress()});ch.appendChild(b)});
  }
  ch.querySelectorAll('.chip').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.metric===metric)));
  drawChart();drawHoursChart();renderBmiCard();

  // calendar heat map: soft rounded squares, one per day
  const cells=period===7?7:period===30?35:91;
  const heat=$('heat');
  const hadFocus=heat.contains(document.activeElement)?[...heat.children].indexOf(document.activeElement):-1;
  heat.innerHTML='';
  const t=todayStr();
  rangeKeys(cells).forEach(k=>{
    const sc=isLogged(k)?scoreOf(days[k]):null;
    const c=h('<button class="hc"><i></i></button>');
    c.querySelector('i').textContent=parse(k).getDate();
    if(sc!=null)c.classList.add(scoreClass(sc));if(k===t)c.classList.add('today');
    c.setAttribute('aria-label',nice(k)+': '+(sc==null?'not logged':sc+' percent'+(sc>=80?', goal met':'')));
    c.addEventListener('click',()=>{haptic('light');daySheet(k)});
    c.tabIndex=-1;
    heat.appendChild(c);
  });
  // one tab stop for the whole calendar; arrow keys move between days (see the keydown handler below)
  const cellsEl=[...heat.children];
  (cellsEl[hadFocus>=0?hadFocus:cellsEl.length-1]||cellsEl[0]).tabIndex=0;
  if(hadFocus>=0&&cellsEl[hadFocus])cellsEl[hadFocus].focus({preventScroll:true});

  // recent days
  const ll=$('logList');ll.innerHTML='';
  logged.slice(-10).reverse().forEach(k=>{
    const sc=scoreOf(days[k]),d=days[k];
    const row=h('<button class="row"><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="pill"></span><svg data-ic="chevron-right" class="chev"></svg></button>');
    row.querySelector('.row-label').textContent=nice(k);
    const bits=settings.habits.filter(x=>(x.type==='count'||x.type==='duration'||x.type==='steps')&&d.vals&&d.vals[x.id]!=null).map(x=>x.name+' '+fmt(d.vals[x.id])+(x.type==='steps'&&stepsLabelFor(k)==='manual'?' ('+MANUAL_OLD+')':''));
    if(d.weight!=null)bits.push(fmtWeight(d.weight));
    row.querySelector('.row-sub').textContent=bits.join(', ')+(d.note?(bits.length?' · ':'')+d.note:'');
    if(!row.querySelector('.row-sub').textContent)row.querySelector('.row-sub').remove();else row.querySelector('.row-sub').classList.add('clamp');
    const pill=row.querySelector('.pill');pill.textContent=sc+'%';pill.classList.add(scoreClass(sc));
    row.addEventListener('click',()=>daySheet(k));
    ll.appendChild(row);
  });
}

const crosshair={id:'crosshair',afterDatasetsDraw(c){
  if(c._rlIdx==null)return;const el=c.getDatasetMeta(0).data[c._rlIdx];if(!el||el.skip)return;
  const {ctx,chartArea:a}=c;ctx.save();ctx.strokeStyle=c._rlLine;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(el.x,a.top);ctx.lineTo(el.x,a.bottom);ctx.stroke();
  ctx.fillStyle=c._rlColor;ctx.beginPath();ctx.arc(el.x,el.y,5,0,Math.PI*2);ctx.fill();ctx.restore()}};
function setReadout(vals,keys,idx,mi){
  const el=$('readout');
  let i=idx;
  if(i==null){for(let j=vals.length-1;j>=0;j--)if(vals[j]!=null){i=j;break}}
  if(i==null){el.innerHTML='<b>–</b><span>No entries in this '+RANGE_NAME[period]+'</span>';return}
  const b=document.createElement('b'),sp=document.createElement('span');
  b.textContent=fmt(vals[i])+' '+mi.unit;sp.textContent=(idx==null?'Latest · ':'')+nice(keys[i])+(mi.note?' · '+mi.note(keys[i]):'');
  el.innerHTML='';el.appendChild(b);el.appendChild(sp);
}
/* Chart look: colours are read fresh from the CSS tokens every time a chart is drawn (so a theme change shows up), and the font follows the root font size (large text). */
function chartLook(){
  const cs=getComputedStyle(document.documentElement),px=parseFloat(cs.fontSize)||16;
  return{accent:cs.getPropertyValue('--accent').trim(),muted:cs.getPropertyValue('--label2').trim(),sep:cs.getPropertyValue('--sep').trim(),
    font:{family:'Inter, system-ui, sans-serif',size:Math.round(px*.6875*10)/10}};
}
let chartKey=null;
function drawChart(){
  if(!window.Chart||activeTab!=='progress'||!Core.loggedKeys(days).length)return;
  const L=chartLook(),accent=L.accent,muted=L.muted,sep=L.sep;
  const mi=metricInfo(metric),keys=rangeKeys(period);
  const vals=keys.map(k=>Core.hasRecord(days[k])?mi.get(days[k]):null).map(v=>v==null?null:v);
  const have=vals.filter(v=>v!=null);
  setReadout(vals,keys,null,mi);
  // a marker on every logged day while there are few enough to tell apart; the line is monotone so it never overshoots the data
  const ds=[{data:vals,borderColor:accent,borderWidth:2.5,tension:0,cubicInterpolationMode:'monotone',spanGaps:true,pointRadius:have.length<=20?3:0,pointHoverRadius:0,pointBackgroundColor:accent,pointBorderColor:accent,fill:false}];
  if(mi.target!=null)ds.push({data:keys.map(()=>mi.target),borderColor:muted,borderDash:[4,4],borderWidth:1,pointRadius:0,pointHoverRadius:0,fill:false,order:2});
  const lg=$('chartLegend');lg.hidden=mi.target==null;
  if(mi.target!=null)lg.querySelector('span').textContent='Target '+fmt(mi.target)+(mi.unit?' '+mi.unit:'');
  // accessible summary (the canvas itself is hidden from assistive tech)
  const summ=have.length<1?mi.name+': no entries in the last '+RANGE_NAME[period]+'.':mi.name+' over the last '+RANGE_NAME[period]+': '+have.length+(have.length===1?' entry':' entries')+
    (have.length>1?', from '+fmt(have[0])+' to '+fmt(have[have.length-1])+' '+mi.unit:', '+fmt(have[0])+' '+mi.unit)+'; lowest '+fmt(Math.min(...have))+', highest '+fmt(Math.max(...have))+'.'+(mi.target!=null?' Target '+fmt(mi.target)+' '+mi.unit+'.':'');
  $('chartSummary').textContent=summ;
  // announce only when the metric or the range changed (not while scrubbing, not on every save)
  const key=metric+'|'+period;
  if(chartKey!==null&&chartKey!==key)$('chartAnnounce').textContent=summ;
  chartKey=key;
  if(chart)chart.destroy();
  const fnt=L.font;
  chart=new Chart($('chart'),{type:'line',data:{labels:keys.map(k=>parse(k).toLocaleDateString(undefined,{day:'numeric',month:'short'})),datasets:ds},
    plugins:[crosshair],
    options:{responsive:true,maintainAspectRatio:false,animation:reduced()?false:{duration:450},
      interaction:{mode:'nearest',axis:'x',intersect:false},events:['mousemove','mouseout','click','touchstart','touchmove'],
      plugins:{legend:{display:false},tooltip:{enabled:false}},
      layout:{padding:{top:8,right:4}},
      scales:{x:{grid:{display:false},border:{display:false},ticks:{color:muted,maxTicksLimit:5,maxRotation:0,font:fnt}},
              y:{grid:{color:sep},border:{display:false},ticks:{color:muted,maxTicksLimit:4,font:fnt},min:metric==='score'?0:undefined,max:metric==='score'?100:undefined,grace:'8%'}},
      onHover(e,els,c){
        if(els&&els.length&&els[0].datasetIndex===0){c._rlIdx=els[0].index;setReadout(vals,keys,els[0].index,mi)}
        else if(e.type==='mouseout'){c._rlIdx=null;setReadout(vals,keys,null,mi)}
        c.draw();
      }}});
  chart._rlColor=accent;chart._rlLine=sep;
}

let hoursChart=null;
function drawHoursChart(){
  const today=days[todayStr()],m=today&&today.steps_meta;
  const show=stepsAuto()&&!!m&&m.hourly&&m.hourly.some(v=>v>0);
  $('hoursHead').hidden=!show;$('hoursCard').hidden=!show;
  if(!show){if(hoursChart){hoursChart.destroy();hoursChart=null}return}
  if(!window.Chart||activeTab!=='progress')return;
  if(hoursChart)hoursChart.destroy();
  const r=makeHoursChart($('chartHours'),m.hourly,'today');
  hoursChart=r.chart;$('hoursSummary').textContent=r.summary;
}

function daySheet(k){
  const d=Core.hasRecord(days[k])?days[k]:null,root=h('<div></div>');
  const sc=d?scoreOf(d):null;
  if(!d){
    root.appendChild(h('<div class="empty"><svg data-ic="calendar"></svg><p>Not logged. Start again whenever you are ready.</p></div>'));
  }else{
    const top=h('<div class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span class="t-head"></span><span class="pill"></span></div>');
    top.querySelector('.t-head').textContent='Daily score';const pl=top.querySelector('.pill');pl.textContent=sc+'%';pl.classList.add(scoreClass(sc));root.appendChild(top);
    const g1=h('<div class="group" style="margin-bottom:12px"></div>');
    const cardHabits=settings.habits.filter(x=>(x.type==='count'||x.type==='duration'||x.type==='steps')&&!x.hidden&&(Core.isShown(x,k,days)));
    cardHabits.forEach(x=>{const v=Number((d.vals||{})[x.id]||0),met=x.target>0&&v>=x.target;
      const r=h('<div class="row"><span class="row-body"><span class="row-label"></span></span><span class="row-val"></span></div>');
      r.querySelector('.row-label').textContent=x.name;
      if(x.type==='steps'&&stepsLabelFor(k)==='manual'){const sb=h('<span class="row-sub"></span>');sb.textContent=MANUAL_OLD;r.querySelector('.row-body').appendChild(sb)}
      const val=r.querySelector('.row-val');val.innerHTML=(met?icon('circle-check','sm')+' ':'');val.appendChild(document.createTextNode(fmt(v)+' / '+fmt(x.target)+' '+x.unit));val.style.color=met?'var(--green)':'';val.style.maxWidth='70%';g1.appendChild(r)});
    if(cardHabits.length)root.appendChild(g1);
    const yn=settings.habits.filter(x=>x.type==='yesno'&&!x.hidden&&Core.isShown(x,k,days));
    if(yn.length){
      const g2=h('<div class="group" style="margin-bottom:12px"></div>');
      yn.forEach(x=>{const kept=!!(d.rules||{})[x.id];
        const r=h('<div class="row"><span class="row-body"><span class="row-label"></span></span><span class="row-val"></span></div>');
        r.querySelector('.row-label').textContent=x.name;const val=r.querySelector('.row-val');val.innerHTML=icon(kept?'check':'minus','sm')+' ';val.appendChild(document.createTextNode(kept?'Done':'Not done'));val.style.color=kept?'var(--green)':'';g2.appendChild(r)});
      root.appendChild(g2);
    }
    const bits=[];if(d.weight!=null)bits.push(['Weight',fmtWeight(d.weight)]);if(d.waist!=null)bits.push(['Waist',fmtWaist(d.waist)]);
    const bb=d.weight!=null&&heightCm()!=null?Core.bmi(d.weight,heightCm()):null;if(bb!=null)bits.push(['BMI',Core.bmiRound(bb).toFixed(1)+' · '+catName(Core.bmiCategory(bb,bmiScale()))]);
    if(bits.length){const g3=h('<div class="group" style="margin-bottom:12px"></div>');bits.forEach(b=>{const r=h('<div class="row"><span class="row-body"><span class="row-label"></span></span><span class="row-val"></span></div>');r.querySelector('.row-label').textContent=b[0];r.querySelector('.row-val').textContent=b[1];g3.appendChild(r)});root.appendChild(g3)}
    if(d.note){const c=h('<div class="card" style="margin-bottom:12px"><span class="t-foot muted">Note</span><p style="margin:4px 0 0;overflow-wrap:anywhere"></p></div>');c.querySelector('p').textContent=d.note;root.appendChild(c)}
  }
  const go=h('<button class="btn"></button>');go.textContent=d?'Edit this day':'Log this day';
  root.appendChild(go);
  const sh=openSheet({title:nice(k),left:null,right:'Done',content:root});
  go.addEventListener('click',()=>{sh.close('cancel');goTo(k);showTab('today')});
}
document.querySelectorAll('#seg button').forEach(b=>b.addEventListener('click',()=>{period=Number(b.dataset.range);haptic('light');renderProgress()}));
$('progGo').addEventListener('click',()=>showTab('today'));

/* ---------- account and sync (rows on the Settings screen) ---------- */
function renderSyncStatus(){
  const el=$('syncStatus'),n=pendingCount();
  if(!signedIn()){el.textContent='';return}
  const waiting=n?n+(n===1?' change is':' changes are')+' waiting to sync':'';
  let t,bad=false;
  if(syncRunning)t='Syncing…';
  else if(syncError){t='Sync problem: '+syncError+(waiting?' ('+waiting+')':'');bad=true}
  else if(syncOffline&&n)t='Offline. '+waiting+'.';
  else if(n)t=waiting.charAt(0).toUpperCase()+waiting.slice(1)+'.';
  else if(sync.lastSyncAt)t='Synced at '+new Date(sync.lastSyncAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',hour12:true});
  else t='Not synced yet.';
  el.textContent=t;el.style.color=bad?'var(--red)':'';
  $('syncNowBtn').disabled=!!syncRunning;
}
function renderAccount(){
  const on=cloudConfigured(),inn=signedIn();
  $('acctOut').hidden=inn;$('acctIn').hidden=!inn;
  $('signInBtn').hidden=!on;$('acctOffNote').hidden=on;
  $('acctEmail').textContent=sync.email||'your account';
  renderSyncStatus();
}
let authSheet=null;
const authModalOpen=()=>!!authSheet;
function openAuth(){
  const root=h('<div><p class="info">Use the same email and password on each phone.</p><div class="field"><label for="authEmail">Email</label><div class="box"><input id="authEmail" type="email" placeholder="name@example.com" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" data-focus></div></div><div class="field"><label for="authPw">Password</label><div class="box"><input id="authPw" type="password" placeholder="At least 6 characters" autocomplete="current-password"></div></div><div class="msg" id="authMsg" role="alert"></div><div class="sheet-actions"><button class="btn" id="authIn">Sign in</button><button class="btn secondary" id="authUp">Create account</button></div></div>');
  authSheet=openSheet({title:'Sign in to sync',left:'Cancel',leftId:'authCancel',right:null,content:root,onCancel:()=>{authSheet=null}});
  root.querySelector('#authIn').addEventListener('click',()=>doAuth('in'));
  root.querySelector('#authUp').addEventListener('click',()=>doAuth('up'));
  root.querySelectorAll('input').forEach(i=>i.addEventListener('keydown',e=>{if(e.key==='Enter')doAuth('in')}));
}
function closeAuth(){if(authSheet){const a=authSheet;authSheet=null;a.close('cancel')}}
$('signInBtn').addEventListener('click',openAuth);
$('signOutBtn').addEventListener('click',async()=>{
  const r=await actionSheet({title:'Sign out?',message:'Your entries stay on this phone. They stop syncing until you sign in again.',actions:[{label:'Sign out',value:'out',destructive:true}]});
  if(r==='out')signOut();
});
function refreshAfterCloudChange(){renderToday();renderProgress();renderSetup()}
function refreshAll(){renderToday();renderProgress();renderSetup();showLastBackup();renderAccount()}

/* ================= onboarding ================= */
const ONB_KEY='comeback_onboarded';
let onb=null;
/* Onboarding. mode 'full' = first launch: welcome, starter plan, targets, reminder, then (Android app) one permission screen and brand help,
   then height and BMI scale. mode 'permissions' = existing users who still need the permission screen once (permissions, brand help, height).
   mode 'replay' = "Show intro again" (welcome page only). */
function showPermissionSetup(){showOnboarding({mode:'permissions'})}
function showOnboarding(opts){
  if(onb)return;
  const mode=(opts&&opts.mode)||'replay';
  const full=mode==='full';
  const stepFlow=stepsAvailable()&&mode!=='replay';   // permission screen and brand help only exist in the Android app
  const intro=mode!=='permissions';
  const edits={};
  let chosenScale=settings.body.scale||'standard',chosenHeight=null,chosenPlan=null;
  const root=h('<div class="onb" role="dialog" aria-modal="true" aria-label="'+(intro?'Welcome to Comeback':'Set up step counting')+'"><div class="onb-top"><button class="txtbtn" id="onbSkip">Skip</button></div><div class="onb-pages"><div class="onb-track" id="onbTrack"></div></div><div class="dots" id="onbDots" aria-hidden="true"></div><div class="onb-foot" id="onbFoot"></div></div>');
  root.querySelector('.onb-pages').addEventListener('scroll',e=>{e.target.scrollLeft=0});   // focusing an input on a page that is still sliding in must not shift the pages
  const track=root.querySelector('#onbTrack'),foot=root.querySelector('#onbFoot'),dotsEl=root.querySelector('#onbDots');
  const pages=[];   // [{id,el}]
  const addPage=(id,el,at)=>{const rec={id,el};if(at==null)pages.push(rec);else pages.splice(at,0,rec);track.innerHTML='';pages.forEach(q=>track.appendChild(q.el));layout()};
  const idx=id=>pages.findIndex(q=>q.id===id);
  function layout(){
    track.style.width=(pages.length*100)+'%';
    pages.forEach(q=>{q.el.style.width=(100/pages.length)+'%'});
    dotsEl.innerHTML=pages.map((_,i)=>'<i'+(i===page?' class="on"':'')+'></i>').join('');
    track.style.transform='translateX(-'+(page*100/pages.length)+'%)';
    pages.forEach((q,i)=>{if(i===page)q.el.removeAttribute('inert');else q.el.setAttribute('inert','')});   // pages that slid off screen must not take focus or be read
  }
  const art=(el,name)=>{el.querySelector('.onb-art').innerHTML=icon(name);return el};
  let page=0,permResult=null,reminderSwitch=null,nextBtn=null,bgFree=false;

  const targetHabits=()=>settings.habits.filter(x=>!x.hidden&&(x.type==='count'||x.type==='duration'||x.type==='steps'));
  function buildTargets(){
    const box=root.querySelector('#onbTargets');if(!box)return;
    box.innerHTML='';
    Object.keys(edits).forEach(k=>delete edits[k]);
    const list=targetHabits();
    if(!list.length){box.appendChild(h('<div class="row"><span class="row-label muted">No count targets in this plan. Add habits any time from Plan.</span></div>'));return}
    list.forEach(x=>{
      const r=h('<label class="row"><span class="row-label"></span><input class="numin" type="number" inputmode="decimal"></label>');
      r.querySelector('.row-label').textContent=x.name+' ('+x.unit+')';const i=r.querySelector('input');i.value=x.target;i.setAttribute('aria-label',x.name+' daily target');
      i.addEventListener('input',()=>{edits[x.id]=Number(i.value)});box.appendChild(r);
    });
  }

  if(intro){
    addPage('welcome',art(h('<div class="onb-page"><div class="onb-art"></div><h2>Get back to your best, one day at a time.</h2><p>Tap a card to log your workouts and water. Steps are counted by your phone. Tick the rules you kept. Everything saves by itself, and you can undo any change.</p></div>'),'trending-up'));
  }
  if(full){
    const pl=art(h('<div class="onb-page"><div class="onb-art"></div><h2>Pick a starting plan</h2><p>You can change everything later in Plan.</p><div class="group ic plan-pick" id="onbPlans" role="radiogroup" aria-label="Starter plan"></div></div>'),'sparkles');
    Core.STARTER_PLANS.forEach(p=>{
      const r=h('<button class="row planopt" role="radio" aria-checked="false"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="radio" aria-hidden="true"></span></button>');
      r.dataset.plan=p.id;r.id='plan-'+p.id;
      r.querySelector('.row-ic').innerHTML=icon(p.icon);r.querySelector('.row-label').textContent=p.name;r.querySelector('.row-sub').textContent=p.blurb;
      r.addEventListener('click',()=>{
        haptic('light');chosenPlan=p.id;
        pl.querySelectorAll('.planopt').forEach(b=>{const on=b===r;b.setAttribute('aria-checked',String(on));b.classList.toggle('sel',on)});
        if(nextBtn)nextBtn.disabled=false;
      });
      pl.querySelector('#onbPlans').appendChild(r);
    });
    addPage('plan',pl);
    const p2=art(h('<div class="onb-page"><div class="onb-art"></div><h2>Set your targets</h2><p>These are a starting point. Change a number now or later in Plan.</p><div class="group" id="onbTargets"></div></div>'),'target');
    addPage('targets',p2);
    const p3=art(h('<div class="onb-page"><div class="onb-art"></div><h2>Never miss a day</h2><p>Get one gentle reminder a day. Pick the time that suits you. You can change it any time in Settings.</p><div class="group"><label class="row"><span class="row-label">Daily reminder</span><input type="checkbox" class="switch" role="switch" id="onbRemOn" aria-label="Daily reminder" checked></label><label class="row"><span class="row-label">Reminder time</span><span id="onbTime"></span></label></div></div>'),'bell');
    reminderSwitch=p3.querySelector('#onbRemOn');
    initTime12(p3.querySelector('#onbTime'),'Reminder time');
    addPage('reminder',p3);
  }
  if(stepFlow){
    const pp=art(h('<div class="onb-page"><div class="onb-art"></div><h2>Let Comeback track for you</h2><p>Three quick permissions so counting works all day, even when the app is closed.</p><div class="group ic" id="onbPerms"></div></div>'),'footprints');
    [['footprints','Physical activity','To count steps and pause counting in vehicles.'],['bell','Notifications','For the daily reminder and the step counter notification.'],['battery-low','Battery','So step counting keeps running in the background.']].forEach(r=>{
      const row=h('<div class="row"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span></div>');
      row.querySelector('.row-ic').innerHTML=icon(r[0]);row.querySelector('.row-label').textContent=r[1];row.querySelector('.row-sub').textContent=r[2];pp.querySelector('#onbPerms').appendChild(row);
    });
    addPage('perm',pp);
  }
  if(full||stepFlow){
    const ph=art(h('<div class="onb-page"><div class="onb-art"></div><h2>Your height</h2><p>'+(full?'Used for your BMI and to estimate how far you walk. You can skip this and add it later in Settings.':'Used to estimate how far you walk. You can change it any time in Settings.')+'</p><div class="group"><label class="row"><span class="row-label">Height (cm)</span><input class="numin" id="onbHeight" type="number" inputmode="decimal" aria-label="Height in centimetres"></label></div><p class="err" id="onbHeightErr" role="alert"></p></div>'),'user');
    ph.querySelector('#onbHeight').value=settings.body.heightCm!=null?r1(settings.body.heightCm):(full?'':meta.steps.heightCm);
    addPage('height',ph);
  }
  if(full){
    const ps=art(h('<div class="onb-page"><div class="onb-art"></div><h2>Pick a BMI scale</h2><p>Healthy ranges differ a little by background. The Asian scale is recommended if you are of South, East or Southeast Asian background.</p><div class="group ic plan-pick" id="onbScales" role="radiogroup" aria-label="BMI scale"></div></div>'),'activity');
    [['standard','Standard (WHO)','Healthy range 18.5 to 24.9'],['asian','Asian (WHO Asia-Pacific)','Healthy range 18.5 to 22.9']].forEach(sc=>{
      const r=h('<button class="row planopt" role="radio"><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="radio" aria-hidden="true"></span></button>');
      r.id='scale-'+sc[0];r.querySelector('.row-label').textContent=sc[1];r.querySelector('.row-sub').textContent=sc[2];
      r.addEventListener('click',()=>{haptic('light');chosenScale=sc[0];ps.querySelectorAll('.planopt').forEach(b=>{const on=b.id==='scale-'+chosenScale;b.setAttribute('aria-checked',String(on));b.classList.toggle('sel',on)})});
      ps.querySelector('#onbScales').appendChild(r);
    });
    ps.querySelectorAll('.planopt').forEach(b=>{const on=b.id==='scale-'+chosenScale;b.setAttribute('aria-checked',String(on));b.classList.toggle('sel',on)});
    addPage('scale',ps);
  }
  hydrate(root);

  async function finish(applyReminder){
    let changed=!!chosenPlan;
    const ch=Object.keys(edits).filter(id=>edits[id]>0&&settings.habits.find(x=>x.id===id&&x.target!==edits[id]));
    if(ch.length){ch.forEach(id=>{settings.habits.find(x=>x.id===id).target=edits[id]});changed=true}
    if(full){
      if(chosenHeight!=null&&settings.body.heightCm!==chosenHeight){settings.body.heightCm=chosenHeight;meta.steps.heightCm=Math.round(chosenHeight);changed=true}
      if(settings.body.scale!==chosenScale){settings.body.scale=chosenScale;changed=true}
    }
    if(changed)await persistSettings();
    if(applyReminder){$('remTime').value=root.querySelector('#onbTime')?root.querySelector('#onbTime').value||'21:00':'21:00';$('remOn').checked=true;await setReminder(true)}
    try{await prefSet(ONB_KEY,'1')}catch(e){}
    refreshAll();
    root.style.opacity='0';root.style.transition='opacity .25s';root.setAttribute('inert','');
    if(!bgFree){bgFree=true;unlockBackground()}
    setTimeout(()=>{root.remove();onb=null},reduced()?20:260);
  }
  const btn=(label,id,cls,fn)=>{const b=h('<button class="btn'+(cls?' '+cls:'')+'" id="'+id+'"></button>');b.textContent=label;b.addEventListener('click',fn);foot.appendChild(b);return b};
  /* reads the height box. Returns {ok, cm} where cm is null when it was left empty */
  function readHeight(){
    const v=root.querySelector('#onbHeight').value.trim(),err=root.querySelector('#onbHeightErr');
    if(v===''){err.textContent='';return{ok:true,cm:null}}
    const n=Number(v);
    if(!(n>=100&&n<=230)){err.textContent='Enter a height between 100 and 230 cm';haptic('light');return{ok:false}}
    err.textContent='';return{ok:true,cm:Math.round(n*10)/10};
  }
  async function startAndFinish(){
    if(stepFlow)await enableStepCounting(chosenHeight!=null?Math.round(chosenHeight):undefined);
    await finish(!!(reminderSwitch&&reminderSwitch.checked));
  }
  function go(n){
    page=clamp(n,0,pages.length-1);layout();
    foot.innerHTML='';nextBtn=null;
    const id=pages[page].id;
    if(id==='welcome')nextBtn=btn(full?'Next':'Got it','onbNext','',()=>{if(full)go(page+1);else finish(false)});
    else if(id==='plan'){
      nextBtn=btn('Next','onbNext','',()=>{
        if(!chosenPlan)return;
        Core.applyStarterPlan(settings,chosenPlan);
        buildTargets();go(page+1);
      });
      nextBtn.disabled=!chosenPlan;
    }
    else if(id==='targets')nextBtn=btn('Next','onbNext','',()=>go(page+1));
    else if(id==='reminder')nextBtn=btn('Next','onbNext','',()=>go(page+1));
    else if(id==='perm'){
      const b=btn('Allow and continue','onbAllow','',async()=>{
        b.disabled=true;b.textContent='Asking…';
        permResult=await requestAllStepPermissions();
        let info={brand:'other'};try{info=await stepsPlugin().getDeviceInfo()}catch(e){}
        if(AGGRESSIVE_BRANDS.includes(info.brand)&&idx('brand')<0){
          const br=BRANDS[info.brand];
          const pb=art(h('<div class="onb-page"><div class="onb-art"></div><h2></h2><p>Your phone can close background apps to save battery. These steps keep Comeback counting.</p><div class="group" id="onbBrandTips"></div></div>'),'battery-low');
          pb.querySelector('h2').textContent='Keep counting on '+br.name.split(' / ')[0];
          br.tips.forEach((t,i)=>{const r=h('<div class="row"><span class="row-label" style="font-size:.9375rem"></span></div>');r.querySelector('.row-label').textContent=(i+1)+'. '+t;pb.querySelector('#onbBrandTips').appendChild(r)});
          pb.dataset.brand=info.brand;
          addPage('brand',pb,idx('perm')+1);
        }
        go(page+1);
      });
    }
    else if(id==='brand'){
      const brand=pages[page].el.dataset.brand;
      btn('Open '+BRANDS[brand].name.split(' / ')[0]+' settings','onbOpenBrand','',async()=>{
        try{await stepsPlugin().openSettings({target:'autostart'})}catch(e){}
        const sk=root.querySelector('#onbBrandNext');if(sk)sk.textContent='Continue';
      });
      btn('Skip for now','onbBrandNext','secondary',()=>go(page+1));
    }
    else if(id==='height'){
      if(full){
        btn('Next','onbNext','',()=>{const r=readHeight();if(!r.ok)return;chosenHeight=r.cm;go(page+1)});
      }else{
        btn('Start counting','onbStart','',async()=>{const r=readHeight();if(!r.ok)return;chosenHeight=r.cm;await startAndFinish()});
      }
    }
    else if(id==='scale'){
      btn(stepFlow?'Start counting':'Finish','onbStart','',startAndFinish);
    }
    root.querySelector('#onbSkip').hidden=!(id==='welcome'||id==='plan'||id==='targets')||(mode==='permissions')||mode==='replay';
  }
  root.querySelector('#onbSkip').addEventListener('click',()=>{
    if(stepFlow&&idx('perm')>=0)go(idx('perm'));
    else if(full&&idx('height')>=0)go(idx('height'));
    else finish(false);
  });
  onb={back(){if(page>0)go(page-1);else finish(false)}};
  document.body.appendChild(root);lockBackground();go(0);
}

/* ================= tabs, nav bar, native glue ================= */
const scrollPos={today:0,progress:0,setup:0,settings:0};
function updateNav(){
  const t=document.querySelector('.screen.on .large-title');if(!t)return;
  const nb=$('navbar'),bottom=t.getBoundingClientRect().bottom;
  nb.classList.toggle('compact',bottom<nb.offsetHeight+6);
}
function showTab(t){
  if(t!=='today'&&typeof editing!=='undefined'&&editing)exitEdit();
  scrollPos[activeTab]=window.scrollY;activeTab=t;
  document.querySelectorAll('.screen').forEach(p=>p.classList.toggle('on',p.id==='p-'+t));
  document.querySelectorAll('.tab').forEach(b=>{if(b.dataset.tab===t)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  const inSettings=t==='settings';
  $('navBack').hidden=!inSettings;$('gearBtn').hidden=inSettings;
  document.body.classList.toggle('in-settings',inSettings);
  window.scrollTo(0,scrollPos[t]||0);
  $('navTitle').textContent=document.querySelector('.screen.on .large-title').textContent;
  updateNav();
  if(t==='progress')requestAnimationFrame(renderProgress);
}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{if(activeTab!==b.dataset.tab){haptic('light');showTab(b.dataset.tab)}else window.scrollTo({top:0,behavior:reduced()?'auto':'smooth'})}));
window.addEventListener('scroll',updateNav,{passive:true});

function openToday(){closeAllLayers();showTab('today');if(current!==todayStr()){current=todayStr();renderToday()}}
function closeAllLayers(){while(layers.length)layers[layers.length-1].close('cancel')}
let lastToday=null;
/** Has the calendar day changed since the screen last looked? Then "today" moves on (and the screen with it, if it was showing today).
    Called when the app comes back, every minute while it is open (midnight can pass with the screen on), and before every change. */
function onResume(){
  const t=todayStr();if(t===lastToday)return false;
  const wasToday=current===lastToday;lastToday=t;
  if(wasToday){current=t;expandedDone.clear()}
  renderToday();renderProgress();
  return true;
}
setInterval(()=>{if(!document.hidden)onResume()},60_000);
function onForeground(){onResume();syncOnResume();stepsOnForeground()}
function initNativeGlue(){
  try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{syncBars();redrawCharts()})}catch(e){}
  syncBars();
  try{if(Native.Network)Native.Network.addListener('networkStatusChange',s=>{if(s.connected&&!document.hidden)syncSoon(true)})}catch(e){}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flushSave();else if(!IS_NATIVE)onForeground()});
  window.addEventListener('pagehide',flushSave);
  if(!IS_NATIVE)return;
  Native.App.addListener('backButton',()=>{
    if(closeTopLayer())return;
    if(onb){onb.back();return}
    if(editing){exitEdit();return}
    if(activeTab==='settings'){closeSettings();return}
    if(activeTab!=='today'){showTab('today');return}
    flushSave();
    Native.App.exitApp();
  });
  Native.App.addListener('appStateChange',s=>{if(s.isActive)onForeground();else{flushSave();stepsOnBackground()}});
  LN().addListener('localNotificationActionPerformed',()=>openToday());
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeTopLayer()});

/* ================= accessibility glue: radio groups, calendar, charts ================= */
/* Radio groups (role=radiogroup > role=radio, with aria-checked): one tab stop, arrow keys move and select. */
const radiosOf=g=>[...g.querySelectorAll('[role=radio]')].filter(r=>!r.disabled&&r.closest('[role=radiogroup]')===g);
function syncRoving(g){
  const rs=radiosOf(g);if(!rs.length)return;
  const on=rs.find(r=>r.getAttribute('aria-checked')==='true')||rs[0];
  rs.forEach(r=>{r.tabIndex=r===on?0:-1});
}
(function(){
  const todo=new Set();let raf=0;
  const queue=g=>{if(g){todo.add(g);if(!raf)raf=requestAnimationFrame(()=>{raf=0;todo.forEach(x=>{if(x.isConnected)syncRoving(x)});todo.clear()})}};
  new MutationObserver(ms=>{ms.forEach(m=>{
    if(m.type==='attributes'){queue(m.target.closest&&m.target.closest('[role=radiogroup]'));return}
    queue(m.target.closest&&m.target.closest('[role=radiogroup]'));
    m.addedNodes.forEach(n=>{if(n.nodeType!==1)return;if(n.matches('[role=radiogroup]'))queue(n);n.querySelectorAll('[role=radiogroup]').forEach(queue)});
  })}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-checked','disabled']});
  document.querySelectorAll('[role=radiogroup]').forEach(queue);
})();
document.addEventListener('keydown',e=>{
  const r=e.target.closest&&e.target.closest('[role=radio]');if(!r||e.altKey||e.ctrlKey||e.metaKey)return;
  const g=r.closest('[role=radiogroup]');if(!g)return;
  const d=e.key==='ArrowRight'||e.key==='ArrowDown'?1:e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:0;
  if(!d)return;
  const rs=radiosOf(g),i=rs.indexOf(r);if(i<0||rs.length<2)return;
  e.preventDefault();
  const next=rs[(i+d+rs.length)%rs.length],anchor=g.id||(g.closest('[id]')||{}).id;
  next.focus();next.click();
  // choosing a value may redraw the group (Settings does): put focus back on the same position
  [80,300,700].forEach(ms=>setTimeout(()=>{
    if(document.activeElement&&document.activeElement!==document.body)return;
    const A=anchor&&document.getElementById(anchor),G=A&&(A.matches('[role=radiogroup]')?A:A.querySelector('[role=radiogroup]'));
    const t=G&&radiosOf(G)[(i+d+rs.length)%rs.length];if(t)t.focus({preventScroll:true});
  },ms));
});
/* The calendar is one tab stop; arrows move between days (7 per row). */
$('heat').addEventListener('keydown',e=>{
  const c=e.target.closest&&e.target.closest('.hc');if(!c)return;
  const cs=[...$('heat').children],i=cs.indexOf(c);
  const n={ArrowRight:i+1,ArrowLeft:i-1,ArrowDown:i+7,ArrowUp:i-7,Home:i-i%7,End:Math.min(cs.length-1,i-i%7+6)}[e.key];
  if(n==null||n<0||n>=cs.length)return;
  e.preventDefault();c.tabIndex=-1;cs[n].tabIndex=0;cs[n].focus();
});
/* A lone last card in an odd run of cards takes the full row on phones (the CSS only applies it where there are two columns). */
function markSolo(){
  document.querySelectorAll('#sections .tsec-body').forEach(b=>{
    let run=[];const flush=()=>{if(run.length%2===1)run[run.length-1].classList.add('solo');run=[]};
    [...b.children].forEach(c=>{c.classList.remove('solo');if(c.classList.contains('hcard'))run.push(c);else flush()});
    flush();
  });
}
(function(){let raf=0;new MutationObserver(()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;markSolo()})}).observe($('sections'),{childList:true,subtree:true})})();
/* Every chart reads its colours from the CSS tokens when drawn, so a theme change just redraws them. */
function redrawCharts(){
  drawChart();drawHoursChart();
  if(typeof redrawBmiChart==='function')redrawBmiChart();
  try{
    const cv=document.getElementById('chartStepsSheet'),c=cv&&window.Chart&&Chart.getChart(cv);
    if(c){const L=chartLook();c.data.datasets[0].backgroundColor=L.accent;c.options.scales.x.ticks.color=L.muted;c.options.scales.y.ticks.color=L.muted;c.options.scales.y.grid.color=L.sep;c.update('none')}
  }catch(e){}
}
$('replayIntro').addEventListener('click',()=>showOnboarding({mode:'replay'}));

