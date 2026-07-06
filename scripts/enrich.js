/**
 * Скрипт автоматического обогащения базы медиа-трекера и скачивания обложек.
 * 
 * Особенности:
 * - Не требует внешних зависимостей (использует нативный Node.js fetch).
 * - Поддерживает два режима работы:
 *   1. Облачный режим (автоматический): напрямую скачивает данные из Supabase,
 *      обогащает их, загружает обложки в data/covers/ и отправляет обновленную
 *      базу обратно в Supabase. При обновлении страницы в браузере изменения
 *      подтянутся автоматически.
 *   2. Файловый режим (ручной): работает с локальным `archive-export.json` в корне.
 * 
 * Запуск:
 * 1. Создайте в корне файл `.env` и впишите API-ключи (пример в README).
 * 2. Запустите: `node scripts/enrich.js`
 */

const fs = require('fs');
const path = require('path');

// 1. Загрузка конфигурации из .env
const env = {};
if (fs.existsSync('.env')) {
  const content = fs.readFileSync('.env', 'utf8');
  content.split('\n').forEach(line => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) {
      let val = m[2] || '';
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      env[m[1]] = val.trim();
    }
  });
}
Object.assign(env, process.env);

const TMDB_KEY = env.TMDB_API_KEY || '';
const RAWG_KEY = env.RAWG_API_KEY || '';
const SUPABASE_URL = env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_USER_ID = env.SUPABASE_USER_ID || '';

const ARCHIVE_FILE = 'archive-export.json';
const COVERS_DIR = path.join('data', 'covers');

if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

// Помощник для пауз (чтобы не превышать лимиты запросов API)
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Помощник для безопасного определения расширения картинки
function getExtension(urlStr) {
  try {
    const parsed = new URL(urlStr);
    let ext = path.extname(parsed.pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext)) {
      return ext;
    }
    const format = parsed.searchParams.get('format');
    if (format && ['.jpg', '.jpeg', '.png', '.webp'].includes('.' + format)) {
      return '.' + format;
    }
  } catch (e) {}
  return '.jpg';
}

// Загрузка картинки
async function downloadCover(url, entryId) {
  if (!url || !url.startsWith('http')) return url;

  // Если картинка уже локальная, не скачиваем повторно
  if (url.startsWith('data/covers/')) return url;

  const ext = getExtension(url);
  const filename = `${entryId}${ext}`;
  const destPath = path.join(COVERS_DIR, filename);
  const relativePath = `data/covers/${filename}`;

  try {
    console.log(`   ⬇️ Скачивание обложки: ${url.slice(0, 50)}...`);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
    return relativePath;
  } catch (e) {
    console.warn(`   ⚠️ Не удалось скачать обложку: ${e.message}`);
    return url; // оставляем исходную ссылку при ошибке
  }
}

/* --- API Клиенты для обогащения --- */

// TMDB (Кино / Сериалы)
async function enrichTMDB(title, category) {
  if (!TMDB_KEY) return null;
  const isMovie = category === 'movies';
  const type = isMovie ? 'movie' : 'tv';
  
  try {
    const searchUrl = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=ru-RU&include_adult=false`;
    const res = await fetch(searchUrl);
    if (!res.ok) return null;
    const searchData = await res.json();
    const hit = searchData.results && searchData.results[0];
    if (!hit) return null;

    // Дотягиваем детальную информацию и состав (credits)
    const detailUrl = `https://api.themoviedb.org/3/${type}/${hit.id}?api_key=${TMDB_KEY}&language=ru-RU&append_to_response=credits`;
    const dRes = await fetch(detailUrl);
    if (!dRes.ok) return null;
    const d = await dRes.json();

    const output = {
      description: d.overview || '',
      year: parseInt(d.release_date || d.first_air_date || '') || null,
      country: (d.production_countries && d.production_countries[0] && d.production_countries[0].name) || '',
      cover: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '',
      data: {
        cast: (d.credits && d.credits.cast || []).slice(0, 6).map(c => c.name).join(', ')
      }
    };

    if (isMovie) {
      output.data.director = (d.credits && d.credits.crew || []).filter(c => c.job === 'Director').map(c => c.name).join(', ');
      output.data.runtime = d.runtime || '';
    } else {
      output.data.creator = (d.created_by || []).map(c => c.name).join(', ');
      output.data.totalEp = d.number_of_episodes || '';
    }

    return output;
  } catch (e) {
    console.warn(`   [TMDB API Error]: ${e.message}`);
    return null;
  }
}

// Shikimori (Аниме / Манга)
async function enrichShikimori(title, category) {
  const isAnime = category === 'anime';
  const kind = isAnime ? 'animes' : 'mangas';
  
  try {
    const searchUrl = `https://shikimori.one/api/${kind}?search=${encodeURIComponent(title)}&limit=1`;
    const res = await fetch(searchUrl);
    if (!res.ok) return null;
    const searchData = await res.json();
    const hit = searchData && searchData[0];
    if (!hit) return null;

    // Детальный запрос
    const detailUrl = `https://shikimori.one/api/${kind}/${hit.id}`;
    const dRes = await fetch(detailUrl);
    if (!dRes.ok) return null;
    const d = await dRes.json();

    const cleanDesc = (d.description_html || d.description || '').replace(/<[^>]+>/g, '').trim();

    const output = {
      description: cleanDesc,
      year: parseInt(d.aired_on || d.released_on || '') || null,
      cover: d.image ? 'https://shikimori.one' + (d.image.original || d.image.preview) : '',
      data: {}
    };

    if (isAnime) {
      output.data.studio = (d.studios && d.studios[0] && d.studios[0].name) || '';
      output.data.totalEp = d.episodes || '';
    } else {
      output.data.author = (d.authors && d.authors.map(a => a.name).join(', ')) || '';
      output.data.totalCh = d.chapters || '';
    }

    return output;
  } catch (e) {
    console.warn(`   [Shikimori API Error]: ${e.message}`);
    return null;
  }
}

// Google Books (Книги)
async function enrichBooks(title) {
  try {
    let searchUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}&maxResults=1&langRestrict=ru`;
    let res = await fetch(searchUrl);
    let data = await res.json();
    let item = data.items && data.items[0];

    if (!item) {
      searchUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}&maxResults=1`;
      res = await fetch(searchUrl);
      data = await res.json();
      item = data.items && data.items[0];
    }
    
    if (!item) return null;
    const v = item.volumeInfo || {};

    return {
      description: v.description || '',
      year: parseInt(v.publishedDate || '') || null,
      cover: v.imageLinks ? (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail || '').replace('http://', 'https://') : '',
      data: {
        author: (v.authors || []).join(', '),
        totalPages: v.pageCount || ''
      }
    };
  } catch (e) {
    console.warn(`   [Google Books Error]: ${e.message}`);
    return null;
  }
}

// RAWG (Игры)
async function enrichRAWG(title) {
  if (!RAWG_KEY) return null;
  try {
    const searchUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&search=${encodeURIComponent(title)}&page_size=1`;
    const res = await fetch(searchUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data.results && data.results[0];
    if (!hit) return null;

    const detailUrl = `https://api.rawg.io/api/games/${hit.id}?key=${RAWG_KEY}`;
    const dRes = await fetch(detailUrl);
    if (!dRes.ok) return null;
    const d = await dRes.json();

    const cleanDesc = (d.description || '').replace(/<[^>]+>/g, '').trim();

    return {
      description: cleanDesc,
      year: parseInt(d.released || '') || null,
      cover: d.background_image || '',
      data: {
        developer: (d.developers || []).map(dev => dev.name).join(', '),
        genre: (d.genres || []).map(g => g.name).join(', ')
      }
    };
  } catch (e) {
    console.warn(`   [RAWG API Error]: ${e.message}`);
    return null;
  }
}

/* --- Логика загрузки и сохранения архива --- */

// Загрузка архива из Supabase
async function fetchSupabaseArchive() {
  const url = `${SUPABASE_URL}/rest/v1/archives?select=user_id,payload`;
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Не удалось загрузить данные из Supabase. HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data || data.length === 0) {
    throw new Error('В таблице archives не найдено записей. Сохраните архив хотя бы один раз из браузера.');
  }

  let selectedRow = data[0];
  if (data.length > 1) {
    if (SUPABASE_USER_ID) {
      selectedRow = data.find(row => row.user_id === SUPABASE_USER_ID);
      if (!selectedRow) {
        throw new Error(`В базе несколько записей, но пользователя с ID '${SUPABASE_USER_ID}' нет.`);
      }
    } else {
      console.warn('⚠️ В базе найдено несколько архивов разных пользователей.');
      console.warn('Будет использован первый найденный архив. Вы можете указать SUPABASE_USER_ID в файле .env.');
    }
  }

  return {
    userId: selectedRow.user_id,
    entries: selectedRow.payload.entries || [],
    deletedIds: selectedRow.payload.deleted || {}
  };
}

// Отправка архива обратно в Supabase (UPSERT)
async function saveSupabaseArchive(userId, entries, deletedIds) {
  const url = `${SUPABASE_URL}/rest/v1/archives`;
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  const body = {
    user_id: userId,
    payload: { entries, deleted: deletedIds },
    updated_at: new Date().toISOString()
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Не удалось отправить архив в Supabase. HTTP ${res.status}: ${errText}`);
  }
}

/* --- Главный цикл --- */

async function main() {
  const isCloudMode = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY;
  let entries = [];
  let deletedIds = {};
  let userId = null;

  console.log('🚀 Старт обогащения базы данных...');
  console.log(`🔑 TMDB Ключ: ${TMDB_KEY ? 'Есть' : 'Нет (фильмы не обогащаются)'}`);
  console.log(`🔑 RAWG Ключ: ${RAWG_KEY ? 'Есть' : 'Нет (игры не обогащаются)'}`);

  if (isCloudMode) {
    console.log('🌐 Режим: ОБЛАЧНЫЙ (Supabase)');
    try {
      const data = await fetchSupabaseArchive();
      userId = data.userId;
      entries = data.entries;
      deletedIds = data.deletedIds;
      console.log(`📡 Архив успешно загружен из Supabase (Пользователь UUID: ${userId})`);
      console.log(`📦 Всего записей в облаке: ${entries.length}\n`);
    } catch (e) {
      console.error(`❌ Ошибка загрузки из Supabase: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log('📂 Режим: ЛОКАЛЬНЫЙ ФАЙЛ (archive-export.json)');
    if (!fs.existsSync(ARCHIVE_FILE)) {
      console.error(`❌ Ошибка: Файл '${ARCHIVE_FILE}' не найден в корневой директории.`);
      console.error(`Пожалуйста, экспортируйте архив (JSON) из веб-интерфейса или настройте Supabase в .env для авто-режима.\n`);
      process.exit(1);
    }
    try {
      entries = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
      console.log(`📦 Всего локальных записей: ${entries.length}\n`);
    } catch (e) {
      console.error(`❌ Ошибка при чтении ${ARCHIVE_FILE}:`, e.message);
      process.exit(1);
    }
  }

  let enrichedCount = 0;
  let downloadedCovers = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const indexStr = `[${i + 1}/${entries.length}]`;
    console.log(`${indexStr} Обработка: "${e.title}" (${e.category})...`);

    // Проверяем, нужно ли обогащать метаданные (если нет описания или других базовых полей)
    const needsEnrichment = !e.description || !e.cover || (e.category === 'movies' && (!e.data || !e.data.director));
    let details = null;

    if (needsEnrichment) {
      await sleep(600); // соблюдаем таймаут запросов к внешним API
      if (e.category === 'movies' || e.category === 'series') {
        details = await enrichTMDB(e.title, e.category);
      } else if (e.category === 'anime' || e.category === 'manga') {
        details = await enrichShikimori(e.title, e.category);
      } else if (e.category === 'books') {
        details = await enrichBooks(e.title);
      } else if (e.category === 'games') {
        details = await enrichRAWG(e.title);
      }
    }

    if (details) {
      if (!e.description) e.description = details.description;
      if (!e.year) e.year = details.year;
      if (!e.country && details.country) e.country = details.country;
      if (!e.cover) e.cover = details.cover;
      
      if (!e.data) e.data = {};
      if (details.data) {
        Object.entries(details.data).forEach(([key, val]) => {
          if (!e.data[key]) e.data[key] = val;
        });
      }
      e.updated = Date.now();
      enrichedCount++;
      console.log(`   ✅ Успешно обогащено!`);
    }

    // Скачивание обложки локально (если она уже есть или добавилась и начинается с http)
    if (e.cover && e.cover.startsWith('http')) {
      const originalUrl = e.cover;
      const localPath = await downloadCover(originalUrl, e.id);
      if (localPath !== originalUrl) {
        e.cover = localPath;
        e.updated = Date.now();
        downloadedCovers++;
        console.log(`   🖼️ Обложка успешно сохранена локально.`);
      }
    }
  }

  // Запись результатов
  if (isCloudMode) {
    try {
      console.log('\n📤 Отправка обновленного архива в Supabase...');
      await saveSupabaseArchive(userId, entries, deletedIds);
      console.log('🎉 Все готово! Облачная база Supabase обновлена.');
      console.log(`📊 Статистика:`);
      console.log(`   - Обогащено записей метаданными: ${enrichedCount}`);
      console.log(`   - Скачано обложек в data/covers/: ${downloadedCovers}`);
      console.log('\n👉 Просто обновите страницу в браузере — новые данные загрузятся автоматически!');
    } catch (e) {
      console.error(`❌ Ошибка отправки в Supabase: ${e.message}`);
    }
  } else {
    try {
      fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(entries, null, 2), 'utf8');
      console.log(`\n🎉 Все готово! Результаты сохранены в '${ARCHIVE_FILE}'`);
      console.log(`📊 Статистика:`);
      console.log(`   - Обогащено записей метаданными: ${enrichedCount}`);
      console.log(`   - Скачано обложек в data/covers/: ${downloadedCovers}`);
      console.log(`\n👉 Теперь импортируйте файл '${ARCHIVE_FILE}' обратно в приложение через меню «Импорт / Экспорт» → «Файл».`);
    } catch (e) {
      console.error('❌ Ошибка при сохранении результатов в файл:', e.message);
    }
  }
}

main();
