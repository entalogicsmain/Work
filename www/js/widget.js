/* Home-screen widget feed (Android app only).
   The page is the only place that knows the habit plan and the day records, so it hands the phone a small snapshot of today whenever the
   Today numbers change. The native "Widget" plugin saves it and redraws the widget; the widget never reads the page and never uses the network.
   Snapshot: {date:'YYYY-MM-DD', score:0-100|null, label:'12-day streak'|'Rest day'|'Light day'|null, steps, stepsTarget, openHabit:'Water'|null, updatedAt}.
   This file changes nothing else: it watches the Today header (the ring percent, the title lines and the streak line change on every
   renderToday), the step updates, and the app coming or going. It does nothing in a browser. */

const WIDGET_DEBOUNCE_MS=1500;
let widgetTimer=null,widgetLast='',widgetReady=false,widgetPlug;

/** The native plugin, or null in a browser. The Capacitor global is the fallback so the bundled native.js does not have to list it. */
function widgetPlugin(){
  if(!IS_NATIVE)return null;
  if(widgetPlug!==undefined)return widgetPlug;
  widgetPlug=null;
  try{
    if(Native.Widget)widgetPlug=Native.Widget;
    else if(window.Capacitor&&typeof window.Capacitor.registerPlugin==='function')widgetPlug=window.Capacitor.registerPlugin('Widget');
  }catch(e){}
  return widgetPlug;
}

/** What the widget shows, for today (the day on screen does not matter). Score is null on a rest day (nothing due) and on a light day. */
function widgetSnapshot(){
  const k=todayStr(),d=days[k];
  const parts=Core.dayParts(settings,days,k);
  const light=Core.isLight(d),rest=parts.length===0;
  const st=streak();
  const sh=stepsHabit();
  let steps=0,target=0;
  if(sh&&!sh.hidden){steps=Math.max(0,Math.round(Number(Core.hv(sh,d))||0));target=Math.max(0,Math.round(Number(sh.target)||0))}
  // the next thing still to do: the first habit in the plan's order that is not met (Steps has its own line on the widget)
  const open=light?null:parts.find(p=>!p.met&&p.h.type!=='steps'&&Core.rampVisible(settings,days,k,p.h));
  return{
    date:k,
    score:light||rest?null:dayMetrics(d,k).score,
    label:light?'Light day':rest?'Rest day':st>0?st+'-day streak':null,
    steps,stepsTarget:target,
    openHabit:open?String(open.h.name):null,
    updatedAt:Date.now()
  };
}

/** Send the snapshot now, unless nothing but the time stamp changed (or the saved entries could not be read). Returns whether it was sent. */
function widgetSendNow(){
  clearTimeout(widgetTimer);widgetTimer=null;
  const p=widgetPlugin();
  if(!p||!widgetReady||dataLocked)return false;
  let snap;
  try{snap=widgetSnapshot()}catch(e){return false}
  const sig=JSON.stringify(Object.assign({},snap,{updatedAt:0}));
  if(sig===widgetLast)return false;
  widgetLast=sig;
  try{const r=p.setWidgetSnapshot(snap);if(r&&typeof r.catch==='function')r.catch(()=>{widgetLast=''})}catch(e){widgetLast=''}
  return true;
}

/** Ask for the widget to be updated: waits 1.5 s so a burst of changes becomes one message. */
function pushWidgetSnapshot(){
  if(!widgetPlugin())return;
  clearTimeout(widgetTimer);
  widgetTimer=setTimeout(widgetSendNow,WIDGET_DEBOUNCE_MS);
}

(function initWidget(){
  if(!widgetPlugin())return;
  // Today's header is rewritten by every renderToday (after logging, step updates, the day rolling over, a restore or a sync)
  try{
    const mo=new MutationObserver(pushWidgetSnapshot);
    ['headScore','todaySub','todayTitle','streakLine','ring'].forEach(id=>{
      const el=document.getElementById(id);if(!el)return;
      mo.observe(el,id==='ring'?{attributes:true,attributeFilter:['aria-label']}:{childList:true,characterData:true,subtree:true});
    });
  }catch(e){}
  try{if(Native.Steps)Native.Steps.addListener('stepsChanged',pushWidgetSnapshot)}catch(e){}
  // leaving the screen: send at once, because the page is paused two seconds later and its timers stop
  document.addEventListener('visibilitychange',()=>{if(document.hidden)widgetSendNow();else pushWidgetSnapshot()});
  // The first draw of Today happens before the saved entries are read. refreshAll runs once they are in (and after a restore or a sync), so wait for it.
  if(typeof refreshAll==='function'){
    const orig=refreshAll;
    refreshAll=function(){const r=orig.apply(this,arguments);widgetReady=true;pushWidgetSnapshot();return r};
  }
})();
