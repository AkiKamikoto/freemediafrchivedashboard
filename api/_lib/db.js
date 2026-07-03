const { Pool } = require('pg');

// Провайдер-агностично: работает с любым Postgres (Supabase, Neon, свой сервер) —
// достаточно строки подключения в одной из этих переменных окружения.
let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
    || process.env.POSTGRES_PRISMA_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('Не найдена строка подключения к базе (POSTGRES_URL / DATABASE_URL) — подключи Supabase в переменных окружения Vercel.');
  }
  pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return pool;
}

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    const db = getPool();
    schemaReady = (async () => {
      await db.query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        github_id BIGINT UNIQUE NOT NULL,
        login TEXT NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await db.query(`CREATE TABLE IF NOT EXISTS user_data (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        entries JSONB NOT NULL DEFAULT '[]'::jsonb,
        ui_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

async function upsertGithubUser({ githubId, login, avatarUrl }) {
  await ensureSchema();
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO users (github_id, login, avatar_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login, avatar_url = EXCLUDED.avatar_url
     RETURNING id, login, avatar_url`,
    [githubId, login, avatarUrl]
  );
  const user = rows[0];
  await db.query(`INSERT INTO user_data (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [user.id]);
  return user;
}

async function loadUserData(userId) {
  await ensureSchema();
  const db = getPool();
  const { rows } = await db.query(`SELECT entries, ui_prefs, updated_at FROM user_data WHERE user_id = $1`, [userId]);
  if (!rows.length) return { entries: [], uiPrefs: {}, updatedAt: null };
  return { entries: rows[0].entries || [], uiPrefs: rows[0].ui_prefs || {}, updatedAt: rows[0].updated_at };
}

async function saveUserData(userId, { entries, uiPrefs }) {
  await ensureSchema();
  const db = getPool();
  await db.query(
    `INSERT INTO user_data (user_id, entries, ui_prefs, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET entries = EXCLUDED.entries, ui_prefs = EXCLUDED.ui_prefs, updated_at = now()`,
    [userId, JSON.stringify(entries || []), JSON.stringify(uiPrefs || {})]
  );
}

module.exports = { ensureSchema, upsertGithubUser, loadUserData, saveUserData };
