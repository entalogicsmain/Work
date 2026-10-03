/* The version shown in Settings > About. Keep it equal to "version" in package.json (test:structure checks that). */
const APP_VERSION='1.0.0';
/* Start-up. Everything it calls is defined in the other scripts, which are all loaded before this one. */
$('dayLabel').addEventListener('click',dateSheet);
(async function(){
  hydrate();
  current=todayStr();lastToday=current;
  bindLogic();
  renderToday();renderSetup();showTab('today');
  initNativeGlue();
  try{
    const all=await store.load();
    if(all.data){settings=all.data.settings;days=all.data.days}
    // height used to be a step setting on this phone; it is now part of the synced settings and the BMI height
    // data saved by an older version is moved to the new structure once, and saved in it right away (nothing is removed)
    const adopted=adoptDeviceHeight();
    if(adopted||all.upgraded){try{await store.persist()}catch(e){}}
    if(all.migrated)setMsg('bkMsg','Moved '+all.migrated+' saved '+(all.migrated===1?'day':'days')+' from the old browser storage.');
  }catch(e){dataLocked=true;loadProblem="Couldn't read your saved entries: "+errText(e)}
  refreshAll();
  showLoadNotice();
  initReminder();
  initSync();
  initSteps();
  if(window.Photos)Photos.init();      // monthly prompt state and the once-a-day clean-up of unused photo files
  try{
    if(await prefGet(ONB_KEY)==null){
      if(Object.keys(days).length){await prefSet(ONB_KEY,'1');await maybeShowPermissionSetup()}else showOnboarding({mode:'full'});
    }else await maybeShowPermissionSetup();
  }catch(e){}
})();
