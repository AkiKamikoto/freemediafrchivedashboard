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
const STATUS_CLASS = {planning:'st-planning',progress:'st-progress',completed:'st-completed',hold:'st-hold',dropped:'st-dropped'};

let entries = [];
let activeCat = 'all';
let statsMode = false;
let uiPrefs = {theme:'dark', view:'cards'};

async function load(){
  try{
    const res = await window.storage.get('archive-entries');
    entries = res ? JSON.parse(res.value) : [];
  }catch(e){ entries = []; }
  try{
    const p = await window.storage.get('archive-ui-prefs');
    if(p) uiPrefs = JSON.parse(p.value);
  }catch(e){ /* defaults */ }
  applyUiPrefs();
  render();
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
  document.getElementById('viewBtn').textContent = uiPrefs.view==='posters' ? '📇 Карточки' : '🖼 Стена постеров';
  document.getElementById('viewBtn').classList.toggle('active', uiPrefs.view==='posters');
  if(uiPrefs.steamApiKey) document.getElementById('steamApiKey').value = uiPrefs.steamApiKey;
}
function saveSteamApiKey(v){
  uiPrefs.steamApiKey = v.trim();
  persistUiPrefs();
}
function toggleTheme(){
  uiPrefs.theme = uiPrefs.theme==='light' ? 'dark' : 'light';
  applyUiPrefs(); persistUiPrefs();
}
function toggleView(){
  uiPrefs.view = uiPrefs.view==='posters' ? 'cards' : 'posters';
  applyUiPrefs(); persistUiPrefs(); render();
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
    if(q && !e.title.toLowerCase().includes(q) && !(e.notes||'').toLowerCase().includes(q)) return false;
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
  const modeClass = uiPrefs.view==='posters' ? ' poster-mode' : '';
  content.innerHTML = `<div class="grid${modeClass}">${list.map(cardHtml).join('')}</div>`;
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
  if(e.category==='games') return f.developer || '';
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

function cardHtml(e){
  const cat = CATS[e.category] || CATS.movies;
  const initials = e.title.slice(0,2).toUpperCase();
  return `<div class="card" style="--cat-color:${cat.color}" onclick="openModal('${e.id}')">
    <div class="cover">
      <div class="catbar"></div>
      ${e.cover ? `<img src="${escapeHtml(e.cover)}" onerror="this.parentElement.innerHTML='<div class=&quot;catbar&quot;></div><div class=&quot;fallback&quot;>${initials}</div>'">` : `<div class="fallback">${initials}</div>`}
    </div>
    <div class="card-body">
      <div class="card-top">
        <div class="card-title">${escapeHtml(e.title)}</div>
        <span class="stamp ${STATUS_CLASS[e.status]}">${STATUS_LABEL[e.status]}</span>
      </div>
      <div class="card-meta">${cat.label}${e.year?' · '+e.year:''}${e.country?' · '+escapeHtml(e.country):''}${e.timesWatched>1?' · ×'+e.timesWatched:''}${e.watchDate?' · '+formatDate(e.watchDate):''}</div>
      ${subLine(e) ? `<div class="card-sub">${escapeHtml(subLine(e))}</div>` : ''}
      <div class="card-foot">
        <span class="rating">${e.rating? e.rating+'/10' : '—'}</span>
        <span class="progress-txt">${escapeHtml(progressLine(e))}</span>
      </div>
    </div>
  </div>`;
}
function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatDate(d){ if(!d) return ''; const [y,m,day]=d.split('-'); return `${day}.${m}.${y}`; }

/* ---------- FORM ---------- */
/* ---------- SMART SEARCH / AUTOFILL ---------- */
let searchTimer = null;
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
    else if(cat==='games') results = await searchCheapShark(q);

    if(!results.length){ box.innerHTML = `<div class="sr-status">ничего не найдено — заполни вручную</div>`; return; }
    box.innerHTML = results.map((r,i)=>`
      <div class="sr-item" onclick='applyResult(${i})'>
        <img class="sr-thumb" src="${r.cover||''}" onerror="this.style.visibility='hidden'">
        <div class="sr-info"><div class="sr-title">${escapeHtml(r.title)}</div><div class="sr-year">${r.year||''}</div></div>
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
  if(r.notes && !document.getElementById('fNotes').value) document.getElementById('fNotes').value = r.notes;
  const extra = r.extra || {};
  Object.keys(extra).forEach(k=>{
    const el = document.getElementById('ex_'+k);
    if(el) el.value = extra[k];
  });
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
    notes: x.show.summary ? x.show.summary.replace(/<[^>]+>/g,'').slice(0,300) : '',
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
    document.getElementById('fNotes').value = e.notes||'';
    document.getElementById('fCover').value = e.cover||'';
    updateCoverPreview();
    updateRatingReadout();
    renderExtraFields(e.data||{});
    document.getElementById('deleteBtn').style.display = 'block';
    document.getElementById('saveMoreBtn').style.display = 'none';
  } else {
    document.getElementById('modalTitle').textContent = 'Новая запись';
    ['fTitle','fYear','fCountry','fNotes','fCover','fWatchDate','fTimesWatched'].forEach(fid=>document.getElementById(fid).value='');
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
    ['fTitle','fYear','fCountry','fNotes','fCover','fWatchDate','fTimesWatched'].forEach(fid=>document.getElementById(fid).value='');
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
  filteredEntries.forEach(e=>{ if(e.watchDate) counts[e.watchDate] = (counts[e.watchDate]||0)+1; });

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
        ${weeks.map(w=>`<div class="hm-col">${w.map(d=>
          d.count===null ? `<div class="hm-cell hm-empty"></div>` :
          `<div class="hm-cell hm-l${levelOf(d.count)}" title="${d.date}: ${d.count}"></div>`
        ).join('')}</div>`).join('')}
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

function exportData(format){
  if(entries.length===0){ showToast('Архив пуст'); return; }
  let blob, filename;
  if(format==='json'){
    blob = new Blob([JSON.stringify(entries,null,2)], {type:'application/json'});
    filename = 'archive-export.json';
  } else {
    const headers = ['title','category','status','rating','year','country','watchDate','timesWatched','cover','notes'];
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
  document.getElementById('panelExport').classList.toggle('active', tab==='export');
  document.getElementById('panelFile').classList.toggle('active', tab==='file');
  document.getElementById('panelShiki').classList.toggle('active', tab==='shiki');
  document.getElementById('panelSteam').classList.toggle('active', tab==='steam');
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
  {k:'notes', l:'Заметки'},
];
function guessMap(h){
  const s = h.toLowerCase();
  if(/title|name|назв/.test(s)) return 'title';
  if(/cover|image|img|poster|обложк/.test(s)) return 'cover';
  if(/year|год/.test(s)) return 'year';
  if(/rating|score|оцен/.test(s)) return 'rating';
  if(/status|статус/.test(s)) return 'status';
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
    name: g.name,
    hours: g.playtime_forever ? g.playtime_forever/60 : 0,
    logo: g.img_logo_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_logo_url}.jpg` : ''
  })).filter(g=>g.name);
}

async function commitSteamGames(games, statusEl){
  let added = 0;
  games.forEach(g=>{
    entries.push({
      id: 'e'+Date.now()+Math.random().toString(36).slice(2,7),
      title: g.name, category: 'games',
      status: g.hours>0 ? 'progress' : 'planning',
      rating: null, year: null, cover: g.logo||'', notes:'',
      data:{ hours: g.hours ? Math.round(g.hours*10)/10 : '', platform:'Steam' },
      updated: Date.now()
    });
    added++;
  });
  await persist();
  render();
  statusEl.textContent = `Готово — импортировано ${added} игр`;
  showToast(`Импортировано: ${added}`);
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
      const games = await fetchOwnedGamesViaApi(steamId64, apiKey, STEAM_PROXIES);
      if(games.length){
        await commitSteamGames(games, statusEl);
        return;
      }
    }
  }catch(e){ /* handled below */ }
  statusEl.textContent = 'Не получилось импортировать — проверь ключ, ник профиля и что «Сведения об играх» установлены в Public';
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
document.addEventListener('click', e=>{
  if(!e.target.closest('.search-wrap')){
    document.getElementById('searchResults').classList.remove('show');
  }
});

load();
