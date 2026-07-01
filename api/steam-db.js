const OWNER = 'AkiKamikoto';
const REPO = 'freemediafrchivedashboard';
const FILE_PATH = 'data/steam-games-db.json';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Server not configured: missing GITHUB_TOKEN' });
    return;
  }

  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates) || !Object.keys(updates).length) {
    res.status(400).json({ error: 'Invalid or empty request body' });
    return;
  }

  const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'freemediafrchivedashboard-steam-db',
  };

  try {
    const getRes = await fetch(apiBase, { headers, signal: AbortSignal.timeout(9000) });
    if (!getRes.ok) {
      const detail = await getRes.text();
      res.status(502).json({ error: 'Failed to read current db', detail });
      return;
    }
    const getData = await getRes.json();
    const currentContent = JSON.parse(Buffer.from(getData.content, 'base64').toString('utf-8'));
    const merged = { ...currentContent, ...updates };
    const newContent = Buffer.from(JSON.stringify(merged, null, 2) + '\n', 'utf-8').toString('base64');

    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Update Steam games DB (+${Object.keys(updates).length})`,
        content: newContent,
        sha: getData.sha,
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (!putRes.ok) {
      const detail = await putRes.text();
      res.status(502).json({ error: 'Failed to write db', detail });
      return;
    }
    res.status(200).json({ ok: true, added: Object.keys(updates).length });
  } catch (e) {
    res.status(502).json({ error: 'GitHub request failed', detail: String(e) });
  }
}
