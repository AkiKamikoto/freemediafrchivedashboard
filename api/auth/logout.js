const { clearSessionCookie } = require('../_lib/session');

module.exports = async function handler(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.writeHead(302, { Location: '/' });
  res.end();
};
