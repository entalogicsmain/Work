/* Plan: goals only. Habits and rules grouped by section with their schedules, the habit library, the habit form, sections.
   Everything that is not a goal (account, backup, reminder, units, body, permissions) lives in Settings (settings.js). */

let reorderMode=false;

async function saveSettingsQuiet(){
  try{await store.persist();flashSaved();autoBackup();markSettingsDirty();syncSoon(false)}
  catch(e){toast("Couldn't save. Try again.",{icon:'x'})}
}
async function persistSettings(msg){
  await saveSettingsQuiet();
  if(msg)toast(msg);
  renderSetup();renderToday();renderProgress();
}
function renderSetup(){renderPlan();renderSettings()}

/* ---------- swipe rows (swipe left to remove) and reordering inside a section ---------- */
function attachSwipe(sw,row,del){
  let sx=0,sy=0,base=0,locked=false,tracking=false,open=false,suppress=false;
  const W=()=>parseFloat(getComputedStyle(document.documentElement).fontSize)*5.5;
  row.addEventListener('pointerdown',e=>{if(reorderMode||e.target.closest('.handle'))return;tracking=true;locked=false;sx=e.clientX;sy=e.clientY;base=open?-W():0});
  row.addEventListener('pointermove',e=>{
    if(!tracking)return;const dx=e.clientX-sx,dy=e.clientY-sy;
    if(!locked){if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){tracking=false;return}if(Math.abs(dx)>8){locked=true;sw.classList.add('drag');try{row.setPointerCapture(e.pointerId)}catch(x){}}}
    if(locked)row.style.transform='translateX('+clamp(base+dx,-W()-24,0)+'px)';
  });
  const end=e=>{
    if(!tracking)return;tracking=false;
    if(locked){const fin=base+(e.clientX-sx);open=fin<-W()/2;row.style.transform=open?'translateX(-'+W()+'px)':'';sw.classList.remove('drag');suppress=true;setTimeout(()=>suppress=false,60);if(open)haptic('light')}
  };
  row.addEventListener('pointerup',end);row.addEventListener('pointercancel',end);
  row.addEventListener('click',e=>{if(suppress){e.stopImmediatePropagation();e.preventDefault();return}if(open){e.stopImmediatePropagation();open=false;row.style.transform=''}},true);
  sw.querySelector('.swipe-del').addEventListener('click',()=>{del()});
}
function swipeRow(o){
  const sw=h('<div class="swipe"><button class="swipe-del" aria-label="Remove"></button><div class="row" role="button" tabindex="0"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="row-val"></span><svg data-ic="chevron-right" class="chev"></svg><span class="handle" role="button"></span></div></div>');
  sw.dataset.id=o.id;
  sw.querySelector('.swipe-del').innerHTML=icon('trash-2','sm')+'<span>Remove</span>';
  const row=sw.querySelector('.row');
  row.querySelector('.row-ic').innerHTML=icon(o.icon);row.querySelector('.row-label').textContent=o.label;
  const sb=row.querySelector('.row-sub');if(o.sub)sb.textContent=o.sub;else sb.remove();
  const v=row.querySelector('.row-val');if(o.val)v.textContent=o.val;else v.remove();
  const hd=row.querySelector('.handle');hd.innerHTML=icon('grip-vertical');hd.setAttribute('aria-label','Reorder '+o.label);
  if(!o.reorder)hd.remove();
  row.setAttribute('aria-label',o.label+(o.val?', '+o.val:'')+(o.sub?', '+o.sub:'')+'. Tap to edit.');
  row.addEventListener('click',()=>{if(!reorderMode)o.onTap()});
  row.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!reorderMode){e.preventDefault();o.onTap()}});
  if(o.hidden)sw.classList.add('is-hidden');
  attachSwipe(sw,row,o.onDelete);
  if(o.reorder)attachReorder(sw,hd);
  return sw;
}
function attachReorder(sw,handle){
  handle.addEventListener('pointerdown',e=>{
    if(!reorderMode)return;e.preventDefault();e.stopPropagation();
    handle.setPointerCapture(e.pointerId);sw.classList.add('dragging');haptic('medium');
    let startY=e.clientY;
    const move=ev=>{
      let dy=ev.clientY-startY;
      const next=sw.nextElementSibling,prev=sw.previousElementSibling;
      if(next&&next.classList.contains('swipe')&&dy>next.offsetHeight/2){sw.parentNode.insertBefore(next,sw);startY+=next.offsetHeight;dy=ev.clientY-startY;haptic('light')}
      else if(prev&&prev.classList.contains('swipe')&&dy<-prev.offsetHeight/2){sw.parentNode.insertBefore(sw,prev);startY-=prev.offsetHeight;dy=ev.clientY-startY;haptic('light')}
      sw.style.transform='translateY('+dy+'px)';
    };
    const up=()=>{
      handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);
      sw.classList.remove('dragging');sw.style.transform='';
      commitPlanOrder();
    };
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);
  });
  handle.addEventListener('keydown',e=>{
    if(!reorderMode||(e.key!=='ArrowUp'&&e.key!=='ArrowDown'))return;e.preventDefault();
    const up=e.key==='ArrowUp',sib=up?sw.previousElementSibling:sw.nextElementSibling;
    if(sib&&sib.classList.contains('swipe')){sw.parentNode.insertBefore(sw,up?sib:sib.nextSibling);commitPlanOrder(sw.dataset.id)}
  });
}
function commitPlanOrder(focusId){
  const order=[...$('planSections').querySelectorAll('.swipe')].map(x=>habitById(x.dataset.id)).filter(Boolean);
  const rest=settings.habits.filter(x=>!order.includes(x));
  const next=order.concat(rest);
  if(next.map(x=>x.id).join()!==settings.habits.map(x=>x.id).join()){settings.habits=next;persistSettings('Order updated')}
  if(focusId)setTimeout(()=>{const hd=$('planSections').querySelector('.swipe[data-id="'+focusId+'"] .handle');if(hd)hd.focus({preventScroll:true})},0);
}
function addRow(label,onTap,id,iconName){
  const b=h('<button class="row add-row"><span class="row-ic"></span><span class="row-body"><span class="row-label" style="color:var(--accent)"></span></span></button>');
  b.querySelector('.row-ic').innerHTML=icon(iconName||'plus');b.querySelector('.row-label').textContent=label;b.addEventListener('click',onTap);if(id)b.id=id;return b;
}
function navRow(o){
  const b=h('<button class="row"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="row-val"></span><svg data-ic="chevron-right" class="chev"></svg></button>');
  b.querySelector('.row-ic').innerHTML=icon(o.icon);b.querySelector('.row-label').textContent=o.label;
  const sb=b.querySelector('.row-sub');if(o.sub)sb.textContent=o.sub;else sb.remove();
  const v=b.querySelector('.row-val');if(o.val)v.textContent=o.val;else v.remove();
  if(o.id)b.id=o.id;b.addEventListener('click',o.onTap);hydrate(b);return b;
}

/* ---------- the Plan screen ---------- */
function habitSummary(x){
  const sch=Core.scheduleLabel(x.schedule);
  if(x.type==='yesno')return'Yes/No · '+sch;
  if(x.type==='measure')return sch;
  if(x.type==='steps')return'Automatic · '+sch;
  return sch;
}
function habitVal(x){
  if(x.type==='yesno'||x.type==='measure')return'';
  return fmt(x.target)+' '+x.unit;
}
function renderPlan(){
  const root=$('planSections');if(!root)return;
  root.innerHTML='';
  $('reorderBtn').textContent=reorderMode?'Done':'Reorder';
  $('reorderBtn').setAttribute('aria-pressed',String(reorderMode));
  settings.sections.forEach(sec=>{
    const hs=settings.habits.filter(x=>x.section===sec.id);
    if(!hs.length)return;
    const head=h('<div class="group-head plan-sec-head"><span></span></div>');head.querySelector('span').textContent=sec.name;
    const g=h('<div class="group ic plan-group" data-sec=""></div>');g.dataset.sec=sec.id;g.classList.toggle('reorder',reorderMode);
    hs.forEach(x=>g.appendChild(swipeRow({id:x.id,icon:x.icon,label:x.name,sub:habitSummary(x)+(x.hidden?' · Hidden from Today':''),val:habitVal(x),hidden:x.hidden,reorder:true,onTap:()=>habitFormSheet(x),onDelete:()=>removeHabit(x)})));
    root.appendChild(head);root.appendChild(g);
  });
  if(!settings.habits.length)root.appendChild(h('<div class="empty card"><svg data-ic="target"></svg><b class="t-head">No habits yet</b><p>Add what you want to do from the library.</p></div>'));
  hydrate(root);
  const add=$('planAdd');add.innerHTML='';add.hidden=reorderMode;
  add.appendChild(addRow('Add a habit from the library',()=>openLibrary({}),'addHabitRow'));
  add.appendChild(addRow('Create your own',()=>habitFormSheet(null,{}),'createHabitRow','sparkles'));
  const pt=$('planToday');pt.innerHTML='';
  pt.appendChild(navRow({icon:'sliders-horizontal',label:'Rearrange Today',sub:'Drag cards, hide them, add habits',id:'planEditToday',onTap:()=>{showTab('today');enterEdit()}}));
  const ps=$('planSecs');ps.innerHTML='';
  settings.sections.forEach(sec=>{
    const n=settings.habits.filter(x=>x.section===sec.id).length;
    ps.appendChild(navRow({icon:'layers',label:sec.name,val:n+(n===1?' habit':' habits'),onTap:()=>sectionActions(sec)}));
  });
  ps.appendChild(addRow('Add a section',()=>addSection(),'addSecRow','folder-plus'));
}
$('reorderBtn').addEventListener('click',()=>{reorderMode=!reorderMode;haptic('light');renderPlan()});
async function sectionActions(sec){
  const empty=!settings.habits.some(x=>x.section===sec.id);
  const acts=[{label:'Rename',value:'rename'}];
  if(sec.id!=='body'&&empty)acts.push({label:'Delete section',value:'del',destructive:true});
  const r=await actionSheet({title:sec.name,message:empty?'This section is empty.':'Move its habits to another section to delete it.',actions:acts});
  if(r==='rename')renameSection(sec);else if(r==='del')deleteSection(sec);
}
async function confirmRemove(name,what){
  return(await actionSheet({title:'Remove '+name+'?',message:what||'Past entries stay saved.',actions:[{label:'Remove',value:'rm',destructive:true}]}))==='rm';
}
async function removeHabit(x){if(!(await confirmRemove(x.name)))return;settings.habits=settings.habits.filter(q=>q.id!==x.id);await persistSettings('Removed '+x.name)}

/* ---------- a plain form sheet (name fields) ---------- */
function formSheet(o){
  const root=h('<div>'+o.fields.map(f=>'<div class="field"><label for="'+f.id+'">'+esc(f.label)+'</label><div class="box"><input id="'+f.id+'" '+(f.type?'type="'+f.type+'" inputmode="decimal" ':'')+'placeholder="'+esc(f.ph||'')+'"'+(f.focus?' data-focus':'')+' autocomplete="off"></div></div>').join('')+'<div class="err" id="fErr" role="alert"></div>'+(o.remove?'<button class="btn secondary danger-btn" id="fRemove" style="margin-top:var(--s4)">'+esc(o.remove.label)+'</button>':'')+'</div>');
  o.fields.forEach(f=>{root.querySelector('#'+f.id).value=f.value==null?'':f.value});
  const err=root.querySelector('#fErr');
  root.querySelectorAll('input').forEach(i=>i.addEventListener('input',()=>err.textContent=''));
  const sh=openSheet({title:o.title,content:root,onDone:()=>{const v={};o.fields.forEach(f=>v[f.id]=root.querySelector('#'+f.id).value.trim());const e=o.validate(v);if(e){err.textContent=e;haptic('light');return false}o.onDone(v)}});
  if(o.remove)root.querySelector('#fRemove').addEventListener('click',async()=>{if(await o.remove.confirm()){sh.close('cancel');o.remove.run()}});
  return sh;
}

/* ---------- the habit library ---------- */
function libSubtitle(l){
  const t=l.type==='yesno'?'Yes/No':l.type==='steps'?'Automatic':l.type==='measure'?'Measurement':fmt(l.target)+' '+l.unit;
  const sch=l.schedule?Core.scheduleLabel(l.schedule):'Every day';
  return t+' · '+sch;
}
function openLibrary(opts){
  opts=opts||{};
  const root=h('<div class="library"><div class="field search-field"><div class="box"><svg data-ic="search" class="sm"></svg><input id="libSearch" type="search" placeholder="Search habits" autocomplete="off" aria-label="Search the habit library" data-focus></div></div><div id="libList"></div><div class="group ic" style="margin-top:var(--s4)"><button class="row" id="libCreate"><span class="row-ic"></span><span class="row-body"><span class="row-label" style="color:var(--accent)">Create your own</span><span class="row-sub">Name, icon, type, target, unit, schedule and section</span></span><svg data-ic="chevron-right" class="chev"></svg></button></div></div>');
  root.querySelector('.row-ic').innerHTML=icon('sparkles');hydrate(root);
  const list=root.querySelector('#libList'),input=root.querySelector('#libSearch');
  const sh=openSheet({title:'Add a habit',left:null,right:'Done',content:root});
  function draw(){
    list.innerHTML='';
    const found=Core.searchLibrary(input.value);
    if(!found.length){list.appendChild(h('<div class="empty"><svg data-ic="search"></svg><p>Nothing matches. You can create your own below.</p></div>'));hydrate(list);return}
    Core.LIB_CATEGORIES.forEach(cat=>{
      const items=found.filter(l=>l.category===cat);
      if(!items.length)return;
      const hd=h('<div class="group-head lib-head"><span></span></div>');hd.querySelector('span').textContent=cat;list.appendChild(hd);
      const g=h('<div class="group ic lib-group"></div>');
      items.forEach(l=>{
        const have=Core.libHabitIn(settings,l);
        const r=h('<div class="row lib-row"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><button class="lib-add"></button></div>');
        r.dataset.lib=l.id;
        r.querySelector('.row-ic').innerHTML=icon(l.icon,'sm');r.querySelector('.row-label').textContent=l.name;r.querySelector('.row-sub').textContent=libSubtitle(l);
        const b=r.querySelector('.lib-add');
        const state=!have?'add':have.hidden?'show':'added';
        b.textContent=state==='add'?'Add':state==='show'?'Show':'Added';
        b.disabled=state==='added';b.classList.toggle('done',state==='added');
        b.setAttribute('aria-label',(state==='add'?'Add ':state==='show'?'Show ':'Already added: ')+l.name);
        b.addEventListener('click',async()=>{
          const hb=Core.addFromLibrary(settings,l,opts.section);
          haptic('success');await saveSettingsQuiet();
          toast(state==='show'?l.name+' is back on Today':'Added '+l.name,{icon:'circle-check'});
          renderToday(true);renderSetup();draw();
          if(opts.onAdded)opts.onAdded(hb);
        });
        g.appendChild(r);
      });
      list.appendChild(g);
    });
    hydrate(list);
  }
  input.addEventListener('input',draw);draw();
  root.querySelector('#libCreate').addEventListener('click',()=>{sh.close('cancel');habitFormSheet(null,{section:opts.section})});
  return sh;
}

/* ---------- the habit form: create or edit ---------- */
const TYPE_LABEL={count:'Count',duration:'Duration',yesno:'Yes/No'};
const TYPE_HELP={count:'A number you add to with + and − (pushups, glasses of water).',duration:'Minutes or seconds with quick presets (plank, a walk).',yesno:'One tap to mark it done (took vitamins, no sugar).'};
function habitFormSheet(x,opts){
  opts=opts||{};
  const isNew=!x,fixed=x&&(x.type==='steps'||x.type==='measure');
  const st={type:x?x.type:'count',icon:x?x.icon:'target',sched:x?Core.normalizeSchedule(x.schedule):{kind:'daily'},show:x?!x.hidden:true};
  if(st.sched.kind==='days')st.sched.days=st.sched.days.slice();
  const root=h('<div class="hform"></div>');
  root.innerHTML='<div class="field"><label for="fName">Name</label><div class="box"><input id="fName" placeholder="Pull-ups" autocomplete="off"></div></div>'+
    (fixed?'':'<div class="field"><label id="fTypeLab">Type</label><div class="seg" id="fType" role="radiogroup" aria-labelledby="fTypeLab"></div><p class="t-foot muted" id="fTypeHelp" style="margin:6px var(--s4) 0"></p></div>')+
    '<div class="field"><label id="fIconLab">Icon</label><div class="iconpick" id="fIcons" role="radiogroup" aria-labelledby="fIconLab"></div></div>'+
    '<div id="fNumWrap"><div class="field-row"><div class="field"><label for="fTarget">Target</label><div class="box"><input id="fTarget" type="number" inputmode="decimal" placeholder="10"></div></div><div class="field"><label for="fUnit">Unit</label><div class="box"><input id="fUnit" placeholder="reps" autocomplete="off"></div></div></div></div>'+
    '<div class="field"><label id="fSchedLab">Schedule</label><div class="seg wrap" id="fSched" role="radiogroup" aria-labelledby="fSchedLab"></div><div id="fSchedDetail"></div></div>'+
    '<div class="field"><label for="fSection">Section</label><div class="box"><select id="fSection" aria-label="Section"></select></div><div class="box" id="fNewSecBox" hidden style="margin-top:8px"><input id="fNewSec" placeholder="New section name" autocomplete="off" aria-label="New section name"></div></div>'+
    '<div class="group" style="margin-bottom:var(--s3)"><label class="row"><span class="row-label">Show on Today</span><input type="checkbox" class="switch" role="switch" id="fShow" aria-label="Show on Today"></label></div>'+
    '<div class="err" id="fErr" role="alert"></div>'+(isNew?'':'<button class="btn secondary danger-btn" id="fRemove">Remove habit</button>');
  const q=sel=>root.querySelector(sel);
  q('#fName').value=x?x.name:'';q('#fTarget').value=x&&x.type!=='yesno'&&x.type!=='measure'?x.target:'';q('#fUnit').value=x&&x.type!=='yesno'&&x.type!=='measure'?x.unit:'';
  q('#fShow').checked=st.show;
  // type
  function drawType(){
    const t=q('#fType');if(!t)return;t.innerHTML='';
    ['count','duration','yesno'].forEach(k=>{const b=h('<button role="radio"></button>');b.textContent=TYPE_LABEL[k];b.dataset.type=k;b.setAttribute('aria-checked',String(st.type===k));b.setAttribute('aria-selected',String(st.type===k));b.disabled=!isNew&&st.type!==k;b.addEventListener('click',()=>{st.type=k;haptic('light');if(isNew&&!q('#fUnit').value)q('#fUnit').value=k==='duration'?'min':k==='count'?'reps':'';drawType();drawNum()});t.appendChild(b)});
    q('#fTypeHelp').textContent=isNew?TYPE_HELP[st.type]:'The type can\'t be changed once a habit has been logged.';
  }
  function drawNum(){const hideNum=st.type==='yesno'||(x&&x.type==='measure');q('#fNumWrap').hidden=hideNum;if(x&&x.type==='steps')q('#fUnit').disabled=true}
  // icons
  function drawIcons(){
    const w=q('#fIcons');w.innerHTML='';
    Core.ICONS.forEach(n=>{const b=h('<button class="ipick" role="radio"></button>');b.innerHTML=icon(n);b.dataset.icon=n;b.setAttribute('aria-label',n.replace(/-/g,' '));b.setAttribute('aria-checked',String(st.icon===n));b.classList.toggle('on',st.icon===n);b.addEventListener('click',()=>{st.icon=n;drawIcons()});w.appendChild(b)});
  }
  // schedule
  const KINDS=[['daily','Every day'],['days','Specific days'],['weekly','Times a week'],['everyN','Every N weeks']];
  function drawSched(){
    const w=q('#fSched');w.innerHTML='';
    KINDS.forEach(([k,l])=>{const b=h('<button role="radio"></button>');b.textContent=l;b.dataset.kind=k;b.setAttribute('aria-checked',String(st.sched.kind===k));b.setAttribute('aria-selected',String(st.sched.kind===k));
      b.addEventListener('click',()=>{haptic('light');if(k==='daily')st.sched={kind:'daily'};else if(k==='days')st.sched={kind:'days',days:st.sched.kind==='days'?st.sched.days:[1,3,5]};else if(k==='weekly')st.sched={kind:'weekly',times:st.sched.times||3};else st.sched={kind:'everyN',weeks:st.sched.weeks||2};drawSched()});w.appendChild(b)});
    const d=q('#fSchedDetail');d.innerHTML='';
    if(st.sched.kind==='days'){
      const row=h('<div class="daychips" role="group" aria-label="Days of the week"></div>');
      Core.WEEK_ORDER.forEach(n=>{const b=h('<button class="chip daychip"></button>');b.textContent=Core.WEEKDAYS[n];b.dataset.day=n;const on=st.sched.days.includes(n);b.setAttribute('aria-pressed',String(on));
        b.addEventListener('click',()=>{const ds=st.sched.days;if(ds.includes(n))st.sched.days=ds.filter(v=>v!==n);else st.sched.days=ds.concat(n).sort((a,c)=>a-c);haptic('light');drawSched()});row.appendChild(b)});
      d.appendChild(row);
    }else if(st.sched.kind==='weekly'||st.sched.kind==='everyN'){
      const isW=st.sched.kind==='weekly',key=isW?'times':'weeks',max=isW?7:12,v=st.sched[key];
      const row=h('<div class="stepline"><button class="step" aria-label="Fewer"></button><span class="stepval num" id="fSchedN"></span><button class="step" aria-label="More"></button></div>');
      const [mi,pl]=row.querySelectorAll('.step');mi.innerHTML=icon('minus');pl.innerHTML=icon('plus');
      row.querySelector('#fSchedN').textContent=isW?v+(v===1?' time a week':' times a week'):(v===1?'Every week':'Every '+v+' weeks');
      mi.addEventListener('click',()=>{st.sched[key]=Math.max(1,v-1);haptic('light');drawSched()});pl.addEventListener('click',()=>{st.sched[key]=Math.min(max,v+1);haptic('light');drawSched()});
      d.appendChild(row);
    }
    hydrate(d);
  }
  // section
  const sel=q('#fSection');
  settings.sections.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;sel.appendChild(o)});
  const no=document.createElement('option');no.value='__new';no.textContent='New section…';sel.appendChild(no);
  sel.value=x?x.section:(opts.section&&settings.sections.some(s=>s.id===opts.section)?opts.section:(st.type==='yesno'?'food':'workout'));
  if(!sel.value||sel.value==='')sel.value=settings.sections[0]?settings.sections[0].id:'__new';
  sel.addEventListener('change',()=>{q('#fNewSecBox').hidden=sel.value!=='__new';if(sel.value==='__new')q('#fNewSec').focus()});
  q('#fShow').addEventListener('change',e=>{st.show=e.target.checked});
  drawType();drawIcons();drawSched();drawNum();
  const err=q('#fErr');
  root.querySelectorAll('input').forEach(i=>i.addEventListener('input',()=>err.textContent=''));
  const sh=openSheet({title:isNew?'New habit':'Edit habit',content:root,onDone:()=>{
    const name=q('#fName').value.trim();
    const needNum=st.type==='count'||st.type==='duration'||(x&&x.type==='steps');
    const target=Number(q('#fTarget').value);
    const e=!name?'Enter a name first':needNum&&!(target>0)?'Enter a target above 0':st.sched.kind==='days'&&!st.sched.days.length?'Pick at least one day':sel.value==='__new'&&!q('#fNewSec').value.trim()?'Name the new section':'';
    if(e){err.textContent=e;haptic('light');return false}
    let secId=sel.value;
    if(secId==='__new'){
      const nm=q('#fNewSec').value.trim().slice(0,40),taken=new Set(settings.sections.map(s=>s.id));
      secId=Core.uniqueId((slug(nm).replace(/-[a-z0-9]+$/,'')||'section'),taken);
      settings.sections.splice(Math.max(0,settings.sections.findIndex(s=>s.id==='body')>=0?settings.sections.findIndex(s=>s.id==='body'):settings.sections.length),0,{id:secId,name:nm});
    }
    const sched=Core.normalizeSchedule(st.sched);
    if(x){
      x.name=name;x.icon=st.icon;x.section=secId;x.schedule=sched;
      if(needNum){x.target=target;if(x.type!=='steps')x.unit=q('#fUnit').value.trim()||x.unit}
      if(st.show)delete x.hidden;else x.hidden=true;
      persistSettings('Habit updated');
    }else{
      const unit=q('#fUnit').value.trim()||(st.type==='duration'?'min':st.type==='count'?'times':'');
      const nh={id:slug(name),name,icon:st.icon,type:st.type,unit,target:st.type==='yesno'?1:target,section:secId,schedule:sched};
      if(!st.show)nh.hidden=true;
      settings.habits.push(nh);
      persistSettings('Added '+name);
    }
  }});
  if(!isNew)q('#fRemove').addEventListener('click',async()=>{if(await confirmRemove(x.name)){sh.close('cancel');settings.habits=settings.habits.filter(z=>z.id!==x.id);persistSettings('Removed '+x.name)}});
  return sh;
}
