/* Units, BMI and the body card. BMI is always calculated from the latest logged weight and the height in Settings; it is never stored.
   Everything is kept in kg and cm; kg or lb and cm or ft/in are only how it is shown and typed. */

const unitsOf=()=>settings.units||{weight:'kg',length:'cm'};
const wUnit=()=>unitsOf().weight;
const lUnit=()=>unitsOf().length==='ftin'?'in':'cm';           // waist: cm, or inches when heights are shown in ft/in
const toDispWeight=kg=>wUnit()==='lb'?Core.kgToLb(kg):kg;
const fromDispWeight=v=>{const kg=wUnit()==='lb'?Core.lbToKg(v):v;return Math.round(kg*100)/100};
const toDispWaist=cm=>lUnit()==='in'?Core.cmToIn(cm):cm;
const fromDispWaist=v=>Math.round((lUnit()==='in'?Core.inToCm(v):v)*100)/100;
const fmtWeight=kg=>fmt(r1(toDispWeight(kg)))+' '+wUnit();
const fmtWaist=cm=>fmt(r1(toDispWaist(cm)))+' '+lUnit();
function fmtHeight(cm){
  if(cm==null)return 'Not set';
  if(unitsOf().length==='ftin'){const f=Core.cmToFtIn(cm);return f.ft+' ft '+fmt(f.inch)+' in'}
  return fmt(r1(cm))+' cm';
}
const heightCm=()=>settings.body.heightCm;
const bmiScale=()=>settings.body.scale==='asian'?'asian':'standard';
const scaleName=()=>Core.BMI_SCALES[bmiScale()].name;
/** The height the step distance estimate uses: the Settings height, or the one from this phone's step setup. */
const stepHeightCm=()=>settings.body.heightCm||meta.steps.heightCm||180;

/** Latest logged weight (or waist) on or before a day: {v, k} or null. */
function latestBody(key,until){
  let best=null;
  Object.keys(days).forEach(k=>{if(k<=until&&days[k][key]!=null&&(best===null||k>best))best=k});
  return best?{v:days[best][key],k:best}:null;
}
/** What the BMI card needs: {state:'ok'|'no-weight'|'no-height', bmi, rounded, cat, kg, cm, k}. */
function bodyState(until){
  until=until||todayStr();
  const w=latestBody('weight',until),cm=heightCm();
  if(cm==null)return{state:'no-height',w};
  if(!w)return{state:'no-weight',cm};
  const b=Core.bmi(w.v,cm);
  if(b==null)return{state:'no-weight',cm};
  return{state:'ok',bmi:b,rounded:Core.bmiRound(b),cat:Core.bmiCategory(b,bmiScale()),kg:w.v,cm,k:w.k};
}
const catPill=cat=>({under:'bmi-under',normal:'bmi-normal',over:'bmi-over',obese:'bmi-obese'})[cat]||'';
const catName=cat=>Core.BMI_CAT_NAME[cat]||'';
/** BMI per logged weight day, oldest first, for the small trend line and the chart. */
function bmiSeries(keys){
  const cm=heightCm();
  if(cm==null)return[];
  return keys.map(k=>{const d=days[k];return d&&d.weight!=null?{k,bmi:Core.bmi(d.weight,cm)}:null}).filter(Boolean);
}
function sparkSvg(vals,w,hh){
  if(vals.length<2)return '';
  const mn=Math.min(...vals),mx=Math.max(...vals),span=mx-mn||1,pad=3;
  const pts=vals.map((v,i)=>[pad+i*(w-2*pad)/(vals.length-1),hh-pad-(v-mn)/span*(hh-2*pad)]);
  return '<svg class="spark" viewBox="0 0 '+w+' '+hh+'" width="'+w+'" height="'+hh+'" aria-hidden="true"><polyline points="'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')+'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="'+pts[pts.length-1][0].toFixed(1)+'" cy="'+pts[pts.length-1][1].toFixed(1)+'" r="3" fill="currentColor"/></svg>';
}

/* ---------- the BMI card (Progress), and the BMI line in Today's Body section ---------- */
function renderBmiCard(){
  renderGoalLine();
  const el=$('bmiCard');if(!el)return;
  const st=bodyState(todayStr());
  el.innerHTML='';el.classList.remove('empty-bmi');
  if(st.state!=='ok'){
    el.classList.add('empty-bmi');
    const noH=st.state==='no-height';
    const c=h('<div class="bmi-empty"><svg data-ic="'+(noH?'ruler':'scale')+'"></svg><b class="t-head"></b><p></p><button class="btn small" id="bmiAction"></button></div>');
    c.querySelector('b').textContent='BMI';
    c.querySelector('p').textContent=noH?'Set your height to see your BMI.':'Log your weight to see your BMI.';
    const b=c.querySelector('button');b.textContent=noH?'Set height':'Log weight';
    b.addEventListener('click',()=>noH?heightSheet():bodySheet('weight',todayStr()));
    el.appendChild(c);return;
  }
  const keys=rangeKeys(90),ser=bmiSeries(keys).slice(-14);
  const btn=h('<button class="bmi-main" id="bmiOpen"><span class="bmi-left"><span class="bmi-lab">BMI</span><b class="bmi-val num"></b><span class="pill"></span><span class="bmi-sub"></span></span><span class="bmi-right"></span></button>');
  btn.querySelector('.bmi-val').textContent=st.rounded.toFixed(1);
  const pl=btn.querySelector('.pill');pl.textContent=catName(st.cat);pl.classList.add(catPill(st.cat));
  btn.querySelector('.bmi-sub').textContent=fmtWeight(st.kg)+' · '+fmtHeight(st.cm)+' · '+scaleName();
  btn.querySelector('.bmi-right').innerHTML=sparkSvg(ser.map(x=>x.bmi),112,44);
  btn.setAttribute('aria-label','BMI '+st.rounded.toFixed(1)+', '+catName(st.cat)+'. '+scaleName()+' scale. Tap for details.');
  btn.addEventListener('click',()=>bmiSheet());
  el.appendChild(btn);
}

/* ---------- height ---------- */
async function setHeightCm(cm){
  settings.body.heightCm=cm;
  meta.steps.heightCm=Math.round(cm);              // this phone's step plugin keeps its own copy
  try{await saveStepMeta()}catch(e){}
  if(stepsAuto())try{await configureSteps()}catch(e){}
  await saveSettingsQuiet();
  refreshAll();
}
/** Asks for a height in the unit chosen in Settings. Resolves with cm, or null if cancelled. */
function askHeightCm(title){
  return new Promise(res=>{
    let fin=false;const done=v=>{if(!fin){fin=true;res(v)}};
    const ft=unitsOf().length==='ftin';
    const cur=heightCm();
    if(!ft){
      numberSheet({title:title||'Your height',value:cur!=null?r1(cur):'',unitLine:'cm',step:1,min:0,
        validate:v=>v==null||v<100||v>230?'Enter a height between 100 and 230 cm':'',onDone:v=>done(v),onCancel:()=>done(null)});
      return;
    }
    const f=cur!=null?Core.cmToFtIn(cur):{ft:5,inch:9};
    const root=h('<div><div class="field"><label for="hFt">Feet</label><div class="box"><input id="hFt" type="number" inputmode="numeric" data-focus></div></div><div class="field"><label for="hIn">Inches</label><div class="box"><input id="hIn" type="number" inputmode="decimal"></div></div><div class="err" id="hErr" role="alert"></div></div>');
    root.querySelector('#hFt').value=f.ft;root.querySelector('#hIn').value=fmt(f.inch);
    openSheet({title:title||'Your height',content:root,onCancel:()=>done(null),onDone:()=>{
      const cm=Core.ftInToCm(root.querySelector('#hFt').value||0,root.querySelector('#hIn').value||0);
      if(!(cm>=100&&cm<=230)){root.querySelector('#hErr').textContent='Enter a height between 3 ft 4 in and 7 ft 7 in';return false}
      done(Math.round(cm*10)/10);
    }});
  });
}
async function heightSheet(){
  const cm=await askHeightCm('Your height');
  if(cm==null)return;
  await setHeightCm(cm);toast('Height saved',{icon:'ruler'});
}

/* One line to pick the BMI scale (Standard or Asian), for the first time someone opens BMI. Settings > Body keeps the same choice. */
function scaleChooser(){
  const wrap=h('<div class="scale-choice" id="bmiScaleChoice"><div class="group"></div><p class="t-foot muted scale-help"></p></div>');
  const help=wrap.querySelector('.scale-help'),grp=wrap.querySelector('.group');
  const helpText=()=>bmiScale()==='asian'?'Asian (WHO Asia-Pacific): healthy range 18.5 to 22.9. Often used for South, East and Southeast Asian backgrounds.':'Standard (WHO): healthy range 18.5 to 24.9. Choose Asian if your background is South, East or Southeast Asian.';
  const o={icon:'activity',label:'BMI scale',value:bmiScale(),options:[{value:'standard',label:'Standard',id:'sheetScStd'},{value:'asian',label:'Asian',id:'sheetScAsia'}],
    onPick:async v=>{
      o.value=v;grp.querySelectorAll('[role=radio]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.v===v)));
      settings.body=Object.assign({},settings.body,{scale:v});help.textContent=helpText();
      await saveSettingsQuiet();refreshAll();
    }};
  grp.appendChild(segRow(o));help.textContent=helpText();
  return wrap;
}

/* ---------- the BMI detail sheet ---------- */
let bmiChart=null,bmiPeriod=30;
function scaleBarHtml(){
  const c=Core.BMI_SCALES[bmiScale()].cuts,lo=15,hi=40,span=hi-lo;
  const segs=[[lo,c[0],'under'],[c[0],c[1],'normal'],[c[1],c[2],'over'],[c[2],hi,'obese']];
  return '<div class="scalebar" id="scaleBar">'+segs.map(s=>'<i class="sb sb-'+s[2]+'" style="width:'+((s[1]-s[0])/span*100).toFixed(2)+'%"></i>').join('')+'<span class="marker" id="scaleMark" hidden></span></div>'+
    '<div class="scalelab">'+segs.slice(1).map(s=>'<span style="left:'+((s[0]-lo)/span*100).toFixed(2)+'%">'+s[0]+'</span>').join('')+'</div>';
}
function bmiLegendText(){
  const c=Core.BMI_SCALES[bmiScale()].cuts,f=n=>(n-0.1).toFixed(1);
  return ['Underweight under '+c[0],'Normal '+c[0]+'–'+f(c[1]),'Overweight '+c[1]+'–'+f(c[2]),'Obese '+c[2]+' and over'];
}
function bmiSheet(){
  const st=bodyState(todayStr());
  const root=h('<div class="bmi-sheet"></div>');
  if(st.state==='ok'){
    const top=h('<div class="numdisp"><span class="nv num" id="bmiBig"></span><span class="nu" id="bmiCat"></span></div>');
    top.querySelector('#bmiBig').textContent=st.rounded.toFixed(1);
    const nu=top.querySelector('#bmiCat');nu.innerHTML='<span class="pill '+catPill(st.cat)+'"></span> <span class="muted"></span>';
    nu.querySelector('.pill').textContent=catName(st.cat);nu.querySelector('.muted').textContent=scaleName()+' scale';
    root.appendChild(top);
    const sb=h('<div class="card" style="margin-bottom:var(--s3)"><div role="img" id="scaleWrap">'+scaleBarHtml()+'</div><ul class="legend-list" id="bmiLegend"></ul></div>');
    bmiLegendText().forEach((t,i)=>{const li=document.createElement('li');li.innerHTML='<i class="sw sb-'+Core.BMI_CATS[i]+'"></i><span></span>';li.querySelector('span').textContent=t;sb.querySelector('#bmiLegend').appendChild(li)});
    root.appendChild(sb);
    const c=Core.BMI_SCALES[bmiScale()].cuts,pos=(clamp(st.rounded,15,40)-15)/25*100;
    const mk=sb.querySelector('#scaleMark');mk.hidden=false;mk.style.left=pos+'%';
    sb.querySelector('#scaleWrap').setAttribute('aria-label','BMI '+st.rounded.toFixed(1)+', '+catName(st.cat)+'. '+bmiLegendText().join('; ')+'.');
    // healthy range and the distance to it
    const hr=Core.healthyRange(st.cm,bmiScale()),dist=Core.distanceToRange(st.kg,st.cm,bmiScale());
    const g=h('<div class="group" style="margin-bottom:var(--s3)" id="bmiRows"></div>');
    const row=(label,val,sub,id)=>{const r=h('<div class="row"><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="row-val"></span></div>');r.querySelector('.row-label').textContent=label;const sbb=r.querySelector('.row-sub');if(sub)sbb.textContent=sub;else sbb.remove();r.querySelector('.row-val').textContent=val;if(id)r.id=id;g.appendChild(r)};
    row('Healthy range for '+fmtHeight(st.cm),fmt(Math.round(toDispWeight(hr.minKg)))+'–'+fmt(Math.round(toDispWeight(hr.maxKg)))+' '+wUnit(),scaleName()+': BMI '+c[0]+' to '+(c[1]-0.1).toFixed(1),'bmiRange');
    row('Distance',dist.dir==='within'?'In the healthy range':fmt(r1(toDispWeight(dist.kg)))+' '+wUnit()+' to the healthy range',dist.dir==='within'?null:null,'bmiDist');
    row('Latest weight',fmtWeight(st.kg),nice(st.k),'bmiWeight');
    const gs=goalSummary();
    if(gs){const gb=heightCm()!=null?Core.bmi(settings.body.goalKg,heightCm()):null;row('Goal weight',fmtWeight(settings.body.goalKg),[gs.text.line,gs.text.note,gb!=null?'BMI at your goal: '+Core.bmiRound(gb).toFixed(1)+'.':''].filter(Boolean).join(' '),'bmiGoal')}
    const wl=latestBody('waist',todayStr()),wr=wl?Core.whtr(wl.v,st.cm):null;
    if(wr)row('Waist-to-height ratio',wr.ratio.toFixed(2)+' · '+(wr.level==='healthy'?'Healthy':'Elevated'),'Under 0.5 is healthy, 0.5 and above is elevated. Waist '+fmtWaist(wl.v)+' on '+nice(wl.k),'bmiWhtr');
    root.appendChild(g);
  }else{
    const noH=st.state==='no-height';
    const e=h('<div class="empty card" style="margin-bottom:var(--s3)"><svg data-ic="'+(noH?'ruler':'scale')+'"></svg><b class="t-head"></b><p></p><button class="btn small"></button></div>');
    e.querySelector('b').textContent=noH?'Set your height':'Log your weight';
    e.querySelector('p').textContent=noH?'BMI needs your height. It is also used to estimate the distance you walk.':'Log your weight to see your BMI.';
    const b=e.querySelector('button');b.textContent=noH?'Set height':'Log weight';
    b.addEventListener('click',()=>{sh.close('cancel');noH?heightSheet():bodySheet('weight',todayStr())});
    root.appendChild(e);
    root.appendChild(scaleChooser());    // first time here: the height and the scale are asked inline, not in the intro
  }
  // trend
  if(st.state==='ok'){
    const tr=h('<div class="card" style="margin-bottom:var(--s3)"><div class="seg" id="bmiSeg" role="radiogroup" aria-label="Time range"><button role="radio" aria-checked="false" data-range="7">Week</button><button role="radio" aria-checked="false" data-range="30">Month</button><button role="radio" aria-checked="false" data-range="90">3 Months</button></div><div class="readout" id="bmiReadout"></div><div class="chartbox" style="height:11rem"><canvas id="chartBmi" aria-hidden="true"></canvas></div><p class="t-foot muted" id="bmiTrendSum" role="status" aria-live="polite" style="margin:12px 0 0"></p></div>');
    root.appendChild(tr);
  }
  // quick calculator
  const calc=h('<div class="card" style="margin-bottom:var(--s3)" id="quickCalc"><b class="t-head">Quick calculator</b><p class="t-foot muted" style="margin:4px 0 12px">Try any height and weight. This does not save or change your data.</p><div class="calc-fields"></div><div class="calc-out" id="calcOut" aria-live="polite"></div></div>');
  const ft=unitsOf().length==='ftin';
  const fields=calc.querySelector('.calc-fields');
  fields.innerHTML=(ft?'<div class="field"><label for="qFt">Height (ft)</label><div class="box"><input id="qFt" type="number" inputmode="numeric"></div></div><div class="field"><label for="qIn">Height (in)</label><div class="box"><input id="qIn" type="number" inputmode="decimal"></div></div>':'<div class="field"><label for="qCm">Height (cm)</label><div class="box"><input id="qCm" type="number" inputmode="decimal"></div></div>')+
    '<div class="field"><label for="qW">Weight ('+wUnit()+')</label><div class="box"><input id="qW" type="number" inputmode="decimal"></div></div>';
  root.appendChild(calc);
  const note=h('<p class="t-foot muted bmi-note" id="bmiNote"></p>');
  note.textContent="BMI is a general screening measure and doesn't account for muscle mass. It isn't a medical diagnosis.";
  root.appendChild(note);
  const kill=()=>{if(bmiChart){bmiChart.destroy();bmiChart=null}};
  const sh=openSheet({title:'BMI',left:null,right:'Done',content:root,onDone:kill,onCancel:kill});
  const upd=()=>{
    const out=root.querySelector('#calcOut');
    const cm=ft?Core.ftInToCm(root.querySelector('#qFt').value||0,root.querySelector('#qIn').value||0):Number(root.querySelector('#qCm').value);
    const kg=fromDispWeight(Number(root.querySelector('#qW').value));
    const b=Core.bmi(kg,cm);
    if(b==null||!(cm>=50&&cm<=260)){out.textContent='Enter a height and a weight.';out.className='calc-out muted';return}
    const cat=Core.bmiCategory(b,bmiScale());
    out.className='calc-out';out.innerHTML='<b class="num"></b> <span class="pill '+catPill(cat)+'"></span> <span class="muted"></span>';
    out.querySelector('b').textContent='BMI '+Core.bmiRound(b).toFixed(1);out.querySelector('.pill').textContent=catName(cat);out.querySelector('.muted').textContent=scaleName();
  };
  root.querySelectorAll('#quickCalc input').forEach(i=>i.addEventListener('input',upd));upd();
  if(st.state==='ok'){
    root.querySelectorAll('#bmiSeg button').forEach(b=>b.addEventListener('click',()=>{bmiPeriod=Number(b.dataset.range);haptic('light');drawBmiChart(root)}));
    drawBmiChart(root);
  }
  return sh;
}
let bmiRoot=null;
/** Redraws the BMI trend with fresh colours (the system theme changed) if its sheet is open. */
function redrawBmiChart(){if(bmiChart&&bmiRoot&&bmiRoot.isConnected)drawBmiChart(bmiRoot)}
function drawBmiChart(root){
  bmiRoot=root;
  const seg=root.querySelectorAll('#bmiSeg button');seg.forEach(b=>b.setAttribute('aria-checked',String(Number(b.dataset.range)===bmiPeriod)));
  const keys=rangeKeys(bmiPeriod),ser=bmiSeries(keys);
  const sum=root.querySelector('#bmiTrendSum'),ro=root.querySelector('#bmiReadout');
  const setRead=i=>{ro.innerHTML='';if(i==null||!ser.length){ro.innerHTML='<b>–</b><span>No weights in this '+RANGE_NAME[bmiPeriod]+'</span>';return}const b=document.createElement('b'),sp=document.createElement('span');b.textContent='BMI '+Core.bmiRound(ser[i].bmi).toFixed(1);sp.textContent=nice(ser[i].k)+' · '+catName(Core.bmiCategory(ser[i].bmi,bmiScale()));ro.appendChild(b);ro.appendChild(sp)};
  setRead(ser.length?ser.length-1:null);
  const summ=!ser.length?'No weights logged in the last '+RANGE_NAME[bmiPeriod]+'.':'BMI over the last '+RANGE_NAME[bmiPeriod]+': '+ser.length+(ser.length===1?' entry':' entries')+(ser.length>1?', from '+Core.bmiRound(ser[0].bmi).toFixed(1)+' to '+Core.bmiRound(ser[ser.length-1].bmi).toFixed(1):', '+Core.bmiRound(ser[0].bmi).toFixed(1))+'.';
  if(sum.textContent!==summ)sum.textContent=summ;
  if(bmiChart){bmiChart.destroy();bmiChart=null}
  if(!window.Chart)return;
  const L=chartLook(),accent=L.accent,muted=L.muted,sep=L.sep,fnt=L.font;
  const vals=keys.map(k=>{const s=ser.find(x=>x.k===k);return s?Core.bmiRound(s.bmi):null});
  bmiChart=new Chart(root.querySelector('#chartBmi'),{type:'line',data:{labels:keys.map(k=>parse(k).toLocaleDateString(undefined,{day:'numeric',month:'short'})),datasets:[{data:vals,borderColor:accent,borderWidth:2.5,tension:0,cubicInterpolationMode:'monotone',spanGaps:true,pointRadius:ser.length<=20?3:0,pointHoverRadius:5,pointBackgroundColor:accent,pointBorderColor:accent,fill:false}]},
    options:{responsive:true,maintainAspectRatio:false,animation:reduced()?false:{duration:350},interaction:{mode:'nearest',axis:'x',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'BMI '+c.parsed.y.toFixed(1)}}},
      onHover(e,els){if(els&&els.length){const k=keys[els[0].index],s=ser.findIndex(x=>x.k===k);if(s>=0)setRead(s)}},
      scales:{x:{grid:{display:false},border:{display:false},ticks:{color:muted,maxTicksLimit:5,maxRotation:0,font:fnt}},y:{grid:{color:sep},border:{display:false},ticks:{color:muted,maxTicksLimit:4,font:fnt},grace:'10%'}}}});
}

/* ---------- goal weight (settings.body.goalKg in kg, optional settings.body.goalDate) ---------- */
function goalSummary(){
  const g=settings.body.goalKg;if(g==null)return null;
  const t=todayStr(),st=Core.goalStatus(g,settings.body.goalDate||null,Core.weightSeries(days,t),t);
  return{st,text:Core.goalText(st,t,fmtWeight)};
}
/** The goal under the body stats on Progress: the line "4 kg to go · about 0.4 kg a week lately · around mid-December", or a way to set one. */
function renderGoalLine(){
  const el=$('goalLine');if(!el)return;
  el.innerHTML='';
  const gs=goalSummary();
  if(!gs){
    if(latestBody('weight',todayStr())){
      const b=h('<button class="txtbtn goal-set" id="goalSet"><svg data-ic="target" class="sm"></svg><span>Set a goal weight</span></button>');
      b.addEventListener('click',()=>goalSheet());el.appendChild(b);
    }
    return;
  }
  const g=settings.body.goalKg,d=settings.body.goalDate;
  const c=h('<div class="card goalcard"><button class="goal-main" id="goalCard"><span class="goal-lab"><svg data-ic="target" class="sm"></svg><span>Goal weight</span></span><b class="goal-val num"></b><span class="goal-line"></span><span class="goal-note"></span></button></div>');
  c.querySelector('.goal-val').textContent=fmtWeight(g)+(d?' · '+Core.approxDate(d,todayStr()):'');
  c.querySelector('.goal-line').textContent=gs.text.line;
  const gn=c.querySelector('.goal-note');if(gs.text.note)gn.textContent=gs.text.note;else gn.remove();
  c.querySelector('button').setAttribute('aria-label','Goal weight '+fmtWeight(g)+(d?', '+Core.approxDate(d,todayStr()):'')+'. '+gs.text.line+' '+gs.text.note+' Tap to change.');
  c.querySelector('button').addEventListener('click',()=>goalSheet());
  el.appendChild(c);
}
function goalDateSheet(cur,cb){
  const root=h('<div><div class="field"><label for="goalDateIn">Date</label><div class="box"><input type="date" id="goalDateIn" data-focus></div></div><div class="err" id="goalDateErr" role="alert"></div><button class="btn secondary" id="goalDateNone">No date</button></div>');
  const inp=root.querySelector('#goalDateIn');inp.min=Core.addDays(todayStr(),1);inp.value=cur||'';
  const sh=openSheet({title:'Target date',content:root,onDone:()=>{
    const v=inp.value;
    if(v&&v<=todayStr()){root.querySelector('#goalDateErr').textContent='Pick a day after today, or choose No date';return false}
    cb(v||null);
  }});
  root.querySelector('#goalDateNone').addEventListener('click',()=>{cb(null);sh.close('cancel')});
}
/** Asks for a goal weight in the unit chosen in Settings, with an optional date. Clearing the number removes the goal. */
function goalSheet(){
  const cur=settings.body.goalKg,unit=wUnit();
  let date=settings.body.goalDate||null;
  const label=()=>date?'Target date: '+Core.approxDate(date,todayStr()):'Add a target date (optional)';
  const sh=numberSheet({title:'Goal weight',value:cur!=null?r1(toDispWeight(cur)):'',unitLine:unit+(cur!=null?' · clear the number to remove your goal':' · optional'),step:unit==='lb'?1:0.5,min:0,
    validate:v=>{if(v==null)return '';const kg=fromDispWeight(v);return kg<30||kg>250?'Check the goal weight':''},
    extras:[{label:label(),onClick:()=>goalDateSheet(date,d=>{date=d;const b=dateBtn();if(b)b.textContent=label()})}],
    onDone:async v=>{
      if(v==null){
        if(cur==null&&!date)return;
        delete settings.body.goalKg;delete settings.body.goalDate;
        await saveSettingsQuiet();refreshAll();toast('Goal removed',{icon:'target'});return;
      }
      const kg=fromDispWeight(v);
      settings.body.goalKg=kg;if(date)settings.body.goalDate=date;else delete settings.body.goalDate;
      await saveSettingsQuiet();refreshAll();
      const bm=heightCm()!=null?Core.bmi(kg,heightCm()):null;
      toast(bm!=null&&bm<18.5?'Goal saved. That is under the healthy range for your height, so it may be worth checking with a doctor.':'Goal saved',{icon:'target'});
    }});
  const dateBtn=()=>[...sh.body.querySelectorAll('button')].find(b=>/target date/i.test(b.textContent));
  return sh;
}
