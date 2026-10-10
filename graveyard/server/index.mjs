import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { getConfig, updateConfig } from './src/config.mjs';
import { isAddress } from './src/util.mjs';
import { issueNonce, verifySignature, readToken } from './src/auth.mjs';
import * as game from './src/game.mjs';
import { isMock } from './src/chain.mjs';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.env.PORT || 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

// Very small per-IP rate limiter (replace with a proxy/WAF limit in production).
const hits = new Map();
function limited(ip, max = 90) {
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  h.push(now); hits.set(ip, h);
  return h.length > max;
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 20_000) throw new game.GameError('Request too large', 413); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function api(req, res, url) {
  const { method } = req;
  const p = url.pathname;
  const user = () => { const a = readToken(req.headers.authorization); if (!a) throw new game.GameError('Please sign in with your wallet.', 401); return a; };

  if (p === '/api/health') return json(res, 200, { ok: true, mockChain: isMock() });

  if (p === '/api/config' && method === 'GET') {
    const c = getConfig();
    return json(res, 200, { chain: c.chain, collection: c.collection, xp: c.xp, levels: c.levels, cooldownSec: c.limits.battleCooldownSec, maxRounds: c.battle.maxRounds });
  }

  if (p === '/api/auth/nonce' && method === 'POST') {
    const { address } = await readBody(req);
    if (!isAddress(address)) throw new game.GameError('Invalid wallet address.');
    return json(res, 200, issueNonce(address));
  }
  if (p === '/api/auth/verify' && method === 'POST') {
    const { address, signature } = await readBody(req);
    if (!isAddress(address) || typeof signature !== 'string') throw new game.GameError('Invalid sign-in data.');
    try { return json(res, 200, verifySignature(address, signature)); }
    catch (e) { throw new game.GameError(e.message, 401); }
  }

  if (p === '/api/me/undeadz' && method === 'GET') return json(res, 200, { undeadz: await game.listMyUndeadz(user()) });

  if (p === '/api/battle' && method === 'POST') {
    const address = user();
    const { tokenId } = await readBody(req);
    return json(res, 200, await game.battle(address, tokenId));
  }

  if (p === '/api/leaderboard' && method === 'GET') {
    return json(res, 200, { rows: await game.leaderboard(url.searchParams.get('type') || 'undeadz', url.searchParams.get('sort') || 'wins') });
  }
  if (p === '/api/history' && method === 'GET') return json(res, 200, { rows: game.history(url.searchParams.get('tokenId')) });

  // Team balance control. Disabled unless ADMIN_KEY is set.
  if (p === '/api/admin/config') {
    if (!process.env.ADMIN_KEY) return json(res, 404, { error: 'Not found' });
    if (!safeEq(req.headers['x-admin-key'] || '', process.env.ADMIN_KEY)) return json(res, 401, { error: 'Bad admin key' });
    if (method === 'GET') return json(res, 200, getConfig());
    if (method === 'POST') { try { return json(res, 200, updateConfig(await readBody(req))); } catch (e) { throw new game.GameError(e.message); } }
  }
  return json(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const resolved = path.resolve(pub, `.${pathname}`);
  if (!resolved.startsWith(pub + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    if (!(await stat(resolved)).isFile()) throw new Error();
    const body = await readFile(resolved);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    if (url.pathname.startsWith('/api/')) {
      if (limited(ip)) return json(res, 429, { error: 'Too many requests. Slow down a little.' });
      return await api(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    await serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof game.GameError) return json(res, e.status, { error: e.message });
    console.error(e);
    json(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}).listen(port, '0.0.0.0', () => console.log(`THE UNDEADZ — GRAVEYARD on :${port}${isMock() ? '  [MOCK CHAIN — dev only]' : ''}`));
