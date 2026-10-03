/* App lock (Android app only, off by default). Settings > Security > "Lock Comeback".

   Android's BiometricPrompt (the AppLock plugin in android/.../lock) checks who is holding the phone: fingerprint, face, or the phone's own PIN,
   pattern or password when there is no sensor. This file decides WHEN to ask:
   - at app start (always) and when the app comes back after the "Lock after" time (Immediately, 1 minute or 5 minutes);
   - the lock screen is a full-screen dialog, everything behind it is inert, and the Unlock button asks again;
   - while the lock is on the window is marked secure (FLAG_SECURE), so recents and screenshots show nothing.
   It never traps anyone: the lock cannot be turned on unless the phone can check it (and the person passes the check once), and if the phone
   later loses its screen lock the lock screen offers to turn the lock off.

   State is on this phone only: Preferences keys comeback_lock ('1'), comeback_lock_delay ('0'|'1'|'5' minutes) and comeback_last_active
   (ms since 1970, written when the app goes to the background). None of it is in the synced settings or in a backup.
   comeback_lock_cache in localStorage lets the lock screen go up before Preferences has been read, so nothing flashes.
   In a plain browser there is no AppLock plugin, so the Security group is hidden and nothing here runs.
   The pure delay rule has a twin in LockPolicy.kt; both are tested with the same table. */
(function(){
  'use strict';
  var K_LOCK='comeback_lock', K_DELAY='comeback_lock_delay', K_ACTIVE='comeback_last_active', K_CACHE='comeback_lock_cache';
  var DELAYS=[{v:'0',label:'Immediately'},{v:'1',label:'1 minute'},{v:'5',label:'5 minutes'}];
  var DEFAULT_DELAY='1';

  /* ---------- the pure rules ---------- */
  function delayMinutes(raw){var n=parseInt(String(raw==null?'':raw).trim(),10);return (n===0||n===1||n===5)?n:1}
  function delayMs(raw){return delayMinutes(raw)*60000}
  /** Should the lock screen show when the app comes back? Lock off: never. Never recorded or the clock went back: yes. Else when away for at least the delay (0 = always). */
  function shouldLock(enabled,lastActive,now,delay){
    if(!enabled)return false;
    if(lastActive==null||!(lastActive>0))return true;
    if(now<lastActive)return true;
    return now-lastActive>=delay;
  }

  /* ---------- state ---------- */
  var native=function(){return (typeof Native!=='undefined'&&Native&&Native.isNative&&Native.AppLock)?Native.AppLock:null};
  var enabled=false, delay=DEFAULT_DELAY, lastActive=null;
  var locked=false, authBusy=false, graceUntil=0, suspendToken=0, suspended=false;
  var overlay=null, prompted=false;
  var booted=false;

  function supported(){return !!native()}
  function now(){return Date.now()}
  function put(k,v){try{return Promise.resolve(prefSet(k,v)).catch(function(){})}catch(e){return Promise.resolve()}}
  function cacheOn(on){try{if(on)localStorage.setItem(K_CACHE,'1');else localStorage.removeItem(K_CACHE)}catch(e){}}
  function cachedOn(){try{return localStorage.getItem(K_CACHE)==='1'}catch(e){return false}}
  function secure(on){var P=native();if(P)try{P.setSecure({enabled:!!on}).catch(function(){})}catch(e){}}

  /* ---------- the lock screen ---------- */
  var BG_EXTRA=['#layer','.onb'];
  function inertExtras(on){
    BG_EXTRA.forEach(function(sel){document.querySelectorAll(sel).forEach(function(e){if(on)e.setAttribute('inert','');else e.removeAttribute('inert')})});
  }
  function build(){
    var el=document.createElement('div');
    el.className='lockscreen';el.id='lockScreen';
    el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','lockTitle');el.setAttribute('aria-describedby','lockMsg');
    el.innerHTML='<div class="lock-card"><span class="lock-ic" aria-hidden="true"><svg data-ic="lock"></svg></span>'+
      '<h1 id="lockTitle">Comeback is locked</h1>'+
      '<p id="lockMsg" role="status" aria-live="polite"></p>'+
      '<button type="button" class="btn" id="lockUnlock">Unlock</button>'+
      '<button type="button" class="btn secondary" id="lockOff" hidden>Turn off the lock</button></div>';
    if(typeof hydrate==='function')hydrate(el);
    el.querySelector('#lockUnlock').addEventListener('click',function(){unlock()});
    el.querySelector('#lockOff').addEventListener('click',function(){turnOffFromLockScreen()});
    // focus trap: Tab cycles between the visible buttons (everything else is inert as well)
    el.addEventListener('keydown',function(e){
      if(e.key!=='Tab')return;
      var bs=[].slice.call(el.querySelectorAll('button')).filter(function(b){return !b.hidden&&!b.disabled});
      if(!bs.length)return;
      var i=bs.indexOf(document.activeElement);
      if(e.shiftKey){if(i<=0){e.preventDefault();bs[bs.length-1].focus()}}
      else if(i===-1||i===bs.length-1){e.preventDefault();bs[0].focus()}
    });
    return el;
  }
  function say(text){if(overlay){var m=overlay.querySelector('#lockMsg');if(m.textContent!==text)m.textContent=text}}
  var MSG_IDLE='Use your fingerprint, face or screen lock to open it.';
  function show(autoPrompt){
    if(!supported()||!enabled&&!cachedOn())return;
    if(!overlay){overlay=build();document.body.appendChild(overlay)}
    if(!locked){
      locked=true;prompted=false;
      try{if(typeof closeAllLayers==='function')closeAllLayers()}catch(e){}
      try{if(typeof lockBackground==='function')lockBackground()}catch(e){}   // #screens, the bars (a counter: sheets closing cannot undo it)
      inertExtras(true);
      overlay.hidden=false;
      overlay.querySelector('#lockOff').hidden=true;
      say(MSG_IDLE);
      var u=overlay.querySelector('#lockUnlock');u.disabled=false;
      try{u.focus({preventScroll:true})}catch(e){}
    }
    if(autoPrompt)setTimeout(function(){if(locked)unlock()},250);
  }
  function hide(){
    if(!overlay||!locked)return;
    locked=false;
    overlay.hidden=true;
    try{if(typeof unlockBackground==='function')unlockBackground()}catch(e){}
    inertExtras(false);
    // put focus back on something real behind the lock screen
    try{var g=document.getElementById('gearBtn')||document.querySelector('.tab');if(g&&g.focus)g.focus({preventScroll:true})}catch(e){}
  }

  /* ---------- asking Android ---------- */
  function availability(){
    var P=native();if(!P)return Promise.resolve({available:false,reason:'unsupported'});
    return Promise.resolve().then(function(){return P.isAvailable()}).then(function(r){return r||{available:false,reason:'unknown'}}).catch(function(){return {available:false,reason:'unknown'}});
  }
  /** Runs one BiometricPrompt. The app may pause while the phone's own screen-lock page is up (Android 9 and 10), so app-state changes are ignored meanwhile. */
  function ask(title,subtitle){
    var P=native();if(!P)return Promise.resolve({ok:false,error:'unavailable'});
    if(authBusy)return Promise.resolve({ok:false,error:'busy'});
    authBusy=true;
    return Promise.resolve().then(function(){return P.authenticate({title:title,subtitle:subtitle})}).catch(function(){return {ok:false,error:'failed'}}).then(function(r){
      authBusy=false;graceUntil=now()+1500;
      return r||{ok:false,error:'failed'};
    });
  }
  function unlock(){
    if(!locked||authBusy)return Promise.resolve();
    var u=overlay.querySelector('#lockUnlock');
    say('Waiting for your phone…');
    return ask('Unlock Comeback','Use your fingerprint, face or screen lock').then(function(r){
      if(r.ok){lastActive=now();put(K_ACTIVE,String(lastActive));hide();return}
      if(r.error==='busy')return;
      if(r.error==='lockout'){say('Too many tries. Wait a moment, then tap Unlock.');return}
      if(r.error==='canceled'){say('Comeback is locked. Tap Unlock when you are ready.');return}
      if(r.error==='unavailable'){
        return availability().then(function(a){
          if(a.available){say('That did not work. Tap Unlock to try again.');return}
          if(a.reason==='none_enrolled'||a.reason==='no_hardware'||a.reason==='unsupported'){
            say('Your phone no longer has a screen lock, so Comeback cannot check it is you. You can turn the lock off here, and switch it on again any time.');
            overlay.querySelector('#lockOff').hidden=false;
          }else say('Your phone is not ready to check just now. Wait a moment, then tap Unlock.');
        });
      }
      say('That did not work. Tap Unlock to try again.');
    }).then(function(){try{if(locked&&!u.disabled&&overlay&&!overlay.contains(document.activeElement))u.focus({preventScroll:true})}catch(e){}});
  }
  /** Only reachable when the phone says it cannot check anybody (no screen lock set), so there is nothing left to verify. */
  function turnOffFromLockScreen(){
    return availability().then(function(a){
      if(a.available){say('Your phone can check it is you again. Tap Unlock.');overlay.querySelector('#lockOff').hidden=true;return}
      return switchOff().then(function(){hide();if(typeof toast==='function')toast('Lock turned off',{icon:'lock'})});
    });
  }
  function switchOff(){
    enabled=false;cacheOn(false);secure(false);
    return Promise.all([put(K_LOCK,'0')]);
  }

  /* ---------- settings ---------- */
  var OFF_REASON={
    none_enrolled:'Set up a screen lock (a PIN, pattern or password) in your phone\'s settings first, then try again.',
    no_hardware:'This phone cannot check it is you, so the lock cannot be turned on.',
    unsupported:'This phone cannot check it is you, so the lock cannot be turned on.',
    hw_unavailable:'The fingerprint or face sensor is busy right now. Try again in a moment.',
    update_required:'This phone needs a security update before the lock can be used.'
  };
  /** Turns the lock on or off. Resolves {ok, message}. On: only if the phone can check, and only after the person passes the check once (so they cannot lock themselves out). Off: after one more check, unless the phone cannot check at all. */
  function set(on){
    if(!supported())return Promise.resolve({ok:false,message:'The lock is only in the Android app.'});
    if(on===enabled)return Promise.resolve({ok:true});
    return availability().then(function(a){
      if(on){
        if(!a.available)return {ok:false,message:OFF_REASON[a.reason]||'The lock cannot be turned on right now.'};
        return ask('Turn on Comeback lock','Confirm it is you').then(function(r){
          if(!r.ok)return {ok:false,message:r.error==='canceled'?'Lock not turned on.':'That did not work, so the lock was not turned on.'};
          enabled=true;lastActive=now();cacheOn(true);secure(true);
          return Promise.all([put(K_LOCK,'1'),put(K_DELAY,delay),put(K_ACTIVE,String(lastActive))]).then(function(){return {ok:true,message:'Comeback lock is on'}});
        });
      }
      var done=function(){return switchOff().then(function(){return {ok:true,message:'Comeback lock is off'}})};
      if(!a.available)return done();   // nothing to check with: do not trap anyone
      return ask('Turn off Comeback lock','Confirm it is you').then(function(r){
        if(!r.ok)return {ok:false,message:'Lock left on.'};
        return done();
      });
    });
  }
  function setDelay(v){
    var d=String(delayMinutes(v));delay=d;return put(K_DELAY,d);
  }

  /* ---------- app state ---------- */
  /** Flows that send the person to another screen and back (share sheet, permission dialogs, file picker) call this first, so coming back from them is not treated as leaving. Returns a function that ends the pause. */
  function suspend(){
    if(!enabled)return function(){};
    suspended=true;var t=++suspendToken;
    return function(){if(t===suspendToken)suspended=false};
  }
  function onState(isActive){
    if(!enabled)return;
    var t=now();
    if(authBusy||t<graceUntil)return;
    if(!isActive){
      if(suspended)return;
      if(locked)return;
      lastActive=t;put(K_ACTIVE,String(t));
      if(delayMinutes(delay)===0)show(false);   // already up when the app is opened again
      return;
    }
    if(suspended){suspended=false;lastActive=t;put(K_ACTIVE,String(t));return}
    if(locked){setTimeout(function(){if(locked&&!authBusy)unlock()},150);return}
    if(shouldLock(true,lastActive,t,delayMs(delay)))show(true);
  }

  /** Wraps the plugin calls that open another screen so that coming back from them does not lock. */
  function guard(name,methods){
    try{
      var orig=Native[name];if(!orig)return;
      var over={};
      methods.forEach(function(m){over[m]=function(){
        var end=suspend(),p;
        try{p=orig[m].apply(orig,arguments)}catch(e){end();throw e}
        Promise.resolve(p).then(function(){setTimeout(end,800)},function(){setTimeout(end,800)});
        return p;
      }});
      Native[name]=new Proxy(orig,{get:function(t,k){return Object.prototype.hasOwnProperty.call(over,k)?over[k]:t[k]}});
    }catch(e){}
  }

  function boot(){
    if(booted||!supported())return;
    booted=true;
    if(cachedOn()){enabled=true;show(false)}   // before Preferences is read: nothing shows behind the lock
    guard('Share',['share']);
    guard('LocalNotifications',['requestPermissions']);
    guard('Steps',['requestActivityPermission','requestLocationPermission','requestIgnoreBatteryOptimizations','openSettings']);
    document.addEventListener('click',function(e){var t=e.target;if(t&&t.matches&&t.matches('input[type=file]')){var end=suspend();setTimeout(end,120000)}},true);
    try{Native.App.addListener('appStateChange',function(s){onState(!!s.isActive)})}catch(e){}
    Promise.all([prefGet(K_LOCK),prefGet(K_DELAY),prefGet(K_ACTIVE)]).then(function(v){
      enabled=v[0]==='1';delay=String(delayMinutes(v[1]));
      var la=parseInt(v[2],10);lastActive=isFinite(la)?la:null;
      cacheOn(enabled);
      if(enabled){secure(true);show(true)}
      else{secure(false);hide()}
      if(typeof renderSecurity==='function'&&typeof activeTab!=='undefined'&&activeTab==='settings')renderSecurity();
    }).catch(function(){
      // Preferences could not be read: keep whatever the cache said rather than opening an app that may be meant to be locked
      if(enabled)show(true);
    });
  }

  window.Lock={K_LOCK:K_LOCK,K_DELAY:K_DELAY,K_ACTIVE:K_ACTIVE,K_CACHE:K_CACHE,DELAYS:DELAYS,
    delayMinutes:delayMinutes,delayMs:delayMs,shouldLock:shouldLock,
    supported:supported,enabled:function(){return enabled},delay:function(){return delay},isLocked:function(){return locked},
    set:set,setDelay:setDelay,suspend:suspend,availability:availability,unlock:unlock,boot:boot};
  window.lockIsLocked=function(){return locked};

  /* ---------- Settings > Security (the markup is in index.html; shown only in the Android app) ---------- */
  window.renderSecurity=function(){
    var head=document.getElementById('secHead'),g=document.getElementById('secGroup'),foot=document.getElementById('secFoot');
    if(!head||!g||!foot)return;
    var show=supported();
    head.hidden=!show;g.hidden=!show;foot.hidden=!show;
    if(!show)return;
    g.innerHTML='';
    g.appendChild(switchRow({id:'lockRow',boxId:'lockOn',icon:'lock',label:'Lock Comeback',sub:'Ask for your fingerprint, face or screen lock to open the app',on:enabled,onChange:function(on,box){
      box.disabled=true;
      set(on).then(function(r){
        box.disabled=false;
        if(r.message&&typeof toast==='function')toast(r.message,{icon:'lock'});
        if(!r.ok&&r.message)setSecMsg(r.message);else setSecMsg('');
        renderSecurity();
      });
    }}));
    if(enabled)g.appendChild(segRow({id:'lockDelayRow',icon:'clock',label:'Lock after',value:delay,options:DELAYS.map(function(d){return {value:d.v,label:d.label,id:'lk'+d.v}}),onPick:function(v){setDelay(v).then(function(){renderSecurity()})}}));
    var m=document.getElementById('secMsg');
    if(!m){m=document.createElement('div');m.id='secMsg';m.className='group-foot';m.setAttribute('role','status');m.setAttribute('aria-live','polite');m.hidden=true;foot.parentNode.insertBefore(m,foot)}
  };
  function setSecMsg(t){
    var m=document.getElementById('secMsg');if(!m)return;
    m.textContent=t||'';m.hidden=!t;
  }

  boot();
})();
