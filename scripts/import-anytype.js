/**
 * Скрипт импорта данных из экспорта Anytype (Markdown) в базу данных медиа-трекера.
 * 
 * Особенности:
 * - Разбирает YAML-метаданные и Markdown-описание/отзывы из папки экспорта Anytype.
 * - Отфильтровывает только медиа-записи (фильмы, сериалы, книги, игры, аниме, мангу).
 * - Копирует прикрепленные обложки из Anytype в папку `data/covers/` проекта.
 * - Предотвращает дубликаты записей по названию и категории.
 * - Поддерживает облачный режим (прямой импорт в Supabase) и локальный режим (archive-export.json).
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

const SUPABASE_URL = env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_USER_ID = env.SUPABASE_USER_ID || '';

const ANYTYPE_DIR = '/Users/daniil/Documents/Anytype.20260706.225159.66';
const ARCHIVE_FILE = 'archive-export.json';
const COVERS_DIR = path.join('data', 'covers');

if (!fs.existsSync(ANYTYPE_DIR)) {
  console.error(`❌ Ошибка: Папка экспорта Anytype '${ANYTYPE_DIR}' не найдена.`);
  process.exit(1);
}

if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

// Вспомогательные хелперы
function getArrayOrString(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.map(v => String(v).trim());
  return [val.toString().trim()];
}

// Простой парсер YAML frontmatter с поддержкой любых символов в ключах (включая кириллицу)
function parseSimpleYaml(str) {
  const result = {};
  const lines = str.split('\n');
  let currentKey = null;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Элемент массива (строка начинается с "-")
    const listMatch = trimmed.match(/^-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = [];
      }
      result[currentKey].push(listMatch[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }

    // Ключ-значение: первая группа до двоеточия (поддерживает русские буквы и пробелы)
    const keyMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1].trim();
      let value = keyMatch[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      
      result[key] = value || null;
      currentKey = key;
    }
  }
  return result;
}

// Функция парсинга Anytype Markdown файла
function parseAnytypeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const parts = content.split('---');
  if (parts.length < 3) return null; // Не содержит YAML

  const yamlStr = parts[1];
  const markdownBody = parts.slice(2).join('---');

  const yaml = parseSimpleYaml(yamlStr);
  const objectType = getArrayOrString(yaml['Object type']);
  if (!objectType) return null;

  const categoryMap = {
    'фильм': 'movies',
    'сериал': 'series',
    'аниме': 'anime',
    'манга': 'manga',
    'книги': 'books',
    'книга': 'books',
    'игры': 'games',
    'игра': 'games'
  };

  const matchedCat = objectType.map(t => categoryMap[t.toLowerCase()]).find(Boolean);
  if (!matchedCat) return null; // Не медиа-файл

  // 1. Извлекаем название (H1 или имя файла)
  let title = '';
  const titleMatch = markdownBody.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    title = titleMatch[1].trim().replace(/\s+/g, ' ');
  } else {
    title = path.basename(filePath, '.md').replace(/-/g, ' ');
  }

  // 2. Статус
  const statusMap = {
    'просмотренно': 'completed',
    'просмотрено': 'completed',
    'прочитано': 'completed',
    'пройдено': 'completed',
    'в планах': 'planning',
    'запланировано': 'planning',
    'смотрю': 'progress',
    'читаю': 'progress',
    'играю': 'progress',
    'отложено': 'hold',
    'брошено': 'dropped'
  };
  const statusStr = (yaml['Статус контента'] || '').toString().toLowerCase().trim();
  const status = statusMap[statusStr] || 'planning';

  // 3. Оценка (1-10)
  const ratingVal = parseInt(yaml['Оценка']);
  const rating = !isNaN(ratingVal) ? ratingVal : null;

  // 4. Год
  let year = null;
  const relYear = parseInt(yaml['Released year']);
  if (!isNaN(relYear)) {
    year = relYear;
  } else {
    const relDate = yaml['Дата выхода'] || '';
    const dateMatch = relDate.match(/(\d{4})/);
    if (dateMatch) {
      year = parseInt(dateMatch[1]);
    }
  }

  // 5. Обложка
  let cover = '';
  const yamlImg = getArrayOrString(yaml['Image']);
  if (yamlImg && yamlImg.length > 0) {
    cover = yamlImg[0];
  } else {
    const imgMatch = markdownBody.match(/!\[.*?\]\((files\/.*?)\)/);
    if (imgMatch) {
      cover = imgMatch[1];
    }
  }

  // 6. Описание
  let description = '';
  const descMatch = markdownBody.match(/###\s+Описание\s*\n+([\s\S]*?)(?=\n##|$)/);
  if (descMatch) {
    description = descMatch[1].trim();
  }

  // 7. Заметки/Отзыв
  let notes = '';
  const reviewMatch = markdownBody.match(/##\s+Отзыв\s*\n+([\s\S]*?)(?=\n##|---|$)/);
  if (reviewMatch) {
    notes = reviewMatch[1].trim();
  }

  // 8. Специфичные поля категорий
  const data = {};

  // Жанры (сохраняем во всех категориях, для не-игр также форматируем в описании)
  const genres = getArrayOrString(yaml['Жанр']);
  if (genres && genres.length > 0) {
    data.genre = genres.join(', ');
    const genresStr = `**Жанры:** ${genres.join(', ')}`;
    description = description ? `${genresStr}\n\n${description}` : genresStr;
  }

  // Кол-во просмотров (для фильмов и сериалов)
  const watchCount = parseInt(yaml['Кол-во просмотров']) || parseInt(yaml['Количество просмотров']);
  if (!isNaN(watchCount)) {
    data.watchCount = watchCount;
    const watchCountStr = `**Просмотров:** ${watchCount}`;
    description = description ? `${description}\n\n${watchCountStr}` : watchCountStr;
  }

  // Кол-во чтений (для книг)
  const readCount = parseInt(yaml['Кол-во чтений']) || parseInt(yaml['Количество чтений']) || parseInt(yaml['Кол-во прочитанного']);
  if (!isNaN(readCount)) {
    data.readCount = readCount;
    const readCountStr = `**Прочтений:** ${readCount}`;
    description = description ? `${description}\n\n${readCountStr}` : readCountStr;
  }

  if (matchedCat === 'movies') {
    const director = getArrayOrString(yaml['Режиссер']) || getArrayOrString(yaml['Режиссёр']);
    if (director) data.director = director.join(', ');
    const cast = getArrayOrString(yaml['Актеры']) || getArrayOrString(yaml['Актёры']);
    if (cast) data.cast = cast.map(a => a.replace(/\.md$/, '').replace(/-/g, ' ')).join(', ');
    const runtime = parseInt(yaml['Длительность']);
    if (!isNaN(runtime)) data.runtime = runtime;
  } else if (matchedCat === 'series') {
    const creator = getArrayOrString(yaml['Создатель']) || getArrayOrString(yaml['Автор']);
    if (creator) data.creator = creator.join(', ');
    const cast = getArrayOrString(yaml['Актеры']) || getArrayOrString(yaml['Актёры']);
    if (cast) data.cast = cast.map(a => a.replace(/\.md$/, '').replace(/-/g, ' ')).join(', ');
  } else if (matchedCat === 'anime') {
    const studio = getArrayOrString(yaml['Студия']);
    if (studio) data.studio = studio.join(', ');
    const epWatched = parseInt(yaml['Серий просмотрено']) || parseInt(yaml['Просмотрено серий']);
    if (!isNaN(epWatched)) data.epWatched = epWatched;
    const totalEp = parseInt(yaml['Серий']) || parseInt(yaml['Всего серий']) || parseInt(yaml['Эпизодов']);
    if (!isNaN(totalEp)) data.totalEp = totalEp;
  } else if (matchedCat === 'manga') {
    const author = getArrayOrString(yaml['Автор']) || getArrayOrString(yaml['Художник']);
    if (author) data.author = author.join(', ');
    const chRead = parseInt(yaml['Глав прочитано']) || parseInt(yaml['Прочитано глав']);
    if (!isNaN(chRead)) data.chRead = chRead;
    const totalCh = parseInt(yaml['Глав']) || parseInt(yaml['Всего глав']);
    if (!isNaN(totalCh)) data.totalCh = totalCh;
  } else if (matchedCat === 'books') {
    const author = getArrayOrString(yaml['Автор']);
    if (author) data.author = author.join(', ');
    const pagesRead = parseInt(yaml['Страниц прочитано']) || parseInt(yaml['Прочитано страниц']);
    if (!isNaN(pagesRead)) data.pagesRead = pagesRead;
    const pages = parseInt(yaml['Страниц']) || parseInt(yaml['Всего страниц']);
    if (!isNaN(pages)) data.totalPages = pages;
  } else if (matchedCat === 'games') {
    const platform = getArrayOrString(yaml['Платформа']);
    if (platform) data.platform = platform.join(', ');
    const developer = getArrayOrString(yaml['Разработчик']);
    if (developer) data.developer = developer.join(', ');
    const hours = parseInt(yaml['Часов наиграно']) || parseInt(yaml['Часов']);
    if (!isNaN(hours)) data.hours = hours;
  }

  const country = (yaml['Страна'] || '').toString().trim();
  const backlogVal = (yaml['Backlog'] || '').toString().trim();
  const watchDate = backlogVal.match(/^\d{4}-\d{2}-\d{2}$/) ? backlogVal : null;

  return {
    title,
    category: matchedCat,
    status,
    rating,
    year,
    country,
    watchDate,
    cover,
    description,
    notes,
    data
  };
}

/* --- Логика загрузки и сохранения архива --- */

async function fetchSupabaseArchive() {
  const url = `${SUPABASE_URL}/rest/v1/archives?select=user_id,payload`;
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
  const data = await res.json();
  if (!data || data.length === 0) {
    throw new Error('Архивы в Supabase не найдены.');
  }

  let selectedRow = data[0];
  if (data.length > 1 && SUPABASE_USER_ID) {
    selectedRow = data.find(row => row.user_id === SUPABASE_USER_ID) || data[0];
  }
  return {
    userId: selectedRow.user_id,
    entries: selectedRow.payload.entries || [],
    deletedIds: selectedRow.payload.deleted || {}
  };
}

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
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }
}

function newId() {
  return 'e' + Date.now() + Math.random().toString(36).slice(2, 7);
}

/* --- Главный цикл --- */

async function main() {
  const isCloudMode = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY;
  let entries = [];
  let deletedIds = {};
  let userId = null;

  // 1. Загружаем текущую базу
  if (isCloudMode) {
    console.log('📡 Режим: ОБЛАЧНЫЙ (Supabase)');
    try {
      const data = await fetchSupabaseArchive();
      userId = data.userId;
      entries = data.entries;
      deletedIds = data.deletedIds;
      console.log(`✅ Загружен архив из Supabase (${entries.length} записей)`);
    } catch (e) {
      console.error(`❌ Ошибка загрузки из Supabase: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log('📂 Режим: ЛОКАЛЬНЫЙ ФАЙЛ');
    if (fs.existsSync(ARCHIVE_FILE)) {
      try {
        entries = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
        console.log(`✅ Загружен локальный файл ${ARCHIVE_FILE} (${entries.length} записей)`);
      } catch (e) {
        console.error(`⚠️ Ошибка чтения ${ARCHIVE_FILE}, начинаем с пустой базой: ${e.message}`);
      }
    }
  }

  // 2. Сканируем папку экспорта Anytype
  console.log(`\n🔍 Сканирование папки Anytype: ${ANYTYPE_DIR}...`);
  const files = fs.readdirSync(ANYTYPE_DIR);
  let parsedCount = 0;
  let addedCount = 0;
  let updatedCount = 0;
  let copiedCovers = 0;

  files.forEach(file => {
    if (!file.endsWith('.md')) return;
    const filePath = path.join(ANYTYPE_DIR, file);
    
    let item;
    try {
      item = parseAnytypeFile(filePath);
    } catch (e) {
      console.warn(`⚠️ Ошибка разбора файла ${file}: ${e.message}`);
      return;
    }
    if (!item) return; // Не медиа-файл

    parsedCount++;

    // Поиск дубликата в текущей базе
    const titleLower = item.title.toLowerCase();
    const existing = entries.find(x => x.category === item.category && x.title.toLowerCase() === titleLower);
    
    let targetEntry;
    if (existing) {
      // Обновляем существующий элемент, если в импортируемых данных больше деталей
      if (!existing.description && item.description) existing.description = item.description;
      if (!existing.notes && item.notes) existing.notes = item.notes;
      if (!existing.year && item.year) existing.year = item.year;
      if (!existing.country && item.country) existing.country = item.country;
      
      // Переносим статус, если он более детальный (не "planning")
      if (existing.status === 'planning' && item.status !== 'planning') {
        existing.status = item.status;
      }
      
      // Переносим оценку
      if ((existing.rating === null || existing.rating === undefined) && item.rating !== null) {
        existing.rating = item.rating;
      }
      
      // Переносим дату просмотра
      if (!existing.watchDate && item.watchDate) {
        existing.watchDate = item.watchDate;
      }

      if (!existing.data) existing.data = {};
      if (item.data) {
        Object.entries(item.data).forEach(([k, v]) => {
          if ((!existing.data[k] || existing.data[k] === '') && v) {
            existing.data[k] = v;
          }
        });
      }
      existing.updated = Date.now();
      targetEntry = existing;
      updatedCount++;
    } else {
      // Добавляем новую запись
      targetEntry = {
        id: newId(),
        title: item.title,
        category: item.category,
        status: item.status,
        rating: item.rating,
        year: item.year,
        country: item.country,
        watchDate: item.watchDate,
        cover: '',
        description: item.description,
        notes: item.notes,
        data: item.data,
        updated: Date.now()
      };
      entries.push(targetEntry);
      addedCount++;
    }

    // 3. Извлечение и копирование обложки (если она лежит в files/)
    if (item.cover && item.cover.startsWith('files/')) {
      const srcImagePath = path.join(ANYTYPE_DIR, item.cover);
      if (fs.existsSync(srcImagePath)) {
        const ext = path.extname(srcImagePath).toLowerCase() || '.jpg';
        const newFilename = `${targetEntry.id}${ext}`;
        const destImagePath = path.join(COVERS_DIR, newFilename);
        
        try {
          fs.copyFileSync(srcImagePath, destImagePath);
          targetEntry.cover = `data/covers/${newFilename}`;
          targetEntry.updated = Date.now();
          copiedCovers++;
        } catch (e) {
          console.warn(`   ⚠️ Не удалось скопировать обложку для "${item.title}": ${e.message}`);
        }
      }
    }
  });

  console.log(`\n📊 Статистика разбора Anytype:`);
  console.log(`   - Найдено медиа-файлов в Anytype: ${parsedCount}`);
  console.log(`   - Добавлено новых записей: ${addedCount}`);
  console.log(`   - Дополнено существующих записей: ${updatedCount}`);
  console.log(`   - Извлечено и скопировано обложек: ${copiedCovers}`);

  // 4. Сохранение изменений
  if (isCloudMode) {
    try {
      console.log('\n📤 Отправка обновленной базы в Supabase...');
      await saveSupabaseArchive(userId, entries, deletedIds);
      console.log('🎉 Импорт успешно завершен! База Supabase обновлена.');
    } catch (e) {
      console.error(`❌ Ошибка сохранения в Supabase: ${e.message}`);
    }
  } else {
    try {
      fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(entries, null, 2), 'utf8');
      console.log(`\n🎉 Импорт успешно завершен! Результаты сохранены в '${ARCHIVE_FILE}'`);
    } catch (e) {
      console.error(`❌ Ошибка сохранения файла ${ARCHIVE_FILE}: ${e.message}`);
    }
  }
}

main();
