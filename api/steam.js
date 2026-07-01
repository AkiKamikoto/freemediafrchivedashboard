const ALLOWED_HOSTS = ['api.steampowered.com', 'steamcommunity.com'];

module.exports = async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch (e) {
    res.status(400).json({ error: 'Invalid url parameter' });
    return;
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.includes(parsed.hostname)) {
    res.status(403).json({ error: 'Host not allowed' });
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), { signal: AbortSignal.timeout(9000) });
    const body = await upstream.text();
    res.status(upstream.status).send(body);
  } catch (e) {
    res.status(502).json({ error: 'Upstream request failed' });
  }
}
