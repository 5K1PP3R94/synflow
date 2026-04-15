
let currentUser=null,currentDate=todayStr(),currentTab='plan',ws=null,wsReconnectTimer=null,editingTour=null,editingUserId=null,entityMode=null,editingEntityId=null,editingOttIndex=null,editingDispatch=null,dispatchStepsDraft=[];
let toursData={vormittag:[],nachmittag:[]},ottData={eintraege:[]},meta={drivers:[],loaners:[],advisors:[]},dispatchData=[];
let vehicleJobsData=[];
let editingVehicleJobId=null;
let adminUsers=[],adminDrivers=[],adminLoaners=[];
const statusLabels={offen:'Offen',geplant:'Geplant',unterwegs:'Unterwegs',erledigt:'Erledigt'};
const vehicleJobStatusLabels={neu:'Neu',bei_serviceberater:'Beim Serviceberater',bereit_fuer_reinigung:'Bereit für Reinigung',in_reinigung:'In Reinigung',bereit_fuer_auslieferung:'Bereit für Auslieferung',abgeschlossen:'Abgeschlossen'};
function $(id){return document.getElementById(id)}
function fmtDateInput(date){const y=date.getFullYear();const m=String(date.getMonth()+1).padStart(2,'0');const d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`}
function todayStr(){return fmtDateInput(new Date())}
function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}
function fmtTime(v){if(!v)return'';return new Date(v).toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'})}
function fmtDate(v){return new Date(v+'T00:00:00').toLocaleDateString('de-AT',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'})}
function showToast(msg,error=false){const el=$('toast');el.textContent=msg;el.className='toast show'+(error?' error':'');clearTimeout(showToast.t);showToast.t=setTimeout(()=>el.className='toast',3200)}
function applyTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('synflow-theme',t);$('theme-switch').checked=t==='dark';$('theme-label').textContent=t==='dark'?'Dark':'Light'}
function toggleTheme(){applyTheme($('theme-switch').checked?'dark':'light')}
(function(){applyTheme(localStorage.getItem('synflow-theme')||'dark')})();

async function api(url,opts={}){const res=await fetch(url,opts);const data=await res.json().catch(()=>({}));if(!res.ok) throw new Error(data.error||'Fehler');return data}
async function doLogin(){
  $('login-error').style.display='none';
  try{
    const data=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('login-user').value.trim(),password:$('login-pass').value})});
    currentUser=data;
    showApp();
  }catch(e){
    $('login-error').style.display='block';
    $('login-error').textContent=e.message;
  }
}
$('login-pass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
async function doLogout(){
  await fetch('/api/logout',{method:'POST'});
  if(ws){ws.onclose=null;ws.close();}
  if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null;}
  ws=null;
  currentUser=null;
  $('app').style.display='none';
  $('login-screen').style.display='flex';
  $('login-pass').value='';
  $('login-error').style.display='none';
}

function toggleCleaningType(){
  const enabled=$('vj-cleaning-required').checked;
  $('vj-cleaning-type').disabled=!enabled;
  $('vj-cleaning-type').style.opacity=enabled?'1':'.55';
  if(!enabled) $('vj-cleaning-type').value='';
}
function openVehicleJobModal(opts={}){
  editingVehicleJobId=opts.id||null;
  const row=editingVehicleJobId?vehicleJobsData.find(v=>v.id===editingVehicleJobId):null;
  $('vehicle-job-title').textContent=editingVehicleJobId?'Fahrzeugvorgang bearbeiten':'Fahrzeugvorgang anlegen';
  $('vehicle-job-error').style.display='none';
  $('vj-customer-name').value=row?.customer_name||'';
  $('vj-plate').value=row?.plate||'';
  $('vj-vehicle-label').value=row?.vehicle_label||'';
  $('vj-phone').value=row?.phone||'';
  $('vj-advisor-user-id').innerHTML='<option value="">– kein Serviceberater –</option>'+(meta.advisors||[]).map(a=>`<option value="${a.id}">${esc(a.display_name)}</option>`).join('');
  $('vj-advisor-user-id').value=row?.advisor_user_id||'';
  $('vj-hb-required').checked=row?!!row.hb_required:(opts.source==='advisor'?false:true);
  $('vj-pickup-required').checked=row?!!row.pickup_required:(opts.source==='advisor'?false:true);
  $('vj-delivery-required').checked=row?!!row.delivery_required:(opts.source==='advisor'?false:true);
  $('vj-pickup-address').value=row?.pickup_address||'';
  $('vj-delivery-address').value=row?.delivery_address||'';
  $('vj-cleaning-required').checked=row?!!row.cleaning_required:false;
  $('vj-cleaning-type').value=row?.cleaning_type||'';
  $('vj-deadline').value=row?.deadline||'';
  $('vj-notes').value=row?.notes||'';
  toggleCleaningType();
  $('vehicle-job-modal').style.display='flex';
}
async function saveVehicleJob(){
  $('vehicle-job-error').style.display='none';
  const body={
    customer_name:$('vj-customer-name').value.trim(),
    plate:$('vj-plate').value.trim(),
    vehicle_label:$('vj-vehicle-label').value.trim(),
    phone:$('vj-phone').value.trim(),
    advisor_user_id:$('vj-advisor-user-id').value?Number($('vj-advisor-user-id').value):null,
    hb_required:$('vj-hb-required').checked,
    pickup_required:$('vj-pickup-required').checked,
    delivery_required:$('vj-delivery-required').checked,
    pickup_address:$('vj-pickup-address').value.trim(),
    delivery_address:$('vj-delivery-address').value.trim(),
    cleaning_required:$('vj-cleaning-required').checked,
    cleaning_type:$('vj-cleaning-type').value.trim(),
    deadline:$('vj-deadline').value,
    notes:$('vj-notes').value.trim()
  };
  try{
    const url=editingVehicleJobId?`/api/vehicle-jobs/${editingVehicleJobId}`:'/api/vehicle-jobs';
    const method=editingVehicleJobId?'PUT':'POST';
    const row=await api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const idx=vehicleJobsData.findIndex(v=>v.id===row.id);
    if(idx>=0) vehicleJobsData[idx]=row; else vehicleJobsData.unshift(row);
    closeModal('vehicle-job-modal');
    renderVehicleJobsDispo();renderVehicleJobsAdvisor();renderVehicleJobsDetailing();
    showToast(editingVehicleJobId?'Fahrzeugvorgang gespeichert':'Fahrzeugvorgang angelegt');
  }catch(e){
    $('vehicle-job-error').style.display='block';
    $('vehicle-job-error').textContent=e.message;
  }
}
async function changeVehicleJobStatus(id,status,note=''){
  try{
    const row=await api(`/api/vehicle-jobs/${id}/status`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,note})});
    const idx=vehicleJobsData.findIndex(v=>v.id===row.id);
    if(idx>=0) vehicleJobsData[idx]=row; else vehicleJobsData.unshift(row);
    renderVehicleJobsDispo();renderVehicleJobsAdvisor();renderVehicleJobsDetailing();
    showToast('Status aktualisiert');
  }catch(e){showToast(e.message,true);}
}
function vehicleJobBadges(job){
  const parts=[];
  if(job.hb_required) parts.push('<span class="job-pill">H&B</span>');
  if(job.pickup_required) parts.push('<span class="job-pill">Abholung</span>');
  if(job.delivery_required) parts.push('<span class="job-pill">Auslieferung</span>');
  if(job.cleaning_required) parts.push(`<span class="job-pill">Reinigung${job.cleaning_type?`: ${esc(job.cleaning_type)}`:''}</span>`);
  return parts.join('');
}
function vehicleJobHistoryHtml(job){
  const items=(job.history||[]).slice(0,3);
  if(!items.length) return '<div class="job-history-item">Noch keine Historie</div>';
  return items.map(h=>`<div class="job-history-item"><strong>${esc(vehicleJobStatusLabels[h.status]||h.status)}</strong>${h.note?` · ${esc(h.note)}`:''}<br>${esc(h.changed_by_display||'')} · ${esc((h.created_at||'').replace('T',' ').slice(0,16))}</div>`).join('');
}
function renderVehicleJobCard(job,scope){
  const advisor=job.advisor?job.advisor.display_name:'–';
  let actions='';
  if(scope==='dispo'){
    actions+=`<button class="panel-btn btn-sm" onclick="openVehicleJobModal({id:${job.id}})">Bearbeiten</button>`;
    if(job.status==='neu') actions+=`<button class="btn btn-primary btn-sm" onclick="changeVehicleJobStatus(${job.id},'bei_serviceberater')">An Service</button>`;
    if(job.status==='bereit_fuer_auslieferung') actions+=`<button class="btn btn-primary btn-sm" onclick="changeVehicleJobStatus(${job.id},'abgeschlossen')">Abschließen</button>`;
  }
  if(scope==='advisor'){
    actions+=`<button class="panel-btn btn-sm" onclick="openVehicleJobModal({id:${job.id}})">Bearbeiten</button>`;
    if(job.cleaning_required && job.status==='bei_serviceberater') actions+=`<button class="btn btn-primary btn-sm" onclick="changeVehicleJobStatus(${job.id},'bereit_fuer_reinigung')">Zur Reinigung</button>`;
    if((!job.cleaning_required) && job.status==='bei_serviceberater') actions+=`<button class="btn btn-primary btn-sm" onclick="changeVehicleJobStatus(${job.id},'bereit_fuer_auslieferung')">Zur Dispo</button>`;
  }
  if(scope==='detailing'){
    if(job.status==='bereit_fuer_reinigung') actions+=`<button class="btn btn-primary btn-sm" onclick="changeVehicleJobStatus(${job.id},'in_reinigung')">Reinigung starten</button>`;
    if(job.status==='in_reinigung') actions+=`<button class="btn btn-primary btn-sm" onclick="changeVehicleJobStatus(${job.id},'bereit_fuer_auslieferung')">Reinigung fertig</button>`;
  }
  return `<div class="job-card">
    <div class="job-card-head">
      <div><div class="job-card-title">${esc(job.customer_name)}</div><div class="job-card-sub">${esc(job.vehicle_label)} · ${esc(job.plate)}</div></div>
      <div class="job-status ${job.status}">${esc(vehicleJobStatusLabels[job.status]||job.status)}</div>
    </div>
    <div class="job-badges">${vehicleJobBadges(job)}</div>
    <div class="job-card-sub">Serviceberater: <strong>${esc(advisor)}</strong>${job.deadline?` · Fertig bis ${esc(job.deadline.replace('T',' '))}`:''}</div>
    ${job.phone?`<div class="job-card-sub">Telefon: ${esc(job.phone)}</div>`:''}
    ${job.pickup_address?`<div class="job-card-sub">Abholung: ${esc(job.pickup_address)}</div>`:''}
    ${job.delivery_address?`<div class="job-card-sub">Lieferung: ${esc(job.delivery_address)}</div>`:''}
    <div class="job-history">${vehicleJobHistoryHtml(job)}</div>
    <div class="job-card-actions">${actions||'<div class="job-card-sub">Keine Aktion in diesem Bereich.</div>'}</div>
  </div>`;
}
function renderVehicleJobsDispo(){
  const wrap=$('vehicle-jobs-dispo'); if(!wrap) return;
  const rows=(vehicleJobsData||[]).filter(j=>j.status!=='abgeschlossen');
  wrap.innerHTML=rows.length?rows.map(j=>renderVehicleJobCard(j,'dispo')).join(''):'<div class="empty-state">Noch keine Fahrzeugvorgänge vorhanden.</div>';
}
function renderVehicleJobsAdvisor(){
  const wrap=$('vehicle-jobs-advisor'); if(!wrap) return;
  const addBtn=$('btn-advisor-job-add'); if(addBtn) addBtn.classList.toggle('hidden',!hasModule('kundendienstberater','edit'));
  const rows=(vehicleJobsData||[]).filter(j=>j.advisor_user_id===currentUser?.id && ['bei_serviceberater','bereit_fuer_reinigung','bereit_fuer_auslieferung'].includes(j.status));
  wrap.innerHTML=rows.length?rows.map(j=>renderVehicleJobCard(j,'advisor')).join(''):'<div class="empty-state">Derzeit keine Fahrzeuge für dich.</div>';
}
function renderVehicleJobsDetailing(){
  const wrap=$('vehicle-jobs-detailing'); if(!wrap) return;
  const rows=(vehicleJobsData||[]).filter(j=>j.cleaning_required && ['bereit_fuer_reinigung','in_reinigung'].includes(j.status));
  wrap.innerHTML=rows.length?rows.map(j=>renderVehicleJobCard(j,'detailing')).join(''):'<div class="empty-state">Aktuell keine Fahrzeuge in der digitalen Reinigungsliste.</div>';
}

async function init(){try{currentUser=await api('/api/me');showApp()}catch{}}

// FIX #1: WebSocket-Reconnect baut keine doppelten Verbindungen auf
function connectWS(){
  if(ws&&(ws.readyState===WebSocket.CONNECTING||ws.readyState===WebSocket.OPEN)) return;
  const proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(`${proto}://${location.host}`);
  ws.onopen=()=>{$('live-pill').classList.remove('hidden');if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null;}};
  ws.onclose=()=>{
    ws=null;
    $('live-pill').classList.add('hidden');
    if(currentUser) wsReconnectTimer=setTimeout(connectWS,2500);
  };
  ws.onerror=()=>{try{ws.close();}catch{}};
  ws.onmessage=e=>{
    try{const msg=JSON.parse(e.data);
    if(msg.type==='tour_updated'&&msg.data.date===currentDate){const arr=toursData[msg.data.slot];const idx=arr.findIndex(t=>t.tour_nr===msg.data.tour_nr);if(idx>=0)arr[idx]=msg.data;else arr.push(msg.data);renderTours();renderDispatch();}
    if(msg.type==='ottenschlag_updated'&&msg.data.date===currentDate){ottData=msg.data;renderOtt();}
    if(['drivers_updated','loaners_updated'].includes(msg.type)){loadMeta().then(()=>{renderTours();renderDispatch();if(currentTab==='admin')loadAdmin();});}
    if(msg.type==='dispatch_updated'&&msg.data.date===currentDate){const idx=dispatchData.findIndex(x=>x.slot===msg.data.slot&&x.driver_id===msg.data.driver_id);if(idx>=0)dispatchData[idx]=msg.data;else dispatchData.push(msg.data);renderDispatch();}
    if(msg.type==='vehicle_job_updated'){const idx=vehicleJobsData.findIndex(x=>x.id===msg.data.id);if(idx>=0)vehicleJobsData[idx]=msg.data;else vehicleJobsData.unshift(msg.data);renderVehicleJobsDispo();renderVehicleJobsAdvisor();renderVehicleJobsDetailing();}
    }catch{}
  };
}

function hasModule(moduleKey,level='view'){
  if(!currentUser) return false;
  if(currentUser.role==='admin') return true;
  const p=(currentUser.permissions||{})[moduleKey];
  if(!p) return false;
  if(level==='view') return !!(p.can_view||p.can_edit||p.can_manage);
  if(level==='edit') return !!(p.can_edit||p.can_manage);
  if(level==='manage') return !!p.can_manage;
  return false;
}

function visibleTabs(){
  return [
    hasModule('dispo_holbring','view')&&'plan',
    hasModule('dispo_holbring','view')&&'dispatch',
    hasModule('dispo_holbring','view')&&'jobs',
    hasModule('holbring_driver','view')&&'driver',
    hasModule('kundendienstberater','view')&&'advisor',
    hasModule('fahrzeugaufbereitung','view')&&'detailing',
    currentUser&&currentUser.role==='admin'&&'admin'
  ].filter(Boolean);
}

async function showApp(){
  $('login-screen').style.display='none';
  $('app').style.display='block';
  $('hdr-user').textContent=currentUser.display_name||currentUser.username;
  $('hdr-role').textContent=currentUser.role==='admin'?'Admin':'Benutzer';
  $('date-input').value=currentDate;
  ['plan','dispatch','jobs','driver','advisor','detailing','admin'].forEach(tab=>{const el=$('tab-'+tab);if(el)el.classList.add('hidden');});
  $('admin-entry').classList.toggle('hidden',!(currentUser&&currentUser.role==='admin'));
  for(const tab of visibleTabs()){const el=$('tab-'+tab);if(el)el.classList.remove('hidden');}
  if(!visibleTabs().includes(currentTab)) currentTab=visibleTabs()[0]||'advisor';
  await loadDate(currentDate);
  showTab(currentTab);
  connectWS();
}

async function loadMeta(){
  try{meta=await api('/api/meta');}catch{meta={drivers:[],loaners:[],advisors:[]};}
  if(!meta.drivers) meta.drivers=[];
  if(!meta.loaners) meta.loaners=[];
  if(!meta.advisors) meta.advisors=[];
}

let driverData={driver:null,sheets:[],tours:[]};
async function loadDate(dateStr){
  currentDate=dateStr;$('date-input').value=dateStr;
  const dtEl=$('dispatch-date-title');if(dtEl)dtEl.textContent=fmtDate(dateStr);
  const drEl=$('driver-date-title');if(drEl)drEl.textContent=fmtDate(dateStr);
  await loadMeta();
  const jobs=[];
  if(hasModule('dispo_holbring','view'))
    jobs.push(Promise.all([api(`/api/tours/${dateStr}`),api(`/api/ottenschlag/${dateStr}`),api(`/api/dispatch/${dateStr}`)]).then(([t,o,d])=>{toursData=t;ottData=o;dispatchData=d;}));
  else{toursData={vormittag:[],nachmittag:[]};ottData={eintraege:[]};dispatchData=[];}
  if(hasModule('holbring_driver','view'))
    jobs.push(api(`/api/my-dispatch/${dateStr}`).then(data=>{driverData=data;}));
  else driverData={driver:null,sheets:[],tours:[]};
  if(hasModule('dispo_holbring','view')||hasModule('kundendienstberater','view')||hasModule('fahrzeugaufbereitung','view'))
    jobs.push(api(`/api/vehicle-jobs?scope=open`).then(data=>{vehicleJobsData=data;}));
  else vehicleJobsData=[];
  await Promise.all(jobs);
  if(hasModule('dispo_holbring','view')){renderTours();renderOtt();renderDispatch();renderVehicleJobsDispo();}
  if(hasModule('holbring_driver','view')) renderDriverView();
  if(hasModule('kundendienstberater','view')) renderVehicleJobsAdvisor();
  if(hasModule('fahrzeugaufbereitung','view')) renderVehicleJobsDetailing();
  if(currentTab==='admin' && currentUser?.role==='admin') loadAdmin();
}

function changeDate(delta){const base=$('date-input').value||currentDate||todayStr();const parts=base.split('-').map(Number);if(parts.length!==3||parts.some(Number.isNaN)) return loadDate(todayStr());const d=new Date(parts[0],parts[1]-1,parts[2],12,0,0);d.setDate(d.getDate()+Number(delta||0));loadDate(fmtDateInput(d))}

function showTab(name){
  if(!visibleTabs().includes(name)) name=visibleTabs()[0]||'advisor';
  currentTab=name;
  ['plan','dispatch','jobs','driver','advisor','detailing','admin'].forEach(tab=>{
    const b=$('tab-'+tab),v=$('view-'+tab);
    if(b) b.classList.toggle('active',tab===name);
    if(v) v.classList.toggle('hidden',tab!==name);
  });
  if(name==='admin' && currentUser?.role==='admin') loadAdmin();
  if(name==='driver') renderDriverView();
  if(name==='jobs') renderVehicleJobsDispo();
  if(name==='advisor') renderVehicleJobsAdvisor();
  if(name==='detailing') renderVehicleJobsDetailing();
}

function getStatusPill(status){return `<span class="status-pill ${status}">${statusLabels[status]||status}</span>`}
function getLoanerLabel(t){if(!t.loaner_required) return '<span class="meta-pill">LW: <strong>nicht nötig</strong></span>';if(t.loaner_vehicle) return `<span class="meta-pill">LW: <strong>${esc(t.loaner_vehicle.name)}</strong></span>`;return '<span class="meta-pill" style="border-color:var(--warning);color:var(--warning)">LW offen</span>'}
function cardBlock(title,time,customer,address,vehicle,phone){const has=customer||address||vehicle||phone||time;return `<div class="mini-card"><div class="mini-head"><span>${title}</span><span>${esc(time||'')}</span></div><div class="mini-value ${has?'':'empty'}">${has?[customer&&`<strong>${esc(customer)}</strong>`,vehicle&&`<div>${esc(vehicle)}</div>`,address&&`<div>${esc(address)}</div>`,phone&&`<div>☎ ${esc(phone)}</div>`].filter(Boolean).join(''):'– frei –'}</div></div>`;}

function renderTours(){
  if(!hasModule('dispo_holbring','view')) return;
  ['vormittag','nachmittag'].forEach(slot=>{
    const grid=$('grid-'+slot);if(!grid) return;grid.innerHTML='';
    for(let nr=1;nr<=4;nr++){
      const t=(toursData[slot]||[]).find(x=>x.tour_nr===nr)||{date:currentDate,slot,tour_nr:nr,status:'offen'};
      const el=document.createElement('div');
      el.className=`tour-card status-${t.status||'offen'} ${t.gesperrt?'gesperrt':''}`;
      el.innerHTML=`<div class="tour-top"><div><div class="tour-title">Tour ${nr}</div><div class="tour-sub">${slot}</div></div>${getStatusPill(t.status||'offen')}</div><div class="tour-body">${cardBlock('Liefern',t.deliver_time,t.deliver_customer,t.deliver_address,t.deliver_vehicle,t.deliver_phone)}${cardBlock('Abholen',t.pickup_time,t.pickup_customer,t.pickup_address,t.pickup_vehicle,t.pickup_phone)}</div><div style="padding:0 14px 14px"><div class="tour-meta">${t.driver?`<span class="meta-pill">Fahrer: <strong>${esc(t.driver.name)}</strong></span>`:''}${getLoanerLabel(t)}${t.notes?`<span class="meta-pill">Notiz: <strong>${esc(t.notes)}</strong></span>`:''}${t.gesperrt?`<span class="meta-pill" style="border-color:var(--danger);color:#fff;background:var(--danger)">Tour gesperrt</span>`:''}</div></div><button class="panel-btn btn-sm" style="position:absolute;right:10px;bottom:10px" ${hasModule('dispo_holbring','edit')?'':'disabled'} onclick="openTourModal('${slot}',${nr})">Bearbeiten</button>`;
      grid.appendChild(el);
    }
  });
}

function openTourModal(slot,nr){
  if(!hasModule('dispo_holbring','edit')) return;
  const t=(toursData[slot]||[]).find(x=>x.tour_nr===nr)||{slot,tour_nr:nr};
  editingTour={slot,nr};
  $('tour-modal-title').textContent=`Tour ${nr} – ${slot}`;
  $('m-status').value=t.status||'offen';
  $('m-driver').innerHTML='<option value="">– kein Fahrer –</option>'+(meta.drivers||[]).map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');
  $('m-driver').value=t.driver_id||'';
  $('m-loaner-required').checked=!!t.loaner_required;
  $('m-loaner').innerHTML='<option value="">– kein Leihwagen –</option>'+(meta.loaners||[]).map(l=>`<option value="${l.id}">${esc(l.name)}${l.plate?` (${esc(l.plate)})`:''}` +'</option>').join('');
  // FIX #7: loaner_vehicle_id nur setzen wenn loaner_required
  $('m-loaner').value=(t.loaner_required&&t.loaner_vehicle_id)?t.loaner_vehicle_id:'';
  toggleLoanerSelect();
  $('m-gesperrt').checked=!!t.gesperrt;
  ['deliver-customer','deliver-address','deliver-vehicle','deliver-time','deliver-phone','pickup-customer','pickup-address','pickup-vehicle','pickup-time','pickup-phone','notes'].forEach(key=>{
    const el=$('m-'+key);if(el) el.value=t[key.replace(/-/g,'_')]||'';
  });
  $('tour-modal').style.display='flex';
}

function toggleLoanerSelect(){const enabled=$('m-loaner-required').checked;$('m-loaner').disabled=!enabled;$('m-loaner').style.opacity=enabled?'1':'.55';if(!enabled)$('m-loaner').value='';}

async function saveTour(){
  try{
    // FIX #7: loaner_vehicle_id explizit null wenn loaner nicht required
    const loanerRequired=$('m-loaner-required').checked;
    const body={
      status:$('m-status').value,
      driver_id:$('m-driver').value?Number($('m-driver').value):null,
      loaner_required:loanerRequired,
      loaner_vehicle_id:loanerRequired&&$('m-loaner').value?Number($('m-loaner').value):null,
      gesperrt:$('m-gesperrt').checked,
      deliver_customer:$('m-deliver-customer').value,
      deliver_address:$('m-deliver-address').value,
      deliver_vehicle:$('m-deliver-vehicle').value,
      deliver_time:$('m-deliver-time').value,
      deliver_phone:$('m-deliver-phone').value,
      pickup_customer:$('m-pickup-customer').value,
      pickup_address:$('m-pickup-address').value,
      pickup_vehicle:$('m-pickup-vehicle').value,
      pickup_time:$('m-pickup-time').value,
      pickup_phone:$('m-pickup-phone').value,
      notes:$('m-notes').value
    };
    const updated=await api(`/api/tours/${currentDate}/${editingTour.slot}/${editingTour.nr}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const arr=toursData[editingTour.slot];const idx=arr.findIndex(t=>t.tour_nr===editingTour.nr);
    if(idx>=0) arr[idx]=updated;else arr.push(updated);
    renderTours();renderDispatch();closeModal('tour-modal');showToast('Tour gespeichert');
  }catch(e){showToast(e.message,true);}
}

function getDispatchSheet(slot,driverId){return dispatchData.find(x=>x.slot===slot&&x.driver_id===driverId)||{slot,driver_id:driverId,deliver_refs:[],pickup_refs:[],steps:[],notes:''}}
function getTourByNr(slot,nr){return (toursData[slot]||[]).find(t=>Number(t.tour_nr)===Number(nr))||null}
function getDispatchStepSummary(step,slot){
  if(step.type==='free_text') return {title:'Freitext',body:`<div class="dispatch-preview-note">${esc(step.text||'')}</div>`};
  const t=getTourByNr(slot,step.tour_nr);
  if(step.type==='deliver_tour') return {title:`Lieferung · Tour ${step.tour_nr}`,body:t?`<strong>${esc(t.deliver_vehicle||'–')}</strong><br>${esc(t.deliver_customer||'')}${t.deliver_phone?` · ${esc(t.deliver_phone)}`:''}<br><span style="color:var(--muted)">${esc(t.deliver_address||'')}</span>`:'Tourdaten nicht gefunden'};
  return {title:`Abholung · Tour ${step.tour_nr}`,body:t?`<strong>${esc(t.pickup_vehicle||'–')}</strong><br>${esc(t.pickup_customer||'')}${t.pickup_phone?` · ${esc(t.pickup_phone)}`:''}<br><span style="color:var(--muted)">${esc(t.pickup_address||'')}</span>`:'Tourdaten nicht gefunden'};
}
function getDispatchStepPlain(step,slot){
  if(step.type==='free_text') return {title:'Freitext',lines:[String(step.text||'').trim()||'-']};
  const t=getTourByNr(slot,step.tour_nr);
  if(!t) return {title:(step.type==='deliver_tour'?`Lieferung - Tour ${step.tour_nr}`:`Abholung - Tour ${step.tour_nr}`),lines:['Tourdaten nicht gefunden']};
  if(step.type==='deliver_tour') return {title:`Lieferung - Tour ${step.tour_nr}`,lines:[t.deliver_vehicle||'-',[t.deliver_customer||'',t.deliver_phone||''].filter(Boolean).join(' - ')||'-',t.deliver_address||'-']};
  return {title:`Abholung - Tour ${step.tour_nr}`,lines:[t.pickup_vehicle||'-',[t.pickup_customer||'',t.pickup_phone||''].filter(Boolean).join(' - ')||'-',t.pickup_address||'-']};
}

function renderDispatchCard(slot,driver){
  const sheet=getDispatchSheet(slot,driver.id);const steps=(sheet.steps||[]);
  const rows=steps.length?steps.map((step,i)=>{const s=getDispatchStepSummary(step,slot);return `<div class="dispatch-row"><strong>${i+1}. ${s.title}</strong><br>${s.body}</div>`}).join(''):'<div class="dispatch-row" style="color:var(--muted)">Noch kein Ablauf definiert</div>';
  return `<div class="dispatch-card"><h4>${esc(driver.name)}</h4><small>${fmtDate(currentDate)} · ${slot}</small><div class="dispatch-list">${rows}</div><div class="dispatch-actions"><button class="panel-btn btn-sm" ${hasModule('dispo_holbring','edit')?'':'disabled'} onclick="openDispatchModal('${slot}',${driver.id})">Bearbeiten</button><button class="btn btn-sm pdf-btn" onclick="exportDispatchPdf('${slot}',${driver.id})">PDF exportieren</button></div></div>`;
}
function renderDispatch(){
  const addBtn=$('btn-dispatch-add-driver');if(addBtn) addBtn.classList.toggle('hidden',!(currentUser&&currentUser.role==='admin'));
  ['vormittag','nachmittag'].forEach(slot=>{
    const wrap=$('dispatch-'+slot);if(!wrap) return;
    const drivers=(meta.drivers||[]).filter(d=>d&&d.active);
    if(!drivers.length){wrap.innerHTML=`<div class="dispatch-card"><h4>Keine aktiven Fahrer</h4><small>Lege zuerst einen Fahrer in der Verwaltung an oder aktiviere einen bestehenden Fahrer.</small></div>`;return;}
    wrap.innerHTML=drivers.map(d=>renderDispatchCard(slot,d)).join('');
  });
}

function refreshDispatchAddUi(){
  const type=$('dispatch-add-type').value;
  const tourWrap=$('dispatch-add-tour-wrap');const textWrap=$('dispatch-add-text-wrap');
  if(type==='free_text'){tourWrap.classList.add('hidden');tourWrap.style.display='none';textWrap.classList.remove('hidden');textWrap.style.display='grid';setTimeout(()=>$('dispatch-add-text').focus(),0);}
  else{textWrap.classList.add('hidden');textWrap.style.display='none';tourWrap.classList.remove('hidden');tourWrap.style.display='grid';
    const slot=editingDispatch?.slot||'vormittag';const label=tourWrap.querySelector('label');
    if(label) label.textContent=type==='deliver_tour'?'Liefer-Tour':'Abhol-Tour';
    const options=(toursData[slot]||[]).map(t=>`<option value="${t.tour_nr}">Tour ${t.tour_nr} · ${esc(type==='deliver_tour'?(t.deliver_vehicle||t.deliver_customer||'leer'):(t.pickup_vehicle||t.pickup_customer||'leer'))}</option>`).join('');
    $('dispatch-add-tour').innerHTML=options||'<option value="">Keine passenden Touren</option>';
  }
}
function renderDispatchStepsEditor(){const list=$('dispatch-steps-list');if(!dispatchStepsDraft.length){list.innerHTML='<div class="dispatch-row" style="color:var(--muted)">Noch keine Schritte hinzugefügt.</div>';return;}list.innerHTML=dispatchStepsDraft.map((step,i)=>{const s=getDispatchStepSummary(step,editingDispatch.slot);return `<div class="dispatch-step"><div class="dispatch-step-index">${i+1}</div><div><div class="dispatch-step-title">${s.title}</div><div>${s.body}</div></div><div class="dispatch-step-actions"><button type="button" class="panel-btn btn-sm" ${i===0?'disabled':''} onclick="moveDispatchStep(${i},-1)">↑</button><button type="button" class="panel-btn btn-sm" ${i===dispatchStepsDraft.length-1?'disabled':''} onclick="moveDispatchStep(${i},1)">↓</button><button type="button" class="btn btn-danger btn-sm" onclick="removeDispatchStep(${i})">✕</button></div></div>`;}).join('');}
function openDispatchModal(slot,driverId){if(!hasModule('dispo_holbring','edit')) return;editingDispatch={slot,driverId};const driver=(meta.drivers||[]).find(d=>d.id===driverId);const sheet=getDispatchSheet(slot,driverId);dispatchStepsDraft=Array.isArray(sheet.steps)?sheet.steps.map(s=>({...s})):[];$('dispatch-modal-title').textContent=`Fahrbefehl – ${driver.name} – ${slot}`;$('dispatch-add-type').value='deliver_tour';$('dispatch-add-text').value='';refreshDispatchAddUi();renderDispatchStepsEditor();$('dispatch-modal').style.display='flex';}
function addDispatchStep(){const type=$('dispatch-add-type').value;if(type==='free_text'){const txt=$('dispatch-add-text').value.trim();if(!txt) return showToast('Bitte Freitext eingeben',true);dispatchStepsDraft.push({type:'free_text',text:txt});$('dispatch-add-text').value='';}else{const nr=Number($('dispatch-add-tour').value);if(!nr) return showToast('Bitte Tour wählen',true);dispatchStepsDraft.push({type,tour_nr:nr});}renderDispatchStepsEditor();}
function moveDispatchStep(index,dir){const target=index+dir;if(target<0||target>=dispatchStepsDraft.length) return;const [item]=dispatchStepsDraft.splice(index,1);dispatchStepsDraft.splice(target,0,item);renderDispatchStepsEditor();}
function removeDispatchStep(index){dispatchStepsDraft.splice(index,1);renderDispatchStepsEditor();}
async function saveDispatch(){try{const body={steps:dispatchStepsDraft};const updated=await api(`/api/dispatch/${currentDate}/${editingDispatch.slot}/${editingDispatch.driverId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const idx=dispatchData.findIndex(x=>x.slot===updated.slot&&x.driver_id===updated.driver_id);if(idx>=0)dispatchData[idx]=updated;else dispatchData.push(updated);renderDispatch();closeModal('dispatch-modal');showToast('Fahrbefehl gespeichert');}catch(e){showToast(e.message,true);}}

async function exportDispatchPdf(slot,driverId){
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF({unit:'mm',format:'a4'});
  const pageH=297,left=15,boxW=180,bottom=18;
  const sheet=getDispatchSheet(slot,driverId);
  const driver=sheet.driver||meta.drivers.find(d=>d.id===driverId);
  const clean=(txt)=>String(txt||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').replace(/[\x00-\x1F]+/g,' ').replace(/\s{2,}/g,' ').trim();
  let y=18;
  const ensure=(needed)=>{if(y+needed>pageH-bottom){pdf.addPage();y=18;}};
  pdf.setFont('helvetica','bold');pdf.setFontSize(20);pdf.text('SynFlow – Fahrbefehl',left,y);y+=9;
  pdf.setFontSize(13);pdf.text(`Fahrer: ${driver?.name||'-'}`,left,y);y+=7;
  pdf.text(`Datum: ${fmtDate(currentDate)}`,left,y);y+=7;
  pdf.text(`Zeitfenster: ${slot.charAt(0).toUpperCase()+slot.slice(1)}`,left,y);y+=10;
  const steps=sheet.steps||[];
  if(!steps.length){pdf.setFont('helvetica','normal');pdf.setFontSize(11);pdf.text('Keine Schritte definiert.',left,y);}
  else{
    const lineH=5;
    steps.forEach((step,i)=>{
      const summary=getDispatchStepSummary(step,slot);
      const title=`${i+1}. ${summary.title}`;
      const bodyText=clean(summary.body||'');
      pdf.setFont('helvetica','bold');pdf.setFontSize(11);
      const titleLines=pdf.splitTextToSize(title,boxW-6);
      pdf.setFont('helvetica','normal');pdf.setFontSize(10.5);
      const bodyLines=pdf.splitTextToSize(bodyText||' ',boxW-6);
      const boxH=Math.max(20,8+titleLines.length*lineH+bodyLines.length*lineH);
      ensure(boxH+5);
      pdf.setDrawColor(180);pdf.rect(left,y,boxW,boxH);
      pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.text(titleLines,left+3,y+6);
      const bodyY=y+6+(titleLines.length*lineH)+2;
      pdf.setFont('helvetica','normal');pdf.setFontSize(10.5);pdf.text(bodyLines,left+3,bodyY);
      y+=boxH+5;
    });
  }
  pdf.save(`synflow-fahrbefehl-${driver?.name||'fahrer'}-${currentDate}-${slot}.pdf`);
}

// FIX #9: Driver-Hint aus API anzeigen
function renderDriverView(){
  const empty=$('driver-empty'),cards=$('driver-cards');
  if(!cards) return;
  if(!driverData.driver){
    empty.style.display='block';
    empty.textContent=driverData.hint||'Kein Fahrer mit diesem Login verknüpft.';
    cards.innerHTML='';return;
  }
  empty.style.display='none';
  const bySlot={vormittag:null,nachmittag:null};
  for(const s of (driverData.sheets||[])) bySlot[s.slot]=s;
  cards.innerHTML=['vormittag','nachmittag'].map(slot=>{
    const sheet=bySlot[slot];
    const rows=(sheet?.steps||[]).length?sheet.steps.map((step,i)=>{const s=getDispatchStepSummary(step,slot);return `<div class="dispatch-row"><strong>${i+1}. ${s.title}</strong><br>${s.body}</div>`;}).join(''):'<div class="dispatch-row" style="color:var(--muted)">Kein digitaler Fahrbefehl hinterlegt.</div>';
    return `<div class="dispatch-card driver-mobile-card"><h4>${slot==='vormittag'?'Vormittag':'Nachmittag'}</h4><small>${esc(driverData.driver.name)} · ${fmtDate(currentDate)}</small><div class="dispatch-list">${rows}</div></div>`;
  }).join('');
}

async function loadAdmin(){
  if(currentUser.role!=='admin') return;
  const [users,drivers,loaners]=await Promise.all([api('/api/users'),api('/api/drivers'),api('/api/loaners')]);
  adminUsers=users;adminDrivers=drivers;adminLoaners=loaners;
  // FIX #4/#5: Vollständige User-Tabelle mit allen Feldern
  $('users-tbody').innerHTML=users.map(u=>{
    const chips=[];
    Object.entries(u.permissions||{}).forEach(([key,p])=>{if(p.can_view||p.can_edit||p.can_manage){const label={dispo_holbring:'Dispo',holbring_driver:'Fahrer',kundendienstberater:'KD',fahrzeugaufbereitung:'Aufbereitung'}[key]||key;const lvl=p.can_manage?'verwalten':p.can_edit?'bearbeiten':'sehen';chips.push(`<span class="permission-chip">${label}: ${lvl}</span>`);}});
    const linked=adminDrivers.find(d=>d.id===u.driver_id);
    return `<tr><td><strong>${esc(u.display_name||u.username)}</strong><br><small style="color:var(--muted)">${esc(u.username)}</small></td><td>${chips.join('')||'<span style="color:var(--muted)">–</span>'}</td><td>${linked?esc(linked.name):'<span style="color:var(--muted)">–</span>'}</td><td>${u.active?'aktiv':'inaktiv'}</td><td><div class="cluster"><button class="panel-btn btn-sm" onclick="openUserModal(${u.id})">Bearbeiten</button><button class="btn btn-danger btn-sm" ${u.username===currentUser.username?'disabled':''} onclick="deleteUser(${u.id},'${esc(u.username)}')">Löschen</button></div></td></tr>`;
  }).join('');
  $('drivers-tbody').innerHTML=drivers.map(d=>`<tr><td>${esc(d.name)}</td><td>${esc(d.phone||'')}</td><td>${d.active?'aktiv':'inaktiv'}</td><td><div class="cluster"><button class="panel-btn btn-sm" onclick="openEntityModal('driver',${d.id})">Bearbeiten</button><button class="btn btn-danger btn-sm" onclick="deleteEntity('driver',${d.id},'${esc(d.name)}')">Löschen</button></div></td></tr>`).join('');
  $('loaners-tbody').innerHTML=loaners.map(l=>`<tr><td>${esc(l.name)}</td><td>${esc(l.plate||'')}</td><td>${esc(l.status)}</td><td><div class="cluster"><button class="panel-btn btn-sm" onclick="openEntityModal('loaner',${l.id})">Bearbeiten</button><button class="btn btn-danger btn-sm" onclick="deleteEntity('loaner',${l.id},'${esc(l.name)}')">Löschen</button></div></td></tr>`).join('');
}

// Ottenschlag
function renderOtt(){
  const list=$('ott-list'),empty=$('ott-empty'),upd=$('ott-updated'),addBtn=$('btn-ott-add');
  const items=ottData.eintraege||[];
  if(addBtn) addBtn.classList.toggle('hidden',!hasModule('dispo_holbring','edit'));
  if(upd) upd.textContent=ottData.updated_by?`Zuletzt: ${esc(ottData.updated_by)}${ottData.updated_at?' · '+new Date(ottData.updated_at).toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'}):''}` :'';
  if(empty) empty.style.display=items.length?'none':'block';
  if(!list) return;
  list.innerHTML=items.map((item,i)=>`<div class="ott-item"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div>${esc(item.text||'')}${item.lw?'<span class="meta-pill" style="margin-left:8px">LW vor Ort</span>':''}</div>${hasModule('dispo_holbring','edit')?`<div class="cluster"><button class="panel-btn btn-sm" onclick="openOttModal(${i})">Bearb.</button><button class="btn btn-danger btn-sm" onclick="deleteOtt(${i})">✕</button></div>`:''}</div></div>`).join('');
}
function openOttModal(index=null){
  editingOttIndex=index;
  const item=index!==null?ottData.eintraege[index]:null;
  $('ott-text').value=item?.text||'';
  $('ott-lw').checked=!!item?.lw;
  $('ott-modal').style.display='flex';
}
async function saveOtt(){
  try{
    const items=[...(ottData.eintraege||[])];
    const entry={text:$('ott-text').value.trim(),lw:$('ott-lw').checked};
    if(!entry.text) return showToast('Bitte Text eingeben',true);
    if(editingOttIndex!==null) items[editingOttIndex]=entry;else items.push(entry);
    await api(`/api/ottenschlag/${currentDate}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({eintraege:items})});
    closeModal('ott-modal');showToast('Gespeichert');
    const updated=await api(`/api/ottenschlag/${currentDate}`);ottData=updated;renderOtt();
  }catch(e){showToast(e.message,true);}
}
async function deleteOtt(index){
  if(!confirm('Eintrag löschen?')) return;
  try{
    const items=(ottData.eintraege||[]).filter((_,i)=>i!==index);
    await api(`/api/ottenschlag/${currentDate}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({eintraege:items})});
    const updated=await api(`/api/ottenschlag/${currentDate}`);ottData=updated;renderOtt();showToast('Gelöscht');
  }catch(e){showToast(e.message,true);}
}

// FIX #4/#5: openUserModal lädt alle Felder korrekt
function renderPermissionRows(permissions={}){
  $('permissions-tbody').innerHTML=[
    ['dispo_holbring','Dispo Hol&Bring'],
    ['holbring_driver','Hol & Bring Fahrer'],
    ['kundendienstberater','Kundendienstberater'],
    ['fahrzeugaufbereitung','Fahrzeugaufbereitung']
  ].map(([key,label])=>{const p=permissions[key]||{};return `<tr><td>${label}</td><td><input type="checkbox" id="perm-${key}-view" ${p.can_view?'checked':''}></td><td><input type="checkbox" id="perm-${key}-edit" ${p.can_edit?'checked':''}></td><td><input type="checkbox" id="perm-${key}-manage" ${p.can_manage?'checked':''}></td></tr>`;}).join('');
}
function collectPermissions(){
  const out={};
  ['dispo_holbring','holbring_driver','kundendienstberater','fahrzeugaufbereitung'].forEach(key=>{out[key]={can_view:$(`perm-${key}-view`).checked,can_edit:$(`perm-${key}-edit`).checked,can_manage:$(`perm-${key}-manage`).checked};});
  return out;
}
function openUserModal(id=null){
  editingUserId=id;
  const u=id?adminUsers.find(x=>x.id===id):null;
  $('user-title').textContent=id?'Benutzer bearbeiten':'Benutzer anlegen';
  $('user-name-wrap').style.display=id?'none':'block';
  $('u-username').value='';
  $('u-display-name').value=u?.display_name||'';
  $('u-password').value='';
  $('u-active').checked=u?!!u.active:true;
  $('u-driver-link').innerHTML='<option value="">– kein Fahrer –</option>'+adminDrivers.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');
  $('u-driver-link').value=u?.driver_id||'';
  renderPermissionRows(u?.permissions||{dispo_holbring:{},holbring_driver:{},kundendienstberater:{},fahrzeugaufbereitung:{}});
  if(u?.role==='admin'){document.querySelectorAll('#permissions-tbody input').forEach(el=>{el.checked=true;el.disabled=true;});}
  else{document.querySelectorAll('#permissions-tbody input').forEach(el=>el.disabled=false);}
  $('u-error').style.display='none';
  $('user-modal').style.display='flex';
}

// FIX #4/#5: saveUser sendet alle Felder inkl. display_name, active, driver_id, permissions
async function saveUser(){
  try{
    const body=editingUserId?{
      display_name:$('u-display-name').value.trim(),
      active:$('u-active').checked,
      driver_id:$('u-driver-link').value?Number($('u-driver-link').value):null,
      permissions:collectPermissions(),
      newPassword:$('u-password').value||undefined
    }:{
      username:$('u-username').value.trim(),
      password:$('u-password').value,
      display_name:$('u-display-name').value.trim(),
      active:$('u-active').checked,
      driver_id:$('u-driver-link').value?Number($('u-driver-link').value):null,
      permissions:collectPermissions()
    };
    const url=editingUserId?`/api/users/${editingUserId}`:'/api/users';
    const method=editingUserId?'PUT':'POST';
    await api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    closeModal('user-modal');showToast('Benutzer gespeichert');loadAdmin();
  }catch(e){$('u-error').style.display='block';$('u-error').textContent=e.message;}
}

async function deleteUser(id,name){if(!confirm(`Benutzer ${name} löschen?`)) return;try{await api(`/api/users/${id}`,{method:'DELETE'});loadAdmin();showToast('Benutzer gelöscht');}catch(e){showToast(e.message,true);}}

function openEntityModal(type,id=null){
  entityMode=type;const data=type==='driver'?adminDrivers.find(x=>x.id===id):adminLoaners.find(x=>x.id===id);
  editingEntityId=id||null;$('entity-error').style.display='none';$('entity-status').innerHTML='';
  if(type==='driver'){$('entity-title').textContent=editingEntityId?'Fahrer bearbeiten':'Fahrer anlegen';$('entity-secondary-label').textContent='Telefon';$('entity-status-label').textContent='Aktiv';$('entity-status').style.display='none';$('entity-active').parentElement.style.display='block';$('entity-name').value=data?.name||'';$('entity-secondary').value=data?.phone||'';$('entity-notes').value=data?.notes||'';$('entity-active').checked=data?!!data.active:true;}
  else{$('entity-title').textContent=editingEntityId?'Leihwagen bearbeiten':'Leihwagen anlegen';$('entity-secondary-label').textContent='Kennzeichen';$('entity-status-label').textContent='Status';$('entity-status').style.display='block';$('entity-active').parentElement.style.display='none';$('entity-status').innerHTML='<option value="verfuegbar">verfügbar</option><option value="werkstatt">werkstatt</option><option value="reserviert">reserviert</option><option value="deaktiviert">deaktiviert</option>';$('entity-name').value=data?.name||'';$('entity-secondary').value=data?.plate||'';$('entity-notes').value=data?.notes||'';$('entity-status').value=data?.status||'verfuegbar';}
  $('entity-modal').style.display='flex';
}
async function saveEntity(){try{let body,url,method=editingEntityId?'PUT':'POST';if(entityMode==='driver'){body={name:$('entity-name').value.trim(),phone:$('entity-secondary').value.trim(),notes:$('entity-notes').value.trim(),active:$('entity-active').checked};url=editingEntityId?`/api/drivers/${editingEntityId}`:'/api/drivers';}else{body={name:$('entity-name').value.trim(),plate:$('entity-secondary').value.trim(),notes:$('entity-notes').value.trim(),status:$('entity-status').value};url=editingEntityId?`/api/loaners/${editingEntityId}`:'/api/loaners';}await api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});closeModal('entity-modal');showToast('Gespeichert');await loadMeta();loadAdmin();}catch(e){$('entity-error').style.display='block';$('entity-error').textContent=e.message;}}
async function deleteEntity(type,id,name){if(!confirm(`${name} löschen?`)) return;try{await api(`/api/${type==='driver'?'drivers':'loaners'}/${id}`,{method:'DELETE'});await loadMeta();loadAdmin();showToast('Gelöscht');}catch(e){showToast(e.message,true);}}

function openPwModal(){$('pw-current').value='';$('pw-new').value='';$('pw-new2').value='';$('pw-error').style.display='none';$('pw-success').style.display='none';$('pw-modal').style.display='flex';}
async function saveOwnPw(){try{if($('pw-new').value!==$('pw-new2').value) throw new Error('Neue Passwörter stimmen nicht überein');await api('/api/me/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:$('pw-current').value,newPassword:$('pw-new').value})});$('pw-success').style.display='block';$('pw-success').textContent='Passwort geändert';}catch(e){$('pw-error').style.display='block';$('pw-error').textContent=e.message;}}

function closeModal(id){$(id).style.display='none';}
function overlayClose(e,id){if(e.target.classList.contains('modal-backdrop')) closeModal(id);}

init();

