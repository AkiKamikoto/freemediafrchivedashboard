const crypto = require('crypto');

const COOKIE_NAME = 'session';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 дней

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}

function requireSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET не настроен в переменных окружения');
  return secret;
}

function sign(payloadObj, secret) {
  const payload = base64url(JSON.stringify(payloadObj));
  const sig = base64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = base64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let data;
  try { data = JSON.parse(base64urlDecode(payload)); } catch (e) { return null; }
  if (data.exp && Date.now() > data.exp) return null;
  return data;
}

function createSessionCookie(userPayload) {
  const secret = requireSecret();
  const token = sign({ ...userPayload, exp: Date.now() + MAX_AGE_SEC * 1000 }, secret);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SEC}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function getSessionFromRequest(req) {
  const secret = requireSecret();
  const raw = req.cookies && req.cookies[COOKIE_NAME];
  return verify(raw, secret);
}

module.exports = { COOKIE_NAME, createSessionCookie, clearSessionCookie, getSessionFromRequest, requireSecret };
