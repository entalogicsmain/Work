/* Today: the ring, sections of habit cards, compact rows for what is done, the Body section, one-tap logging for every habit
   type, target suggestions, and the edit mode (long-press: drag to reorder, Hide, add from the library). */

/* ---------- day metrics, streaks (only habits that were due count) ---------- */
function dayMetrics(d,k){
  k=k||(d&&d.date)||current;
  const all=d&&days[k]!==d?Object.assign({},days,{[k]:d}):days;
  return Core.dayMetrics(settings,all,k);
}
const streak=()=>Core.currentStreak(settings,days,todayStr());
const bestStreak=()=>Core.bestStreak(settings,days,todayStr());
const addDays=Core.addDays;

/* ---------- small helpers ---------- */
const C=2*Math.PI*52;
let ringAnimated=false,ringOff=C;
function dayTitle(k){
  const d=parse(k);
  return{h1:d.toLocaleDateString(undefined,{day:'numeric',month:'long'}),weekday:d.toLocaleDateString(undefined,{weekday:'long'})};
}
function relLabel(k){
  const t=todayStr();if(k===t)return'Today';
  if(k===Core.addDays(t,-1))return'Yesterday';
  return nice(k);
}
const habitById=id=>settings.habits.find(x=>x.id===id);
const sectionById=id=>settings.sections.find(s=>s.id===id);
function setHabitValue(d,x,v){
  if(x.type==='yesno'){d.rules[x.id]=!!v;return}
  if(v==null)delete d.vals[x.id];else d.vals[x.id]=v;
}
function curVal(x){const d=days[current];const v=Core.hv(x,d);return v==null?null:v}
function presetsFor(x){
  const u=x.unit;
  if(u==='steps')return[500,1000];if(u==='reps')return[5,10];if(/^min/i.test(u))return[5,10];if(/^sec/i.test(u))return[10,30];
  if(u==='litres')return[0.25,0.5];if(u==='hours')return[0.5,1];
  const s=Core.stepFor(x);return[s,s*2];
}
function lastValue(key,before){
  before=before||current;
  const ks=Object.keys(days).filter(k=>k<before&&days[k][key]!=null).sort();
  return ks.length?days[ks[ks.length-1]][key]:null;
}
const expandedDone=new Set();      // done cards the user opened again (this session, this day)
let editing=false;
const lastBar={};                  // last drawn bar width per habit, so a change animates

/* A card that has just hit its target stays open for a moment (so the bar and the tick are seen), then folds into its compact row.
   Reduced motion: no delay. */
const justMet=new Map();           // habit id -> timer
const FOLD_DELAY=1500;
function holdDone(x){
  if(reduced())return;
  clearTimeout(justMet.get(x.id));
  justMet.set(x.id,setTimeout(()=>foldDone(x.id),FOLD_DELAY));
}
function foldDone(id){
  const end=()=>{justMet.delete(id);if(!dragState)renderSections()};
  const card=document.querySelector('#sections .hcard[data-id="'+id+'"]');
  if(card&&!editing&&!reduced()){card.classList.add('folding');setTimeout(end,260)}else end();
}
function clearJustMet(){justMet.forEach(t=>clearTimeout(t));justMet.clear()}

/* The first logged tap earns one gentle tip (shown once, ever: Preferences key comeback_tip_edit). It takes the hint line, so nothing moves. */
const TIP_KEY='comeback_tip_edit';
let coachState=0;                  // 0 not asked yet, 1 asking, 2 showing, 3 done
function coachAfterLog(){
  if(coachState!==0||editing)return;
  coachState=1;
  Promise.resolve().then(()=>prefGet(TIP_KEY)).then(v=>{
    if(v!=null){coachState=3;return}
    coachState=2;try{prefSet(TIP_KEY,'1').catch(()=>{})}catch(e){}
    renderToday(true);
  }).catch(()=>{coachState=3});
}

/* wording for + and - taps: "Pushups +7", "Plank +40 sec" */
const showUnit=x=>!/^(reps|times)$/i.test(x.unit||'');
const deltaText=(x,n)=>(n<0?'−':'+')+fmt(Math.abs(n))+(showUnit(x)?' '+x.unit:'');
const tapOpts=(x,delta,hush)=>({tap:x.id,delta,hush,tapMsg:t=>x.name+' '+deltaText(x,t),say:d=>x.name+' '+fmt(Number(Core.hv(x,d)||0))+' of '+fmt(x.target)+' '+x.unit});
const bodyUser={};                 // day -> true/false: the Body section opened or closed by hand this session

/* ---------- Today header: title, ring, chips, hint ---------- */
function renderToday(inPlace){
  const d=days[current],isToday=current===todayStr(),m=dayMetrics(d,current),logged=Core.hasRecord(d);
  const tt=dayTitle(current);
  $('todayTitle').textContent=tt.h1;
  const cd=comebackDay(current);
  $('todaySub').textContent=cd>0?'Day '+cd+' of your comeback'+(isToday?'':' · '+tt.weekday):tt.weekday+(logged?'':' · Not logged');
  $('dayLabelText').textContent=relLabel(current);
  $('nextDay').disabled=current>=todayStr();
  $('editTodayBtn').hidden=editing;
  if(activeTab==='today')$('navTitle').textContent=tt.h1;

  const prg=$('ringPrg');
  ringOff=C*(1-m.score/100);
  if(!ringAnimated){prg.style.strokeDashoffset=C;requestAnimationFrame(()=>requestAnimationFrame(()=>{prg.style.strokeDashoffset=ringOff}));ringAnimated=true}
  else prg.style.strokeDashoffset=ringOff;
  prg.style.opacity=m.score>0?'1':'0';
  const nothingDue=m.hTotal+m.rTotal===0;      // a rest day, or an empty plan: no score to show
  $('headScore').textContent=(d?m.score:0)+'%';
  $('ringCap').textContent=m.full?'All done':(isToday?'of today':'of the day');
  $('ring').classList.toggle('done',m.full);
  $('ring').classList.toggle('empty',nothingDue);
  $('ring').setAttribute('aria-label',nothingDue?(isToday?'Nothing is due today.':'Nothing was due this day.'):(isToday?"Today's":'This day\'s')+' score '+(d?m.score:0)+' percent. '+m.hMet+' of '+m.hTotal+' targets met, '+m.rKept+' of '+m.rTotal+' rules kept.');
  const ct=$('chipTargets');ct.hidden=m.hTotal===0;ct.classList.toggle('ok',m.hTotal>0&&m.hMet===m.hTotal);ct.querySelector('span').textContent=m.hMet+' of '+m.hTotal+' targets';
  const cr=$('chipRules');cr.hidden=m.rTotal===0;cr.classList.toggle('ok',m.rTotal>0&&m.rKept===m.rTotal);cr.querySelector('span').textContent=m.rKept+' of '+m.rTotal+' rules';
  const st=streak(),best=bestStreak();
  $('streakLine').querySelector('span').textContent=Core.streakLine(settings,days,todayStr());
  // no hint when nothing is due (the empty states below say it); taps open sheets, so the nudge points at +
  $('todayHint').textContent=nothingDue?'':!logged?(isToday?(st===0&&best>0?GENTLE_RESTART:'Nothing logged yet. Tap + to log.'):'This day was not logged. You can fill it in now.'):(m.full?'Strong day. Your comeback is on track.':(isToday&&coachState===2?'Tip: hold a card to rearrange':''));
  $('todayHint').hidden=!$('todayHint').textContent;

  renderSuggestion();
  renderSections();
}

/* ---------- target suggestions ---------- */
function suggestionText(s){
  const x=habitById(s.id),t=fmt(s.target);
  const what=/^(reps|times)$/i.test(x.unit)?t+' '+x.name.toLowerCase():'your '+x.name.toLowerCase()+' target of '+t+' '+x.unit;
  return "You've hit "+what+' '+s.days+' days straight. Try '+fmt(s.next)+'?';
}
function renderSuggestion(){
  const slot=$('suggestSlot');if(!slot)return;
  slot.innerHTML='';
  if(editing||current!==todayStr())return;
  const s=Core.suggestionFor(settings,days,todayStr(),meta.suggestSnooze||{});
  if(!s)return;
  const x=habitById(s.id);
  const c=h('<div class="card suggest" id="suggestCard" role="region" aria-label="Target suggestion"><div class="sg-top"><span class="sg-ic"></span><p class="sg-text" id="suggestText"></p></div><div class="sg-actions"><button class="btn small" id="sgRaise">Raise target</button><button class="btn small secondary" id="sgLater">Not now</button></div></div>');
  c.querySelector('.sg-ic').innerHTML=icon('sparkles');
  c.querySelector('#suggestText').textContent=suggestionText(s);
  c.querySelector('#sgRaise').addEventListener('click',async()=>{
    x.target=s.next;haptic('success');
    await saveSettingsQuiet();toast(x.name+' target is now '+fmt(s.next)+' '+x.unit,{icon:'trophy'});
    renderToday(true);renderSetup();
  });
  c.querySelector('#sgLater').addEventListener('click',async()=>{
    meta.suggestSnooze=Object.assign({},meta.suggestSnooze||{},{[s.id]:addDays(todayStr(),7)});
    try{await store.saveMeta()}catch(e){}
    haptic('light');renderSuggestion();
  });
  slot.appendChild(c);
}

/* ---------- which habits show, and in which shape ---------- */
function sectionItems(sec){
  return settings.habits.filter(x=>x.section===sec.id&&!x.hidden&&(editing||Core.isShown(x,current,days)));
}
const isCardType=x=>x.type==='count'||x.type==='duration'||x.type==='steps';
const isDoneCompact=x=>!editing&&isCardType(x)&&!expandedDone.has(x.id)&&!justMet.has(x.id)&&Core.isMet(x,days[current])&&!(x.type==='steps'&&stepsCardKind(current)==='turnon');

function iconTile(name){return '<span class="row-ic">'+icon(name,'sm')+'</span>'}
function barWidth(x,v){return Math.min(100,x.target>0?v/x.target*100:0)}
function animateBar(card,x,v){
  const bar=card.querySelector('.bar i');if(!bar)return;
  const to=barWidth(x,v);
  bar.style.width=(lastBar[x.id]==null?0:lastBar[x.id])+'%';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{bar.style.width=to+'%'}));
  lastBar[x.id]=to;
}
function editControls(x){
  const ec=h('<div class="edit-ctl"><button class="handle-btn" aria-label=""></button><button class="hide-btn"><span></span></button></div>');
  const hb=ec.querySelector('.handle-btn');hb.innerHTML=icon('grip-vertical');hb.setAttribute('aria-label','Reorder '+x.name+'. Drag, or use the arrow keys.');
  const hide=ec.querySelector('.hide-btn');hide.insertAdjacentHTML('afterbegin',icon('eye-off','sm'));hide.querySelector('span').textContent='Hide';hide.setAttribute('aria-label','Hide '+x.name+' from Today');
  hide.addEventListener('click',()=>hideHabit(x));
  hb.addEventListener('pointerdown',e=>startItemDrag(e,hb.closest('.titem')));
  hb.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();moveItemByKey(hb.closest('.titem'),e.key==='ArrowUp'?-1:1)}});
  return ec;
}
function scheduleNote(x,k){
  const wp=Core.weekProgress(x,k,days);
  if(wp)return Math.min(wp.done,wp.of)+' of '+wp.of+' this week';
  const s=Core.normalizeSchedule(x.schedule);
  if(s.kind==='days'||s.kind==='everyN')return Core.scheduleLabel(s);
  return '';
}
/* Press and hold a card for half a second to edit Today. While it is held a ring grows around the card (CSS .holding), so people can see it is working. */
const HOLD_MS=520;
function longPressToEdit(el){
  let timer=null,sx=0,sy=0;
  const stop=()=>{clearTimeout(timer);timer=null;el.classList.remove('holding')};
  el.addEventListener('pointerdown',e=>{
    if(editing||e.target.closest('.hc-ctl,.cbtn,.hc-collapse,.switch'))return;
    sx=e.clientX;sy=e.clientY;clearTimeout(timer);el.classList.add('holding');
    timer=setTimeout(()=>{timer=null;el.classList.remove('holding');suppressNextClick(el);haptic('medium');enterEdit(el.dataset.id)},HOLD_MS);
  });
  el.addEventListener('pointermove',e=>{if(timer&&Math.abs(e.clientX-sx)+Math.abs(e.clientY-sy)>8)stop()});
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>el.addEventListener(ev,stop));
  el.addEventListener('contextmenu',e=>e.preventDefault());
}
function suppressNextClick(el){
  const f=e=>{e.stopImmediatePropagation();e.preventDefault()};
  el.addEventListener('click',f,{capture:true,once:true});
  setTimeout(()=>el.removeEventListener('click',f,true),900);
}

/* a card for a Count, Duration or Steps habit */
function habitCard(x,d,k){
  const v=Number(Core.hv(x,d)||0),met=Core.isMet(x,d);
  const c=h('<div class="hcard titem" data-id="" data-type=""><button class="hc-main"><span class="hcard-top"><span class="hico"></span><span class="met-ic"></span></span><span class="hname"></span><span class="hline"><span class="hval num"></span><span class="htgt"></span></span><span class="hsrc"></span><span class="bar"><i></i></span></button><div class="hc-ctl"></div></div>');
  c.dataset.id=x.id;c.dataset.type=x.type;
  c.querySelector('.hico').innerHTML=icon(x.icon,'sm');
  c.querySelector('.hname').textContent=x.name;
  c.querySelector('.htgt').textContent='/ '+fmt(x.target)+' '+x.unit;      // one number format in both states: "30 / 30 min"
  const main=c.querySelector('.hc-main'),ctl=c.querySelector('.hc-ctl'),src=c.querySelector('.hsrc');
  c.classList.toggle('met',met);
  c.querySelector('.met-ic').innerHTML=met?icon('circle-check','sm'):'';
  const extra=scheduleNote(x,k);
  if(x.type==='steps'){
    renderStepsCard(c,x,v,k);
    ctl.remove();
  }else{
    c.querySelector('.hval').textContent=fmt(v);
    if(extra)src.textContent=extra;
    const step=Core.stepFor(x);
    main.setAttribute('aria-label',x.name+', '+fmt(v)+' of '+fmt(x.target)+' '+x.unit+(met?', target met':'')+(extra?', '+extra:'')+'. Tap to add.');
    if(x.type==='count'){
      const mi=h('<button class="cbtn minus"></button>'),pl=h('<button class="cbtn plus"></button>');
      mi.innerHTML=icon('minus','sm');pl.innerHTML=icon('plus','sm');
      mi.setAttribute('aria-label','Remove '+fmt(step)+' '+x.name);pl.setAttribute('aria-label','Add '+fmt(step)+' '+x.name);
      mi.disabled=v<=0;
      mi.addEventListener('click',()=>{if(v<=0)return;commitDay(x.name+' −'+fmt(step),dd=>{const nv=Math.max(0,r1((dd.vals[x.id]||0)-step));if(nv<=0)delete dd.vals[x.id];else dd.vals[x.id]=nv},false,null,tapOpts(x,-step,true))});
      pl.addEventListener('click',()=>commitDay(x.name+' +'+fmt(step),dd=>{dd.vals[x.id]=r1((dd.vals[x.id]||0)+step)},false,null,tapOpts(x,step,true)));
      ctl.appendChild(mi);ctl.appendChild(pl);
    }else{
      presetsFor(x).slice(0,2).forEach(a=>{
        const b=h('<button class="cbtn chipbtn"></button>');b.textContent='+'+fmt(a);b.setAttribute('aria-label','Add '+fmt(a)+' '+x.unit+' to '+x.name);
        b.addEventListener('click',()=>commitDay(x.name+' +'+fmt(a)+' '+x.unit,dd=>{dd.vals[x.id]=r1((dd.vals[x.id]||0)+a)},false,null,tapOpts(x,a,false)));ctl.appendChild(b);
      });
    }
  }
  if(met&&!justMet.has(x.id)){
    const col=h('<button class="hc-collapse"></button>');col.innerHTML=icon('chevron-up','sm');col.setAttribute('aria-label','Collapse '+x.name);
    col.addEventListener('click',()=>{expandedDone.delete(x.id);renderSections()});c.appendChild(col);
  }
  main.addEventListener('click',()=>{if(editing)return;if(x.type==='steps'){stepsCardTap();return}habitSheet(x)});
  if(editing&&!Core.isDue(x,k,days))src.textContent='Not due today';
  animateBar(c,x,x.type==='steps'&&stepsCardKind(k)==='turnon'?0:v);
  c.appendChild(editControls(x));
  longPressToEdit(c);
  return c;
}
/* what is done shrinks to one line with a tick; tap it to open the card again. Count and Duration rows keep a small + so extra reps stay one tap. */
function doneRow(x,d){
  const v=Number(Core.hv(x,d)||0);
  const r=h('<div class="drow titem" data-id=""><button class="drow-main"><span class="row-ic"></span><span class="row-label"></span><span class="row-val num"></span><span class="met-ic"></span></button></div>');
  r.dataset.id=x.id;r.dataset.type=x.type;
  const main=r.querySelector('.drow-main');
  r.querySelector('.row-ic').innerHTML=icon(x.icon,'sm');
  r.querySelector('.row-label').textContent=x.name;
  r.querySelector('.row-val').textContent=fmt(v)+' / '+fmt(x.target)+' '+x.unit;
  r.querySelector('.met-ic').innerHTML=icon('circle-check','sm');
  main.setAttribute('aria-expanded','false');
  main.setAttribute('aria-label',x.name+', '+fmt(v)+' of '+fmt(x.target)+' '+x.unit+', done. Tap to open.');
  main.addEventListener('click',()=>{expandedDone.add(x.id);haptic('light');renderSections()});
  if(x.type==='count'||x.type==='duration'){
    const a=x.type==='count'?Core.stepFor(x):presetsFor(x)[0];
    const more=h('<button class="cbtn drow-act"></button>');more.innerHTML=icon('plus','sm');
    more.setAttribute('aria-label','Add '+fmt(a)+(x.type==='count'?' ':' '+x.unit+' to ')+x.name);
    more.addEventListener('click',()=>commitDay(x.name+' +'+fmt(a),dd=>{dd.vals[x.id]=r1((dd.vals[x.id]||0)+a)},false,null,tapOpts(x,a,x.type==='count')));
    r.appendChild(more);
  }
  longPressToEdit(r);
  return r;
}
function yesNoRow(x,d,k){
  const on=Core.isMet(x,d);
  const r=h('<div class="yrow titem" data-id=""><label class="row rule-row"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><input type="checkbox" class="switch" role="switch"></label></div>');
  r.dataset.id=x.id;r.dataset.type='yesno';
  r.querySelector('.row-ic').innerHTML=icon(x.icon,'sm');
  r.querySelector('.row-label').textContent=x.name;
  const sub=editing&&!Core.isDue(x,k,days)?'Not due today':scheduleNote(x,k);
  const sb=r.querySelector('.row-sub');if(sub)sb.textContent=sub;else sb.remove();
  const sw=r.querySelector('input');sw.checked=on;sw.setAttribute('aria-label',x.name);sw.dataset.id=x.id;
  sw.addEventListener('change',()=>{const on=sw.checked;commitDay(x.name+(on?': done':': not done'),dd=>{dd.rules[x.id]=on},false,null,{hush:true,say:x.name+(on?': done':': not done')})});
  if(editing)sw.disabled=true;
  r.classList.toggle('on',on);
  r.appendChild(editControls(x));
  longPressToEdit(r);
  return r;
}
function measureRow(x,d,k){
  const key=x.measure,isW=key==='weight';
  const v=d&&d[key]!=null?d[key]:null,last=lastValue(key,k);
  const r=h('<div class="mrow titem" data-id=""><button class="row"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="row-val"></span><svg data-ic="chevron-right" class="chev"></svg></button></div>');
  r.dataset.id=x.id;r.dataset.type='measure';
  const row=r.querySelector('.row');row.id=isW?'rowWeight':'rowWaist';
  row.querySelector('.row-ic').innerHTML=icon(x.icon,'sm');
  row.querySelector('.row-label').textContent=x.name;
  const conv=cm=>isW?fmtWeight(cm):fmtWaist(cm);
  const val=row.querySelector('.row-val');
  if(v!=null){val.textContent=conv(v);val.style.color='var(--label)'}
  else{val.textContent=last!=null?'Last: '+conv(last):'Add';val.style.color=''}
  const sub=[Core.scheduleLabel(x.schedule),scheduleNote(x,k)].filter((t,i,a)=>t&&a.indexOf(t)===i).join(' · ');
  const sb=row.querySelector('.row-sub');if(sub)sb.textContent=editing&&!Core.isDue(x,k,days)?'Not due today':sub;else sb.remove();
  row.setAttribute('aria-label',x.name+', '+(v!=null?conv(v):'not set')+'. Tap to edit.');
  row.addEventListener('click',()=>{if(!editing)bodySheet(key,k)});
  r.appendChild(editControls(x));
  hydrate(r);longPressToEdit(r);
  return r;
}
/* the BMI line and the note row that close the Body and notes section */
function bmiRow(){
  const st=bodyState(current);
  const r=h('<div class="mrow fixed" id="bmiRowWrap"><button class="row" id="rowBmi"><span class="row-ic"></span><span class="row-body"><span class="row-label">BMI</span><span class="row-sub"></span></span><span class="row-val"></span><svg data-ic="chevron-right" class="chev"></svg></button></div>');
  r.querySelector('.row-ic').innerHTML=icon('gauge','sm');
  const val=r.querySelector('.row-val'),sub=r.querySelector('.row-sub'),row=r.querySelector('.row');
  if(st.state==='ok'){
    val.innerHTML='<span class="num"></span> <span class="pill"></span>';val.querySelector('.num').textContent=st.rounded.toFixed(1);
    const pl=val.querySelector('.pill');pl.textContent=catName(st.cat);pl.classList.add(catPill(st.cat));
    sub.textContent='From '+fmtWeight(st.kg);
    row.setAttribute('aria-label','BMI '+st.rounded.toFixed(1)+', '+catName(st.cat)+'. Tap for details.');
  }else{
    sub.remove();val.textContent=st.state==='no-height'?'Set your height':'Log your weight to see your BMI';
    row.setAttribute('aria-label','BMI. '+val.textContent+'. Tap for details.');
  }
  row.addEventListener('click',()=>{if(!editing)bmiSheet()});
  hydrate(r);return r;
}
function noteRow(){
  const d=days[current];
  const r=h('<div class="mrow fixed"><button class="row" id="rowNote"><span class="row-ic"></span><span class="row-body"><span class="row-label">Note</span><span class="row-sub" id="noteSub"></span></span><svg data-ic="chevron-right" class="chev"></svg></button></div>');
  r.querySelector('.row-ic').innerHTML=icon('notebook-pen','sm');
  const note=(d&&d.note)||'';const ns=r.querySelector('#noteSub');ns.textContent=note?note.split('\n')[0]:'What you ate, how you felt.';ns.style.color=note?'var(--label)':'';
  r.querySelector('.row').addEventListener('click',()=>{if(!editing)noteSheet()});
  hydrate(r);return r;
}
function bodySummary(){
  const st=bodyState(current),w=latestBody('weight',current),d=days[current];
  const bits=[];
  if(w)bits.push(fmtWeight(w.v));
  if(st.state==='ok')bits.push('BMI '+st.rounded.toFixed(1)+' '+catName(st.cat));
  if(d&&d.note)bits.push('Note added');
  return bits.length?bits.join(' · '):'';
}
/* the weight and waist habits that are due on the day on screen, and which of those are still to log */
function bodyDue(){return settings.habits.filter(x=>x.type==='measure'&&x.section==='body'&&Core.isShown(x,current,days))}
function bodyDueText(){
  const d=days[current],todo=bodyDue().filter(x=>!(d&&d[x.measure]!=null)).map(x=>x.name);
  return todo.length?todo[0]+(todo[1]?' and '+todo[1].toLowerCase():'')+' due':'';
}
/* the line under the collapsed Body heading: what is due (with a small dot, never colour alone), then a short summary */
function fillBodySum(el,collapsed){
  el.innerHTML='';if(!collapsed)return;
  const due=bodyDueText(),sum=bodySummary()||(due?'':'Weight, waist and notes');
  if(due){const dot=document.createElement('i');dot.className='due-dot';dot.setAttribute('aria-hidden','true');el.appendChild(dot)}
  el.appendChild(document.createTextNode([due,sum].filter(Boolean).join(' · ')));
}

/* ---------- sections ---------- */
function sectionEl(sec,items){
  const isBody=sec.id==='body';
  const d=days[current];
  const el=h('<section class="tsec" data-sec=""><header class="tsec-head"></header><div class="tsec-body"></div></section>');
  el.dataset.sec=sec.id;
  const head=el.querySelector('.tsec-head'),body=el.querySelector('.tsec-body');
  const scorable=items.filter(x=>x.type!=='measure'&&Core.countsForScore(x,current,days));
  const met=scorable.filter(x=>Core.isMet(x,d)).length;
  // Body and notes starts open when a weight or waist is due today (and closed otherwise); a tap on its heading is remembered for the day
  const dueM=isBody?bodyDue():[];
  const collapsed=isBody&&!editing&&(bodyUser[current]!==undefined?!bodyUser[current]:(dueM.length?false:sec.collapsed===true));
  if(isBody){
    // the heading wraps the button (a heading must not sit inside a button); the summary sits under it and describes the button
    const t=h('<span class="tsec-titles"><h2 class="tsec-title"><button class="tsec-title-btn tsec-toggle" aria-expanded="true" aria-describedby="bodySecSum"><span class="tsec-name"></span><svg data-ic="chevron-down" class="chev"></svg></button></h2><span class="tsec-sum" id="bodySecSum"></span></span>');
    const tb=t.querySelector('.tsec-toggle');
    tb.querySelector('.tsec-name').textContent=sec.name;fillBodySum(t.querySelector('.tsec-sum'),collapsed);
    tb.setAttribute('aria-expanded',String(!collapsed));
    tb.classList.toggle('closed',collapsed);
    tb.addEventListener('click',async()=>{if(editing)return;bodyUser[current]=collapsed;if(collapsed)delete sec.collapsed;else sec.collapsed=true;haptic('light');await saveSettingsQuiet();renderSections()});
    head.appendChild(t);hydrate(head);
  }else{
    const t=h('<span class="tsec-titles"><h2 class="tsec-title"></h2></span>');t.querySelector('h2').textContent=sec.name;head.appendChild(t);
    if(scorable.length){const m=document.createElement('span');m.className='tsec-meta num';m.textContent=met+' of '+scorable.length;head.appendChild(m)}
  }
  // edit-mode controls on the header
  const sc=h('<span class="sec-ctl"><button class="handle-btn sec-handle"></button><button class="sec-btn sec-rename"></button><button class="sec-btn sec-add"></button><button class="sec-btn sec-del"></button></span>');
  const hb=sc.querySelector('.sec-handle');hb.innerHTML=icon('grip-vertical');hb.setAttribute('aria-label','Reorder section '+sec.name+'. Drag, or use the arrow keys.');
  hb.addEventListener('pointerdown',e=>startSectionDrag(e,el));
  hb.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();moveSectionByKey(el,e.key==='ArrowUp'?-1:1)}});
  const rn=sc.querySelector('.sec-rename');rn.innerHTML=icon('pencil','sm');rn.setAttribute('aria-label','Rename section '+sec.name);rn.addEventListener('click',()=>renameSection(sec));
  const ad=sc.querySelector('.sec-add');ad.innerHTML=icon('plus','sm');ad.setAttribute('aria-label','Add a habit to '+sec.name);ad.addEventListener('click',()=>openLibrary({section:sec.id}));
  const dl=sc.querySelector('.sec-del');dl.innerHTML=icon('trash-2','sm');dl.setAttribute('aria-label','Delete section '+sec.name);dl.addEventListener('click',()=>deleteSection(sec));
  if(isBody||settings.habits.some(x=>x.section===sec.id))dl.remove();
  head.appendChild(sc);
  if(collapsed){body.hidden=true;return el}
  items.forEach(x=>{
    let node;
    if(x.type==='yesno')node=yesNoRow(x,d,current);
    else if(x.type==='measure')node=measureRow(x,d,current);
    else if(isDoneCompact(x))node=doneRow(x,d);
    else node=habitCard(x,d,current);
    body.appendChild(node);
  });
  if(isBody){body.appendChild(bmiRow());body.appendChild(noteRow())}
  return el;
}
function renderSections(){
  const root=$('sections');if(!root)return;
  if(dragState)return;
  const af=document.activeElement,fk=af&&root.contains(af)&&af.closest('.titem')?{id:af.closest('.titem').dataset.id,cls:(af.className||'').toString().split(' ')[0]}:null;
  root.innerHTML='';
  $('p-today').classList.toggle('editing',editing);
  let shown=0;
  settings.sections.forEach(sec=>{
    const items=sectionItems(sec);
    if(!editing&&!items.length&&sec.id!=='body')return;
    shown+=items.length;
    root.appendChild(sectionEl(sec,items));
  });
  const foot=$('todayFoot');foot.innerHTML='';
  if(!editing){
    if(!shown){
      // three different empties: a plan with no habits yet, a plan whose habits are all hidden, and a day with nothing due
      const bare=!settings.habits.some(x=>x.type!=='measure'),allHidden=!bare&&!settings.habits.some(x=>!x.hidden);
      const e=h('<div class="empty card" id="todayEmpty"><svg data-ic="sparkles"></svg><b class="t-head"></b><p></p><button class="btn small" id="emptyAdd">Add habit</button></div>');
      e.querySelector('b').textContent=bare?'Your plan is empty':allHidden?'Everything is hidden':'Nothing due today';
      e.querySelector('p').textContent=bare?'Add a habit to start, or begin from a ready-made plan.':allHidden?'Show a habit again from Edit Today, or add a new one.':'Add habits from the library, or enjoy the rest.';
      e.querySelector('#emptyAdd').addEventListener('click',()=>openLibrary({}));
      if(bare){const pk=h('<button class="txtbtn" id="emptyPlans">Choose a starter plan</button>');pk.addEventListener('click',planPickerSheet);e.appendChild(pk)}
      root.insertBefore(e,root.firstChild);
    }
    const eb=h('<button class="txtbtn" id="editToday"><svg data-ic="sliders-horizontal" class="sm"></svg><span>Edit Today</span></button>');
    eb.addEventListener('click',()=>{haptic('light');enterEdit()});foot.appendChild(eb);
  }else{
    const ab=h('<button class="btn secondary" id="addSection"><svg data-ic="folder-plus" class="sm"></svg><span>Add section</span></button>');
    ab.addEventListener('click',()=>addSection());foot.appendChild(ab);
  }
  hydrate(root);hydrate(foot);
  renderEditStrip();
  if(fk){const t=root.querySelector('.titem[data-id="'+fk.id+'"] .'+fk.cls);if(t&&!t.disabled)try{t.focus({preventScroll:true})}catch(e){}}
}

/* ---------- edit mode ---------- */
/* Rebuilding Today changes the height above the cards: keep the card that was pressed (or else the first one on screen) where it was. */
function anchorEl(id){
  if(id){const e=document.querySelector('#sections .titem[data-id="'+id+'"]');if(e)return e}
  return[...document.querySelectorAll('#sections .titem')].find(e=>{const r=e.getBoundingClientRect();return r.bottom>60&&r.top<window.innerHeight})||null;
}
function keepInView(change,id){
  const a=anchorEl(id),aid=a&&a.dataset.id,top=a?a.getBoundingClientRect().top:0;
  change();
  if(!aid)return;
  const b=document.querySelector('#sections .titem[data-id="'+aid+'"]');
  if(b){const dy=b.getBoundingClientRect().top-top;if(Math.abs(dy)>1)window.scrollTo(0,window.scrollY+dy)}
}
let wiggleT=null;
function enterEdit(anchorId){
  if(editing)return;
  editing=true;expandedDone.clear();coachState=3;
  keepInView(()=>{$('editBar').hidden=false;renderToday(true)},typeof anchorId==='string'?anchorId:null);
  // the cards wiggle for about a second to say they can be moved, then settle (never with reduced motion or the simple look: CSS)
  const p=$('p-today');p.classList.add('wiggling');clearTimeout(wiggleT);wiggleT=setTimeout(()=>p.classList.remove('wiggling'),1000);
  $('editDone').focus({preventScroll:true});
}
function exitEdit(){
  if(!editing)return;
  editing=false;clearTimeout(wiggleT);$('p-today').classList.remove('wiggling');
  keepInView(()=>{$('editBar').hidden=true;renderToday(true)});
}
$('editDone').addEventListener('click',()=>{haptic('light');exitEdit()});
$('editTodayBtn').addEventListener('click',()=>{haptic('light');enterEdit()});
/* One compact strip: Done, and a "Hidden (n)" chip (only when something is hidden) that opens the list with Show buttons. */
function renderEditStrip(){
  const chip=$('hiddenChip');if(!chip)return;
  const n=settings.habits.filter(x=>x.hidden).length;
  chip.hidden=!editing||!n;
  chip.textContent='Hidden ('+n+')';
  chip.setAttribute('aria-label','Hidden from Today: '+n+'. Tap to show them.');
}
$('hiddenChip').addEventListener('click',()=>{haptic('light');hiddenSheet()});
function hiddenSheet(){
  const root=h('<div><p class="info">These stay in Plan. Tap Show to put one back on Today.</p><div class="group ic" id="hiddenList"></div></div>');
  const list=root.querySelector('#hiddenList');
  const sh=openSheet({title:'Hidden from Today',left:null,right:'Done',content:root});
  function draw(){
    list.innerHTML='';
    const hid=settings.habits.filter(x=>x.hidden);
    if(!hid.length){sh.close('cancel');return}
    hid.forEach(x=>{
      const r=h('<div class="row lib-row"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span></span><button class="lib-add">Show</button></div>');
      r.dataset.id=x.id;r.querySelector('.row-ic').innerHTML=icon(x.icon,'sm');r.querySelector('.row-label').textContent=x.name;
      const b=r.querySelector('.lib-add');b.setAttribute('aria-label','Show '+x.name+' on Today');
      b.addEventListener('click',async()=>{delete x.hidden;await saveSettingsQuiet();haptic('light');renderToday(true);renderSetup();draw()});
      list.appendChild(r);
    });
  }
  draw();
  return sh;
}
/* the empty plan: pick one of the ready-made plans (this only replaces an empty plan, so nothing the person made is lost) */
function planPickerSheet(){
  const root=h('<div><p class="info">Pick one to start from. You can change everything later in Plan.</p><div class="group ic plan-pick" id="planPickList"></div></div>');
  const sh=openSheet({title:'Starter plans',left:null,right:'Cancel',content:root});
  Core.STARTER_PLANS.filter(p=>p.items.length).forEach(p=>{
    const r=h('<button class="row planopt"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><svg data-ic="chevron-right" class="chev"></svg></button>');
    r.dataset.plan=p.id;r.querySelector('.row-ic').innerHTML=icon(p.icon);r.querySelector('.row-label').textContent=p.name;r.querySelector('.row-sub').textContent=p.blurb;
    r.addEventListener('click',()=>{
      haptic('light');sh.close('cancel');
      const mine=settings.sections.filter(sc=>!Core.DEFAULT_SECTIONS.some(d=>d.id===sc.id));      // sections made by hand come along
      Core.applyStarterPlan(settings,p.id);
      mine.forEach(sc=>{if(!settings.sections.some(q=>q.id===sc.id)){const bi=settings.sections.findIndex(q=>q.id==='body');settings.sections.splice(bi>=0?bi:settings.sections.length,0,sc)}});
      persistSettings(p.name+' is your plan now');
    });
    root.querySelector('#planPickList').appendChild(r);
  });
  hydrate(root);
  return sh;
}
async function hideHabit(x){
  x.hidden=true;await saveSettingsQuiet();haptic('light');
  renderToday(true);renderSetup();
  toast(x.name+' hidden from Today',{icon:'eye-off',undo:async()=>{delete x.hidden;await saveSettingsQuiet();renderToday(true);renderSetup()}});
}
function renameSection(sec){
  formSheet({title:'Rename section',fields:[{id:'fName',label:'Name',ph:'Mind',value:sec.name,focus:true}],validate:v=>!v.fName?'Enter a name first':'',
    onDone:async v=>{sec.name=v.fName.slice(0,40);await saveSettingsQuiet();renderToday(true);renderSetup()}});
}
function addSection(){
  formSheet({title:'New section',fields:[{id:'fName',label:'Name',ph:'Evening routine',focus:true}],validate:v=>!v.fName?'Enter a name first':'',
    onDone:async v=>{
      const taken=new Set(settings.sections.map(s=>s.id));
      settings.sections.splice(settings.sections.findIndex(s=>s.id==='body')>=0?settings.sections.findIndex(s=>s.id==='body'):settings.sections.length,0,{id:Core.uniqueId(slug(v.fName).replace(/-[a-z0-9]+$/,'')||'section',taken),name:v.fName.slice(0,40)});
      await saveSettingsQuiet();renderToday(true);renderSetup();
    }});
}
async function deleteSection(sec){
  if(settings.habits.some(x=>x.section===sec.id)){toast('Move its habits out first',{icon:'x'});return}
  settings.sections=settings.sections.filter(s=>s.id!==sec.id);await saveSettingsQuiet();renderToday(true);renderSetup();
}

/* dragging cards and sections */
let dragState=null;
function commitLayoutFromDom(){
  const secEls=[...$('sections').querySelectorAll('.tsec')];
  const secs=[],order=[];
  secEls.forEach(se=>{
    const sec=sectionById(se.dataset.sec);if(!sec)return;secs.push(sec);
    se.querySelectorAll('.titem').forEach(it=>{const hb=habitById(it.dataset.id);if(hb){hb.section=sec.id;order.push(hb)}});
  });
  if(!secs.length)return;
  settings.sections=secs.concat(settings.sections.filter(s=>!secs.includes(s)));
  settings.habits=order.concat(settings.habits.filter(x=>!order.includes(x)));
  saveSettingsQuiet();
}
function dragMath(item,ev,grab){
  item.style.transform='none';
  const nat=item.getBoundingClientRect();
  item.style.transform='translate('+(ev.clientX-grab.x-nat.left)+'px,'+(ev.clientY-grab.y-nat.top)+'px)';
}
function startItemDrag(e,item){
  if(!editing||!item)return;
  e.preventDefault();e.stopPropagation();
    const r=item.getBoundingClientRect(),grab={x:e.clientX-r.left,y:e.clientY-r.top};
  dragState={item};item.classList.add('dragging');haptic('medium');
  const move=ev=>{
    const els=document.elementsFromPoint(ev.clientX,ev.clientY);
    const over=els.find(x=>x.classList&&x.classList.contains('titem')&&x!==item);
    if(over){
      const rr=over.getBoundingClientRect(),dx=ev.clientX-(rr.left+rr.width/2),dy=ev.clientY-(rr.top+rr.height/2);
      const before=Math.abs(dy)*rr.width>Math.abs(dx)*rr.height?dy<0:dx<0;
      const ref=before?over:over.nextSibling;
      if(ref!==item&&over.parentNode)over.parentNode.insertBefore(item,ref);
    }else{
      const head=els.find(x=>x.classList&&x.classList.contains('tsec-head')),body=els.find(x=>x.classList&&x.classList.contains('tsec-body'));
      if(head){const b=head.parentNode.querySelector('.tsec-body');if(b&&!b.hidden&&b.firstChild!==item)b.insertBefore(item,b.firstChild)}
      else if(body&&!body.hidden){const last=[...body.querySelectorAll('.titem')].filter(x=>x!==item).pop();if(!last||ev.clientY>last.getBoundingClientRect().bottom)body.appendChild(item)}
    }
    dragMath(item,ev,grab);
  };
  const up=()=>{
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);
    item.classList.remove('dragging');item.style.transform='';dragState=null;
    commitLayoutFromDom();renderToday(true);
  };
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
}
function startSectionDrag(e,secEl){
  if(!editing)return;
  e.preventDefault();e.stopPropagation();
    const r=secEl.getBoundingClientRect(),grab={x:e.clientX-r.left,y:e.clientY-r.top};
  dragState={item:secEl};secEl.classList.add('dragging');haptic('medium');
  const move=ev=>{
    const over=document.elementsFromPoint(ev.clientX,ev.clientY).map(x=>x.closest&&x.closest('.tsec')).find(x=>x&&x!==secEl);
    if(over){const rr=over.getBoundingClientRect();const before=ev.clientY<rr.top+rr.height/2;const ref=before?over:over.nextSibling;if(ref!==secEl)over.parentNode.insertBefore(secEl,ref)}
    dragMath(secEl,ev,grab);
  };
  const up=()=>{
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);
    secEl.classList.remove('dragging');secEl.style.transform='';dragState=null;
    commitLayoutFromDom();renderToday(true);
  };
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
}
/* keyboard / screen reader alternative to dragging */
function moveItemByKey(item,dir){
  const sib=dir<0?item.previousElementSibling:item.nextElementSibling;
  if(sib&&sib.classList.contains('titem'))item.parentNode.insertBefore(item,dir<0?sib:sib.nextSibling);
  else{
    const sec=item.closest('.tsec'),other=dir<0?sec.previousElementSibling:sec.nextElementSibling;
    if(!other)return;const ob=other.querySelector('.tsec-body');if(!ob||ob.hidden)return;
    if(dir<0)ob.appendChild(item);else ob.insertBefore(item,ob.firstChild);
  }
  commitLayoutFromDom();const id=item.dataset.id;renderToday(true);
  const hb=$('sections').querySelector('.titem[data-id="'+id+'"] .handle-btn');if(hb)hb.focus({preventScroll:true});
}
function moveSectionByKey(secEl,dir){
  const sib=dir<0?secEl.previousElementSibling:secEl.nextElementSibling;
  if(!sib||!sib.classList.contains('tsec'))return;
  secEl.parentNode.insertBefore(secEl,dir<0?sib:sib.nextSibling);
  commitLayoutFromDom();const id=secEl.dataset.sec;renderToday(true);
  const hb=$('sections').querySelector('.tsec[data-sec="'+id+'"] .sec-handle');if(hb)hb.focus({preventScroll:true});
}

/* ---------- sheets for logging ---------- */
/* Count and Duration cards open in Add mode ("20 + 15 = 35 of 30 reps") with a Set total toggle for corrections */
function habitSheet(x){
  const p=presetsFor(x),addable=x.type==='count'||x.type==='duration';
  numberSheet({title:x.name,value:curVal(x),unitLine:'of '+fmt(x.target)+' '+x.unit,step:Core.stepFor(x),
    add:addable?{base:Number(curVal(x)||0),target:x.target,unit:x.unit}:null,
    presets:p.map(a=>({label:'+'+fmt(a),apply:v=>v+a})).concat([{label:'Target',set:x.target}]),
    onDone:(v,info)=>{
      if(info&&info.mode==='add'){
        if(!(info.added>0))return;
        commitDay(x.name+' '+deltaText(x,info.added),d=>{d.vals[x.id]=r1((d.vals[x.id]||0)+info.added)},false,null,tapOpts(x,info.added,false));
        return;
      }
      if(v===curVal(x))return;commitDay(x.name+' updated',d=>{setHabitValue(d,x,v)});
    }});
}
function stepsCardTap(){if(stepsCardKind(current)==='turnon'){haptic('light');turnOnStepCounting();return}stepsDetailSheet(current)}
/* weight or waist for a day (default: the day on screen), in the units chosen in Settings */
function bodySheet(key,k){
  k=k||current;
  const isW=key==='weight',d=days[k],last=lastValue(key,k),unit=isW?wUnit():lUnit();
  const conv=v=>isW?toDispWeight(v):toDispWaist(v),back=v=>isW?fromDispWeight(v):fromDispWaist(v);
  const cur=d&&d[key]!=null?r1(conv(d[key])):null;
  numberSheet({title:isW?'Weight':'Waist',value:cur,unitLine:unit+(isW?' · weigh in the morning, before eating':' · every 2 weeks is enough'),step:isW?0.1:(unit==='in'?0.25:0.5),
    placeholder:last!=null?fmt(r1(conv(last))):'0',
    presets:last!=null?[{label:'Use last ('+fmt(r1(conv(last)))+')',set:r1(conv(last))}]:[],
    validate:v=>{if(v==null)return '';const c=back(v);return isW?(c<30||c>250?'Check the weight value':''):(c<40||c>200?'Check the waist value':'')},
    onDone:v=>{const nv=v==null?null:back(v),curStored=d&&d[key]!=null?d[key]:null;if(nv===curStored)return;commitDay((isW?'Weight':'Waist')+' saved',dd=>{dd[key]=nv},false,k)}});
}
function noteSheet(){
  const d=days[current];
  const root=h('<div class="field"><label for="noteTa">Note</label><div class="box"><textarea id="noteTa" data-focus placeholder="Had daal and roti for lunch, walked after dinner, skipped the late snack."></textarea></div></div>');
  const ta=root.querySelector('textarea');ta.value=(d&&d.note)||'';
  openSheet({title:'Note',content:root,onDone:()=>{const v=ta.value.trim();if(v===((d&&d.note)||''))return;commitDay('Note saved',dd=>{dd.note=v})}});
}
function dateSheet(){
  const root=h('<div><div class="field"><label for="dateIn">Day</label><div class="box"><input type="date" id="dateIn" data-focus></div></div><button class="btn secondary" id="dateToday">Go to today</button></div>');
  const inp=root.querySelector('#dateIn');inp.value=current;inp.max=todayStr();
  const sh=openSheet({title:'Choose a day',content:root,onDone:()=>{if(inp.value&&inp.value<=todayStr())goTo(inp.value)}});
  root.querySelector('#dateToday').addEventListener('click',()=>{sh.close('cancel');goTo(todayStr())});
}
function goTo(k){flushSave();current=k;expandedDone.clear();clearJustMet();renderToday();window.scrollTo(0,0)}

/* The Steps card: the phone's count, the target, progress and distance. Read-only. */
function renderStepsCard(card,x,v,k){
  const kind=stepsCardKind(k),hv=card.querySelector('.hval'),src=card.querySelector('.hsrc'),main=card.querySelector('.hc-main'),met=x.target>0&&v>=x.target;
  const off=kind==='turnon'||kind==='phoneonly';
  card.classList.toggle('steps-off',off);
  let aria;
  if(kind==='turnon'){hv.textContent='Turn on step counting';card.querySelector('.met-ic').innerHTML='';card.classList.remove('met');card.querySelector('.htgt').textContent='Target '+fmt(x.target)+' '+x.unit;aria='Steps. Turn on step counting. Tap to set it up.'}
  else if(kind==='phoneonly'){hv.textContent='–';src.innerHTML=icon('smartphone')+'<span>Counted in the Android app</span>';card.querySelector('.htgt').textContent='Target '+fmt(x.target)+' '+x.unit;aria='Steps. Counted in the Android app.'}
  else{
    hv.textContent=fmt(v);
    const lab=stepsLabelFor(k),km=v>0?fmtKm(kmFor(v)):'';
    // two short lines fit the half-width card: where the number came from, then the distance
    if(lab){src.innerHTML=icon(lab==='counted'?'smartphone':'pencil')+'<span class="hs-src"></span><span class="hs-km"></span>';src.querySelector('.hs-src').textContent=(lab==='counted'?'Counted by phone':MANUAL_OLD);src.querySelector('.hs-km').textContent=km;if(!km)src.querySelector('.hs-km').remove()}
    aria='Steps, '+fmt(v)+' of '+fmt(x.target)+' '+x.unit+(met?', target met':'')+(lab==='counted'?', counted by phone':lab==='manual'?', entered manually (old)':'')+(v>0?', about '+fmtKm(kmFor(v)):'')+'. Tap for details.';
  }
  main.setAttribute('aria-label',aria);
}
