const { sql } = require('@vercel/postgres');

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        github_id BIGINT UNIQUE NOT NULL,
        login TEXT NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS user_data (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        entries JSONB NOT NULL DEFAULT '[]'::jsonb,
        ui_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

async function upsertGithubUser({ githubId, login, avatarUrl }) {
  await ensureSchema();
  const { rows } = await sql`
    INSERT INTO users (github_id, login, avatar_url)
    VALUES (${githubId}, ${login}, ${avatarUrl})
    ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login, avatar_url = EXCLUDED.avatar_url
    RETURNING id, login, avatar_url
  `;
  const user = rows[0];
  await sql`INSERT INTO user_data (user_id) VALUES (${user.id}) ON CONFLICT (user_id) DO NOTHING`;
  return user;
}

async function loadUserData(userId) {
  await ensureSchema();
  const { rows } = await sql`SELECT entries, ui_prefs, updated_at FROM user_data WHERE user_id = ${userId}`;
  if (!rows.length) return { entries: [], uiPrefs: {}, updatedAt: null };
  return { entries: rows[0].entries || [], uiPrefs: rows[0].ui_prefs || {}, updatedAt: rows[0].updated_at };
}

async function saveUserData(userId, { entries, uiPrefs }) {
  await ensureSchema();
  await sql`
    INSERT INTO user_data (user_id, entries, ui_prefs, updated_at)
    VALUES (${userId}, ${JSON.stringify(entries || [])}::jsonb, ${JSON.stringify(uiPrefs || {})}::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE SET entries = EXCLUDED.entries, ui_prefs = EXCLUDED.ui_prefs, updated_at = now()
  `;
}

module.exports = { ensureSchema, upsertGithubUser, loadUserData, saveUserData };
