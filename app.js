(() => {
const SAMPLE = window.ROUTELOG_SAMPLE;
const LS = {
  trips:"routelog.trips.v001", categories:"routelog.categories.v001", tags:"routelog.tags.v001", settings:"routelog.settings.v001"
};
let state = {
  screen:"home", detailId:null,
  trips:load(LS.trips,SAMPLE.trips),
  categories:load(LS.categories,SAMPLE.categories),
  tags:load(LS.tags,SAMPLE.tags),
  settings:load(LS.settings,SAMPLE.settings),
  period:"all",
  map:null, watchId:null, tracking:false, paused:false, trackPoints:[], gpsStart:null,
  currentStay:null, stayCandidates:[],
  pickMode:null, manual:{start:null,end:null,stops:[]}
};
function load(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):structuredClone(d)}catch{return structuredClone(d)}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}
function toast(msg){const t=document.querySelector("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)}
function cat(id){return state.categories.find(c=>c.id===id)||{name:"その他",color:"#777"}}
function fmtDur(m){m=Math.round(m||0);return `${Math.floor(m/60)}時間${m%60}分`}
function dateJP(s){const d=new Date(s+"T00:00:00");return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}(${["日","月","火","水","木","金","土"][d.getDay()]})`}
function nav(active){return `<nav class="bottomnav">
  ${navBtn("home","⌂","ホーム",active)}
  ${navBtn("map","🗺","地図",active)}
  ${navBtn("record","◉","記録",active)}
  ${navBtn("manual","＋","追加",active)}
  ${navBtn("settings","⚙","設定",active)}
</nav>`}
function navBtn(s,i,l,a){return `<button class="navbtn ${a===s?"active":""}" data-nav="${s}"><span>${i}</span>${l}</button>`}
function topbar(extra=""){return `<header class="topbar"><div class="brand"><img src="./icon-192.png" alt="">RouteLog</div>${extra||`<button class="icon-btn" id="menuBtn">☰</button>`}</header>`}
function shell(content,active,extra=""){return `<div class="app-shell">${topbar(extra)}<main class="page">${content}</main>${nav(active)}</div>`}
function go(screen,detailId=null){cleanupMap();state.screen=screen;state.detailId=detailId;render();window.scrollTo(0,0)}
function cleanupMap(){if(state.map){state.map.remove();state.map=null}}
function mapBase(id,center=[35.02,135.9],zoom=10){
  const m=L.map(id,{zoomControl:true}).setView(center,zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(m);
  state.map=m; return m;
}
function tripCard(t){
  const c=cat(t.category);
  return `<article class="trip-card" data-trip="${t.id}">
    <img class="thumb" src="${t.thumb||"./hero.jpg"}" alt="">
    <div><div class="trip-date">${dateJP(t.date)}</div><div class="trip-title">${esc(t.title)}</div>
    <div class="trip-meta"><span class="pill" style="background:${c.color}18;color:${c.color}">${esc(c.name)}</span><span>${t.distanceKm||0} km</span><span>${fmtDur(t.durationMin)}</span></div></div>
    <div class="chev">›</div>
  </article>`;
}
function home(){
  const trips=[...state.trips].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  return shell(`
    <section class="hero"><img src="./hero.jpg" alt="RouteLog"></section>
    <section class="home-actions">
      <button class="big-action primary" id="startGps">▶　GPSで記録開始</button>
      <button class="big-action secondary" data-nav="manual">＋　手動で追加</button>
    </section>
    <section class="quick-grid">
      <button class="quick" data-nav="map"><span class="qicon">🗺</span>すべてのルート</button>
      <button class="quick" data-nav="calendar"><span class="qicon">▣</span>カレンダー</button>
      <button class="quick" data-nav="stats"><span class="qicon">▥</span>統計・分析</button>
    </section>
    <div class="section-head"><h2>最近の移動</h2><button class="link-btn" data-nav="map">すべて見る ›</button></div>
    <section class="trip-list">${trips.map(tripCard).join("")}</section>
  `,"home");
}
function routeMap(){
  const activeCats=state.categories.filter(c=>c.active);
  const filters=activeCats.map(c=>`<label class="filter-row"><input type="checkbox" class="catFilter" value="${c.id}" checked><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</label>`).join("");
  const html=shell(`
    <div class="map-wrap">
      <div id="allMap" class="map"></div>
      <div class="filter-card"><div class="filter-title">カテゴリ</div>${filters}</div>
    </div>
    <div class="periods">
      ${["all","1m","3m","1y"].map(p=>`<button class="chip ${state.period===p?"active":""}" data-period="${p}">${({all:"すべて", "1m":"1か月","3m":"3か月","1y":"1年"})[p]}</button>`).join("")}
    </div>
    <div class="section-head"><h2>ルート一覧</h2><span class="trip-date">${state.trips.length}件</span></div>
    <section class="trip-list">${filteredTrips().map(tripCard).join("")}</section>
    <div class="notice">地図をタップすると、その付近を通った履歴を探せます。広域では線を簡略表示し、拡大時は保存したGPS点を細かく表示する設計です。</div>
  `,"map");
  setTimeout(drawAllMap,0);return html;
}
function filteredTrips(){
  if(state.period==="all") return [...state.trips].sort((a,b)=>b.date.localeCompare(a.date));
  const days=state.period==="1m"?31:state.period==="3m"?93:365;
  const limit=new Date();limit.setDate(limit.getDate()-days);
  return state.trips.filter(t=>new Date(t.date)>=limit).sort((a,b)=>b.date.localeCompare(a.date));
}
function drawAllMap(){
  const m=mapBase("allMap",[35.4,136.2],7);
  drawVisibleRoutes();
  m.on("click",e=>{
    const hits=state.trips.filter(t=>minRouteDistanceKm(e.latlng,t.route)<3);
    if(hits.length){
      L.popup().setLatLng(e.latlng).setContent(`<b>この付近の履歴 ${hits.length}件</b><br>${hits.map(t=>`${t.date}　${esc(t.title)}`).join("<br>")}`).openOn(m);
    }else L.popup().setLatLng(e.latlng).setContent("この付近を通った記録はありません").openOn(m);
  });
}
function drawVisibleRoutes(){
  if(!state.map)return;
  state.map.eachLayer(l=>{if(l instanceof L.Polyline)state.map.removeLayer(l)});
  const checked=[...document.querySelectorAll(".catFilter:checked")].map(x=>x.value);
  filteredTrips().filter(t=>checked.includes(t.category)).forEach(t=>{
    const c=cat(t.category);
    const line=L.polyline(t.route,{color:c.color,weight:t.type==="manual"?4:5,opacity:.78,dashArray:t.type==="manual"?"8 8":null}).addTo(state.map);
    line.bindPopup(`<b>${esc(t.title)}</b><br>${dateJP(t.date)}<br>${t.type==="gps"?"GPS実測":"手動登録"}`);
  });
}
function record(){
  const html=shell(`
    <section class="stats3">
      <div class="stat"><label>経過時間</label><strong id="gpsElapsed">00:00:00</strong></div>
      <div class="stat"><label>走行距離</label><strong id="gpsDistance">0.0 km</strong></div>
      <div class="stat"><label>現在速度</label><strong id="gpsSpeed">-- km/h</strong></div>
    </section>
    <div id="recordMap" class="record-map"></div>
    <section class="panel stay-box"><h3>滞在候補（<span id="stayCount">${state.stayCandidates.length}</span>件）</h3>
      <div id="stayList">${stayListHtml()}</div></section>
    <div class="record-controls">
      <button class="btn" id="pauseGps">${state.paused?"▶ 再開":"Ⅱ 一時停止"}</button>
      <button class="btn danger" id="finishGps">● 記録終了</button>
    </div>
    ${!state.tracking?`<div class="record-controls"><button class="btn primary" id="beginGps">GPS記録を開始</button><button class="btn soft" id="demoGps">サンプル走行を追加</button></div>`:""}
  `,"record",`<div class="record-badge">${state.tracking?"記録中":"待機中"}</div>`);
  setTimeout(drawRecordMap,0);return html;
}
function drawRecordMap(){
  const center=state.trackPoints.length?state.trackPoints[state.trackPoints.length-1]:[35.003,135.875];
  const m=mapBase("recordMap",center,14);
  if(state.trackPoints.length)L.polyline(state.trackPoints,{color:"#117ff1",weight:6}).addTo(m);
  if(state.trackPoints.length)L.circleMarker(center,{radius:9,color:"#fff",weight:3,fillColor:"#117ff1",fillOpacity:1}).addTo(m);
}
function beginGps(){
  if(!navigator.geolocation){toast("この端末ではGPSを利用できません");return}
  state.tracking=true; state.paused=false; state.trackPoints=[]; state.gpsStart=Date.now();state.stayCandidates=[];
  state.watchId=navigator.geolocation.watchPosition(pos=>{
    if(state.paused)return;
    const p=[pos.coords.latitude,pos.coords.longitude];
    state.trackPoints.push(p);
    updateGpsStats(pos.coords.speed);
    detectStay(p,pos.coords.accuracy||0);
    if(state.map){
      if(state.trackPoints.length>1)L.polyline(state.trackPoints.slice(-2),{color:"#117ff1",weight:6}).addTo(state.map);
      state.map.panTo(p);
    }
  },err=>toast("GPS取得に失敗しました: "+err.message),{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
  render();
}
function updateGpsStats(speed){
  const el=document.querySelector("#gpsElapsed"),di=document.querySelector("#gpsDistance"),sp=document.querySelector("#gpsSpeed");
  if(el){const sec=Math.floor((Date.now()-state.gpsStart)/1000);el.textContent=new Date(sec*1000).toISOString().slice(11,19)}
  if(di)di.textContent=routeDistanceKm(state.trackPoints).toFixed(1)+" km";
  if(sp)sp.textContent=(speed==null?"--":Math.max(0,speed*3.6).toFixed(0))+" km/h";
}
function detectStay(p,accuracy){
  if(accuracy>Math.max(120,state.settings.stayRadius*1.8))return;
  const now=Date.now(), r=state.settings.stayRadius/1000;
  if(!state.currentStay){state.currentStay={center:p,start:now,last:now};return}
  const d=haversine(state.currentStay.center,p);
  if(d<=r){state.currentStay.last=now;return}
  const mins=(state.currentStay.last-state.currentStay.start)/60000;
  if(mins>=state.settings.stayMinutes){
    state.stayCandidates.push({name:"滞在地点候補",lat:state.currentStay.center[0],lng:state.currentStay.center[1],duration:`${Math.round(mins)}分`});
    const c=document.querySelector("#stayCount");if(c)c.textContent=state.stayCandidates.length;
    const l=document.querySelector("#stayList");if(l)l.innerHTML=stayListHtml();
  }
  state.currentStay={center:p,start:now,last:now};
}
function stayListHtml(){
  if(!state.stayCandidates.length)return `<div class="empty">まだ滞在候補はありません</div>`;
  return state.stayCandidates.map(s=>`<div class="stay-card"><img src="./hero.jpg"><div><b>${esc(s.name)}</b><br><span class="trip-date">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</span></div><b>${s.duration}</b></div>`).join("");
}
function finishGps(){
  if(state.watchId!=null)navigator.geolocation.clearWatch(state.watchId);
  state.watchId=null;state.tracking=false;
  if(state.trackPoints.length<2){toast("GPS点が少ないため保存しませんでした");state.trackPoints=[];render();return}
  const now=new Date();
  const t={id:"g"+Date.now(),date:now.toISOString().slice(0,10),title:"GPS移動記録",category:"drive",tags:[],type:"gps",
    distanceKm:Number(routeDistanceKm(state.trackPoints).toFixed(1)),durationMin:Math.max(1,Math.round((Date.now()-state.gpsStart)/60000)),
    startName:"GPS開始地点",endName:"GPS終了地点",thumb:"./hero.jpg",route:[...state.trackPoints],
    stops:state.stayCandidates.map((s,i)=>({...s,time:""}))
  };
  state.trips.push(t);save(LS.trips,state.trips);state.trackPoints=[];state.stayCandidates=[];state.currentStay=null;toast("GPS記録を保存しました");go("detail",t.id);
}
function detail(){
  const t=state.trips.find(x=>x.id===state.detailId)||state.trips[0],c=cat(t.category);
  const html=shell(`
    <section class="detail-head">
      <div class="trip-date">${dateJP(t.date)}　<span class="pill">${t.type==="gps"?"GPS実測":"手動登録"}</span></div>
      <h2>${esc(t.title)}</h2>
      <div class="tags"><span class="pill" style="background:${c.color}18;color:${c.color}">${esc(c.name)}</span>${(t.tags||[]).map(x=>`<span class="pill">${esc(x)}</span>`).join("")}</div>
      <div class="trip-meta" style="margin-top:10px"><b>${t.distanceKm} km</b><b>${fmtDur(t.durationMin)}</b></div>
    </section>
    <div class="tabs"><button class="tab active">地図</button><button class="tab">詳細</button><button class="tab">立ち寄り</button><button class="tab">メモ</button></div>
    <div id="detailMap" class="detail-map"></div>
    <section class="timeline">
      <div class="tline"><b>出発　${esc(t.startName||"")}</b></div>
      ${(t.stops||[]).map(s=>`<div class="tline"><b>${esc(s.time||"")}　${esc(s.name)}</b><div class="trip-date">${esc(s.duration||"")}</div></div>`).join("")}
      <div class="tline"><b>到着　${esc(t.endName||"")}</b></div>
    </section>
  `,"map");
  setTimeout(()=>drawDetailMap(t),0);return html;
}
function drawDetailMap(t){
  if(!t.route?.length)return;
  const m=mapBase("detailMap",t.route[0],10);
  const c=cat(t.category);const line=L.polyline(t.route,{color:c.color,weight:6,dashArray:t.type==="manual"?"8 8":null}).addTo(m);
  m.fitBounds(line.getBounds(),{padding:[24,24]});
  L.marker(t.route[0]).addTo(m).bindPopup("出発");
  L.marker(t.route[t.route.length-1]).addTo(m).bindPopup("到着");
  (t.stops||[]).forEach(s=>s.lat&&L.circleMarker([s.lat,s.lng],{radius:7,color:"#fff",weight:2,fillColor:"#ff7b16",fillOpacity:1}).addTo(m).bindPopup(esc(s.name)));
}
function manual(){
  const html=shell(`
    <div class="form">
      <div class="field"><label>日付</label><input id="mDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="two"><div class="field"><label>出発時刻</label><input id="mStartTime" type="time" value="08:00"></div><div class="field"><label>到着時刻</label><input id="mEndTime" type="time" value="12:00"></div></div>
      <div class="field"><label>出発地点</label><div class="point-field"><input id="mStartName" placeholder="例：大津市（自宅）"><button class="btn soft pick" data-pick="start">地図</button></div></div>
      <div class="field"><label>到着地点</label><div class="point-field"><input id="mEndName" placeholder="例：宇治田原ゴルフクラブ"><button class="btn soft pick" data-pick="end">地図</button></div></div>
      <div id="pickNotice" class="pick-mode">地図ボタンを押してから、地図上の地点をタップしてください。</div>
      <div id="manualMap" class="manual-map"></div>
      <button class="btn soft" id="addStop">＋ 立ち寄り地点を追加</button>
      <div id="manualStops"></div>
      <div class="field"><label>カテゴリ</label><select id="mCategory">${state.categories.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>タグ（複数選択）</label><div class="tags">${state.tags.map(t=>`<label class="pill"><input class="mTag" type="checkbox" value="${esc(t)}">${esc(t)}</label>`).join("")}</div></div>
      <div class="field"><label>タイトル</label><input id="mTitle" placeholder="例：宇治田原ゴルフクラブ"></div>
      <div class="field"><label>目的・メモ</label><textarea id="mMemo" placeholder="後から見て「なぜ通ったか」が分かる内容"></textarea></div>
      <button class="btn primary" id="saveManual">この内容で保存</button>
    </div>
  `,"manual");
  setTimeout(drawManualMap,0);return html;
}
function drawManualMap(){
  const m=mapBase("manualMap",[35.003,135.875],11);
  state.manual._markers=[];
  m.on("click",e=>{
    if(!state.pickMode){toast("先に出発地点か到着地点の「地図」を押してください");return}
    const p=[e.latlng.lat,e.latlng.lng];
    state.manual[state.pickMode]=p;
    state.manual._markers.forEach(x=>m.removeLayer(x));state.manual._markers=[];
    ["start","end"].forEach(k=>{
      if(state.manual[k])state.manual._markers.push(L.marker(state.manual[k]).addTo(m).bindPopup(k==="start"?"出発地点":"到着地点"));
    });
    if(state.manual.start&&state.manual.end)L.polyline([state.manual.start,state.manual.end],{color:"#1585ee",weight:4,dashArray:"8 8"}).addTo(m);
    document.querySelector("#pickNotice").textContent=(state.pickMode==="start"?"出発地点":"到着地点")+"を設定しました";
    state.pickMode=null;
  });
}
function saveManual(){
  const date=v("#mDate"),title=v("#mTitle")||v("#mEndName")||"手動登録",catId=v("#mCategory");
  if(!state.manual.start||!state.manual.end){toast("出発地点と到着地点を地図で指定してください");return}
  const startT=v("#mStartTime"),endT=v("#mEndTime");
  const dur=timeDiffMin(startT,endT);
  const t={id:"m"+Date.now(),date,title,category:catId,tags:[...document.querySelectorAll(".mTag:checked")].map(x=>x.value),type:"manual",
    distanceKm:Number(haversine(state.manual.start,state.manual.end).toFixed(1)),durationMin:dur,startName:v("#mStartName")||"出発地点",endName:v("#mEndName")||"到着地点",
    thumb:"./hero.jpg",route:[state.manual.start,...state.manual.stops.map(s=>[s.lat,s.lng]),state.manual.end],
    stops:state.manual.stops.map(s=>({...s,duration:"",time:""})),memo:v("#mMemo")
  };
  state.trips.push(t);save(LS.trips,state.trips);state.manual={start:null,end:null,stops:[]};toast("手動記録を保存しました");go("detail",t.id);
}
function settings(){
  return shell(`
    <section class="settings-group"><h3>滞在判定の設定</h3>
      <div class="setting-row"><div><b>滞在判定距離</b><div class="desc">この半径内に留まった場合</div></div><div><input id="stayRadius" type="number" min="10" max="1000" value="${state.settings.stayRadius}"> m</div></div>
      <div class="setting-row"><div><b>滞在判定時間</b><div class="desc">一定時間動かなければ候補化</div></div><div><input id="stayMinutes" type="number" min="1" max="1440" value="${state.settings.stayMinutes}"> 分</div></div>
    </section>
    <section class="settings-group"><h3>カテゴリ管理</h3>
      <div id="catRows">${catRows()}</div>
      <div class="add-row"><input id="newCat" placeholder="新しいカテゴリ名"><button class="btn soft" id="addCat">＋追加</button></div>
    </section>
    <section class="settings-group"><h3>タグ管理</h3>
      <div class="add-row"><input id="newTag" placeholder="新しいタグ"><button class="btn soft" id="addTag">＋追加</button></div>
      <div style="padding:0 14px 14px" class="tags">${state.tags.map(t=>`<span class="pill">${esc(t)} <button class="tagDel" data-tag="${esc(t)}" style="border:0;background:none">×</button></span>`).join("")}</div>
    </section>
    <section class="settings-group"><h3>データ管理</h3>
      <div class="setting-row"><span>サンプルデータに戻す</span><button class="btn" id="resetSample">リセット</button></div>
    </section>
  `,"settings");
}
function catRows(){return state.categories.map(c=>`<div class="cat-row"><input class="catColor" data-id="${c.id}" type="color" value="${c.color}"><b>${esc(c.name)}</b><input class="switch catActive" data-id="${c.id}" type="checkbox" ${c.active?"checked":""}><button class="btn catDel" data-id="${c.id}" style="padding:6px 9px">×</button></div>`).join("")}
function calendar(){
  const now=new Date(2026,9,1),days=new Date(2026,10,0).getDate();
  const pad=now.getDay(),map={};state.trips.forEach(t=>{if(t.date.startsWith("2026-10"))map[Number(t.date.slice(8))]=t});
  let cells="";for(let i=0;i<pad;i++)cells+=`<div></div>`;
  for(let d=1;d<=days;d++){const t=map[d];cells+=`<div class="day ${t?"has":""}"><b>${d}</b>${t?`<span style="color:${cat(t.category).color}">${esc(t.title)}</span>`:""}</div>`}
  return shell(`<div class="section-head" style="padding-top:14px"><h2>2026年10月</h2></div><div class="calendar-grid">${cells}</div>`,"home");
}
function stats(){
  const dist=state.trips.reduce((s,t)=>s+(t.distanceKm||0),0),mins=state.trips.reduce((s,t)=>s+(t.durationMin||0),0);
  const catCount={};state.trips.forEach(t=>catCount[t.category]=(catCount[t.category]||0)+1);
  return shell(`<div class="section-head" style="padding-top:14px"><h2>統計・分析</h2></div>
    <div class="metric-grid"><div class="metric"><label>総移動距離</label><strong>${dist.toFixed(0)} km</strong></div><div class="metric"><label>総移動時間</label><strong>${Math.round(mins/60)} 時間</strong></div><div class="metric"><label>記録数</label><strong>${state.trips.length} 件</strong></div><div class="metric"><label>カテゴリ数</label><strong>${Object.keys(catCount).length}</strong></div></div>
    <section class="panel"><b>カテゴリ別記録数</b>${state.categories.map(c=>`<div class="setting-row"><span><span class="dot" style="background:${c.color}"></span> ${esc(c.name)}</span><b>${catCount[c.id]||0}件</b></div>`).join("")}</section>`,"home");
}
function render(){
  cleanupMap();
  let html;
  if(state.screen==="home")html=home();
  else if(state.screen==="map")html=routeMap();
  else if(state.screen==="record")html=record();
  else if(state.screen==="manual")html=manual();
  else if(state.screen==="settings")html=settings();
  else if(state.screen==="detail")html=detail();
  else if(state.screen==="calendar")html=calendar();
  else if(state.screen==="stats")html=stats();
  document.querySelector("#app").innerHTML=html;
  bind();
}
function bind(){
  document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>go(b.dataset.nav));
  document.querySelectorAll("[data-trip]").forEach(b=>b.onclick=()=>go("detail",b.dataset.trip));
  document.querySelector("#startGps")?.addEventListener("click",()=>{go("record");setTimeout(beginGps,100)});
  document.querySelector("#beginGps")?.addEventListener("click",beginGps);
  document.querySelector("#pauseGps")?.addEventListener("click",()=>{state.paused=!state.paused;render()});
  document.querySelector("#finishGps")?.addEventListener("click",finishGps);
  document.querySelector("#demoGps")?.addEventListener("click",()=>{state.trackPoints=SAMPLE.trips[1].route.map(x=>[...x]);state.gpsStart=Date.now()-45*60000;render();toast("サンプル走行を表示しました")});
  document.querySelectorAll(".catFilter").forEach(x=>x.onchange=drawVisibleRoutes);
  document.querySelectorAll("[data-period]").forEach(x=>x.onclick=()=>{state.period=x.dataset.period;render()});
  document.querySelectorAll(".pick").forEach(x=>x.onclick=()=>{state.pickMode=x.dataset.pick;document.querySelector("#pickNotice").textContent=(state.pickMode==="start"?"出発地点":"到着地点")+"を地図上でタップしてください"});
  document.querySelector("#addStop")?.addEventListener("click",()=>{const name=prompt("立ち寄り地点名");const lat=prompt("緯度（例 35.03）");const lng=prompt("経度（例 135.93）");if(name&&lat&&lng){state.manual.stops.push({name,lat:Number(lat),lng:Number(lng)});toast("立ち寄り地点を追加しました")}});
  document.querySelector("#saveManual")?.addEventListener("click",saveManual);
  document.querySelector("#stayRadius")?.addEventListener("change",e=>{state.settings.stayRadius=Number(e.target.value);save(LS.settings,state.settings);toast("保存しました")});
  document.querySelector("#stayMinutes")?.addEventListener("change",e=>{state.settings.stayMinutes=Number(e.target.value);save(LS.settings,state.settings);toast("保存しました")});
  document.querySelectorAll(".catActive").forEach(x=>x.onchange=e=>{cat(e.target.dataset.id).active=e.target.checked;save(LS.categories,state.categories)});
  document.querySelectorAll(".catColor").forEach(x=>x.onchange=e=>{cat(e.target.dataset.id).color=e.target.value;save(LS.categories,state.categories)});
  document.querySelectorAll(".catDel").forEach(x=>x.onclick=e=>{const id=e.currentTarget.dataset.id;if(state.trips.some(t=>t.category===id)){cat(id).active=false;toast("使用中カテゴリなので非表示にしました")}else state.categories=state.categories.filter(c=>c.id!==id);save(LS.categories,state.categories);render()});
  document.querySelector("#addCat")?.addEventListener("click",()=>{const name=v("#newCat").trim();if(!name)return;state.categories.push({id:"c"+Date.now(),name,color:"#1689f5",active:true});save(LS.categories,state.categories);render()});
  document.querySelector("#addTag")?.addEventListener("click",()=>{const t=v("#newTag").trim();if(!t||state.tags.includes(t))return;state.tags.push(t);save(LS.tags,state.tags);render()});
  document.querySelectorAll(".tagDel").forEach(x=>x.onclick=e=>{state.tags=state.tags.filter(t=>t!==e.currentTarget.dataset.tag);save(LS.tags,state.tags);render()});
  document.querySelector("#resetSample")?.addEventListener("click",()=>{if(confirm("サンプルデータに戻しますか？")){Object.values(LS).forEach(k=>localStorage.removeItem(k));location.reload()}});
}
function v(sel){return document.querySelector(sel)?.value||""}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function haversine(a,b){const R=6371,toR=x=>x*Math.PI/180,dLat=toR(b[0]-a[0]),dLon=toR(b[1]-a[1]),la1=toR(a[0]),la2=toR(b[0]);const q=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(q))}
function routeDistanceKm(r){let s=0;for(let i=1;i<r.length;i++)s+=haversine(r[i-1],r[i]);return s}
function minRouteDistanceKm(p,r){if(!r?.length)return 999;return Math.min(...r.map(q=>haversine([p.lat,p.lng],q)))}
function timeDiffMin(a,b){if(!a||!b)return 0;const [ah,am]=a.split(":").map(Number),[bh,bm]=b.split(":").map(Number);let d=(bh*60+bm)-(ah*60+am);if(d<0)d+=1440;return d}
window.addEventListener("beforeunload",()=>{if(state.watchId!=null)navigator.geolocation.clearWatch(state.watchId)});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
render();
})();