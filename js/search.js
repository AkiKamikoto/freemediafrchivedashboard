/* ---------- ПОИСКОВЫЙ СЛОЙ + ОМНИПОИСК ----------
   Все онлайн-источники поиска и «командная строка» на главной: одна строка
   ищет и в коллекции, и по всем 6 категориям параллельно. Загружается после
   app.js и пользуется его глобалами (entries, CATS, uiPrefs, persist...). */

/* ---------- Источники (нормализованный результат) ----------
   {title, year, cover, description, sub, source, extra, meta, tmdbId, tmdbType} */

function searchRetroAchievements(q){
  const needle = q.toLowerCase();
  const list = raGamesDb.games || [];
  return list.filter(g=>g.title && g.title.toLowerCase().includes(needle)).slice(0,6).map(g=>({
    title: g.title,
    year: '',
    cover: g.imageIcon ? `https://retroachievements.org${g.imageIcon}` : '',
    description: '',
    sub: g.consoleName || '',
    source: 'RA',
    meta: { platform: 'RetroAchievements', raGameId: g.id, consoleName: g.consoleName || '' }
  }));
}

async function searchITunes(q, media){
  const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=${media}&limit=6`);
  const data = await res.json();
  return (data.results||[]).map(x=>({
    title: x.trackName,
    year: x.releaseDate ? x.releaseDate.slice(0,4) : '',
    cover: x.artworkUrl100 ? x.artworkUrl100.replace('100x100','600x600') : '',
    sub: x.artistName || '',
    source: 'iTunes',
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
    sub: (x.show.network&&x.show.network.name)||(x.show.webChannel&&x.show.webChannel.name)||'',
    source: 'TVmaze',
    extra:{ creator: (x.show.network&&x.show.network.name)||(x.show.webChannel&&x.show.webChannel.name)||'' }
  }));
}

async function searchJikan(q, type){
  const res = await fetch(`https://api.jikan.moe/v4/${type}?q=${encodeURIComponent(q)}&limit=6`);
  const data = await res.json();
  return (data.data||[]).map(x=>{
    const extra = {};
    let sub = '';
    if(type==='anime'){
      extra.studio = x.studios && x.studios[0] ? x.studios[0].name : '';
      extra.totalEp = x.episodes || '';
      sub = extra.studio;
    } else {
      extra.author = x.authors && x.authors[0] ? x.authors[0].name : '';
      extra.totalCh = x.chapters || '';
      sub = extra.author;
    }
    return {
      title: x.title,
      year: x.year || (x.published && x.published.from ? x.published.from.slice(0,4) : ''),
      cover: x.images && x.images.jpg ? x.images.jpg.image_url : '',
      sub,
      source: 'MAL',
      extra
    };
  });
}

// Shikimori — русские названия аниме и манги, ключ не нужен
async function searchShikimori(q, kind){
  const res = await fetch(`https://shikimori.one/api/${kind}?search=${encodeURIComponent(q)}&limit=6`);
  const data = await res.json();
  return (data||[]).map(x=>({
    title: x.russian || x.name,
    year: (x.aired_on || x.released_on || '').slice(0,4),
    cover: x.image ? 'https://shikimori.one'+(x.image.original||x.image.preview) : '',
    sub: x.name && x.russian ? x.name : '',
    source: 'Shiki',
    extra: kind==='animes' ? {totalEp: x.episodes||''} : {totalCh: x.chapters||''}
  })).filter(r=>r.title);
}

async function searchOpenLibrary(q){
  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6`);
  const data = await res.json();
  return (data.docs||[]).map(x=>({
    title: x.title,
    year: x.first_publish_year || '',
    cover: x.cover_i ? `https://covers.openlibrary.org/b/id/${x.cover_i}-M.jpg` : '',
    sub: x.author_name ? x.author_name[0] : '',
    source: 'OL',
    extra:{ author: x.author_name ? x.author_name[0] : '', totalPages: x.number_of_pages_median || '' }
  }));
}

// Google Books — хорошо знает русские издания; сначала ищем русские,
// при пустом ответе повторяем без ограничения языка
async function searchGoogleBooks(q){
  const fetchVols = async (params)=>{
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=6${params}`);
    const data = await res.json();
    return data.items || [];
  };
  let items = await fetchVols('&langRestrict=ru');
  if(!items.length) items = await fetchVols('');
  return items.map(x=>{
    const v = x.volumeInfo || {};
    return {
      title: v.title || '',
      year: v.publishedDate ? v.publishedDate.slice(0,4) : '',
      cover: v.imageLinks ? (v.imageLinks.thumbnail||v.imageLinks.smallThumbnail||'').replace('http://','https://') : '',
      description: v.description ? v.description.slice(0,500) : '',
      sub: (v.authors||[]).join(', '),
      source: 'GBooks',
      extra: { author: (v.authors||[])[0] || '', totalPages: v.pageCount || '' }
    };
  }).filter(r=>r.title);
}

async function searchCheapShark(q){
  const res = await fetch(`https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(q)}&limit=6`);
  const data = await res.json();
  return (data||[]).slice(0,6).map(x=>({
    title: x.external,
    year: '',
    cover: x.thumb || '',
    sub: '',
    source: '',
    extra:{}
  }));
}

/* ---------- TMDB (фильмы и сериалы, нужен бесплатный ключ) ---------- */
function tmdbUrl(path, params){
  const qs = new URLSearchParams({api_key: uiPrefs.tmdbApiKey, language: 'ru-RU', ...params});
  return `https://api.themoviedb.org/3/${path}?${qs.toString()}`;
}
async function searchTMDB(q, type){
  const res = await fetch(tmdbUrl(`search/${type}`, {query: q, include_adult: 'false'}));
  const data = await res.json();
  return (data.results||[]).slice(0,6).map(x=>({
    title: x.title || x.name,
    year: (x.release_date || x.first_air_date || '').slice(0,4),
    cover: x.poster_path ? `https://image.tmdb.org/t/p/w500${x.poster_path}` : '',
    description: (x.overview||'').slice(0,500),
    sub: (x.original_title || x.original_name || '') !== (x.title || x.name) ? (x.original_title || x.original_name || '') : '',
    source: 'TMDB',
    tmdbId: x.id, tmdbType: type,
    extra:{}
  }));
}
async function fetchTmdbDetails(r){
  const res = await fetch(tmdbUrl(`${r.tmdbType}/${r.tmdbId}`, {append_to_response:'credits'}));
  const d = await res.json();
  const out = {
    cast: (d.credits && d.credits.cast || []).slice(0,5).map(c=>c.name).join(', '),
    // Английское название страны — так же его понимает карта мира в статистике
    country: (d.production_countries && d.production_countries[0] && d.production_countries[0].name) || '',
    overview: (d.overview||'').slice(0,500)
  };
  if(r.tmdbType==='movie'){
    out.director = (d.credits && d.credits.crew || []).filter(c=>c.job==='Director').map(c=>c.name).join(', ');
    out.runtime = d.runtime || '';
  } else {
    out.creator = (d.created_by||[]).map(c=>c.name).join(', ');
    out.totalEp = d.number_of_episodes || '';
  }
  return out;
}
// Дозаполнение полей открытой формы (детали приходят вторым запросом)
async function fillTmdbDetails(r){
  if(!uiPrefs.tmdbApiKey) return;
  try{
    const det = await fetchTmdbDetails(r);
    const setIf = (id, v)=>{ const el = document.getElementById(id); if(el && !el.value && v) el.value = v; };
    setIf('ex_director', det.director); setIf('ex_runtime', det.runtime);
    setIf('ex_creator', det.creator); setIf('ex_totalEp', det.totalEp);
    setIf('ex_cast', det.cast);
    setIf('fCountry', det.country);
    setIf('fDescription', det.overview);
  }catch(e){ /* базовые поля уже подставлены из поиска */ }
}
// То же, но в уже созданную запись (быстрое добавление из омнипоиска)
async function fillTmdbDetailsIntoEntry(entry, r){
  if(!uiPrefs.tmdbApiKey) return;
  try{
    const det = await fetchTmdbDetails(r);
    ['director','runtime','creator','totalEp','cast'].forEach(k=>{
      if(det[k] && !entry.data[k]) entry.data[k] = det[k];
    });
    if(det.country && !entry.country) entry.country = det.country;
    if(det.overview && !entry.description) entry.description = det.overview;
    entry.updated = Date.now();
    await persist();
    refreshOpenEntryView(entry);
  }catch(e){ /* запись уже создана с базовыми полями */ }
}

/* ---------- RAWG (игры всех платформ, нужен бесплатный ключ) ---------- */
async function searchRAWG(q){
  const res = await fetch(`https://api.rawg.io/api/games?key=${encodeURIComponent(uiPrefs.rawgApiKey)}&search=${encodeURIComponent(q)}&page_size=6`);
  const data = await res.json();
  return (data.results||[]).map(x=>({
    title: x.name,
    year: x.released ? x.released.slice(0,4) : '',
    cover: x.background_image || '',
    sub: (x.genres||[]).slice(0,2).map(g=>g.name).join(', '),
    source: 'RAWG',
    extra:{ genre: (x.genres||[]).map(g=>g.name).join(', ') }
  }));
}

/* ---------- Реестр: цепочка источников на категорию ----------
   Следующий источник пробуется, если предыдущий упал или ничего не нашёл
   (например, Shikimori не знает англоязычный запрос — выручит Jikan). */
function sourcesFor(cat){
  switch(cat){
    case 'movies': return uiPrefs.tmdbApiKey ? [q=>searchTMDB(q,'movie'), q=>searchITunes(q,'movie')] : [q=>searchITunes(q,'movie')];
    case 'series': return uiPrefs.tmdbApiKey ? [q=>searchTMDB(q,'tv'), q=>searchTVmaze(q)] : [q=>searchTVmaze(q)];
    case 'anime':  return [q=>searchShikimori(q,'animes'), q=>searchJikan(q,'anime')];
    case 'manga':  return [q=>searchShikimori(q,'mangas'), q=>searchJikan(q,'manga')];
    case 'books':  return [q=>searchGoogleBooks(q), q=>searchOpenLibrary(q)];
    case 'games':  return [async q=>{
      const ra = searchRetroAchievements(q).slice(0,3);
      let store = [];
      try{ store = uiPrefs.rawgApiKey ? await searchRAWG(q) : await searchCheapShark(q); }catch(e){ /* RA-результаты всё равно покажем */ }
      return [...ra, ...store].slice(0,6);
    }];
    default: return [];
  }
}
async function searchCategory(cat, q){
  for(const fn of sourcesFor(cat)){
    try{
      const res = await fn(q);
      if(res && res.length) return res.map(r=>({...r, category: cat}));
    }catch(e){ /* пробуем следующий источник */ }
  }
  return [];
}

/* ---------- ОМНИПОИСК (строка на главной) ---------- */
let omniToken = 0;
let omniTimer = null;
let omniCat = 'all';
let omniFocusIdx = -1;
let omniQuery = '';
let omniLocal = [];
let omniOnline = {};
const omniCache = new Map(); // 'cat::query' -> results (последние ~60 запросов)

function onHomeSearchInput(){
  renderHomeContent(); // локальная фильтрация полок — как раньше
  const q = document.getElementById('searchInput').value.trim();
  clearTimeout(omniTimer);
  omniQuery = q;
  if(q.length < 2){ closeOmni(); return; }
  renderOmniShell(q);
  omniTimer = setTimeout(()=>runOmniSearch(q), 350);
}

function setOmniCat(cat){
  omniCat = cat;
  if(omniQuery.length >= 2){
    renderOmniShell(omniQuery);
    runOmniSearch(omniQuery); // без дебаунса: чип — явное действие, кэш смягчит повтор
  }
}

async function runOmniSearch(q){
  const token = ++omniToken;
  const cats = omniCat==='all' ? Object.keys(CATS) : [omniCat];
  cats.forEach(async cat=>{
    const key = cat+'::'+q;
    let results = omniCache.get(key);
    if(!results){
      results = await searchCategory(cat, q);
      omniCache.set(key, results);
      if(omniCache.size > 60) omniCache.delete(omniCache.keys().next().value);
    }
    if(token !== omniToken || q !== omniQuery) return; // устаревший ответ — отбрасываем
    renderOmniGroup(cat, results);
  });
}

function renderOmniShell(q){
  const box = document.getElementById('omniResults');
  box.classList.add('show');
  const cats = omniCat==='all' ? Object.keys(CATS) : [omniCat];
  const chips = `<div class="omni-chips">
      <button class="omni-chip ${omniCat==='all'?'active':''}" onclick="setOmniCat('all')">Всё</button>
      ${Object.entries(CATS).map(([k,c])=>`<button class="omni-chip ${omniCat===k?'active':''}" onclick="setOmniCat('${k}')">${c.label}</button>`).join('')}
    </div>`;
  const needle = q.toLowerCase();
  omniLocal = entries.filter(e=>e.title.toLowerCase().includes(needle) && (omniCat==='all' || e.category===omniCat)).slice(0,5);
  const localHtml = omniLocal.length ? `
    <div class="omni-group">
      <div class="omni-group-head"><span class="omni-group-dot" style="background:var(--brass)"></span><span class="omni-group-name">В коллекции</span></div>
      ${omniLocal.map((e,i)=>`
        <div class="omni-item" data-kind="local" data-id="${e.id}" onclick="omniOpenLocal('${e.id}')">
          <div class="omni-thumb">${e.cover?`<img src="${escapeHtml(e.cover)}" loading="lazy" onerror="this.style.display='none'">`:''}</div>
          <div class="omni-info">
            <div class="omni-title">${escapeHtml(e.title)}</div>
            <div class="omni-sub">${[CATS[e.category].label, e.year, statusLabel(e)].filter(Boolean).join(' · ')}</div>
          </div>
          <span class="omni-owned-badge">открыть →</span>
        </div>`).join('')}
    </div>` : '';
  omniOnline = {};
  const groupsHtml = cats.map(cat=>`
    <div class="omni-group" id="omniGroup_${cat}">
      <div class="omni-group-head"><span class="omni-group-dot" style="background:${CATS[cat].hex}"></span><span class="omni-group-name">${CATS[cat].label}</span></div>
      <div class="omni-skel-row"></div><div class="omni-skel-row"></div>
    </div>`).join('');
  box.innerHTML = chips + localHtml + groupsHtml
    + `<div class="omni-hint">↑↓ навигация · Enter — в план · Esc — закрыть</div>`;
  omniFocusIdx = -1;
}

function renderOmniGroup(cat, results){
  const el = document.getElementById('omniGroup_'+cat);
  if(!el) return;
  omniOnline[cat] = results;
  if(!results.length){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = `<div class="omni-group-head"><span class="omni-group-dot" style="background:${CATS[cat].hex}"></span><span class="omni-group-name">${CATS[cat].label}</span></div>`
    + results.map((r,i)=>{
      const owned = findEntryByTitle(cat, r.title, parseInt(r.year)||null);
      return `<div class="omni-item ${owned?'owned':''}" data-kind="online" data-cat="${cat}" data-idx="${i}" onclick="omniCardClick('${cat}',${i})">
        <div class="omni-thumb">${r.cover?`<img src="${escapeHtml(r.cover)}" loading="lazy" onerror="this.style.display='none'">`:''}</div>
        <div class="omni-info">
          <div class="omni-title">${escapeHtml(r.title)}${r.source?` <span class="sr-badge">${escapeHtml(r.source)}</span>`:''}</div>
          <div class="omni-sub">${[r.year, r.sub].filter(Boolean).map(v=>escapeHtml(String(v))).join(' · ')}</div>
        </div>
        ${owned
          ? `<span class="omni-owned-badge">в коллекции ✓</span>`
          : `<button class="omni-add" onclick="event.stopPropagation();omniQuickAdd('${cat}',${i})">+ В план</button>`}
      </div>`;
    }).join('');
}

function closeOmni(){
  const box = document.getElementById('omniResults');
  box.classList.remove('show');
  box.innerHTML = '';
  omniFocusIdx = -1;
  omniToken++;
}

function omniOpenLocal(id){ closeOmni(); openDetail(id); }

function omniCardClick(cat, i){
  const r = omniOnline[cat][i];
  const owned = findEntryByTitle(cat, r.title, parseInt(r.year)||null);
  if(owned){ closeOmni(); openDetail(owned.id); return; }
  // клик по карточке — предзаполненная форма (тонкая настройка перед сохранением)
  closeOmni();
  openModal();
  document.getElementById('fCategory').value = cat;
  renderExtraFields();
  fillFormFromResult(r);
  goAddStep(2);
}

async function omniQuickAdd(cat, i){
  const r = omniOnline[cat][i];
  const existing = findEntryByTitle(cat, r.title, parseInt(r.year)||null);
  if(existing){ closeOmni(); openDetail(existing.id); return; }
  const data = {...(r.extra||{})};
  if(r.meta && cat==='games') Object.assign(data, r.meta);
  const entry = {
    id: newId(), title: r.title, category: cat, status: 'planning',
    rating: null, year: parseInt(r.year)||null, country: '',
    cover: r.cover||'', description: r.description||'', notes: '',
    data, updated: Date.now()
  };
  entries.push(entry);
  if(r.tmdbId) fillTmdbDetailsIntoEntry(entry, r); // асинхронно дотянет режиссёра/страну
  await persist();
  render();
  renderOmniGroup(cat, omniOnline[cat]); // карточка перерисуется как «в коллекции ✓»
  showToast('Добавлено в план: '+entry.title);
}

/* ---------- Клавиатура ---------- */
function omniIsTyping(t){
  return t && (t.tagName==='INPUT' || t.tagName==='TEXTAREA' || t.tagName==='SELECT' || t.isContentEditable);
}
function omniActivate(el){
  const d = el.dataset;
  if(d.kind==='local'){ omniOpenLocal(d.id); return; }
  const r = omniOnline[d.cat] && omniOnline[d.cat][parseInt(d.idx)];
  if(!r) return;
  const owned = findEntryByTitle(d.cat, r.title, parseInt(r.year)||null);
  if(owned){ closeOmni(); openDetail(owned.id); return; }
  omniQuickAdd(d.cat, parseInt(d.idx));
}
document.addEventListener('keydown', e=>{
  // «/» или Ctrl/Cmd+K — фокус в поиск из любого места
  if((e.key==='/' && !omniIsTyping(e.target)) || (e.key.toLowerCase()==='k' && (e.ctrlKey||e.metaKey))){
    e.preventDefault();
    if(screen!=='home') goHome();
    setTimeout(()=>{ const inp = document.getElementById('searchInput'); inp.focus(); inp.select(); }, 30);
    return;
  }
  const box = document.getElementById('omniResults');
  if(!box.classList.contains('show')) return;
  if(e.key==='Escape'){ closeOmni(); return; }
  const items = [...box.querySelectorAll('.omni-item')];
  if(!items.length) return;
  if(e.key==='ArrowDown' || e.key==='ArrowUp'){
    e.preventDefault();
    omniFocusIdx = e.key==='ArrowDown'
      ? Math.min(omniFocusIdx+1, items.length-1)
      : Math.max(omniFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused', i===omniFocusIdx));
    items[omniFocusIdx].scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && omniFocusIdx>=0 && items[omniFocusIdx]){
    e.preventDefault();
    omniActivate(items[omniFocusIdx]);
  }
});
document.addEventListener('click', e=>{
  const box = document.getElementById('omniResults');
  if(box.classList.contains('show') && !e.target.closest('.omni-wrap')) closeOmni();
});
