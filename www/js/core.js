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
const isVolumeUnit=u=>/^(litres?|liters?|l)$/i.test(u||'');
const isGlassUnit=u=>/^(glass(es)?|cups?)$/i.test(u||'');
/** The amount one + or − tap changes: the habit's own step, else its first quick-add amount, else one that suits the unit
    (a quarter litre of water, a glass, a rep). */
function stepFor(h){
  if(h.step&&h.step>0)return h.step;
  if(h.type==='duration')return/^sec/i.test(h.unit||'')?10:5;
  if(h.type==='count'){
    if(Array.isArray(h.presets)&&h.presets.length&&h.presets[0]>0)return h.presets[0];
    if(/^(reps|times|rep)$/i.test(h.unit||''))return 1;
    if(isVolumeUnit(h.unit))return 0.25;
    if(isGlassUnit(h.unit))return 1;
    return h.target<10?0.5:1;
  }
  return 1;
}
/** One-tap amounts for a habit: its own quick-add amounts first, else sensible ones for the unit. */
function presetsFor(h){
  if(Array.isArray(h.presets)&&h.presets.length)return h.presets.slice(0,4);
  const u=h.unit||'';
  if(u==='steps')return[500,1000];if(u==='reps')return[5,10];if(/^min/i.test(u))return[5,10];if(/^sec/i.test(u))return[10,30];
  if(isVolumeUnit(u))return[0.25,0.5];if(isGlassUnit(u))return[1,2];if(/^hours?$/i.test(u))return[0.5,1];
  const s=stepFor(h);return[s,s*2];
}
const numStr=n=>String(Math.round(n*100)/100);
/** Does this habit get text chips (quick-add amounts) on its card instead of one plain + button? */
const hasQuickAdd=h=>h.type==='count'&&(!!(h.presets&&h.presets.length)||isVolumeUnit(h.unit)||isGlassUnit(h.unit));
/** Label of a quick-add chip: "+0.25" on a card, "+1 glass (250 ml)" or "+0.25 L" when long. */
function presetLabel(h,a,long){
  if(!long)return'+'+numStr(a);
  if(/^glass(es)?$/i.test(h.unit||''))return'+'+numStr(a)+(a===1?' glass':' glasses')+' ('+Math.round(a*250)+' ml)';
  if(/^cups?$/i.test(h.unit||''))return'+'+numStr(a)+(a===1?' cup':' cups')+' ('+Math.round(a*240)+' ml)';
  if(isVolumeUnit(h.unit))return'+'+numStr(a)+' L';
  return'+'+numStr(a)+(h.unit?' '+h.unit:'');
}
function uniqueId(base,taken){
  let id=base,i=2;
  while(taken.has(id)){id=base+'-'+i;i++}
  taken.add(id);return id;
}

/* ---------- anchors, quick-add amounts and per-habit reminders (optional habit fields) ---------- */
/** "After lunch": at most 30 characters, one line. Shown as text only. */
function normalizeAnchor(a){
  if(typeof a!=='string')return null;
  const t=a.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,30).trim();
  return t||null;
}
/** Up to 4 positive amounts, smallest first, no repeats (a Count habit's one-tap chips). */
function normalizePresets(p){
  if(!Array.isArray(p))return null;
  const v=[...new Set(p.filter(n=>num(n)&&n>0&&n<=1e6).map(n=>Math.round(n*100)/100).filter(n=>n>0))].sort((a,b)=>a-b).slice(0,4);
  return v.length?v:null;
}
const HM_RE=/^([01]\d|2[0-3]):[0-5]\d$/;
const hmMinutes=t=>HM_RE.test(t||'')?Number(t.slice(0,2))*60+Number(t.slice(3)):null;
/** {times:["07:00",...],skipIfDone} with at most 3 valid 24-hour times, sorted and without repeats; null when there is none. */
function normalizeRemind(r){
  if(!r||typeof r!=='object'||!Array.isArray(r.times))return null;
  const times=[...new Set(r.times.filter(t=>typeof t==='string'&&HM_RE.test(t)))].sort().slice(0,3);
  return times.length?{times,skipIfDone:r.skipIfDone!==false}:null;
}
/** "07:00" -> "7:00 AM" (the app only shows a 12-hour clock). */
function fmt12(t){
  const m=hmMinutes(t);if(m==null)return'';
  const h=Math.floor(m/60),mm=m%60;
  return(h%12===0?12:h%12)+':'+pad(mm)+' '+(h>=12?'PM':'AM');
}
/** The reminder settings kept on the phone (Settings > Reminder). Missing parts get their defaults. */
function normalizeReminderMeta(r){
  const o=r&&typeof r==='object'?r:{},mo=o.morning&&typeof o.morning==='object'?o.morning:{};
  return{enabled:!!o.enabled,time:HM_RE.test(o.time)?o.time:'21:00',onlyIfOpen:o.onlyIfOpen!==false,
    morning:{enabled:!!mo.enabled,time:HM_RE.test(mo.time)?mo.time:'08:00'},morningOffered:o.morningOffered===true};
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
  const an=normalizeAnchor(h.anchor);if(an)out.anchor=an;
  if(type==='count'||type==='duration'){const pr=normalizePresets(h.presets);if(pr)out.presets=pr}
  if(type!=='steps'){const rm=normalizeRemind(h.remind);if(rm)out.remind=rm}
  return out;
}

function normalizeBody(b){
  const o=b&&typeof b==='object'?b:{};
  const out={heightCm:num(o.heightCm)&&o.heightCm>=50&&o.heightCm<=260?o.heightCm:null,scale:o.scale==='asian'?'asian':'standard'};
  // goal weight (kg) and an optional date: only present when set, so plans without a goal look exactly as before
  if(num(o.goalKg)&&o.goalKg>=30&&o.goalKg<=250){
    out.goalKg=Math.round(o.goalKg*100)/100;
    if(typeof o.goalDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(o.goalDate)&&ymd(parse(o.goalDate))===o.goalDate)out.goalDate=o.goalDate;
  }
  return out;
}
function normalizeUnits(u){
  const o=u&&typeof u==='object'?u:{};
  return{weight:o.weight==='lb'?'lb':'kg',length:o.length==='ftin'?'ftin':'cm'};
}
function normalizePrefs(p){
  const o=p&&typeof p==='object'?p:{};
  const out={suggestions:o.suggestions!==false};
  if(o.ramp===true||o.ramp===false)out.ramp=o.ramp;                  // the first-week ramp (set only by onboarding on a new install)
  if(typeof o.rampStart==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(o.rampStart))out.rampStart=o.rampStart;
  if(Number.isInteger(o.rampLimit)&&o.rampLimit>=3&&o.rampLimit<=60)out.rampLimit=o.rampLimit;
  return out;
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
/** A light day ("Take it easy today": illness, travel, a low day) is a day the person marked as one. It is left out of scoring like a rest day. */
function isLight(d){return!!d&&d.light===true}
/** 0-100, or null when nothing was due (a rest day) or the day was marked light. */
function dayScore(settings,days,k){return isLight(days[k])?null:scoreOfParts(dayParts(settings,days,k))}
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
    n++;sum+=(d.updatedAt||0)+(d.weight||0)*3+(d.waist||0)*7+(d.note?d.note.length*11:0)+(d.light===true?17:0);
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
/** The streak, one pass over the due days from the first logged day. A kept day adds one. A day that is not kept breaks the chain,
    unless it is the one free miss the streak shield allows: it must follow 6 due days in a row that were all kept, and it adds
    nothing to the count. The shield is ready again once 6 more due days in a row are kept (so two misses within 7 due days break
    the chain). Rest days (nothing due) and light days are skipped, and today, while it is still open, can only add to the count. */
const SHIELD_NEEDS=6;
function streakPass(settings,days,today){
  fresh(settings,days);
  const mk='pass:'+today;if(cache.memo.has(mk))return cache.memo.get(mk);
  const first=firstKey(days),out={current:0,best:0,shields:[],ready:false,lastDue:null,lastShield:false};
  if(first){
    let run=0,best=0,consec=0;
    for(let k=first;k<=today;k=addDays(k,1)){
      if(scoreAt(settings,days,k)===null)continue;
      if(kept(settings,days,k)){run++;consec++;if(run>best)best=run;out.lastShield=false;if(k!==today)out.lastDue=k}
      else if(k===today)continue;                       // today is still open: it can only add to the streak
      else if(consec>=SHIELD_NEEDS){out.shields.push(k);consec=0;out.lastDue=k;out.lastShield=true}
      else{run=0;consec=0;out.lastDue=k;out.lastShield=false}
    }
    out.current=run;out.best=best;out.ready=consec>=SHIELD_NEEDS;
  }
  cache.memo.set(mk,out);return out;
}
/** Days in a row with a score of 50 or more. Today counts once it is at 50; until then the count runs from yesterday, so the streak
    never drops during an open day. Rest days (nothing due) and light days are skipped; one miss in 7 due days is covered by the shield. */
function currentStreak(settings,days,today){return streakPass(settings,days,today).current}
function bestStreak(settings,days,today){return streakPass(settings,days,today).best}
/** The days the streak shield covered, oldest first. */
function shieldDays(settings,days,today){return streakPass(settings,days,today).shields.slice()}
/** Is the shield ready (the last 6 due days were kept, so one miss would be covered)? */
function shieldReady(settings,days,today){return streakPass(settings,days,today).ready}
/** "Rest day used. Streak safe at 12." when the last due day before today was covered by the shield and the streak is alive, else ''. */
function shieldNote(settings,days,today){
  const p=streakPass(settings,days,today);
  return p.lastShield&&p.current>0?'Rest day used. Streak safe at '+p.current+'.':'';
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
  if(isLight(days[today]))return s.current>0?s.current+'-day streak · light day':'Light day today';
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
  L('water','Water','droplets','count','litres',2.5,'Health',{presets:[0.25,0.5]}),
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
  if(lib.presets)h.presets=lib.presets.slice();
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
  // a new install that picks a real plan starts gently: 3 habits on Today for the first week (Settings > Suggestions turns it off)
  if(plan.items.length>RAMP_FIRST)settings.prefs=Object.assign({},settings.prefs,{ramp:true,rampStart:ymd(new Date())});
  return settings;
}

/* ---------- reminders ----------
   Notifications are scheduled ahead, so "only if something is left" is done by planning them one day at a time (a one-shot
   notification at an exact time) and planning again whenever anything changes (see logic.js rescheduleReminders). planReminders is
   pure: it says which notifications should exist right now. Only a short stretch ahead is planned (REM_LOOK days); each re-plan
   replaces the last. Ids: 1001+day evening, 1011+day morning cue, 2000+habit*40+time*12+slot per-habit (slot 0-2 one-shot days,
   3-9 a weekday, 10 every day). */
const REM_LOOK=3,REM_EVENING=1001,REM_MORNING=1011,REM_HABIT=2000,REM_TITLE='Comeback';
const REM_GENERIC='Time to log today. How did your comeback go?';
const lc1=s=>{s=String(s||'');return s.length>1&&s[1]===s[1].toUpperCase()&&s[1]!==s[1].toLowerCase()?s:s.charAt(0).toLowerCase()+s.slice(1)};
const isDurationUnitN=u=>/^(min|mins|minutes?|sec|secs|seconds?)$/i.test(u||'');
/** "10 min brisk walk", "30 pushups", "2.5 litres of water", "no sugar" */
function amountPhrase(h,n){
  const nm=lc1(h.name),u=h.unit||'';
  if(h.type==='yesno')return nm;
  const q=numStr(n);
  if(/^(reps|times|rep)$/i.test(u))return q+' '+nm;
  if(isDurationUnitN(u))return q+' '+(/^sec/i.test(u)?'sec':'min')+' '+nm;
  if(isVolumeUnit(u)||isGlassUnit(u)||/^(hours?|ml)$/i.test(u))return q+' '+u+' of '+nm;
  return q+' '+u+' '+nm;
}
/** What is left on day k: the open habits (Steps last, it counts itself), and whether the day is done, a rest day or a light day. */
function dayOpen(settings,days,k){
  const d=days[k],parts=dayParts(settings,days,k);
  const open=parts.filter(p=>!p.met).map(p=>p.h).sort((a,b)=>(a.type==='steps')-(b.type==='steps'));
  return{open,rest:parts.length===0,complete:parts.length>0&&open.length===0,light:!!(d&&d.light)};
}
/** "Water and Brisk walk are still open. A quick one counts." (two names at most) */
function eveningBody(open){
  const n=open.map(h=>h.name);
  const head=n.length===1?n[0]+' is':n.length===2?n[0]+' and '+n[1]+' are':n[0]+', '+n[1]+' and '+(n.length-2)+' more are';
  return head+' still open. A quick one counts.';
}
/** The open Count or Duration habit that is closest to done (then the smallest), else a Yes/No one: {h, text} or null. */
function easiestOpen(settings,days,k){
  const d=days[k],open=dayOpen(settings,days,k).open.filter(h=>h.type==='count'||h.type==='duration'||h.type==='yesno');
  const cd=open.filter(h=>h.type!=='yesno');
  if(!cd.length){const y=open[0];return y?{h:y,text:amountPhrase(y,1)}:null}
  const rem=h=>Math.max(0,h.target-Number(hv(h,d)||0)),inMin=h=>/^sec/i.test(h.unit||'')?rem(h)/60:rem(h);
  const frac=h=>rem(h)/h.target;
  const best=cd.slice().sort((a,b)=>frac(a)-frac(b)||inMin(a)-inMin(b))[0];
  return{h:best,text:amountPhrase(best,rem(best))};
}
/** The text of a habit's own reminder: "After lunch: 10 min brisk walk." or "Pushups: 30 reps." */
function habitReminderBody(h){
  const a=h.anchor;
  if(h.type==='measure')return a?a+': log your '+lc1(h.name)+'.':h.name+': a quick check-in.';
  if(h.type==='yesno')return a?a+': '+lc1(h.name)+'.':h.name+': one tap when it is done.';
  return a?a+': '+amountPhrase(h,h.target)+'.':h.name+': '+numStr(h.target)+' '+(h.unit||'')+'.';
}
const atTime=(k,hm)=>{const p=parse(k),m=hmMinutes(hm);p.setHours(Math.floor(m/60),m%60,0,0);return p};
/** Every notification that should be scheduled at "now": [{id,kind,title,body,at:Date|null,on:{hour,minute,weekday?}|null,habitId?}] */
function planReminders(settings,days,rem,now,opts){
  rem=normalizeReminderMeta(rem);
  const out=[],today=ymd(now),look=(opts&&opts.lookahead)||REM_LOOK;
  const state={};const st=k=>state[k]||(state[k]=dayOpen(settings,days,k));
  const future=t=>t.getTime()>now.getTime();
  const quiet0=s=>s.complete||s.light;   // today only: what is done (or a light day) needs no nudge
  if(rem.enabled){
    if(!rem.onlyIfOpen)out.push({id:REM_EVENING,kind:'evening',title:REM_TITLE,body:REM_GENERIC,at:null,on:{hour:Number(rem.time.slice(0,2)),minute:Number(rem.time.slice(3))}});
    else for(let off=0;off<look;off++){
      const k=addDays(today,off),t=atTime(k,rem.time);if(!future(t))continue;
      const s=st(k);if(s.rest||(off===0&&quiet0(s)))continue;
      out.push({id:REM_EVENING+off,kind:'evening',title:REM_TITLE,body:off===0&&s.open.length?eveningBody(s.open):REM_GENERIC,at:t,on:null});
    }
  }
  if(rem.morning.enabled)for(let off=0;off<look;off++){
    const k=addDays(today,off),t=atTime(k,rem.morning.time);if(!future(t))continue;
    const s=st(k);if(s.rest||(off===0&&quiet0(s)))continue;
    const e=easiestOpen(settings,days,k);if(!e)continue;
    out.push({id:REM_MORNING+off,kind:'morning',title:REM_TITLE,body:"Good morning. Today's easiest win: "+e.text+'.',at:t,on:null});
  }
  settings.habits.forEach((h,idx)=>{
    const rm=h.hidden||h.type==='steps'?null:normalizeRemind(h.remind);if(!rm)return;
    const sch=normalizeSchedule(h.schedule),body=habitReminderBody(h);
    rm.times.forEach((tm,ti)=>{
      const base=REM_HABIT+idx*40+ti*12,hour=Number(tm.slice(0,2)),minute=Number(tm.slice(3));
      const mk=(id,extra)=>Object.assign({id,kind:'habit',habitId:h.id,title:REM_TITLE,body,at:null,on:null},extra);
      if(!rm.skipIfDone&&sch.kind==='daily'){out.push(mk(base+10,{on:{hour,minute}}));return}
      if(!rm.skipIfDone&&sch.kind==='days'){sch.days.forEach(d=>out.push(mk(base+3+d,{on:{weekday:d+1,hour,minute}})));return}
      for(let off=0;off<look;off++){
        const k=addDays(today,off),t=atTime(k,tm);if(!future(t))continue;
        if(!isShown(h,k,days))continue;
        if(rm.skipIfDone&&off===0&&(isMet(h,days[k])||st(k).light))continue;
        out.push(mk(base+off,{at:t}));
      }
    });
  });
  return out;
}

/* ---------- the timer for Duration habits ---------- */
/** 'sec' or 'min' for a Duration habit the timer can add to, else null. */
const timerUnit=h=>h&&h.type==='duration'?(/^(sec|secs|seconds?)$/i.test(h.unit||'')?'sec':/^(min|mins|minutes?)$/i.test(h.unit||'')?'min':null):null;
const timerTargetMs=h=>{const u=timerUnit(h);return u==='sec'?h.target*1000:u==='min'?h.target*60000:0};
/** st: {startedAt, pausedMs, pausedAt}. Always computed from the clock, so it is right after the screen was off or the app was closed. */
function timerElapsed(st,now){
  if(!st||!num(st.startedAt))return 0;
  const end=num(st.pausedAt)?st.pausedAt:now;
  return Math.max(0,end-st.startedAt-(num(st.pausedMs)?st.pausedMs:0));
}
/** What stopping adds to the habit, in its own unit: whole seconds, or minutes to a tenth. {value, ms} (ms is what that value stands for). */
function timerCredit(h,ms){
  const u=timerUnit(h);if(!u||!(ms>0))return{value:0,ms:0};
  if(u==='sec'){const v=Math.round(ms/1000);return{value:v,ms:v*1000}}
  const v=round1(ms/60000);return{value:v,ms:Math.round(v*60000)};
}
/** 0:42, 12:05, 1:02:03 */
function fmtClock(ms){
  const t=Math.max(0,Math.floor(ms/1000)),hh=Math.floor(t/3600),mm=Math.floor(t%3600/60),ss=t%60;
  return hh?hh+':'+pad(mm)+':'+pad(ss):mm+':'+pad(ss);
}

/* ---------- the first-week ramp (new installs only) ----------
   settings.prefs.ramp is set only when a starter plan is picked in onboarding. For the first 7 days Today shows 3 habits (the first
   three of the plan that are due), then a "More when you're ready" row. Anything already logged stays visible. */
const RAMP_DAYS=7,RAMP_FIRST=3;
function rampDay(settings,days,today){
  const p=settings.prefs||{},start=p.rampStart||loggedKeys(days)[0]||today;
  return Math.max(1,daysBetween(start,today)+1);
}
const rampOn=(settings,days,today)=>!!(settings.prefs&&settings.prefs.ramp===true)&&rampDay(settings,days,today)<=RAMP_DAYS;
const rampLimit=settings=>(settings.prefs&&settings.prefs.rampLimit)||RAMP_FIRST;
function rampVisible(settings,days,today,habit){
  if(!rampOn(settings,days,today)||habit.type==='measure'||habit.hidden)return true;
  if(isLogged(habit,days[today]))return true;
  const order=settings.habits.filter(h=>!h.hidden&&h.type!=='measure'&&isShown(h,today,days));
  return order.slice(0,rampLimit(settings)).some(h=>h.id===habit.id)||!order.some(h=>h.id===habit.id);
}
/** How many habits the ramp is holding back today. */
function rampHiddenCount(settings,days,today){
  if(!rampOn(settings,days,today))return 0;
  return settings.habits.filter(h=>!h.hidden&&h.type!=='measure'&&isShown(h,today,days)&&!rampVisible(settings,days,today,h)).length;
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

/* ---------- gentler plans: easing and raising a habit, moving it off a day ---------- */
const TARGET_TYPES=['count','duration','steps'];
/** About 20 percent lower, on a round number (60 sec becomes 50). null when there is no sensible lower target. */
function easeTarget(t){
  if(!num(t)||t<=0)return null;
  if(t<=2&&Number.isInteger(t))return null;
  const step=niceStep(t),lo=t*0.7,hi=t*0.9,ideal=t*0.8;
  let best=null;
  for(let c=Math.ceil(lo/step-1e-9)*step;c<=hi+1e-9;c+=step){c=round1(c);if(c>0&&c<t&&(best===null||Math.abs(c-ideal)<Math.abs(best-ideal)-1e-9))best=c}
  if(best===null){const r=round1(ideal);best=r>0&&r<t?r:null}
  return best;
}
/** A lighter schedule: every day becomes 5 times a week, specific days lose their last day, X a week loses one, every N weeks gains a week. null when it cannot be lighter. */
function easeSchedule(sch){
  const s=normalizeSchedule(sch);
  if(s.kind==='daily')return{kind:'weekly',times:5};
  if(s.kind==='days'){if(s.days.length<3)return null;const ord=WEEK_ORDER.filter(d=>s.days.includes(d));return normalizeSchedule({kind:'days',days:ord.slice(0,-1)})}
  if(s.kind==='weekly')return s.times>1?{kind:'weekly',times:s.times-1}:null;
  return s.weeks<8?{kind:'everyN',weeks:s.weeks+1}:null;
}
/** How to ease a habit: its target when it has a number to hit, else its schedule. {kind:'target',from,to} | {kind:'schedule',schedule,label} | null. */
function easeFor(h){
  if(!h||h.type==='measure')return null;
  if(TARGET_TYPES.includes(h.type)){const to=easeTarget(h.target);if(to!=null)return{kind:'target',from:h.target,to}}
  const sc=easeSchedule(h.schedule);
  return sc?{kind:'schedule',schedule:sc,label:scheduleLabel(sc)}:null;
}
/** The raise the app can offer for a habit: Count and Duration only, the same step as the target suggestion. */
function raiseFor(h){
  if(!h||h.hidden||(h.type!=='count'&&h.type!=='duration')||!(h.target>0))return null;
  const to=suggestTarget(h.target);return to>h.target?{kind:'target',from:h.target,to}:null;
}
/** A schedule that leaves out one weekday (0 = Sunday): a daily habit becomes the other six days. null when it is not on that day or would have no day left. */
function moveOffDay(h,weekday){
  if(!h||h.type==='measure')return null;
  const s=normalizeSchedule(h.schedule);
  if(s.kind==='daily')return{kind:'days',days:[0,1,2,3,4,5,6].filter(d=>d!==weekday)};
  if(s.kind==='days'&&s.days.includes(weekday)&&s.days.length>1)return normalizeSchedule({kind:'days',days:s.days.filter(d=>d!==weekday)});
  return null;
}

/* ---------- the weekly review ---------- */
const ratio01=(n,d)=>d>0?n/d:0;
const fmt1=n=>String(Math.round(n*10)/10);
/** Kept and due days of one stretch of days (from the first logged day on). `open` is a day still in progress: it counts only once kept. */
function keptDue(settings,days,from,to,open){
  const first=firstKey(days);let got=0,due=0,scoreSum=0,scored=0,logged=0;
  if(!first)return{kept:0,due:0,avg:null,logged:0};
  for(let k=from<first?first:from;k<=to;k=addDays(k,1)){
    if(hasRecord(days[k]))logged++;
    const sc=scoreAt(settings,days,k);
    if(sc===null)continue;
    const ok=kept(settings,days,k);
    if(open&&k===open&&!ok)continue;
    due++;if(ok)got++;
    if(hasRecord(days[k])){scoreSum+=sc;scored++}
  }
  return{kept:got,due,avg:scored?Math.round(scoreSum/scored):null,logged};
}
/** How each habit did over a stretch: {h,met,due,ratio} for the habits that were due on at least `minDue` scored days. */
function habitWeek(settings,days,from,to,open,minDue){
  const first=firstKey(days),out=[];
  if(!first)return out;
  settings.habits.forEach(h=>{
    if(h.hidden||h.type==='measure')return;
    let met=0,due=0;
    for(let k=from<first?first:from;k<=to;k=addDays(k,1)){
      if(scoreAt(settings,days,k)===null)continue;
      if(open&&k===open&&!kept(settings,days,k))continue;
      if(!countsForScore(h,k,days))continue;
      due++;if(isMet(h,days[k]))met++;
    }
    if(due>=minDue)out.push({h,met,due,ratio:met/due});
  });
  return out;
}
/** weekStartKey is the Monday of the week. `through` (optional) ends the week early, for "this week so far".
    {daysKept, daysDue, prevDaysKept, prevDaysDue, bestHabit, slippedHabit, weightChange (kg), avgScore, loggedDays, suggestion:{kind,habitId?}} */
function weekSummary(settings,days,weekStartKey,through){
  fresh(settings,days);
  const wk=weekStartKey,end=addDays(wk,6),last=through&&through<end?through:end,open=through&&through<=end?through:null;
  const cur=keptDue(settings,days,wk,last,open);
  const prev=keptDue(settings,days,addDays(wk,-7),addDays(wk,-1),null);
  const minDue=Math.min(3,Math.max(1,cur.due));
  const hw=habitWeek(settings,days,wk,last,open,minDue);
  let best=null;
  hw.forEach(x=>{if(x.met>=1&&x.ratio>=0.6&&(!best||x.ratio>best.ratio+1e-9||(Math.abs(x.ratio-best.ratio)<1e-9&&(x.met>best.met||(x.met===best.met&&x.due>best.due)))))best=x});
  let slip=null;
  hw.forEach(x=>{if(x!==best&&x.ratio<0.7&&(!best||x.ratio<best.ratio-1e-9)&&(!slip||x.ratio<slip.ratio-1e-9||(Math.abs(x.ratio-slip.ratio)<1e-9&&x.met<slip.met)))slip=x});
  const pub=x=>x?{id:x.h.id,name:x.h.name,met:x.met,due:x.due}:null;
  // weight: the last weigh-in of the week against the one before the week (within 4 weeks), else against the first of the week
  const wks=Object.keys(days).filter(k=>days[k]&&num(days[k].weight)).sort();
  const inWk=wks.filter(k=>k>=wk&&k<=last),before=wks.filter(k=>k<wk&&daysBetween(k,wk)<=28).pop();
  let weightChange=null;
  if(inWk.length){
    const endW=days[inWk[inWk.length-1]].weight,startK=before||(inWk.length>1?inWk[0]:null);
    if(startK)weightChange=round1(endW-days[startK].weight);
  }
  // the suggestion
  let sug={kind:'keep'};
  const rate=ratio01(cur.kept,cur.due);
  if(cur.due>=3&&rate>=0.85&&settings.prefs&&settings.prefs.suggestions!==false){
    const cand=hw.filter(x=>x.ratio>=1-1e-9&&x.due>=3&&raiseFor(x.h)).sort((a,b)=>b.due-a.due)[0];
    if(cand)sug={kind:'raise',habitId:cand.h.id,to:raiseFor(cand.h).to};
  }else if(cur.due>=3&&rate<0.6&&slip&&easeFor(slip.h)){
    sug={kind:'lighten',habitId:slip.h.id};
  }
  return{weekStart:wk,weekEnd:end,daysKept:cur.kept,daysDue:cur.due,prevDaysKept:prev.kept,prevDaysDue:prev.due,bestHabit:pub(best),slippedHabit:pub(slip),weightChange,avgScore:cur.avg,loggedDays:cur.logged,suggestion:sug};
}
/** The review as words. opts: {label:'Last week', fmtKg:n=>text}. Returns {text, headline, details:[...], question}. */
function weekText(settings,sum,opts){
  opts=opts||{};
  const label=opts.label||'Last week',fmtKg=opts.fmtKg||(n=>fmt1(n)+' kg');
  const hab=id=>settings.habits.find(x=>x.id===id);
  let head=label+': '+sum.daysKept+' of '+sum.daysDue+(sum.daysDue===1?' day':' days')+' kept';
  if(sum.prevDaysDue>0&&opts.compare!==false)head+=sum.daysKept>sum.prevDaysKept?' (up from '+sum.prevDaysKept+')':sum.daysKept<sum.prevDaysKept?' ('+sum.prevDaysKept+' the week before)':' (same as the week before)';
  head+='.';
  const details=[];
  if(sum.bestHabit)details.push(sum.bestHabit.name+' was your steadiest habit.');
  if(sum.slippedHabit)details.push(sum.slippedHabit.name+' dipped.');
  if(sum.weightChange!=null){
    const c=sum.weightChange;
    details.push(Math.abs(c)<0.05?'Weight held steady.':'Weight went '+(c<0?'down ':'up ')+fmtKg(Math.abs(c))+'.');
  }
  let q='';
  const sg=sum.suggestion,x=sg&&sg.habitId?hab(sg.habitId):null;
  if(sg&&sg.kind==='raise'&&x&&sg.to)q='Keep the plan, or raise '+x.name.toLowerCase()+' to '+fmt1(sg.to)+' '+x.unit+'?';
  else if(sg&&sg.kind==='lighten'&&x){
    const e=easeFor(x);
    q=e?(e.kind==='target'?'Keep the plan, or ease '+x.name.toLowerCase()+' to '+fmt1(e.to)+' '+x.unit+'?':'Keep the plan, or ease '+x.name.toLowerCase()+' to '+e.label.toLowerCase()+'?'):'';
  }
  if(!q)q='Keeping the plan as it is sounds right.';
  return{headline:head,details,question:q,text:[head].concat(details,[q]).join(' ')};
}

/* ---------- insights ---------- */
const DAY_NAMES=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
/** The score of a day without one habit, 0-100 (null when nothing else was due). */
function scoreWithout(settings,days,k,skipId){
  const p=dayParts(settings,days,k).filter(x=>x.h.id!==skipId);
  return p.length?Math.round(mean(p.map(x=>x.frac))*100):null;
}
/** Up to 3 patterns in the person's own data, ranked, as {kind,text,rank,habitId?,weekday?}. Nothing until there are 21 logged days.
    The wording says "tends to": it describes, it never says why. */
function insightsDetailed(settings,days,today){
  fresh(settings,days);
  const logged=loggedKeys(days);
  if(logged.length<21)return[];
  const first=logged[0],from0=addDays(today,-83),from=first>from0?first:from0,to=addDays(today,-1);
  const list=[];   // scored days: {k,sc,dow}
  for(let k=from;k<=to;k=addDays(k,1)){const sc=scoreAt(settings,days,k);if(sc!==null)list.push({k,sc,dow:dow(k)})}
  if(list.length<14)return[];
  const out=[],overall=mean(list.map(x=>x.sc));
  // best day of the week
  const byDow=[0,1,2,3,4,5,6].map(d=>{const a=list.filter(x=>x.dow===d);return{d,n:a.length,avg:a.length?mean(a.map(x=>x.sc)):0}}).filter(x=>x.n>=3);
  if(byDow.length>=5){
    const srt=byDow.slice().sort((x,y)=>y.avg-x.avg),b=srt[0];
    if(b.avg-overall>=6&&b.avg-srt[1].avg>=3)out.push({kind:'bestday',rank:3,weekday:b.d,text:DAY_NAMES[b.d]+'s tend to be your strongest day (about '+Math.round(b.avg)+'% on average).'});
  }
  // weekdays and weekends
  const wd=list.filter(x=>x.dow>=1&&x.dow<=5),we=list.filter(x=>x.dow===0||x.dow===6);
  if(wd.length>=8&&we.length>=4){
    const a=Math.round(mean(wd.map(x=>x.sc))),b=Math.round(mean(we.map(x=>x.sc)));
    if(a-b>=10)out.push({kind:'weekend',rank:4,text:'Weekends tend to be lighter than weekdays (about '+b+'% against '+a+'%). That is common. A smaller weekend plan might feel better.'});
    else if(b-a>=10)out.push({kind:'weekend',rank:4,text:'Weekends tend to be your stronger days (about '+b+'% against '+a+'% on weekdays).'});
  }
  // a habit that is often missed on one weekday
  let skip=null;
  settings.habits.forEach(h=>{
    if(h.hidden||h.type==='measure')return;
    const rows=[];
    for(let k=from;k<=to;k=addDays(k,1)){
      if(scoreAt(settings,days,k)===null||!countsForScore(h,k,days))continue;
      rows.push({d:dow(k),miss:isMet(h,days[k])?0:1});
    }
    if(rows.length<14)return;
    const all=mean(rows.map(r=>r.miss));
    for(let d=0;d<7;d++){
      const a=rows.filter(r=>r.d===d);if(a.length<4)continue;
      const rate=mean(a.map(r=>r.miss)),lift=rate-all;
      if(rate>=0.6&&lift>=0.25&&moveOffDay(h,d)&&(!skip||lift>skip.lift))skip={h,d,lift,n:a.length,miss:a.reduce((x,r)=>x+r.miss,0)};
    }
  });
  if(skip)out.push({kind:'skip',rank:2,habitId:skip.h.id,weekday:skip.d,text:skip.h.name+' was missed on '+skip.miss+' of the last '+skip.n+' '+DAY_NAMES[skip.d]+'s. Want to move it to other days?'});
  // a weight plateau: three weeks, a handful of weigh-ins, hardly any movement
  const wk=Object.keys(days).filter(k=>k>=addDays(today,-21)&&k<=today&&days[k]&&num(days[k].weight)).sort();
  if(wk.length>=3&&daysBetween(wk[0],today)>=14&&daysBetween(wk[wk.length-1],today)<=7){
    const ws=wk.map(k=>days[k].weight);
    if(Math.max(...ws)-Math.min(...ws)<=0.7)out.push({kind:'plateau',rank:1,text:'Your weight has held steady for about 3 weeks. Plateaus are normal and often just a pause, so there is nothing you need to fix.'});
  }
  // "tends to" pairs (at least 8 days on each side)
  const pairs=[];
  const stepsH=settings.habits.find(x=>x.id==='steps'&&!x.hidden);
  if(stepsH)pairs.push({id:'steps',split:6000,has:k=>{const v=days[k]&&days[k].vals&&days[k].vals.steps;return num(v)&&v>0?v:null},say:'walk 6,000+ steps'});
  const sleepH=settings.habits.find(x=>!x.hidden&&(x.id==='sleep'||(/sleep/i.test(x.name)&&/^hours?$/i.test(x.unit||''))));
  if(sleepH)pairs.push({id:sleepH.id,split:7,has:k=>{const v=days[k]&&days[k].vals&&days[k].vals[sleepH.id];return num(v)&&v>0?v:null},say:'sleep 7+ hours'});
  let corr=null;
  pairs.forEach(p=>{
    const hi=[],lo=[];
    list.forEach(x=>{const v=p.has(x.k);if(v==null)return;const sc=scoreWithout(settings,days,x.k,p.id);if(sc==null)return;(v>=p.split?hi:lo).push(sc)});
    if(hi.length>=8&&lo.length>=8){
      const a=Math.round(mean(hi)),b=Math.round(mean(lo));
      if(a-b>=10&&(!corr||a-b>corr.gap))corr={gap:a-b,text:'On days you '+p.say+', your other habits tend to go better (about '+a+'% against '+b+'%). It is a pattern in your own days, not a rule.'};
    }
  });
  if(corr)out.push({kind:'pattern',rank:5,text:corr.text});
  return out.sort((a,b)=>a.rank-b.rank).slice(0,3);
}
function insights(settings,days,today){return insightsDetailed(settings,days,today).map(x=>x.text)}

/* ---------- goal weight ---------- */
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
/** "mid-December", "early March 2027" (the year only when it is not the current one). */
function approxDate(k,today){
  const d=parse(k),day=d.getDate(),part=day<=10?'early ':day<=20?'mid-':'late ';
  const y=today&&d.getFullYear()!==parse(today).getFullYear()?' '+d.getFullYear():'';
  return part+MONTHS[d.getMonth()]+y;
}
/** [{k,kg}] for every logged weight, oldest first, up to a day. */
function weightSeries(days,until){
  return Object.keys(days).filter(k=>(!until||k<=until)&&days[k]&&num(days[k].weight)).sort().map(k=>({k,kg:days[k].weight}));
}
const MAX_SAFE_PACE=1;     // kg a week: the most this app will ever suggest
function median(a){const s=a.slice().sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}
/** kg a week from the weigh-ins of the last 28 days (the median of every pairwise slope, so one odd weigh-in does not move it). null with fewer than 3 weigh-ins or under a week apart. */
function weightRate(series,today){
  const ws=series.filter(x=>x.k<=today&&daysBetween(x.k,today)<=27);
  if(ws.length<3||daysBetween(ws[0].k,ws[ws.length-1].k)<7)return null;
  const sl=[];
  for(let i=0;i<ws.length;i++)for(let j=i+1;j<ws.length;j++){const dd=daysBetween(ws[i].k,ws[j].k);if(dd>=1)sl.push((ws[j].kg-ws[i].kg)/dd)}
  return sl.length?median(sl)*7:null;
}
/** Where the person is against a goal weight.
    {state:'none'|'no-weight'|'reached'|'tracking', latest:{k,kg}, toGo (kg, always positive), direction:'lose'|'gain', rate (kg a week, negative = losing, null when unknown),
     towardRate (kg a week towards the goal, null when unknown), eta (a date, when the pace points at the goal), paceNeeded (kg a week to make the date),
     status:'ahead'|'on'|'behind'|'steady'|null, unsafe (the date needs more than 1 kg a week), suggestedDate (at 1 kg a week), datePassed}
    series is [{k,kg}], oldest first (see weightSeries). */
function goalStatus(goalKg,goalDate,series,today){
  if(!num(goalKg)||goalKg<=0)return{state:'none'};
  const ser=(series||[]).filter(x=>x.k<=today&&num(x.kg)).sort((a,b)=>a.k<b.k?-1:a.k>b.k?1:0);
  if(!ser.length)return{state:'no-weight',goalKg,goalDate:goalDate||null};
  const latest=ser[ser.length-1],diff=latest.kg-goalKg;
  const base=ser.filter(x=>daysBetween(x.k,today)<=180)[0]||ser[0];
  const startDir=base.kg>goalKg?'lose':base.kg<goalKg?'gain':null;
  const reached=Math.abs(diff)<=0.2||(startDir==='lose'&&diff<=0.2)||(startDir==='gain'&&diff>=-0.2);
  if(reached)return{state:'reached',goalKg,goalDate:goalDate||null,latest,toGo:0,direction:startDir||'lose'};
  const direction=diff>0?'lose':'gain';
  const rate=weightRate(ser,today),toward=rate==null?null:direction==='lose'?-rate:rate;
  const out={state:'tracking',goalKg,goalDate:goalDate||null,latest,toGo:Math.round(Math.abs(diff)*10)/10,direction,rate:rate==null?null:Math.round(rate*100)/100,towardRate:toward==null?null:Math.round(toward*100)/100,eta:null,paceNeeded:null,status:null,unsafe:false,suggestedDate:null,datePassed:false};
  if(toward!=null&&toward>=0.05){
    const dd=Math.ceil(Math.abs(diff)/(toward/7));
    if(dd<=730)out.eta=addDays(today,dd);
  }
  if(goalDate){
    const left=daysBetween(today,goalDate);
    if(left<=0)out.datePassed=true;
    else{
      out.paceNeeded=Math.round(Math.abs(diff)/(left/7)*100)/100;
      if(out.paceNeeded>MAX_SAFE_PACE){out.unsafe=true;out.suggestedDate=addDays(today,Math.ceil(Math.abs(diff)/MAX_SAFE_PACE*7))}
      if(toward!=null)out.status=toward<0.05?'steady':toward>=out.paceNeeded*1.1?'ahead':toward>=out.paceNeeded*0.8?'on':'behind';
    }
  }
  return out;
}
/** The goal in words. {line:'4.2 kg to go · about 0.4 kg a week lately · around mid-December', note:'...'}. fmtKg turns kg into the person's unit. */
function goalText(st,today,fmtKg){
  fmtKg=fmtKg||(n=>fmt1(n)+' kg');
  if(!st||st.state==='none')return{line:'',note:''};
  if(st.state==='no-weight')return{line:'Log your weight to see how far you are from '+fmtKg(st.goalKg)+'.',note:''};
  if(st.state==='reached')return{line:"You've reached your goal weight of "+fmtKg(st.goalKg)+'.',note:'Well done. Keeping it steady is a goal of its own.'};
  const parts=[fmtKg(st.toGo)+' to go'];
  if(st.towardRate!=null){
    if(st.towardRate>=0.05)parts.push('about '+fmtKg(st.towardRate)+' a week lately');
    else if(st.towardRate>-0.1)parts.push('steady lately');
    else parts.push('moving the other way lately (about '+fmtKg(-st.towardRate)+' a week)');
  }
  if(st.eta)parts.push('around '+approxDate(st.eta,today));
  let note='';
  const live=st.goalDate&&!st.datePassed;
  if(st.towardRate==null)note='Log a few more weigh-ins over the next weeks and your pace will show here.';
  else if(live&&st.status==='ahead')note='A little ahead of your date. Nicely done.';
  else if(live&&st.status==='on')note='Right on pace for '+approxDate(st.goalDate,today)+'.';
  else if(live&&st.status==='behind')note="A little behind your date, and that's normal. Weight moves in waves.";
  else if(live&&st.status==='steady')note="Progress has paused lately, and that's okay. Small steady habits add up.";
  else if(st.datePassed)note='Your date has passed. You can set a new one whenever you like.';
  if(st.unsafe)note=(note?note+' ':'')+'To reach '+approxDate(st.goalDate,today)+' you would need about '+fmtKg(st.paceNeeded)+' a week. A steady '+fmtKg(MAX_SAFE_PACE)+' a week is the most we would suggest, which gets you there around '+approxDate(st.suggestedDate,today)+'.';
  return{line:parts.join(' · '),note};
}

return{
  pad,ymd,parse,addDays,daysBetween,blankDay,dow,weekStart,daysLeftInWeek,round1,ID_RE,
  TYPES,WEEKDAYS,WEEK_ORDER,ICONS,DEFAULT_SECTIONS,LEGACY_DEFAULT,LIBRARY,LIB_CATEGORIES,STARTER_PLANS,BMI_SCALES,BMI_CATS,BMI_CAT_NAME,
  normalizeSchedule,scheduleLabel,normalizeHabit,migrateSettings,applyIdMap,defaultSettings,stepFor,uniqueId,
  hv,isMet,isLogged,isDue,isShown,weekProgress,countsForScore,dayParts,dayScore,dayMetrics,hasRecord,loggedKeys,invalidate,currentStreak,bestStreak,daysKept,streakStatus,streakLine,
  presetsFor,presetLabel,hasQuickAdd,normalizeAnchor,normalizePresets,normalizeRemind,normalizeReminderMeta,fmt12,hmMinutes,
  REM_LOOK,REM_EVENING,REM_MORNING,REM_HABIT,REM_GENERIC,amountPhrase,dayOpen,eveningBody,easiestOpen,habitReminderBody,planReminders,
  timerUnit,timerTargetMs,timerElapsed,timerCredit,fmtClock,RAMP_DAYS,RAMP_FIRST,rampDay,rampOn,rampLimit,rampVisible,rampHiddenCount,
  suggestTarget,metStreak,suggestionFor,libEntry,searchLibrary,libHabitIn,habitFromLibrary,addFromLibrary,applyStarterPlan,ensureSection,
  bmi,bmiRound,bmiCategory,healthyRange,distanceToRange,whtr,kgToLb,lbToKg,cmToIn,inToCm,cmToFtIn,ftInToCm,
  normalizeBody,isLight,shieldDays,shieldReady,shieldNote,easeTarget,easeSchedule,easeFor,raiseFor,moveOffDay,weekSummary,weekText,insights,insightsDetailed,
  approxDate,weightSeries,weightRate,goalStatus,goalText,MAX_SAFE_PACE
};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=Core;
