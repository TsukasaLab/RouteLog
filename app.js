(() => {
const SAMPLE = window.ROUTELOG_SAMPLE;
const LS = {
  trips:"routelog.trips.v004",
  categories:"routelog.categories.v004",
  tags:"routelog.tags.v004",
  settings:"routelog.settings.v004",
  cloud:"routelog.cloud.v004",
  active:"routelog.active.v004",
  deleted:"routelog.deleted.v011"
};

function clone(v){try{return structuredClone(v)}catch{return JSON.parse(JSON.stringify(v))}}
function load(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):clone(d)}catch{return clone(d)}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}

const defaultCloud = {url:"https://pmvtelodpxjwwklybicb.supabase.co",anonKey:"sb_publishable_KEcfQP5KbJk_NVp0jfaAMg_bCDUT0m0"};
const restoredActive = load(LS.active,null);

let state = {
  screen:"home", detailId:null, detailTab:"map",
  trips:load(LS.trips,[]).map(t=>({...t,updatedAt:t.updatedAt||`${t.date}T00:00:00.000Z`})).filter(t=>!isBundledSample(t)),
  categories:load(LS.categories,SAMPLE.categories),
  tags:load(LS.tags,SAMPLE.tags),
  settings:load(LS.settings,SAMPLE.settings),
  cloud:defaultCloud,
  cloudStatus:"未設定", cloudClient:null, cloudUser:null, syncing:false,
  deletedTripIds:load(LS.deleted,[]),
  period:"all", routeSearch:"",
  mapCats:load(LS.categories,SAMPLE.categories).filter(c=>c.active).map(c=>c.id),
  map:null, routeLayers:[],
  watchId:null, tracking:false, paused:false,
  trackPoints:restoredActive?.trackPoints||[],
  gpsPoints:restoredActive?.gpsPoints||[],
  gpsStart:restoredActive?.gpsStart||null,
  pauseStartedAt:restoredActive?.pauseStartedAt||null,
  pausedTotalMs:restoredActive?.pausedTotalMs||0,
  gpsTimer:null,lastSpeed:null,
  currentStay:restoredActive?.currentStay||null,
  stayCandidates:restoredActive?.stayCandidates||[],
  recoveredActive:!!restoredActive,
  wakeLock:null,
  pickMode:null, manual:{start:null,end:null,stops:[]},
  calendarOffset:0, calendarSelected:null,
  settingsDraft:null,
  gpsMarker:null,gpsHalo:null,gpsAccuracyCircle:null
};
save(LS.trips,state.trips);

function toast(msg){
  const t=document.querySelector("#toast"); if(!t)return;
  t.textContent=msg;t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),2000);
}
function isBundledSample(t){
  const samples={
    t1:["2026-10-17","敦賀ラーメンドライブ"],
    t2:["2026-10-16","宇治田原ゴルフクラブ"],
    t3:["2026-09-20","中部旅行（白樺湖 → 名古屋）"],
    t4:["2026-10-10","イオンモール草津"]
  };
  const s=samples[t?.id];
  return !!s && t.date===s[0] && t.title===s[1];
}
function tripRoute(t){return Array.isArray(t?.route)?t.route:[]}
function routeLabel(t){return t?.type==="gps"?"GPS記録":"手動登録（直線表示）"}
function saveDeletedIds(){save(LS.deleted,[...new Set(state.deletedTripIds)])}

function cat(id){return state.categories.find(c=>c.id===id)||{name:"その他",color:"#777"}}
function fmtDur(m){m=Math.round(m||0);return `${Math.floor(m/60)}時間${m%60}分`}
function dateJP(s){
  const d=new Date(s+"T00:00:00");
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}(${["日","月","火","水","木","金","土"][d.getDay()]})`
}
function nav(active){return `<nav class="bottomnav">
  ${navBtn("home","⌂","ホーム",active)}
  ${navBtn("map","🗺","地図",active)}
  ${navBtn("record","◉","記録",active)}
  ${navBtn("manual","＋","追加",active)}
  ${navBtn("settings","⚙","設定",active)}
</nav>`}
function navBtn(s,i,l,a){
  return `<button class="navbtn ${a===s?"active":""}" data-nav="${s}">
    <span>${i}</span>${l}
  </button>`
}
function topbar(extra=""){
  const live = state.tracking ? `<div class="record-badge">${state.paused?"一時停止":"記録中"}</div>` : "";
  const status = extra || live;
  const accountLabel = state.cloudUser?.email
    ? esc((state.cloudUser.email.split("@")[0]||"G").slice(0,1).toUpperCase())
    : "G";
  const accountBtn = `<button class="account-btn ${state.cloudUser?"signed-in":""}" id="accountBtn" aria-label="Googleアカウント">${accountLabel}</button>`;
  return `<header class="topbar"><div class="brand"><img src="./icon-192.png?v=013" alt="">RouteLog</div><div class="top-actions">${status}${accountBtn}</div></header>`
}
function shell(content,active,extra=""){
  return `<div class="app-shell">${topbar(extra)}<main class="page">${content}</main>${nav(active)}</div>`
}

function showAccountPanel(){
  document.querySelector("#accountPanel")?.remove();
  const signedIn = !!state.cloudUser;
  const panel=document.createElement("div");
  panel.id="accountPanel";
  panel.className="account-panel-wrap";
  panel.innerHTML=`
    <div class="account-panel-backdrop" id="accountPanelClose"></div>
    <div class="account-panel">
      <div class="account-panel-head"><b>アカウント</b><button class="icon-btn" id="accountPanelX">×</button></div>
      ${signedIn
        ? `<div class="account-email">${esc(state.cloudUser.email||"Googleアカウント")}</div>
           <button class="btn" id="accountLogout">ログアウト</button>`
        : `<button class="btn primary" id="accountLogin">Googleでログイン</button>`}
    </div>`;
  document.body.appendChild(panel);
  const close=()=>panel.remove();
  panel.querySelector("#accountPanelClose")?.addEventListener("click",close);
  panel.querySelector("#accountPanelX")?.addEventListener("click",close);
  panel.querySelector("#accountLogin")?.addEventListener("click",async()=>{
    close();
    await cloudGoogleLogin();
  });
  panel.querySelector("#accountLogout")?.addEventListener("click",async()=>{
    try{
      await state.cloudClient?.auth.signOut();
      state.cloudUser=null;
      state.cloudStatus="未ログイン";
      toast("ログアウトしました");
      close();
      render();
    }catch{
      toast("ログアウトできませんでした");
    }
  });
}
function go(screen,detailId=null){
  cleanupMap();
  if(screen==="detail" && detailId!==state.detailId)state.detailTab="map";
  state.screen=screen;state.detailId=detailId;render();
  window.scrollTo(0,0)
}
function cleanupMap(){
  if(state.map){state.map.remove();state.map=null}
  state.routeLayers=[];
  state.gpsMarker=null;state.gpsHalo=null;state.gpsAccuracyCircle=null;
}
function mapBase(id,center=[35.02,135.9],zoom=10){
  const m=L.map(id,{zoomControl:false,attributionControl:false}).setView(center,zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(m);
  L.control.zoom({position:"bottomright"}).addTo(m);
  L.control.attribution({position:"bottomleft",prefix:false}).addAttribution("&copy; OpenStreetMap").addTo(m);
  state.map=m;return m;
}
function tripCard(t){
  const c=cat(t.category);
  return `<article class="trip-card" data-trip="${t.id}">
    <img class="thumb" src="${t.thumb||"./hero.jpg"}" alt="">
    <div>
      <div class="trip-date">${dateJP(t.date)}</div>
      <div class="trip-title">${esc(t.title)}</div>
      <div class="trip-meta">
        <span class="pill" style="background:${c.color}18;color:${c.color}">${esc(c.name)}</span>
        <span>${t.distanceKm||0} km</span><span>${fmtDur(t.durationMin)}</span>
      </div>
    </div>
    <div class="chev">›</div>
  </article>`
}

/* ---------- Home ---------- */
function home(){
  const trips=[...state.trips].sort((a,b)=>(b.updatedAt||b.date).localeCompare(a.updatedAt||a.date)).slice(0,5);
  const recent = trips.length
    ? `<section class="trip-list">${trips.map(tripCard).join("")}</section>`
    : `<section class="empty-home">
         <div class="empty-home-icon">⌖</div>
         <h3>まだ移動記録はありません</h3>
         <p>GPSで記録するか、あとから手動で追加できます。</p>
       </section>`;
  return shell(`
    <section class="hero"><img src="./hero.jpg" alt="RouteLog"></section>
    <section class="home-actions">
      <button class="big-action primary" data-nav="record">▶　GPS記録</button>
      <button class="big-action secondary" data-nav="manual">＋　手動で追加</button>
    </section>
    <section class="quick-grid">
      <button class="quick" data-nav="map"><span class="qicon">🗺</span>すべてのルート</button>
      <button class="quick" data-nav="calendar"><span class="qicon">▣</span>カレンダー</button>
      <button class="quick" data-nav="stats"><span class="qicon">▥</span>統計・分析</button>
    </section>
    <div class="section-head"><h2>最近の移動</h2>${state.trips.length?`<button class="link-btn" data-nav="map">すべて見る ›</button>`:""}</div>
    ${recent}
  `,"home")
}

/* ---------- All routes ---------- */
function filteredTrips(){
  let list=[...state.trips];
  if(state.period!=="all"){
    const days=state.period==="1m"?31:state.period==="3m"?93:365;
    const limit=new Date();limit.setDate(limit.getDate()-days);
    list=list.filter(t=>new Date(t.date+"T00:00:00")>=limit);
  }
  const q=state.routeSearch.trim().toLowerCase();
  if(q){
    list=list.filter(t=>{
      const c=cat(t.category).name;
      const hay=[t.title,t.startName,t.endName,t.purpose,t.memo,c,...(t.tags||[])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  return list.sort((a,b)=>b.date.localeCompare(a.date));
}
function visibleTrips(){
  return filteredTrips().filter(t=>state.mapCats.includes(t.category));
}
function routeMap(){
  const activeCats=state.categories.filter(c=>c.active);
  state.mapCats=state.mapCats.filter(id=>activeCats.some(c=>c.id===id));
  if(!state.mapCats.length)state.mapCats=activeCats.map(c=>c.id);
  const filters=activeCats.map(c=>`
    <label class="filter-row">
      <input type="checkbox" class="catFilter" value="${c.id}" ${state.mapCats.includes(c.id)?"checked":""}>
      <span class="dot" style="background:${c.color}"></span>${esc(c.name)}
    </label>`).join("");
  const html=shell(`
    <section class="route-search">
      <input id="routeSearch" value="${esc(state.routeSearch)}" placeholder="行き先・タイトル・メモで検索">
      <button class="btn soft" id="routeSearchBtn">検索</button>
      ${state.routeSearch?`<button class="btn" id="routeSearchClear">クリア</button>`:""}
    </section>
    <div class="map-wrap">
      <div id="allMap" class="map"></div>
      <details class="filter-card">
        <summary>表示するカテゴリ</summary>
        <div class="filter-body">${filters}</div>
      </details>
    </div>
    <div class="periods">
      ${["all","1m","3m","1y"].map(p=>`<button class="chip ${state.period===p?"active":""}" data-period="${p}">${({all:"すべて","1m":"1か月","3m":"3か月","1y":"1年"})[p]}</button>`).join("")}
    </div>
    <div class="section-head"><h2>ルート一覧</h2><span class="trip-date" id="routeCount">${visibleTrips().length}件</span></div>
    <section class="trip-list" id="routeList">${visibleTrips().length?visibleTrips().map(tripCard).join(""):`<div class="empty">条件に合う記録はありません</div>`}</section>
  `,"map");
  setTimeout(drawAllMap,0);return html;
}
function drawAllMap(){
  const m=mapBase("allMap",[35.02,135.9],10);
  drawVisibleRoutes(true);
  m.on("click",e=>{
    const radiusKm = m.getZoom()>=15 ? .15 : m.getZoom()>=12 ? .5 : 3;
    const hits=visibleTrips().filter(t=>minRouteDistanceKm(e.latlng,tripRoute(t))<radiusKm);
    if(hits.length){
      L.popup().setLatLng(e.latlng).setContent(
        `<b>この付近の記録 ${hits.length}件</b><br>`+
        hits.slice(0,8).map(t=>`${t.date}　${esc(t.title)}`).join("<br>")
      ).openOn(m);
    }else{
      L.popup().setLatLng(e.latlng).setContent("この付近の記録はありません").openOn(m);
    }
  });
}
function drawVisibleRoutes(fit=false){
  if(!state.map)return;
  state.routeLayers.forEach(l=>state.map.removeLayer(l));state.routeLayers=[];
  const allPoints=[];
  visibleTrips().forEach(t=>{
    const route=tripRoute(t); if(route.length<2)return;
    const c=cat(t.category);
    const line=L.polyline(route,{
      color:c.color,weight:t.type==="manual"?4:5,opacity:.8,
      dashArray:t.type==="manual"?"8 8":null,
      smoothFactor:state.map.getZoom()>=14?0:.7,
      bubblingMouseEvents:false
    }).addTo(state.map);
    line.bindTooltip(esc(t.title),{sticky:true});
    line.on("click",()=>go("detail",t.id));
    state.routeLayers.push(line);
    allPoints.push(...route);
  });
  if(fit && allPoints.length>1){
    const b=L.latLngBounds(allPoints);
    state.map.fitBounds(b,{padding:[28,28],maxZoom:13});
  }
}
function refreshRouteResults(){
  const list=document.querySelector("#routeList");
  const count=document.querySelector("#routeCount");
  if(list){
    const rows=visibleTrips();
    list.innerHTML=rows.length?rows.map(tripCard).join(""):`<div class="empty">条件に合う記録はありません</div>`;
    list.querySelectorAll("[data-trip]").forEach(b=>b.onclick=()=>go("detail",b.dataset.trip));
    if(count)count.textContent=rows.length+"件";
  }
  drawVisibleRoutes(true);
}

/* ---------- Recording ---------- */
function record(){
  const recovered = state.recoveredActive && state.trackPoints.length>1;
  const controls = state.tracking ? `
    <div class="record-controls">
      <button class="btn" id="pauseGps">${state.paused?"▶ 再開":"Ⅱ 一時停止"}</button>
      <button class="btn danger" id="finishGps">● 記録終了</button>
    </div>` : `
    <section class="record-wait">
      <h2>${recovered?"未完了の記録があります":"GPS記録"}</h2>
      <p>${recovered?"前回までの記録を残したまま再開できます。":"「記録開始」を押すと現在地の記録を始めます。"}</p>
      <button class="record-start-btn" id="beginGps">${recovered?"▶ 記録を再開":"▶ 記録開始"}</button>
      ${recovered?`<button class="btn" id="discardActive" style="margin-top:10px;width:100%">未完了記録を破棄</button>`:""}
    </section>`;
  const html=shell(`
    <section class="stats3">
      <div class="stat"><label>経過時間</label><strong id="gpsElapsed">${elapsedText()}</strong></div>
      <div class="stat"><label>走行距離</label><strong id="gpsDistance">${routeDistanceKm(state.trackPoints).toFixed(1)} km</strong></div>
      <div class="stat"><label>現在速度</label><strong id="gpsSpeed">${state.lastSpeed==null?"--":Math.round(state.lastSpeed)} km/h</strong></div>
    </section>
    <div id="recordMap" class="record-map"></div>
    ${state.tracking?`<div class="record-live-note">${state.paused?"一時停止中":"記録中"}</div>`:""}
    <section class="panel stay-box">
      <h3>立ち寄り候補（<span id="stayCount">${state.stayCandidates.length}</span>件）</h3>
      <div id="stayList">${stayListHtml()}</div>
    </section>
    ${controls}
    <div class="track-warning">記録中はRouteLogを開いたままにすると、より安定して記録できます。</div>
  `,"record",`<div class="record-badge">${state.tracking?(state.paused?"一時停止":"記録中"):"待機中"}</div>`);
  setTimeout(drawRecordMap,0);return html;
}
function elapsedMs(){
  if(!state.gpsStart)return 0;
  const currentPause=state.paused&&state.pauseStartedAt ? Date.now()-state.pauseStartedAt : 0;
  return Math.max(0,Date.now()-state.gpsStart-state.pausedTotalMs-currentPause);
}
function elapsedText(){
  const sec=Math.floor(elapsedMs()/1000);
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  return [h,m,s].map(x=>String(x).padStart(2,"0")).join(":");
}
function startGpsUiTimer(){
  if(state.gpsTimer)clearInterval(state.gpsTimer);
  if(!state.tracking)return;
  state.gpsTimer=setInterval(()=>updateGpsStats(state.lastSpeed==null?null:state.lastSpeed/3.6),1000);
}
function drawRecordMap(){
  const center=state.trackPoints.length?state.trackPoints[state.trackPoints.length-1]:[35.003,135.875];
  const m=mapBase("recordMap",center,state.trackPoints.length?15:14);
  if(state.trackPoints.length){
    const line=L.polyline(state.trackPoints,{color:"#117ff1",weight:6,smoothFactor:0}).addTo(m);
    if(state.trackPoints.length>2)m.fitBounds(line.getBounds(),{padding:[24,24],maxZoom:16});
    state.gpsHalo=L.circleMarker(center,{
      radius:22,color:"#1689f5",weight:2,opacity:.35,
      fillColor:"#1689f5",fillOpacity:.15,className:"gps-halo"
    }).addTo(m);
    state.gpsMarker=L.circleMarker(center,{
      radius:13,color:"#fff",weight:4,
      fillColor:"#1689f5",fillOpacity:1,className:"gps-current-marker"
    }).addTo(m);
    state.gpsAccuracyCircle=L.circle(center,{
      radius:30,color:"#1689f5",weight:1,opacity:.18,
      fillColor:"#1689f5",fillOpacity:.05
    }).addTo(m);
  }
}
async function requestWakeLock(){
  try{
    if("wakeLock" in navigator){
      state.wakeLock=await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release",()=>{state.wakeLock=null});
    }
  }catch{}
}
async function releaseWakeLock(){
  try{if(state.wakeLock)await state.wakeLock.release()}catch{}
  state.wakeLock=null;
}
function persistActive(){
  if(!state.gpsStart)return;
  save(LS.active,{
    trackPoints:state.trackPoints,
    gpsPoints:state.gpsPoints,
    gpsStart:state.gpsStart,
    pauseStartedAt:state.pauseStartedAt,
    pausedTotalMs:state.pausedTotalMs,
    currentStay:state.currentStay,
    stayCandidates:state.stayCandidates
  });
}
async function beginGps(){
  if(!navigator.geolocation){toast("この端末では現在地を利用できません");return}
  if(state.watchId!=null)return;
  state.tracking=true;state.paused=false;state.pauseStartedAt=null;state.recoveredActive=false;
  if(!state.gpsStart)state.gpsStart=Date.now();
  if(!state.trackPoints.length){state.stayCandidates=[];state.currentStay=null;state.gpsPoints=[];state.pausedTotalMs=0}
  await requestWakeLock();
  state.watchId=navigator.geolocation.watchPosition(pos=>{
    if(state.paused)return;
    const now=pos.timestamp||Date.now();
    const p=[pos.coords.latitude,pos.coords.longitude];
    const accuracy=Number(pos.coords.accuracy||999);
    if(accuracy>200)return;
    const speedMps=pos.coords.speed;
    state.lastSpeed=speedMps==null?null:Math.max(0,speedMps*3.6);
    state.gpsPoints.push({
      lat:p[0],lng:p[1],ts:now,accuracy,
      speedKmh:state.lastSpeed,
      heading:pos.coords.heading==null?null:pos.coords.heading,
      altitude:pos.coords.altitude==null?null:pos.coords.altitude
    });
    detectStay(p,accuracy,now);
    const prev=state.trackPoints[state.trackPoints.length-1];
    if(!prev || haversine(prev,p)>=0.002){
      state.trackPoints.push(p);
      if(state.map && state.screen==="record"){
        if(state.trackPoints.length>1){
          const seg=L.polyline(state.trackPoints.slice(-2),{color:"#117ff1",weight:6,smoothFactor:0}).addTo(state.map);
          state.routeLayers.push(seg);
        }
      }
    }
    if(state.map && state.screen==="record"){
      if(!state.gpsHalo){
        state.gpsHalo=L.circleMarker(p,{radius:22,color:"#1689f5",weight:2,opacity:.35,fillColor:"#1689f5",fillOpacity:.15,className:"gps-halo"}).addTo(state.map);
      }else state.gpsHalo.setLatLng(p);
      if(!state.gpsMarker){
        state.gpsMarker=L.circleMarker(p,{radius:13,color:"#fff",weight:4,fillColor:"#1689f5",fillOpacity:1,className:"gps-current-marker"}).addTo(state.map);
      }else state.gpsMarker.setLatLng(p);
      if(!state.gpsAccuracyCircle){
        state.gpsAccuracyCircle=L.circle(p,{radius:Math.max(10,accuracy),color:"#1689f5",weight:1,opacity:.18,fillColor:"#1689f5",fillOpacity:.05}).addTo(state.map);
      }else{
        state.gpsAccuracyCircle.setLatLng(p);
        state.gpsAccuracyCircle.setRadius(Math.max(10,accuracy));
      }
      state.map.panTo(p);
    }
    persistActive();
    updateGpsStats(speedMps);
  },err=>{
    const msg=err.code===1?"現在地の利用が許可されていません":err.code===3?"現在地の取得に時間がかかっています":"現在地を取得できません";
    toast(msg);
  },{enableHighAccuracy:true,maximumAge:500,timeout:20000});
  render();
  startGpsUiTimer();
}
function togglePause(){
  if(!state.tracking)return;
  if(!state.paused){
    state.paused=true;state.pauseStartedAt=Date.now();state.lastSpeed=0;
  }else{
    if(state.pauseStartedAt)state.pausedTotalMs+=Date.now()-state.pauseStartedAt;
    state.pauseStartedAt=null;state.paused=false;
  }
  persistActive();render();startGpsUiTimer();
}
function updateGpsStats(speed){
  const el=document.querySelector("#gpsElapsed"),di=document.querySelector("#gpsDistance"),sp=document.querySelector("#gpsSpeed");
  if(el)el.textContent=elapsedText();
  if(di)di.textContent=routeDistanceKm(state.trackPoints).toFixed(1)+" km";
  if(sp){
    const kmh=speed==null?state.lastSpeed:Math.max(0,speed*3.6);
    sp.textContent=(kmh==null?"--":Math.round(kmh))+" km/h";
  }
}
function detectStay(p,accuracy,now=Date.now()){
  if(accuracy>Math.max(120,state.settings.stayRadius*1.8))return;
  const r=state.settings.stayRadius/1000;
  if(!state.currentStay){state.currentStay={center:p,start:now,last:now};return}
  const d=haversine(state.currentStay.center,p);
  if(d<=r){state.currentStay.last=now;return}
  commitCurrentStay(state.currentStay.last);
  state.currentStay={center:p,start:now,last:now};
}
function commitCurrentStay(endTs=Date.now()){
  if(!state.currentStay)return;
  const mins=(endTs-state.currentStay.start)/60000;
  if(mins>=state.settings.stayMinutes){
    const last=state.stayCandidates[state.stayCandidates.length-1];
    const lat=state.currentStay.center[0],lng=state.currentStay.center[1];
    if(!last || haversine([last.lat,last.lng],[lat,lng])>.03 || Math.abs((last.startTs||0)-state.currentStay.start)>60000){
      state.stayCandidates.push({
        name:"立ち寄り候補",lat,lng,
        startTs:state.currentStay.start,endTs,
        durationMin:Math.round(mins),duration:`${Math.round(mins)}分`
      });
      const c=document.querySelector("#stayCount");if(c)c.textContent=state.stayCandidates.length;
      const l=document.querySelector("#stayList");if(l)l.innerHTML=stayListHtml();
    }
  }
}
function stayListHtml(){
  if(!state.stayCandidates.length)return `<div class="empty">まだ立ち寄り候補はありません</div>`;
  return state.stayCandidates.map((s,i)=>`
    <div class="stay-card">
      <div class="stay-pin">●</div>
      <div><b>${esc(s.name||`立ち寄り${i+1}`)}</b><br>
      <span class="trip-date">${s.duration||`${s.durationMin||0}分`}</span></div>
    </div>`).join("");
}
async function finishGps(){
  if(state.watchId!=null)navigator.geolocation.clearWatch(state.watchId);
  state.watchId=null;
  if(state.paused&&state.pauseStartedAt){
    state.pausedTotalMs+=Date.now()-state.pauseStartedAt;
    state.pauseStartedAt=null;
  }
  state.tracking=false;state.paused=false;
  if(state.gpsTimer){clearInterval(state.gpsTimer);state.gpsTimer=null}
  await releaseWakeLock();
  commitCurrentStay(Date.now());
  if(state.trackPoints.length<2){
    toast("移動した記録が少ないため保存しませんでした");
    clearActiveSession();render();return;
  }
  const now=new Date();
  const t={
    id:"g"+Date.now(),date:now.toISOString().slice(0,10),
    title:"移動記録",purpose:"",memo:"",category:"drive",tags:[],type:"gps",
    distanceKm:Number(routeDistanceKm(state.trackPoints).toFixed(1)),
    durationMin:Math.max(1,Math.round(elapsedMs()/60000)),
    startName:"出発地点",endName:"到着地点",thumb:"./hero.jpg",
    route:[...state.trackPoints],
    gpsPoints:[...state.gpsPoints],
    stops:state.stayCandidates.map((s,i)=>({...s,name:s.name||`立ち寄り${i+1}`,time:""})),
    startedAt:new Date(state.gpsStart).toISOString(),
    endedAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
  state.trips.push(t);save(LS.trips,state.trips);
  clearActiveSession();
  cloudSaveTrip(t).catch(()=>{});
  toast("記録しました");
  go("edit",t.id);
}
function clearActiveSession(){
  if(state.gpsTimer){clearInterval(state.gpsTimer);state.gpsTimer=null}
  state.trackPoints=[];state.gpsPoints=[];state.stayCandidates=[];state.currentStay=null;
  state.gpsStart=null;state.pauseStartedAt=null;state.pausedTotalMs=0;state.lastSpeed=null;
  state.recoveredActive=false;
  localStorage.removeItem(LS.active);
}

/* ---------- Detail ---------- */
function detail(){
  const t=state.trips.find(x=>x.id===state.detailId);
  if(!t)return shell(`<div class="empty-page"><h2>記録が見つかりません</h2><button class="btn primary" data-nav="home">ホームへ</button></div>`,"home");
  const c=cat(t.category);
  const tab=state.detailTab||"map";
  let body="";
  if(tab==="map"){
    body=`<div id="detailMap" class="detail-map"></div>`;
    setTimeout(()=>drawDetailMap(t),0);
  }else if(tab==="info"){
    body=`<section class="detail-panel">
      <div class="detail-row"><span>日付</span><b>${dateJP(t.date)}</b></div>
      <div class="detail-row"><span>記録方法</span><b>${routeLabel(t)}</b></div>
      <div class="detail-row"><span>距離</span><b>${t.distanceKm||0} km</b></div>
      <div class="detail-row"><span>時間</span><b>${fmtDur(t.durationMin)}</b></div>
      <div class="detail-row"><span>出発</span><b>${esc(t.startName||"")}</b></div>
      <div class="detail-row"><span>到着</span><b>${esc(t.endName||"")}</b></div>
    </section>`;
  }else if(tab==="stops"){
    body=(t.stops||[]).length
      ? `<section class="timeline">${(t.stops||[]).map((s,i)=>`<div class="tline"><b>${esc(s.name||`立ち寄り${i+1}`)}</b><div class="trip-date">${esc(s.duration||"")}</div></div>`).join("")}</section>`
      : `<div class="empty">立ち寄り記録はありません</div>`;
  }else{
    body=`<section class="detail-panel">
      <h3>目的</h3><p>${esc(t.purpose||"未入力")}</p>
      <h3>メモ</h3><p class="memo-text">${esc(t.memo||"未入力")}</p>
    </section>`;
  }
  return shell(`
    <section class="detail-head">
      <div class="trip-date">${dateJP(t.date)}　<span class="pill">${routeLabel(t)}</span></div>
      <div class="detail-title-line"><h2>${esc(t.title)}</h2><button class="btn soft" id="editTrip">編集</button></div>
      <div class="tags"><span class="pill" style="background:${c.color}18;color:${c.color}">${esc(c.name)}</span>${(t.tags||[]).map(x=>`<span class="pill">${esc(x)}</span>`).join("")}</div>
      <div class="trip-meta" style="margin-top:10px"><b>${t.distanceKm||0} km</b><b>${fmtDur(t.durationMin)}</b></div>
    </section>
    <div class="tabs">
      <button class="tab ${tab==="map"?"active":""}" data-detailtab="map">地図</button>
      <button class="tab ${tab==="info"?"active":""}" data-detailtab="info">詳細</button>
      <button class="tab ${tab==="stops"?"active":""}" data-detailtab="stops">立ち寄り</button>
      <button class="tab ${tab==="memo"?"active":""}" data-detailtab="memo">メモ</button>
    </div>
    ${body}
    <section class="detail-actions"><button class="btn danger-outline" id="deleteTrip">この記録を削除</button></section>
  `,"map");
}
function drawDetailMap(t){
  const route=tripRoute(t);if(!route.length)return;
  const m=mapBase("detailMap",route[0],10);
  const c=cat(t.category);
  const line=L.polyline(route,{color:c.color,weight:6,dashArray:t.type==="manual"?"8 8":null,smoothFactor:0}).addTo(m);
  m.fitBounds(line.getBounds(),{padding:[24,24],maxZoom:16});
  L.marker(route[0]).addTo(m).bindPopup("出発");
  L.marker(route[route.length-1]).addTo(m).bindPopup("到着");
  (t.stops||[]).forEach(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng)&&L.circleMarker([s.lat,s.lng],{radius:7,color:"#fff",weight:2,fillColor:"#ff7b16",fillOpacity:1}).addTo(m).bindPopup(esc(s.name)));
}
function editTrip(){
  const t=state.trips.find(x=>x.id===state.detailId);
  if(!t)return shell(`<div class="empty">記録が見つかりません</div>`,"map");
  return shell(`
    <div class="form edit-form">
      <div class="edit-summary"><b>${dateJP(t.date)}</b><span>${t.distanceKm||0} km ・ ${fmtDur(t.durationMin)}</span></div>
      <div class="field"><label>タイトル</label><input id="eTitle" value="${esc(t.title||"")}" placeholder="例：敦賀へラーメンドライブ"></div>
      <div class="field"><label>目的</label><input id="ePurpose" value="${esc(t.purpose||"")}" placeholder="例：家族でラーメンを食べに行った"></div>
      <div class="field"><label>カテゴリ</label><select id="eCategory">${state.categories.filter(c=>c.active||c.id===t.category).map(c=>`<option value="${c.id}" ${c.id===t.category?"selected":""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>タグ</label><div class="tags">${state.tags.map(tag=>`<label class="pill"><input class="eTag" type="checkbox" value="${esc(tag)}" ${(t.tags||[]).includes(tag)?"checked":""}>${esc(tag)}</label>`).join("")}</div></div>
      <div class="field"><label>出発地点</label><input id="eStartName" value="${esc(t.startName||"")}"></div>
      <div class="field"><label>到着地点</label><input id="eEndName" value="${esc(t.endName||"")}"></div>
      <div class="field"><label>メモ</label><textarea id="eMemo" placeholder="あとで思い出したいこと">${esc(t.memo||"")}</textarea></div>
      <button class="btn primary" id="saveTripEdit">保存して完了</button>
      <button class="btn" id="cancelTripEdit">変更せず戻る</button>
    </div>
  `,"map");
}
function saveTripEdit(){
  const t=state.trips.find(x=>x.id===state.detailId);if(!t)return;
  t.title=v("#eTitle").trim()||"移動記録";
  t.purpose=v("#ePurpose").trim();
  t.category=v("#eCategory");
  t.tags=[...document.querySelectorAll(".eTag:checked")].map(x=>x.value);
  t.startName=v("#eStartName").trim()||"出発地点";
  t.endName=v("#eEndName").trim()||"到着地点";
  t.memo=v("#eMemo").trim();
  t.updatedAt=new Date().toISOString();
  save(LS.trips,state.trips);
  cloudSaveTrip(t).catch(()=>{});
  toast("保存しました");
  go("detail",t.id);
}
function deleteTrip(id){
  const t=state.trips.find(x=>x.id===id);if(!t)return;
  if(!confirm(`「${t.title}」を削除しますか？`))return;
  state.trips=state.trips.filter(x=>x.id!==id);
  if(!state.deletedTripIds.includes(id))state.deletedTripIds.push(id);
  save(LS.trips,state.trips);saveDeletedIds();
  cloudDeleteTrip(id).catch(()=>{});
  toast("削除しました");
  go("home");
}

/* ---------- Manual ---------- */
function manual(){
  const html=shell(`
    <div class="form">
      <div class="field"><label>日付</label><input id="mDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="two"><div class="field"><label>出発時刻</label><input id="mStartTime" type="time" value="08:00"></div><div class="field"><label>到着時刻</label><input id="mEndTime" type="time" value="12:00"></div></div>
      <div class="field"><label>出発地点</label><div class="point-field"><input id="mStartName" placeholder="例：自宅"><button class="btn soft pick" data-pick="start">地図で選ぶ</button></div></div>
      <div class="field"><label>到着地点</label><div class="point-field"><input id="mEndName" placeholder="例：目的地"><button class="btn soft pick" data-pick="end">地図で選ぶ</button></div></div>
      <div id="pickNotice" class="pick-mode">地点を選ぶ時はボタンを押してから地図をタップしてください。</div>
      <div id="manualMap" class="manual-map"></div>
      <button class="btn soft" id="addStop">＋ 地図から立ち寄り地点を追加</button>
      <div id="manualStops">${manualStopsHtml()}</div>
      <div class="manual-route-note">手動登録の線は、選んだ地点同士を直線で結んで表示します。</div>
      <div class="field"><label>カテゴリ</label><select id="mCategory">${state.categories.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>タグ</label><div class="tags">${state.tags.map(t=>`<label class="pill"><input class="mTag" type="checkbox" value="${esc(t)}">${esc(t)}</label>`).join("")}</div></div>
      <div class="field"><label>タイトル</label><input id="mTitle" placeholder="例：宇治田原ゴルフクラブ"></div>
      <div class="field"><label>目的</label><input id="mPurpose" placeholder="例：ゴルフ"></div>
      <div class="field"><label>メモ</label><textarea id="mMemo" placeholder="あとで思い出したいこと"></textarea></div>
      <button class="btn primary" id="saveManual">この内容で保存</button>
    </div>
  `,"manual");
  setTimeout(drawManualMap,0);return html;
}
function manualStopsHtml(){
  if(!state.manual.stops.length)return "";
  return `<div class="manual-stop-list">${state.manual.stops.map((s,i)=>`
    <div class="manual-stop-row">
      <span class="stop-no">${i+1}</span>
      <input class="manualStopName" data-i="${i}" value="${esc(s.name||`立ち寄り${i+1}`)}">
      <button class="btn manualStopDel" data-i="${i}">×</button>
    </div>`).join("")}</div>`;
}
function renderManualStopsDom(){
  const box=document.querySelector("#manualStops");if(!box)return;
  box.innerHTML=manualStopsHtml();
  box.querySelectorAll(".manualStopName").forEach(x=>x.addEventListener("input",e=>{
    const i=Number(e.target.dataset.i);if(state.manual.stops[i])state.manual.stops[i].name=e.target.value;
  }));
  box.querySelectorAll(".manualStopDel").forEach(x=>x.addEventListener("click",e=>{
    state.manual.stops.splice(Number(e.currentTarget.dataset.i),1);
    renderManualStopsDom();refreshManualMapLayers();
  }));
}
function drawManualMap(){
  const center=state.manual.start||state.manual.end||[35.003,135.875];
  mapBase("manualMap",center,11);
  refreshManualMapLayers();
  state.map.on("click",e=>{
    if(!state.pickMode){toast("先に「地図で選ぶ」か「立ち寄り地点を追加」を押してください");return}
    const p=[e.latlng.lat,e.latlng.lng];
    if(state.pickMode==="stop"){
      state.manual.stops.push({name:`立ち寄り${state.manual.stops.length+1}`,lat:p[0],lng:p[1]});
      document.querySelector("#pickNotice").textContent="立ち寄り地点を追加しました";
      renderManualStopsDom();
    }else{
      state.manual[state.pickMode]=p;
      document.querySelector("#pickNotice").textContent=(state.pickMode==="start"?"出発地点":"到着地点")+"を設定しました";
    }
    state.pickMode=null;
    refreshManualMapLayers();
  });
}
function refreshManualMapLayers(){
  if(!state.map)return;
  state.routeLayers.forEach(l=>state.map.removeLayer(l));state.routeLayers=[];
  const points=[];
  if(state.manual.start){
    const m=L.marker(state.manual.start).addTo(state.map).bindPopup("出発地点");state.routeLayers.push(m);points.push(state.manual.start);
  }
  state.manual.stops.forEach((s,i)=>{
    const p=[s.lat,s.lng];const m=L.circleMarker(p,{radius:7,color:"#fff",weight:2,fillColor:"#ff7b16",fillOpacity:1}).addTo(state.map).bindPopup(esc(s.name||`立ち寄り${i+1}`));
    state.routeLayers.push(m);points.push(p);
  });
  if(state.manual.end){
    const m=L.marker(state.manual.end).addTo(state.map).bindPopup("到着地点");state.routeLayers.push(m);points.push(state.manual.end);
  }
  if(points.length>1){
    const l=L.polyline(points,{color:"#1585ee",weight:4,dashArray:"8 8"}).addTo(state.map);state.routeLayers.push(l);
  }
}
function saveManual(){
  const date=v("#mDate"),title=v("#mTitle").trim()||v("#mEndName").trim()||"移動記録",catId=v("#mCategory");
  if(!state.manual.start||!state.manual.end){toast("出発地点と到着地点を地図で選んでください");return}
  const startT=v("#mStartTime"),endT=v("#mEndTime");
  const route=[state.manual.start,...state.manual.stops.map(s=>[s.lat,s.lng]),state.manual.end];
  const t={
    id:"m"+Date.now(),date,title,category:catId,
    purpose:v("#mPurpose").trim(),memo:v("#mMemo").trim(),
    tags:[...document.querySelectorAll(".mTag:checked")].map(x=>x.value),
    type:"manual",distanceKm:Number(routeDistanceKm(route).toFixed(1)),
    durationMin:timeDiffMin(startT,endT),
    startName:v("#mStartName").trim()||"出発地点",endName:v("#mEndName").trim()||"到着地点",
    thumb:"./hero.jpg",route,
    stops:state.manual.stops.map(s=>({...s,duration:"",time:""})),
    startTime:startT,endTime:endT,updatedAt:new Date().toISOString()
  };
  state.trips.push(t);save(LS.trips,state.trips);
  state.manual={start:null,end:null,stops:[]};
  cloudSaveTrip(t).catch(()=>{});
  toast("保存しました");
  go("detail",t.id);
}

/* ---------- Cloud ---------- */
function cloudConfigured(){return true}
async function initCloud(showToast=false){
  if(!window.supabase?.createClient){
    state.cloudStatus="保存準備に失敗";return false;
  }
  try{
    state.cloudClient=window.supabase.createClient(state.cloud.url,state.cloud.anonKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    const {data:{session},error}=await state.cloudClient.auth.getSession();
    if(error)throw error;
    state.cloudUser=session?.user||null;
    state.cloudStatus=state.cloudUser?"保存済み":"未ログイン";
    if(showToast&&state.cloudUser)toast("ログインしています");
    return !!state.cloudUser;
  }catch(e){
    state.cloudStatus="保存できません";return false;
  }
}
async function cloudUpsert(key,payload){
  if(!state.cloudClient||!state.cloudUser){
    const ok=await initCloud(false); if(!ok)return false;
  }
  const {error}=await state.cloudClient.from("routelog_data").upsert({
    user_id:state.cloudUser.id,key,payload,updated_at:new Date().toISOString()
  },{onConflict:"user_id,key"});
  if(error)throw error;
  return true;
}
async function cloudSaveTrip(t){
  if(!state.cloudUser)return false;
  try{
    await cloudUpsert("trip:"+t.id,t);state.cloudStatus="保存済み";return true;
  }catch(e){state.cloudStatus="保存できません";return false}
}
async function cloudSavePrefs(){
  if(!state.cloudUser)return false;
  try{
    await cloudUpsert("prefs",{categories:state.categories,tags:state.tags,settings:state.settings,updatedAt:new Date().toISOString()});
    state.cloudStatus="保存済み";return true;
  }catch(e){state.cloudStatus="保存できません";return false}
}
async function cloudDeleteTrip(id){
  if(!state.cloudClient||!state.cloudUser)return false;
  try{
    const {error}=await state.cloudClient.from("routelog_data").delete().eq("user_id",state.cloudUser.id).eq("key","trip:"+id);
    if(error)throw error;
    return true;
  }catch{return false}
}
async function cloudGoogleLogin(){
  try{
    if(!state.cloudClient)await initCloud(false);
    if(!state.cloudClient)throw new Error();
    const redirectTo=window.location.origin+window.location.pathname;
    const {error}=await state.cloudClient.auth.signInWithOAuth({provider:"google",options:{redirectTo}});
    if(error)throw error;
  }catch(e){
    toast("Googleログインに失敗しました");
  }
}
async function cloudSyncAll(){
  if(state.syncing)return false;
  state.syncing=true;
  try{
    const ok=await initCloud(false);if(!ok)return false;
    const {data,error}=await state.cloudClient.from("routelog_data").select("key,payload,updated_at");
    if(error)throw error;
    const cloudTrips=[];let cloudPrefs=null;
    for(const row of data||[]){
      if(row.key==="prefs"){cloudPrefs=row.payload;continue}
      if(!row.key.startsWith("trip:"))continue;
      const t=row.payload;
      if(isBundledSample(t)){
        await cloudDeleteTrip(t.id);
        continue;
      }
      if(state.deletedTripIds.includes(t.id)){
        await cloudDeleteTrip(t.id);
        continue;
      }
      cloudTrips.push(t);
    }
    const merged=new Map();
    for(const t of state.trips){
      if(!state.deletedTripIds.includes(t.id)&&!isBundledSample(t))merged.set(t.id,t);
    }
    for(const t of cloudTrips){
      const local=merged.get(t.id);
      if(!local || String(t.updatedAt||"")>=String(local.updatedAt||""))merged.set(t.id,t);
    }
    state.trips=[...merged.values()];
    save(LS.trips,state.trips);
    if(cloudPrefs){
      if(Array.isArray(cloudPrefs.categories))state.categories=cloudPrefs.categories;
      if(Array.isArray(cloudPrefs.tags))state.tags=cloudPrefs.tags;
      if(cloudPrefs.settings)state.settings=cloudPrefs.settings;
      save(LS.categories,state.categories);save(LS.tags,state.tags);save(LS.settings,state.settings);
    }else{
      await cloudSavePrefs();
    }
    for(const id of state.deletedTripIds)await cloudDeleteTrip(id);
    for(const t of state.trips)await cloudUpsert("trip:"+t.id,t);
    state.cloudStatus="保存済み";
    return true;
  }catch(e){
    state.cloudStatus="保存できません";return false;
  }finally{
    state.syncing=false;
  }
}

/* ---------- Settings ---------- */
function ensureSettingsDraft(){
  if(state.settingsDraft)return;
  state.settingsDraft={
    settings:clone(state.settings),
    categories:clone(state.categories),
    tags:clone(state.tags)
  };
}
function draftCat(id){
  ensureSettingsDraft();
  return state.settingsDraft.categories.find(c=>c.id===id)||{name:"その他",color:"#777",active:true};
}
function settings(){
  ensureSettingsDraft();
  const d=state.settingsDraft;
  return shell(`
    <section class="settings-group"><h3>滞在判定</h3>
      <div class="setting-row">
        <div><b>距離</b><div class="desc">この範囲に留まった時</div></div>
        <div><input id="stayRadius" type="number" min="10" max="1000" value="${d.settings.stayRadius}"> m</div>
      </div>
      <div class="setting-row">
        <div><b>時間</b><div class="desc">立ち寄り候補にするまで</div></div>
        <div><input id="stayMinutes" type="number" min="1" max="1440" value="${d.settings.stayMinutes}"> 分</div>
      </div>
    </section>

    <section class="settings-group"><h3>カテゴリ</h3>
      <div id="catRows">${catRows()}</div>
      <div class="add-row"><input id="newCat" placeholder="新しいカテゴリ"><button class="btn soft" id="addCat">＋追加</button></div>
    </section>

    <section class="settings-group"><h3>タグ</h3>
      <div class="add-row"><input id="newTag" placeholder="新しいタグ"><button class="btn soft" id="addTag">＋追加</button></div>
      <div style="padding:0 14px 14px" class="tags">
        ${d.tags.map(t=>`<span class="pill">${esc(t)} <button class="tagDel" data-tag="${esc(t)}" style="border:0;background:none">×</button></span>`).join("")}
      </div>
    </section>

    <div class="settings-actions">
      <button class="btn" id="cancelSettings">キャンセル</button>
      <button class="btn primary" id="saveSettings">保存</button>
    </div>
  `,"settings");
}
function catRows(){
  ensureSettingsDraft();
  const cats=state.settingsDraft.categories;
  return cats.map((c,i)=>`
    <div class="cat-row cat-row-v11">
      <input class="catColor" data-id="${c.id}" type="color" value="${c.color}">
      <input class="catName" data-id="${c.id}" value="${esc(c.name)}" aria-label="カテゴリ名">
      <label class="cat-show"><input class="catActive" data-id="${c.id}" type="checkbox" ${c.active?"checked":""}>表示</label>
      <div class="cat-order">
        <button class="mini-btn catMove" data-id="${c.id}" data-dir="-1" ${i===0?"disabled":""}>↑</button>
        <button class="mini-btn catMove" data-id="${c.id}" data-dir="1" ${i===cats.length-1?"disabled":""}>↓</button>
      </div>
      <button class="mini-btn catDel" data-id="${c.id}">×</button>
    </div>`).join("")
}
function moveCategory(id,dir){
  ensureSettingsDraft();
  const cats=state.settingsDraft.categories;
  const i=cats.findIndex(c=>c.id===id);if(i<0)return;
  const j=i+dir;if(j<0||j>=cats.length)return;
  [cats[i],cats[j]]=[cats[j],cats[i]];
  render();
}
function saveSettingsChanges(){
  ensureSettingsDraft();
  state.settings=clone(state.settingsDraft.settings);
  state.categories=clone(state.settingsDraft.categories);
  state.tags=clone(state.settingsDraft.tags);
  state.mapCats=state.mapCats.filter(id=>state.categories.some(c=>c.id===id&&c.active));
  state.categories.filter(c=>c.active).forEach(c=>{if(!state.mapCats.includes(c.id))state.mapCats.push(c.id)});
  save(LS.settings,state.settings);
  save(LS.categories,state.categories);
  save(LS.tags,state.tags);
  state.settingsDraft=null;
  cloudSavePrefs().catch(()=>{});
  toast("保存しました");
  go("home");
}
function cancelSettingsChanges(){
  state.settingsDraft=null;
  go("home");
}

/* ---------- Calendar / Stats ---------- */
function calendar(){
  const base=new Date();base.setDate(1);base.setMonth(base.getMonth()+state.calendarOffset);
  const y=base.getFullYear(),m=base.getMonth();
  const days=new Date(y,m+1,0).getDate(),pad=new Date(y,m,1).getDay(),groups={};
  state.trips.forEach(t=>{
    const d=new Date(t.date+"T00:00:00");
    if(d.getFullYear()===y&&d.getMonth()===m)(groups[d.getDate()]??=[]).push(t);
  });
  let cells="";for(let i=0;i<pad;i++)cells+=`<div></div>`;
  for(let d=1;d<=days;d++){
    const rows=groups[d]||[];
    const date=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    cells+=`<button class="day ${rows.length?"has":""} ${state.calendarSelected===date?"selected":""}" data-calday="${date}">
      <b>${d}</b>${rows.length?`<span>${rows.length}件</span>`:""}
    </button>`;
  }
  const selected=state.calendarSelected?.startsWith(`${y}-${String(m+1).padStart(2,"0")}-`)
    ? state.trips.filter(t=>t.date===state.calendarSelected).sort((a,b)=>(a.updatedAt||"").localeCompare(b.updatedAt||""))
    : [];
  return shell(`
    <div class="calendar-head">
      <button class="mini-btn" data-calnav="-1">‹</button>
      <h2>${y}年${m+1}月</h2>
      <button class="mini-btn" data-calnav="1">›</button>
    </div>
    ${state.calendarOffset!==0?`<button class="link-btn calendar-today" id="calendarToday">今月に戻る</button>`:""}
    <div class="calendar-week">${["日","月","火","水","木","金","土"].map(x=>`<span>${x}</span>`).join("")}</div>
    <div class="calendar-grid">${cells}</div>
    ${state.calendarSelected?`<div class="section-head"><h2>${state.calendarSelected.replaceAll("-","/")}</h2></div>
      <section class="trip-list">${selected.length?selected.map(tripCard).join(""):`<div class="empty">この日の記録はありません</div>`}</section>`:""}
  `,"home");
}
function stats(){
  const dist=state.trips.reduce((s,t)=>s+(Number(t.distanceKm)||0),0);
  const mins=state.trips.reduce((s,t)=>s+(Number(t.durationMin)||0),0);
  const catCount={};state.trips.forEach(t=>catCount[t.category]=(catCount[t.category]||0)+1);
  const now=new Date(),ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const thisMonth=state.trips.filter(t=>t.date.startsWith(ym));
  const monthDist=thisMonth.reduce((s,t)=>s+(Number(t.distanceKm)||0),0);
  const longest=[...state.trips].sort((a,b)=>(b.distanceKm||0)-(a.distanceKm||0))[0];
  const topCat=Object.entries(catCount).sort((a,b)=>b[1]-a[1])[0];
  const days=new Set(state.trips.map(t=>t.date)).size;
  return shell(`
    <div class="section-head" style="padding-top:14px"><h2>統計・分析</h2></div>
    <div class="metric-grid">
      <div class="metric"><label>総移動距離</label><strong>${dist.toFixed(0)} km</strong></div>
      <div class="metric"><label>総移動時間</label><strong>${Math.round(mins/60)} 時間</strong></div>
      <div class="metric"><label>記録数</label><strong>${state.trips.length} 件</strong></div>
      <div class="metric"><label>記録した日</label><strong>${days} 日</strong></div>
    </div>
    <section class="panel stats-summary">
      <div class="detail-row"><span>今月の距離</span><b>${monthDist.toFixed(0)} km</b></div>
      <div class="detail-row"><span>一番長い移動</span><b>${longest?`${esc(longest.title)}（${longest.distanceKm} km）`:"まだありません"}</b></div>
      <div class="detail-row"><span>一番多いカテゴリ</span><b>${topCat?`${esc(cat(topCat[0]).name)}（${topCat[1]}件）`:"まだありません"}</b></div>
    </section>
    <section class="panel"><b>カテゴリ別記録数</b>
      ${state.categories.map(c=>`<div class="setting-row"><span><span class="dot" style="background:${c.color}"></span> ${esc(c.name)}</span><b>${catCount[c.id]||0}件</b></div>`).join("")}
    </section>
  `,"home");
}

/* ---------- Render / Bind ---------- */
function render(){
  cleanupMap();
  let html;
  if(state.screen==="home")html=home();
  else if(state.screen==="map")html=routeMap();
  else if(state.screen==="record")html=record();
  else if(state.screen==="manual")html=manual();
  else if(state.screen==="settings")html=settings();
  else if(state.screen==="detail")html=detail();
  else if(state.screen==="edit")html=editTrip();
  else if(state.screen==="calendar")html=calendar();
  else if(state.screen==="stats")html=stats();
  document.querySelector("#app").innerHTML=html;
  bind();
}
function bind(){
  document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>go(b.dataset.nav));
  document.querySelector("#accountBtn")?.addEventListener("click",showAccountPanel);
  document.querySelectorAll("[data-trip]").forEach(b=>b.onclick=()=>go("detail",b.dataset.trip));

  document.querySelector("#beginGps")?.addEventListener("click",beginGps);
  document.querySelector("#pauseGps")?.addEventListener("click",togglePause);
  document.querySelector("#finishGps")?.addEventListener("click",finishGps);
  document.querySelector("#discardActive")?.addEventListener("click",()=>{
    if(confirm("未完了の記録を破棄しますか？")){clearActiveSession();render()}
  });
  if(state.screen==="record"&&state.tracking)startGpsUiTimer();

  document.querySelectorAll(".catFilter").forEach(x=>x.onchange=e=>{
    const id=e.target.value;
    if(e.target.checked){if(!state.mapCats.includes(id))state.mapCats.push(id)}
    else state.mapCats=state.mapCats.filter(x=>x!==id);
    refreshRouteResults();
  });
  document.querySelectorAll("[data-period]").forEach(x=>x.onclick=()=>{state.period=x.dataset.period;render()});
  document.querySelector("#routeSearchBtn")?.addEventListener("click",()=>{
    state.routeSearch=v("#routeSearch").trim();render();
  });
  document.querySelector("#routeSearch")?.addEventListener("keydown",e=>{
    if(e.key==="Enter"){state.routeSearch=e.target.value.trim();render()}
  });
  document.querySelector("#routeSearchClear")?.addEventListener("click",()=>{state.routeSearch="";render()});

  document.querySelectorAll(".pick").forEach(x=>x.onclick=()=>{
    state.pickMode=x.dataset.pick;
    document.querySelector("#pickNotice").textContent=(state.pickMode==="start"?"出発地点":"到着地点")+"を地図上でタップしてください";
  });
  document.querySelector("#addStop")?.addEventListener("click",()=>{
    state.pickMode="stop";
    document.querySelector("#pickNotice").textContent="立ち寄り地点を地図上でタップしてください";
  });
  renderManualStopsDom();
  document.querySelector("#saveManual")?.addEventListener("click",saveManual);

  document.querySelectorAll("[data-detailtab]").forEach(x=>x.onclick=()=>{
    state.detailTab=x.dataset.detailtab;render();
  });
  document.querySelector("#editTrip")?.addEventListener("click",()=>go("edit",state.detailId));
  document.querySelector("#saveTripEdit")?.addEventListener("click",saveTripEdit);
  document.querySelector("#cancelTripEdit")?.addEventListener("click",()=>go("detail",state.detailId));
  document.querySelector("#deleteTrip")?.addEventListener("click",()=>deleteTrip(state.detailId));

  if(state.screen==="settings"){
    ensureSettingsDraft();

    document.querySelector("#stayRadius")?.addEventListener("input",e=>{
      state.settingsDraft.settings.stayRadius=Math.max(10,Number(e.target.value)||80);
    });
    document.querySelector("#stayMinutes")?.addEventListener("input",e=>{
      state.settingsDraft.settings.stayMinutes=Math.max(1,Number(e.target.value)||5);
    });
    document.querySelectorAll(".catActive").forEach(x=>x.onchange=e=>{
      draftCat(e.target.dataset.id).active=e.target.checked;
    });
    document.querySelectorAll(".catColor").forEach(x=>x.onchange=e=>{
      draftCat(e.target.dataset.id).color=e.target.value;
    });
    document.querySelectorAll(".catName").forEach(x=>x.oninput=e=>{
      draftCat(e.target.dataset.id).name=e.target.value;
    });
    document.querySelectorAll(".catMove").forEach(x=>x.onclick=e=>moveCategory(e.currentTarget.dataset.id,Number(e.currentTarget.dataset.dir)));
    document.querySelectorAll(".catDel").forEach(x=>x.onclick=e=>{
      const id=e.currentTarget.dataset.id;
      const used=state.trips.some(t=>t.category===id);
      if(used){
        draftCat(id).active=false;
        toast("使っているカテゴリなので非表示にしました");
      }else{
        state.settingsDraft.categories=state.settingsDraft.categories.filter(c=>c.id!==id);
      }
      render();
    });
    document.querySelector("#addCat")?.addEventListener("click",()=>{
      const name=v("#newCat").trim();if(!name)return;
      const id="c"+Date.now();
      state.settingsDraft.categories.push({id,name,color:"#1689f5",active:true});
      render();
    });
    document.querySelector("#addTag")?.addEventListener("click",()=>{
      const t=v("#newTag").trim();if(!t||state.settingsDraft.tags.includes(t))return;
      state.settingsDraft.tags.push(t);render();
    });
    document.querySelectorAll(".tagDel").forEach(x=>x.onclick=e=>{
      state.settingsDraft.tags=state.settingsDraft.tags.filter(t=>t!==e.currentTarget.dataset.tag);
      render();
    });

    document.querySelector("#saveSettings")?.addEventListener("click",saveSettingsChanges);
    document.querySelector("#cancelSettings")?.addEventListener("click",cancelSettingsChanges);
  }

  document.querySelectorAll("[data-calnav]").forEach(x=>x.onclick=e=>{
    state.calendarOffset+=Number(e.currentTarget.dataset.calnav);state.calendarSelected=null;render();
  });
  document.querySelector("#calendarToday")?.addEventListener("click",()=>{state.calendarOffset=0;state.calendarSelected=null;render()});
  document.querySelectorAll("[data-calday]").forEach(x=>x.onclick=e=>{state.calendarSelected=e.currentTarget.dataset.calday;render()});
}

/* ---------- Utils ---------- */
function v(sel){return document.querySelector(sel)?.value||""}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function haversine(a,b){
  const R=6371,toR=x=>x*Math.PI/180,dLat=toR(b[0]-a[0]),dLon=toR(b[1]-a[1]),la1=toR(a[0]),la2=toR(b[0]);
  const q=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(q))
}
function routeDistanceKm(r){let s=0;for(let i=1;i<r.length;i++)s+=haversine(r[i-1],r[i]);return s}
function minRouteDistanceKm(p,r){if(!r?.length)return 999;return Math.min(...r.map(q=>haversine([p.lat,p.lng],q)))}
function timeDiffMin(a,b){
  if(!a||!b)return 0;
  const [ah,am]=a.split(":").map(Number),[bh,bm]=b.split(":").map(Number);
  let d=(bh*60+bm)-(ah*60+am);if(d<0)d+=1440;return d
}

window.addEventListener("beforeunload",()=>{
  persistActive();
  if(state.watchId!=null)navigator.geolocation.clearWatch(state.watchId)
});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&state.tracking&&!state.wakeLock)requestWakeLock()
});

if("serviceWorker" in navigator){
  window.addEventListener("load",async()=>{
    try{
      const reg=await navigator.serviceWorker.register("./sw.js?v=013",{updateViaCache:"none"});
      await reg.update();
    }catch{}
  });
}

render();
initCloud(false).then(async ok=>{
  if(ok){
    try{await cloudSyncAll();render()}catch{}
  }
});
window.addEventListener("online",()=>{if(state.cloudUser)cloudSyncAll().catch(()=>{})});
})();