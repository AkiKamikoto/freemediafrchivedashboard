const { upsertGithubUser } = require('../_lib/db');
const { createSessionCookie } = require('../_lib/session');

module.exports = async function handler(req, res) {
  const { code, state } = req.query;
  const cookieState = req.cookies && req.cookies.oauth_state;
  if (!code || !state || !cookieState || state !== cookieState) {
    res.status(400).send('Некорректный ответ от GitHub (не совпадает state) — попробуй войти ещё раз.');
    return;
  }
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).send('GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET не настроены в переменных окружения Vercel');
    return;
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      res.status(400).send('Не удалось получить токен от GitHub: ' + (tokenData.error_description || tokenData.error || 'неизвестная ошибка'));
      return;
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'freemediafrchivedashboard' }
    });
    const ghUser = await userRes.json();
    if (!ghUser || !ghUser.id) {
      res.status(400).send('Не удалось получить профиль GitHub');
      return;
    }

    const user = await upsertGithubUser({ githubId: ghUser.id, login: ghUser.login, avatarUrl: ghUser.avatar_url });
    const sessionCookie = createSessionCookie({ uid: user.id, login: user.login, avatarUrl: user.avatar_url });
    res.setHeader('Set-Cookie', [
      sessionCookie,
      'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    ]);
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (e) {
    res.status(500).send('Ошибка авторизации: ' + e.message);
  }
};
