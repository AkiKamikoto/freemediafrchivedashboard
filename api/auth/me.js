const { getSessionFromRequest } = require('../_lib/session');

module.exports = async function handler(req, res) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) { res.status(200).json({ loggedIn: false }); return; }
    res.status(200).json({ loggedIn: true, login: session.login, avatarUrl: session.avatarUrl });
  } catch (e) {
    res.status(200).json({ loggedIn: false, error: e.message });
  }
};
