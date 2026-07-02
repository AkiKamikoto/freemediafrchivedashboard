if(!window.storage){
  window.storage = {
    async get(key){
      const v = localStorage.getItem(key);
      return v === null ? null : { value: v };
    },
    async set(key, value){
      localStorage.setItem(key, value);
    }
  };
}

const CATS = {
  movies:{label:'Фильмы', color:'var(--c-movies)', hex:'#5B7FA6',
    fields:[{k:'director',l:'Режиссёр'},{k:'cast',l:'В ролях (через запятую)'},{k:'runtime',l:'Длительность (мин)',type:'number'}]},
  series:{label:'Сериалы', color:'var(--c-series)', hex:'#8E6C88',
    fields:[{k:'creator',l:'Автор/шоураннер'},{k:'cast',l:'В ролях (через запятую)'},{k:'season',l:'Сезон / серия',ph:'напр. 2 / 14'},{k:'totalEp',l:'Всего серий',type:'number'}]},
  anime:{label:'Аниме', color:'var(--c-anime)', hex:'#C0654B',
    fields:[{k:'studio',l:'Студия'},{k:'epWatched',l:'Серий просмотрено',type:'number'},{k:'totalEp',l:'Всего серий',type:'number'}]},
  books:{label:'Книги', color:'var(--c-books)', hex:'#A88A5C',
    fields:[{k:'author',l:'Автор'},{k:'pagesRead',l:'Страниц прочитано',type:'number'},{k:'totalPages',l:'Всего страниц',type:'number'}]},
  manga:{label:'Манга', color:'var(--c-manga)', hex:'#6B8F71',
    fields:[{k:'author',l:'Автор/художник'},{k:'chRead',l:'Глав прочитано',type:'number'},{k:'totalCh',l:'Всего глав',type:'number'}]},
  games:{label:'Игры', color:'var(--c-games)', hex:'#3F8E8E',
    fields:[{k:'developer',l:'Разработчик'},{k:'platform',l:'Платформа',ph:'Xbox Series S'},{k:'hours',l:'Часов наиграно',type:'number'},{k:'genre',l:'Жанр'}]},
};
const STATUS_LABEL = {planning:'план',progress:'смотрю',completed:'завершено',hold:'отложено',dropped:'брошено'};
const PROGRESS_LABEL_BY_CAT = {books:'читаю',manga:'читаю',games:'играю'};
const STATUS_CLASS = {planning:'st-planning',progress:'st-progress',completed:'st-completed',hold:'st-hold',dropped:'st-dropped'};
function statusLabel(e){
  if(e.status==='progress') return PROGRESS_LABEL_BY_CAT[e.category] || STATUS_LABEL.progress;
  return STATUS_LABEL[e.status];
}

let entries = [];
let activeCat = 'all';
let statsMode = false;
let uiPrefs = {theme:'dark', view:'cards', groupBy:'none'};

let steamGamesDb = {};
let raGamesDb = { games: [] };
async function load(){
  try{
    const res = await window.storage.get('archive-entries');
    entries = res ? JSON.parse(res.value) : [];
  }catch(e){ entries = []; }
  try{
    const p = await window.storage.get('archive-ui-prefs');
    if(p) uiPrefs = JSON.parse(p.value);
  }catch(e){ /* defaults */ }
  try{
    const dbRes = await fetch('data/steam-games-db.json');
    if(dbRes.ok) steamGamesDb = await dbRes.json();
  }catch(e){ /* offline cache unavailable, enrichment will fetch live */ }
  try{
    const raRes = await fetch('data/retroachievements-games-db.json');
    if(raRes.ok) raGamesDb = await raRes.json();
  }catch(e){ /* offline cache unavailable — сбор базы вручную в Импорт/Экспорт → RetroAchievements */ }
  applyUiPrefs();
  render();
}
function downloadSteamDb(){
  if(!Object.keys(steamGamesDb).length){ showToast('База пуста — сначала нажми «Обогатить метаданные»'); return; }
  const blob = new Blob([JSON.stringify(steamGamesDb, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'steam-games-db.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Скачано записей: ${Object.keys(steamGamesDb).length}`);
}
async function persist(){
  try{ await window.storage.set('archive-entries', JSON.stringify(entries)); }
  catch(e){ console.error('storage failed', e); }
}
async function persistUiPrefs(){
  try{ await window.storage.set('archive-ui-prefs', JSON.stringify(uiPrefs)); }
  catch(e){ /* ignore */ }
}
function applyUiPrefs(){
  document.body.classList.toggle('theme-light', uiPrefs.theme==='light');
  document.getElementById('themeBtn').textContent = uiPrefs.theme==='light' ? '🌙 Тёмная тема' : '☀ Светлая тема';
  document.getElementById('viewSelect').value = uiPrefs.view;
  document.getElementById('groupBy').value = uiPrefs.groupBy || 'none';
  if(uiPrefs.steamApiKey) document.getElementById('steamApiKey').value = uiPrefs.steamApiKey;
  if(uiPrefs.raUsername) document.getElementById('raUsername').value = uiPrefs.raUsername;
  if(uiPrefs.raApiKey) document.getElementById('raApiKey').value = uiPrefs.raApiKey;
}
function saveSteamApiKey(v){
  uiPrefs.steamApiKey = v.trim();
  persistUiPrefs();
}
function toggleTheme(){
  uiPrefs.theme = uiPrefs.theme==='light' ? 'dark' : 'light';
  applyUiPrefs(); persistUiPrefs();
}
function setViewMode(v){
  uiPrefs.view = v;
  persistUiPrefs(); render();
}
function setGroupBy(v){
  uiPrefs.groupBy = v;
  persistUiPrefs(); render();
}

function buildTabs(){
  const counts = {};
  Object.keys(CATS).forEach(k=>counts[k]=0);
  entries.forEach(e=>{ if(counts[e.category]!==undefined) counts[e.category]++; });
  let html = `<div class="tab ${activeCat==='all'&&!statsMode?'active':''}" onclick="setCat('all')">
    <span class="dot" style="background:var(--brass)"></span>Всё<span class="count">${entries.length}</span></div>`;
  Object.entries(CATS).forEach(([key,c])=>{
    html += `<div class="tab ${activeCat===key&&!statsMode?'active':''}" onclick="setCat('${key}')">
      <span class="dot" style="background:${c.color}"></span>${c.label}<span class="count">${counts[key]}</span></div>`;
  });
  document.getElementById('tabs').innerHTML = html;
}
function setCat(c){ activeCat = c; statsMode=false; render(); }
function toggleStats(){ statsMode = !statsMode; render(); }

function toggleFiltersPanel(){
  const p = document.getElementById('filtersPanel');
  p.classList.toggle('show');
  if(p.classList.contains('show')) populateCountryFilter();
}
function populateCountryFilter(){
  const sel = document.getElementById('fltCountry');
  const current = sel.value;
  const countries = Array.from(new Set(entries.map(e=>e.country).filter(Boolean))).sort();
  sel.innerHTML = `<option value="">Все страны</option>` + countries.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = current;
}
function resetFilters(){
  ['fltYearFrom','fltYearTo','fltRatingFrom','fltRatingTo'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fltCountry').value = '';
  render();
}

function getFiltered(){
  const q = document.getElementById('searchInput').value.toLowerCase();
  const st = document.getElementById('statusFilter').value;
  const sortBy = document.getElementById('sortBy').value;
  const yFrom = parseInt(document.getElementById('fltYearFrom').value)||null;
  const yTo = parseInt(document.getElementById('fltYearTo').value)||null;
  const rFrom = document.getElementById('fltRatingFrom').value!=='' ? parseFloat(document.getElementById('fltRatingFrom').value) : null;
  const rTo = document.getElementById('fltRatingTo').value!=='' ? parseFloat(document.getElementById('fltRatingTo').value) : null;
  const country = document.getElementById('fltCountry').value;

  let list = entries.filter(e=>{
    if(activeCat!=='all' && e.category!==activeCat) return false;
    if(st && e.status!==st) return false;
    if(q && !e.title.toLowerCase().includes(q) && !(e.notes||'').toLowerCase().includes(q) && !(e.description||'').toLowerCase().includes(q)) return false;
    if(yFrom && (!e.year || e.year<yFrom)) return false;
    if(yTo && (!e.year || e.year>yTo)) return false;
    if(rFrom!==null && (!e.rating || e.rating<rFrom)) return false;
    if(rTo!==null && (!e.rating || e.rating>rTo)) return false;
    if(country && e.country!==country) return false;
    return true;
  });
  if(sortBy==='title') list.sort((a,b)=>a.title.localeCompare(b.title));
  else if(sortBy==='rating') list.sort((a,b)=>(b.rating||0)-(a.rating||0));
  else list.sort((a,b)=>(b.updated||0)-(a.updated||0));
  return list;
}

function render(){
  buildTabs();
  document.getElementById('statsBtn').classList.toggle('active', statsMode);
  document.getElementById('libraryView').style.display = statsMode ? 'none' : 'block';
  document.getElementById('statsView').style.display = statsMode ? 'block' : 'none';
  if(statsMode){ renderStats(); return; }

  const list = getFiltered();
  const content = document.getElementById('content');
  if(list.length===0){
    content.innerHTML = `<div class="empty"><div class="big">Пока пусто</div>Добавь первую запись в архив, или попробуй сбросить фильтры</div>`;
    return;
  }

  const mode = uiPrefs.view;
  const renderItem = mode==='list' ? rowHtml : mode==='compact' ? compactHtml : cardHtml;
  const wrapClass = mode==='posters' ? 'grid poster-mode' : mode==='list' ? 'list-view' : mode==='compact' ? 'compact-view' : 'grid';
  const wrap = items => `<div class="${wrapClass}">${items.map(renderItem).join('')}</div>`;

  if(uiPrefs.groupBy && uiPrefs.groupBy!=='none'){
    const groups = groupEntries(list, uiPrefs.groupBy);
    content.innerHTML = groups.map(([label, items])=>`<div class="group-header">${escapeHtml(label)} <span class="group-count">${items.length}</span></div>${wrap(items)}`).join('');
  } else {
    content.innerHTML = wrap(list);
  }
}

function groupEntries(list, by){
  const map = new Map();
  if(by==='year'){
    list.forEach(e=>{
      const key = e.year ? String(e.year) : 'Без года';
      if(!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    });
    return Array.from(map.entries()).sort((a,b)=>{
      if(a[0]==='Без года') return 1;
      if(b[0]==='Без года') return -1;
      return Number(b[0])-Number(a[0]);
    });
  }
  list.forEach(e=>{
    if(!map.has(e.status)) map.set(e.status, []);
    map.get(e.status).push(e);
  });
  const order = ['progress','planning','hold','completed','dropped'];
  return order.filter(s=>map.has(s)).map(s=>[STATUS_LABEL[s], map.get(s)]);
}

function pickForMe(){
  const pool = entries.filter(e=>e.status==='planning');
  if(!pool.length){ showToast('В «Запланировано» пока пусто'); return; }
  const pick = pool[Math.floor(Math.random()*pool.length)];
  window.__pickedId = pick.id;
  const cat = CATS[pick.category];
  const initials = pick.title.slice(0,2).toUpperCase();
  document.getElementById('pickCardArea').innerHTML = `
    <div class="pick-card">
      <div class="pick-cover">${pick.cover ? `<img src="${escapeHtml(pick.cover)}" onerror="this.parentElement.innerHTML='<div class=&quot;fallback&quot;>${initials}</div>'">` : `<div class="fallback">${initials}</div>`}</div>
      <div class="pick-title">${escapeHtml(pick.title)}</div>
      <div class="pick-meta">${cat.label}${pick.year?' · '+pick.year:''}${pick.country?' · '+escapeHtml(pick.country):''}</div>
    </div>`;
  document.getElementById('pickOverlay').classList.add('show');
}
function closePickModal(){ document.getElementById('pickOverlay').classList.remove('show'); }
async function startPicked(){
  const e = entries.find(x=>x.id===window.__pickedId);
  if(e){ e.status='progress'; e.updated=Date.now(); await persist(); render(); showToast('Отмечено «в процессе»'); }
  closePickModal();
}

function subLine(e){
  const c = CATS[e.category];
  const f = e.data||{};
  if(e.category==='movies') return f.director || '';
  if(e.category==='series') return f.creator || '';
  if(e.category==='anime') return f.studio || '';
  if(e.category==='books' || e.category==='manga') return f.author || '';
  if(e.category==='games') return f.developer || (f.platform==='RetroAchievements' ? f.consoleName : '') || '';
  return '';
}
function progressLine(e){
  const f = e.data||{};
  if(e.category==='series') return (f.season||'') ;
  if(e.category==='anime') return f.epWatched||f.totalEp ? `${f.epWatched||0}/${f.totalEp||'?'} эп.` : '';
  if(e.category==='books') return f.pagesRead||f.totalPages ? `${f.pagesRead||0}/${f.totalPages||'?'} стр.` : '';
  if(e.category==='manga') return f.chRead||f.totalCh ? `${f.chRead||0}/${f.totalCh||'?'} гл.` : '';
  if(e.category==='games') return f.hours ? `${f.hours} ч.` : '';
  return '';
}

function onCoverError(img, initials, extraHtml){
  extraHtml = extraHtml || '';
  const m = img.src.match(/steamstatic\.com\/steam\/apps\/(\d+)\/library_600x900\.jpg(\?.*)?$/);
  if(m && img.dataset.steamFallback !== '1'){
    img.dataset.steamFallback = '1';
    img.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${m[1]}/header.jpg`;
    return;
  }
  img.parentElement.innerHTML = `${extraHtml}<div class="fallback">${initials}</div>`;
}

const STATUS_OPTIONS = [['planning','план'],['progress','в процессе'],['completed','завершено'],['hold','отложено'],['dropped','брошено']];
function quickSetStatus(ev, id, status){
  ev.stopPropagation();
  const e = entries.find(x=>x.id===id);
  if(!e) return;
  e.status = status;
  if(status==='completed' && !e.watchDate) e.watchDate = new Date().toISOString().slice(0,10);
  e.updated = Date.now();
  persist(); render();
}
function quickSetRating(ev, id, value){
  ev.stopPropagation();
  const e = entries.find(x=>x.id===id);
  if(!e) return;
  const v = parseInt(value);
  e.rating = (isNaN(v) || v<=0) ? null : Math.min(10, v);
  e.updated = Date.now();
  persist(); render();
}

function cardHtml(e){
  const cat = CATS[e.category] || CATS.movies;
  const initials = e.title.slice(0,2).toUpperCase();
  const statusOpts = STATUS_OPTIONS.map(([v,l])=>`<option value="${v}"${e.status===v?' selected':''}>${l}</option>`).join('');
  return `<div class="card" style="--cat-color:${cat.color}" onclick="openView('${e.id}')">
    <div class="cover">
      <div class="catbar"></div>
      ${e.cover ? `<img src="${escapeHtml(e.cover)}" onerror="onCoverError(this,'${initials}','<div class=&quot;catbar&quot;></div>')">` : `<div class="fallback">${initials}</div>`}
    </div>
    <div class="card-body">
      <div class="card-top">
        <div class="card-title">${escapeHtml(e.title)}</div>
        <select class="stamp stamp-select ${STATUS_CLASS[e.status]}" onclick="event.stopPropagation()" onchange="quickSetStatus(event,'${e.id}',this.value)">${statusOpts}</select>
      </div>
      <div class="card-meta">${cat.label}${e.year?' · '+e.year:''}${e.country?' · '+escapeHtml(e.country):''}${e.timesWatched>1?' · ×'+e.timesWatched:''}${e.watchDate?' · '+formatDate(e.watchDate):''}</div>
      ${subLine(e) ? `<div class="card-sub">${escapeHtml(subLine(e))}</div>` : ''}
      <div class="card-foot">
        <input class="quick-rating" type="number" min="0" max="10" placeholder="—" value="${e.rating||''}" onclick="event.stopPropagation()" onchange="quickSetRating(event,'${e.id}',this.value)">
        <span class="progress-txt">${escapeHtml(progressLine(e))}</span>
      </div>
    </div>
  </div>`;
}
function rowHtml(e){
  const cat = CATS[e.category] || CATS.movies;
  const statusOpts = STATUS_OPTIONS.map(([v,l])=>`<option value="${v}"${e.status===v?' selected':''}>${l}</option>`).join('');
  return `<div class="row-item" style="--cat-color:${cat.color}" onclick="openView('${e.id}')">
    <span class="row-dot"></span>
    <span class="row-title">${escapeHtml(e.title)}</span>
    <span class="row-cat">${cat.label}</span>
    <span class="row-year">${e.year||'—'}</span>
    <select class="stamp stamp-select row-status ${STATUS_CLASS[e.status]}" onclick="event.stopPropagation()" onchange="quickSetStatus(event,'${e.id}',this.value)">${statusOpts}</select>
    <input class="quick-rating row-rating" type="number" min="0" max="10" placeholder="—" value="${e.rating||''}" onclick="event.stopPropagation()" onchange="quickSetRating(event,'${e.id}',this.value)">
  </div>`;
}

function compactHtml(e){
  const cat = CATS[e.category] || CATS.movies;
  const initials = e.title.slice(0,2).toUpperCase();
  const metaBits = [cat.label, e.year, subLine(e), progressLine(e)].filter(Boolean);
  return `<div class="compact-item" style="--cat-color:${cat.color}" onclick="openView('${e.id}')">
    <div class="compact-cover">${e.cover ? `<img src="${escapeHtml(e.cover)}" onerror="onCoverError(this,'${initials}')">` : `<div class="fallback">${initials}</div>`}</div>
    <div class="compact-body">
      <div class="compact-top">
        <span class="compact-title">${escapeHtml(e.title)}</span>
        <span class="stamp ${STATUS_CLASS[e.status]}">${statusLabel(e)}</span>
      </div>
      <div class="compact-meta">${metaBits.map(escapeHtml).join(' · ')}</div>
    </div>
    <span class="rating">${e.rating? e.rating+'/10' : '—'}</span>
  </div>`;
}

function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatDate(d){ if(!d) return ''; const [y,m,day]=d.split('-'); return `${day}.${m}.${y}`; }

/* ---------- FORM ---------- */
/* ---------- SMART SEARCH / AUTOFILL ---------- */
let searchTimer = null;
let pendingImportMeta = null;
function onSearchInput(){
  clearTimeout(searchTimer);
  const q = document.getElementById('fSearchQuery').value.trim();
  const box = document.getElementById('searchResults');
  if(q.length < 2){ box.classList.remove('show'); box.innerHTML=''; return; }
  box.classList.add('show');
  box.innerHTML = `<div class="sr-status">ищу...</div>`;
  searchTimer = setTimeout(()=>runSearch(q), 400);
}
function clearSearch(){
  document.getElementById('fSearchQuery').value = '';
  const box = document.getElementById('searchResults');
  box.classList.remove('show'); box.innerHTML='';
}
function onCategoryChange(){
  renderExtraFields();
  clearSearch();
  pendingImportMeta = null;
}
function searchRetroAchievements(q){
  const needle = q.toLowerCase();
  const list = raGamesDb.games || [];
  return list.filter(g=>g.title && g.title.toLowerCase().includes(needle)).slice(0,6).map(g=>({
    title: g.title,
    year: '',
    cover: g.imageIcon ? `https://retroachievements.org${g.imageIcon}` : '',
    description: '',
    source: 'RA',
    meta: { platform: 'RetroAchievements', raGameId: g.id, consoleName: g.consoleName || '' }
  }));
}
async function runSearch(q){
  const cat = document.getElementById('fCategory').value;
  const box = document.getElementById('searchResults');
  try{
    let results = [];
    if(cat==='movies') results = await searchITunes(q,'movie');
    else if(cat==='series') results = await searchTVmaze(q);
    else if(cat==='anime') results = await searchJikan(q,'anime');
    else if(cat==='manga') results = await searchJikan(q,'manga');
    else if(cat==='books') results = await searchOpenLibrary(q);
    else if(cat==='games'){
      const ra = searchRetroAchievements(q);
      let store = [];
      try{ store = await searchCheapShark(q); }catch(e){ /* RA-результаты всё равно покажем */ }
      results = [...ra, ...store].slice(0, 8);
    }

    if(!results.length){ box.innerHTML = `<div class="sr-status">ничего не найдено — заполни вручную</div>`; return; }
    box.innerHTML = results.map((r,i)=>`
      <div class="sr-item" onclick='applyResult(${i})'>
        <img class="sr-thumb" src="${r.cover||''}" onerror="this.style.visibility='hidden'">
        <div class="sr-info"><div class="sr-title">${escapeHtml(r.title)}${r.source==='RA' ? ' <span class="sr-badge">RA</span>' : ''}</div><div class="sr-year">${r.year||''}</div></div>
      </div>`).join('');
    window.__searchCache = results;
  }catch(e){
    box.innerHTML = `<div class="sr-status">не удалось подключиться к базе — заполни вручную</div>`;
  }
}
function applyResult(i){
  const r = window.__searchCache[i];
  document.getElementById('fTitle').value = r.title || '';
  document.getElementById('fYear').value = r.year || '';
  document.getElementById('fCover').value = r.cover || '';
  updateCoverPreview();
  if(r.description && !document.getElementById('fDescription').value) document.getElementById('fDescription').value = r.description;
  const extra = r.extra || {};
  Object.keys(extra).forEach(k=>{
    const el = document.getElementById('ex_'+k);
    if(el) el.value = extra[k];
  });
  pendingImportMeta = r.meta || null;
  clearSearch();
  showToast('Данные подставлены');
}

async function searchITunes(q, media){
  const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=${media}&limit=6`);
  const data = await res.json();
  return (data.results||[]).map(x=>({
    title: x.trackName,
    year: x.releaseDate ? x.releaseDate.slice(0,4) : '',
    cover: x.artworkUrl100 ? x.artworkUrl100.replace('100x100','600x600') : '',
    extra:{}
  }));
}
async function searchTVmaze(q){
  const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return (data||[]).slice(0,6).map(x=>({
    title: x.show.name,
    year: x.show.premiered ? x.show.premiered.slice(0,4) : '',
    cover: x.show.image ? x.show.image.medium : '',
    description: x.show.summary ? x.show.summary.replace(/<[^>]+>/g,'').slice(0,500) : '',
    extra:{ creator: (x.show.network&&x.show.network.name)||(x.show.webChannel&&x.show.webChannel.name)||'' }
  }));
}
async function searchJikan(q, type){
  const res = await fetch(`https://api.jikan.moe/v4/${type}?q=${encodeURIComponent(q)}&limit=6`);
  const data = await res.json();
  return (data.data||[]).map(x=>{
    const extra = {};
    if(type==='anime'){
      extra.studio = x.studios && x.studios[0] ? x.studios[0].name : '';
      extra.totalEp = x.episodes || '';
    } else {
      extra.author = x.authors && x.authors[0] ? x.authors[0].name : '';
      extra.totalCh = x.chapters || '';
    }
    return {
      title: x.title,
      year: x.year || (x.published && x.published.from ? x.published.from.slice(0,4) : ''),
      cover: x.images && x.images.jpg ? x.images.jpg.image_url : '',
      extra
    };
  });
}
async function searchOpenLibrary(q){
  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6`);
  const data = await res.json();
  return (data.docs||[]).map(x=>({
    title: x.title,
    year: x.first_publish_year || '',
    cover: x.cover_i ? `https://covers.openlibrary.org/b/id/${x.cover_i}-M.jpg` : '',
    extra:{ author: x.author_name ? x.author_name[0] : '', totalPages: x.number_of_pages_median || '' }
  }));
}
async function searchCheapShark(q){
  const res = await fetch(`https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(q)}&limit=6`);
  const data = await res.json();
  return (data||[]).slice(0,6).map(x=>({
    title: x.external,
    year: '',
    cover: x.thumb || '',
    extra:{}
  }));
}

function populateCountryList(){
  const common = ['США','Великобритания','Франция','Германия','Япония','Южная Корея','Китай','Россия','Испания','Италия','Канада','Индия','Швеция','Дания','Польша','Бразилия'];
  const hist = new Set();
  entries.forEach(e=>{ if(e.country) hist.add(e.country); });
  const all = Array.from(new Set([...common, ...hist]));
  document.getElementById('dl_country').innerHTML = all.map(c=>`<option value="${escapeHtml(c)}">`).join('');
}


const RU_TO_EN_COUNTRY = {
  'сша':'United States','америка':'United States','соединенные штаты':'United States','соединённые штаты':'United States',
  'великобритания':'United Kingdom','англия':'United Kingdom','британия':'United Kingdom','ук':'United Kingdom',
  'франция':'France','германия':'Germany','япония':'Japan','южная корея':'South Korea','корея':'South Korea',
  'северная корея':'North Korea','китай':'China','россия':'Russia','рф':'Russia','испания':'Spain','италия':'Italy',
  'канада':'Canada','индия':'India','швеция':'Sweden','дания':'Denmark','польша':'Poland','бразилия':'Brazil',
  'мексика':'Mexico','нидерланды':'Netherlands','голландия':'Netherlands','бельгия':'Belgium','австралия':'Australia',
  'аргентина':'Argentina','турция':'Turkey','норвегия':'Norway','финляндия':'Finland','австрия':'Austria',
  'швейцария':'Switzerland','португалия':'Portugal','греция':'Greece','ирландия':'Ireland','украина':'Ukraine',
  'чехия':'Czechia','венгрия':'Hungary','румыния':'Romania','израиль':'Israel','египет':'Egypt',
  'юар':'South Africa','южная африка':'South Africa','новая зеландия':'New Zealand','таиланд':'Thailand',
  'вьетнам':'Vietnam','индонезия':'Indonesia','филиппины':'Philippines','малайзия':'Malaysia','сингапур':'Singapore',
  'гонконг':'Hong Kong','тайвань':'Taiwan','иран':'Iran','ирак':'Iraq','саудовская аравия':'Saudi Arabia',
  'чили':'Chile','колумбия':'Colombia','перу':'Peru','венесуэла':'Venezuela','казахстан':'Kazakhstan',
  'беларусь':'Belarus','белоруссия':'Belarus','грузия':'Georgia','азербайджан':'Azerbaijan','армения':'Armenia',
  'узбекистан':'Uzbekistan','монголия':'Mongolia','пакистан':'Pakistan','бангладеш':'Bangladesh',
  'шри-ланка':'Sri Lanka','непал':'Nepal','исландия':'Iceland','хорватия':'Croatia','сербия':'Serbia',
  'болгария':'Bulgaria','словакия':'Slovakia','словения':'Slovenia','литва':'Lithuania','латвия':'Latvia',
  'эстония':'Estonia','люксембург':'Luxembourg','кипр':'Cyprus','мальта':'Malta',
};

function buildCountryMapChart(countryCounts){
  const entries2 = Object.entries(countryCounts);
  if(!entries2.length) return '';
  const max = Math.max(...entries2.map(x=>x[1]));
  // map English label -> count (case-insensitive, using dictionary + direct match fallback)
  const enCounts = {};
  entries2.forEach(([ru,count])=>{
    const key = ru.trim().toLowerCase();
    const en = RU_TO_EN_COUNTRY[key] || ru; // fallback: assume already English or matches aria-label directly
    enCounts[en.toLowerCase()] = (enCounts[en.toLowerCase()]||0) + count;
  });

  const container = document.createElement('div');
  container.innerHTML = WORLD_MAP_SVG;
  const svg = container.querySelector('svg');
  svg.querySelectorAll('path').forEach(p=>{
    const label = (p.getAttribute('aria-label')||'').toLowerCase();
    const count = enCounts[label];
    if(count){
      const intensity = 0.25 + 0.75*(count/max);
      p.setAttribute('fill', `rgba(201,162,39,${intensity.toFixed(2)})`);
      p.setAttribute('stroke', 'var(--brass)');
      p.setAttribute('stroke-width', '0.5');
      const title = document.createElementNS('http://www.w3.org/2000/svg','title');
      title.textContent = `${p.getAttribute('aria-label')}: ${count}`;
      p.appendChild(title);
    } else {
      p.setAttribute('fill', 'var(--surface-alt)');
      p.setAttribute('stroke', 'var(--line)');
      p.setAttribute('stroke-width', '0.5');
    }
  });
  svg.classList.add('country-map-svg');
  return `<div class="map-wrap">${svg.outerHTML}</div>`;
}

function buildDonutChart(data){
  if(!data.length) return `<div class="import-hint">Пока нет данных</div>`;
  const total = data.reduce((s,d)=>s+d.value,0);
  const r = 52, cx=64, cy=64, circ = 2*Math.PI*r;
  let offset = 0;
  const segments = data.map(d=>{
    const frac = d.value/total;
    const dash = frac*circ;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="16"
      stroke-dasharray="${dash} ${circ-dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += dash;
    return seg;
  }).join('');
  const legend = data.map(d=>`
    <div class="legend-row"><span class="legend-dot" style="background:${d.color}"></span>${d.label} <b>${d.value}</b> <span class="legend-pct">(${Math.round(d.value/total*100)}%)</span></div>
  `).join('');
  return `
    <div class="donut-wrap">
      <svg width="128" height="128" viewBox="0 0 128 128">${segments}</svg>
      <div class="legend">${legend}</div>
    </div>`;
}

function buildColumnChart(histCounts){
  const entriesArr = Object.entries(histCounts).map(([k,v])=>[parseInt(k),v]);
  const max = Math.max(...entriesArr.map(x=>x[1]),1);
  const w=18, gap=8, chartH=120;
  const bars = entriesArr.map((([r,c],i)=>{
    const h = c===0 ? 0 : Math.max(4, (c/max)*chartH);
    const x = i*(w+gap);
    return `<rect x="${x}" y="${chartH-h}" width="${w}" height="${h}" rx="3" fill="var(--brass)"><title>${r}/10: ${c}</title></rect>
      <text x="${x+w/2}" y="${chartH+16}" text-anchor="middle" class="col-label">${r}</text>`;
  })).join('');
  const totalW = entriesArr.length*(w+gap);
  return `<svg width="${totalW}" height="${chartH+24}" viewBox="0 0 ${totalW} ${chartH+24}" class="col-chart">${bars}</svg>`;
}

function fieldHistory(key){
  const vals = new Set();
  entries.forEach(e=>{ if(e.data && e.data[key]) vals.add(e.data[key]); });
  return Array.from(vals);
}
function renderExtraFields(prefill){
  const cat = document.getElementById('fCategory').value;
  const fields = CATS[cat].fields;
  const data = prefill || {};
  document.getElementById('extraFields').innerHTML = fields.map(f=>{
    const isText = !f.type || f.type==='text';
    const dlId = `dl_${f.k}`;
    const hist = isText ? fieldHistory(f.k) : [];
    const dl = hist.length ? `<datalist id="${dlId}">${hist.map(v=>`<option value="${escapeHtml(v)}">`).join('')}</datalist>` : '';
    return `<div class="field">
      <label>${f.l}</label>
      <input id="ex_${f.k}" type="${f.type||'text'}" placeholder="${f.ph||''}" value="${escapeHtml(data[f.k]||'')}" ${hist.length?`list="${dlId}"`:''}>
      ${dl}
    </div>`;
  }).join('');
}
function updateCoverPreview(){
  const url = document.getElementById('fCover').value.trim();
  const el = document.getElementById('coverPreview');
  if(url){ el.innerHTML = `<img src="${escapeHtml(url)}" onerror="this.parentElement.textContent='не удалось загрузить'">`; }
  else{ el.innerHTML = 'нет обложки'; el.textContent='нет обложки'; }
}
function setStatusPill(el){
  document.querySelectorAll('#statusPills .pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('fStatus').value = el.dataset.v;
  if(el.dataset.v==='completed' && !document.getElementById('fWatchDate').value){
    document.getElementById('fWatchDate').value = new Date().toISOString().slice(0,10);
  }
}
function syncStatusPill(v){
  document.querySelectorAll('#statusPills .pill').forEach(p=>p.classList.toggle('active', p.dataset.v===v));
  document.getElementById('fStatus').value = v;
}
function updateRatingReadout(){
  const v = document.getElementById('fRating').value;
  document.getElementById('ratingReadout').textContent = v==='0' ? '—' : v+'/10';
}

function openModal(id){
  document.getElementById('editId').value = id||'';
  clearSearch();
  pendingImportMeta = null;
  if(id){
    const e = entries.find(x=>x.id===id);
    document.getElementById('modalTitle').textContent = 'Редактировать';
    document.getElementById('fTitle').value = e.title;
    document.getElementById('fCategory').value = e.category;
    syncStatusPill(e.status);
    document.getElementById('fRating').value = e.rating||0;
    document.getElementById('fYear').value = e.year||'';
    document.getElementById('fCountry').value = e.country||'';
    document.getElementById('fWatchDate').value = e.watchDate||'';
    document.getElementById('fTimesWatched').value = e.timesWatched||'';
    document.getElementById('fDescription').value = e.description||'';
    document.getElementById('fNotes').value = e.notes||'';
    document.getElementById('fCover').value = e.cover||'';
    updateCoverPreview();
    updateRatingReadout();
    renderExtraFields(e.data||{});
    document.getElementById('deleteBtn').style.display = 'block';
    document.getElementById('saveMoreBtn').style.display = 'none';
  } else {
    document.getElementById('modalTitle').textContent = 'Новая запись';
    ['fTitle','fYear','fCountry','fDescription','fNotes','fCover','fWatchDate','fTimesWatched'].forEach(fid=>document.getElementById(fid).value='');
    document.getElementById('fRating').value = 0;
    document.getElementById('fCategory').value = (activeCat!=='all'&&CATS[activeCat])?activeCat:'movies';
    syncStatusPill('planning');
    updateRatingReadout();
    document.getElementById('coverPreview').textContent = 'нет обложки';
    renderExtraFields();
    document.getElementById('deleteBtn').style.display = 'none';
    document.getElementById('saveMoreBtn').style.display = 'inline-block';
  }
  document.getElementById('overlay').classList.add('show');
  populateCountryList();
  setTimeout(()=>document.getElementById('fSearchQuery').focus(), 50);
}
function closeModal(){ document.getElementById('overlay').classList.remove('show'); }

let viewingId = null;
function openView(id){
  viewingId = id;
  const e = entries.find(x=>x.id===id);
  if(!e) return;
  const cat = CATS[e.category] || CATS.movies;
  const initials = e.title.slice(0,2).toUpperCase();
  document.getElementById('viewCover').innerHTML = e.cover
    ? `<img src="${escapeHtml(e.cover)}" onerror="onCoverError(this,'${initials}')">`
    : `<div class="fallback">${initials}</div>`;
  document.getElementById('viewTitle').textContent = e.title;
  document.getElementById('viewStamp').textContent = statusLabel(e);
  document.getElementById('viewStamp').className = `stamp ${STATUS_CLASS[e.status]}`;
  document.getElementById('viewMeta').textContent = `${cat.label}${e.rating?' · ★'+e.rating+'/10':''}${e.year?' · '+e.year:''}${e.country?' · '+e.country:''}${e.timesWatched>1?' · ×'+e.timesWatched:''}${e.watchDate?' · '+formatDate(e.watchDate):''}`;

  const f = e.data||{};
  document.getElementById('viewFields').innerHTML = cat.fields
    .filter(fd=>f[fd.k]!==undefined && f[fd.k]!==null && f[fd.k]!=='')
    .map(fd=>`<div class="view-field"><span class="view-field-label">${escapeHtml(fd.l)}</span><span class="view-field-value">${escapeHtml(String(f[fd.k]))}</span></div>`)
    .join('');

  const descWrap = document.getElementById('viewDescriptionWrap');
  if(e.description){ descWrap.style.display=''; document.getElementById('viewDescription').textContent = e.description; }
  else descWrap.style.display = 'none';

  document.getElementById('viewNotes').textContent = e.notes || 'без заметок';
  renderViewAchievements(e);
  document.getElementById('viewOverlay').classList.add('show');
}
function closeView(){ document.getElementById('viewOverlay').classList.remove('show'); viewingId = null; }
function editFromView(){
  const id = viewingId;
  closeView();
  openModal(id);
}

/* ---------- STEAM ACHIEVEMENTS ---------- */
function renderViewAchievements(entry){
  const el = document.getElementById('viewAchievements');
  if(!el) return;
  const f = entry.data || {};
  const isSteam = f.platform === 'Steam' && f.appid;
  const isRa = f.platform === 'RetroAchievements' && f.raGameId;
  if(!isSteam && !isRa){ el.innerHTML = ''; return; }
  const label = isSteam ? 'Достижения Steam' : 'Достижения RetroAchievements';
  const list = f.achievements;
  let body;
  if(achievementsLoading){
    body = `<div class="import-hint">Загружаю ачивки...</div>`;
  } else if(f.achievementsError){
    body = `<div class="import-hint">${escapeHtml(f.achievementsError)}</div>`;
  } else if(list && list.length){
    const done = list.filter(a=>a.achieved).length;
    const sorted = list.slice().sort((a,b)=> (b.achieved-a.achieved) || (b.unlocktime-a.unlocktime));
    body = `
      <div class="ach-progress">Открыто ${done} из ${list.length}</div>
      <div class="bar-track" style="margin-bottom:12px;"><div class="bar-fill" style="width:${list.length?Math.round(done/list.length*100):0}%;background:var(--brass);"></div></div>
      <div class="ach-grid">
        ${sorted.map(a=>`
          <div class="ach-tile${a.achieved?'':' locked'}" title="${escapeHtml(a.description||'')}">
            ${a.icon ? `<img class="ach-icon" src="${escapeHtml(a.icon)}">` : `<div class="ach-icon ach-icon-fallback">🏆</div>`}
            <div class="ach-info">
              <div class="ach-title">${escapeHtml(a.title)}</div>
              ${a.description ? `<div class="ach-desc">${escapeHtml(a.description)}</div>` : ''}
              ${a.achieved && a.unlocktime ? `<div class="ach-desc">${formatDate(new Date(a.unlocktime*1000).toISOString().slice(0,10))}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
  } else {
    body = `<div class="import-hint">Ачивки ещё не загружены.</div>`;
  }
  el.innerHTML = `
    <div class="achievements-panel">
      <div class="ach-header">
        <div class="subhead" style="margin:0;padding:0;border:none;">🏆 ${label}</div>
        <button class="btn-ghost" ${achievementsLoading?'disabled':''} onclick="loadGameAchievements('${entry.id}')">${achievementsLoading ? 'Загрузка...' : (list && list.length ? '🔄 Обновить' : 'Загрузить ачивки')}</button>
      </div>
      ${body}
    </div>`;
}


async function saveEntry(keepOpen){
  const title = document.getElementById('fTitle').value.trim();
  if(!title){ showToast('Введи название'); document.getElementById('fTitle').focus(); return; }
  const id = document.getElementById('editId').value;
  const category = document.getElementById('fCategory').value;
  const extraData = {};
  CATS[category].fields.forEach(f=>{
    const v = document.getElementById('ex_'+f.k).value.trim();
    if(v) extraData[f.k] = f.type==='number' ? parseFloat(v) : v;
  });
  if(pendingImportMeta && category==='games') Object.assign(extraData, pendingImportMeta);
  pendingImportMeta = null;
  const ratingVal = parseFloat(document.getElementById('fRating').value);
  const data = {
    title, category,
    status: document.getElementById('fStatus').value,
    rating: ratingVal>0 ? ratingVal : null,
    year: parseInt(document.getElementById('fYear').value)||null,
    country: document.getElementById('fCountry').value.trim(),
    watchDate: document.getElementById('fWatchDate').value || null,
    timesWatched: parseInt(document.getElementById('fTimesWatched').value)||null,
    cover: document.getElementById('fCover').value.trim(),
    description: document.getElementById('fDescription').value.trim(),
    notes: document.getElementById('fNotes').value.trim(),
    data: extraData,
    updated: Date.now()
  };
  if(id){
    const idx = entries.findIndex(x=>x.id===id);
    entries[idx] = {...entries[idx], ...data};
  } else {
    entries.push({id: 'e'+Date.now()+Math.random().toString(36).slice(2,7), ...data});
  }
  await persist();
  render();
  showToast('Сохранено');
  if(keepOpen && !id){
    const keepCategory = category;
    ['fTitle','fYear','fCountry','fDescription','fNotes','fCover','fWatchDate','fTimesWatched'].forEach(fid=>document.getElementById(fid).value='');
    document.getElementById('fRating').value = 0;
    document.getElementById('fCategory').value = keepCategory;
    syncStatusPill('planning');
    updateRatingReadout();
    document.getElementById('coverPreview').textContent = 'нет обложки';
    renderExtraFields();
    clearSearch();
    document.getElementById('fSearchQuery').focus();
  } else {
    closeModal();
  }
}
document.addEventListener('keydown', e=>{
  if(!document.getElementById('overlay').classList.contains('show')) return;
  if(e.key==='Escape'){ closeModal(); return; }
  if(e.key==='Enter' && document.activeElement.tagName!=='TEXTAREA' && document.activeElement.id!=='fSearchQuery'){
    e.preventDefault();
    saveEntry(false);
  }
});
async function deleteEntry(){
  const id = document.getElementById('editId').value;
  entries = entries.filter(x=>x.id!==id);
  await persist();
  closeModal();
  render();
  showToast('Удалено');
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}

/* ---------- STATS ---------- */
function estimateHours(e){
  const d = e.data || {};
  if(e.category==='games') return d.hours || 0;
  if(e.category==='movies') return ((d.runtime||120)/60) * (e.timesWatched||1);
  if(e.category==='series'){
    const ep = e.status==='completed' ? (d.totalEp||0) : Math.round((d.totalEp||0)*0.4);
    return ep * 45/60;
  }
  if(e.category==='anime'){
    const ep = d.epWatched || (e.status==='completed' ? (d.totalEp||0) : 0);
    return ep * 24/60;
  }
  if(e.category==='books'){
    const p = d.pagesRead || (e.status==='completed' ? (d.totalPages||0) : 0);
    return p / 30;
  }
  if(e.category==='manga'){
    const c = d.chRead || (e.status==='completed' ? (d.totalCh||0) : 0);
    return c * 12/60;
  }
  return 0;
}

function entryYear(e){
  if(e.watchDate) return parseInt(e.watchDate.slice(0,4));
  if(e.updated) return new Date(e.updated).getFullYear();
  return null;
}

function availableYears(){
  const ys = new Set();
  entries.forEach(e=>{ const y = entryYear(e); if(y) ys.add(y); });
  return Array.from(ys).sort((a,b)=>b-a);
}

let statsYear = 'all';

function buildHeatmap(filteredEntries, year){
  const counts = {};
  const titlesByDate = {};
  filteredEntries.forEach(e=>{
    if(e.watchDate){
      counts[e.watchDate] = (counts[e.watchDate]||0)+1;
      (titlesByDate[e.watchDate] = titlesByDate[e.watchDate]||[]).push(e.title);
    }
  });

  let start, end;
  if(year==='all'){
    end = new Date();
    start = new Date(); start.setDate(start.getDate()-364);
  } else {
    start = new Date(year+'-01-01');
    end = new Date(year+'-12-31');
  }
  // align start to Sunday
  const startAligned = new Date(start);
  startAligned.setDate(startAligned.getDate() - startAligned.getDay());

  const weeks = [];
  let cur = new Date(startAligned);
  while(cur <= end){
    const week = [];
    for(let d=0; d<7; d++){
      const dateStr = cur.toISOString().slice(0,10);
      const inRange = cur >= start && cur <= end;
      week.push({date: dateStr, count: inRange ? (counts[dateStr]||0) : null});
      cur.setDate(cur.getDate()+1);
    }
    weeks.push(week);
  }
  const levelOf = c => c===null ? -1 : c===0 ? 0 : c===1 ? 1 : c<=3 ? 2 : c<=5 ? 3 : 4;
  const monthLabels = [];
  let lastMonth = -1;
  weeks.forEach((w,wi)=>{
    const d = new Date(w[0].date);
    if(d.getMonth()!==lastMonth && w[0].count!==null){ monthLabels.push({wi, label: d.toLocaleDateString('ru-RU',{month:'short'})}); lastMonth = d.getMonth(); }
  });

  return `
    <div class="heatmap-wrap">
      <div class="heatmap-months">
        ${monthLabels.map(m=>`<span style="grid-column:${m.wi+1}">${m.label}</span>`).join('')}
      </div>
      <div class="heatmap-grid" style="grid-template-columns:repeat(${weeks.length},1fr)">
        ${weeks.map(w=>`<div class="hm-col">${w.map(d=>{
          if(d.count===null) return `<div class="hm-cell hm-empty"></div>`;
          const tip = d.count ? `${d.date}: ${(titlesByDate[d.date]||[]).join(', ')}` : `${d.date}: нет завершений`;
          return `<div class="hm-cell hm-l${levelOf(d.count)}" title="${escapeHtml(tip)}"></div>`;
        }).join('')}</div>`).join('')}
      </div>
      <div class="heatmap-legend">меньше <span class="hm-cell hm-l0"></span><span class="hm-cell hm-l1"></span><span class="hm-cell hm-l2"></span><span class="hm-cell hm-l3"></span><span class="hm-cell hm-l4"></span> больше</div>
    </div>`;
}

function renderStats(){
  const el = document.getElementById('statsView');
  if(entries.length===0){
    el.innerHTML = `<div class="empty"><div class="big">Нет данных</div>Статистика появится после первых записей</div>`;
    return;
  }
  const years = availableYears();
  const list = statsYear==='all' ? entries : entries.filter(e=>entryYear(e)===parseInt(statsYear));

  const total = list.length;
  const completed = list.filter(e=>e.status==='completed').length;
  const rated = list.filter(e=>e.rating);
  const avgRating = rated.length ? (rated.reduce((s,e)=>s+e.rating,0)/rated.length).toFixed(1) : '—';
  const totalHours = Math.round(list.reduce((s,e)=>s+estimateHours(e),0));

  const byCat = Object.entries(CATS).map(([key,c])=>({key,c,count:list.filter(e=>e.category===key).length}));
  const maxCount = Math.max(...byCat.map(x=>x.count),1);
  const favCat = byCat.reduce((a,b)=>b.count>a.count?b:a, byCat[0]);

  const top = [...rated].sort((a,b)=>b.rating-a.rating).slice(0,8);
  const rewatched = [...list].filter(e=>e.timesWatched>1).sort((a,b)=>b.timesWatched-a.timesWatched).slice(0,8);

  const histCounts = {};
  for(let i=1;i<=10;i++) histCounts[i]=0;
  rated.forEach(e=>{ const r=Math.round(e.rating); if(histCounts[r]!==undefined) histCounts[r]++; });
  const maxHist = Math.max(...Object.values(histCounts),1);

  const countryCounts = {};
  list.forEach(e=>{ if(e.country) countryCounts[e.country] = (countryCounts[e.country]||0)+1; });
  const countryList = Object.entries(countryCounts).sort((a,b)=>b[1]-a[1]);
  const maxCountry = Math.max(...countryList.map(x=>x[1]),1);
  const topCountry = countryList[0];

  el.innerHTML = `
    <div class="stats-wrap">
      <div class="topbar" style="margin-bottom:4px;">
        <select class="filter" id="statsYearSelect" onchange="statsYear=this.value; renderStats();">
          <option value="all" ${statsYear==='all'?'selected':''}>Всё время</option>
          ${years.map(y=>`<option value="${y}" ${String(statsYear)===String(y)?'selected':''}>${y}</option>`).join('')}
        </select>
      </div>

      <div class="wrapped-card">
        <div class="wrapped-eyebrow">${statsYear==='all' ? 'ИТОГИ ЗА ВСЁ ВРЕМЯ' : 'ИТОГИ ' + statsYear}</div>
        <div class="wrapped-big">${total}</div>
        <div class="wrapped-sub">записей в архиве${total?`, из них ${completed} завершено`:''}</div>
        <div class="wrapped-row">
          <div class="wrapped-stat"><b>${totalHours}ч</b><span>времени потрачено</span></div>
          <div class="wrapped-stat"><b>${favCat.count?favCat.c.label:'—'}</b><span>любимая категория</span></div>
          <div class="wrapped-stat"><b>${avgRating}</b><span>средняя оценка</span></div>
        </div>
        ${top[0] ? `<div class="wrapped-top">🏆 Лучшее: <b>${escapeHtml(top[0].title)}</b> — ${top[0].rating}/10</div>` : ''}
        ${topCountry ? `<div class="wrapped-top">🌍 Чаще всего: <b>${escapeHtml(topCountry[0])}</b> (${topCountry[1]})</div>` : ''}
      </div>

      <div>
        <div class="section-title">Активность</div>
        ${buildHeatmap(list, statsYear)}
      </div>

      <div class="stat-cards">
        <div class="stat-card"><div class="num">${total}</div><div class="lbl">Всего записей</div></div>
        <div class="stat-card"><div class="num">${completed}</div><div class="lbl">Завершено</div></div>
        <div class="stat-card"><div class="num">${avgRating}</div><div class="lbl">Средняя оценка</div></div>
        <div class="stat-card"><div class="num">${totalHours}</div><div class="lbl">Часов всего (оценка)</div></div>
      </div>

      <div class="chart-row">
        <div class="chart-box">
          <div class="section-title">По категориям</div>
          ${buildDonutChart(byCat.filter(x=>x.count>0).map(x=>({label:x.c.label,value:x.count,color:x.c.hex})))}
        </div>
        <div class="chart-box">
          <div class="section-title">Оценки</div>
          ${buildColumnChart(histCounts)}
        </div>
      </div>

      ${top.length ? `
      <div>
        <div class="section-title">Топ по оценке</div>
        <div class="top-list">
          ${top.map((e,i)=>`
            <div class="top-row">
              <div class="rank">${i+1}</div>
              <div class="t-cat" style="background:${CATS[e.category].hex}"></div>
              <div class="t-title">${escapeHtml(e.title)}</div>
              <div class="t-rating">${e.rating}/10</div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      ${countryList.length ? `
      <div>
        <div class="section-title">По странам</div>
        <div id="countryMapArea"></div>
        <div class="chip-row" style="margin-top:12px;">
          ${countryList.slice(0,8).map(([country,c])=>`<div class="chip">${escapeHtml(country)} <b>${c}</b></div>`).join('')}
        </div>
      </div>` : ''}

      ${rewatched.length ? `
      <div>
        <div class="section-title">Топ пересмотров</div>
        <div class="top-list">
          ${rewatched.map((e,i)=>`
            <div class="top-row">
              <div class="rank">${i+1}</div>
              <div class="t-cat" style="background:${CATS[e.category].hex}"></div>
              <div class="t-title">${escapeHtml(e.title)}</div>
              <div class="t-rating">×${e.timesWatched}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>
  `;
  if(countryList.length){
    document.getElementById('countryMapArea').innerHTML = buildCountryMapChart(Object.fromEntries(countryList));
  }
}

async function dedupeEntries(){
  const groups = {};
  entries.forEach(e=>{
    const key = e.category+'::'+e.title.trim().toLowerCase();
    (groups[key] = groups[key] || []).push(e);
  });
  const dupGroups = Object.values(groups).filter(g=>g.length>1);
  const removedCount = dupGroups.reduce((sum,g)=>sum+g.length-1, 0);
  if(!removedCount){ showToast('Дубликатов не найдено'); return; }
  if(!confirm(`Найдено ${removedCount} дублирующих записей (по названию и категории). Склеить и удалить лишние?`)) return;

  const score = x => (x.rating?2:0) + (x.cover?1:0);
  const kept = [];
  dupGroups.forEach(group=>{
    group.sort((a,b)=> score(b)-score(a) || b.updated-a.updated);
    const primary = group[0];
    group.slice(1).forEach(dup=>{
      if(!primary.cover && dup.cover) primary.cover = dup.cover;
      if(!primary.rating && dup.rating) primary.rating = dup.rating;
      if(!primary.notes && dup.notes) primary.notes = dup.notes;
      if(!primary.description && dup.description) primary.description = dup.description;
      if(!primary.watchDate && dup.watchDate) primary.watchDate = dup.watchDate;
      if(!primary.year && dup.year) primary.year = dup.year;
      if(dup.data && dup.data.hours && !(primary.data && primary.data.hours)) primary.data = {...primary.data, hours: dup.data.hours};
    });
    kept.push(primary);
  });
  const dupIds = new Set(dupGroups.flatMap(g=>g.slice(1).map(x=>x.id)));
  entries = entries.filter(e=>!dupIds.has(e.id));
  await persist();
  render();
  showToast(`Удалено дубликатов: ${removedCount}`);
}

function exportData(format){
  if(entries.length===0){ showToast('Архив пуст'); return; }
  let blob, filename;
  if(format==='json'){
    blob = new Blob([JSON.stringify(entries,null,2)], {type:'application/json'});
    filename = 'archive-export.json';
  } else {
    const headers = ['title','category','status','rating','year','country','watchDate','timesWatched','cover','description','notes'];
    const rows = entries.map(e=>{
      const base = headers.map(h=>`"${(e[h]??'').toString().replace(/"/g,'""')}"`);
      const extra = `"${JSON.stringify(e.data||{}).replace(/"/g,'""')}"`;
      return [...base, extra].join(',');
    });
    blob = new Blob([[...headers,'details'].join(',')+'\n'+rows.join('\n')], {type:'text/csv'});
    filename = 'archive-export.csv';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  showToast('Экспортировано');
}

/* ---------- IMPORT ---------- */
function openImportModal(){ document.getElementById('importOverlay').classList.add('show'); }
function closeImportModal(){ document.getElementById('importOverlay').classList.remove('show'); }
function switchImportTab(tab){
  document.getElementById('tabExport').classList.toggle('active', tab==='export');
  document.getElementById('tabFile').classList.toggle('active', tab==='file');
  document.getElementById('tabShiki').classList.toggle('active', tab==='shiki');
  document.getElementById('tabSteam').classList.toggle('active', tab==='steam');
  document.getElementById('tabRA').classList.toggle('active', tab==='ra');
  document.getElementById('panelExport').classList.toggle('active', tab==='export');
  document.getElementById('panelFile').classList.toggle('active', tab==='file');
  document.getElementById('panelShiki').classList.toggle('active', tab==='shiki');
  document.getElementById('panelSteam').classList.toggle('active', tab==='steam');
  document.getElementById('panelRA').classList.toggle('active', tab==='ra');
}

let importRows = [];
let importHeaders = [];

function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length);
  if(!lines.length) return {headers:[],rows:[]};
  const splitLine = (line)=>{
    const out=[]; let cur=''; let inQ=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){ if(inQ && line[i+1]==='"'){cur+='"';i++;} else inQ=!inQ; }
      else if(ch===',' && !inQ){ out.push(cur); cur=''; }
      else cur+=ch;
    }
    out.push(cur);
    return out;
  };
  const headers = splitLine(lines[0]).map(h=>h.trim());
  const rows = lines.slice(1).map(l=>{
    const vals = splitLine(l);
    const obj={};
    headers.forEach((h,i)=>obj[h]=(vals[i]||'').trim());
    return obj;
  });
  return {headers, rows};
}

function handleFile(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e)=>{
    const text = e.target.result;
    if(file.name.endsWith('.json')){
      try{
        const data = JSON.parse(text);
        const arr = Array.isArray(data) ? data : (data.games||data.items||data.list||[]);
        if(!arr.length){ showToast('Пустой или нераспознанный JSON'); return; }
        importHeaders = Object.keys(arr[0]);
        importRows = arr;
      }catch(err){ showToast('Не удалось прочитать JSON'); return; }
    } else {
      const {headers, rows} = parseCSV(text);
      if(!headers.length){ showToast('Пустой CSV'); return; }
      importHeaders = headers; importRows = rows;
    }
    renderMapping();
  };
  reader.readAsText(file);
}

const TARGET_FIELDS = [
  {k:'', l:'— пропустить —'},
  {k:'title', l:'Название'},
  {k:'cover', l:'Обложка (URL)'},
  {k:'year', l:'Год'},
  {k:'rating', l:'Оценка'},
  {k:'status', l:'Статус'},
  {k:'description', l:'Описание'},
  {k:'notes', l:'Заметки'},
];
function guessMap(h){
  const s = h.toLowerCase();
  if(/title|name|назв/.test(s)) return 'title';
  if(/cover|image|img|poster|обложк/.test(s)) return 'cover';
  if(/year|год/.test(s)) return 'year';
  if(/rating|score|оцен/.test(s)) return 'rating';
  if(/status|статус/.test(s)) return 'status';
  if(/description|synopsis|опис/.test(s)) return 'description';
  if(/note|comment|заметк/.test(s)) return 'notes';
  return '';
}

function renderMapping(){
  const area = document.getElementById('mapArea');
  let html = `<div class="subhead">Сопоставь колонки (${importRows.length} строк найдено)</div>`;
  html += `<div class="field"><label>Категория для всех записей</label>
    <select id="mapCategory">
      ${Object.entries(CATS).map(([k,c])=>`<option value="${k}">${c.label}</option>`).join('')}
    </select></div>`;
  importHeaders.forEach(h=>{
    html += `<div class="map-row">
      <div class="col-name">${escapeHtml(h)}</div>
      <select id="map_${btoa(unescape(encodeURIComponent(h))).replace(/=/g,'')}" data-src="${escapeHtml(h)}">
        ${TARGET_FIELDS.map(f=>`<option value="${f.k}" ${guessMap(h)===f.k?'selected':''}>${f.l}</option>`).join('')}
      </select>
    </div>`;
  });
  html += `<button class="btn-primary" style="margin-top:10px;width:100%" onclick="commitImport()">Импортировать ${importRows.length} записей</button>`;
  area.innerHTML = html;
}

async function commitImport(){
  const category = document.getElementById('mapCategory').value;
  const selects = document.querySelectorAll('#mapArea select[data-src]');
  const mapping = {};
  selects.forEach(s=>{ if(s.value) mapping[s.value] = s.dataset.src; });
  if(!mapping.title){ showToast('Нужно выбрать колонку для названия'); return; }
  let added = 0;
  importRows.forEach(row=>{
    const title = (row[mapping.title]||'').trim();
    if(!title) return;
    entries.push({
      id: 'e'+Date.now()+Math.random().toString(36).slice(2,7),
      title, category,
      status: mapping.status ? normalizeStatus(row[mapping.status]) : 'completed',
      rating: mapping.rating ? parseFloat(row[mapping.rating])||null : null,
      year: mapping.year ? parseInt(row[mapping.year])||null : null,
      cover: mapping.cover ? row[mapping.cover] : '',
      description: mapping.description ? row[mapping.description] : '',
      notes: mapping.notes ? row[mapping.notes] : '',
      data:{}, updated: Date.now()
    });
    added++;
  });
  await persist();
  closeImportModal();
  render();
  showToast(`Импортировано: ${added}`);
}
function normalizeStatus(v){
  const s=(v||'').toLowerCase();
  if(/plan|хочу|буду/.test(s)) return 'planning';
  if(/progress|watching|playing|смотрю|играю|читаю/.test(s)) return 'progress';
  if(/hold|отлож/.test(s)) return 'hold';
  if(/drop|брош/.test(s)) return 'dropped';
  return 'completed';
}

async function importShikimori(type){
  const user = document.getElementById('shikiUser').value.trim();
  const statusEl = document.getElementById('shikiStatus');
  if(!user){ statusEl.textContent = 'Введи ник'; return; }
  statusEl.textContent = 'загружаю...';
  try{
    const res = await fetch(`https://shikimori.one/api/users/${encodeURIComponent(user)}/${type}_rates?limit=1000`);
    if(!res.ok) throw new Error('bad response');
    const data = await res.json();
    if(!data.length){ statusEl.textContent = 'Список пуст или профиль закрыт'; return; }
    let added = 0;
    data.forEach(item=>{
      const media = item[type];
      if(!media) return;
      const extra = type==='anime'
        ? {epWatched:item.episodes||'', totalEp:media.episodes||''}
        : {chRead:item.chapters||'', totalCh:media.chapters||''};
      entries.push({
        id: 'e'+Date.now()+Math.random().toString(36).slice(2,7),
        title: media.russian || media.name,
        category: type,
        status: normalizeStatus(item.status),
        rating: item.score || null,
        year: null,
        cover: media.image ? 'https://shikimori.one'+(media.image.original||media.image.preview) : '',
        notes: '', data: extra, updated: Date.now()
      });
      added++;
    });
    await persist();
    render();
    statusEl.textContent = `Готово — импортировано ${added}`;
    showToast(`Импортировано: ${added}`);
  }catch(e){
    statusEl.textContent = 'Не удалось получить данные (открой файл напрямую в браузере, не в превью чата)';
  }
}

function parseSteamGames(raw){
  const data = JSON.parse(raw);
  const games = data.games || (data.response && data.response.games) || [];
  return games.map(g=>({
    appid: g.appid,
    name: g.name,
    hours: g.playtime_forever ? g.playtime_forever/60 : 0,
    logo: g.appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_600x900.jpg` : '',
    lastPlayed: g.rtime_last_played ? new Date(g.rtime_last_played*1000).toISOString().slice(0,10) : ''
  })).filter(g=>g.name);
}

async function commitSteamGames(games, statusEl){
  let added = 0, updated = 0;
  games.forEach(g=>{
    const hours = g.hours ? Math.round(g.hours*10)/10 : '';
    const existing = entries.find(x=>x.category==='games' && x.data && x.data.platform==='Steam' && x.title.toLowerCase()===g.name.toLowerCase());
    if(existing){
      if(g.logo) existing.cover = g.logo;
      existing.data = {...existing.data, hours, appid: g.appid};
      if(g.lastPlayed) existing.watchDate = g.lastPlayed;
      if(g.hours>0 && existing.status==='planning') existing.status = 'progress';
      existing.updated = Date.now();
      updated++;
    } else {
      entries.push({
        id: 'e'+Date.now()+Math.random().toString(36).slice(2,7),
        title: g.name, category: 'games',
        status: g.hours>0 ? 'progress' : 'planning',
        rating: null, year: null, cover: g.logo||'', notes:'',
        watchDate: g.lastPlayed || null,
        data:{ hours, platform:'Steam', appid: g.appid },
        updated: Date.now()
      });
      added++;
    }
  });
  await persist();
  render();
  const msg = added && updated ? `Готово — добавлено ${added}, обновлено ${updated}`
    : updated ? `Готово — обновлено ${updated} игр`
    : `Готово — импортировано ${added} игр`;
  statusEl.textContent = msg;
  showToast(msg);
}

function parseAppDetails(appid, raw){
  const data = JSON.parse(raw);
  const entry = data[String(appid)];
  if(!entry || !entry.success || !entry.data) return null;
  const d = entry.data;
  return {
    appid: Number(appid),
    name: d.name || '',
    developers: d.developers || [],
    publishers: d.publishers || [],
    genres: (d.genres||[]).map(g=>g.description),
    categories: (d.categories||[]).map(c=>c.description),
    is_free: !!d.is_free,
    short_description: d.short_description || '',
    release_date: d.release_date ? d.release_date.date : '',
    header_image: d.header_image || '',
    metacritic_score: d.metacritic ? d.metacritic.score : null,
    recommendations_total: d.recommendations ? d.recommendations.total : null,
    fetched_at: new Date().toISOString().slice(0,10)
  };
}

function applyGameDetails(entry, det){
  entry.data = {
    ...entry.data,
    developer: det.developers.join(', ') || entry.data.developer || '',
    genre: det.genres.join(', ') || entry.data.genre || ''
  };
  if(!entry.description && det.short_description) entry.description = det.short_description;
  if(!entry.year && det.release_date){
    const m = det.release_date.match(/(\d{4})/);
    if(m) entry.year = parseInt(m[1]);
  }
  entry.updated = Date.now();
}

function backfillSteamDetFromEntry(e){
  return {
    appid: e.data.appid, name: e.title,
    developers: e.data.developer ? e.data.developer.split(', ') : [],
    publishers: [],
    genres: e.data.genre ? e.data.genre.split(', ') : [],
    categories: [],
    is_free: false,
    short_description: e.description || '',
    release_date: e.year ? String(e.year) : '',
    header_image: '',
    metacritic_score: null,
    recommendations_total: null,
    fetched_at: new Date().toISOString().slice(0,10)
  };
}

async function enrichSteamGames(statusEl){
  // Восстанавливаем уже обогащённые локально записи, которых ещё нет в offline-базе
  // (например, обогащённые до того, как появилась сама база).
  const alreadyEnriched = entries.filter(e=>e.category==='games' && e.data && e.data.platform==='Steam' && e.data.appid && e.data.developer && !steamGamesDb[e.data.appid]);
  alreadyEnriched.forEach(e=>{ steamGamesDb[e.data.appid] = backfillSteamDetFromEntry(e); });

  const targets = entries.filter(e=>e.category==='games' && e.data && e.data.platform==='Steam' && e.data.appid && !e.data.developer);
  if(!targets.length && !alreadyEnriched.length){
    statusEl.textContent = 'Все игры уже обогащены (или нет appid для старых записей)';
    return;
  }

  let fromCache = 0, fetched = 0, failed = 0;
  for(let i=0;i<targets.length;i++){
    const entry = targets[i];
    const appid = entry.data.appid;
    statusEl.textContent = `Обогащение метаданных: ${i+1}/${targets.length}...`;

    let det = steamGamesDb[appid];
    if(det){
      fromCache++;
    } else {
      const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=russian`;
      const raw = await fetchViaProxies(url, STEAM_PROXIES);
      if(raw){
        try{ det = parseAppDetails(appid, raw); }catch(e){ det = null; }
      }
      if(det){
        steamGamesDb[appid] = det;
        fetched++;
      } else {
        failed++;
      }
      await new Promise(r=>setTimeout(r, 400));
    }
    if(det) applyGameDetails(entry, det);
  }

  await persist();
  render();

  const msg = `Готово — обогащено: из кэша ${fromCache}, загружено ${fetched}${failed?`, не найдено ${failed}`:''}. Нажми «Скачать базу данных», чтобы прислать файл для сохранения в репозитории.`;
  statusEl.textContent = msg;
  showToast(`Обогащено: ${fromCache+fetched}`);
}

function buildSteamProfileBase(input){
  let v = input.trim().replace(/^https?:\/\//,'').replace(/\/$/,'');
  const idMatch = v.match(/steamcommunity\.com\/id\/([^\/\?]+)/);
  const profMatch = v.match(/steamcommunity\.com\/profiles\/(\d+)/);
  if(idMatch) return `https://steamcommunity.com/id/${idMatch[1]}`;
  if(profMatch) return `https://steamcommunity.com/profiles/${profMatch[1]}`;
  if(/^\d{17}$/.test(v)) return `https://steamcommunity.com/profiles/${v}`;
  return `https://steamcommunity.com/id/${v}`;
}

// Собственная serverless-функция (api/steam.js) — надёжный вариант, когда сайт
// открыт с https-хостинга (Vercel). Внешние публичные CORS-прокси оставлены
// как запасной путь для случая, когда файл открыт локально и /api недоступен;
// corsproxy.io без платного ключа принимает запросы только с dev-окружений.
const STEAM_PROXIES = [
  u => `/api/steam?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

async function fetchViaProxies(url, proxies){
  for(const buildProxy of proxies){
    try{
      const res = await fetch(buildProxy(url), {signal: AbortSignal.timeout(9000)});
      if(res.ok) return await res.text();
    }catch(e){ /* try next proxy */ }
  }
  return null;
}

async function resolveSteamId64(base, apiKey, proxies){
  const profMatch = base.match(/steamcommunity\.com\/profiles\/(\d+)/);
  if(profMatch) return profMatch[1];
  const idMatch = base.match(/steamcommunity\.com\/id\/([^\/]+)/);
  const vanity = idMatch ? idMatch[1] : base;
  const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`;
  const raw = await fetchViaProxies(url, proxies);
  if(!raw) return null;
  try{
    const data = JSON.parse(raw);
    if(data.response && data.response.success === 1) return data.response.steamid;
  }catch(e){ /* ignore */ }
  return null;
}

async function fetchOwnedGamesViaApi(steamId64, apiKey, proxies){
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(apiKey)}&steamid=${steamId64}&include_appinfo=1&include_played_free_games=1&format=json`;
  const raw = await fetchViaProxies(url, proxies);
  if(!raw) return [];
  return parseSteamGames(raw);
}

async function fetchGameAchievementSchema(appid, apiKey, proxies){
  const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid=${appid}&key=${encodeURIComponent(apiKey)}&l=russian`;
  const raw = await fetchViaProxies(url, proxies);
  if(!raw) return null;
  try{
    const data = JSON.parse(raw);
    return (data.game && data.game.availableGameStats && data.game.availableGameStats.achievements) || [];
  }catch(e){ return null; }
}
async function fetchPlayerAchievements(appid, steamId64, apiKey, proxies){
  const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${appid}&key=${encodeURIComponent(apiKey)}&steamid=${steamId64}&l=russian`;
  const raw = await fetchViaProxies(url, proxies);
  if(!raw) return null;
  try{
    const data = JSON.parse(raw);
    if(!data.playerstats || data.playerstats.success===false) return null;
    return data.playerstats.achievements || [];
  }catch(e){ return null; }
}
function mergeAchievements(schema, player){
  const playerMap = {};
  (player||[]).forEach(p=>{ playerMap[p.apiname] = p; });
  return (schema||[]).map(s=>{
    const p = playerMap[s.name] || {};
    return {
      name: s.name,
      title: s.displayName || s.name,
      description: s.description || '',
      icon: p.achieved ? s.icon : (s.icongray || s.icon || ''),
      achieved: !!p.achieved,
      unlocktime: p.unlocktime || 0
    };
  });
}
let achievementsLoading = false;
async function loadSteamAchievements(entry){
  const apiKey = uiPrefs.steamApiKey;
  if(!apiKey){ showToast('Сначала укажи Steam API-ключ в Импорт/Экспорт → Steam'); return; }
  if(!uiPrefs.steamId64){ showToast('Сначала импортируй библиотеку через Steam — нужен твой SteamID'); return; }

  achievementsLoading = true;
  renderViewAchievements(entry);
  try{
    const [schema, player] = await Promise.all([
      fetchGameAchievementSchema(entry.data.appid, apiKey, STEAM_PROXIES),
      fetchPlayerAchievements(entry.data.appid, uiPrefs.steamId64, apiKey, STEAM_PROXIES)
    ]);
    if(!schema || !schema.length){
      entry.data.achievementsError = 'У игры нет ачивок либо не удалось получить список — проверь, что «Сведения об играх» и статистика публичны в приватности Steam';
      entry.data.achievements = null;
    } else {
      entry.data.achievements = mergeAchievements(schema, player);
      entry.data.achievementsFetched = Date.now();
      delete entry.data.achievementsError;
    }
    entry.updated = Date.now();
    await persist();
  }catch(e){
    entry.data.achievementsError = 'Не удалось загрузить ачивки — попробуй ещё раз';
  }
  achievementsLoading = false;
  renderViewAchievements(entry);
}
async function loadRaAchievements(entry){
  const apiKey = uiPrefs.raApiKey;
  const username = uiPrefs.raUsername;
  if(!apiKey || !username){ showToast('Сначала укажи ник и Web API ключ RetroAchievements в Импорт/Экспорт → RetroAchievements'); return; }

  achievementsLoading = true;
  renderViewAchievements(entry);
  try{
    const info = await fetchRaGameInfo(entry.data.raGameId, username, apiKey, RA_PROXIES);
    const achievements = info && info.Achievements ? Object.values(info.Achievements) : null;
    if(!achievements || !achievements.length){
      entry.data.achievementsError = 'Не удалось получить ачивки — проверь ник, ключ и что у игры вообще есть набор ачивок на RetroAchievements';
      entry.data.achievements = null;
    } else {
      entry.data.achievements = mergeRaAchievements(achievements);
      entry.data.achievementsFetched = Date.now();
      delete entry.data.achievementsError;
    }
    entry.updated = Date.now();
    await persist();
  }catch(e){
    entry.data.achievementsError = 'Не удалось загрузить ачивки — попробуй ещё раз';
  }
  achievementsLoading = false;
  renderViewAchievements(entry);
}
async function loadGameAchievements(entryId){
  const entry = entries.find(x=>x.id===entryId);
  if(!entry || !entry.data) return;
  if(entry.data.platform === 'Steam' && entry.data.appid) await loadSteamAchievements(entry);
  else if(entry.data.platform === 'RetroAchievements' && entry.data.raGameId) await loadRaAchievements(entry);
}

async function autoImportSteam(){
  const input = document.getElementById('steamLink').value.trim();
  const apiKey = document.getElementById('steamApiKey').value.trim();
  const statusEl = document.getElementById('steamStatus');
  if(!input){ statusEl.textContent = 'Вставь ссылку на профиль или ник'; return; }
  if(!apiKey){ statusEl.textContent = 'Вставь Steam Web API ключ (получить: steamcommunity.com/dev/apikey)'; return; }
  saveSteamApiKey(apiKey);
  const base = buildSteamProfileBase(input);
  statusEl.textContent = 'пробую забрать автоматически...';

  try{
    const steamId64 = await resolveSteamId64(base, apiKey, STEAM_PROXIES);
    if(steamId64){
      uiPrefs.steamId64 = steamId64;
      persistUiPrefs();
      const games = await fetchOwnedGamesViaApi(steamId64, apiKey, STEAM_PROXIES);
      if(games.length){
        await commitSteamGames(games, statusEl);
        return;
      }
    }
  }catch(e){ /* handled below */ }
  statusEl.textContent = 'Не получилось импортировать — проверь ключ, ник профиля и что «Сведения об играх» установлены в Public';
}

/* ---------- RETROACHIEVEMENTS ---------- */
const RA_PROXIES = [
  u => `/api/retroachievements?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];
function saveRaCreds(username, apiKey){
  uiPrefs.raUsername = username.trim();
  uiPrefs.raApiKey = apiKey.trim();
  persistUiPrefs();
}
function syncRaCreds(){
  saveRaCreds(document.getElementById('raUsername').value, document.getElementById('raApiKey').value);
}
// Аутентификация RA — параметры z (ник) и y (ключ) добавляются к каждому запросу,
// как в официальной библиотеке @retroachievements/api.
function buildRaUrl(endpoint, username, apiKey, params){
  const qs = new URLSearchParams({ z: username, y: apiKey, ...params });
  return `https://retroachievements.org/API/${endpoint}?${qs.toString()}`;
}
async function fetchRaCompletedGames(username, apiKey, proxies){
  const url = buildRaUrl('API_GetUserCompletedGames.php', username, apiKey, { u: username });
  const raw = await fetchViaProxies(url, proxies);
  if(!raw) return [];
  try{ return JSON.parse(raw) || []; }catch(e){ return []; }
}
async function fetchRaGameInfo(gameId, username, apiKey, proxies){
  const url = buildRaUrl('API_GetGameInfoAndUserProgress.php', username, apiKey, { g: gameId, u: username });
  const raw = await fetchViaProxies(url, proxies);
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(e){ return null; }
}
function mergeRaAchievements(list){
  return (list||[]).map(a=>{
    const achieved = !!(a.DateEarnedHardcore || a.DateEarned);
    return {
      name: String(a.ID),
      title: a.Title || '',
      description: a.Description || '',
      icon: `https://media.retroachievements.org/Badge/${a.BadgeName}${achieved?'':'_lock'}.png`,
      achieved,
      unlocktime: (a.DateEarnedHardcore || a.DateEarned) ? Math.floor(new Date((a.DateEarnedHardcore||a.DateEarned)+' UTC').getTime()/1000) : 0
    };
  });
}
async function commitRaGames(games, statusEl){
  // API отдаёт по 2 записи на игру (softcore/hardcore) — берём softcore, там уже
  // учтены все ачивки, включая хардкорные.
  const byGame = {};
  games.forEach(g=>{
    if(!byGame[g.GameID] || g.HardcoreMode===false) byGame[g.GameID] = g;
  });
  let added = 0, updated = 0;
  Object.values(byGame).forEach(g=>{
    const cover = g.ImageIcon ? `https://retroachievements.org${g.ImageIcon}` : '';
    const existing = entries.find(x=>x.category==='games' && x.data && x.data.platform==='RetroAchievements' && x.data.raGameId===g.GameID);
    const status = g.PctWon>=1 ? 'completed' : (g.NumAwarded>0 ? 'progress' : 'planning');
    if(existing){
      existing.cover = cover || existing.cover;
      existing.data = {...existing.data, raGameId: g.GameID, consoleName: g.ConsoleName, platform: 'RetroAchievements'};
      if(existing.status!=='completed' && status==='completed') existing.status = 'completed';
      existing.updated = Date.now();
      updated++;
    } else {
      entries.push({
        id: 'e'+Date.now()+Math.random().toString(36).slice(2,7),
        title: g.Title, category: 'games', status,
        rating: null, year: null, cover, notes: '',
        data: { platform: 'RetroAchievements', raGameId: g.GameID, consoleName: g.ConsoleName },
        updated: Date.now()
      });
      added++;
    }
  });
  await persist();
  render();
  const msg = added && updated ? `Готово — добавлено ${added}, обновлено ${updated}`
    : updated ? `Готово — обновлено ${updated} игр`
    : `Готово — импортировано ${added} игр`;
  statusEl.textContent = msg;
  showToast(msg);
}
async function autoImportRA(){
  const username = document.getElementById('raUsername').value.trim();
  const apiKey = document.getElementById('raApiKey').value.trim();
  const statusEl = document.getElementById('raStatus');
  if(!username){ statusEl.textContent = 'Вставь ник на RetroAchievements'; return; }
  if(!apiKey){ statusEl.textContent = 'Вставь Web API ключ (получить: retroachievements.org/controlpanel.php)'; return; }
  saveRaCreds(username, apiKey);
  statusEl.textContent = 'пробую забрать автоматически...';
  try{
    const games = await fetchRaCompletedGames(username, apiKey, RA_PROXIES);
    if(games.length){
      await commitRaGames(games, statusEl);
      return;
    }
  }catch(e){ /* handled below */ }
  statusEl.textContent = 'Не получилось импортировать — проверь ник и ключ (retroachievements.org/controlpanel.php)';
}

// Прямого поиска игр по названию в RA API нет — база консолей+игр собирается
// заранее (по всем платформам) и используется локально при добавлении записи,
// как офлайн-кэш steam-games-db.json для Steam.
async function buildRaGamesDb(statusEl){
  const username = uiPrefs.raUsername, apiKey = uiPrefs.raApiKey;
  if(!username || !apiKey){ statusEl.textContent = 'Сначала укажи ник и ключ выше'; return; }
  statusEl.textContent = 'Получаю список платформ...';
  let consoles = [];
  try{
    const raw = await fetchViaProxies(buildRaUrl('API_GetConsoleIDs.php', username, apiKey, {a:1, g:1}), RA_PROXIES);
    consoles = raw ? JSON.parse(raw) : [];
  }catch(e){ consoles = []; }
  if(!consoles || !consoles.length){ statusEl.textContent = 'Не удалось получить список платформ — проверь ник и ключ'; return; }

  const allGames = [];
  for(let i=0;i<consoles.length;i++){
    const c = consoles[i];
    const consoleId = c.ID ?? c.Id ?? c.id;
    const consoleName = c.Name ?? c.name ?? '';
    statusEl.textContent = `Платформа ${i+1}/${consoles.length}: ${consoleName || consoleId}...`;
    try{
      const raw = await fetchViaProxies(buildRaUrl('API_GetGameList.php', username, apiKey, {i: consoleId, f: 1}), RA_PROXIES);
      const games = raw ? JSON.parse(raw) : [];
      (games||[]).forEach(g=>{
        allGames.push({
          id: g.ID ?? g.Id ?? g.id,
          title: g.Title ?? g.title ?? '',
          consoleName: g.ConsoleName ?? consoleName,
          imageIcon: g.ImageIcon ?? g.imageIcon ?? ''
        });
      });
    }catch(e){ /* платформу пропускаем, продолжаем остальные */ }
    await new Promise(r=>setTimeout(r, 300));
  }
  raGamesDb = { games: allGames.filter(g=>g.title), builtAt: new Date().toISOString().slice(0,10) };
  statusEl.textContent = `Готово — собрано игр: ${raGamesDb.games.length}. Нажми «Скачать базу», чтобы сохранить в репозиторий.`;
  showToast(`RA база: ${raGamesDb.games.length} игр`);
}
function downloadRaGamesDb(){
  if(!raGamesDb.games || !raGamesDb.games.length){ showToast('База пуста — сначала нажми «Собрать базу игр»'); return; }
  const blob = new Blob([JSON.stringify(raGamesDb, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'retroachievements-games-db.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Скачано игр: ${raGamesDb.games.length}`);
}

document.getElementById('dropzone').addEventListener('dragover', e=>{e.preventDefault(); e.currentTarget.classList.add('drag');});
document.getElementById('dropzone').addEventListener('dragleave', e=>{e.currentTarget.classList.remove('drag');});
document.getElementById('dropzone').addEventListener('drop', e=>{
  e.preventDefault(); e.currentTarget.classList.remove('drag');
  if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
document.getElementById('importOverlay').addEventListener('click', e=>{ if(e.target.id==='importOverlay') closeImportModal(); });

document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('statusFilter').addEventListener('change', render);
document.getElementById('sortBy').addEventListener('change', render);
['fltYearFrom','fltYearTo','fltRatingFrom','fltRatingTo'].forEach(id=>document.getElementById(id).addEventListener('input', render));
document.getElementById('fltCountry').addEventListener('change', render);
document.getElementById('pickOverlay').addEventListener('click', e=>{ if(e.target.id==='pickOverlay') closePickModal(); });
document.getElementById('overlay').addEventListener('click', e=>{ if(e.target.id==='overlay') closeModal(); });
document.getElementById('viewOverlay').addEventListener('click', e=>{ if(e.target.id==='viewOverlay') closeView(); });
document.addEventListener('click', e=>{
  if(!e.target.closest('.search-wrap')){
    document.getElementById('searchResults').classList.remove('show');
  }
});

load();
