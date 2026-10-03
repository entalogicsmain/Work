/* Review: light days and the streak shield on Today and the calendar, the weekly review (a card on Today and a tile on Progress),
   the insights card, and sharing the week as text. The rules live in core.js (Core.isLight, Core.shieldNote, Core.weekSummary, Core.weekText,
   Core.insightsDetailed); this file only draws them. Other screens call it through a few one-line hooks:
   Review.todayHook(k) from renderToday, Review.footHook(foot,k) from renderSections, Review.progressHook() and Review.markHeatCell(...) from renderProgress. */

const REVIEW_KEY='comeback_review_seen';      // device-side (Preferences): the start of the last week whose review was answered or dismissed
window.Review=(function(){
'use strict';
const LIGHT_HINT='Light day on. Just do what you can. Your streak is safe.';
const WELCOME_BACK='Welcome back. Pick up with one easy thing.';
let seen=null;                                // null until read from the device
let weekMode='this';                          // the Progress tile: 'this' or 'last'
const gone=fn=>{try{const p=fn();if(p&&p.catch)p.catch(()=>{})}catch(e){}};

/* ---------- Today: the hint, the light-day button ---------- */
function todayHook(k){
  const hint=$('todayHint');
  if(hint){
    const d=days[k],isToday=k===todayStr();
    let t='';
    if(Core.isLight(d))t=LIGHT_HINT;
    else if(isToday&&!Core.hasRecord(d)){
      if(Core.isLight(days[Core.addDays(k,-1)]))t=WELCOME_BACK;
      else t=Core.shieldNote(settings,days,todayStr());
    }
    if(t){hint.textContent=t;hint.hidden=false}
  }
  renderReviewCard();
}
function toggleLight(k){
  const on=!Core.isLight(days[k]);
  commitDay(on?'Light day on. Your streak is safe.':'Light day off',dd=>{if(on)dd.light=true;else delete dd.light},false,k);
}
function footHook(foot,k){
  if(!foot)return;
  const on=Core.isLight(days[k]),isToday=k===todayStr();
  const b=h('<button class="txtbtn" id="lightToggle" aria-pressed="false"><svg data-ic="moon" class="sm"></svg><span></span></button>');
  b.querySelector('span').textContent=on?'Light day on':(isToday?'Take it easy today':'Mark as a light day');
  b.setAttribute('aria-pressed',String(on));
  b.addEventListener('click',()=>{haptic('light');toggleLight(k)});
  foot.appendChild(b);
}

/* ---------- the calendar and the recent days ---------- */
function markHeatCell(c,k){
  const light=Core.isLight(days[k]),shield=!light&&Core.shieldDays(settings,days,todayStr()).includes(k);
  if(!light&&!shield)return;
  c.classList.remove('g','o','r');
  c.classList.add(light?'l':'sh');
  c.setAttribute('aria-label',nice(k)+(light?': light day, streak safe':': shield day, rest day used and the streak stays safe'));
}
function markLogRow(pill,k){
  if(Core.isLight(days[k])){pill.className='pill l';pill.textContent='Light day'}
}
function heatLegend(){
  const lg=document.querySelector('.heatcard .legend');
  if(!lg||lg.querySelector('.rv-legend'))return;
  const a=h('<span class="rv-legend"><i class="l"></i>Light day</span>'),b=h('<span class="rv-legend"><i class="sh"></i>Shield day</span>');
  lg.appendChild(a);lg.appendChild(b);
}
/** A note at the top of a day's sheet: light day, shield day. */
function daySheetHook(root,k){
  const light=Core.isLight(days[k]),shield=!light&&Core.shieldDays(settings,days,todayStr()).includes(k);
  if(!light&&!shield)return;
  const e=root.querySelector('.empty');if(e&&light)e.remove();
  const c=h('<div class="card rv-daynote"><b class="t-head"></b><p class="t-foot muted" style="margin:4px 0 0"></p></div>');
  c.querySelector('b').textContent=light?'Light day':'Shield day';
  c.querySelector('p').textContent=light?'Just do what you can. Your streak is safe.':'A rest day was used here. Your streak stayed safe.';
  root.insertBefore(c,root.firstChild);
}

/* ---------- applying a change with Undo ---------- */
function applyHabit(x,patch,msg,icon){
  const before={target:x.target,schedule:JSON.parse(JSON.stringify(x.schedule||{kind:'daily'}))};
  Object.keys(patch).forEach(key=>{x[key]=patch[key]});
  Core.invalidate();
  gone(saveSettingsQuiet);
  haptic('success');
  renderToday(true);renderProgress();renderSetup();
  toast(msg,{icon:icon||'check',undo:async()=>{x.target=before.target;x.schedule=before.schedule;Core.invalidate();await saveSettingsQuiet();renderToday(true);renderProgress();renderSetup()}});
}

/* ---------- the weekly review ---------- */
const lastWeekStart=()=>Core.addDays(Core.weekStart(todayStr()),-7);
const kgText=kg=>fmtWeight(kg);
function reviewText(s,label,compare){return Core.weekText(settings,s,{label,compare,fmtKg:kgText})}
function markSeen(wk){
  seen=wk;
  gone(()=>prefSet(REVIEW_KEY,wk));
}
function shareWeek(text){
  if(!IS_NATIVE||!Native.Share||!Native.Share.share)return;
  gone(()=>Native.Share.share({title:'My week in Comeback',text:text+'\nTracked with Comeback.',dialogTitle:'Share your week'}));
}
const canShare=()=>!!(IS_NATIVE&&Native.Share&&Native.Share.share);
function habitOf(id){return settings.habits.find(x=>x.id===id)||null}

function renderReviewCard(){
  const slot=$('reviewSlot');if(!slot)return;
  const lw=lastWeekStart();
  let show=seen!==null&&seen<lw&&current===todayStr()&&!(typeof editing!=='undefined'&&editing);
  let s=null;
  if(show){s=Core.weekSummary(settings,days,lw);show=s.loggedDays>=2&&s.daysDue>=2}
  if(!show){slot.innerHTML='';slot.dataset.key='';return}
  const tx=reviewText(s,'Last week',true);
  const key=lw+'|'+tx.text+'|'+(canShare()?1:0);
  if(slot.dataset.key===key&&slot.firstChild)return;       // unchanged: keep the card (and anything typed in it)
  slot.dataset.key=key;slot.innerHTML='';
  const card=h('<section class="card review" id="reviewCard" aria-label="Last week review"><div class="rv-top"><span class="rv-ic"></span><h2 class="rv-title">Last week</h2><button class="iconbtn rv-x" id="rvDismiss" aria-label="Dismiss the review"><svg data-ic="x"></svg></button></div><p class="rv-text" id="reviewText"></p><div class="field rv-note"><label for="reviewNote">A note for this week (optional)</label><div class="box"><input id="reviewNote" type="text" maxlength="200" autocomplete="off" placeholder="How did it feel?"></div></div><div class="rv-actions"></div></section>');
  card.querySelector('.rv-ic').innerHTML=icon('sparkles');
  card.querySelector('#reviewText').textContent=tx.text;
  const sg=s.suggestion,slipped=s.slippedHabit&&habitOf(s.slippedHabit.id);
  const lightenFor=sg.kind==='lighten'?habitOf(sg.habitId):slipped,ease=lightenFor&&Core.easeFor(lightenFor);
  let raiseFor=sg.kind==='raise'?habitOf(sg.habitId):(s.bestHabit&&s.bestHabit.met===s.bestHabit.due?habitOf(s.bestHabit.id):null);
  const raise=raiseFor&&Core.raiseFor(raiseFor);
  if(!raise)raiseFor=null;
  const acts=card.querySelector('.rv-actions');
  const finish=(msg)=>{
    const note=card.querySelector('#reviewNote').value.trim();
    markSeen(lw);slot.innerHTML='';slot.dataset.key='';
    if(note)commitDay('Note saved',dd=>{dd.note=(dd.note?dd.note+'\n':'')+'Weekly review: '+note},true,todayStr());
    if(msg)msg();
  };
  const btn=(id,label,primary,fn)=>{const b=h('<button class="btn small'+(primary?'':' secondary')+'" id="'+id+'"></button>');b.textContent=label;b.addEventListener('click',fn);acts.appendChild(b);return b};
  btn('rvKeep','Keep the plan',sg.kind==='keep',()=>{haptic('light');finish(()=>toast('Plan kept',{icon:'check'}))});
  if(ease)btn('rvLighten','Lighten the plan',sg.kind==='lighten',()=>{
    finish(()=>{
      if(ease.kind==='target')applyHabit(lightenFor,{target:ease.to},lightenFor.name+' is now '+fmt(ease.to)+' '+lightenFor.unit,'check');
      else applyHabit(lightenFor,{schedule:ease.schedule},lightenFor.name+': '+ease.label.toLowerCase(),'check');
    });
  });
  if(raiseFor)btn('rvRaise','Raise '+raiseFor.name,sg.kind==='raise',()=>{
    finish(()=>applyHabit(raiseFor,{target:raise.to},raiseFor.name+' target is now '+fmt(raise.to)+' '+raiseFor.unit,'trophy'));
  });
  if(canShare()){
    const sh=h('<button class="txtbtn rv-share" id="rvShare">Share</button>');
    sh.addEventListener('click',()=>shareWeek(tx.text));acts.appendChild(sh);
  }
  card.querySelector('#rvDismiss').addEventListener('click',()=>{haptic('light');markSeen(lw);slot.innerHTML='';slot.dataset.key=''});
  slot.appendChild(card);
}

/* ---------- Progress: the week tile and the insights ---------- */
function renderWeekTile(){
  const el=$('weekTile');if(!el)return;
  const t=todayStr(),cw=Core.weekStart(t),lw=Core.addDays(cw,-7);
  const last=weekMode==='last';
  const s=last?Core.weekSummary(settings,days,lw):Core.weekSummary(settings,days,cw,t);
  const tx=reviewText(s,last?'Last week':'This week so far',false);
  el.innerHTML='';
  const card=h('<div class="card weekcard" id="weekCard" role="region" aria-label="Week summary"><div class="wk-top"><b class="t-head">Week at a glance</b></div><div class="seg" id="wkSeg" role="radiogroup" aria-label="Which week"><button role="radio" data-w="this" aria-checked="false">This week</button><button role="radio" data-w="last" aria-checked="false">Last week</button></div><div class="wk-big" id="wkBig"><b class="num"></b><span></span></div><p class="wk-cmp" id="wkCmp"></p><ul class="wk-list" id="wkList"></ul></div>');
  card.querySelectorAll('#wkSeg button').forEach(b=>{
    b.setAttribute('aria-checked',String(b.dataset.w===weekMode));
    b.addEventListener('click',()=>{if(weekMode!==b.dataset.w){weekMode=b.dataset.w;haptic('light');renderWeekTile()}});
  });
  const big=card.querySelector('#wkBig');
  if(s.daysDue>0){big.querySelector('b').textContent=s.daysKept+' of '+s.daysDue;big.querySelector('span').textContent=s.daysDue===1?'day kept':'days kept'}
  else{big.querySelector('b').textContent='–';big.querySelector('span').textContent=last?'Nothing was due last week':'Nothing due yet this week'}
  const cmp=card.querySelector('#wkCmp');
  if(last&&s.prevDaysDue>0)cmp.textContent=s.daysKept>s.prevDaysKept?'Up from '+s.prevDaysKept+' the week before.':s.daysKept<s.prevDaysKept?s.prevDaysKept+' the week before.':'The same as the week before.';
  else cmp.remove();
  const ul=card.querySelector('#wkList');
  tx.details.forEach(d=>{const li=document.createElement('li');li.textContent=d;ul.appendChild(li)});
  if(s.avgScore!=null){const li=document.createElement('li');li.textContent='Average score '+s.avgScore+'% on the days you logged.';ul.appendChild(li)}
  if(!ul.children.length)ul.remove();
  if(canShare()&&s.daysDue>0){
    const sh=h('<button class="txtbtn" id="wkShare">Share this week</button>');
    sh.addEventListener('click',()=>shareWeek(tx.headline+(tx.details.length?' '+tx.details.join(' '):'')));card.appendChild(sh);
  }
  el.appendChild(card);
}
function renderInsights(){
  const el=$('insightsCard');if(!el)return;
  el.innerHTML='';
  const list=Core.insightsDetailed(settings,days,todayStr());
  if(!list.length){el.hidden=true;return}
  el.hidden=false;
  const box=h('<div><h2 class="sec-head">Insights</h2><div class="card insights"><ul class="ins-list" id="insList"></ul><p class="t-foot muted ins-foot">Patterns in your own days. They describe what tends to happen, not why.</p></div></div>');
  const ul=box.querySelector('#insList');
  list.forEach(x=>{
    const li=h('<li class="ins-item"><span class="ins-ic"></span><div class="ins-body"><p class="ins-text"></p></div></li>');
    li.querySelector('.ins-ic').innerHTML=icon(x.kind==='plateau'?'heart':'lightbulb','sm');
    li.querySelector('.ins-text').textContent=x.text;
    const hb=x.kind==='skip'?habitOf(x.habitId):null,mv=hb&&Core.moveOffDay(hb,x.weekday);
    if(mv){
      const b=h('<button class="btn small secondary ins-move"></button>');
      b.textContent='Move it off '+Core.WEEKDAYS[x.weekday]+'s';
      b.setAttribute('aria-label','Move '+hb.name+' off '+Core.WEEKDAYS[x.weekday]+'s');
      b.addEventListener('click',()=>applyHabit(hb,{schedule:mv},hb.name+' now skips '+Core.WEEKDAYS[x.weekday]+'s','check'));
      li.querySelector('.ins-body').appendChild(b);
    }
    ul.appendChild(li);
  });
  el.appendChild(box);
}
function progressHook(){
  heatLegend();renderWeekTile();renderInsights();
}

/* the dismissal is read once from the device; the card appears after that */
try{prefGet(REVIEW_KEY).then(v=>{seen=v||'';renderReviewCard()}).catch(()=>{seen=''})}catch(e){seen=''}

return{todayHook,footHook,markHeatCell,markLogRow,daySheetHook,progressHook,renderReviewCard,toggleLight};
})();
