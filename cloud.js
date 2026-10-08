/* Family nickname synchronization through anonymous Firebase authentication. Learning remains usable if the SDK is unavailable. */
(() => {
  'use strict';
  const firebaseConfig = {
    apiKey: 'AIzaSyAxQFt76ZPXE7d0i1XeNZ1yiiD2WYNIfHs',
    authDomain: 'chinese-learning-47f4d.firebaseapp.com',
    projectId: 'chinese-learning-47f4d',
    storageBucket: 'chinese-learning-47f4d.firebasestorage.app',
    messagingSenderId: '76289812052',
    appId: '1:76289812052:web:898384a916f9f341f62fc1'
  };
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'forest-app-default';
  const COLLECTION_NAME = 'Chinese5-exam1';
  const clone = x => JSON.parse(JSON.stringify(x));
  let sdk, auth, firestore, owner = null, record = null, ready = false, busy = false;
  let epoch = 0, sequence = 0, timer, initPromise, conflict = null, applying = false;
  let state = {kind:'loading', title:'正在連接家庭雲端', detail:'只要選擇名字，就能接續學習。'};
  const familyKey=`${KEY}:family:${appId}:${COLLECTION_NAME}`;
  let names=[], selecting=false;
  try{names=JSON.parse(localStorage.getItem(familyKey+':names')||'[]');if(!Array.isArray(names))names=[];}catch{}
  const profileId=name=>'name_'+Array.from(new TextEncoder().encode(name),b=>b.toString(16).padStart(2,'0')).join('');
  const validName=name=>typeof name==='string'&&name.trim().length>0&&name.length<=30;
  function localBooks(){try{return JSON.parse(localStorage.getItem(KEY)||'null')?.users||[];}catch{return [];}}
  function roster(){const all=[...new Set([...names.filter(validName),...localBooks().map(u=>u.name)])];const icons=['🌻','🐼','🐰','🦊','🐱','🐨','🦁','🐸'];return all.map((name,i)=>`<button class="child-icon ${owner?.name===name?'active':''}" data-child="${esc(name)}"><span aria-hidden="true">${icons[i%icons.length]}</span><strong>${esc(name)}</strong><small>${owner?.name===name?'正在學習 ✨':'點我接續 →'}</small></button>`).join('')||'<p class="muted">第一位小園丁，來種下你的名字吧！🌱</p>'; }
  function remember(name){if(!names.includes(name))names.push(name);try{localStorage.setItem(familyKey+':names',JSON.stringify(names));}catch{}}
  const cacheKey = uid => `${KEY}:cloud:${appId}:${COLLECTION_NAME}:${uid}`;
  const empty = () => ({version:1,current:null,users:[]});
  function validateDb(value) {
    const x=clone(value);
    if(x?.version!==1||!Array.isArray(x.users)||x.users.length>100)throw Error('雲端帳本格式不符');
    x.users=x.users.map(u=>validateBackup({format:'chinese-garden-backup',version:1,dataVersion:DATA.version,user:u}));
    if(new Set(x.users.map(u=>u.name)).size!==x.users.length||(x.current!==null&&!x.users.some(u=>u.name===x.current)))throw Error('雲端姓名資料有誤');
    return x;
  }
  function validateDoc(x){
    if(x?.schema!==1||x.dataVersion!==DATA.version||!Number.isInteger(x.revision)||x.revision<1)throw Error('雲端資料版本不符，請先更新網站');
    const payload=validateDb(x.payload);
    if(x.mode!=='familyName'||!validName(x.displayName)||payload.users.length!==1||payload.current!==x.displayName||payload.users[0].name!==x.displayName)throw Error('姓名帳本格式不符');
    return {...x,payload};
  }
  function status(kind,title,detail='') {state={kind,title,detail}; paint();}
  function paint(){
    const el=document.querySelector('#cloudStatus');if(!el)return;
    el.dataset.state=state.kind;
    el.querySelector('[data-cloud-title]').textContent=state.title;
    el.querySelector('[data-cloud-detail]').textContent=state.detail;
    el.querySelector('[data-cloud-account]').textContent=owner?`☁️ ${owner.name} 的學習進度`:'☁️ 家庭共用小花園';
    el.querySelector('[data-cloud="open"]').hidden=!!owner;
    for(const a of ['sync','out'])el.querySelector(`[data-cloud="${a}"]`).hidden=!owner;
    for(const a of ['remote','local'])el.querySelector(`[data-cloud="${a}"]`).hidden=!conflict;
    el.querySelector('[data-cloud="sync"]').disabled=busy;
    const kids=document.querySelector('#familyNames');if(kids)kids.innerHTML=roster();
  }
  function panel(){return `<section id="cloudStatus" class="cloud-panel" aria-label="雲端連線狀態"><div class="cloud-status-text" role="status" aria-live="polite"><span class="cloud-lamp" aria-hidden="true"></span><div><small data-cloud-account></small><h2 data-cloud-title></h2><p data-cloud-detail></p></div></div><div class="actions"><button class="primary" data-cloud="open">🌱 新增使用者</button><button data-cloud="sync" hidden>🔄 立即同步</button><button data-cloud="out" hidden>切換小園丁</button><button data-cloud="remote" hidden>接續雲端版本</button><button data-cloud="local" hidden>改用本機版本</button></div></section><section class="family-card"><div class="section-head"><h2>今天是哪位小園丁？🌼</h2><button data-cloud="open">＋ 新增名字</button></div><p class="muted">點自己的圖示，接著上次的進度繼續學習。</p><div id="familyNames" class="family-names">${roster()}</div></section>`;}
  function saveCache(){
    try{localStorage.setItem(cacheKey(owner.uid),JSON.stringify(record));return true;}
    catch(e){status('error','本機備份空間不足','請立即匯出進度。雲端同步仍會嘗試進行。');return false;}
  }
  function activate(payload,key){
    applying=true;db=validateDb(payload);activeKey=key;persist();updateUser();render();applying=false;
  }
  function changed(){
    if(applying||!owner||!record)return;
    if(JSON.stringify(db)===JSON.stringify(record.payload))return;
    record.payload=clone(db);record.dirty=true;sequence++;saveCache();
    if(conflict){status('conflict','兩台裝置有不同進度','本機進度已保留。請選擇要接續的版本。');return;}
    status(navigator.onLine?'pending':'offline',navigator.onLine?'進度已保存，等待同步':'離線・進度等待同步','恢復網路後自動重試，切換裝置前請確認綠燈。');
    clearTimeout(timer);timer=setTimeout(sync,1200);
  }
  function friendly(e){
    const map={'auth/operation-not-allowed':'Firebase 尚未啟用匿名登入，請家長依設定說明開啟 Anonymous。','auth/admin-restricted-operation':'Firebase 尚未允許匿名登入，請家長啟用 Anonymous。','auth/network-request-failed':'網路連線失敗，請檢查網路後重試。','auth/too-many-requests':'嘗試次數過多，請稍後再試。','auth/unauthorized-domain':'此網站網域尚未加入 Firebase 授權網域。','permission-denied':'雲端存取規則尚未設定為家庭姓名模式，請家長套用新版規則。','unavailable':'暫時無法連上 Firestore，進度已保留在本機。'};
    return map[e.code]||e.message||'連線失敗，請稍後重試。';
  }
  async function sync(){
    if(!owner||busy||conflict)return;
    if(!ready){try{await init();}catch{return;}if(!owner)return;}
    if(!navigator.onLine){status('offline','離線・等待重新連線','本機進度已保留；重新連線後自動同步。');return;}
    busy=true;const generation=epoch, uid=owner.uid, rev=record.revision, serial=sequence, payload=clone(record.payload), dirty=record.dirty;
    status('loading','雲端同步中','正在確認與儲存最新進度…');
    const ref=sdk.doc(firestore,'artifacts',String(appId),COLLECTION_NAME,uid);
    try{
      if(dirty){
        // A transaction rejects stale device snapshots instead of silently erasing another device's answers.
        await sdk.runTransaction(firestore,async tx=>{
          const snap=await tx.get(ref), remote=snap.exists()?validateDoc(snap.data()):null;
          if((remote?.revision||0)!==rev){const e=Error('其他裝置已更新進度');e.remote=remote;e.conflict=true;throw e;}
          const doc={mode:'familyName',displayName:payload.current,schema:1,dataVersion:DATA.version,revision:rev+1,payload,updatedAt:sdk.serverTimestamp()};
          if(new TextEncoder().encode(JSON.stringify(doc)).length>800000)throw Error('帳本接近雲端容量上限，請匯出備份後精簡紀錄。');
          tx.set(ref,doc);
        });
        if(generation!==epoch)return;
        record.revision=rev+1;record.dirty=sequence!==serial;record.lastSync=new Date().toISOString();saveCache();
      }else{
        const snap=await sdk.getDocFromServer(ref);if(generation!==epoch)return;
        const remote=snap.exists()?validateDoc(snap.data()):null;
        if(sequence!==serial){setTimeout(sync,100);return;}
        if(remote&&remote.revision!==record.revision){
          // An active attempt is never replaced while the student is answering.
          if(user()?.session&&!user().session.paused&&!user().session.done){conflict={remote};status('conflict','另一台裝置更新了進度','請先暫停測驗，再選擇要保留的版本。');return;}
          record.payload=remote.payload;record.revision=remote.revision;activate(record.payload,cacheKey(uid)+':book');
        }else if(!remote&&record.revision!==0){throw Error('雲端帳本已移除；本機備份保留，請聯絡管理者。');}
        if(!remote){record.dirty=true;setTimeout(sync,100);}
        record.lastSync=new Date().toISOString();saveCache();
      }
      if(record.dirty){status('pending','仍有進度等待同步','正在接續儲存最新作答。');setTimeout(sync,100);}
      else status('synced','雲端已同步',`最近確認：${new Date(record.lastSync).toLocaleTimeString('zh-TW')}。其他裝置點選相同名字即可接續。`);
    }catch(e){if(generation!==epoch)return;
      if(e.conflict){conflict={remote:e.remote};status('conflict','兩台裝置有不同進度','本機進度已保留。請選擇要接續的版本，避免互相覆蓋。');}
      else status(navigator.onLine?'error':'offline',navigator.onLine?'雲端連線失敗':'離線・等待同步',friendly(e));
    }finally{if(generation===epoch){busy=false;paint();}}
  }
  async function select(raw){
    const name=String(raw||'').trim().normalize('NFC');if(!validName(name)){toast('請輸入 1～30 個字的名稱');return;}
    if(selecting)return;selecting=true;
    try{
      pause(false);if(owner?.name===name){navigate('home');$('#login').close();await sync();return;}
      if(busy){toast('正在儲存目前進度，請稍後再切換名字。');return;}
      ++epoch;clearTimeout(timer);conflict=null;sequence=0;
      const id=profileId(name),legacy=localBooks().find(u=>u.name===name);
      let saved=JSON.parse(localStorage.getItem(cacheKey(id))||'null');
      if(saved){saved.payload=validateDb(saved.payload);if(!Number.isInteger(saved.revision)||saved.revision<0)throw Error('本機備份版本有誤，請先匯出備份。');}
      owner={uid:id,name};record=saved||{payload:{version:1,current:name,users:[legacy?clone(legacy):fresh(name)]},revision:0,dirty:!!legacy,lastSync:null};
      remember(name);try{localStorage.setItem(familyKey+':selected',name);}catch{}
      activate(record.payload,cacheKey(id)+':book');saveCache();$('#login').close();navigate('home');
      toast('歡迎，'+name+'！🌼');await sync();
    }catch(e){status('error','暫時無法開啟帳本',friendly(e));}
    finally{selecting=false;}
  }
  async function refreshNames(){
    if(!ready||!navigator.onLine)return;
    const snapshot=await sdk.getDocs(sdk.query(sdk.collection(firestore,'artifacts',String(appId),COLLECTION_NAME),sdk.where('mode','==','familyName')));
    for(const doc of snapshot.docs){const name=doc.data().displayName;if(validName(name)&&doc.id===profileId(name))remember(name);}
    paint();
  }
  function leave(){
    pause(false);if(busy){toast('正在同步，請稍後再切換。');return;}
    ++epoch;clearTimeout(timer);owner=null;record=null;conflict=null;sequence=0;
    try{localStorage.removeItem(familyKey+':selected');}catch{}
    activate({version:1,current:null,users:localBooks()},KEY);navigate('home');
    status(ready?'connected':'error',ready?'請選擇小園丁':'雲端尚未連線','點名字圖示即可登入；每個名字各有一份進度。');
  }
  async function init(){
    if(initPromise)return initPromise;
    initPromise=(async()=>{
      if(location.protocol==='file:')throw Error('請透過 http://localhost 或正式 HTTPS 網址開啟網站，才能使用雲端登入。本機複習仍可使用。');
      const base='https://www.gstatic.com/firebasejs/13.0.0/';
      const [app,au,fs]=await Promise.all([import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-firestore.js')]);
      sdk={...au,...fs};const firebase=app.initializeApp(firebaseConfig);auth=au.getAuth(firebase);firestore=fs.getFirestore(firebase);
      await au.setPersistence(auth,au.browserLocalPersistence);
      const account=await new Promise((resolve,reject)=>{const off=au.onAuthStateChanged(auth,u=>{off();resolve(u);},reject);});
      if(!account)await au.signInAnonymously(auth);
      ready=true;await refreshNames();
      if(!owner)status('connected','家庭雲端已連線・請選擇名字','點名字圖示登入，或新增一位小園丁。');
    })().catch(e=>{initPromise=null;ready=false;status('error','雲端尚未連線',friendly(e));throw e;});return initPromise;
  }
  async function resolve(useLocal){
    if(!conflict||busy)return;pause(false);
    const remote=conflict.remote;
    // Keep the overwritten local snapshot as a recoverable file export in this browser.
    try{localStorage.setItem(cacheKey(owner.uid)+':conflict-backup',JSON.stringify(record));}
    catch{toast('無法保存衝突備份，請先匯出進度再處理。');return;}
    if(useLocal){record.revision=remote?.revision||0;record.dirty=true;}
    else{record={payload:remote?.payload||empty(),revision:remote?.revision||0,dirty:false,lastSync:null};activate(record.payload,cacheKey(owner.uid)+':book');}
    conflict=null;sequence++;saveCache();await sync();
  }
  window.GardenCloud={panel,paint,changed,validateDb,select,leave};
  document.addEventListener('click',async e=>{
    const child=e.target.closest('[data-child]');if(child){await select(child.dataset.child);return;}
    const action=e.target.closest('[data-cloud]')?.dataset.cloud;if(!action)return;
    try{
      if(action==='open'){openLogin();return;}
            if(action==='sync'){await sync();return;}
      if(action==='out'){leave();return;}
      if(action==='remote'||action==='local'){confirmAction('選擇這份進度？',action==='local'?'將以本機進度取代目前雲端版本。':'將載入雲端版本。本機衝突版本會另外保存在此瀏覽器。',()=>resolve(action==='local'));return;}
      if(action==='recover'){
        if(!owner)throw Error('請先點選一個名字');const x=JSON.parse(localStorage.getItem(cacheKey(owner.uid)+':conflict-backup')||'null');
        if(!x)throw Error('目前沒有衝突備份');
        const u=x.payload.users.find(u=>u.name===x.payload.current)||x.payload.users[0];if(!u)throw Error('衝突備份中沒有姓名帳本');
        const backup={format:'chinese-garden-backup',version:1,dataVersion:DATA.version,user:u};
        const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='雲端衝突帳本備份.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);toast('已匯出衝突時 '+u.name+' 的帳本，可由「匯入進度」還原。');return;
      }
    }catch(err){toast(friendly(err));}
  });
  window.addEventListener('online',async()=>{try{await init();await refreshNames();if(owner)await sync();}catch{}});
  window.addEventListener('offline',()=>status('offline','離線・本機保存中','恢復網路後自動重試；請等到綠燈再切換裝置。'));
  setInterval(()=>{if(!document.hidden){sync();if(ready)refreshNames().catch(e=>{if(!owner)status('error','名字清單暫時無法更新',friendly(e));});}},20000);
  render();
  let last;try{last=localStorage.getItem(familyKey+':selected');}catch{}
  if(last)select(last);else init().catch(()=>{});
})();
