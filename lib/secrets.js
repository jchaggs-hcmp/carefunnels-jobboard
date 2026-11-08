'use strict';
// Encrypts per-client credentials (CareFunnels tokens, WordPress application passwords) at rest.
// Key: SECRET_KEY env var (any long random string). Values are stored as "enc:v1:<iv>:<tag>:<ciphertext>" (base64).
const crypto = require('node:crypto');

const raw = process.env.SECRET_KEY || process.env.ADMIN_TOKEN || '';
if (!process.env.SECRET_KEY) console.warn('⚠  SECRET_KEY is not set — client credentials are encrypted with a key derived from ADMIN_TOKEN. Set SECRET_KEY in production and keep it stable.');
const KEY = crypto.createHash('sha256').update('hcjobs:' + raw).digest();

function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['enc', 'v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(stored) {
  if (!stored) return null;
  const p = String(stored).split(':');
  if (p[0] !== 'enc' || p[1] !== 'v1') return stored; // legacy/plain value
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(p[2], 'base64'));
  d.setAuthTag(Buffer.from(p[3], 'base64'));
  return Buffer.concat([d.update(Buffer.from(p[4], 'base64')), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
