// Wallet-signature login. The wallet only signs a plain-text message (no gas, no funds access).
// Server issues a single-use nonce, recovers the signer, then hands out a short-lived HMAC token.
import { ethers } from 'ethers';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config.mjs';

const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[auth] SESSION_SECRET not set — sessions reset on every restart. Set it in production.');

const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 3600_000;
const nonces = new Map(); // address -> { nonce, issued, expires }

export function buildMessage(address, nonce, issued, expires) {
  const { collection, chain } = getConfig();
  return [
    `${collection.name} — GRAVEYARD`,
    'Sign in to play. This is free and gives no access to your funds.',
    '',
    `Wallet: ${address}`,
    `Chain: ${chain.name} (${chain.chainId})`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date(issued).toISOString()}`,
    `Expires: ${new Date(expires).toISOString()}`,
  ].join('\n');
}

export function issueNonce(address) {
  const addr = ethers.getAddress(address);
  const nonce = randomBytes(16).toString('hex');
  const issued = Date.now();
  const expires = issued + NONCE_TTL_MS;
  nonces.set(addr.toLowerCase(), { nonce, issued, expires });
  for (const [k, v] of nonces) if (v.expires < issued) nonces.delete(k);
  return { message: buildMessage(addr, nonce, issued, expires) };
}

export function verifySignature(address, signature) {
  const addr = ethers.getAddress(address);
  const rec = nonces.get(addr.toLowerCase());
  if (!rec || rec.expires < Date.now()) throw new Error('Sign-in request expired. Try again.');
  nonces.delete(addr.toLowerCase()); // single use
  const recovered = ethers.verifyMessage(buildMessage(addr, rec.nonce, rec.issued, rec.expires), signature);
  if (recovered.toLowerCase() !== addr.toLowerCase()) throw new Error('Signature does not match this wallet.');
  return makeToken(addr.toLowerCase());
}

const b64 = (b) => Buffer.from(b).toString('base64url');
const mac = (s) => createHmac('sha256', SECRET).update(s).digest();

function makeToken(addr) {
  const payload = b64(JSON.stringify({ a: addr, exp: Date.now() + SESSION_TTL_MS }));
  return { token: `${payload}.${b64(mac(payload))}`, address: addr };
}

export function readToken(header) {
  const t = (header || '').replace(/^Bearer\s+/i, '');
  const [payload, sig] = t.split('.');
  if (!payload || !sig) return null;
  const good = mac(payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== good.length || !timingSafeEqual(given, good)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return data.exp > Date.now() ? data.a : null;
}
