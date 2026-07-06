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
    fields:[{k:'developer',l:'Разработчик'},{k:'platform',l:'Платформа',ph:'Xbox Series S'},{k:'consoleName',l:'Консоль'},{k:'hours',l:'Часов наиграно',type:'number'},{k:'genre',l:'Жанр'}]},
};
const STATUS_LABEL = {planning:'план',progress:'смотрю',completed:'завершено',hold:'отложено',dropped:'брошено'};
const PROGRESS_LABEL_BY_CAT = {books:'читаю',manga:'читаю',games:'играю'};
const STATUS_CLASS = {planning:'st-planning',progress:'st-progress',completed:'st-completed',hold:'st-hold',dropped:'st-dropped'};
function statusLabel(e){
  if(e.status==='progress') return PROGRESS_LABEL_BY_CAT[e.category] || STATUS_LABEL.progress;
  return STATUS_LABEL[e.status];
}

let entries = [];
// Тумбстоуны удалённых записей {id: timestamp} — нужны облачной синхронизации,
// чтобы запись, стёртая здесь, не возвращалась из архива другого устройства.
let deletedIds = {};
let activeCat = 'all';
let screen = 'home'; // 'home' | 'detail' | 'stats'
let detailId = null;
let uiPrefs = {};

let steamGamesDb = {};
let raGamesDb = { games: [] };
async function load(){
  try{
    const res = await window.storage.get('archive-entries');
    entries = res ? JSON.parse(res.value) : [];
  }catch(e){ entries = []; }
  try{
    const d = await window.storage.get('archive-deleted');
    if(d) deletedIds = JSON.parse(d.value);
  }catch(e){ deletedIds = {}; }
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
  try{
    await window.storage.set('archive-entries', JSON.stringify(entries));
    await window.storage.set('archive-deleted', JSON.stringify(deletedIds));
  }
  catch(e){ console.error('storage failed', e); }
  // Облачная синхронизация (js/auth.js) подхватывает каждое сохранение
  if(typeof scheduleCloudPush==='function') scheduleCloudPush();
}
async function persistUiPrefs(){
  try{ await window.storage.set('archive-ui-prefs', JSON.stringify(uiPrefs)); }
  catch(e){ /* ignore */ }
}
function applyUiPrefs(){
  if(uiPrefs.steamApiKey) document.getElementById('steamApiKey').value = uiPrefs.steamApiKey;
  if(uiPrefs.raUsername) document.getElementById('raUsername').value = uiPrefs.raUsername;
  if(uiPrefs.raApiKey) document.getElementById('raApiKey').value = uiPrefs.raApiKey;
  if(uiPrefs.tmdbApiKey) document.getElementById('tmdbApiKey').value = uiPrefs.tmdbApiKey;
  if(uiPrefs.rawgApiKey) document.getElementById('rawgApiKey').value = uiPrefs.rawgApiKey;
}
function saveSteamApiKey(v){
  uiPrefs.steamApiKey = v.trim();
  persistUiPrefs();
}
function saveTmdbApiKey(v){
  uiPrefs.tmdbApiKey = v.trim();
  persistUiPrefs();
}
function saveRawgApiKey(v){
  uiPrefs.rawgApiKey = v.trim();
  persistUiPrefs();
}

function goHome(){ screen='home'; detailId=null; render(); }
function goStats(){ screen='stats'; render(); }
function openDetail(id){ screen='detail'; detailId=id; render(); }
function setCat(c){ activeCat = c; screen='home'; detailId=null; render(); }

function renderNav(){
  const counts = {};
  Object.keys(CATS).forEach(k=>counts[k]=0);
  entries.forEach(e=>{ if(counts[e.category]!==undefined) counts[e.category]++; });
  let html = `<button class="nav-pill ${activeCat==='all'&&screen==='home'?'active':''}" onclick="setCat('all')">Всё</button>`;
  Object.entries(CATS).forEach(([key,c])=>{
    html += `<button class="nav-pill ${activeCat===key&&screen==='home'?'active':''}" onclick="setCat('${key}')">${c.label}</button>`;
  });
  document.getElementById('navCats').innerHTML = html;
  document.getElementById('statsBtn').classList.toggle('active', screen==='stats');
  document.getElementById('importNavBtn').classList.toggle('active', document.getElementById('importOverlay').classList.contains('show'));
}

function toggleFiltersPanel(){
  const p = document.getElementById('filtersPanel');
  p.style.display = p.style.display==='none' ? '' : 'none';
  if(p.style.display!=='none') populateCountryFilter();
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
  renderHomeContent();
}

let homeStatusFilter = '';
function setHomeStatusFilter(v){
  homeStatusFilter = homeStatusFilter===v ? '' : v;
  renderHomeContent();
}

function getFiltered(){
  const q = (document.getElementById('searchInput').value||'').toLowerCase();
  const sortBy = document.getElementById('sortBy') ? document.getElementById('sortBy').value : 'updated';
  const yFrom = parseInt(document.getElementById('fltYearFrom').value)||null;
  const yTo = parseInt(document.getElementById('fltYearTo').value)||null;
  const rFrom = document.getElementById('fltRatingFrom').value!=='' ? parseFloat(document.getElementById('fltRatingFrom').value) : null;
  const rTo = document.getElementById('fltRatingTo').value!=='' ? parseFloat(document.getElementById('fltRatingTo').value) : null;
  const country = document.getElementById('fltCountry').value;

  let list = entries.filter(e=>{
    if(activeCat!=='all' && e.category!==activeCat) return false;
    if(homeStatusFilter && e.status!==homeStatusFilter) return false;
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
  renderNav();
  document.getElementById('homeScreen').style.display = screen==='home' ? 'block' : 'none';
  document.getElementById('detailScreen').style.display = screen==='detail' ? 'block' : 'none';
  document.getElementById('statsScreen').style.display = screen==='stats' ? 'block' : 'none';
  if(screen==='home') renderHomeContent();
  else if(screen==='detail') renderDetail();
  else if(screen==='stats') renderStats();
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

function catGradKeys(catKey){
  const map = {movies:['--g-movies-1','--g-movies-2'],series:['--g-series-1','--g-series-2'],anime:['--g-anime-1','--g-anime-2'],
    manga:['--g-manga-1','--g-manga-2'],books:['--g-books-1','--g-books-2'],games:['--g-games-1','--g-games-2']};
  return map[catKey] || map.movies;
}
function catGradient(catKey){
  const [a,b] = catGradKeys(catKey);
  return `linear-gradient(160deg, var(${a}), var(${b}))`;
}

function posterHtml(e){
  const cat = CATS[e.category] || CATS.movies;
  const initials = e.title.slice(0,2).toUpperCase();
  return `<div class="poster" onclick="openDetail('${e.id}')">
    <div class="poster-art" style="background:${catGradient(e.category)};">
      ${e.cover ? `<img src="${escapeHtml(e.cover)}" loading="lazy" onerror="onCoverError(this,'${initials}')">` : `<span class="poster-fallback" style="color:${cat.color}">${initials}</span>`}
      <span class="poster-status" style="color:${cat.color};border-color:${cat.color};">${statusLabel(e)}</span>
      ${e.rating ? `<span class="poster-rating">${e.rating}/10</span>` : ''}
    </div>
    <div class="poster-title">${escapeHtml(e.title)}</div>
    <div class="poster-meta">${cat.label}${e.year?' · '+e.year:''}</div>
  </div>`;
}

const SHELF_LIMIT = 14;
let expandedShelves = new Set();
function toggleShelf(key){
  if(expandedShelves.has(key)) expandedShelves.delete(key);
  else expandedShelves.add(key);
  renderHomeContent();
}
function scrollShelf(btn, dir){
  const row = btn.parentElement.querySelector('.shelf-row');
  row.scrollBy({left: dir * row.clientWidth * 0.85, behavior:'smooth'});
}

function shelfHtml(key, name, items){
  const expanded = expandedShelves.has(key);
  const head = `
    <div class="shelf-head">
      <h2>${escapeHtml(name)}</h2>
      <span class="shelf-count">${items.length}</span>
      ${items.length > SHELF_LIMIT ? `<button class="shelf-toggle" onclick="toggleShelf('${key}')">${expanded ? 'Свернуть ↑' : 'Показать все →'}</button>` : ''}
    </div>`;
  if(expanded){
    return `<section class="shelf">${head}<div class="poster-grid">${items.map(posterHtml).join('')}</div></section>`;
  }
  const visible = items.slice(0, SHELF_LIMIT);
  const restCount = items.length - visible.length;
  const moreTile = restCount > 0 ? `
    <div class="poster" onclick="toggleShelf('${key}')">
      <div class="poster-art more-tile"><span class="more-tile-num">+${restCount}</span><span class="more-tile-lbl">показать все</span></div>
    </div>` : '';
  return `<section class="shelf">${head}
    <div class="shelf-wrap">
      <button class="shelf-arrow shelf-arrow-l" onclick="scrollShelf(this,-1)">‹</button>
      <div class="shelf-row">${visible.map(posterHtml).join('')}${moreTile}</div>
      <button class="shelf-arrow shelf-arrow-r" onclick="scrollShelf(this,1)">›</button>
    </div>
  </section>`;
}

function renderHomeContent(){
  const list = getFiltered();

  // status chips
  const chipDefs = Object.keys(STATUS_LABEL).map(k=>[k, STATUS_LABEL[k]]);
  document.getElementById('statusChips').innerHTML = chipDefs.map(([k,l])=>
    `<button class="status-chip ${homeStatusFilter===k?'active':''}" onclick="setHomeStatusFilter('${k}')">${l}</button>`).join('');

  // hero: currently-in-progress item (most recently updated), fallback to most recent overall
  const heroArea = document.getElementById('heroArea');
  const heroPool = entries.filter(e=>e.status==='progress').sort((a,b)=>(b.updated||0)-(a.updated||0));
  const hero = heroPool[0] || [...entries].sort((a,b)=>(b.updated||0)-(a.updated||0))[0];
  if(!hero){
    heroArea.innerHTML = '';
  } else {
    const cat = CATS[hero.category] || CATS.movies;
    const initials = hero.title.slice(0,2).toUpperCase();
    const metaBits = [cat.label, hero.year, subLine(hero)].filter(Boolean).join(' · ');
    heroArea.innerHTML = `
      <section class="hero" style="background:linear-gradient(115deg, var(${catGradKeys(hero.category)[0]}) 0%, var(${catGradKeys(hero.category)[1]}) 55%, var(--bg) 100%);" onclick="openDetail('${hero.id}')">
        <div class="hero-scrim"></div>
        <div class="hero-initials">${initials}</div>
        <div class="hero-inner">
          <div class="hero-eyebrow">
            <span class="hero-badge">${hero.status==='progress' ? 'СЕЙЧАС' : 'НЕДАВНО'}</span>
            <span class="hero-meta">${escapeHtml(metaBits)}</span>
          </div>
          <h1 class="hero-title">${escapeHtml(hero.title)}</h1>
          ${hero.description ? `<p class="hero-desc">${escapeHtml(hero.description)}</p>` : ''}
          <div class="hero-actions">
            <span class="hero-cta">Открыть →</span>
            ${hero.rating ? `<span class="hero-rating">★ ${hero.rating}</span>` : ''}
          </div>
        </div>
      </section>`;
  }

  const shelvesArea = document.getElementById('shelvesArea');
  if(!list.length){
    shelvesArea.innerHTML = `<div class="empty"><div class="big">Пока пусто</div>Добавь первую запись в архив, или попробуй сбросить фильтры</div>`;
    return;
  }
  const shelves = [];
  const progress = list.filter(e=>e.status==='progress');
  if(progress.length) shelves.push(['progress', 'Продолжаю', progress]);
  if(activeCat==='all'){
    Object.keys(CATS).forEach(k=>{
      const g = list.filter(e=>e.category===k && e.status!=='progress');
      if(g.length) shelves.push([k, CATS[k].label, g]);
    });
  } else {
    const rest = list.filter(e=>e.status!=='progress');
    if(rest.length) shelves.push([activeCat, CATS[activeCat].label, rest]);
  }
  shelvesArea.innerHTML = shelves.map(([key, name, items])=>shelfHtml(key, name, items)).join('');
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
async function runSearch(q){
  const cat = document.getElementById('fCategory').value;
  const box = document.getElementById('searchResults');
  try{
    const results = await searchCategory(cat, q); // общий реестр источников (js/search.js)
    if(!results.length){ box.innerHTML = `<div class="sr-status">ничего не найдено — заполни вручную</div>`; return; }
    box.innerHTML = results.map((r,i)=>`
      <div class="sr-item" onclick='applyResult(${i})'>
        <img class="sr-thumb" src="${r.cover||''}" onerror="this.style.visibility='hidden'">
        <div class="sr-info"><div class="sr-title">${escapeHtml(r.title)}${r.source ? ` <span class="sr-badge">${escapeHtml(r.source)}</span>` : ''}</div><div class="sr-year">${[r.year, r.sub].filter(Boolean).map(v=>escapeHtml(String(v))).join(' · ')}</div></div>
      </div>`).join('');
    window.__searchCache = results;
  }catch(e){
    box.innerHTML = `<div class="sr-status">не удалось подключиться к базе — заполни вручную</div>`;
  }
}
function applyResult(i){ fillFormFromResult(window.__searchCache[i]); }
function fillFormFromResult(r){
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
  // TMDB отдаёт режиссёра/каст/страну отдельным запросом деталей — дозаполняем асинхронно
  if(r.tmdbId) fillTmdbDetails(r);
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

function openEntry(id){ openDetail(id); }

function setDetailStatus(id, status){
  const e = entries.find(x=>x.id===id);
  if(!e) return;
  e.status = status;
  if(status==='completed' && !e.watchDate) e.watchDate = new Date().toISOString().slice(0,10);
  e.updated = Date.now();
  persist();
  showToast('Статус: '+statusLabel(e));
  renderDetail();
}

function renderDetail(){
  const e = entries.find(x=>x.id===detailId);
  if(!e){ goHome(); return; }
  const cat = CATS[e.category] || CATS.movies;
  const initials = e.title.slice(0,2).toUpperCase();
  const [g1,g2] = catGradKeys(e.category);
  const f = e.data||{};

  const fieldsHtml = cat.fields
    .filter(fd=>f[fd.k]!==undefined && f[fd.k]!==null && f[fd.k]!=='')
    .map(fd=>`<div class="view-field"><span class="view-field-label">${escapeHtml(fd.l)}</span><span class="view-field-value">${escapeHtml(String(f[fd.k]))}</span></div>`)
    .join('');

  const statusPillsHtml = Object.keys(STATUS_LABEL).map(k=>
    `<button class="status-pill ${e.status===k?'active':''}" style="${e.status===k?`border-color:${statusColor(k)};color:${statusColor(k)};`:''}" onclick="setDetailStatus('${e.id}','${k}')">${STATUS_LABEL[k]}</button>`
  ).join('');

  const extraMeta = [e.country, e.timesWatched>1?'×'+e.timesWatched:'', e.watchDate?formatDate(e.watchDate):''].filter(Boolean).join(' · ');

  const similar = entries.filter(x=>x.category===e.category && x.id!==e.id).slice(0,8);

  document.getElementById('detailScreen').innerHTML = `
    <div class="detail-header" style="background:linear-gradient(120deg, var(${g1}) 0%, var(${g2}) 45%, var(--bg) 100%);">
      <div class="detail-scrim"></div>
      <div class="detail-header-inner">
        <div class="detail-cover">
          ${e.cover ? `<img src="${escapeHtml(e.cover)}" onerror="onCoverError(this,'${initials}')">` : `<span class="detail-cover-fallback" style="color:${cat.color}">${initials}</span>`}
        </div>
        <div class="detail-info">
          <button class="back-btn" onclick="goHome()">← НАЗАД В КАТАЛОГ</button>
          <div class="detail-eyebrow" style="color:${cat.color}">${cat.label}${e.year?' · '+e.year:''}${extraMeta?' · '+escapeHtml(extraMeta):''}</div>
          <h1 class="detail-title">${escapeHtml(e.title)}</h1>
          <div class="detail-pills-row">
            ${statusPillsHtml}
            ${e.rating ? `<span class="detail-rating">★ ${e.rating}/10</span>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-main">
        ${e.description ? `<div><div class="section-cap">Описание</div><p class="detail-text">${escapeHtml(e.description)}</p></div>` : ''}
        <div><div class="section-cap">Мои заметки</div><div class="detail-notes-box">${escapeHtml(e.notes || 'Заметок пока нет.')}</div></div>
        <div id="detailAchievements"></div>
        ${similar.length ? `
        <div>
          <div class="section-cap">Похожее в коллекции</div>
          <div class="similar-row">
            ${similar.map(s=>{
              const sc = CATS[s.category]||CATS.movies; const si = s.title.slice(0,2).toUpperCase(); const [sg1,sg2]=catGradKeys(s.category);
              return `<div class="similar-item" onclick="openDetail('${s.id}')">
                <div class="similar-art" style="background:linear-gradient(160deg, var(${sg1}), var(${sg2}));">
                  ${s.cover ? `<img src="${escapeHtml(s.cover)}" onerror="onCoverError(this,'${si}')">` : `<span class="poster-fallback" style="color:${sc.color};font-size:24px;">${si}</span>`}
                </div>
                <div class="similar-title">${escapeHtml(s.title)}</div>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}
      </div>
      <aside class="detail-sidebar">
        ${fieldsHtml ? `<div class="side-card">${fieldsHtml}</div>` : ''}
        <button class="edit-btn" onclick="openModal('${e.id}')">✎ Редактировать запись</button>
      </aside>
    </div>`;
  renderAchievementsInto('detailAchievements', e);
}
function statusColor(k){
  return {planning:'#8B93A1', progress:'#5B9CD9', completed:'#6EB56E', hold:'#D9A25B', dropped:'#C0554F'}[k] || '#8B93A1';
}

// После загрузки ачивок обновляем открытый экран детали — иначе подтянутые
// разработчик/жанр/ачивки не покажутся без повторного открытия.
function refreshOpenEntryView(entry){
  if(detailId === entry.id) renderDetail();
}

/* ---------- ACHIEVEMENTS (Steam + RetroAchievements) ---------- */
function renderAchievementsInto(containerId, entry){
  const el = document.getElementById(containerId);
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
  const existing = id ? entries.find(x=>x.id===id) : null;
  // Сохраняем внутренние поля (appid, raGameId, achievements и т.п.), которых нет
  // среди видимых полей формы — иначе любое редактирование записи (рейтинг,
  // заметки...) стирало бы синхронизацию со Steam/RetroAchievements.
  const extraData = (existing && existing.category===category) ? {...existing.data} : {};
  CATS[category].fields.forEach(f=>{
    const v = document.getElementById('ex_'+f.k).value.trim();
    if(v) extraData[f.k] = f.type==='number' ? parseFloat(v) : v;
    else delete extraData[f.k];
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
  if(e.key==='Escape' && screen==='detail' && !document.getElementById('overlay').classList.contains('show')){
    goHome(); return;
  }
  if(!document.getElementById('overlay').classList.contains('show')) return;
  if(e.key==='Escape'){ closeModal(); return; }
  if(e.key==='Enter' && document.activeElement.tagName!=='TEXTAREA' && document.activeElement.id!=='fSearchQuery'){
    e.preventDefault();
    saveEntry(false);
  }
});

/* ---------- HEATMAP TOOLTIP ---------- */
// Нативный title на ячейках 10x10px ненадёжен (задержка, легко промахнуться) —
// свой тултип, следующий за курсором, показывается сразу по mouseover.
function getHmTooltipEl(){
  let tip = document.getElementById('hmTooltip');
  if(!tip){
    tip = document.createElement('div');
    tip.id = 'hmTooltip';
    tip.className = 'hm-tooltip';
    document.body.appendChild(tip);
  }
  return tip;
}
function positionHmTooltip(e){
  const tip = getHmTooltipEl();
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 10);
  const y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 10);
  tip.style.left = Math.max(4,x) + 'px';
  tip.style.top = Math.max(4,y) + 'px';
}
document.addEventListener('mouseover', e=>{
  const cell = e.target.closest && e.target.closest('.hm-cell[data-tip]');
  if(!cell) return;
  const tip = getHmTooltipEl();
  tip.textContent = cell.dataset.tip;
  tip.style.display = 'block';
  positionHmTooltip(e);
});
document.addEventListener('mousemove', e=>{
  const tip = document.getElementById('hmTooltip');
  if(tip && tip.style.display==='block') positionHmTooltip(e);
});
document.addEventListener('mouseout', e=>{
  const cell = e.target.closest && e.target.closest('.hm-cell[data-tip]');
  if(!cell) return;
  const tip = document.getElementById('hmTooltip');
  if(tip) tip.style.display = 'none';
});
async function deleteEntry(){
  const id = document.getElementById('editId').value;
  entries = entries.filter(x=>x.id!==id);
  deletedIds[id] = Date.now();
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
let statsCategory = 'all';
function achievementsAgg(list){
  let done=0, total=0, gamesWithData=0;
  list.forEach(e=>{
    const ach = e.data && e.data.achievements;
    if(ach && ach.length){
      gamesWithData++;
      total += ach.length;
      done += ach.filter(a=>a.achieved).length;
    }
  });
  return {done, total, gamesWithData};
}

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
          return `<div class="hm-cell hm-l${levelOf(d.count)}" data-tip="${escapeHtml(tip)}"></div>`;
        }).join('')}</div>`).join('')}
      </div>
      <div class="heatmap-legend">меньше <span class="hm-cell hm-l0"></span><span class="hm-cell hm-l1"></span><span class="hm-cell hm-l2"></span><span class="hm-cell hm-l3"></span><span class="hm-cell hm-l4"></span> больше</div>
    </div>`;
}

function monthlyActivity(list, year){
  const now = new Date();
  const buckets = []; // [{label, n}] oldest -> newest, 12 entries
  if(year==='all'){
    for(let i=11;i>=0;i--){
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      buckets.push({y:d.getFullYear(), m:d.getMonth(), label:d.toLocaleDateString('ru-RU',{month:'short'}), n:0});
    }
  } else {
    const y = parseInt(year);
    for(let m=0;m<12;m++) buckets.push({y, m, label:new Date(y,m,1).toLocaleDateString('ru-RU',{month:'short'}), n:0});
  }
  list.forEach(e=>{
    if(!e.watchDate) return;
    const d = new Date(e.watchDate);
    const b = buckets.find(x=>x.y===d.getFullYear() && x.m===d.getMonth());
    if(b) b.n++;
  });
  const max = Math.max(1, ...buckets.map(b=>b.n));
  const total = buckets.reduce((s,b)=>s+b.n,0);
  const peak = buckets.reduce((a,b)=>b.n>a.n?b:a, buckets[0]);
  return {buckets, max, total, peakLabel: peak.n ? peak.label : '—'};
}

function renderStats(){
  const el = document.getElementById('statsScreen');
  if(entries.length===0){
    el.innerHTML = `<div class="empty"><div class="big">Нет данных</div>Статистика появится после первых записей</div>`;
    return;
  }
  const years = availableYears();
  let list = statsYear==='all' ? entries : entries.filter(e=>entryYear(e)===parseInt(statsYear));
  if(statsCategory!=='all') list = list.filter(e=>e.category===statsCategory);
  const achAgg = achievementsAgg(list);

  const total = list.length;
  const completedList = list.filter(e=>e.status==='completed');
  const progressList = list.filter(e=>e.status==='progress');
  const rated = list.filter(e=>e.rating);
  const avgRating = rated.length ? (rated.reduce((s,e)=>s+e.rating,0)/rated.length).toFixed(1) : '—';

  const byCat = Object.entries(CATS).map(([key,c])=>({key,c,count:list.filter(e=>e.category===key).length}));
  const maxCat = Math.max(1, ...byCat.map(x=>x.count));

  const top = [...rated].sort((a,b)=>b.rating-a.rating).slice(0,6);
  const rewatched = [...list].filter(e=>e.timesWatched>1).sort((a,b)=>b.timesWatched-a.timesWatched).slice(0,8);

  const countryCounts = {};
  list.forEach(e=>{ if(e.country) countryCounts[e.country] = (countryCounts[e.country]||0)+1; });
  const countryList = Object.entries(countryCounts).sort((a,b)=>b[1]-a[1]);

  // status donut
  const statusOrder = ['completed','progress','hold','planning','dropped'];
  let cum = 0;
  const statusArcs = statusOrder.map(k=>{
    const n = list.filter(e=>e.status===k).length;
    const pct = total ? n/total*100 : 0;
    const arc = {label:STATUS_LABEL[k], n, color:statusColor(k), pctTxt:Math.round(pct)+'%', dash:pct.toFixed(2)+' '+(100-pct).toFixed(2), offset:(-cum).toFixed(2)};
    cum += pct;
    return arc;
  }).filter(a=>a.n>0);
  const donutPct = total ? Math.round(completedList.length/total*100) : 0;

  // rating distribution bars (10..5)
  const scores = [10,9,8,7,6,5];
  const scoreCounts = scores.map(s=>rated.filter(e=>Math.round(e.rating)===s).length);
  const maxScore = Math.max(1,...scoreCounts);

  const activity = monthlyActivity(list, statsYear);

  el.innerHTML = `
    <div style="padding:36px 40px 70px;max-width:1600px;margin:0 auto;">
      <div class="stats-topbar">
        <div>
          <h1 class="stats-h1">Статистика</h1>
          <p class="stats-sub">${statsCategory==='all' ? 'вся коллекция' : CATS[statsCategory].label}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <select class="range-chip" id="statsCatSelect" onchange="statsCategory=this.value; renderStats();" style="cursor:pointer;">
            <option value="all" ${statsCategory==='all'?'selected':''}>Все категории</option>
            ${Object.entries(CATS).map(([key,c])=>`<option value="${key}" ${statsCategory===key?'selected':''}>${c.label}</option>`).join('')}
          </select>
          <button class="range-chip ${statsYear==='all'?'active':''}" onclick="statsYear='all'; renderStats();">Всё время</button>
          ${years.slice(0,4).map(y=>`<button class="range-chip ${String(statsYear)===String(y)?'active':''}" onclick="statsYear='${y}'; renderStats();">${y}</button>`).join('')}
        </div>
      </div>

      <div class="metric-grid">
        <div class="metric-card"><div class="metric-icon">№</div><div class="metric-num-row"><div class="metric-num">${total}</div></div><div class="metric-lbl">Всего записей</div><div class="metric-sub">в 6 категориях</div></div>
        <div class="metric-card"><div class="metric-icon">✓</div><div class="metric-num-row"><div class="metric-num" style="color:#6EB56E;">${completedList.length}</div></div><div class="metric-lbl">Завершено</div><div class="metric-sub">${donutPct}% коллекции</div></div>
        <div class="metric-card"><div class="metric-icon">⟳</div><div class="metric-num-row"><div class="metric-num" style="color:#5B9CD9;">${progressList.length}</div></div><div class="metric-lbl">В процессе</div><div class="metric-sub">активно сейчас</div></div>
        <div class="metric-card"><div class="metric-icon">★</div><div class="metric-num-row"><div class="metric-num" style="color:var(--brass);">${avgRating}</div></div><div class="metric-lbl">Средняя оценка</div><div class="metric-sub">из ${rated.length} оценённых</div></div>
        ${achAgg.total ? `<div class="metric-card"><div class="metric-icon">🏆</div><div class="metric-num-row"><div class="metric-num" style="font-size:24px;color:var(--brass);">${achAgg.done}/${achAgg.total}</div></div><div class="metric-lbl">Ачивок открыто</div><div class="metric-sub">в ${achAgg.gamesWithData} играх</div></div>` : ''}
      </div>

      <div class="stats-two-col">
        <div class="stats-card">
          <h3>По статусу</h3>
          <p class="stats-card-sub">${total} записей всего</p>
          <div style="display:flex;align-items:center;gap:26px;flex-wrap:wrap;">
            <div style="position:relative;width:158px;height:158px;flex-shrink:0;">
              <svg width="158" height="158" viewBox="0 0 42 42" style="transform:rotate(-90deg);">
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="5"></circle>
                ${statusArcs.map(a=>`<circle cx="21" cy="21" r="15.915" fill="none" stroke="${a.color}" stroke-width="5" stroke-dasharray="${a.dash}" stroke-dashoffset="${a.offset}" stroke-linecap="round"></circle>`).join('')}
              </svg>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div style="font-family:'Unbounded',sans-serif;font-size:24px;font-weight:600;">${donutPct}%</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:8.5px;color:var(--muted);letter-spacing:.5px;">ЗАВЕРШЕНО</div>
              </div>
            </div>
            <div style="flex:1;min-width:150px;display:flex;flex-direction:column;gap:9px;">
              ${statusArcs.map(a=>`
                <div class="donut-legend-row">
                  <span class="donut-legend-dot" style="background:${a.color}"></span>
                  <span style="flex:1;font-size:13px;color:#C4BCAD;">${a.label}</span>
                  <span style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;">${a.n}</span>
                  <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted-dim);width:36px;text-align:right;">${a.pctTxt}</span>
                </div>`).join('')}
            </div>
          </div>
        </div>
        <div class="stats-card">
          <h3>Распределение оценок</h3>
          <p class="stats-card-sub">средняя ${avgRating} · оценено ${rated.length}</p>
          <div class="rating-bars-row">
            ${scores.map((s,i)=>{
              const n = scoreCounts[i];
              const h = Math.round(n/maxScore*100);
              const fill = s>=9 ? 'var(--brass)' : (s>=7 ? 'rgba(226,169,59,.55)' : 'rgba(255,255,255,.18)');
              return `<div class="rating-bar-col">
                <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${n?'#C4BCAD':'transparent'};">${n||''}</div>
                <div style="width:100%;border-radius:5px 5px 2px 2px;background:${fill};height:${h}%;min-height:3px;"></div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8A8272;">${s}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="stats-card" style="margin-bottom:18px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:20px;">
          <h3 style="margin:0;">Активность по месяцам</h3>
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted-dim);">${activity.total} завершено · пик в ${activity.peakLabel}</span>
        </div>
        <div class="activity-bars-row">
          ${activity.buckets.map(b=>`
            <div class="activity-bar-col">
              <div style="width:100%;border-radius:4px;background:${b.n===0?'rgba(255,255,255,.06)':'rgba(226,169,59,'+(0.3+0.6*b.n/activity.max).toFixed(2)+')'};height:${Math.round(b.n/activity.max*100)}%;min-height:4px;" title="${b.n}"></div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--muted-dim);">${b.label}</div>
            </div>`).join('')}
        </div>
      </div>

      <div class="stats-grid-2">
        <div class="stats-card">
          <h3 style="margin-bottom:18px;">По категориям</h3>
          ${byCat.map(x=>`
            <div class="cat-bar-row">
              <span class="cat-bar-label">${x.c.label}</span>
              <div class="cat-bar-track"><div class="cat-bar-fill" style="background:${x.c.hex};width:${Math.round(x.count/maxCat*100)}%;"></div></div>
              <span style="width:24px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:11.5px;font-weight:600;">${x.count}</span>
              <span style="width:38px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--muted-dim);">${total?Math.round(x.count/total*100):0}%</span>
            </div>`).join('')}
        </div>
        <div class="stats-card">
          <h3 style="margin-bottom:14px;">Топ по оценке</h3>
          ${top.length ? top.map((e,i)=>`
            <div class="top-row-item" onclick="openDetail('${e.id}')">
              <span class="top-rank">0${i+1}</span>
              <span class="top-dot" style="background:${CATS[e.category].hex}"></span>
              <span class="top-title">${escapeHtml(e.title)}</span>
              <span class="top-val">★ ${e.rating}</span>
            </div>`).join('') : `<div class="import-hint" style="margin-top:0;">Пока нет оценённых записей</div>`}
        </div>
      </div>

      <div style="margin-top:18px;">
        <h3 style="font-family:'Unbounded',sans-serif;font-size:14px;font-weight:600;margin:0 0 14px;">Активность (по дням)</h3>
        ${buildHeatmap(list, statsYear)}
      </div>

      ${countryList.length ? `
      <div class="stats-card" style="margin-top:18px;">
        <h3 style="margin-bottom:14px;">По странам</h3>
        <div id="countryMapArea"></div>
        <div class="chip-row" style="margin-top:12px;">
          ${countryList.slice(0,8).map(([country,c])=>`<div class="chip">${escapeHtml(country)} <b>${c}</b></div>`).join('')}
        </div>
      </div>` : ''}

      ${rewatched.length ? `
      <div class="stats-card" style="margin-top:18px;">
        <h3 style="margin-bottom:14px;">Топ пересмотров</h3>
        ${rewatched.map((e,i)=>`
          <div class="top-row-item" onclick="openDetail('${e.id}')">
            <span class="top-rank">0${i+1}</span>
            <span class="top-dot" style="background:${CATS[e.category].hex}"></span>
            <span class="top-title">${escapeHtml(e.title)}</span>
            <span class="top-val">×${e.timesWatched}</span>
          </div>`).join('')}
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
  dupIds.forEach(id=>{ deletedIds[id] = Date.now(); });
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
function openImportModal(){ document.getElementById('importOverlay').classList.add('show'); renderNav(); }
function closeImportModal(){ document.getElementById('importOverlay').classList.remove('show'); renderNav(); }
const IMPORT_TABS = {export:'Export', file:'File', cinema:'Cinema', books:'Books', shiki:'Shiki', steam:'Steam', ra:'RA'};
function switchImportTab(tab){
  Object.entries(IMPORT_TABS).forEach(([key,suffix])=>{
    document.getElementById('tab'+suffix).classList.toggle('active', tab===key);
    document.getElementById('panel'+suffix).classList.toggle('active', tab===key);
  });
}

let importRows = [];
let importHeaders = [];

// Полноценный разбор с учётом кавычек: значения могут содержать запятые
// и переводы строк (например, рецензии в экспорте Goodreads).
function parseCSV(text){
  const rawRows = []; let row = []; let cur = ''; let inQ = false;
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    if(inQ){
      if(ch==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else inQ=false; }
      else cur+=ch;
    } else if(ch==='"'){ inQ=true; }
    else if(ch===','){ row.push(cur); cur=''; }
    else if(ch==='\n' || ch==='\r'){
      if(ch==='\r' && text[i+1]==='\n') i++;
      row.push(cur); cur='';
      if(row.length>1 || row[0].trim()!=='') rawRows.push(row);
      row = [];
    } else cur+=ch;
  }
  if(cur!=='' || row.length){ row.push(cur); if(row.length>1 || row[0].trim()!=='') rawRows.push(row); }
  if(!rawRows.length) return {headers:[],rows:[]};
  const headers = rawRows[0].map(h=>h.trim());
  const rows = rawRows.slice(1).map(vals=>{
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

function newId(){ return 'e'+Date.now()+Math.random().toString(36).slice(2,7); }
// Совпадение для слияния: та же категория + то же название (+ год, если известен у обоих)
function findEntryByTitle(category, title, year){
  const t = title.trim().toLowerCase();
  return entries.find(e=>e.category===category && e.title.trim().toLowerCase()===t && (!year || !e.year || e.year===year));
}

/* ---------- КИНО: Letterboxd / IMDb ---------- */
function handleCinemaFile(file){
  if(!file) return;
  const statusEl = document.getElementById('cinemaStatus');
  const reader = new FileReader();
  reader.onload = async e=>{
    const {headers, rows} = parseCSV(e.target.result);
    if(!rows.length){ statusEl.textContent = 'Файл пуст или не распознан'; return; }
    if(headers.includes('Const') && headers.includes('Title Type')) await importImdbRows(rows, statusEl);
    else if(headers.includes('Name') && headers.includes('Year')) await importLetterboxdRows(rows, file.name, statusEl);
    else statusEl.textContent = 'Не похоже на экспорт Letterboxd или IMDb — попробуй вкладку «Файл» с ручным сопоставлением колонок';
  };
  reader.readAsText(file);
}

async function importLetterboxdRows(rows, filename, statusEl){
  // Тип списка (watched/ratings/diary/watchlist) в самих колонках не закодирован —
  // определяем по имени файла из архива экспорта.
  const isWatchlist = /watchlist/i.test(filename);
  let added=0, updated=0;
  rows.forEach(row=>{
    const title = (row['Name']||'').trim();
    if(!title) return;
    const year = parseInt(row['Year'])||null;
    const rating = row['Rating'] ? Math.round(parseFloat(row['Rating'])*2*10)/10 : null; // 0.5–5 → 1–10
    const watchDate = ((row['Watched Date'] || (!isWatchlist ? row['Date'] : '')) || '').slice(0,10) || null;
    const status = isWatchlist ? 'planning' : 'completed';
    const existing = findEntryByTitle('movies', title, year);
    if(existing){
      if(rating && !existing.rating) existing.rating = rating;
      if(watchDate && !existing.watchDate) existing.watchDate = watchDate;
      if(year && !existing.year) existing.year = year;
      if(status==='completed' && (existing.status==='planning')) existing.status = 'completed';
      existing.updated = Date.now(); updated++;
    } else {
      entries.push({id:newId(), title, category:'movies', status, rating, year,
        country:'', cover:'', description:'', notes:'', watchDate, data:{}, updated:Date.now()});
      added++;
    }
  });
  await persist(); render();
  const msg = `Letterboxd: добавлено ${added}, обновлено ${updated}. Постеры — кнопкой «Подтянуть постеры» ниже.`;
  statusEl.textContent = msg; showToast(msg);
}

async function importImdbRows(rows, statusEl){
  let added=0, updated=0;
  rows.forEach(row=>{
    const title = (row['Title']||row['Original Title']||'').trim();
    if(!title) return;
    const tt = (row['Title Type']||'').toLowerCase().replace(/\s/g,'');
    if(tt==='tvepisode') return; // отдельные эпизоды не тащим
    const category = tt.includes('series') ? 'series' : 'movies';
    const year = parseInt(row['Year'])||null;
    const rating = parseFloat(row['Your Rating'])||null;
    const watchDate = (row['Date Rated']||'').slice(0,10) || null;
    const data = {};
    if(category==='movies'){
      if(row['Directors']) data.director = row['Directors'];
      if(parseInt(row['Runtime (mins)'])) data.runtime = parseInt(row['Runtime (mins)']);
    } else if(row['Directors']) data.creator = row['Directors'];
    const existing = findEntryByTitle(category, title, year);
    if(existing){
      if(rating && !existing.rating) existing.rating = rating;
      if(watchDate && !existing.watchDate) existing.watchDate = watchDate;
      if(year && !existing.year) existing.year = year;
      if(existing.status==='planning') existing.status = 'completed';
      existing.data = {...data, ...existing.data};
      existing.updated = Date.now(); updated++;
    } else {
      entries.push({id:newId(), title, category, status:'completed', rating, year,
        country:'', cover:'', description:'', notes:'', watchDate, data, updated:Date.now()});
      added++;
    }
  });
  await persist(); render();
  const msg = `IMDb: добавлено ${added}, обновлено ${updated}. Постеры — кнопкой «Подтянуть постеры» ниже.`;
  statusEl.textContent = msg; showToast(msg);
}

// Дозаполнение постеров/описаний у фильмов и сериалов без обложки — по TMDB
async function enrichCinemaEntries(statusEl){
  if(!uiPrefs.tmdbApiKey){ statusEl.textContent = 'Сначала вставь ключ TMDB выше'; return; }
  const targets = entries.filter(e=>(e.category==='movies'||e.category==='series') && !e.cover);
  if(!targets.length){ statusEl.textContent = 'У всех фильмов и сериалов уже есть обложки'; return; }
  let done=0, missed=0;
  for(let i=0;i<targets.length;i++){
    const e = targets[i];
    statusEl.textContent = `Ищу постеры: ${i+1}/${targets.length}...`;
    const type = e.category==='movies' ? 'movie' : 'tv';
    const yearParam = e.year ? (type==='movie' ? {primary_release_year:e.year} : {first_air_date_year:e.year}) : {};
    try{
      const res = await fetch(tmdbUrl(`search/${type}`, {query:e.title, include_adult:'false', ...yearParam}));
      const data = await res.json();
      const hit = (data.results||[])[0];
      if(hit){
        if(hit.poster_path) e.cover = `https://image.tmdb.org/t/p/w500${hit.poster_path}`;
        if(!e.description && hit.overview) e.description = hit.overview.slice(0,500);
        if(!e.year){ const y = parseInt((hit.release_date||hit.first_air_date||'').slice(0,4)); if(y) e.year = y; }
        e.updated = Date.now(); done++;
      } else missed++;
    }catch(err){ missed++; }
    await new Promise(r=>setTimeout(r, 120));
  }
  await persist(); render();
  statusEl.textContent = `Готово — найдено ${done}${missed?`, не найдено ${missed}`:''}`;
  showToast(`Постеры: ${done}`);
}

/* ---------- КНИГИ: Goodreads ---------- */
function handleGoodreadsFile(file){
  if(!file) return;
  const statusEl = document.getElementById('booksStatus');
  const reader = new FileReader();
  reader.onload = async e=>{
    const {headers, rows} = parseCSV(e.target.result);
    if(!headers.includes('Title') || !headers.includes('Exclusive Shelf')){
      statusEl.textContent = 'Не похоже на экспорт Goodreads — попробуй вкладку «Файл»'; return;
    }
    const shelfMap = {'read':'completed','currently-reading':'progress','to-read':'planning'};
    let added=0, updated=0;
    rows.forEach(row=>{
      const title = (row['Title']||'').trim();
      if(!title) return;
      const rating = parseInt(row['My Rating'])>0 ? parseInt(row['My Rating'])*2 : null; // 1–5 → 2–10
      const status = shelfMap[(row['Exclusive Shelf']||'').toLowerCase()] || 'completed';
      const year = parseInt(row['Original Publication Year'])||parseInt(row['Year Published'])||null;
      const watchDate = (row['Date Read']||'').replace(/\//g,'-') || null;
      // Goodreads оборачивает ISBN в ="...", чтобы Excel не съел нули
      const isbn = (row['ISBN13']||row['ISBN']||'').replace(/[^0-9Xx]/g,'');
      const data = {};
      if(row['Author']) data.author = row['Author'];
      if(parseInt(row['Number of Pages'])) data.totalPages = parseInt(row['Number of Pages']);
      const timesWatched = parseInt(row['Read Count'])>1 ? parseInt(row['Read Count']) : null;
      // default=false — без обложки Open Library вернёт 404, сработает фолбэк с инициалами
      const cover = isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : '';
      const existing = findEntryByTitle('books', title, year);
      if(existing){
        if(rating && !existing.rating) existing.rating = rating;
        if(watchDate && !existing.watchDate) existing.watchDate = watchDate;
        if(cover && !existing.cover) existing.cover = cover;
        if(year && !existing.year) existing.year = year;
        existing.data = {...data, ...existing.data};
        existing.updated = Date.now(); updated++;
      } else {
        entries.push({id:newId(), title, category:'books', status, rating, year,
          country:'', cover, description:'', notes:(row['My Review']||'').slice(0,2000),
          watchDate, timesWatched, data, updated:Date.now()});
        added++;
      }
    });
    await persist(); render();
    const msg = `Goodreads: добавлено ${added}, обновлено ${updated}`;
    statusEl.textContent = msg; showToast(msg);
  };
  reader.readAsText(file);
}

/* ---------- АНИМЕ: AniList / MyAnimeList ---------- */
async function importAniList(type){
  const user = document.getElementById('anilistUser').value.trim();
  const statusEl = document.getElementById('anilistStatus');
  if(!user){ statusEl.textContent = 'Введи ник'; return; }
  statusEl.textContent = 'загружаю...';
  const query = `query($user:String,$type:MediaType){
    MediaListCollection(userName:$user,type:$type){
      lists{entries{status score(format:POINT_10_DECIMAL) progress
        media{title{romaji english} episodes chapters startDate{year} coverImage{large} description}}}}}`;
  try{
    const res = await fetch('https://graphql.anilist.co', {
      method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify({query, variables:{user, type:type.toUpperCase()}})
    });
    const data = await res.json();
    const lists = (data.data && data.data.MediaListCollection && data.data.MediaListCollection.lists) || [];
    const items = lists.flatMap(l=>l.entries||[]);
    if(!items.length){ statusEl.textContent = 'Список пуст, профиль закрыт или ник не найден'; return; }
    const stMap = {CURRENT:'progress', REPEATING:'progress', PLANNING:'planning', COMPLETED:'completed', PAUSED:'hold', DROPPED:'dropped'};
    let added=0, updated=0;
    items.forEach(it=>{
      const m = it.media;
      if(!m) return;
      const title = (m.title && (m.title.english || m.title.romaji)) || '';
      if(!title) return;
      const year = (m.startDate && m.startDate.year) || null;
      const rating = it.score>0 ? Math.round(it.score*10)/10 : null;
      const status = stMap[it.status] || 'planning';
      const extra = type==='anime'
        ? {epWatched: it.progress||'', totalEp: m.episodes||''}
        : {chRead: it.progress||'', totalCh: m.chapters||''};
      const cover = (m.coverImage && m.coverImage.large) || '';
      const description = m.description ? m.description.replace(/<[^>]+>/g,'').slice(0,500) : '';
      const existing = findEntryByTitle(type, title, year);
      if(existing){
        if(rating && !existing.rating) existing.rating = rating;
        if(cover && !existing.cover) existing.cover = cover;
        if(description && !existing.description) existing.description = description;
        if(year && !existing.year) existing.year = year;
        existing.data = {...extra, ...existing.data};
        existing.updated = Date.now(); updated++;
      } else {
        entries.push({id:newId(), title, category:type, status, rating, year,
          country:'', cover, description, notes:'', data:extra, updated:Date.now()});
        added++;
      }
    });
    await persist(); render();
    const msg = `AniList: добавлено ${added}, обновлено ${updated}`;
    statusEl.textContent = msg; showToast(msg);
  }catch(e){
    statusEl.textContent = 'Не удалось получить данные — проверь ник и что список публичный';
  }
}

function handleMalFile(file){
  if(!file) return;
  const statusEl = document.getElementById('malStatus');
  if(/\.gz$/i.test(file.name)){ statusEl.textContent = 'Сначала распакуй архив — нужен сам .xml'; return; }
  const reader = new FileReader();
  reader.onload = async e=>{
    const doc = new DOMParser().parseFromString(e.target.result, 'text/xml');
    const txt = (node, tag)=>{ const el = node.querySelector(tag); return el ? el.textContent.trim() : ''; };
    const stMap = {'watching':'progress','reading':'progress','completed':'completed','on-hold':'hold','dropped':'dropped','plan to watch':'planning','plan to read':'planning'};
    let added=0, updated=0;
    const importNodes = (nodes, category)=>{
      nodes.forEach(n=>{
        const isAnime = category==='anime';
        const title = txt(n, isAnime ? 'series_title' : 'manga_title');
        if(!title) return;
        const rating = parseInt(txt(n, 'my_score'))||null;
        const status = stMap[txt(n, 'my_status').toLowerCase()] || 'planning';
        const extra = isAnime
          ? {epWatched: parseInt(txt(n,'my_watched_episodes'))||'', totalEp: parseInt(txt(n,'series_episodes'))||''}
          : {chRead: parseInt(txt(n,'my_read_chapters'))||'', totalCh: parseInt(txt(n,'manga_chapters'))||''};
        const watchDate = /^\d{4}-\d{2}-\d{2}$/.test(txt(n,'my_finish_date')) && txt(n,'my_finish_date')!=='0000-00-00' ? txt(n,'my_finish_date') : null;
        const existing = findEntryByTitle(category, title, null);
        if(existing){
          if(rating && !existing.rating) existing.rating = rating;
          if(watchDate && !existing.watchDate) existing.watchDate = watchDate;
          existing.data = {...extra, ...existing.data};
          existing.updated = Date.now(); updated++;
        } else {
          entries.push({id:newId(), title, category, status, rating, year:null,
            country:'', cover:'', description:'', notes:'', watchDate, data:extra, updated:Date.now()});
          added++;
        }
      });
    };
    importNodes([...doc.querySelectorAll('anime')], 'anime');
    importNodes([...doc.querySelectorAll('manga')], 'manga');
    if(!added && !updated){ statusEl.textContent = 'В файле не нашлось записей — это точно XML-экспорт MAL?'; return; }
    await persist(); render();
    const msg = `MyAnimeList: добавлено ${added}, обновлено ${updated}`;
    statusEl.textContent = msg; showToast(msg);
  };
  reader.readAsText(file);
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
// Если игра пройдена на 100%, дата последней открытой ачивки — самая точная
// известная дата завершения, точнее ручной или дефолтной "сегодня" при импорте.
function applyCompletionDateFromAchievements(entry){
  const list = entry.data.achievements;
  if(!list || !list.length || !list.every(a=>a.achieved)) return;
  const times = list.map(a=>a.unlocktime).filter(Boolean);
  if(!times.length) return;
  entry.watchDate = new Date(Math.max(...times)*1000).toISOString().slice(0,10);
  if(entry.status!=='completed') entry.status = 'completed';
}
async function loadSteamAchievements(entry){
  const apiKey = uiPrefs.steamApiKey;
  if(!apiKey){ showToast('Сначала укажи Steam API-ключ в Импорт/Экспорт → Steam'); return; }
  if(!uiPrefs.steamId64){ showToast('Сначала импортируй библиотеку через Steam — нужен твой SteamID'); return; }

  achievementsLoading = true;
  refreshOpenEntryView(entry);
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
      applyCompletionDateFromAchievements(entry);
    }
    entry.updated = Date.now();
    await persist();
  }catch(e){
    entry.data.achievementsError = 'Не удалось загрузить ачивки — попробуй ещё раз';
  }
  achievementsLoading = false;
  refreshOpenEntryView(entry);
}
async function loadRaAchievements(entry){
  const apiKey = uiPrefs.raApiKey;
  const username = uiPrefs.raUsername;
  if(!apiKey || !username){ showToast('Сначала укажи ник и Web API ключ RetroAchievements в Импорт/Экспорт → RetroAchievements'); return; }

  achievementsLoading = true;
  refreshOpenEntryView(entry);
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
      applyCompletionDateFromAchievements(entry);
    }
    // GetGameInfoAndUserProgress заодно отдаёт метаданные игры — раз уж запрос
    // всё равно сделан, дозаполняем пустые поля записи, не тратя лишние вызовы API.
    if(info){
      if(!entry.data.developer && info.Developer) entry.data.developer = info.Developer;
      if(!entry.data.genre && info.Genre) entry.data.genre = info.Genre;
      if(!entry.year && info.Released){
        const m = String(info.Released).match(/(\d{4})/);
        if(m) entry.year = parseInt(m[1]);
      }
      if(!entry.cover && info.ImageBoxArt) entry.cover = `https://retroachievements.org${info.ImageBoxArt}`;
    }
    entry.updated = Date.now();
    await persist();
  }catch(e){
    entry.data.achievementsError = 'Не удалось загрузить ачивки — попробуй ещё раз';
  }
  achievementsLoading = false;
  refreshOpenEntryView(entry);
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
  const today = new Date().toISOString().slice(0,10);
  Object.values(byGame).forEach(g=>{
    const cover = g.ImageIcon ? `https://retroachievements.org${g.ImageIcon}` : '';
    const existing = entries.find(x=>x.category==='games' && x.data && x.data.platform==='RetroAchievements' && x.data.raGameId===g.GameID);
    const status = g.PctWon>=1 ? 'completed' : (g.NumAwarded>0 ? 'progress' : 'planning');
    if(existing){
      existing.cover = cover || existing.cover;
      existing.data = {...existing.data, raGameId: g.GameID, consoleName: g.ConsoleName, platform: 'RetroAchievements'};
      if(existing.status!=='completed' && status==='completed') existing.status = 'completed';
      if(status==='completed' && !existing.watchDate) existing.watchDate = today;
      existing.updated = Date.now();
      updated++;
    } else {
      entries.push({
        id: 'e'+Date.now()+Math.random().toString(36).slice(2,7),
        title: g.Title, category: 'games', status,
        rating: null, year: null, cover, notes: '',
        watchDate: status==='completed' ? today : null,
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

function wireDropzone(id, handler){
  const el = document.getElementById(id);
  el.addEventListener('dragover', e=>{e.preventDefault(); e.currentTarget.classList.add('drag');});
  el.addEventListener('dragleave', e=>{e.currentTarget.classList.remove('drag');});
  el.addEventListener('drop', e=>{
    e.preventDefault(); e.currentTarget.classList.remove('drag');
    if(e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
  });
}
wireDropzone('dropzone', handleFile);
wireDropzone('cinemaDropzone', handleCinemaFile);
wireDropzone('booksDropzone', handleGoodreadsFile);
wireDropzone('malDropzone', handleMalFile);
document.getElementById('importOverlay').addEventListener('click', e=>{ if(e.target.id==='importOverlay') closeImportModal(); });
document.getElementById('pickOverlay').addEventListener('click', e=>{ if(e.target.id==='pickOverlay') closePickModal(); });
document.getElementById('overlay').addEventListener('click', e=>{ if(e.target.id==='overlay') closeModal(); });
document.addEventListener('click', e=>{
  if(!e.target.closest('.search-wrap')){
    document.getElementById('searchResults').classList.remove('show');
  }
});

// Промис первичной загрузки: облачная синхронизация (js/auth.js) ждёт его,
// чтобы не сливать пустой список с облаком до чтения localStorage.
const appReady = load();
