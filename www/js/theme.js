/* Theme: System (default), Light or Dark. Loaded in the <head>, before the first paint, so the right colours show straight away.
   The choice lives on this phone only (Preferences key comeback_theme, never synced). Reading Preferences is async, so the last choice is also
   cached in localStorage (comeback_theme_cache, in a try/catch because storage can be blocked) and applied synchronously from there.
   The page then stays in step with Preferences. The colours themselves are in css/app.css: light is the default, dark sits under
   @media (prefers-color-scheme:dark) guarded by :not([data-theme="light"]) and again under [data-theme="dark"].
   data-theme on <html> is "light", "dark" or absent (System). Every change fires a 'comeback-theme' event on window (charts and the status bar listen). */
(function(){
  'use strict';
  var KEY='comeback_theme', CACHE='comeback_theme_cache';
  var CHOICES=['system','light','dark'];
  var root=document.documentElement;
  var choice='system';
  var mq=null;
  try{mq=window.matchMedia('(prefers-color-scheme: dark)')}catch(e){}

  function clean(v){return CHOICES.indexOf(v)>=0?v:'system'}
  function systemDark(){try{return !!(mq&&mq.matches)}catch(e){return false}}
  /** Is the screen dark right now? (the choice, or the phone's setting when the choice is System) */
  function isDark(){
    var t=root.getAttribute('data-theme');
    if(t==='dark')return true;
    if(t==='light')return false;
    return systemDark();
  }
  function announce(){
    try{window.dispatchEvent(new CustomEvent('comeback-theme',{detail:{choice:choice,dark:isDark()}}))}catch(e){}
  }
  function apply(c,quiet){
    choice=clean(c);
    if(choice==='system')root.removeAttribute('data-theme');else root.setAttribute('data-theme',choice);
    if(!quiet)announce();
  }
  function cache(c){try{localStorage.setItem(CACHE,c)}catch(e){}}
  function cached(){try{return localStorage.getItem(CACHE)}catch(e){return null}}

  // 1. synchronously, from the cache, before the first paint
  var c0=cached();
  if(c0)apply(c0,true);

  // 2. the phone's own dark mode changed: only matters while the choice is System
  try{
    var onSys=function(){if(choice==='system')announce()};
    if(mq){if(mq.addEventListener)mq.addEventListener('change',onSys);else if(mq.addListener)mq.addListener(onSys)}
  }catch(e){}

  /** Picks a theme: applies it now and remembers it on this phone. */
  function setTheme(c){
    var next=clean(c);
    cache(next);
    apply(next);
    try{if(typeof prefSet==='function')return Promise.resolve(prefSet(KEY,next)).catch(function(){})}catch(e){}
    return Promise.resolve();
  }
  /** Reads the stored choice (Preferences is the source of truth) and applies it when it differs from what the cache gave. */
  function loadTheme(){
    try{
      if(typeof prefGet!=='function')return Promise.resolve(choice);
      return Promise.resolve(prefGet(KEY)).then(function(v){
        if(v==null)return choice;   // never chosen: keep what the cache (or System) gave
        var next=clean(v);cache(next);
        if(next!==choice)apply(next);
        return next;
      }).catch(function(){return choice});
    }catch(e){return Promise.resolve(choice)}
  }

  window.isDark=isDark;
  window.Theme={KEY:KEY,CACHE:CACHE,CHOICES:CHOICES,get:function(){return choice},set:setTheme,load:loadTheme,isDark:isDark,apply:apply};
  // once the page has loaded all its scripts (prefGet exists by then), reconcile with Preferences
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){loadTheme()});
  else loadTheme();
})();
