const { getSessionFromRequest } = require('./_lib/session');
const { loadUserData, saveUserData } = require('./_lib/db');

module.exports = async function handler(req, res) {
  let session;
  try {
    session = getSessionFromRequest(req);
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }
  if (!session) { res.status(401).json({ error: 'Не авторизован' }); return; }

  if (req.method === 'GET') {
    try {
      const data = await loadUserData(session.uid);
      res.status(200).json(data);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка базы данных: ' + e.message });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = req.body || {};
      await saveUserData(session.uid, { entries: body.entries, uiPrefs: body.uiPrefs });
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка базы данных: ' + e.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
