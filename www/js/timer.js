/* Timer for Duration habits (plank, a walk, stretching, meditation).
   A play button on the card opens a timer sheet: a ring that counts up to the target (or a countdown), Start / Pause / Stop, a haptic
   and a vibration at the target, and on Stop an "Add 0:42 to Plank" line that adds the time to the habit through commitDay.
   The running timer is kept as {habitId, day, mode, startedAt, pausedMs, pausedAt, reached, stopped} in Preferences ("comeback_timer",
   this phone only) and the time on screen is always worked out from those timestamps (Core.timerElapsed), so it is right after the
   screen was off, the app was in the background or it was closed. Opening the app again offers to pick it up. On Android a
   notification is also scheduled for the moment the target is reached. The screen is kept awake while the sheet is open
   (navigator.wakeLock, when the WebView has it). Reduced motion: the ring does not animate. */

/* a few icons the icon set did not need before (Lucide, ISC licence); added here so the shared icon file stays untouched */
(function(){
  const more={
    play:'<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
    pause:'<rect x="14" y="3" width="5" height="18" rx="1" /><rect x="5" y="3" width="5" height="18" rx="1" />',
    square:'<rect width="18" height="18" x="3" y="3" rx="2" />'
  };
  const I=window.CB_ICONS||(window.CB_ICONS={});
  Object.keys(more).forEach(k=>{if(!I[k])I[k]=more[k]});
})();

const TimerUI=(function(){
  const KEY='comeback_timer',NOTE_ID=1900,NOTE_CHANNEL='timer',RING=2*Math.PI*52,STALE_MS=6*3600*1000;
  let st=null;            // the saved timer, or null
  let sheet=null,ui=null,tickId=null,wake=null,viewHabit=null,pickMode='up';

  const running=()=>!!st&&st.pausedAt==null&&!st.stopped;
  const elapsed=()=>Core.timerElapsed(st,Date.now());
  const habitOf=id=>settings.habits.find(x=>x.id===id);
  async function save(){try{await prefSet(KEY,JSON.stringify(st))}catch(e){}}
  async function clear(){st=null;try{await Prefs.remove({key:KEY})}catch(e){}disarm();refreshCards()}
  const refreshCards=()=>{try{if(typeof renderSections==='function'&&!modalOpen())renderSections()}catch(e){}};
  function valid(s){
    return s&&typeof s==='object'&&typeof s.habitId==='string'&&Number.isFinite(s.startedAt)&&s.startedAt>0;
  }

  /* ---------- the notification for the moment the target is reached (Android app) ---------- */
  async function arm(){
    if(!IS_NATIVE||!Native.LocalNotifications||!st||!running())return;
    const x=habitOf(st.habitId),target=x?Core.timerTargetMs(x):0,left=target-elapsed();
    if(!(left>1000))return;
    try{
      if(!(await notifGranted()))return;
      await LN().cancel({notifications:[{id:NOTE_ID}]});
      await LN().createChannel({id:NOTE_CHANNEL,name:'Timer',description:'Tells you when a timer reaches its target',importance:4,visibility:1});
      await LN().schedule({notifications:[{id:NOTE_ID,title:'Comeback',body:x.name+': you reached '+Core.fmtClock(target)+'. Nice work.',channelId:NOTE_CHANNEL,smallIcon:'ic_stat_comeback',
        schedule:{at:new Date(Date.now()+left),allowWhileIdle:true},isExactNotification:false,extra:{tab:'today'}}]});
    }catch(e){}
  }
  async function disarm(){
    if(!IS_NATIVE||!Native.LocalNotifications)return;
    try{await LN().cancel({notifications:[{id:NOTE_ID}]})}catch(e){}
  }

  /* ---------- keeping the screen on ---------- */
  async function lock(){
    try{
      if(!sheet||wake||!navigator.wakeLock||document.hidden)return;
      wake=await navigator.wakeLock.request('screen');
      if(wake&&wake.addEventListener)wake.addEventListener('release',()=>{wake=null});
    }catch(e){wake=null}
  }
  function unlock(){try{if(wake)wake.release()}catch(e){}wake=null}

  /* ---------- the sheet ---------- */
  function say(t){if(ui)ui.status.textContent=t||''}
  function paint(){
    if(!ui||!viewHabit)return;
    const x=viewHabit,target=Core.timerTargetMs(x),e=st?elapsed():0,mode=st?st.mode:pickMode,down=mode==='down';
    const shown=down?Math.max(0,target-e):e;
    ui.time.textContent=Core.fmtClock(shown);
    ui.sub.textContent=down?(e>target&&target>0?'+'+Core.fmtClock(e-target)+' over':'left of '+Core.fmtClock(target)):'of '+Core.fmtClock(target);
    const frac=target>0?Math.min(1,e/target):0;
    ui.prg.style.strokeDashoffset=String(RING*(1-frac));
    const reached=target>0&&e>=target;
    ui.ring.classList.toggle('reached',reached);ui.ring.classList.toggle('paused',!!st&&!running());
    ui.ring.setAttribute('aria-label',x.name+' timer, '+Core.fmtClock(e)+' of '+Core.fmtClock(target));
    if(st&&running()&&reached&&!st.reached){
      st.reached=true;save();haptic('success');
      try{if(navigator.vibrate)navigator.vibrate([200,100,200,100,300])}catch(err){}
      say('Target reached. Nice work. You can keep going or stop.');
    }
    const idle=!st,confirm=!!st&&st.stopped;
    ui.modes.querySelectorAll('button').forEach(b=>{const on=b.dataset.mode===mode;b.setAttribute('aria-checked',String(on));b.setAttribute('aria-selected',String(on));b.disabled=!idle});
    ui.actions.hidden=confirm;ui.confirm.hidden=!confirm;
    ui.main.querySelector('span').textContent=idle?'Start':running()?'Pause':'Resume';
    const mic=idle||!running()?'play':'pause';
    if(ui.mainIc!==mic){ui.mainIc=mic;ui.main.querySelector('.ic').outerHTML=icon(mic,'sm')}
    ui.main.setAttribute('aria-label',(idle?'Start':running()?'Pause':'Resume')+' the '+x.name+' timer');
    ui.stop.hidden=idle;
    if(confirm)paintConfirm();
  }
  function paintConfirm(){
    const x=viewHabit,c=Core.timerCredit(x,elapsed());
    ui.confirmText.textContent=c.value>0?'Add '+Core.fmtClock(c.ms)+' to '+x.name:'That was too short to add anything.';
    ui.add.hidden=!(c.value>0);
    ui.add.textContent='Add '+Core.fmtClock(c.ms);
    ui.add.setAttribute('aria-label','Add '+Core.fmtClock(c.ms)+' to '+x.name);
    ui.discard.textContent=c.value>0?'Discard':'Close timer';
  }
  async function start(){
    const now=Date.now();
    st={habitId:viewHabit.id,day:todayStr(),mode:pickMode,startedAt:now,pausedMs:0,pausedAt:null,reached:false,stopped:false};
    await save();haptic('light');lock();say('Timer started.');paint();arm();refreshCards();
  }
  async function pause(){
    st.pausedAt=Date.now();await save();haptic('light');disarm();say('Paused.');paint();refreshCards();
  }
  async function resume(){
    st.pausedMs=(st.pausedMs||0)+(Date.now()-st.pausedAt);st.pausedAt=null;st.stopped=false;
    await save();haptic('light');lock();say('Timer running.');paint();arm();refreshCards();
  }
  async function stop(){
    if(st.pausedAt==null)st.pausedAt=Date.now();
    st.stopped=true;await save();haptic('light');disarm();say('');paint();
    if(ui&&!ui.add.hidden)ui.add.focus({preventScroll:true});
  }
  async function addToHabit(){
    const x=viewHabit,c=Core.timerCredit(x,elapsed()),day=st.day||todayStr();
    if(!(c.value>0))return;
    const label=x.name+' +'+Core.fmtClock(c.ms);
    await clear();
    close();
    commitDay(label,dd=>{dd.vals[x.id]=r1((dd.vals[x.id]||0)+c.value)},false,day);
  }
  async function discard(){
    const x=viewHabit,c=Core.timerCredit(x,elapsed());
    if(c.ms>=60000){
      const r=await actionSheet({title:'Discard this timer?',message:Core.fmtClock(c.ms)+' of '+x.name+' will not be added.',actions:[{label:'Discard',value:'go',destructive:true}],cancelLabel:'Keep it'});
      if(r!=='go')return;
    }
    await clear();close();
  }
  async function keepGoing(){await resume()}
  function close(){if(sheet){const s=sheet;sheet=null;s.close('cancel')}}
  function teardown(){
    clearInterval(tickId);tickId=null;unlock();ui=null;sheet=null;
    document.removeEventListener('visibilitychange',onVis);
    setTimeout(refreshCards,0);   // after the sheet has left the layer list
  }
  function onVis(){if(!document.hidden&&sheet){lock();paint()}}

  async function open(x){
    if(!Core.timerUnit(x))return;
    if(sheet)return;
    if(st&&st.habitId!==x.id){
      const other=habitOf(st.habitId);
      if(other&&Core.timerUnit(other)){toast('Finish the '+other.name+' timer first. Opening it now.',{icon:'timer'});return open(other)}
      await clear();
    }
    viewHabit=x;pickMode=st?st.mode:'up';
    const root=h('<div class="timer" id="timerRoot"><div class="seg timer-mode" id="tmModes" role="radiogroup" aria-label="Timer type"><button role="radio" data-mode="up" aria-checked="true">Count up</button><button role="radio" data-mode="down" aria-checked="false">Count down</button></div><div class="timer-ring" id="tmRing" role="timer"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="trk" cx="60" cy="60" r="52" fill="none" stroke-width="10"/><circle class="prg" id="tmPrg" cx="60" cy="60" r="52" fill="none" stroke-width="10" stroke-dasharray="326.73" stroke-dashoffset="326.73"/></svg><div class="timer-c" aria-hidden="true"><b class="timer-time num" id="tmTime">0:00</b><span class="timer-sub" id="tmSub"></span></div></div><p class="timer-status" id="tmStatus" role="status" aria-live="polite"></p><div class="timer-actions" id="tmActions"><button class="btn" id="tmMain"><svg class="ic sm" aria-hidden="true"></svg><span>Start</span></button><button class="btn secondary" id="tmStop" hidden><svg class="ic sm" aria-hidden="true"></svg><span>Stop</span></button></div><div class="timer-confirm" id="tmConfirm" hidden><p id="tmConfirmText"></p><button class="btn" id="tmAdd"></button><button class="btn secondary" id="tmKeep">Keep going</button><button class="btn secondary" id="tmDiscard">Discard</button></div></div>');
    const q=s=>root.querySelector(s);
    ui={modes:q('#tmModes'),ring:q('#tmRing'),prg:q('#tmPrg'),time:q('#tmTime'),sub:q('#tmSub'),status:q('#tmStatus'),actions:q('#tmActions'),main:q('#tmMain'),stop:q('#tmStop'),confirm:q('#tmConfirm'),confirmText:q('#tmConfirmText'),add:q('#tmAdd'),keep:q('#tmKeep'),discard:q('#tmDiscard')};
    ui.stop.querySelector('.ic').outerHTML=icon('square','sm');
    ui.modes.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{if(st)return;pickMode=b.dataset.mode;haptic('light');paint()}));
    ui.main.addEventListener('click',()=>{if(!st)start();else if(running())pause();else resume()});
    ui.stop.addEventListener('click',stop);
    ui.add.addEventListener('click',addToHabit);
    ui.keep.addEventListener('click',keepGoing);
    ui.discard.addEventListener('click',discard);
    sheet=openSheet({title:x.name+' timer',left:'Close',leftId:'tmClose',right:null,content:root,onCancel:()=>{
      const was=running();
      teardown();
      if(was)toast('The timer keeps running. Open it again from the card.',{icon:'timer'});
    }});
    document.addEventListener('visibilitychange',onVis);
    tickId=setInterval(paint,250);
    lock();paint();
    if(st&&st.stopped)say('');
    else if(st&&running())say('Timer running.');
    else if(st)say('Paused.');
    else say(Core.timerTargetMs(x)>0?'Aim for '+Core.fmtClock(Core.timerTargetMs(x))+'. Any amount counts.':'');
  }

  /* ---------- after the app was closed: offer to pick the timer up ---------- */
  async function init(){
    let raw=null;
    try{raw=await prefGet(KEY)}catch(e){}
    if(!raw)return;
    let s=null;try{s=JSON.parse(raw)}catch(e){}
    const x=valid(s)&&habitOf(s.habitId);
    if(!x||!Core.timerUnit(x)){try{await Prefs.remove({key:KEY})}catch(e){}return}
    st={habitId:s.habitId,day:typeof s.day==='string'?s.day:todayStr(),mode:s.mode==='down'?'down':'up',startedAt:s.startedAt,pausedMs:Number.isFinite(s.pausedMs)?s.pausedMs:0,
      pausedAt:Number.isFinite(s.pausedAt)?s.pausedAt:null,reached:!!s.reached,stopped:!!s.stopped};
    refreshCards();
    setTimeout(async()=>{
      if(!st||sheet||inOnboarding()||modalOpen())return;
      const e=Core.fmtClock(elapsed()),old=running()&&elapsed()>STALE_MS;
      const msg=old?'It looks like it was left running ('+e+'). You can open it to add the time, or discard it.'
        :running()?'It has been counting: '+e+'. Pick up where you left off?':st.stopped?'It was stopped at '+e+'. You can add that time now.':'It is paused at '+e+'. Pick up where you left off?';
      const r=await actionSheet({title:'Your '+x.name+' timer is still here',message:msg,actions:[{label:'Open the timer',value:'open'}],cancelLabel:'Not now'});
      if(r==='open')open(x);
    },700);
  }

  /* ---------- the play button on a card ---------- */
  function button(x){
    const mine=!!st&&st.habitId===x.id,b=h('<button class="cbtn timerbtn"></button>');
    b.innerHTML=icon(mine&&running()?'pause':'play','sm');
    b.classList.toggle('on',mine);
    b.setAttribute('aria-label',mine?'Open the '+x.name+' timer, '+(running()?'running':st.stopped?'stopped':'paused'):'Start a timer for '+x.name);
    b.addEventListener('click',e=>{e.stopPropagation();haptic('light');open(x)});
    return b;
  }
  return{open,init,button,get state(){return st}};
})();

const openTimer=x=>TimerUI.open(x);
const timerButton=x=>TimerUI.button(x);
const initTimer=()=>TimerUI.init();
