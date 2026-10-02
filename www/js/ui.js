/* Reset Log UI: tabs, sheets, Today, Progress, Plan, onboarding.
   Presentation only. Data, storage, backup, reminder and sync logic is in logic.js. */

/* ================= basics ================= */
const ICONS=window.RL_ICONS||{};
const icon=(n,cls)=>'<svg class="ic'+(cls?' '+cls:'')+'" viewBox="0 0 24 24" aria-hidden="true">'+(ICONS[n]||'')+'</svg>';
function hydrate(root){(root||document).querySelectorAll('svg[data-ic]').forEach(s=>{s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.classList.add('ic');s.innerHTML=ICONS[s.dataset.ic]||'';s.removeAttribute('data-ic')})}
function h(html){const t=document.createElement('template');t.innerHTML=html.trim();const el=t.content.firstElementChild;hydrate(el);return el}
const reduced=()=>{try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}};
const fmt=n=>Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
let activeTab='today';

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
let lastFocus=null;
const modalOpen=()=>layers.length>0;
function closeTopLayer(){const t=layers[layers.length-1];if(!t)return false;t.close('cancel');return true}

function mountLayer(wrap,api){
  lastFocus=document.activeElement;
  layerEl.appendChild(wrap);layers.push(api);
  layerEl.style.pointerEvents='auto';
  requestAnimationFrame(()=>requestAnimationFrame(()=>wrap.classList.add('in')));
}
function unmountLayer(wrap,api){
  const i=layers.indexOf(api);if(i>=0)layers.splice(i,1);
  wrap.classList.remove('in');
  setTimeout(()=>{wrap.remove();if(!layers.length)layerEl.style.pointerEvents='none'},reduced()?160:330);
  try{if(lastFocus&&lastFocus.focus&&document.contains(lastFocus))lastFocus.focus({preventScroll:true})}catch(e){}
}

/* openSheet({title,left,right,content,onDone,onCancel,leftId}) -> {el,body,close,setDone}
   onDone may return false to keep the sheet open. */
function openSheet(o){
  const wrap=h('<div class="sheet-wrap"><div class="scrim"></div><section class="sheet" role="dialog" aria-modal="true"><div class="grab-zone"><div class="grabber"></div><div class="sheet-head"><span class="l"></span><h2></h2><span class="r"></span></div></div><div class="sheet-body"></div></section></div>');
  const sheet=wrap.querySelector('.sheet'),body=wrap.querySelector('.sheet-body');
  sheet.setAttribute('aria-label',o.title||'Sheet');
  wrap.querySelector('h2').textContent=o.title||'';
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
    wrap.querySelector('.asheet').setAttribute('aria-label',o.title||'Choose an action');
    if(o.title||o.message){const hd=h('<div class="ah"><b></b><span></span></div>');hd.querySelector('b').textContent=o.title||'';hd.querySelector('span').textContent=o.message||'';if(!o.title)hd.querySelector('b').remove();if(!o.message)hd.querySelector('span').remove();grp.appendChild(hd)}
    let closed=false;
    const api={el:wrap,close(v){if(closed)return;closed=true;unmountLayer(wrap,api);res(v===undefined?'cancel':v)}};
    o.actions.forEach(a=>{const b=h('<button class="ab"></button>');b.textContent=a.label;if(a.destructive)b.classList.add('destructive');b.addEventListener('click',()=>{haptic('light');api.close(a.value)});grp.appendChild(b)});
    const cb=wrap.querySelector('.cancel');cb.textContent=o.cancelLabel||'Cancel';cb.addEventListener('click',()=>api.close('cancel'));
    wrap.querySelector('.scrim').addEventListener('click',()=>api.close('cancel'));
    mountLayer(wrap,api);
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
  toastTimer=setTimeout(()=>{t.classList.remove('show');undoFn=null},o.undo?5000:2200);
}
$('toastUndo').addEventListener('click',()=>{const f=undoFn;undoFn=null;$('toast').classList.remove('show');if(f)f()});
let savedTimer=null;
function flashSaved(){const el=$('savedInd');el.classList.add('on');clearTimeout(savedTimer);savedTimer=setTimeout(()=>el.classList.remove('on'),1600)}

let saveTimer=null;const pendingSave=new Set();
function scheduleSave(k){pendingSave.add(k);clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,400)}
async function flushSave(){
  clearTimeout(saveTimer);
  if(!pendingSave.size)return;
  const keys=[...pendingSave];pendingSave.clear();
  try{await store.persist();flashSaved();keys.forEach(markDayDirty);autoBackup();syncSoon(false)}
  catch(e){keys.forEach(k=>pendingSave.add(k));toast("Couldn't save. Trying again.",{icon:'x'});clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,3000)}
}

/* ================= day data helpers ================= */
function blankDay(){return{vals:{},rules:{},weight:null,waist:null,note:'',date:current,updatedAt:0}}
function dayMetrics(d){
  const vals=(d&&d.vals)||{},rl=(d&&d.rules)||{};
  const hm=settings.habits.filter(x=>x.target>0&&Number(vals[x.id]||0)>=x.target).length;
  const rk=settings.rules.filter(r=>rl[r.id]).length;
  return{score:d?scoreOf(d):0,hMet:hm,hTotal:settings.habits.length,rKept:rk,rTotal:settings.rules.length,
    full:!!d&&hm===settings.habits.length&&rk===settings.rules.length&&(settings.habits.length+settings.rules.length)>0};
}
function streak(){let n=0;const d=new Date();if(!days[ymd(d)])d.setDate(d.getDate()-1);while(days[ymd(d)]&&scoreOf(days[ymd(d)])>=50){n++;d.setDate(d.getDate()-1)}return n}
const addDays=(k,n)=>{const d=parse(k);d.setDate(d.getDate()+n);return ymd(d)};
function bestStreak(){
  const ks=Object.keys(days).filter(k=>scoreOf(days[k])>=50).sort();let best=0,run=0,prev=null;
  ks.forEach(k=>{run=prev&&addDays(prev,1)===k?run+1:1;if(run>best)best=run;prev=k});
  return best;
}
function lastValue(key){
  const ks=Object.keys(days).filter(k=>k<current&&days[k][key]!=null).sort();
  return ks.length?days[ks[ks.length-1]][key]:null;
}
const HICON={steps:'footprints',walk:'timer',pushups:'dumbbell',pullups:'dumbbell',squats:'dumbbell',plank:'timer',water:'droplets',sleep:'moon'};
const UICON={steps:'footprints',min:'timer',sec:'timer',reps:'dumbbell',litres:'droplets',hours:'moon'};
const hIcon=x=>HICON[x.id]||UICON[x.unit]||'target';
const stepFor=x=>x.unit==='steps'?500:(x.target<10?0.5:5);
function presetsFor(x){
  const u=x.unit;
  if(u==='steps')return[500,1000];if(u==='reps')return[5,10];if(u==='min')return[5,10];if(u==='sec')return[10,30];
  if(u==='litres')return[0.25,0.5];if(u==='hours')return[0.5,1];
  const s=stepFor(x);return[s,s*2];
}

/* One change = one auto-saved write, one undo step, and (maybe) a small celebration. */
function commitDay(label,mutate,quiet){
  const k=current;
  const prev=days[k]?clone(days[k]):null;
  const before=dayMetrics(prev),streakBefore=streak();
  const d=prev?clone(prev):blankDay();
  mutate(d);
  d.date=k;d.updatedAt=Date.now();
  days[k]=d;
  scheduleSave(k);
  const after=dayMetrics(d),streakAfter=streak();
  renderToday(true);renderProgress();
  const undo=()=>{
    if(prev){days[k]=Object.assign(clone(prev),{updatedAt:Date.now()})}
    else if(signedIn()){days[k]=Object.assign(blankDay(),{date:k,updatedAt:Date.now()})}
    else delete days[k];
    scheduleSave(k);renderToday();renderProgress();haptic('light');toast('Change undone',{icon:'check'});
  };
  let msg=label,ic='circle-check',ok=false;
  if(after.full&&!before.full){msg='All done today. Great work.';ic='sparkles';ok=true;celebrate()}
  else{
    const MILE=[3,5,7,10,14,21,30,50,100];
    const newlyMet=settings.habits.filter(x=>x.target>0&&Number((d.vals||{})[x.id]||0)>=x.target&&!(prev&&Number((prev.vals||{})[x.id]||0)>=x.target));
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
  const cols=['var(--accent)','var(--green)','var(--orange)','#AF52DE','#FF6482'];
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
  const set=v=>{buf=String(Math.max(o.min||0,r1(v)));fresh=true;show();haptic('light')};
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

/* ================= Today ================= */
const C=2*Math.PI*52;
let habitSig='',ringAnimated=false,ringOff=C;
function dayTitle(k){
  const d=parse(k);
  return{h1:d.toLocaleDateString(undefined,{day:'numeric',month:'long'}),weekday:d.toLocaleDateString(undefined,{weekday:'long'})};
}
function relLabel(k){
  const t=todayStr();if(k===t)return'Today';
  const y=ymd(new Date(Date.now()-864e5));if(k===y)return'Yesterday';
  return nice(k);
}
function renderToday(inPlace){
  const d=days[current],isToday=current===todayStr(),m=dayMetrics(d);
  const tt=dayTitle(current);
  $('todayTitle').textContent=tt.h1;
  $('todaySub').textContent=tt.weekday+(isToday?' · Today':d?'':' · Not logged');
  $('dayLabelText').textContent=relLabel(current);
  $('nextDay').disabled=current>=todayStr();
  if(activeTab==='today')$('navTitle').textContent=tt.h1;

  // ring
  const prg=$('ringPrg');
  ringOff=C*(1-m.score/100);
  if(!ringAnimated){prg.style.strokeDashoffset=C;requestAnimationFrame(()=>requestAnimationFrame(()=>{prg.style.strokeDashoffset=ringOff}));ringAnimated=true}
  else prg.style.strokeDashoffset=ringOff;
  prg.style.opacity=m.score>0?'1':'0';
  $('headScore').textContent=(d?m.score:0)+'%';
  $('ringCap').textContent=m.full?'All done':(isToday?'of today':'of the day');
  $('ring').classList.toggle('done',m.full);
  $('ring').setAttribute('aria-label',(isToday?"Today's":'This day\'s')+' score '+(d?m.score:0)+' percent. '+m.hMet+' of '+m.hTotal+' targets met, '+m.rKept+' of '+m.rTotal+' rules kept.');
  const ct=$('chipTargets');ct.classList.toggle('ok',m.hTotal>0&&m.hMet===m.hTotal);ct.querySelector('span').textContent=m.hMet+' of '+m.hTotal+' targets';
  const cr=$('chipRules');cr.classList.toggle('ok',m.rTotal>0&&m.rKept===m.rTotal);cr.querySelector('span').textContent=m.rKept+' of '+m.rTotal+' rules';
  const st=streak(),best=bestStreak();
  $('streakLine').querySelector('span').textContent=st>0?st+'-day streak':(best>0?'Start again today':'Log a day to start a streak');
  $('todayHint').textContent=!d?(isToday?'Nothing logged yet. Tap a target to start.':'This day was not logged. You can fill it in now.'):(m.full?'All done. Nice work today.':'');
  $('todayHint').hidden=!$('todayHint').textContent;

  // habit cards
  const sig=settings.habits.map(x=>[x.id,x.name,x.unit,x.target].join('|')).join('~');
  const list=$('habitList');
  if(sig!==habitSig||!inPlace&&!list.children.length){habitSig=sig;buildHabitCards()}
  settings.habits.forEach((x,i)=>{
    const card=list.children[i];if(!card)return;
    const v=Number(((d&&d.vals)||{})[x.id]||0),met=x.target>0&&v>=x.target;
    card.classList.toggle('met',met);
    card.querySelector('.hval').textContent=fmt(v);
    card.querySelector('.bar i').style.width=Math.min(100,x.target>0?v/x.target*100:0)+'%';
    card.querySelector('.met-ic').innerHTML=met?icon('circle-check','sm'):'';
    let extra='';
    const src=card.querySelector('.hsrc');
    if(x.id==='steps'&&stepsAvailable()){
      const lab=stepsLabelFor(current);
      src.innerHTML='';
      if(lab){
        src.innerHTML=icon(lab==='counted'?'smartphone':'pencil')+'<span></span>';
        const km=v>0?' · '+fmtKm(kmFor(v)):'';
        src.querySelector('span').textContent=(lab==='counted'?'Counted by phone':'Edited manually')+km;
        extra=', '+(lab==='counted'?'counted by phone':'edited manually')+(v>0?', about '+fmtKm(kmFor(v)):'');
      }
    }
    card.setAttribute('aria-label',x.name+', '+fmt(v)+' of '+fmt(x.target)+' '+x.unit+(met?', target met':'')+extra+'. Tap to edit.');
  });

  // rules
  const rl=$('ruleList');
  const rsig=settings.rules.map(r=>r.id+'|'+r.name).join('~');
  if(rl.dataset.sig!==rsig){
    rl.dataset.sig=rsig;rl.innerHTML='';
    settings.rules.forEach(r=>{
      const row=h('<label class="row rule-row"><span class="row-label"></span><input type="checkbox" class="switch" role="switch"></label>');
      row.querySelector('.row-label').textContent=r.name;
      const sw=row.querySelector('input');sw.setAttribute('aria-label',r.name);sw.dataset.id=r.id;
      sw.addEventListener('change',()=>{commitDay(r.name+(sw.checked?': kept':': not kept'),dd=>{dd.rules[r.id]=sw.checked})});
      rl.appendChild(row);
    });
    if(!settings.rules.length)rl.appendChild(h('<div class="row"><span class="row-label muted">No rules yet. Add some in Plan.</span></div>'));
  }
  rl.querySelectorAll('input.switch').forEach(sw=>{sw.checked=!!((d&&d.rules)||{})[sw.dataset.id]});

  // body + note
  const bl=$('bodyList');
  if(!bl.children.length){
    bl.appendChild(h('<button class="row" id="rowWeight"><span class="row-ic"><svg data-ic="scale"></svg></span><span class="row-body"><span class="row-label">Weight</span></span><span class="row-val"></span><svg data-ic="chevron-right" class="chev"></svg></button>'));
    bl.appendChild(h('<button class="row" id="rowWaist"><span class="row-ic"><svg data-ic="ruler"></svg></span><span class="row-body"><span class="row-label">Waist</span></span><span class="row-val"></span><svg data-ic="chevron-right" class="chev"></svg></button>'));
    $('rowWeight').addEventListener('click',()=>bodySheet('weight'));$('rowWaist').addEventListener('click',()=>bodySheet('waist'));
    $('noteList').appendChild(h('<button class="row" id="rowNote"><span class="row-ic"><svg data-ic="notebook-pen"></svg></span><span class="row-body"><span class="row-label">Note</span><span class="row-sub" id="noteSub"></span></span><svg data-ic="chevron-right" class="chev"></svg></button>'));
    $('rowNote').addEventListener('click',noteSheet);
  }
  const body=(key,unit,id)=>{const v=d&&d[key]!=null?d[key]:null,last=lastValue(key);const el=$(id).querySelector('.row-val');
    if(v!=null){el.textContent=fmt(v)+' '+unit;el.style.color='var(--label)'}
    else{el.textContent=last!=null?'Last: '+fmt(last)+' '+unit:'Add';el.style.color=''}
    $(id).setAttribute('aria-label',(key==='weight'?'Weight':'Waist')+', '+(v!=null?fmt(v)+' '+unit:'not set')+'. Tap to edit.')};
  body('weight','kg','rowWeight');body('waist','cm','rowWaist');
  const note=(d&&d.note)||'';const ns=$('noteSub');ns.textContent=note?note.split('\n')[0]:'What you ate, how you felt.';ns.style.color=note?'var(--label)':'';
}
function buildHabitCards(){
  const list=$('habitList');list.innerHTML='';
  settings.habits.forEach(x=>{
    const c=h('<button class="hcard"><span class="hcard-top"><span class="hico"></span><span class="met-ic"></span></span><span class="hname"></span><span class="hval num"></span><span class="htgt"></span><span class="hsrc"></span><span class="bar"><i></i></span></button>');
    c.querySelector('.hico').innerHTML=icon(hIcon(x),'sm');
    c.querySelector('.hname').textContent=x.name;c.querySelector('.htgt').textContent='of '+fmt(x.target)+' '+x.unit;
    c.dataset.id=x.id;
    let timer=null,long=false;
    c.addEventListener('pointerdown',()=>{long=false;clearTimeout(timer);timer=setTimeout(()=>{long=true;haptic('medium');habitPresets(x)},520)});
    ['pointerup','pointerleave','pointercancel','pointermove'].forEach(ev=>c.addEventListener(ev,e=>{if(ev==='pointermove'&&Math.abs(e.movementX)+Math.abs(e.movementY)<3)return;clearTimeout(timer)}));
    c.addEventListener('click',e=>{if(long){long=false;e.preventDefault();return}habitSheet(x)});
    c.addEventListener('contextmenu',e=>e.preventDefault());
    list.appendChild(c);
  });
}
function curVal(x){const d=days[current];return d&&d.vals&&d.vals[x.id]!=null?d.vals[x.id]:null}
function habitSheet(x){
  const p=presetsFor(x);
  let unitLine='of '+fmt(x.target)+' '+x.unit,extras=[];
  if(x.id==='steps'&&stepsAvailable()&&dayInAutoRange(current)){
    const m=days[current]&&days[current].steps_meta;
    if(m&&m.source==='manual'){
      unitLine+=' · edited manually';
      extras=[{label:'Use counted steps ('+fmt(m.counted)+')',onClick:sh=>{sh.close('cancel');commitDay('Using counted steps',d=>{useCountedSteps(d)})}}];
    }else unitLine+=' · counted by phone. Enter a number to change this day.';
  }
  numberSheet({title:x.name,value:curVal(x),unitLine,step:stepFor(x),extras,
    presets:p.map(a=>({label:'+'+fmt(a),apply:v=>v+a})).concat([{label:'Target',set:x.target}]),
    onDone:v=>{if(v===curVal(x))return;commitDay(x.name+' updated',d=>{setHabitValue(d,x,v)})}});
}
function habitPresets(x){
  const p=presetsFor(x),v=Number(curVal(x)||0);
  actionSheet({title:x.name,message:fmt(v)+' of '+fmt(x.target)+' '+x.unit,actions:[
    {label:'Add '+fmt(p[0])+' '+x.unit,value:'a'},{label:'Add '+fmt(p[1])+' '+x.unit,value:'b'},{label:'Set to target ('+fmt(x.target)+')',value:'t'}
  ]}).then(r=>{
    if(r==='a')commitDay(x.name+' +'+fmt(p[0]),d=>{setHabitValue(d,x,r1((d.vals[x.id]||0)+p[0]))});
    else if(r==='b')commitDay(x.name+' +'+fmt(p[1]),d=>{setHabitValue(d,x,r1((d.vals[x.id]||0)+p[1]))});
    else if(r==='t')commitDay(x.name+' set to target',d=>{setHabitValue(d,x,x.target)});
  });
}
function bodySheet(key){
  const isW=key==='weight',unit=isW?'kg':'cm',d=days[current],last=lastValue(key);
  numberSheet({title:isW?'Weight':'Waist',value:d&&d[key]!=null?d[key]:null,unitLine:unit+(isW?' · weigh in the morning, before eating':' · every 2 weeks is enough'),step:isW?0.1:0.5,
    placeholder:last!=null?fmt(last):'0',
    presets:last!=null?[{label:'Use last ('+fmt(last)+')',set:last}]:[],
    validate:v=>v==null?'':(isW?(v<30||v>250?'Check the weight value':''):(v<40||v>200?'Check the waist value':'')),
    onDone:v=>{const cur=d&&d[key]!=null?d[key]:null;if(v===cur)return;commitDay((isW?'Weight':'Waist')+' saved',dd=>{dd[key]=v})}});
}
function noteSheet(){
  const d=days[current];
  const root=h('<div class="field"><label for="noteTa">Note</label><div class="box"><textarea id="noteTa" data-focus placeholder="Had daal and roti for lunch, walked after dinner, skipped the late snack."></textarea></div></div>');
  const ta=root.querySelector('textarea');ta.value=(d&&d.note)||'';
  openSheet({title:'Note',content:root,onDone:()=>{const v=ta.value.trim();if(v===((d&&d.note)||''))return;commitDay('Note saved',dd=>{dd.note=v})}});
}
function dateSheet(){
  const root=h('<div><div class="field"><label for="dateIn">Day</label><div class="box"><input type="date" id="dateIn" data-focus></div></div><button class="btn secondary" id="dateToday">Go to today</button></div>');
  const inp=root.querySelector('input');inp.value=current;inp.max=todayStr();
  const sh=openSheet({title:'Choose a day',content:root,onDone:()=>{if(inp.value&&inp.value<=todayStr())goTo(inp.value)}});
  root.querySelector('#dateToday').addEventListener('click',()=>{sh.close('cancel');goTo(todayStr())});
}
function goTo(k){flushSave();current=k;renderToday();window.scrollTo(0,0)}
$('prevDay').addEventListener('click',()=>{const d=parse(current);d.setDate(d.getDate()-1);goTo(ymd(d));haptic('light')});
$('nextDay').addEventListener('click',()=>{const d=parse(current);d.setDate(d.getDate()+1);if(ymd(d)<=todayStr()){goTo(ymd(d));haptic('light')}});
$('dayLabel').addEventListener('click',dateSheet);

/* ================= Progress ================= */
let period=30,metric='score',chart=null;
const rangeKeys=n=>{const out=[],t=todayStr();for(let i=n-1;i>=0;i--)out.push(addDays(t,-i));return out};
const RANGE_NAME={7:'week',30:'month',90:'3 months'};
function metricInfo(m){
  if(m==='score')return{name:'Daily score',unit:'%',get:d=>scoreOf(d)};
  if(m==='weight')return{name:'Weight',unit:'kg',get:d=>d.weight};
  if(m==='waist')return{name:'Waist',unit:'cm',get:d=>d.waist};
  const x=settings.habits.find(q=>'h:'+q.id===m);
  if(x)return{name:x.name,unit:x.unit,get:d=>d.vals&&d.vals[x.id]!=null?d.vals[x.id]:null,target:x.target,note:x.id==='steps'?k=>{const d=days[k];return d&&d.steps_meta?(d.steps_meta.source==='auto'?'Counted by phone':'Edited manually'):'Entered manually'}:null};
  return metricInfo('score');
}
function changeIn(keys,key){
  const ks=keys.filter(k=>days[k]&&days[k][key]!=null);
  return ks.length<2?null:r1(days[ks[ks.length-1]][key]-days[ks[0]][key]);
}
const signed=(n,u)=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n))+' '+u;
function scoreClass(s){return s>=80?'g':s>=40?'o':'r'}
function renderProgress(){
  const empty=!Object.keys(days).length;
  $('progEmpty').hidden=!empty;$('progBody').hidden=empty;
  document.querySelectorAll('#seg button').forEach(b=>b.setAttribute('aria-selected',String(Number(b.dataset.range)===period)));
  $('progressSub').textContent=empty?'':'Last '+(period===7?'7 days':period===30?'30 days':'3 months');
  if(empty){if(chart){chart.destroy();chart=null}return}
  const rk=rangeKeys(period),inR=rk.filter(k=>days[k]);
  const st=streak(),best=bestStreak();
  $('sStreak').textContent=st+(st===1?' day':' days');
  $('sDays').textContent=inR.length;$('sDaysSub').textContent='in the last '+RANGE_NAME[period];
  const wc=changeIn(rk,'weight'),wa=changeIn(rk,'waist');
  $('sWeight').textContent=wc==null?'–':signed(wc,'kg');$('sWeightSub').textContent=wc==null?'Needs 2 entries':'this '+RANGE_NAME[period];
  $('sWaist').textContent=wa==null?'–':signed(wa,'cm');$('sWaistSub').textContent=wa==null?'Needs 2 entries':'this '+RANGE_NAME[period];
  const withSteps=rk.filter(k=>days[k]&&days[k].vals&&days[k].vals.steps!=null);
  if(withSteps.length){
    const avg=Math.round(withSteps.reduce((a,k)=>a+days[k].vals.steps,0)/withSteps.length);
    $('sAvgSteps').textContent=fmt(avg);$('sAvgStepsSub').textContent='over '+withSteps.length+(withSteps.length===1?' day':' days');
    $('sAvgDist').textContent=fmtKm(kmFor(avg));$('sAvgDistSub').textContent='a day, at '+meta.steps.heightCm+' cm tall';
  }else{$('sAvgSteps').textContent='–';$('sAvgStepsSub').textContent='No steps logged yet';$('sAvgDist').textContent='–';$('sAvgDistSub').textContent=''}
  $('streakNote').textContent=st>0?(best>st?'Your best streak was '+best+' days.':'This is your best streak yet.'):(best>0?'Start again today. Your best streak was '+best+' days.':'Log a day to start your streak.');

  // metric chips
  const opts=[['score','Score'],['weight','Weight'],['waist','Waist']].concat(settings.habits.map(x=>['h:'+x.id,x.name]));
  if(!opts.some(o=>o[0]===metric))metric='score';
  const ch=$('chips');
  if(ch.dataset.sig!==opts.map(o=>o.join('=')).join('|')){
    ch.dataset.sig=opts.map(o=>o.join('=')).join('|');ch.innerHTML='';
    opts.forEach(o=>{const b=h('<button class="chip"></button>');b.textContent=o[1];b.dataset.metric=o[0];b.addEventListener('click',()=>{metric=o[0];haptic('light');renderProgress()});ch.appendChild(b)});
  }
  ch.querySelectorAll('.chip').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.metric===metric)));
  drawChart();drawHoursChart();

  // calendar heat map: soft rounded squares, one per day
  const cells=period===7?7:period===30?35:91;
  const heat=$('heat');heat.innerHTML='';
  const t=todayStr();
  rangeKeys(cells).forEach(k=>{
    const sc=days[k]?scoreOf(days[k]):null;
    const c=h('<button class="hc"><i></i></button>');
    c.querySelector('i').textContent=parse(k).getDate();
    if(sc!=null)c.classList.add(scoreClass(sc));if(k===t)c.classList.add('today');
    c.setAttribute('aria-label',nice(k)+': '+(sc==null?'not logged':sc+' percent'+(sc>=80?', goal met':'')));
    c.addEventListener('click',()=>{haptic('light');daySheet(k)});
    heat.appendChild(c);
  });

  // recent days
  const ll=$('logList');ll.innerHTML='';
  Object.keys(days).sort().slice(-10).reverse().forEach(k=>{
    const sc=scoreOf(days[k]),d=days[k];
    const row=h('<button class="row"><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="pill"></span><svg data-ic="chevron-right" class="chev"></svg></button>');
    row.querySelector('.row-label').textContent=nice(k);
    const bits=settings.habits.filter(x=>d.vals&&d.vals[x.id]!=null).map(x=>x.name+' '+fmt(d.vals[x.id]));
    if(d.weight!=null)bits.push(fmt(d.weight)+' kg');
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
function drawChart(){
  if(!window.Chart||activeTab!=='progress'||!Object.keys(days).length)return;
  const cs=getComputedStyle(document.documentElement);
  const accent=cs.getPropertyValue('--accent').trim(),muted=cs.getPropertyValue('--label2').trim(),sep=cs.getPropertyValue('--sep').trim();
  const mi=metricInfo(metric),keys=rangeKeys(period);
  const vals=keys.map(k=>days[k]?mi.get(days[k]):null).map(v=>v==null?null:v);
  const have=vals.filter(v=>v!=null);
  setReadout(vals,keys,null,mi);
  const ds=[{data:vals,borderColor:accent,borderWidth:2.5,tension:.3,spanGaps:true,pointRadius:have.length<=3?4:0,pointHoverRadius:0,pointBackgroundColor:accent,fill:false}];
  if(mi.target!=null)ds.push({data:keys.map(()=>mi.target),borderColor:muted,borderDash:[4,4],borderWidth:1,pointRadius:0,pointHoverRadius:0,fill:false,order:2});
  // accessible summary
  const summ=have.length<1?mi.name+': no entries in the last '+RANGE_NAME[period]+'.':mi.name+' over the last '+RANGE_NAME[period]+': '+have.length+(have.length===1?' entry':' entries')+
    (have.length>1?', from '+fmt(have[0])+' to '+fmt(have[have.length-1])+' '+mi.unit:', '+fmt(have[0])+' '+mi.unit)+'; lowest '+fmt(Math.min(...have))+', highest '+fmt(Math.max(...have))+'.';
  $('chartSummary').textContent=summ;$('chart').setAttribute('aria-label',summ);
  if(chart)chart.destroy();
  const fnt={family:'Inter, system-ui, sans-serif',size:11};
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
  const cs=getComputedStyle(document.documentElement),accent=cs.getPropertyValue('--accent').trim(),muted=cs.getPropertyValue('--label2').trim(),sep=cs.getPropertyValue('--sep').trim();
  const labels=m.hourly.map((_,i)=>i===0?'12 AM':i===12?'12 PM':i<12?i+' AM':(i-12)+' PM');
  const best=m.hourly.indexOf(Math.max(...m.hourly));
  const total=m.hourly.reduce((a,b)=>a+b,0);
  const summ='Steps counted by your phone today by hour: '+fmt(total)+' in total. Most active hour: '+labels[best]+' with '+fmt(m.hourly[best])+' steps.';
  $('hoursSummary').textContent=summ;$('chartHours').setAttribute('aria-label',summ);
  if(hoursChart)hoursChart.destroy();
  const fnt={family:'Inter, system-ui, sans-serif',size:11};
  hoursChart=new Chart($('chartHours'),{type:'bar',data:{labels,datasets:[{data:m.hourly,backgroundColor:accent,borderRadius:3,maxBarThickness:14}]},
    options:{responsive:true,maintainAspectRatio:false,animation:reduced()?false:{duration:400},plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>labels[i[0].dataIndex],label:c=>fmt(c.parsed.y)+' steps'}}},
      scales:{x:{grid:{display:false},border:{display:false},ticks:{color:muted,maxRotation:0,autoSkip:false,font:fnt,callback:(v,i)=>i%6===0?labels[i]:''}},y:{grid:{color:sep},border:{display:false},beginAtZero:true,ticks:{color:muted,maxTicksLimit:4,font:fnt}}}}});
}

function daySheet(k){
  const d=days[k],root=h('<div></div>');
  const sc=d?scoreOf(d):null;
  if(!d){
    root.appendChild(h('<div class="empty"><svg data-ic="calendar"></svg><p>Not logged. Start again whenever you are ready.</p></div>'));
  }else{
    const top=h('<div class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span class="t-head"></span><span class="pill"></span></div>');
    top.querySelector('.t-head').textContent='Daily score';const pl=top.querySelector('.pill');pl.textContent=sc+'%';pl.classList.add(scoreClass(sc));root.appendChild(top);
    const g1=h('<div class="group" style="margin-bottom:12px"></div>');
    settings.habits.forEach(x=>{const v=Number((d.vals||{})[x.id]||0),met=x.target>0&&v>=x.target;
      const r=h('<div class="row"><span class="row-body"><span class="row-label"></span></span><span class="row-val"></span></div>');
      r.querySelector('.row-label').textContent=x.name;
      const val=r.querySelector('.row-val');val.innerHTML=(met?icon('circle-check','sm')+' ':'');val.appendChild(document.createTextNode(fmt(v)+' / '+fmt(x.target)+' '+x.unit));val.style.color=met?'var(--green)':'';val.style.maxWidth='70%';g1.appendChild(r)});
    root.appendChild(g1);
    if(settings.rules.length){
      const g2=h('<div class="group" style="margin-bottom:12px"></div>');
      settings.rules.forEach(x=>{const kept=!!(d.rules||{})[x.id];
        const r=h('<div class="row"><span class="row-body"><span class="row-label"></span></span><span class="row-val"></span></div>');
        r.querySelector('.row-label').textContent=x.name;const val=r.querySelector('.row-val');val.innerHTML=icon(kept?'check':'minus','sm')+' ';val.appendChild(document.createTextNode(kept?'Kept':'Not kept'));val.style.color=kept?'var(--green)':'';g2.appendChild(r)});
      root.appendChild(g2);
    }
    const bits=[];if(d.weight!=null)bits.push(['Weight',fmt(d.weight)+' kg']);if(d.waist!=null)bits.push(['Waist',fmt(d.waist)+' cm']);
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

/* ================= Plan ================= */
let reorderMode=false;
function attachSwipe(sw,row,del){
  let sx=0,sy=0,base=0,locked=false,tracking=false,open=false,suppress=false;
  const W=()=>parseFloat(getComputedStyle(document.documentElement).fontSize)*5.5;
  row.addEventListener('pointerdown',e=>{if(reorderMode||e.target.closest('.handle'))return;tracking=true;locked=false;sx=e.clientX;sy=e.clientY;base=open?-W():0});
  row.addEventListener('pointermove',e=>{
    if(!tracking)return;const dx=e.clientX-sx,dy=e.clientY-sy;
    if(!locked){if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){tracking=false;return}if(Math.abs(dx)>8){locked=true;sw.classList.add('drag');try{row.setPointerCapture(e.pointerId)}catch(x){}}}
    if(locked)row.style.transform='translateX('+clamp(base+dx,-W()-24,0)+'px)';
  });
  const end=e=>{
    if(!tracking)return;tracking=false;
    if(locked){const fin=base+(e.clientX-sx);open=fin<-W()/2;row.style.transform=open?'translateX(-'+W()+'px)':'';sw.classList.remove('drag');suppress=true;setTimeout(()=>suppress=false,60);if(open)haptic('light')}
  };
  row.addEventListener('pointerup',end);row.addEventListener('pointercancel',end);
  row.addEventListener('click',e=>{if(suppress){e.stopImmediatePropagation();e.preventDefault();return}if(open){e.stopImmediatePropagation();open=false;row.style.transform=''}},true);
  sw.querySelector('.swipe-del').addEventListener('click',()=>{del()});
}
function swipeRow(o){
  const sw=h('<div class="swipe"><button class="swipe-del" aria-label="Remove"></button><div class="row" role="button" tabindex="0"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span></span><span class="row-val"></span><svg data-ic="chevron-right" class="chev"></svg><span class="handle" role="button"></span></div></div>');
  sw.dataset.id=o.id;
  sw.querySelector('.swipe-del').innerHTML=icon('trash-2','sm')+'<span>Remove</span>';
  const row=sw.querySelector('.row');
  row.querySelector('.row-ic').innerHTML=icon(o.icon);row.querySelector('.row-label').textContent=o.label;
  const v=row.querySelector('.row-val');if(o.val)v.textContent=o.val;else v.remove();
  const hd=row.querySelector('.handle');hd.innerHTML=icon('grip-vertical');hd.setAttribute('aria-label','Reorder '+o.label);
  if(!o.reorder)hd.remove();
  row.setAttribute('aria-label',o.label+(o.val?', '+o.val:'')+'. Tap to edit.');
  row.addEventListener('click',()=>{if(!reorderMode)o.onTap()});
  row.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!reorderMode){e.preventDefault();o.onTap()}});
  attachSwipe(sw,row,o.onDelete);
  if(o.reorder)attachReorder(sw,hd);
  return sw;
}
function attachReorder(sw,handle){
  handle.addEventListener('pointerdown',e=>{
    if(!reorderMode)return;e.preventDefault();e.stopPropagation();
    handle.setPointerCapture(e.pointerId);sw.classList.add('dragging');haptic('medium');
    let startY=e.clientY;
    const move=ev=>{
      let dy=ev.clientY-startY;
      const next=sw.nextElementSibling,prev=sw.previousElementSibling;
      if(next&&next.classList.contains('swipe')&&dy>next.offsetHeight/2){sw.parentNode.insertBefore(next,sw);startY+=next.offsetHeight;dy=ev.clientY-startY;haptic('light')}
      else if(prev&&prev.classList.contains('swipe')&&dy<-prev.offsetHeight/2){sw.parentNode.insertBefore(sw,prev);startY-=prev.offsetHeight;dy=ev.clientY-startY;haptic('light')}
      sw.style.transform='translateY('+dy+'px)';
    };
    const up=()=>{
      handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);
      sw.classList.remove('dragging');sw.style.transform='';
      const order=[...$('setHabits').querySelectorAll('.swipe')].map(x=>x.dataset.id);
      if(order.join()!==settings.habits.map(x=>x.id).join()){settings.habits=order.map(id=>settings.habits.find(x=>x.id===id));persistSettings('Order updated')}
    };
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);
  });
}
function addRow(label,onTap,id){
  const b=h('<button class="row add-row"><span class="row-ic"></span><span class="row-body"><span class="row-label" style="color:var(--accent)"></span></span></button>');
  b.querySelector('.row-ic').innerHTML=icon('plus');b.querySelector('.row-label').textContent=label;b.addEventListener('click',onTap);if(id)b.id=id;return b;
}
function renderSetup(){
  const sh=$('setHabits');sh.innerHTML='';sh.classList.toggle('reorder',reorderMode);
  settings.habits.forEach(x=>sh.appendChild(swipeRow({id:x.id,icon:hIcon(x),label:x.name,val:fmt(x.target)+' '+x.unit,reorder:true,onTap:()=>habitForm(x),onDelete:()=>removeHabit(x)})));
  if(!reorderMode)sh.appendChild(addRow('Add target',()=>habitForm(null),'addHabitRow'));
  const sr=$('setRules');sr.innerHTML='';
  settings.rules.forEach(r=>sr.appendChild(swipeRow({id:r.id,icon:'circle-check',label:r.name,onTap:()=>ruleForm(r),onDelete:()=>removeRule(r)})));
  sr.appendChild(addRow('Add rule',()=>ruleForm(null),'addRuleRow'));
  renderStepGroup();
  $('reorderBtn').textContent=reorderMode?'Done':'Reorder';
  $('reorderBtn').setAttribute('aria-pressed',String(reorderMode));
  $('storeNote').textContent=IS_NATIVE?'Entries are saved on this phone and copied to Documents/ResetLog after every change.':'Entries are saved in this browser only.';
  $('bkHint').textContent=IS_NATIVE?'Your entries live on this phone. A copy is also saved to Documents/ResetLog after every change. Export one to keep it somewhere safe.':'Your entries live in this browser. Export a copy to keep it somewhere safe.';
}
async function persistSettings(msg){
  try{await store.persist();flashSaved();toast(msg);autoBackup();markSettingsDirty();syncSoon(false)}
  catch(e){toast("Couldn't save. Try again.",{icon:'x'})}
  renderSetup();renderToday();renderProgress();
}
async function confirmRemove(name,what){
  return(await actionSheet({title:'Remove '+name+'?',message:what||'Past entries stay saved.',actions:[{label:'Remove',value:'rm',destructive:true}]}))==='rm';
}
async function removeHabit(x){if(!(await confirmRemove(x.name)))return;settings.habits=settings.habits.filter(q=>q.id!==x.id);await persistSettings('Removed '+x.name)}
async function removeRule(r){if(!(await confirmRemove('this rule','Past entries stay saved.')))return;settings.rules=settings.rules.filter(q=>q.id!==r.id);await persistSettings('Rule removed')}
function formSheet(o){
  const root=h('<div>'+o.fields.map(f=>'<div class="field"><label for="'+f.id+'">'+esc(f.label)+'</label><div class="box"><input id="'+f.id+'" '+(f.type?'type="'+f.type+'" inputmode="decimal" ':'')+'placeholder="'+esc(f.ph||'')+'"'+(f.focus?' data-focus':'')+' autocomplete="off"></div></div>').join('')+'<div class="err" id="fErr" role="alert"></div>'+(o.remove?'<button class="btn secondary" id="fRemove" style="color:var(--red)">'+esc(o.remove.label)+'</button>':'')+'</div>');
  o.fields.forEach(f=>{root.querySelector('#'+f.id).value=f.value==null?'':f.value});
  const err=root.querySelector('#fErr');
  root.querySelectorAll('input').forEach(i=>i.addEventListener('input',()=>err.textContent=''));
  if(o.extraButton){const eb=h('<button class="btn secondary" style="margin-bottom:var(--s3)"></button>');eb.textContent=o.extraButton.label;eb.addEventListener('click',o.extraButton.onClick);root.insertBefore(eb,err)}
  const sh=openSheet({title:o.title,content:root,onDone:()=>{const v={};o.fields.forEach(f=>v[f.id]=root.querySelector('#'+f.id).value.trim());const e=o.validate(v);if(e){err.textContent=e;haptic('light');return false}o.onDone(v)}});
  if(o.remove)root.querySelector('#fRemove').addEventListener('click',async()=>{if(await o.remove.confirm()){sh.close('cancel');o.remove.run()}});
  return sh;
}
function habitForm(x){
  formSheet({title:x?'Edit target':'New target',
    fields:[{id:'fName',label:'Name',ph:'Pull-ups',value:x&&x.name,focus:!x},{id:'fTarget',label:'Daily target',ph:'10',type:'number',value:x&&x.target,focus:!!x},{id:'fUnit',label:'Unit',ph:'reps',value:x&&x.unit}],
    validate:v=>!v.fName?'Enter a name first':!(Number(v.fTarget)>0)?(x?'Target must be above 0':'Enter a daily target above 0'):'',
    onDone:v=>{
      if(x){x.name=v.fName;x.target=Number(v.fTarget);x.unit=v.fUnit||x.unit;persistSettings('Target updated')}
      else{settings.habits.push({id:slug(v.fName),name:v.fName,unit:v.fUnit||'times',target:Number(v.fTarget)});persistSettings('Added '+v.fName)}
    },
    extraButton:x&&x.id==='steps'&&stepsAvailable()?{label:'Source: '+(stepsAuto()?'Automatic (phone sensor)':'Manual')+'  ·  change',onClick:()=>{chooseStepSource()}}:null,
    remove:x?{label:'Remove target',confirm:()=>confirmRemove(x.name),run:()=>{settings.habits=settings.habits.filter(q=>q.id!==x.id);persistSettings('Removed '+x.name)}}:null});
}
function ruleForm(r){
  formSheet({title:r?'Edit rule':'New rule',fields:[{id:'fName',label:'Rule',ph:'No mithai',value:r&&r.name,focus:true}],
    validate:v=>!v.fName?'Enter a rule first':'',
    onDone:v=>{if(r){r.name=v.fName;persistSettings('Rule updated')}else{settings.rules.push({id:slug(v.fName),name:v.fName});persistSettings('Rule added')}},
    remove:r?{label:'Remove rule',confirm:()=>confirmRemove('this rule'),run:()=>{settings.rules=settings.rules.filter(q=>q.id!==r.id);persistSettings('Rule removed')}}:null});
}
$('reorderBtn').addEventListener('click',()=>{reorderMode=!reorderMode;haptic('light');renderSetup()});

/* ---------- account and sync (rows on the Plan screen) ---------- */
function renderSyncStatus(){
  const el=$('syncStatus'),n=pendingCount();
  if(!signedIn()){el.textContent='';return}
  const waiting=n?n+(n===1?' change is':' changes are')+' waiting to sync':'';
  let t,bad=false;
  if(syncRunning)t='Syncing…';
  else if(syncError){t='Sync problem: '+syncError+(waiting?' ('+waiting+')':'');bad=true}
  else if(syncOffline&&n)t='Offline. '+waiting+'.';
  else if(n)t=waiting.charAt(0).toUpperCase()+waiting.slice(1)+'.';
  else if(sync.lastSyncAt)t='Synced at '+new Date(sync.lastSyncAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
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
const ONB_KEY='resetlog_onboarded';
let onb=null;
function showOnboarding(){
  if(onb)return;
  const edits={};
  const root=h('<div class="onb" role="dialog" aria-modal="true" aria-label="Welcome to Reset Log"><div class="onb-top"><button class="txtbtn" id="onbSkip">Skip</button></div><div class="onb-pages"><div class="onb-track" id="onbTrack"></div></div><div class="dots" aria-hidden="true"><i class="on"></i><i></i><i></i></div><div class="onb-foot" id="onbFoot"></div></div>');
  const track=root.querySelector('#onbTrack');
  const p1=h('<div class="onb-page"><div class="onb-art"></div><h2>Log your day in seconds</h2><p>Tap a target to log steps, workouts and water. Switch on the rules you kept. Everything saves by itself, and you can undo any change.</p></div>');
  p1.querySelector('.onb-art').innerHTML=icon('trending-up');
  const p2=h('<div class="onb-page"><div class="onb-art"></div><h2>Set your targets</h2><p>These are a starting point. Change a number now or later in Plan.</p><div class="group" id="onbTargets"></div></div>');
  p2.querySelector('.onb-art').innerHTML=icon('target');
  settings.habits.forEach(x=>{
    const r=h('<label class="row"><span class="row-label"></span><input class="numin" type="number" inputmode="decimal"></label>');
    r.querySelector('.row-label').textContent=x.name+' ('+x.unit+')';const i=r.querySelector('input');i.value=x.target;i.setAttribute('aria-label',x.name+' daily target');
    i.addEventListener('input',()=>{edits[x.id]=Number(i.value)});p2.querySelector('#onbTargets').appendChild(r);
  });
  const p3=h('<div class="onb-page"><div class="onb-art"></div><h2>Never miss a day</h2><p>Get one gentle reminder a day. Pick the time that suits you. You can turn it off anytime in Plan.</p><div class="group"><label class="row"><span class="row-label">Reminder time</span><input type="time" id="onbTime" value="21:00" aria-label="Reminder time"></label></div></div>');
  p3.querySelector('.onb-art').innerHTML=icon('bell');
  [p1,p2,p3].forEach(p=>track.appendChild(p));
  let page=0;
  const foot=root.querySelector('#onbFoot');
  async function finish(){
    const ch=Object.keys(edits).filter(id=>edits[id]>0&&settings.habits.find(x=>x.id===id&&x.target!==edits[id]));
    if(ch.length){ch.forEach(id=>{settings.habits.find(x=>x.id===id).target=edits[id]});await persistSettings('Targets saved')}
    try{await prefSet(ONB_KEY,'1')}catch(e){}
    root.style.opacity='0';root.style.transition='opacity .25s';setTimeout(()=>{root.remove();onb=null},reduced()?20:260);
  }
  function go(n){
    page=clamp(n,0,2);track.style.transform='translateX(-'+(page*33.3334)+'%)';
    root.querySelectorAll('.dots i').forEach((d,i)=>d.classList.toggle('on',i===page));
    foot.innerHTML='';
    if(page<2){const b=h('<button class="btn" id="onbNext">Next</button>');b.addEventListener('click',()=>go(page+1));foot.appendChild(b)}
    else{
      const on=h('<button class="btn" id="onbRemind">Turn on reminder</button>'),off=h('<button class="btn secondary" id="onbLater">Not now</button>');
      on.addEventListener('click',async()=>{$('remTime').value=root.querySelector('#onbTime').value||'21:00';$('remOn').checked=true;await setReminder(true);finish()});
      off.addEventListener('click',finish);foot.appendChild(on);foot.appendChild(off);
    }
    root.querySelector('#onbSkip').hidden=page===2;
  }
  root.querySelector('#onbSkip').addEventListener('click',finish);
  onb={back(){if(page>0)go(page-1);else finish()}};
  document.body.appendChild(root);hydrate(root);go(0);
}

/* ================= tabs, nav bar, native glue ================= */
const scrollPos={today:0,progress:0,setup:0};
function updateNav(){
  const t=document.querySelector('.screen.on .large-title');if(!t)return;
  const nb=$('navbar'),bottom=t.getBoundingClientRect().bottom;
  nb.classList.toggle('compact',bottom<nb.offsetHeight+6);
}
function showTab(t){
  scrollPos[activeTab]=window.scrollY;activeTab=t;
  document.querySelectorAll('.screen').forEach(p=>p.classList.toggle('on',p.id==='p-'+t));
  document.querySelectorAll('.tab').forEach(b=>{if(b.dataset.tab===t)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
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
function onResume(){
  const t=todayStr();if(t===lastToday)return;
  const wasToday=current===lastToday;lastToday=t;
  if(wasToday)current=t;
  renderToday();renderProgress();
}
function onForeground(){onResume();syncOnResume();stepsOnForeground()}
function initNativeGlue(){
  try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{syncBars();drawChart()})}catch(e){}
  syncBars();
  try{if(Native.Network)Native.Network.addListener('networkStatusChange',s=>{if(s.connected)syncSoon(true)})}catch(e){}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flushSave();else if(!IS_NATIVE)onForeground()});
  window.addEventListener('pagehide',flushSave);
  if(!IS_NATIVE)return;
  Native.App.addListener('backButton',()=>{
    if(closeTopLayer())return;
    if(onb){onb.back();return}
    if(activeTab!=='today'){showTab('today');return}
    flushSave();
    Native.App.exitApp();
  });
  Native.App.addListener('appStateChange',s=>{if(s.isActive)onForeground();else flushSave()});
  LN().addListener('localNotificationActionPerformed',()=>openToday());
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeTopLayer()});
$('replayIntro').addEventListener('click',showOnboarding);

/* ================= start ================= */
(async function(){
  hydrate();
  current=todayStr();lastToday=current;
  bindLogic();
  renderToday();renderSetup();showTab('today');
  initNativeGlue();
  try{
    const all=await store.load();
    if(all.data){settings=all.data.settings;days=all.data.days}
    if(all.migrated)setMsg('bkMsg','Moved '+all.migrated+' saved '+(all.migrated===1?'day':'days')+' from the old browser storage.');
  }catch(e){loadProblem="Couldn't read your saved entries: "+errText(e)}
  refreshAll();
  if(loadProblem)setMsg('bkMsg',loadProblem,true);
  initReminder();
  initSync();
  initSteps();
  try{
    if(await prefGet(ONB_KEY)==null){
      if(Object.keys(days).length)await prefSet(ONB_KEY,'1');else showOnboarding();
    }
  }catch(e){}
})();
