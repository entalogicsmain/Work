/* Plan: goals only. Habits and rules grouped by section with their schedules, the habit library, the habit form, sections.
   Everything that is not a goal (account, backup, reminder, units, body, permissions) lives in Settings (settings.js). */

let reorderMode=false;

async function saveSettingsQuiet(){
  try{await store.persist();flashSaved();autoBackup();markSettingsDirty();syncSoon(false);rescheduleReminders()}
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
  // row = the sliding wrapper (it holds the row button and the reorder handle side by side)
  const delBtn=sw.querySelector('.swipe-del');
  const setOpen=v=>{open=v;sw.classList.toggle('open',v);if(v){delBtn.removeAttribute('aria-hidden');delBtn.tabIndex=0}else{delBtn.setAttribute('aria-hidden','true');delBtn.tabIndex=-1}};
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
    if(locked){const fin=base+(e.clientX-sx);setOpen(fin<-W()/2);row.style.transform=open?'translateX(-'+W()+'px)':'';sw.classList.remove('drag');suppress=true;setTimeout(()=>suppress=false,60);if(open)haptic('light')}
  };
  row.addEventListener('pointerup',end);row.addEventListener('pointercancel',end);
  row.addEventListener('click',e=>{if(suppress){e.stopImmediatePropagation();e.preventDefault();return}if(open){e.stopImmediatePropagation();setOpen(false);row.style.transform=''}},true);
  sw.querySelector('.swipe-del').addEventListener('click',()=>{del()});
}
function swipeRow(o){
  const sw=h('<div class="swipe"><button class="swipe-del" aria-label="Remove" aria-hidden="true" tabindex="-1"></button><div class="swipe-slide"><button class="row"><span class="row-ic"></span><span class="row-body"><span class="row-label"></span><span class="row-sub"></span></span><span class="row-val"></span><svg data-ic="chevron-right" class="chev"></svg></button><button class="handle"></button></div></div>');
  sw.dataset.id=o.id;
  sw.querySelector('.swipe-del').innerHTML=icon('trash-2','sm')+'<span>Remove</span>';
  const slide=sw.querySelector('.swipe-slide'),row=sw.querySelector('.row');
  row.querySelector('.row-ic').innerHTML=icon(o.icon);row.querySelector('.row-label').textContent=o.label;
  const sb=row.querySelector('.row-sub');if(o.sub)sb.textContent=o.sub;else sb.remove();
  const v=row.querySelector('.row-val');if(o.val)v.textContent=o.val;else v.remove();
  const hd=slide.querySelector('.handle');hd.innerHTML=icon('grip-vertical');hd.setAttribute('aria-label','Reorder '+o.label);
  if(!o.reorder)hd.remove();
  row.setAttribute('aria-label',o.label+(o.val?', '+o.val:'')+(o.sub?', '+o.sub:'')+'. Tap to edit.');
  row.addEventListener('click',()=>{if(!reorderMode)o.onTap()});
  if(o.hidden)sw.classList.add('is-hidden');
  attachSwipe(sw,slide,o.onDelete);
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
  const sch=Core.scheduleLabel(x.schedule)+(x.anchor?' · '+x.anchor:'')+(x.remind&&x.remind.times&&x.remind.times.length?' · Reminder '+x.remind.times.map(Core.fmt12).join(', '):'');
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
  $('reorderBtn').textContent=reorderMode?'Done':'Reorder in sections';
  $('reorderBtn').setAttribute('aria-pressed',String(reorderMode));
  settings.sections.forEach(sec=>{
    const hs=settings.habits.filter(x=>x.section===sec.id);
    if(!hs.length)return;
    const head=h('<div class="group-head plan-sec-head"><span role="heading" aria-level="2"></span></div>');head.querySelector('span').textContent=sec.name;
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
/* Remove is immediate and can be undone from the toast: the habit goes back to where it was. Past entries are never touched. */
async function removeHabit(x){
  const at=settings.habits.findIndex(q=>q.id===x.id);
  if(at<0)return;
  settings.habits=settings.habits.filter(q=>q.id!==x.id);
  await saveSettingsQuiet();
  renderSetup();renderToday();renderProgress();
  toast('Removed '+x.name,{icon:'trash-2',undo:async()=>{
    if(!settings.habits.some(q=>q.id===x.id))settings.habits.splice(Math.min(at,settings.habits.length),0,x);
    await saveSettingsQuiet();renderSetup();renderToday();renderProgress();toast(x.name+' is back',{icon:'check'});
  }});
}

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
      const hd=h('<div class="group-head lib-head"><span role="heading" aria-level="2"></span></div>');hd.querySelector('span').textContent=cat;list.appendChild(hd);
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

/* A habit that has reminders needs the notification permission (asked now, in the app only); plan the reminders again once it is known. */
async function reminderPermissionFor(remind){
  if(!remind||!IS_NATIVE)return;
  try{
    if(!(await ensureNotifPermission()))toast("Notifications are off for Comeback, so this reminder can't ring yet. You can turn them on in Android Settings > Apps > Comeback.",{icon:'bell'});
    else rescheduleReminders({now:true}).catch(()=>{});
  }catch(e){}
}

/* ---------- the habit form: create or edit ---------- */
const TYPE_LABEL={count:'Count',duration:'Duration',yesno:'Yes/No'};
const TYPE_HELP={count:'A number you add to with + and − (pushups, glasses of water).',duration:'Minutes or seconds with quick presets (plank, a walk).',yesno:'One tap to mark it done (took vitamins, no sugar).'};
function habitFormSheet(x,opts){
  opts=opts||{};
  const isNew=!x,fixed=x&&(x.type==='steps'||x.type==='measure');
  const st={type:x?x.type:'count',icon:x?x.icon:'target',sched:x?Core.normalizeSchedule(x.schedule):{kind:'daily'},show:x?!x.hidden:true};
  if(st.sched.kind==='days')st.sched.days=st.sched.days.slice();
  st.presets=x&&Array.isArray(x.presets)?x.presets.slice():[];
  st.remind={times:x&&x.remind?x.remind.times.slice():[],skip:x&&x.remind?x.remind.skipIfDone!==false:true};
  const root=h('<div class="hform"></div>');
  root.innerHTML='<div class="field"><label for="fName">Name</label><div class="box"><input id="fName" placeholder="Pull-ups" autocomplete="off"></div></div>'+
    (fixed?'':'<div class="field"><label id="fTypeLab">Type</label><div class="seg" id="fType" role="radiogroup" aria-labelledby="fTypeLab"></div><p class="t-foot muted" id="fTypeHelp" style="margin:6px var(--s4) 0"></p></div>')+
    '<div class="field"><label id="fIconLab">Icon</label><div class="iconpick" id="fIcons" role="radiogroup" aria-labelledby="fIconLab"></div></div>'+
    '<div id="fNumWrap"><div class="field-row"><div class="field"><label for="fTarget">Target</label><div class="box"><input id="fTarget" type="number" inputmode="decimal" placeholder="10"></div></div><div class="field"><label for="fUnit">Unit</label><div class="box"><input id="fUnit" placeholder="reps" autocomplete="off"></div></div></div></div>'+
    '<div class="field"><label id="fSchedLab">Schedule</label><div class="seg wrap" id="fSched" role="radiogroup" aria-labelledby="fSchedLab"></div><div id="fSchedDetail"></div></div>'+
    '<div class="field" id="fPresetWrap"><label id="fPresetLab" for="fPresetIn">Quick add amounts</label><div class="fchips" id="fPresetChips" role="group" aria-labelledby="fPresetLab"></div><div class="fadd"><div class="box"><input id="fPresetIn" type="number" inputmode="decimal" min="0" step="any" placeholder="0.25" aria-label="New quick add amount"></div><button class="btn secondary" id="fPresetAdd" type="button">Add</button></div><p class="t-foot muted remnote" id="fPresetHelp"></p></div>'+
    '<div class="field"><label for="fAnchor">When (optional)</label><div class="box"><input id="fAnchor" maxlength="30" placeholder="After lunch" autocomplete="off"></div><div class="fchips" id="fAnchorChips" role="group" aria-label="Suggested times of day"></div></div>'+
    '<div class="field" id="fRemWrap"><label id="fRemLab">Remind me</label><div class="remlist" id="fRemList"></div><div class="fchips"><button class="fchip" id="fRemAdd" type="button"></button></div><div class="group" id="fRemSkipGroup" style="margin-top:var(--s3)"><label class="row"><span class="row-body"><span class="row-label">Skip if already done</span><span class="row-sub">No reminder once today\'s target is met</span></span><input type="checkbox" class="switch" role="switch" id="fRemSkip" aria-label="Skip the reminder if already done"></label></div><p class="t-foot muted remnote" id="fRemNote"></p></div>'+
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
  function drawNum(){
    const hideNum=st.type==='yesno'||(x&&x.type==='measure');q('#fNumWrap').hidden=hideNum;if(x&&x.type==='steps')q('#fUnit').disabled=true;
    q('#fPresetWrap').hidden=!(st.type==='count'||st.type==='duration');
    q('#fRemWrap').hidden=st.type==='steps';
    if(typeof drawPresets==='function'&&q('#fPresetChips'))drawPresets();
  }
  // quick-add amounts (Count and Duration): chips you can remove, and a box to add one (up to 4)
  const unitText=()=>q('#fUnit').value.trim()||(st.type==='duration'?'min':'');
  function drawPresets(){
    const w=q('#fPresetChips');w.innerHTML='';
    st.presets.forEach((a,i)=>{
      const b=h('<button class="fchip" type="button"></button>');const t=Core.presetLabel({unit:unitText()},a,true);
      b.textContent=t+' ';b.insertAdjacentHTML('beforeend',icon('x'));b.setAttribute('aria-label','Remove '+t.slice(1));
      b.addEventListener('click',()=>{st.presets.splice(i,1);haptic('light');drawPresets()});w.appendChild(b);
    });
    q('#fPresetAdd').disabled=st.presets.length>=4;
    q('#fPresetHelp').textContent=st.presets.length?'These show on the card. Tap one to remove it.':'Leave empty to use the usual amounts for this unit. Add up to 4 of your own, such as 0.25 for a glass of water in litres.';
  }
  function addPreset(){
    const inp=q('#fPresetIn'),v=Math.round(Number(inp.value)*100)/100;
    if(!(v>0)||v>1e6){err.textContent='Enter an amount above 0';inp.focus();return}
    if(st.presets.length>=4){err.textContent='Up to 4 amounts';return}
    if(!st.presets.includes(v))st.presets=st.presets.concat(v).sort((a,c)=>a-c);
    inp.value='';haptic('light');drawPresets();
  }
  // anchors: "After lunch" and friends, plain text
  const ANCHORS=['After waking','After morning tea','After lunch','After dinner','Before bed'];
  function drawAnchors(){
    const w=q('#fAnchorChips');w.innerHTML='';const cur=q('#fAnchor').value.trim();
    ANCHORS.forEach(a=>{const b=h('<button class="fchip" type="button"></button>');b.textContent=a;b.setAttribute('aria-pressed',String(cur===a));
      b.addEventListener('click',()=>{q('#fAnchor').value=cur===a?'':a;haptic('light');drawAnchors()});w.appendChild(b)});
  }
  // reminders for this habit: up to 3 times, 12-hour pickers
  function drawRem(){
    const list=q('#fRemList');list.innerHTML='';
    st.remind.times.forEach((t,i)=>{
      const row=h('<div class="remrow"><span class="remtime"></span><button class="iconbtn" type="button"></button></div>');
      const sp=row.querySelector('.remtime');initTime12(sp,'Reminder time '+(i+1));sp.value=t;
      sp.addEventListener('change',()=>{st.remind.times[i]=sp.value});
      const rm=row.querySelector('.iconbtn');rm.innerHTML=icon('x');rm.setAttribute('aria-label','Remove reminder time '+(i+1));
      rm.addEventListener('click',()=>{st.remind.times.splice(i,1);haptic('light');drawRem()});
      list.appendChild(row);
    });
    const add=q('#fRemAdd');add.hidden=st.remind.times.length>=3;
    add.innerHTML=icon('plus','sm')+'<span></span>';add.querySelector('span').textContent=st.remind.times.length?'Add another time':'Add a reminder time';
    q('#fRemSkipGroup').hidden=!st.remind.times.length;
    q('#fRemSkip').checked=st.remind.skip;
    q('#fRemNote').textContent=!st.remind.times.length?'A gentle nudge at the times you pick. Up to 3 a day.':IS_NATIVE?'Reminders ring on days this habit is due.':'Reminders only ring in the Android app.';
  }
  q('#fRemAdd').addEventListener('click',()=>{
    const used=new Set(st.remind.times),t=['08:00','13:00','19:00','09:00','12:00','18:00'].find(v=>!used.has(v))||'10:00';
    st.remind.times.push(t);haptic('light');drawRem();
    const last=[...q('#fRemList').querySelectorAll('select')].pop();if(last)last.focus({preventScroll:true});
  });
  q('#fRemSkip').addEventListener('change',e=>{st.remind.skip=e.target.checked});
  q('#fPresetAdd').addEventListener('click',addPreset);
  q('#fPresetIn').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addPreset()}});
  q('#fAnchor').addEventListener('input',drawAnchors);
  q('#fUnit').addEventListener('input',drawPresets);
  q('#fAnchor').value=x&&x.anchor?x.anchor:'';
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
  drawType();drawIcons();drawSched();drawNum();drawPresets();drawAnchors();drawRem();
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
    const anchor=Core.normalizeAnchor(q('#fAnchor').value),presets=st.type==='count'||st.type==='duration'?Core.normalizePresets(st.presets):null;
    const remind=st.type==='steps'?null:Core.normalizeRemind({times:st.remind.times,skipIfDone:st.remind.skip});
    const extras=t=>{
      if(anchor)t.anchor=anchor;else delete t.anchor;
      if(presets)t.presets=presets;else delete t.presets;
      if(remind)t.remind=remind;else delete t.remind;
    };
    if(x){
      // look the habit up again: a cloud sync while this sheet was open may have replaced the settings (or removed the habit)
      let t=settings.habits.find(z=>z.id===x.id);
      if(!t){settings.habits.push(x);t=x}
      t.name=name;t.icon=st.icon;t.section=secId;t.schedule=sched;
      if(needNum){t.target=target;if(t.type!=='steps')t.unit=q('#fUnit').value.trim()||t.unit}
      if(st.show)delete t.hidden;else t.hidden=true;
      extras(t);
      persistSettings('Habit updated').then(()=>reminderPermissionFor(remind));
    }else{
      const unit=q('#fUnit').value.trim()||(st.type==='duration'?'min':st.type==='count'?'times':'');
      const nh={id:slug(name),name,icon:st.icon,type:st.type,unit,target:st.type==='yesno'?1:target,section:secId,schedule:sched};
      if(!st.show)nh.hidden=true;
      extras(nh);
      settings.habits.push(nh);
      persistSettings('Added '+name).then(()=>reminderPermissionFor(remind));
    }
  }});
  if(!isNew)q('#fRemove').addEventListener('click',()=>{sh.close('cancel');removeHabit(x)});
  return sh;
}
