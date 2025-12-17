/* VizeRadar — v0.1
   - JSON loader + freemium + branching (visibleIf)
   - modal info + next-visible-step + glossary + notes
   - model tabs (brand’ın yanında)
   - hover ile açılan sidebar
   - LIGHT/DARK tema (toggle + sistem tercihini varsayılan alma)
   - JSON Yükle gizli (fonksiyonel)
*/
console.log('VizeRadar app v0.1');

const FREE_LIMIT = 5;
const PREMIUM_KEY = "vizeradar_premium";
const THEME_KEY   = "vizeradar_theme";   // 'light' | 'dark' | (unset => system)   // 'light' | 'dark' | (unset => system)

function isPremium(){
  try{ return localStorage.getItem(PREMIUM_KEY)==="1"; }catch(_){ return false; }
}
function setPremium(v){
  try{ localStorage.setItem(PREMIUM_KEY, v ? "1" : "0"); }catch(_){}
  reflectPremiumUI();
}

/* ======== Theme ======== */
function systemPrefersDark(){
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function storedTheme(){
  try{ return localStorage.getItem(THEME_KEY) || null; }catch(_){ return null; }
}
function applyThemeFromSetting(){
  const pref = storedTheme();                         // 'light' / 'dark' / null
  const theme = pref || (systemPrefersDark() ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  renderThemeToggle();
}
function toggleTheme(){
  const current = document.documentElement.getAttribute('data-theme') || (systemPrefersDark() ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  try{ localStorage.setItem(THEME_KEY, next); }catch(_){}
  applyThemeFromSetting();
}
function renderThemeToggle(){
  const actions = document.querySelector('.topbar .actions');
  if (!actions) return;
  let btn = document.getElementById('themeToggleBtn');
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const label = current === 'dark' ? '☀️ Açık' : '🌙 Koyu';
  if (!btn){
    btn = document.createElement('button');
    btn.id = 'themeToggleBtn';
    btn.className = 'btn small outline';
    btn.title = 'Tema değiştir (Açık/Koyu)';
    btn.addEventListener('click', toggleTheme);
    actions.insertBefore(btn, actions.firstChild);
  }
  btn.textContent = label;
}
// Sistem tercihi değişirse ve kullanıcı özel ayar seçmediyse güncelle
if (window.matchMedia){
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', ()=>{ if (!storedTheme()) applyThemeFromSetting(); });
}

/* ========= MODELLER & JSON DOSYALARI ========= */
let models = {};    // { modelName: steps[] }
let currentModel = null;

const DATA_FILES = [
  {name:"Schengen", path:"/public/data/schengen.json"},
  {name:"UK", path:"/public/data/uk.json"},
];

/* ========= SUPABASE AUTH BLOĞU ========= */

const SUPABASE_URL = 'https://lkppsqrpjdmuaekezdyz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrcHBzcXJwamRtdWFla2V6ZHl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyNjYwNDEsImV4cCI6MjA4MDg0MjA0MX0.OcXL3lDU53rmNbEvcsjk-Qzxsd2yQxBEIDZj2I4R9Kk';

let supabaseClient = null;

function initSupabaseClient(url = SUPABASE_URL, key = SUPABASE_ANON_KEY){
  if (!window.supabase || !window.supabase.createClient){
    console.warn('supabase-js kütüphanesi bulunamadı. index.html içinde script yüklü mü kontrol edin.');
    return null;
  }
  try{
    supabaseClient = window.supabase.createClient(url, key);
    return supabaseClient;
  }catch(e){
    console.error('Supabase init hatası:', e);
    supabaseClient = null;
    return null;
  }
}

function setLoggedInUI(user){
  try{
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn){
      loginBtn.textContent = user?.user_metadata?.full_name || user?.email || 'Hesabım';
      loginBtn.classList.remove('outline');
      loginBtn.classList.add('primary');
    }
    const home = document.getElementById('homeLanding');
    if (home) home.style.display = 'none';
  }catch(_){}
}

function resetLoggedOutUI(){
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn){
    loginBtn.textContent = 'Giriş / Kayıt';
    loginBtn.classList.remove('primary');
    loginBtn.classList.add('outline');
  }
  // Home sadece model seçili değilse gösterilsin
  const home = document.getElementById('homeLanding');
  if (home && !currentModel) home.style.display = 'block';
}

function setupSupabaseAuthHandlers(){
  if (!supabaseClient || !supabaseClient.auth) return;
  supabaseClient.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    if (user){
      setLoggedInUI(user);
    } else {
      resetLoggedOutUI();
    }
  });
}

async function supaSignOut(){
  if (!supabaseClient || !supabaseClient.auth) return;
  try{
    await supabaseClient.auth.signOut();
  }catch(e){
    console.error('Supabase signOut error:', e);
  }
}

/* ========= DOM ELEMANLARI ========= */

const els = {
  jsonInput: document.getElementById('jsonInput'),
  modelSelect: document.getElementById('modelSelect'),
  stepsList: document.getElementById('stepsList'),
  stepView: document.getElementById('stepView'),
  linksList: document.getElementById('linksList'),
  progressBar: document.getElementById('progressBar'),
  sidebarTitle: document.getElementById('sidebarTitle'),
  resetProgress: document.getElementById('resetProgress'),
  premiumBtn: document.getElementById('premiumBtn'),
  loadSample: document.getElementById('loadSample'),
};

// Açıklama kısa metinleri (fallback)
const OPTION_TIPS = {};

// --------- Güvenli Modal (tek kopya) ----------
let _modalResolver = null;

function ensureModal() {
  let m = document.getElementById('steplifyModal');
  if (m) return m;

  m = document.createElement('div');
  m.id = 'steplifyModal';
  m.style.cssText = `position:fixed; inset:0; display:none; z-index:9999; align-items:center; justify-content:center;`;
  m.innerHTML = `
    <div class="modal-backdrop" style="position:absolute; inset:0; background:rgba(0,0,0,.45);"></div>
    <div class="modal-sheet" style="position:relative; background:#fff; border-radius:12px; padding:16px 18px; width:min(560px, 92vw); box-shadow:0 20px 60px rgba(0,0,0,.25);">
      <h3 id="modalTitle" style="margin:0 0 6px; font-size:18px;"></h3>
      <div id="modalText" style="margin:0 0 14px; color:#475569; white-space:pre-wrap;"></div>
      <div class="modal-actions" style="display:flex; gap:8px; justify-content:flex-end;">
        <button id="modalCancel" class="btn small outline" type="button">Vazgeç</button>
        <button id="modalOk" class="btn small primary" type="button">Devam Et</button>
      </div>
    </div>`;
  const okBtn = m.querySelector('#modalOk');
  const cancelBtn = m.querySelector('#modalCancel');
  Object.assign(okBtn.style,{background:'#2563eb',color:'#fff',border:'1px solid #1e40af',padding:'8px 12px',borderRadius:'8px'});
  Object.assign(cancelBtn.style,{background:'#fff',color:'#111',border:'1px solid #cbd5e1',padding:'8px 12px',borderRadius:'8px'});

  document.body.appendChild(m);

  // Kapatma/Onay + kısayol
  const backdrop=m.querySelector('.modal-backdrop');
  backdrop.addEventListener('click',()=>closeModal(false));
  cancelBtn.addEventListener('click',()=>closeModal(false));
  okBtn.addEventListener('click',()=>closeModal(true));
  document.addEventListener('keydown',(ev)=>{
    if (m.style.display==='none') return;
    if (ev.key==='Escape') closeModal(false);
    if (ev.key==='Enter')  closeModal(true);
  });
  return m;
}
function openModal(title, htmlText){
  const m = ensureModal();
  m.style.display = 'flex';
  m.querySelector('#modalTitle').textContent = title || '';
  m.querySelector('#modalText').innerHTML = htmlText || '';
  return new Promise(res => { _modalResolver = res; });
}
function closeModal(ok){
  const m = document.getElementById('steplifyModal');
  if (!m) return;
  m.style.display = 'none';
  if (_modalResolver){ _modalResolver(!!ok); _modalResolver=null; }
}

// ---- LocalStorage yardımcıları ----
function lsKey(model){ return `vizeradar_progress::${model}`; }
function selKey(model){ return `vizeradar_selection::${model}`; }

function getProgress(m){ try{ return JSON.parse(localStorage.getItem(lsKey(m))||'{}'); }catch(_){ return {}; } }
function setProgress(m,obj){ try{ localStorage.setItem(lsKey(m), JSON.stringify(obj||{})); }catch(_){ } }

function getSelections(m){ try{ return JSON.parse(localStorage.getItem(selKey(m))||'{}'); }catch(_){ return {}; } }
function setSelections(m,obj){ try{ localStorage.setItem(selKey(m), JSON.stringify(obj||{})); }catch(_){ } }

function noteKey(model, stepId){ return `vizeradar_notes::${model}::${stepId}`; }
function getNote(model, stepId){ try{ return localStorage.getItem(noteKey(model, stepId)) || ''; }catch(_){ return ''; } }
function setNote(model, stepId, text){ try{ localStorage.setItem(noteKey(model, stepId), String(text||'')); }catch(_){ } }
function removeNote(model, stepId){ try{ localStorage.removeItem(noteKey(model, stepId)); }catch(_){ } }
function clearNotesForModel(model){
  try{
    const prefix = `vizeradar_notes::${model}::`;
    const toDel = [];
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toDel.push(k);
    }
    toDel.forEach(k=>localStorage.removeItem(k));
  }catch(_){}
}
function debounce(fn, delay){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); }; }

// ---- URL hash (derin link) ----
function setHash(model, stepId){ try{ location.hash = `${encodeURIComponent(model)}:${stepId}`; }catch(_){} }
function getHash(){
  const h=(location.hash||'').replace(/^#/, '');
  if(!h) return {model:null,id:null};
  const [m,idStr]=h.split(':'); const id=Number(idStr);
  return {model:decodeURIComponent(m||''), id:Number.isFinite(id)?id:null};
}

// ---- Görünürlük kuralları ----
const norm = s => String(s||'').trim().toLowerCase();
function evalAtom(token, sels){
  token = token.trim();
  let negate=false;
  if (token.startsWith('!')){ negate=true; token=token.slice(1).trim(); }
  const m = token.match(/^step\s*:\s*(\d+)\s*(!?=)\s*(.+)$/i);
  if (!m) return true;
  const stepId = Number(m[1]);
  const op = m[2];
  const values = m[3].split('|').map(v=>norm(v));
  const chosen = norm(sels[stepId]);
  const hit = values.includes(chosen);
  let ok = (op==='=') ? hit : !hit;
  if (negate) ok = !ok;
  return ok;
}
function evaluateVisibility(rule, sels){
  if (!rule || !String(rule).trim()) return true;
  const orParts = String(rule).split(/\s*\|\|\s*|\s+\bOR\b\s+/i);
  for (const orp of orParts){
    const andParts = orp.split(/\s*,\s*|\s+\bAND\b\s+/i);
    let all = true;
    for (const p of andParts){
      if (!evalAtom(p, sels)){ all=false; break; }
    }
    if (all) return true;
  }
  return false;
}

function computeOrder(steps){ return steps.slice().sort((a,b)=>a.id-b.id); }
function getVisibleOrderedSteps(){
  const steps = models[currentModel] || [];
  const order = computeOrder(steps);
  const sels = getSelections(currentModel);
  return order.filter(s => evaluateVisibility(s.visibleIf, sels));
}

function reflectPremiumUI(){
  const on = isPremium();
  if (els.premiumBtn) els.premiumBtn.style.display = on ? 'none' : '';

  // Premium açıldığında kilitleri yeniden hesapla
  if (currentModel && models[currentModel]) {
    renderSteps();
  }
}

function markActive(stepId){
  [...els.stepsList.querySelectorAll('.step')].forEach(li=>li.classList.remove('active'));
  const order = getVisibleOrderedSteps();
  const idx = order.findIndex(s=>s.id===stepId);
  const items = [...els.stepsList.querySelectorAll('.step')];
  if (idx>=0 && items[idx]) items[idx].classList.add('active');
}

/* --------- TERİMLER --------- */
function normalizeGlossary(gl){
  if (!gl) return [];
  if (typeof gl === 'object' && !Array.isArray(gl)){
    return Object.keys(gl).map(k=>({ term:String(k), desc:String(gl[k]||'') })).filter(x=>x.term.trim());
  }
  if (Array.isArray(gl)){
    const out=[];
    gl.forEach(item=>{
      if (item==null) return;
      const s=String(item);
      const i=s.indexOf(':');
      if (i>=0) out.push({term:s.slice(0,i).trim(), desc:s.slice(i+1).trim()});
      else out.push({term:s.trim(), desc:''});
    });
    return out.filter(x=>x.term);
  }
  const s = String(gl);
  const segs = s.split('||').map(x=>x.trim()).filter(Boolean);
  const out=[];
  segs.forEach(seg=>{
    const i = seg.indexOf(':');
    if (i>=0) out.push({term:seg.slice(0,i).trim(), desc:seg.slice(i+1).trim()});
    else out.push({term:seg.trim(), desc:''});
  });
  return out.filter(x=>x.term);
}
function renderGlossaryCard(step){
  const entries = normalizeGlossary(step.glossary || step['Terimler']);
  if (!entries.length) return null;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginTop = '12px';

  const title = document.createElement('h3');
  title.textContent = 'Terimler';
  title.style.margin = '0 0 8px 0';
  card.appendChild(title);

  const list = document.createElement('dl');
  list.style.display='grid';
  list.style.gridTemplateColumns='max-content 1fr';
  list.style.columnGap='12px';
  list.style.rowGap='8px';
  list.style.margin='0';

  entries.forEach(({term, desc})=>{
    const dt=document.createElement('dt'); dt.style.fontWeight='600'; dt.style.margin='0'; dt.textContent = term;
    const dd=document.createElement('dd'); dd.style.margin='0'; dd.style.color='#475569'; dd.textContent = desc || '—';
    card.appendChild(list); list.appendChild(dt); list.appendChild(dd);
  });

  return card;
}

/* --------- NOTLAR --------- */
function renderNotesCard(step){
  const lockedCandidateIndex = getVisibleOrderedSteps().findIndex(s=>s.id===step.id);
  const locked = (lockedCandidateIndex >= FREE_LIMIT) && !isPremium();
  if (locked) return null;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginTop = '12px';

  const head = document.createElement('div');
  head.style.display='flex'; head.style.alignItems='center'; head.style.justifyContent='space-between'; head.style.gap='8px';

  const h = document.createElement('h3'); h.textContent = 'Notların'; h.style.margin='0'; head.appendChild(h);

  const clearBtn = document.createElement('button'); clearBtn.className='btn small outline'; clearBtn.textContent='Temizle'; head.appendChild(clearBtn);

  card.appendChild(head);

  const ta = document.createElement('textarea');
  ta.value = getNote(currentModel, step.id);
  ta.rows = 6;
  ta.style.width = '100%'; ta.style.marginTop = '8px'; ta.style.padding = '10px';
  ta.style.border = '1px solid #e5e7eb'; ta.style.borderRadius = '10px';
  ta.style.fontFamily = 'inherit'; ta.style.fontSize = '14px';
  ta.placeholder = 'Bu adımla ilgili kişisel notlarını yaz... (otomatik kaydedilir)';
  card.appendChild(ta);

  const status = document.createElement('div');
  status.className = 'muted'; status.style.fontSize = '12px'; status.style.marginTop = '6px';
  status.style.opacity = '0'; status.textContent = 'Kaydedildi ✓';
  card.appendChild(status);

  const showSaved = () => { status.style.opacity = '1'; setTimeout(()=>{ status.style.opacity = '0'; }, 1200); };
  const saveDebounced = debounce((val)=>{ setNote(currentModel, step.id, val); renderNotesPanel(); showSaved(); }, 400);

  ta.addEventListener('input', (e)=> saveDebounced(e.target.value));
  clearBtn.addEventListener('click', ()=>{ ta.value=''; setNote(currentModel, step.id, ''); renderNotesPanel(); showSaved(); });

  return card;
}

/* --------- SAĞ PANEL: Tüm Notlar --------- */
function ensureNotesPanel(){
  const right = document.querySelector('.rightbar'); if (!right) return null;

  let card = document.getElementById('allNotesCard');
  if (card) return card;

  card = document.createElement('div');
  card.className = 'card';
  card.id = 'allNotesCard';
  card.style.marginTop = '12px';

  const head = document.createElement('div');
  head.style.display='flex'; head.style.alignItems='center'; head.style.justifyContent='space-between'; head.style.gap='8px';

  const h = document.createElement('h'); h.textContent='Tüm Notlar'; h.style.margin='0'; head.appendChild(h);

  const clear = document.createElement('button');
  clear.className='btn small outline'; clear.textContent='Notları Sıfırla';
  clear.addEventListener('click', ()=>{
    if (!currentModel) return;
    if (!confirm(`"${currentModel}" modelindeki TÜM notları silmek istediğine emin misin?`)) return;
    clearNotesForModel(currentModel);
    renderNotesPanel();
  });
  head.appendChild(clear);

  card.appendChild(head);

  const list = document.createElement('ul');
  list.id='allNotesList';
  list.style.listStyle='none'; list.style.margin='10px 0 0 0'; list.style.padding='0';
  list.style.display='flex'; list.style.flexDirection='column'; list.style.gap='8px';
  card.appendChild(list);

  const infoCard = right.querySelector('.card.info');
  if (infoCard) right.insertBefore(card, infoCard); else right.appendChild(card);

  return card;
}
function renderNotesPanel(){
  const card = ensureNotesPanel(); if (!card || !currentModel) return;
  const list = card.querySelector('#allNotesList'); list.innerHTML='';

  const steps = computeOrder(models[currentModel] || []);
  const items = [];
  steps.forEach(s=>{
    const n=getNote(currentModel, s.id);
    if (n && n.trim()) items.push({id:s.id, title:s.title, text:n.trim()});
  });

  if (!items.length){
    const empty=document.createElement('div');
    empty.className='muted';
    empty.textContent='Bu model için kayıtlı not bulunmuyor.';
    list.appendChild(empty);
    return;
  }

  items.forEach(({id, title, text})=>{
    const li=document.createElement('li');
    li.style.border='1px solid #e5e7eb';
    li.style.borderRadius='10px';
    li.style.padding='10px';

    const row=document.createElement('div');
    row.style.display='flex';
    row.style.alignItems='center';
    row.style.justifyContent='space-between';
    row.style.gap='8px';

    const left=document.createElement('div');
    left.style.display='flex';
    left.style.flexDirection='column';
    const h=document.createElement('div'); h.style.fontWeight='600'; h.textContent=`${id}. ${title}`; left.appendChild(h);
    const preview=document.createElement('div'); preview.className='muted'; preview.style.fontSize='12px'; preview.style.marginTop='4px';
    const firstLine=text.split(/\r?\n/)[0].slice(0,140);
    preview.textContent=firstLine + (text.length>firstLine.length ? '…' : '');
    left.appendChild(preview);
    row.appendChild(left);

    const actions=document.createElement('div'); actions.style.display='flex'; actions.style.gap='6px';
    const openBtn=document.createElement('button'); openBtn.className='btn small'; openBtn.textContent='Aç';
    openBtn.addEventListener('click', ()=>{
      const vis = getVisibleOrderedSteps();
      const idx = vis.findIndex(s=>s.id===id);
      if (idx>=0) showStep(vis[idx], idx);
      else {
        const order=computeOrder(models[currentModel]||[]);
        const rawIdx=order.findIndex(s=>s.id===id);
        if (rawIdx>=0) showStep(order[rawIdx], rawIdx);
      }
    });
    actions.appendChild(openBtn);

    const delBtn=document.createElement('button'); delBtn.className='btn small outline'; delBtn.textContent='🗑️'; delBtn.title='Bu notu sil';
    delBtn.addEventListener('click', ()=>{ removeNote(currentModel, id); renderNotesPanel(); });
    actions.appendChild(delBtn);

    row.appendChild(actions);
    li.appendChild(row);
    list.appendChild(li);
  });
}

/* --------- MODEL TABS --------- */
function ensureTabbar(){
  const topbar = document.querySelector('.topbar');
  const brand  = document.querySelector('.topbar .brand');
  const actions= document.querySelector('.topbar .actions');
  if (!topbar || !brand || !actions) return null;

  if (els.modelSelect) els.modelSelect.style.display = 'none';

  let bar = document.getElementById('modelTabs');
  if (bar) return bar;

  bar = document.createElement('div');
  bar.id = 'modelTabs';
  topbar.insertBefore(bar, actions);
  return bar;
}
function renderModelTabs(){
  const bar = ensureTabbar(); if (!bar) return;
  bar.innerHTML = '';
  const names = Object.keys(models);

  if (!names.length){ bar.style.display='none'; return; }
  bar.style.display='flex';

  names.forEach(name=>{
    const btn = document.createElement('button');
    btn.className = 'btn small ' + (name===currentModel ? 'primary' : 'outline');
    btn.textContent = name;
    btn.style.whiteSpace='nowrap';
    btn.addEventListener('click', ()=>{
      if (currentModel === name) return;
      currentModel = name;
      if (els.modelSelect) els.modelSelect.value = name;
      renderModelTabs(); renderSteps(); renderNotesPanel();
      const vis = getVisibleOrderedSteps(); if (vis[0]) showStep(vis[0], 0);
      syncHomeAndLayout();
    });
    bar.appendChild(btn);
  });
}

/* --------- Hover Sidebar Hotzone --------- */
function ensureSidebarHover(){
  if (!document.getElementById('sidebarHotzone')){
    const hz = document.createElement('div'); hz.id = 'sidebarHotzone'; document.body.appendChild(hz);
  }
  const hz = document.getElementById('sidebarHotzone');
  const sb = document.querySelector('.sidebar');
  if (!hz || !sb) return;

  let hideTimer = null;
  const open = ()=>{
    if (!currentModel) return;          // model yoksa sidebar hiç açma
    document.body.classList.add('sidebar-open');
    if (hideTimer){ clearTimeout(hideTimer); hideTimer=null; }
  };
  const close= ()=>{ document.body.classList.remove('sidebar-open'); };


  hz.addEventListener('pointerenter', open);
  hz.addEventListener('pointerleave', ()=>{
    hideTimer = setTimeout(()=>{ if (!sb.matches(':hover')) close(); }, 120);
  });
  sb.addEventListener('pointerenter', open);
  sb.addEventListener('pointerleave', ()=>{
    hideTimer = setTimeout(()=>{ if (!hz.matches(':hover')) close(); }, 120);
  });
}

function syncHomeAndLayout(){
  const layout = document.querySelector('.layout');
  const home   = document.getElementById('homeLanding');
  const hasModel = !!currentModel;

  if (layout){
    layout.style.display = hasModel ? 'grid' : 'none';
  }
  if (home){
    home.style.display = hasModel ? 'none' : 'block';
  }
}

/* --------- Render --------- */
function renderModels(){
  els.modelSelect.innerHTML = '';
  const names = Object.keys(models);
  names.forEach(n=>{
    const opt=document.createElement('option');
    opt.value=n; opt.textContent=n;
    els.modelSelect.appendChild(opt);
  });

  // Sadece hash varsa model seç; yoksa home göster
  const {model,id} = getHash();
  currentModel = (model && models[model]) ? model : null;

  if (els.modelSelect && currentModel) els.modelSelect.value = currentModel;

  renderModelTabs();
  renderSteps();
  renderNotesPanel();

  syncHomeAndLayout();

  // Derin link: step id varsa
  if (currentModel && Number.isFinite(id)){
    const vis = getVisibleOrderedSteps();
    const idx = vis.findIndex(s=>s.id===id);
    if (idx>=0) showStep(vis[idx], idx);
  }
}

function renderSteps(){
  if (!currentModel || !models[currentModel] || !Array.isArray(models[currentModel]) || models[currentModel].length===0){
    els.sidebarTitle.textContent='Adımlar';
    els.stepsList.innerHTML='';
    els.linksList.innerHTML='';
    els.progressBar.style.width='0%';
    els.progressBar.title='0% tamamlandı';
    renderNotesPanel();
    return;
  }

  const progress = getProgress(currentModel);
  const order = getVisibleOrderedSteps();

  els.sidebarTitle.textContent = `Adımlar — ${currentModel}`;
  els.stepsList.innerHTML = '';

  let doneCount = 0;

  order.forEach((s, idx)=>{
    const li=document.createElement('li'); li.className='step';

    const locked = (idx >= FREE_LIMIT) && !isPremium();
    if (locked) li.classList.add('locked');

    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.disabled = locked;
    cb.checked = !!progress[s.id];
    if (cb.checked) doneCount++;

    cb.addEventListener('click',(e)=>{
      e.stopPropagation();
      const p = getProgress(currentModel);
      p[s.id] = !!e.target.checked;
      setProgress(currentModel,p);
      renderSteps();
    });

    const title=document.createElement('div'); title.className='title';
    title.textContent = `${s.id}. ${s.title}`;

    li.appendChild(cb);
    li.appendChild(title);
    li.addEventListener('click',()=>showStep(s, idx));
    els.stepsList.appendChild(li);
  });

  const pct = order.length ? Math.round((doneCount / order.length) * 100) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.title = `${pct}% tamamlandı`;
}

function nextVisibleAfter(stepId){
  const order = getVisibleOrderedSteps();
  const i = order.findIndex(s=>s.id===stepId);
  return (i>=0) ? {next: order[i+1], nextIdx: i+1} : {next:null, nextIdx:-1};
}

function showStep(step, index){
  const vis = getVisibleOrderedSteps();
  if (!vis.some(s=>s.id===step.id)){
    const first = vis[0];
    if (first) return showStep(first, 0);
    return;
  }

  els.stepView.innerHTML = '';
  const h=document.createElement('h2'); h.textContent = `${step.id}. ${step.title}`;
  const d=document.createElement('p'); d.textContent = step.description || 'Açıklama yok.';
  els.stepView.appendChild(h); els.stepView.appendChild(d);

  const glossaryCard = renderGlossaryCard(step);
  if (glossaryCard) els.stepView.appendChild(glossaryCard);

  const sels = getSelections(currentModel);
  if (sels[step.id]){
    const info=document.createElement('div');
    info.className='muted';
    info.style.marginTop='4px';
    info.textContent=`Seçimin: ${sels[step.id]}`;
    els.stepView.appendChild(info);
  }

  const locked = (index >= FREE_LIMIT) && !isPremium();

  const options = Array.isArray(step.options) ? step.options : [];
  if (options.length){
    const optionsWrap=document.createElement('div'); optionsWrap.className='options';
    options.forEach(label=>{
      const b=document.createElement('button');
      b.className='btn option-btn';
      b.textContent = label;
      b.dataset.option=label;
      if (sels[step.id] === label) b.classList.add('selected');
      if (locked) b.disabled = true;

      b.addEventListener('click', async ()=>{
        if (locked) return;

        let modalHtml = '';
        const od = (step.optionDetails && step.optionDetails[label]) || null;
        if (od){
          const p = (arr)=> arr && arr.length
            ? `<ul style="margin:.4rem 0 .2rem 1rem;">${arr.map(x=>`<li>${x}</li>`).join('')}</ul>`
            : '<span class="muted">–</span>';
          modalHtml =
            `<div style="line-height:1.5">
              <div><b>Bilgi:</b> ${od.info || '<span class="muted">–</span>'}</div>
              <div style="margin-top:.5rem"><b>Artılar:</b> ${p(od.pros)}</div>
              <div style="margin-top:.3rem"><b>Eksiler:</b> ${p(od.cons)}</div>
            </div>`;
        }else{
          const tip = (OPTION_TIPS[step.title] && OPTION_TIPS[step.title][label]) || `${label} ile devam edilsin mi?`;
          modalHtml = tip;
        }

        const ok = await openModal(label, modalHtml);
        if (!ok) return;

        const _sels = getSelections(currentModel);
        _sels[step.id] = label;
        setSelections(currentModel, _sels);
        const p = getProgress(currentModel);
        p[step.id] = true;
        setProgress(currentModel, p);

        renderSteps();
        const {next, nextIdx} = nextVisibleAfter(step.id);
        if (next) showStep(next, nextIdx);
      });

      optionsWrap.appendChild(b);
    });
    els.stepView.appendChild(optionsWrap);
  } else {
    if (!locked){
      const wrap=document.createElement('div'); wrap.style.marginTop='12px';
      wrap.innerHTML = `<button id="finishStep" class="btn small primary">Adımı Tamamla → Sonraki</button>`;
      els.stepView.appendChild(wrap);
      wrap.querySelector('#finishStep').addEventListener('click', ()=>{
        const p = getProgress(currentModel); p[step.id] = true; setProgress(currentModel, p);
        renderSteps();
        const {next, nextIdx} = nextVisibleAfter(step.id);
        if (next) showStep(next, nextIdx);
      });
    }
  }

  const notesCard = renderNotesCard(step);
  if (notesCard) els.stepView.appendChild(notesCard);

  els.linksList.innerHTML = '';
  (step.links || []).forEach(u=>{
    const val = String(u||'').trim();
    if (!val || val==='-' || val==='—' || val==='–') return;
    const li=document.createElement('li');
    if (/^https?:\/\//i.test(val)){
      const a=document.createElement('a'); a.href=val; a.target='_blank'; a.rel='noopener'; a.textContent=val; li.appendChild(a);
    }else{
      li.textContent = val;
    }
    els.linksList.appendChild(li);
  });

  if (locked){
    const lock=document.createElement('div');
    lock.className='card';
    lock.style.marginTop='12px';
    lock.style.background='#fff7ed';
    lock.style.borderColor='#fdba74';
    lock.innerHTML = `<b>Premium Kilit</b><br/>Bu adımı görmek için Premium'a geç.
      <div style="margin-top:8px"><a id="buyPremium" class="btn small primary" href="/premium.html">Premium'a Geç</a></div>`;
    els.stepView.appendChild(lock);
  }

  markActive(step.id);
  setHash(currentModel, step.id);
}

/* ---- Veri yükleme ---- */
async function loadDataFiles(){
  for (const f of DATA_FILES){
    try{
      const res = await fetch(f.path, {cache:'no-store'});
      if (!res.ok) continue;
      const obj = await res.json();
      if (obj && obj.model && Array.isArray(obj.steps)){ models[obj.model] = obj.steps; }
    }catch(_){}
  }
  renderModels();
  reflectPremiumUI();
  if (isPremium()){
    console.log("Premium aktif! UI güncelleniyor...");
    renderSteps();
  }
}

/* ---- JSON güvenliği (sanitize) ---- */
function sanitizePlan(obj){
  if (!obj || typeof obj!=='object') return null;
  if (typeof obj.model!=='string' || obj.model.length>60) return null;
  if (!Array.isArray(obj.steps) || obj.steps.length>1000) return null;
  const steps = obj.steps.map(s=>({
    id: Number(s.id),
    title: String(s.title||'').slice(0,200),
    description: String(s.description||'').slice(0,4000),
    parentId: s.parentId!=null ? Number(s.parentId) : null,
    options: Array.isArray(s.options) ? s.options.map(o=>String(o).slice(0,200)).slice(0,20) : [],
    links: Array.isArray(s.links) ? s.links.map(u=>String(u).slice(0,500)).slice(0,20) : [],
    visibleIf: typeof s.visibleIf==='string' ? s.visibleIf.slice(0,1000)
            : (typeof s['GörünürEğer']==='string' ? s['GörünürEğer'].slice(0,1000) : undefined),
    optionDetails: (s.optionDetails && typeof s.optionDetails==='object') ? s.optionDetails : {},
    glossary: (s.glossary && typeof s.glossary==='object') ? s.glossary
            : (typeof s['Terimler']==='string' || Array.isArray(s['Terimler']) ? s['Terimler'] : {}),
  })).filter(s=>Number.isFinite(s.id));
  return { model: obj.model, steps };
}

/* ---- Eventler ---- */
document.addEventListener('DOMContentLoaded', async () => {
  applyThemeFromSetting();
  ensureModal(); closeModal(false);
  reflectPremiumUI();
  await loadDataFiles();

  // Supabase init & auth
  initSupabaseClient();
  setupSupabaseAuthHandlers();

  const loginBtn = document.getElementById('loginBtn');
  const authModal = document.getElementById('authModal');
  const closeAuth = document.getElementById('closeAuth');

  function openAuthModal(){
    if (!authModal) return;
    authModal.style.display = 'flex';
    authModal.style.position = 'fixed';
    authModal.style.inset = '0';
    authModal.style.alignItems = 'center';
    authModal.style.justifyContent = 'center';
    authModal.style.zIndex = '99999';
  }

  if (loginBtn){
    loginBtn.onclick = openAuthModal;
  }
  if (closeAuth){
    closeAuth.onclick = ()=>{ if (authModal) authModal.style.display = 'none'; };
  }

  // Home inline auth
  const homeEmail = document.getElementById('homeEmail');
  const homePassword = document.getElementById('homePassword');
  const homeSignUp = document.getElementById('homeSignUp');
  const homeSignIn = document.getElementById('homeSignIn');
  const homeGoogle = document.getElementById('homeGoogle');
  const homeAuthStatus = document.getElementById('homeAuthStatus');

  function homeSetStatus(txt, isError=false){
    if (!homeAuthStatus) return;
    homeAuthStatus.textContent = txt || '';
    homeAuthStatus.style.color = isError ? '#b00020' : '#0b6f3a';
  }

  if (homeSignUp){
    homeSignUp.addEventListener('click', async ()=>{
      homeSetStatus('Kayıt oluşturuluyor...');
      if (!supabaseClient){ homeSetStatus('Supabase yüklenmedi.', true); return; }
      const email = (homeEmail?.value || '').trim();
      const pw = (homePassword?.value || '').trim();
      if (!email || !pw){ homeSetStatus('Email ve parola gerekli', true); return; }
      try{
        const { data, error } = await supabaseClient.auth.signUp({ email, password: pw });
        if (error) homeSetStatus('Kayıt hatası: ' + (error.message || JSON.stringify(error)), true);
        else homeSetStatus('Kayıt isteği gönderildi. E-postayı onaylayın (varsa).');
      }catch(e){
        console.error(e); homeSetStatus('Kayıt sırasında hata', true);
      }
    });
  }

  if (homeSignIn){
    homeSignIn.addEventListener('click', async ()=>{
      homeSetStatus('Giriş yapılıyor...');
      if (!supabaseClient){ homeSetStatus('Supabase yüklenmedi.', true); return; }
      const email = (homeEmail?.value || '').trim();
      const pw = (homePassword?.value || '').trim();
      if (!email || !pw){ homeSetStatus('Email ve parola gerekli', true); return; }

      try{
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pw });
        if (error){
          homeSetStatus('Giriş hatası: ' + (error.message || JSON.stringify(error)), true);
          return;
        }
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const session = sessionData?.session;
        const user = data?.user ?? session?.user ?? null;

        if (user){
          homeSetStatus('Giriş başarılı.');
          setLoggedInUI(user);
        } else {
          homeSetStatus('Oturum oluşturulamadı.', true);
        }
      }catch(e){
        console.error(e);
        homeSetStatus('Giriş sırasında beklenmedik hata', true);
      }
    });
  }

  if (homeGoogle){
    homeGoogle.addEventListener('click', async ()=>{
      homeSetStatus('Google yönlendiriliyor...');
      if (!supabaseClient){ homeSetStatus('Supabase yüklenmedi.', true); return; }
      try{
        await supabaseClient.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.href }
        });
      }catch(e){
        console.error(e);
        homeSetStatus('Google ile giriş hatası', true);
      }
    });
  }

  // Brand (Steplify) → home'a dön
  const brandEl = document.getElementById('brandLink') || document.querySelector('.topbar .brand');
  if (brandEl){
    brandEl.style.cursor = 'pointer';
    brandEl.addEventListener('click', (e)=>{
      e.preventDefault?.();
      currentModel = null;
      if (els.modelSelect) els.modelSelect.value = '';
      renderModelTabs();
      renderSteps();
      renderNotesPanel();
      syncHomeAndLayout();
      try{ history.replaceState(null, '', location.pathname + location.search); }catch(_){}
      if (home) home.style.display = 'block';
      try{ history.replaceState(null, '', location.pathname + location.search); }catch(_){}
    });
  }

  // Auth modal içi kontroller
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const authSignUp = document.getElementById('authSignUp');
  const authSignIn = document.getElementById('authSignIn');
  const authSignOutBtn = document.getElementById('authSignOut');
  const authStatus = document.getElementById('authStatus');

  function setStatus(msg, isError=false){
    if (!authStatus) return;
    authStatus.textContent = msg || '';
    authStatus.style.color = isError ? '#b00020' : '#0b6f3a';
  }

  if (authSignUp){
    authSignUp.addEventListener('click', async ()=>{
      setStatus('Kayıt oluşturuluyor...');
      if (!supabaseClient){ setStatus('Supabase yüklenmedi.', true); return; }
      try{
        const email = authEmail.value.trim();
        const pw = authPassword.value.trim();
        if (!email || !pw){ setStatus('Email ve parola gerekli', true); return; }
        const { data, error } = await supabaseClient.auth.signUp({ email, password: pw });
        if (error){
          setStatus('Kayıt hatası: ' + (error.message || JSON.stringify(error)), true);
        } else {
          setStatus('Kayıt isteği gönderildi. E-postayı onaylayın (varsa).');
        }
      }catch(e){
        setStatus('Kayıt sırasında hata', true);
        console.error(e);
      }
    });
  }

  if (authSignIn){
    authSignIn.addEventListener('click', async ()=>{
      setStatus('Giriş yapılıyor...');
      if (!supabaseClient){ setStatus('Supabase yüklenmedi.', true); return; }
      try{
        const email = authEmail.value.trim();
        const pw = authPassword.value.trim();
        if (!email || !pw){ setStatus('Email ve parola gerekli', true); return; }

        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pw });
        if (error){
          setStatus('Giriş hatası: ' + (error.message || JSON.stringify(error)), true);
          return;
        }
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const session = sessionData?.session;
        const user = data?.user ?? session?.user ?? null;

        if (user){
          setStatus('Giriş başarılı.');
          if (authModal) authModal.style.display = 'none';
          setLoggedInUI(user);
        } else {
          setStatus('Oturum alınamadı', true);
        }
      }catch(e){
        console.error(e);
        setStatus('Giriş sırasında hata', true);
      }
    });
  }

  if (authSignOutBtn){
    authSignOutBtn.addEventListener('click', async ()=>{
      setStatus('Çıkış yapılıyor...');
      try{
        await supaSignOut();
        setStatus('Çıkış yapıldı.');
        resetLoggedOutUI();
      }catch(e){
        console.error(e);
        setStatus('Çıkış hatası', true);
      }
    });
  }

  // JSON Yükle butonunu tamamen kaldır (istek)
  if (els.jsonInput){
    const lbl = els.jsonInput.closest('label');
    if (lbl && lbl.parentElement) lbl.parentElement.removeChild(lbl);
  }

  // Üst menüye "Notları Sıfırla" butonu ekle
  if (els.resetProgress && !document.getElementById('clearNotesBtn')){
    const clearNotesBtn = document.createElement('button');
    clearNotesBtn.id = 'clearNotesBtn';
    clearNotesBtn.className = 'btn outline small';
    clearNotesBtn.textContent = 'Notları Sıfırla';
    clearNotesBtn.addEventListener('click', ()=>{
      if (!currentModel) return;
      if (!confirm(`"${currentModel}" modelindeki TÜM notları silmek istediğine emin misin?`)) return;
      clearNotesForModel(currentModel);
      renderNotesPanel();
    });
    els.resetProgress.insertAdjacentElement('afterend', clearNotesBtn);
  }

  // Hover sidebar
  ensureSidebarHover();

  if (els.loadSample){
    els.loadSample.addEventListener('click', ()=>{
      const names = Object.keys(models);
      if (!names.length) return alert('Örnekler yüklenemedi. JSON dosyaları bulunamadı.');
      currentModel = names[0];
      if (els.modelSelect) els.modelSelect.value = currentModel;
      renderModelTabs(); renderSteps();
      const vis = getVisibleOrderedSteps(); if (vis[0]) showStep(vis[0], 0);
      syncHomeAndLayout();
    });
  }

  // Hash değişince
  window.addEventListener('hashchange', ()=>{
    const {model,id} = getHash();
    if (!model || !models[model] || !Number.isFinite(id)) return;
    currentModel = model;
    if (els.modelSelect) els.modelSelect.value = model;
    renderModelTabs(); renderSteps();
    const vis = getVisibleOrderedSteps();
    const idx = vis.findIndex(s=>s.id===id);
    if (idx>=0) showStep(vis[idx], idx);
  });

  // Home'dan "Modeli Keşfet"
  const exploreBtn = document.getElementById('exploreModelsBtn');
  if (exploreBtn){
    exploreBtn.addEventListener('click', ()=>{
      const names = Object.keys(models);
      if (names.length){
        currentModel = names[0];
        if (els.modelSelect) els.modelSelect.value = currentModel;
        renderModelTabs(); renderSteps(); renderNotesPanel();
        const vis = getVisibleOrderedSteps(); if (vis[0]) showStep(vis[0], 0);
        syncHomeAndLayout();;
      } else {
        alert('Henüz model yok.');
      }
    });
  }

  // Home'dan auth modal aç
  const openFromHome = document.getElementById('openAuthFromHome');
  if (openFromHome){
    openFromHome.addEventListener('click', ()=>{
      openAuthModal();
    });
  }
});

// Model değişimi (fallback: dropdown gizli ama çalışır)
els.modelSelect.addEventListener('change', e=>{
  currentModel = e.target.value;
  renderModelTabs(); renderSteps(); renderNotesPanel();
  const vis = getVisibleOrderedSteps(); if (vis[0]) showStep(vis[0], 0);
  syncHomeAndLayout();
});

// İlerlemeyi sıfırla (seçimler dahil) — notlar ayrı tutulur
els.resetProgress.addEventListener('click', ()=>{
  if(!currentModel) return;
  localStorage.removeItem(lsKey(currentModel));
  localStorage.removeItem(selKey(currentModel));
  renderSteps();
});

// JSON yükleme (gizli ama fonksiyonel kalsın)
if (els.jsonInput){
  els.jsonInput.addEventListener('change', (e)=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const raw=JSON.parse(reader.result);
        const obj=sanitizePlan(raw);
        if(obj){
          models[obj.model]=obj.steps;
          renderModels();
        } else {
          alert('Geçersiz/çok büyük JSON.');
        }
      }catch(err){ alert('JSON okunamadı: '+err.message); }
    };
    reader.readAsText(file, 'utf-8');
  });
}

// Premium state dışarıdan değişirse UI
window.addEventListener('storage',(e)=>{ if(e.key===PREMIUM_KEY) reflectPremiumUI(); });

// URL ile premium açma (debug)
if (new URLSearchParams(location.search).get("unlock")==="1"){ setPremium(true); }
