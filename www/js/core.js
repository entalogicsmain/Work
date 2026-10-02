/* Comeback core: the data model and every rule that does not touch the screen.
   Habits (type, section, schedule), the migration from the older structure, due-day and score logic, streaks,
   target suggestions, the habit library, starter plans, BMI and unit maths.
   Plain functions on plain data, so they can be tested without a browser (test/core-test.mjs). */
const Core=(function(){
'use strict';

/* ---------- dates (local calendar days as "YYYY-MM-DD") ---------- */
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse=s=>{const p=s.split('-').map(Number);return new Date(p[0],p[1]-1,p[2])};
const addDays=(k,n)=>{const d=parse(k);d.setDate(d.getDate()+n);return ymd(d)};
/** Whole calendar days from a to b (negative when b is earlier). Exact across clock changes: it never divides a time difference. */
const daysBetween=(a,b)=>{const u=s=>{const p=s.split('-').map(Number);return Date.UTC(p[0],p[1]-1,p[2])/864e5};return Math.round(u(b)-u(a))};
const blankDay=k=>({vals:{},rules:{},weight:null,waist:null,note:'',date:k,updatedAt:0});
const dow=k=>parse(k).getDay();                                   // 0 = Sunday
const weekStart=k=>{const d=parse(k);d.setDate(d.getDate()-((d.getDay()+6)%7));return ymd(d)};   // weeks run Monday to Sunday
const daysLeftInWeek=k=>7-((parse(k).getDay()+6)%7);              // counting k itself
const round1=n=>Math.round(n*10)/10;
const num=v=>typeof v==='number'&&isFinite(v);
const ID_RE=/^[A-Za-z0-9_-]{1,64}$/;

/* ---------- model ---------- */
const TYPES=['count','duration','yesno','steps','measure'];
const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEEK_ORDER=[1,2,3,4,5,6,0];     // Monday first when showing day pickers
const ICONS=['footprints','timer','dumbbell','droplets','moon','scale','ruler','circle-check','flame','bike','person-standing','apple','carrot','pill','book-open','brain','notebook-pen','utensils','candy-off','beef','salad','sandwich','coffee','cup-soda','activity','heart','sun','sunrise','armchair','accessibility','flower-2','mountain','waves','trophy','target','cookie','leaf','phone-off','bed-double','stretch-horizontal','glass-water','ban','sparkles','lightbulb'];
const DEFAULT_SECTIONS=[
  {id:'movement',name:'Movement'},{id:'workout',name:'Workout'},{id:'health',name:'Health'},{id:'food',name:'Food rules'},{id:'body',name:'Body and notes',collapsed:true}
];
const DAILY={kind:'daily'};

function normalizeSchedule(s){
  if(!s||typeof s!=='object')return{kind:'daily'};
  if(s.kind==='days'&&Array.isArray(s.days)){
    const ds=[...new Set(s.days.filter(d=>Number.isInteger(d)&&d>=0&&d<=6))].sort((a,b)=>a-b);
    return ds.length&&ds.length<7?{kind:'days',days:ds}:{kind:'daily'};
  }
  if(s.kind==='weekly'&&num(s.times))return{kind:'weekly',times:Math.min(7,Math.max(1,Math.round(s.times)))};
  if(s.kind==='everyN'&&num(s.weeks))return{kind:'everyN',weeks:Math.min(52,Math.max(1,Math.round(s.weeks)))};
  return{kind:'daily'};
}
function scheduleLabel(s){
  s=normalizeSchedule(s);
  if(s.kind==='daily')return'Every day';
  if(s.kind==='days')return WEEK_ORDER.filter(d=>s.days.includes(d)).map(d=>WEEKDAYS[d]).join(', ');
  if(s.kind==='weekly')return s.times+(s.times===1?' time':' times')+' a week';
  return s.weeks===1?'Every week':'Every '+s.weeks+' weeks';
}

/* ---------- the older structure and the migration into the new one ---------- */
const LEGACY_DEFAULT={
  habits:[
    {id:'steps',name:'Steps',unit:'steps',target:8000},{id:'walk',name:'Brisk walk',unit:'min',target:30},
    {id:'pushups',name:'Pushups',unit:'reps',target:30},{id:'pullups',name:'Pull-ups',unit:'reps',target:5},
    {id:'squats',name:'Squats',unit:'reps',target:30},{id:'plank',name:'Plank',unit:'sec',target:60},
    {id:'water',name:'Water',unit:'litres',target:2.5},{id:'sleep',name:'Sleep',unit:'hours',target:7}
  ],
  rules:[
    {id:'nofried',name:'No fried food (zinger, fries, samosa)'},{id:'nosugar',name:'No cold drinks, juice or sugar in tea'},
    {id:'nomaida',name:'No maida (buns, naan, bakery)'},{id:'nolate',name:'Nothing eaten after 10 pm'}
  ]
};
const KNOWN={   // icon and section for the habits every earlier version shipped with
  steps:['footprints','movement'],walk:['timer','movement'],pushups:['dumbbell','workout'],pullups:['dumbbell','workout'],
  squats:['dumbbell','workout'],plank:['timer','workout'],water:['droplets','health'],sleep:['moon','health']
};
const isDurationUnit=u=>/^(min|mins|minutes?|sec|secs|seconds?)$/i.test(u||'');
/** Steps is only ever the habit with the id "steps" (the app reads steps by that id); anything else with a steps unit is a plain Count. */
function guessType(h){
  if(h.id==='steps')return'steps';
  return isDurationUnit(h.unit)?'duration':'count';
}
function guessSection(h,type){
  if(KNOWN[h.id])return KNOWN[h.id][1];
  if(type==='steps')return'movement';
  if(type==='yesno')return'food';
  if(type==='measure')return'body';
  if(/^(min|mins|minutes?)$/i.test(h.unit||''))return'movement';
  if(/^(litres?|liters?|glass(es)?|hours?|cups?)$/i.test(h.unit||''))return'health';
  return'workout';
}
function guessIcon(h,type){
  if(KNOWN[h.id])return KNOWN[h.id][0];
  if(type==='steps')return'footprints';
  if(type==='yesno')return'circle-check';
  if(type==='duration')return'timer';
  if(/litre|glass|cup/i.test(h.unit||''))return'droplets';
  if(/hour/i.test(h.unit||''))return'moon';
  return'dumbbell';
}
function stepFor(h){
  if(h.step&&h.step>0)return h.step;
  if(h.type==='duration')return/^sec/i.test(h.unit||'')?10:5;
  if(h.type==='count'){
    if(/^(reps|times|rep)$/i.test(h.unit||''))return 1;
    return h.target<10?0.5:1;
  }
  return 1;
}
function uniqueId(base,taken){
  let id=base,i=2;
  while(taken.has(id)){id=base+'-'+i;i++}
  taken.add(id);return id;
}

function normalizeHabit(h,i){
  if(!h||typeof h.id!=='string'||!ID_RE.test(h.id)||typeof h.name!=='string'||!h.name.trim())throw new Error('Habit #'+(i+1)+' in the backup is not valid.');
  let type=TYPES.includes(h.type)?h.type:guessType(h);
  const isYes=type==='yesno',isMeasure=type==='measure';
  if(!isYes&&!isMeasure&&(!num(h.target)||h.target<=0))throw new Error('Habit "'+h.name.slice(0,40)+'" has an invalid target.');
  const out={id:h.id,name:h.name,icon:ICONS.includes(h.icon)?h.icon:guessIcon(h,type),type,
    unit:typeof h.unit==='string'&&h.unit?h.unit:(isYes?'':isMeasure?(h.measure==='waist'?'cm':'kg'):'times'),
    target:isYes?1:isMeasure?0:h.target,
    section:typeof h.section==='string'&&h.section?h.section:guessSection(h,type),
    schedule:normalizeSchedule(h.schedule)};
  if(isMeasure)out.measure=h.measure==='waist'?'waist':'weight';
  if(num(h.step)&&h.step>0)out.step=h.step;
  if(h.hidden===true)out.hidden=true;
  if(typeof h.lib==='string')out.lib=h.lib;
  return out;
}

function normalizeBody(b){
  const o=b&&typeof b==='object'?b:{};
  return{heightCm:num(o.heightCm)&&o.heightCm>=50&&o.heightCm<=260?o.heightCm:null,scale:o.scale==='asian'?'asian':'standard'};
}
function normalizeUnits(u){
  const o=u&&typeof u==='object'?u:{};
  return{weight:o.weight==='lb'?'lb':'kg',length:o.length==='ftin'?'ftin':'cm'};
}
function normalizePrefs(p){
  const o=p&&typeof p==='object'?p:{};
  return{suggestions:o.suggestions!==false};
}

/** Takes settings in either structure and returns {settings, idMap, wasLegacy}. Safe to run any number of times. */
function migrateSettings(s){
  if(!s||typeof s!=='object'||!Array.isArray(s.habits))throw new Error('The backup is missing its settings (habits and rules).');
  const wasLegacy=s.v!==2;
  if(wasLegacy&&!Array.isArray(s.rules))throw new Error('The backup is missing its settings (habits and rules).');
  const taken=new Set(),habits=[],idMap={};
  const seen=new Set();
  s.habits.forEach((h,i)=>{
    const n=normalizeHabit(h,i);
    if(seen.has(n.id))return;seen.add(n.id);taken.add(n.id);habits.push(n);
  });
  // at most one Steps habit, and its id is "steps": the extra ones become Counts, a lone one with another id is renamed (its day data follows)
  const valsMap={};
  const stepsHs=habits.filter(h=>h.type==='steps');
  if(stepsHs.length){
    const keep=stepsHs.find(h=>h.id==='steps')||(taken.has('steps')?null:stepsHs[0]);
    stepsHs.forEach(h=>{if(h!==keep){h.type='count';if(/^steps?$/i.test(h.unit)&&!h.step)h.step=500}});
    if(keep&&keep.id!=='steps'){valsMap[keep.id]='steps';taken.delete(keep.id);taken.add('steps');keep.id='steps'}
  }
  if(wasLegacy){
    // rules become Yes/No habits (their ticks stay where they were, in each day's "rules")
    const seenR=new Set();
    s.rules.forEach((r,i)=>{
      if(!r||typeof r.id!=='string'||!ID_RE.test(r.id)||typeof r.name!=='string'||!r.name.trim())throw new Error('Rule #'+(i+1)+' in the backup is not valid.');
      if(seenR.has(r.id))return;seenR.add(r.id);
      let id=r.id;
      if(taken.has(id)){id=uniqueId(r.id+'-rule',taken);idMap[r.id]=id}else taken.add(id);
      habits.push({id,name:r.name,icon:'circle-check',type:'yesno',unit:'',target:1,section:'food',schedule:{kind:'daily'}});
    });
  }
  // weight and waist are habits too (they have schedules); a measurement habit is found by its "measure", not its id
  const hasM=m=>habits.some(h=>h.type==='measure'&&h.measure===m);
  if(!hasM('weight'))habits.push({id:uniqueId('weight',taken),name:'Weight',icon:'scale',type:'measure',unit:'kg',target:0,section:'body',schedule:{kind:'weekly',times:3},measure:'weight'});
  if(!hasM('waist'))habits.push({id:uniqueId('waist',taken),name:'Waist',icon:'ruler',type:'measure',unit:'cm',target:0,section:'body',schedule:{kind:'everyN',weeks:2},measure:'waist'});
  // sections: the saved ones, then any a habit points at, then the defaults that are missing
  const sections=[],secIds=new Set();
  const addSec=(id,name,collapsed)=>{if(secIds.has(id))return;secIds.add(id);const o={id,name:name||id};if(collapsed)o.collapsed=true;sections.push(o)};
  if(!wasLegacy&&Array.isArray(s.sections))s.sections.forEach(x=>{if(x&&typeof x.id==='string'&&ID_RE.test(x.id)&&typeof x.name==='string'&&x.name.trim())addSec(x.id,x.name.trim().slice(0,40),x.collapsed===true)});
  habits.forEach(h=>{if(!secIds.has(h.section)){const d=DEFAULT_SECTIONS.find(x=>x.id===h.section);if(d)addSec(d.id,d.name,d.collapsed);else addSec(h.section,h.section.charAt(0).toUpperCase()+h.section.slice(1).replace(/[-_]+/g,' '))}});
  if(wasLegacy||!sections.length)DEFAULT_SECTIONS.forEach(d=>addSec(d.id,d.name,d.collapsed));
  const out={v:2,habits,sections,body:normalizeBody(s.body),units:normalizeUnits(s.units),prefs:normalizePrefs(s.prefs)};
  if(Object.keys(valsMap).length)idMap[VALS_MAP]=valsMap;
  return{settings:out,idMap,wasLegacy};
}
/* idMap moves old rule ids to new ones (in a day's "rules"). A hidden entry under VALS_MAP does the same for renamed habits (in "vals"),
   so callers that already pass the id map to applyIdMap move both. */
const VALS_MAP=Symbol('valsMap');
function applyIdMap(days,idMap){
  const keys=Object.keys(idMap||{}),vm=(idMap&&idMap[VALS_MAP])||{},vkeys=Object.keys(vm);let n=0;
  if(!keys.length&&!vkeys.length)return 0;
  Object.keys(days).forEach(k=>{
    const d=days[k];if(!d)return;
    const r=d.rules;
    if(r)keys.forEach(o=>{if(o in r){if(!(idMap[o] in r))r[idMap[o]]=r[o];delete r[o];n++}});
    const v=d.vals;
    if(v)vkeys.forEach(o=>{if(o in v){if(!(vm[o] in v))v[vm[o]]=v[o];delete v[o];n++}});
  });
  return n;
}
const defaultSettings=()=>migrateSettings(JSON.parse(JSON.stringify(LEGACY_DEFAULT))).settings;

/* ---------- reading a day ---------- */
const hv=(h,d)=>{
  if(!d)return null;
  if(h.type==='yesno')return d.rules&&d.rules[h.id]?1:0;
  if(h.type==='measure'){const v=d[h.measure];return v==null?null:v}
  const v=d.vals&&d.vals[h.id];return v==null?null:v;
};
const isMet=(h,d)=>{
  if(!d)return false;
  if(h.type==='yesno')return!!(d.rules&&d.rules[h.id]);
  if(h.type==='measure')return d[h.measure]!=null;
  const v=hv(h,d);return v!=null&&h.target>0&&v>=h.target;
};
const isLogged=(h,d)=>{
  if(!d)return false;
  if(h.type==='yesno')return!!(d.rules&&d.rules[h.id]);
  if(h.type==='measure')return d[h.measure]!=null;
  const v=hv(h,d);return v!=null&&v>0;
};

/* ---------- schedules ---------- */
function metBeforeInWeek(h,k,days){
  let n=0;
  for(let c=weekStart(k);c<k;c=addDays(c,1))if(isMet(h,days[c]))n++;
  return n;
}
/** Is this habit due on day k? A day it was logged on always counts as due. */
function isDue(h,k,days){
  const s=normalizeSchedule(h.schedule),d=days[k];
  if(s.kind==='daily')return true;
  if(s.kind==='days')return s.days.includes(dow(k))||isLogged(h,d);
  if(s.kind==='weekly')return metBeforeInWeek(h,k,days)<s.times||isMet(h,d);
  // every N weeks: due unless it was done within the last N weeks
  if(isMet(h,d))return true;
  for(let i=1;i<s.weeks*7;i++)if(isMet(h,days[addDays(k,-i)]))return false;
  return true;
}
/** "2 of 3 this week" for X-times-a-week habits, else null. Includes today's tick. */
function weekProgress(h,k,days){
  const s=normalizeSchedule(h.schedule);
  if(s.kind!=='weekly')return null;
  return{done:metBeforeInWeek(h,k,days)+(isMet(h,days[k])?1:0),of:s.times};
}
/** Shown on Today for day k: due (or already logged) and not hidden. */
const isShown=(h,k,days)=>!h.hidden&&(isDue(h,k,days)||isLogged(h,days[k]));
/** Does it weigh on that day's score? Flexible habits (X a week, every N weeks) only count when you did some of it, or must be done today to keep up. */
function countsForScore(h,k,days){
  if(h.hidden||h.type==='measure')return false;
  const s=normalizeSchedule(h.schedule),d=days[k];
  if(s.kind==='daily'||s.kind==='days')return isDue(h,k,days)||isLogged(h,d);
  if(!isDue(h,k,days))return false;
  if(isLogged(h,d))return true;
  if(s.kind==='weekly')return(s.times-metBeforeInWeek(h,k,days))>=daysLeftInWeek(k);
  return false;
}
function dayParts(settings,days,k){
  const d=days[k],parts=[];
  settings.habits.forEach(h=>{
    if(!countsForScore(h,k,days))return;
    const v=hv(h,d);
    const frac=h.type==='yesno'?(isMet(h,d)?1:0):(h.target>0?Math.min(Number(v||0)/h.target,1):0);
    parts.push({h,frac,met:isMet(h,d)});
  });
  return parts;
}
const scoreOfParts=p=>p.length?Math.round(p.reduce((a,b)=>a+b.frac,0)/p.length*100):null;
/** 0-100, or null when nothing was due (a rest day). */
function dayScore(settings,days,k){return scoreOfParts(dayParts(settings,days,k))}
/** What Today's ring and chips show: the score (0 on a rest day), targets met, rules kept, and whether everything due is done. */
function dayMetrics(settings,days,k){
  const parts=dayParts(settings,days,k);
  const tg=parts.filter(p=>p.h.type!=='yesno'),rl=parts.filter(p=>p.h.type==='yesno');
  return{score:scoreOfParts(parts)||0,hMet:tg.filter(p=>p.met).length,hTotal:tg.length,rKept:rl.filter(p=>p.met).length,rTotal:rl.length,full:parts.length>0&&parts.every(p=>p.met)};
}

/* ---------- logged days, streaks ---------- */
/** Does the day record hold anything? An empty record (what undo leaves behind while signed in) is not a logged day. */
function hasRecord(d){
  if(!d)return false;
  if(d.weight!=null||d.waist!=null)return true;
  if(typeof d.note==='string'&&d.note.trim())return true;
  if(d.vals)for(const i in d.vals)if(Number(d.vals[i])>0)return true;
  if(d.rules)for(const i in d.rules)if(d.rules[i])return true;
  return false;
}
/** The days that hold something, oldest first. */
const loggedKeys=days=>Object.keys(days).filter(k=>hasRecord(days[k])).sort();

/* Scores are cached per day until the days or the plan change. The key is the days object itself, the plan's scoring fields, and a cheap
   fingerprint of every day (count, updatedAt, values, ticks, measurements), so even an edit made in place is noticed. Code that changes
   days in some other way can call invalidate(). */
let cacheRev=0;
const cache={days:null,hs:'',ds:'',rev:-1,scores:new Map(),memo:new Map(),first:undefined};
function invalidate(){cacheRev++}
function habitSig(settings){return settings.habits.map(h=>h.id+':'+h.type+':'+h.target+':'+(h.hidden?1:0)+':'+(h.measure||'')+':'+JSON.stringify(h.schedule)).join('|')}
function daysSig(days){
  let n=0,sum=0;
  for(const k in days){
    const d=days[k];if(!d)continue;
    n++;sum+=(d.updatedAt||0)+(d.weight||0)*3+(d.waist||0)*7+(d.note?d.note.length*11:0);
    if(d.vals)for(const i in d.vals)sum+=(Number(d.vals[i])||0)*5+1;
    if(d.rules)for(const i in d.rules)if(d.rules[i])sum+=13;
  }
  return n+':'+sum;
}
function fresh(settings,days){
  const hs=habitSig(settings),ds=daysSig(days);
  if(cache.days===days&&cache.rev===cacheRev&&cache.hs===hs&&cache.ds===ds)return;
  cache.days=days;cache.rev=cacheRev;cache.hs=hs;cache.ds=ds;cache.scores=new Map();cache.memo=new Map();cache.first=undefined;
}
function scoreAt(settings,days,k){
  let v=cache.scores.get(k);
  if(v===undefined){v=dayScore(settings,days,k);cache.scores.set(k,v)}
  return v;
}
function firstKey(days){
  if(cache.first===undefined)cache.first=loggedKeys(days)[0]||null;
  return cache.first;
}
const kept=(settings,days,k)=>{const sc=scoreAt(settings,days,k);return sc!==null&&sc>=50&&hasRecord(days[k])};
/** Days in a row with a score of 50 or more. Today counts once it is at 50; until then the count runs from yesterday, so the streak
    never drops during an open day. Rest days (nothing due) are skipped. */
function currentStreak(settings,days,today){
  fresh(settings,days);
  const mk='cur:'+today;if(cache.memo.has(mk))return cache.memo.get(mk);
  const first=firstKey(days);let n=0;
  if(first){
    let k=kept(settings,days,today)?today:addDays(today,-1);
    for(let i=0;i<4000&&k>=first;i++,k=addDays(k,-1)){
      const sc=scoreAt(settings,days,k);
      if(sc===null)continue;
      if(kept(settings,days,k))n++;else break;
    }
  }
  cache.memo.set(mk,n);return n;
}
function bestStreak(settings,days,today){
  fresh(settings,days);
  const mk='best:'+today;if(cache.memo.has(mk))return cache.memo.get(mk);
  const first=firstKey(days);let best=0,run=0;
  if(first)for(let k=first;k<=today;k=addDays(k,1)){
    const sc=scoreAt(settings,days,k);
    if(sc===null)continue;
    if(kept(settings,days,k)){run++;if(run>best)best=run}
    else if(k!==today)run=0;          // today is still open: it can only add to a run
  }
  cache.memo.set(mk,best);return best;
}
/** "31 of the last 35 days kept": days with a score of 50 or more among the days that were due, from the first logged day on.
    Today counts only once it is kept. */
function daysKept(settings,days,today,n){
  fresh(settings,days);
  const first=firstKey(days);if(!first)return{kept:0,due:0};
  let start=addDays(today,-((n||35)-1));if(start<first)start=first;
  let got=0,due=0;
  for(let k=start;k<=today;k=addDays(k,1)){
    const sc=scoreAt(settings,days,k);
    if(sc===null)continue;
    const ok=kept(settings,days,k);
    if(k===today&&!ok)continue;
    due++;if(ok)got++;
  }
  return{kept:got,due};
}
/** Everything the streak texts need in one go. */
function streakStatus(settings,days,today){
  fresh(settings,days);
  const sc=scoreAt(settings,days,today),todayKept=kept(settings,days,today);
  return{current:currentStreak(settings,days,today),best:bestStreak(settings,days,today),todayScore:sc,todayRecord:hasRecord(days[today]),todayKept,open:sc!==null&&!todayKept};
}
/** The line under the ring on Today. Gentle: it never says "start again" while today is still being worked on. */
function streakLine(settings,days,today){
  const s=streakStatus(settings,days,today);
  if(s.current>0)return s.current+'-day streak'+(s.open?' · today still open':'');
  if(s.todayRecord&&s.open)return'Reach 50% today to start a streak';
  if(s.best>0&&s.todayScore!==null)return'Start again today';
  if(s.best>0)return'Rest day today';
  return'Log a day to start a streak';
}

/* ---------- smart target suggestions ---------- */
function niceStep(t){return t<10?1:t<30?2:t<100?5:t<250?10:25}
/** About 10 to 20 percent more, on a round number. */
function suggestTarget(t){
  const lo=Math.ceil(t*1.1*100)/100,hi=Math.floor(t*1.2*100)/100,step=niceStep(t),ideal=t*1.15;
  let best=null;
  for(let c=Math.ceil(lo/step)*step;c<=hi+1e-9;c+=step){c=round1(c);if(best===null||Math.abs(c-ideal)<Math.abs(best-ideal)-1e-9)best=c}
  if(best===null||best<=t)best=round1(Math.ceil((t+0.01)/step)*step);
  return best;
}
/** How many due days in a row the target was hit (today counts if it is met; a still-open today does not break the run). */
function metStreak(h,days,today){
  let c=0,k=today;
  for(let i=0;i<400;i++,k=addDays(k,-1)){
    const d=days[k];
    if(i===0){if(isMet(h,d)&&isDue(h,k,days))c++;continue}
    if(!isDue(h,k,days))continue;
    if(isMet(h,d))c++;else break;
  }
  return c;
}
/** snooze: {habitId: "YYYY-MM-DD" it is quiet until}. Returns at most one suggestion. */
function suggestionFor(settings,days,today,snooze){
  if(!settings.prefs||settings.prefs.suggestions===false)return null;
  for(const h of settings.habits){
    if(h.hidden||(h.type!=='count'&&h.type!=='duration')||!(h.target>0))continue;
    if(snooze&&snooze[h.id]&&snooze[h.id]>today)continue;
    const n=metStreak(h,days,today);
    if(n>=5){const next=suggestTarget(h.target);if(next>h.target)return{id:h.id,days:n,target:h.target,next}}
  }
  return null;
}

/* ---------- library and starter plans ---------- */
const L=(id,name,icon,type,unit,target,category,extra)=>Object.assign({id,name,icon,type,unit,target,category,section:({Movement:'movement',Strength:'workout',Health:'health',Food:'food',Mind:'mind'})[category]},extra||{});
const LIBRARY=[
  L('steps','Steps','footprints','steps','steps',8000,'Movement',{auto:true}),
  L('walk','Brisk walk','timer','duration','min',30,'Movement'),
  L('run','Run','person-standing','duration','min',20,'Movement'),
  L('cycling','Cycling','bike','duration','min',30,'Movement'),
  L('stretching','Stretching','stretch-horizontal','duration','min',10,'Movement'),
  L('standups','Stand-up breaks','armchair','count','times',6,'Movement'),
  L('pushups','Pushups','dumbbell','count','reps',30,'Strength'),
  L('pullups','Pull-ups','dumbbell','count','reps',5,'Strength'),
  L('squats','Squats','dumbbell','count','reps',30,'Strength'),
  L('plank','Plank','timer','duration','sec',60,'Strength'),
  L('lunges','Lunges','dumbbell','count','reps',20,'Strength'),
  L('situps','Sit-ups','dumbbell','count','reps',20,'Strength'),
  L('water','Water','droplets','count','litres',2.5,'Health',{step:0.5}),
  L('sleep','Sleep','moon','count','hours',7,'Health',{step:0.5}),
  L('vitamins','Took vitamins','pill','yesno','',1,'Health'),
  L('weight','Weight','scale','measure','kg',0,'Health',{measure:'weight',section:'body',schedule:{kind:'weekly',times:3}}),
  L('waist','Waist','ruler','measure','cm',0,'Health',{measure:'waist',section:'body',schedule:{kind:'everyN',weeks:2}}),
  L('nosugar','No sugar','candy-off','yesno','',1,'Food'),
  L('nosugardrinks','No sugary drinks','cup-soda','yesno','',1,'Food'),
  L('nofried','No fried food','ban','yesno','',1,'Food'),
  L('nomaida','No maida','cookie','yesno','',1,'Food'),
  L('nolate','No late eating','utensils','yesno','',1,'Food'),
  L('veggies','Eat vegetables','carrot','yesno','',1,'Food'),
  L('protein','Protein with every meal','beef','yesno','',1,'Food'),
  L('meditation','Meditation','flower-2','duration','min',10,'Mind'),
  L('reading','Reading','book-open','duration','min',20,'Mind'),
  L('nophone','No phone before bed','phone-off','yesno','',1,'Mind'),
  L('journal','Journaling','notebook-pen','yesno','',1,'Mind')
];
const LIB_CATEGORIES=['Movement','Strength','Health','Food','Mind'];
const SECTION_NAMES={mind:'Mind'};
const STARTER_PLANS=[
  {id:'desk',name:'Desk worker reset',blurb:'Steps, brisk walk, stand-up breaks, water, sleep, no late eating, no sugary drinks',icon:'armchair',items:['steps','walk','standups','water','sleep','nolate','nosugardrinks']},
  {id:'beginner',name:'Beginner fitness',blurb:'Steps, pushups, squats, plank, water, sleep',icon:'dumbbell',items:['steps','pushups','squats','plank','water','sleep']},
  {id:'weightloss',name:'Weight loss',blurb:'Steps, brisk walk, weight, waist, no fried food, no sugar, no maida, no late eating',icon:'scale',items:['steps','walk','weight','waist','nofried','nosugar','nomaida','nolate']},
  {id:'scratch',name:'Start from scratch',blurb:'An empty plan. Add what you want from the library.',icon:'sparkles',items:[]}
];
function libEntry(id){return LIBRARY.find(x=>x.id===id)||null}
function searchLibrary(q){
  q=(q||'').trim().toLowerCase();
  if(!q)return LIBRARY.slice();
  return LIBRARY.filter(x=>(x.name+' '+x.category+' '+x.type+' '+x.unit).toLowerCase().includes(q));
}
/** Is this library item already in the plan? Returns the habit or null. */
function libHabitIn(settings,lib){
  return settings.habits.find(h=>h.lib===lib.id||h.id===lib.id||(lib.measure&&h.type==='measure'&&h.measure===lib.measure))||null;
}
function ensureSection(settings,id,name){
  if(settings.sections.some(s=>s.id===id))return;
  const sec={id,name:name||SECTION_NAMES[id]||id};
  const b=settings.sections.findIndex(x=>x.id==='body');      // new sections go above "Body and notes", which stays last
  if(b>=0&&id!=='body')settings.sections.splice(b,0,sec);else settings.sections.push(sec);
}
/** A new habit from a library item (not yet added to the settings). */
function habitFromLibrary(settings,lib,over){
  const taken=new Set(settings.habits.map(h=>h.id));
  const h={id:uniqueId(lib.id,taken),name:lib.name,icon:lib.icon,type:lib.type,unit:lib.unit||(lib.type==='yesno'?'':'times'),target:lib.type==='yesno'?1:lib.type==='measure'?0:lib.target,section:lib.section,schedule:normalizeSchedule(lib.schedule),lib:lib.id};
  if(lib.step)h.step=lib.step;
  if(lib.measure)h.measure=lib.measure;
  return Object.assign(h,over||{});
}
/** Adds a library item to the plan (or shows it again if it is hidden). Returns the habit. */
function addFromLibrary(settings,lib,sectionId){
  const have=libHabitIn(settings,lib);
  if(have){if(have.hidden)delete have.hidden;return have}
  const h=habitFromLibrary(settings,lib,sectionId?{section:sectionId}:null);
  ensureSection(settings,h.section);
  settings.habits.push(h);
  return h;
}
/** The plan a starter picks: its library items, in order, with the default sections. */
function applyStarterPlan(settings,planId){
  const plan=STARTER_PLANS.find(p=>p.id===planId);
  if(!plan)return settings;
  settings.habits=[];
  settings.sections=DEFAULT_SECTIONS.map(s=>Object.assign({},s));
  plan.items.forEach(id=>{const lib=libEntry(id);if(lib)addFromLibrary(settings,lib)});
  // the measurements are always available (Weight and waist), even when the plan does not ask for them
  const hasM=m=>settings.habits.some(h=>h.type==='measure'&&h.measure===m);
  ['weight','waist'].forEach(m=>{if(!hasM(m)){const lib=libEntry(m),h=habitFromLibrary(settings,lib);h.hidden=true;settings.habits.push(h)}});
  return settings;
}

/* ---------- BMI and units ---------- */
const BMI_SCALES={
  standard:{name:'Standard (WHO)',cuts:[18.5,25,30]},
  asian:{name:'Asian (WHO Asia-Pacific)',cuts:[18.5,23,25]}
};
const BMI_CATS=['under','normal','over','obese'];
const BMI_CAT_NAME={under:'Underweight',normal:'Normal',over:'Overweight',obese:'Obese'};
function bmi(kg,cm){
  if(!num(kg)||!num(cm)||kg<=0||cm<=0)return null;
  const m=cm/100;return kg/(m*m);
}
const bmiRound=b=>Math.round(b*10)/10;
function bmiCategory(b,scale){
  if(b==null)return null;
  const c=(BMI_SCALES[scale]||BMI_SCALES.standard).cuts,r=bmiRound(b);
  return r<c[0]?'under':r<c[1]?'normal':r<c[2]?'over':'obese';
}
/** Weight range that is "Normal" on the chosen scale, for a height. */
function healthyRange(cm,scale){
  if(!num(cm)||cm<=0)return null;
  const c=(BMI_SCALES[scale]||BMI_SCALES.standard).cuts,m2=(cm/100)*(cm/100);
  return{minKg:c[0]*m2,maxKg:(c[1]-0.1)*m2};
}
/** {dir:'above'|'below'|'within', kg} */
function distanceToRange(kg,cm,scale){
  const r=healthyRange(cm,scale);
  if(!r||!num(kg))return null;
  if(kg>r.maxKg)return{dir:'above',kg:round1(kg-r.maxKg)};
  if(kg<r.minKg)return{dir:'below',kg:round1(r.minKg-kg)};
  return{dir:'within',kg:0};
}
/** Waist-to-height ratio and a neutral label. */
function whtr(waistCm,heightCm){
  if(!num(waistCm)||!num(heightCm)||waistCm<=0||heightCm<=0)return null;
  const r=waistCm/heightCm;
  return{ratio:Math.round(r*100)/100,level:r<0.5?'healthy':'elevated'};
}
const LB_PER_KG=2.2046226218;
const kgToLb=kg=>kg*LB_PER_KG,lbToKg=lb=>lb/LB_PER_KG;
const cmToIn=cm=>cm/2.54,inToCm=i=>i*2.54;
function cmToFtIn(cm){
  const total=cm/2.54;let ft=Math.floor(total/12),inch=round1(total-ft*12);
  if(inch>=12){ft+=1;inch=0}
  return{ft,inch};
}
const ftInToCm=(ft,inch)=>(Number(ft)*12+Number(inch||0))*2.54;

return{
  pad,ymd,parse,addDays,daysBetween,blankDay,dow,weekStart,daysLeftInWeek,round1,ID_RE,
  TYPES,WEEKDAYS,WEEK_ORDER,ICONS,DEFAULT_SECTIONS,LEGACY_DEFAULT,LIBRARY,LIB_CATEGORIES,STARTER_PLANS,BMI_SCALES,BMI_CATS,BMI_CAT_NAME,
  normalizeSchedule,scheduleLabel,normalizeHabit,migrateSettings,applyIdMap,defaultSettings,stepFor,uniqueId,
  hv,isMet,isLogged,isDue,isShown,weekProgress,countsForScore,dayParts,dayScore,dayMetrics,hasRecord,loggedKeys,invalidate,currentStreak,bestStreak,daysKept,streakStatus,streakLine,
  suggestTarget,metStreak,suggestionFor,libEntry,searchLibrary,libHabitIn,habitFromLibrary,addFromLibrary,applyStarterPlan,ensureSection,
  bmi,bmiRound,bmiCategory,healthyRange,distanceToRange,whtr,kgToLb,lbToKg,cmToIn,inToCm,cmToFtIn,ftInToCm
};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=Core;
