/* Pull-to-refresh on the Today screen.
   Pull down at the top: a small glass panel opens with one short line (a nudge from your own data when something applies,
   otherwise a general motivational line from data/nudges.json), the phone's step count is read once, and a sync starts only if
   the last one was more than 5 minutes ago. The panel stays 1 to 2.5 seconds, then closes. CSS-only animation, no libraries. */

const PTR_THRESHOLD=88;          // finger travel (px) that arms the refresh
const PTR_HOLD_PX=56;            // panel height while refreshing
const PTR_MAX_PX=72;             // most the panel opens while dragging
const PTR_MIN_MS=1000,PTR_MAX_MS=2500;
const PTR_SYNC_AFTER_MS=5*60*1000;
const PTR_HISTORY=20;
const FALLBACK_NUDGES=['Small steps still move you forward.','Show up today. That\'s the win.','Progress beats perfect.'];
let nudgeLines=null;

async function loadNudges(){
  if(nudgeLines)return nudgeLines;
  try{
    const r=await fetch('data/nudges.json');
    const j=await r.json();
    nudgeLines=(j.lines||[]).filter(t=>typeof t==='string'&&t.trim()&&t.length<60);
  }catch(e){}
  if(!nudgeLines||!nudgeLines.length)nudgeLines=FALLBACK_NUDGES.slice();
  return nudgeLines;
}
const pick=a=>a[Math.floor(Math.random()*a.length)];

/** Lines that fit what is happening today, best first. Each is {text,icon}. */
function contextualNudges(){
  const out=[],t=todayStr(),d=days[t],m=dayMetrics(d);
  if(m.hTotal>0&&m.hMet===m.hTotal)out.push({text:'Strong day. Your comeback is on track.',icon:'trophy',top:true});
  const sx=stepsHabit();
  if(sx&&stepsAuto()){
    const v=Number((d&&d.vals&&d.vals.steps)||0);
    if(v<sx.target)out.push({text:fmt(sx.target-v)+' steps to today\'s goal',icon:'footprints'});
  }
  settings.habits.filter(x=>x.id!=='steps'&&x.target>0&&!(d&&d.vals&&Number(d.vals[x.id])>0)).forEach(x=>out.push({text:x.name+' not logged yet today',icon:'circle-plus'}));
  const st=streak();
  if(st>=1)out.push({text:st+'-day streak. Keep it going.',icon:'flame'});
  return out;
}
/** Chooses the line for this pull: a contextual one if any applies and was not shown in the last 20 pulls, else a general one. */
async function chooseNudge(){
  const recent=new Set(meta.nudges||[]);
  const fresh=contextualNudges().filter(n=>!recent.has(n.text));
  let n=fresh.find(x=>x.top)||(fresh.length?pick(fresh):null);
  if(!n){
    const lines=await loadNudges();
    const free=lines.filter(l=>!recent.has(l));
    n={text:pick(free.length?free:lines),icon:'sparkles'};
  }
  meta.nudges=(meta.nudges||[]).concat(n.text).slice(-PTR_HISTORY);
  try{await store.saveMeta()}catch(e){}
  return n;
}

function initPullToRefresh(){
  const screen=$('p-today'),ptr=$('ptr');
  if(!screen||!ptr)return;
  const textEl=$('ptrText'),icEl=$('ptrIc');
  let startY=0,startX=0,tracking=false,dragging=false,armed=false,busy=false,line=null,linePromise=null;
  const setH=px=>ptr.style.setProperty('--ptr-h',px+'px');
  const setO=o=>ptr.style.setProperty('--ptr-o',String(o));
  const showLine=n=>{line=n;textEl.textContent=n.text;icEl.innerHTML=icon(n.icon,'sm')};
  const wantLine=()=>{if(!linePromise)linePromise=chooseNudge().then(n=>{showLine(n);return n})};
  const reset=()=>{ptr.classList.remove('drag','ready','hold','spring');line=null;linePromise=null;armed=false;dragging=false};
  const canStart=()=>activeTab==='today'&&!layers.length&&!onb&&!busy&&!editing&&window.scrollY<=0;

  screen.addEventListener('touchstart',e=>{
    if(e.touches.length!==1||!canStart()){tracking=false;return}
    tracking=true;dragging=false;armed=false;startY=e.touches[0].clientY;startX=e.touches[0].clientX;
  },{passive:true});

  document.addEventListener('touchmove',e=>{
    if(!tracking||busy)return;
    if(window.scrollY>0||layers.length){tracking=false;if(dragging)collapse();return}
    const dy=e.touches[0].clientY-startY,dx=e.touches[0].clientX-startX;
    if(!dragging){
      if(dy<=0||Math.abs(dx)>Math.abs(dy)){if(dy<-6||Math.abs(dx)>10)tracking=false;return}
      if(dy<10)return;
      dragging=true;ptr.classList.add('drag');wantLine();
    }
    if(e.cancelable)e.preventDefault();
    const crossed=dy>=PTR_THRESHOLD;
    if(crossed&&!armed){armed=true;ptr.classList.add('ready');haptic('light')}
    else if(!crossed&&armed){armed=false;ptr.classList.remove('ready')}
    if(reduced()){
      // no movement while dragging: the panel simply fades in once the pull is far enough
      setH(crossed?PTR_HOLD_PX:0);setO(crossed?1:0);
    }else{
      setH(Math.min(PTR_MAX_PX,dy*0.6));setO(Math.min(1,dy/PTR_THRESHOLD));
    }
  },{passive:false});

  const end=()=>{
    if(!tracking)return;tracking=false;
    if(!dragging)return;
    if(armed)refresh();else collapse();
  };
  document.addEventListener('touchend',end);
  document.addEventListener('touchcancel',()=>{if(!dragging)return;tracking=false;collapse()});

  function collapse(){
    ptr.classList.remove('drag','ready','hold','spring');
    setH(0);setO(0);
    setTimeout(()=>{if(!busy)reset()},reduced()?60:420);
  }

  async function refresh(){
    busy=true;
    ptr.classList.remove('drag');ptr.classList.add('hold');if(!reduced())ptr.classList.add('spring');
    setH(PTR_HOLD_PX);setO(1);
    const t0=Date.now();
    if(!linePromise)wantLine();
    // both happen while the panel is open: one read of the phone's step count, and a sync only if the last one was over 5 minutes ago
    const syncDue=signedIn()&&Date.now()-(sync.lastSyncAt||0)>PTR_SYNC_AFTER_MS;
    const work=Promise.allSettled([linePromise,refreshSteps(),syncDue?syncSoon(true):Promise.resolve()]);
    await Promise.race([work,new Promise(r=>setTimeout(r,PTR_MAX_MS))]);
    const left=PTR_MIN_MS-(Date.now()-t0);
    if(left>0)await new Promise(r=>setTimeout(r,left));
    renderToday(true);
    busy=false;collapse();
  }
  loadNudges();
}
initPullToRefresh();
