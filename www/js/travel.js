/* Travel record: how long you walked, ran, cycled and rode in a vehicle, and your vehicle trips.
   The native plugin ("Steps") records minutes per mode and trips from Activity Recognition (Google Play services) and, only when the
   user switches on "Record distance of vehicle trips", the distance of vehicle and bicycle trips. No coordinates ever reach this file.
   Data lives in the day record as an optional `travel` object next to steps_meta:
     {walk_min, run_min, bike_min, vehicle_min, trips:[{mode:'vehicle'|'bike', start, end, min, km?, avg_kmh?, vehicle?:'car'|'motorbike'|'other'}]}
   start/end are epoch milliseconds. Travel never changes the daily score or the streak. Android can tell a vehicle from a bicycle but not
   a car from a motorbike, so the vehicle of a trip is a label the user sets (default: meta in 'comeback_travel_prefs'). Device-local choices
   (the default vehicle) are saved with prefSet; the trips and totals ride in the day record, so they sync and back up with it. */

const TRAVEL_PREFS_KEY='comeback_travel_prefs';
const TRAVEL_VEHICLES=['car','motorbike','other'];
const TRAVEL_VEHICLE_NAME={car:'Car',motorbike:'Motorbike',other:'Other'};
const TRAVEL_MAX_TRIPS=50,TRAVEL_MAX_MIN=1440;
const travelState={defaultVehicle:'car',distanceOn:false,ar:null,locationPermission:null};

/* ---------- data: normalise (load, restore, sync) ---------- */
/** Pure. Anything in, a clean travel object (or null when there is nothing to keep) out. Never throws. */
function normalizeTravel(t){
  if(!t||typeof t!=='object'||Array.isArray(t))return null;
  const mins=v=>typeof v==='number'&&isFinite(v)&&v>0?Math.min(TRAVEL_MAX_MIN,Math.round(v)):0;
  const out={walk_min:mins(t.walk_min),run_min:mins(t.run_min),bike_min:mins(t.bike_min),vehicle_min:mins(t.vehicle_min),trips:[]};
  const seen=new Set();
  if(Array.isArray(t.trips)){
    for(const r of t.trips){
      if(out.trips.length>=TRAVEL_MAX_TRIPS)break;
      if(!r||typeof r!=='object'||Array.isArray(r))continue;
      if(r.mode!=='vehicle'&&r.mode!=='bike')continue;
      const s=r.start,e=r.end;
      if(typeof s!=='number'||typeof e!=='number'||!isFinite(s)||!isFinite(e)||s<=0||e<s||e>4.1e12||seen.has(s))continue;
      seen.add(s);
      const trip={mode:r.mode,start:Math.round(s),end:Math.round(e),min:typeof r.min==='number'&&isFinite(r.min)&&r.min>=0?Math.min(TRAVEL_MAX_MIN,Math.round(r.min)):Math.min(TRAVEL_MAX_MIN,Math.round((e-s)/60000))};
      if(typeof r.km==='number'&&isFinite(r.km)&&r.km>=0&&r.km<=3000)trip.km=Math.round(r.km*100)/100;
      if(typeof r.avg_kmh==='number'&&isFinite(r.avg_kmh)&&r.avg_kmh>=0&&r.avg_kmh<=400)trip.avg_kmh=Math.round(r.avg_kmh*10)/10;
      if(r.mode==='vehicle'&&TRAVEL_VEHICLES.includes(r.vehicle))trip.vehicle=r.vehicle;
      out.trips.push(trip);
    }
    out.trips.sort((a,b)=>a.start-b.start);
  }
  if(!out.walk_min&&!out.run_min&&!out.bike_min&&!out.vehicle_min&&!out.trips.length)return null;
  return out;
}

/** CSV columns for the spreadsheet export (see buildCsv in logic.js). */
const TRAVEL_CSV_HEAD=['Walk (min)','Run (min)','Bike (min)','Vehicle (min)','Vehicle (km)'];
function travelCsvCells(d){
  const t=d&&d.travel;
  if(!t)return['','','','',''];
  const km=(t.trips||[]).filter(x=>x.mode==='vehicle'&&x.km!=null).reduce((a,x)=>a+x.km,0);
  const has=(t.trips||[]).some(x=>x.mode==='vehicle'&&x.km!=null);
  return[t.walk_min||0,t.run_min||0,t.bike_min||0,t.vehicle_min||0,has?Math.round(km*100)/100:''];
}

/* ---------- data: merge what the phone recorded into a day ---------- */
/** Copies the phone's travel record for one day into dayRecord (a copy the caller will store). Keeps the vehicle labels the user set.
    Returns true when the day record changed. Nothing is touched when the phone has no travel data for that day. */
function applyNativeTravel(dayRecord,nativeDay){
  const nt=normalizeTravel(nativeDay&&nativeDay.travel);
  if(!nt)return false;
  const old=dayRecord.travel||null;
  if(old&&old.trips)nt.trips.forEach(t=>{
    if(t.mode!=='vehicle')return;
    const o=old.trips.find(x=>x.start===t.start);
    if(o&&TRAVEL_VEHICLES.includes(o.vehicle))t.vehicle=o.vehicle;
  });
  if(JSON.stringify(old)===JSON.stringify(nt))return false;
  dayRecord.travel=nt;
  return true;
}
const hasNativeTravel=info=>!!(info&&info.travel&&normalizeTravel(info.travel));

/** Applies res.days (as returned by Steps.getDays or the 'stepsChanged' event) to the day records. Returns true when something changed. */
function applyNativeTravelDays(res){
  if(!stepsAuto()||!res||!res.days)return false;
  const from=stepsEnabledDay()||'0000-00-00',changed=[];
  Object.keys(res.days).forEach(k=>{
    if(k<from||!validDateKey(k))return;
    const info=res.days[k]||{};
    if(!hasNativeTravel(info))return;
    const d=days[k];
    if(!d&&!(Number(info.steps)>0))return;   // a travel-only day does not become a logged day by itself
    const nd=d?clone(d):blankDayFor(k);
    if(applyNativeTravel(nd,info)){nd.updatedAt=Date.now();days[k]=nd;changed.push(k)}
  });
  if(changed.length&&typeof autoPersist==='function')autoPersist(changed);
  return changed.length>0;
}

/* ---------- numbers for a range ---------- */
const fmtDur=m=>{m=Math.max(0,Math.round(m));if(m<60)return m+' min';const hh=Math.floor(m/60),mm=m%60;return mm?hh+' h '+mm+' min':hh+' h'};
const fmtClock=ms=>new Date(ms).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',hour12:true}).replace(/[  ]/g,' ');
const fmtKmT=k=>(Math.round(k*10)/10).toLocaleString(undefined,{maximumFractionDigits:1})+' km';
const vehicleOf=t=>t.mode==='bike'?'bike':(TRAVEL_VEHICLES.includes(t.vehicle)?t.vehicle:travelState.defaultVehicle);
const vehicleLabel=t=>t.mode==='bike'?'Bike':TRAVEL_VEHICLE_NAME[vehicleOf(t)];

function travelTotals(keys){
  const r={walk:0,run:0,bike:0,vehicle:0,steps:0,trips:[],bikeKm:0,vehKm:0,perDay:[],withTravel:0};
  keys.forEach(k=>{
    const d=days[k],t=d&&d.travel;
    const p={k,walk:0,run:0,bike:0,vehicle:0};
    if(d&&d.vals&&d.vals.steps>0)r.steps+=d.vals.steps;
    if(t){
      p.walk=t.walk_min||0;p.run=t.run_min||0;p.bike=t.bike_min||0;p.vehicle=t.vehicle_min||0;
      r.walk+=p.walk;r.run+=p.run;r.bike+=p.bike;r.vehicle+=p.vehicle;
      (t.trips||[]).forEach(x=>{
        r.trips.push(Object.assign({k},x));
        if(x.km!=null){if(x.mode==='bike')r.bikeKm+=x.km;else r.vehKm+=x.km}
      });
      if(p.walk+p.run+p.bike+p.vehicle>0||(t.trips||[]).length)r.withTravel++;
    }
    r.perDay.push(p);
  });
  r.has=r.walk+r.run+r.bike+r.vehicle>0||r.trips.length>0;
  return r;
}

/* ---------- Progress card ---------- */
const TV_MODES=[['walk','Walk','footprints'],['run','Run','zap'],['bike','Bike','bike'],['vehicle','Vehicle','car']];
const rangeLabel=()=>period===7?'the last 7 days':period===30?'the last 30 days':'the last 3 months';

function travelCardKind(){
  if(!stepsAvailable())return'hidden';
  if(!stepsAuto())return'off';
  if(travelState.ar===false)return'noar';
  if(typeof stepHealthKey!=='undefined'&&stepHealthKey==='permission_missing')return'perm';
  return'data';
}

function travelNote(text,btn){
  const root=h('<div class="card tv-card"><p class="info tv-note"></p></div>');
  root.querySelector('p').textContent=text;
  if(btn){const b=h('<button class="btn small secondary tv-act"></button>');b.textContent=btn.label;b.addEventListener('click',btn.on);root.appendChild(b)}
  return root;
}

function renderTravelCard(){
  const box=document.getElementById('travelCard');
  if(!box)return;
  const kind=travelCardKind();
  box.replaceChildren();
  if(kind==='hidden'){box.hidden=true;return}
  box.hidden=false;
  const head=h('<h2 class="sec-head">Travel</h2>');box.appendChild(head);
  if(kind==='off'){box.appendChild(travelNote('Turn on step counting to see how much you walk, run, cycle and ride. It uses the same phone sensors, and everything stays on your phone.',{label:'Turn on step counting',on:()=>{if(typeof turnOnStepCounting==='function')turnOnStepCounting()}}));return}
  if(kind==='noar'){box.appendChild(travelNote("This phone can't tell walking from riding (it needs Google Play services), so there is no travel record. Your steps are still counted."));return}
  if(kind==='perm'){box.appendChild(travelNote('Travel needs the Physical activity permission, which is off right now.',{label:'Fix it',on:()=>{if(typeof turnOnStepCounting==='function')turnOnStepCounting()}}));return}
  const keys=rangeKeys(period),tot=travelTotals(keys);
  if(!tot.has){box.appendChild(travelNote('Nothing recorded for '+rangeLabel()+' yet. Your walks, runs, bike rides and trips in a vehicle appear here as your day goes on.'));return}

  const card=h('<div class="card tv-card"></div>');
  // minutes (and distance) per mode
  const grid=h('<div class="stats tv-stats"></div>');
  const sub={
    walk:tot.steps>0?'about '+fmtKmT(kmFor(tot.steps))+' from steps':'',
    run:'distance is in Walk',
    bike:tot.bikeKm>0?fmtKmT(tot.bikeKm):(travelState.distanceOn?'no distance yet':'minutes only'),
    vehicle:tot.trips.filter(x=>x.mode==='vehicle').length+' trips'+(tot.vehKm>0?' · '+fmtKmT(tot.vehKm):'')
  };
  TV_MODES.forEach(([id,name,ic])=>{
    const s=h('<div class="stat tv-stat"><span><i class="tv-dot tv-'+id+'"></i><svg data-ic="'+ic+'" class="sm"></svg><em></em></span><b></b><small></small></div>');
    s.id='tv-'+id;
    s.querySelector('em').textContent=name;
    s.querySelector('b').textContent=fmtDur(tot[id]);
    s.querySelector('small').textContent=sub[id];
    grid.appendChild(s);
  });
  card.appendChild(grid);

  // per-day stacked bars
  const max=Math.max(1,...tot.perDay.map(p=>p.walk+p.run+p.bike+p.vehicle));
  const bars=h('<div class="tv-bars" role="img"></div>');
  tot.perDay.forEach(p=>{
    const sum=p.walk+p.run+p.bike+p.vehicle;
    const col=h('<div class="tv-day" aria-hidden="true"></div>');
    if(!sum)col.classList.add('empty');
    TV_MODES.forEach(([id])=>{if(p[id]>0){const sg=h('<i class="tv-seg tv-'+id+'"></i>');sg.style.height=(p[id]/max*100)+'%';col.appendChild(sg)}});
    bars.appendChild(col);
  });
  const busiest=tot.perDay.reduce((a,p)=>(p.walk+p.run+p.bike+p.vehicle>a.m?{m:p.walk+p.run+p.bike+p.vehicle,k:p.k}:a),{m:0,k:null});
  const parts=TV_MODES.filter(([id])=>tot[id]>0).map(([id])=>({walk:'walking',run:'running',bike:'cycling',vehicle:'in a vehicle'}[id]+' '+fmtDur(tot[id])));
  const nTrips=tot.trips.length;
  const summary='Time on the move per day, '+rangeLabel()+': '+parts.join(', ')+'. '+nTrips+(nTrips===1?' trip':' trips')+'.'+(busiest.k?' Busiest day: '+nice(busiest.k)+', '+fmtDur(busiest.m)+'.':'');
  bars.setAttribute('aria-label',summary);
  card.appendChild(bars);
  const axis=h('<div class="tv-axis" aria-hidden="true"><span></span><span></span></div>');
  const dfmt=k=>parse(k).toLocaleDateString(undefined,{day:'numeric',month:'short'});
  axis.children[0].textContent=dfmt(keys[0]);axis.children[1].textContent=dfmt(keys[keys.length-1]);
  card.appendChild(axis);
  const sumP=h('<p class="t-foot muted tv-summary" id="travelSummary"></p>');sumP.textContent=summary;card.appendChild(sumP);

  const foot=[];
  if(!travelState.distanceOn)foot.push('Distance of vehicle trips is off. You can turn it on in Settings > Advanced.');
  foot.push('Distance on foot is worked out from your steps and height. Travel never changes your score or streak.');
  const fp=h('<p class="t-foot muted tv-foot"></p>');fp.textContent=foot.join(' ');card.appendChild(fp);

  if(nTrips){
    const b=h('<button class="btn small secondary tv-act" id="travelTripsBtn"></button>');
    b.textContent='See trips ('+nTrips+')';
    b.addEventListener('click',()=>openTripsSheet());
    card.appendChild(b);
  }
  box.appendChild(card);
  refreshTripsSheet();
}

/* ---------- trips sheet ---------- */
let tripsSheetRoot=null;
function tripsList(){
  const tot=travelTotals(rangeKeys(period));
  return tot.trips.sort((a,b)=>b.start-a.start);
}
function renderTripsInto(root){
  root.replaceChildren();
  const trips=tripsList();
  const intro=h('<p class="info tv-intro"></p>');
  intro.textContent="Android can tell a ride in a vehicle from a ride on a bicycle, but not a car from a motorbike. Tap a vehicle trip to say which it was. New trips use "+TRAVEL_VEHICLE_NAME[travelState.defaultVehicle]+'.';
  root.appendChild(intro);
  if(!trips.length){root.appendChild(h('<p class="info">No trips in this range.</p>'));return}
  let lastK=null,g=null;
  trips.forEach(t=>{
    if(t.k!==lastK){
      lastK=t.k;
      const hd=h('<div class="group-head tv-dayhead"><span></span></div>');hd.querySelector('span').textContent=nice(t.k);root.appendChild(hd);
      g=h('<div class="group tv-trips"></div>');root.appendChild(g);
    }
    const isV=t.mode==='vehicle';
    const row=h(isV?'<button class="row tv-trip"></button>':'<div class="row tv-trip"></div>');
    row.innerHTML='<span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span>'+(isV?'<svg data-ic="chevron-right" class="chev"></svg>':'');
    row.querySelector('.row-ic').innerHTML=icon(isV?'car':'bike');
    const range=fmtClock(t.start)+' – '+fmtClock(t.end);
    row.querySelector('.row-label').textContent=range;
    const bits=[vehicleLabel(t),fmtDur(t.min)];
    if(t.km!=null)bits.push(fmtKmT(t.km));
    if(t.avg_kmh!=null&&t.km!=null)bits.push('avg '+Math.round(t.avg_kmh)+' km/h');
    row.querySelector('.row-sub').textContent=bits.join(' · ');
    row.dataset.k=t.k;row.dataset.start=String(t.start);
    row.setAttribute('aria-label','Trip '+fmtClock(t.start)+' to '+fmtClock(t.end)+', '+bits.join(', ')+(isV?'. Change vehicle.':''));
    hydrate(row);
    if(isV)row.addEventListener('click',()=>chooseTripVehicle(t,root));
    g.appendChild(row);
  });
}
async function chooseTripVehicle(t,root){
  const cur=vehicleOf(t);
  const v=await actionSheet({title:'Which vehicle?',message:fmtClock(t.start)+' – '+fmtClock(t.end)+' · '+fmtDur(t.min),
    actions:TRAVEL_VEHICLES.map(x=>({label:TRAVEL_VEHICLE_NAME[x]+(x===cur?'  ✓':''),value:x}))});
  if(v==='cancel'||!TRAVEL_VEHICLES.includes(v))return;
  setTripVehicle(t.k,t.start,v);
  if(root&&root.isConnected)renderTripsInto(root);
}
/** Saves the vehicle label of one trip in its day record (and syncs it like any other edit). */
function setTripVehicle(k,start,vehicle){
  if(!TRAVEL_VEHICLES.includes(vehicle))return false;
  const d=days[k];
  if(!d||!d.travel||!d.travel.trips||!d.travel.trips.some(x=>x.start===start&&x.mode==='vehicle'))return false;
  commitDay('Trip updated',dd=>{const x=dd.travel.trips.find(y=>y.start===start&&y.mode==='vehicle');if(x)x.vehicle=vehicle},true,k);
  return true;
}
function openTripsSheet(){
  const root=h('<div class="tv-sheet"></div>');
  tripsSheetRoot=root;
  renderTripsInto(root);
  openSheet({title:'Trips · '+(period===7?'last 7 days':period===30?'last 30 days':'last 3 months'),left:null,right:'Done',content:root,onDone:()=>{tripsSheetRoot=null},onCancel:()=>{tripsSheetRoot=null}});
}
function refreshTripsSheet(){if(tripsSheetRoot&&tripsSheetRoot.isConnected)renderTripsInto(tripsSheetRoot)}

/* ---------- settings rows (mounted by Settings > Advanced) ---------- */
async function loadTravelPrefs(){
  try{
    const raw=await prefGet(TRAVEL_PREFS_KEY);
    const p=raw?JSON.parse(raw):null;
    if(p&&TRAVEL_VEHICLES.includes(p.defaultVehicle))travelState.defaultVehicle=p.defaultVehicle;
  }catch(e){}
}
async function saveTravelPrefs(){try{await prefSet(TRAVEL_PREFS_KEY,JSON.stringify({defaultVehicle:travelState.defaultVehicle}))}catch(e){}}
async function refreshTravelStatus(){
  const P=stepsPlugin();if(!P)return;
  try{
    const st=await P.getStatus();
    travelState.ar=st&&st.supported?st.supported.activityRecognition!==false:null;
    travelState.distanceOn=!!(st&&(st.travelDistance||(st.config&&st.config.travelDistance)));
    travelState.locationPermission=st?st.locationPermission:null;
  }catch(e){}
}
const travelMsg=(t,bad)=>{if(typeof setMsg==='function'&&document.getElementById('stMsg'))setMsg('stMsg',t,!!bad)};

async function setTravelDistanceOn(on,box){
  const P=stepsPlugin();if(!P)return;
  travelMsg('');
  try{
    if(on){
      const r=await P.requestLocationPermission();
      if(!r||!r.granted){if(box)box.checked=false;travelMsg('Location permission was not allowed, so trip distance stays off.',true);return}
    }
    const res=await P.setTravelDistance({enabled:on});
    travelState.distanceOn=!!(res&&res.enabled);
    if(box)box.checked=travelState.distanceOn;
    if(on&&!travelState.distanceOn)travelMsg("Trip distance couldn't be turned on. Check the Location permission for Comeback in Android settings.",true);
    else travelMsg(on?'Trip distance is on. Location is used only while you are in a vehicle or on a bike.':'Trip distance is off.');
    renderTravelCard();
  }catch(e){if(box)box.checked=!on;travelMsg("Couldn't change that: "+(typeof errText==='function'?errText(e):String(e)),true)}
}

/** Rows for Settings > Advanced: the opt-in distance switch and the default vehicle. Returns an array of row elements. */
function travelSettingsRows(){
  if(!stepsAvailable())return[];
  const sw=h('<label class="row" id="travelDistRow"><span class="row-ic"></span><span class="row-body"><span class="row-label">Record distance of vehicle trips</span><span class="row-sub">Off by default. Uses location only while a trip in a vehicle or on a bike is going on, and keeps just the total distance, never where you went.</span></span><input type="checkbox" class="switch" role="switch" id="travelDistOn" aria-label="Record distance of vehicle trips"></label>');
  sw.querySelector('.row-ic').innerHTML=icon('map-pin');
  const box=sw.querySelector('input');box.checked=!!travelState.distanceOn;
  box.addEventListener('change',()=>setTravelDistanceOn(box.checked,box));
  const veh=h('<button class="row" id="travelVehRow"><span class="row-ic"></span><span class="row-body"><span class="row-label">Default vehicle</span><span class="row-sub">Android cannot tell a car from a motorbike, so this is the label new vehicle trips get. You can change any trip in Progress.</span></span><span class="row-val"></span><svg data-ic="chevron-right" class="chev"></svg></button>');
  veh.querySelector('.row-ic').innerHTML=icon('car');
  veh.querySelector('.row-val').textContent=TRAVEL_VEHICLE_NAME[travelState.defaultVehicle];
  hydrate(veh);
  veh.addEventListener('click',async()=>{
    const v=await actionSheet({title:'Default vehicle',message:'Used for new vehicle trips. Change any trip afterwards from Progress > Travel.',actions:TRAVEL_VEHICLES.map(x=>({label:TRAVEL_VEHICLE_NAME[x]+(x===travelState.defaultVehicle?'  ✓':''),value:x}))});
    if(v==='cancel'||!TRAVEL_VEHICLES.includes(v))return;
    travelState.defaultVehicle=v;await saveTravelPrefs();
    veh.querySelector('.row-val').textContent=TRAVEL_VEHICLE_NAME[v];
    renderTravelCard();
  });
  return[sw,veh];
}

/* ---------- wiring (self-contained: no hooks needed in steps.js or ui.js) ---------- */
let travelLoop=null;
async function pullTravel(){
  const P=stepsPlugin();
  if(!P||!stepsAuto()||document.hidden)return;
  try{if(applyNativeTravelDays(await P.getDays()))renderTravelCard()}catch(e){}
}
function initTravel(){
  renderTravelCard();
  loadTravelPrefs().then(()=>{renderTravelCard();refreshTripsSheet()});
  const P=stepsPlugin();
  if(!P)return;
  refreshTravelStatus().then(renderTravelCard);
  try{const r=P.addListener('stepsChanged',ev=>{if(stepsAuto()&&!document.hidden&&applyNativeTravelDays(ev))renderTravelCard()});if(r&&r.catch)r.catch(()=>{})}catch(e){}
  // the Progress screen redraws itself (range switch, tab change, steps update) and always rewrites its subtitle: redraw the card with it
  const sub=document.getElementById('progressSub');
  if(sub&&window.MutationObserver)new MutationObserver(()=>renderTravelCard()).observe(sub,{childList:true,characterData:true,subtree:true});
  const loop=()=>{if(travelLoop)clearInterval(travelLoop);travelLoop=document.hidden?null:setInterval(pullTravel,60_000)};
  document.addEventListener('visibilitychange',()=>{loop();if(!document.hidden){refreshTravelStatus().then(renderTravelCard);pullTravel()}});
  loop();
  setTimeout(()=>{pullTravel();refreshTravelStatus().then(renderTravelCard)},1500);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initTravel);else initTravel();
