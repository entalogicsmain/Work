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
/* The comeback starts with the first day that has anything logged. */
function firstLogKey(){
  let first=null;
  Object.keys(days).forEach(k=>{
    const d=days[k];if(!d)return;
    const any=Object.keys(d.vals||{}).some(i=>Number(d.vals[i])>0)||Object.keys(d.rules||{}).some(i=>d.rules[i])||d.weight!=null||d.waist!=null||(d.note&&d.note.trim());
    if(any&&(first===null||k<first))first=k;
  });
  return first;
}
function comebackDay(k){
  const f=firstLogKey()||todayStr();
  if(k<f)return 0;
  return Math.round((parse(k)-parse(f))/864e5)+1;
}
const GENTLE_RESTART='Every comeback has restarts. Start again today.';
/* One change = one auto-saved write, one undo step, and (maybe) a small celebration. */
function commitDay(label,mutate,quiet,forKey){
  const k=forKey||current;
  const prev=days[k]?clone(days[k]):null;
  const before=dayMetrics(prev,k),streakBefore=streak();
  const d=prev?clone(prev):Object.assign(blankDay(),{date:k});
  mutate(d);
  d.date=k;d.updatedAt=Date.now();
  days[k]=d;
  scheduleSave(k);
  const after=dayMetrics(d,k),streakAfter=streak();
  renderToday(true);renderProgress();
  const undo=()=>{
    if(prev){days[k]=Object.assign(clone(prev),{updatedAt:Date.now()})}
    else if(signedIn()){days[k]=Object.assign(blankDay(),{date:k,updatedAt:Date.now()})}
    else delete days[k];
    scheduleSave(k);renderToday();renderProgress();haptic('light');toast('Change undone',{icon:'check'});
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

$('prevDay').addEventListener('click',()=>{const d=parse(current);d.setDate(d.getDate()-1);goTo(ymd(d));haptic('light')});
$('nextDay').addEventListener('click',()=>{const d=parse(current);d.setDate(d.getDate()+1);if(ymd(d)<=todayStr()){goTo(ymd(d));haptic('light')}});

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
  $('sWeight').textContent=wc==null?'–':signed(wc,wUnit());$('sWeightSub').textContent=wc==null?'Needs 2 entries':'this '+RANGE_NAME[period];
  $('sWaist').textContent=wa==null?'–':signed(wa,lUnit());$('sWaistSub').textContent=wa==null?'Needs 2 entries':'this '+RANGE_NAME[period];
  const withSteps=rk.filter(k=>days[k]&&days[k].vals&&days[k].vals.steps!=null);
  if(withSteps.length){
    const avg=Math.round(withSteps.reduce((a,k)=>a+days[k].vals.steps,0)/withSteps.length);
    $('sAvgSteps').textContent=fmt(avg);$('sAvgStepsSub').textContent='over '+withSteps.length+(withSteps.length===1?' day':' days');
    $('sAvgDist').textContent=fmtKm(kmFor(avg));$('sAvgDistSub').textContent='a day, at '+fmtHeight(stepHeightCm())+' tall';
  }else{$('sAvgSteps').textContent='–';$('sAvgStepsSub').textContent='No steps logged yet';$('sAvgDist').textContent='–';$('sAvgDistSub').textContent=''}
  $('streakNote').textContent=st>0?(best>st?'Your best streak was '+best+' days.':'This is your best streak yet.'):(best>0?GENTLE_RESTART+' Your best streak was '+best+' days.':'Log a day to start your streak.');

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
  if(hoursChart)hoursChart.destroy();
  const r=makeHoursChart($('chartHours'),m.hourly,'today');
  hoursChart=r.chart;$('hoursSummary').textContent=r.summary;
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
  }
  const art=(el,name)=>{el.querySelector('.onb-art').innerHTML=icon(name);return el};
  let page=0,permResult=null,reminderSwitch=null,nextBtn=null;

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
    const p3=art(h('<div class="onb-page"><div class="onb-art"></div><h2>Never miss a day</h2><p>Get one gentle reminder a day. Pick the time that suits you. You can change it any time in Settings.</p><div class="group"><label class="row"><span class="row-label">Daily reminder</span><input type="checkbox" class="switch" role="switch" id="onbRemOn" aria-label="Daily reminder" checked></label><label class="row"><span class="row-label">Reminder time</span><input type="time" id="onbTime" value="21:00" aria-label="Reminder time"></label></div></div>'),'bell');
    reminderSwitch=p3.querySelector('#onbRemOn');
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
    root.style.opacity='0';root.style.transition='opacity .25s';setTimeout(()=>{root.remove();onb=null},reduced()?20:260);
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
  document.body.appendChild(root);go(0);
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
$('replayIntro').addEventListener('click',()=>showOnboarding({mode:'replay'}));

