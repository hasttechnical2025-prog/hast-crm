const crypto = require('crypto');
const { CONSTANTS } = require('../config');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function hashPassword(password, salt) {
  return sha256(password + salt);
}

function generateSalt() {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 16);
}

function verifyPassword(password, salt, storedHash) {
  return hashPassword(password, salt) === storedHash;
}

function base64UrlEncode(text) {
  return Buffer.from(text).toString('base64url');
}

function base64UrlDecode(text) {
  return Buffer.from(text, 'base64url').toString('utf8');
}

function createJWT(payload) {
  const secret = CONSTANTS.JWT_SECRET;
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${sigB64}`;
}

function verifyJWT(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const secret = CONSTANTS.JWT_SECRET;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSigB64 = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');

  if (sigB64 !== expectedSigB64) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Token expired
    }
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  sha256,
  hashPassword,
  generateSalt,
  verifyPassword,
  createJWT,
  verifyJWT
};