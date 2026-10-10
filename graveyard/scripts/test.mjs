// End-to-end test against a mock chain (no RPC needed). Run: npm test
import { spawn } from 'node:child_process';
import { ethers } from 'ethers';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const wallet = ethers.Wallet.createRandom();
const other = ethers.Wallet.createRandom();
const PORT = 3999, base = `http://localhost:${PORT}`;
const env = { ...process.env, PORT, MOCK_CHAIN: '1', SESSION_SECRET: 'test', DATA_DIR: mkdtempSync(path.join(tmpdir(), 'ug-')),
  MOCK_OWNERS: JSON.stringify({ [wallet.address]: [1842, 291], [other.address]: [7] }) };
const srv = spawn('node', ['server/index.mjs'], { env, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1200));

const call = async (p, opt = {}, token) => {
  const r = await fetch(base + p, { ...opt, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  return { status: r.status, body: await r.json() };
};
const post = (p, body, token) => call(p, { method: 'POST', body: JSON.stringify(body) }, token);
let passed = 0; const ok = (name) => { passed++; console.log('  ✓', name); };

try {
  // login
  const { body: n } = await post('/api/auth/nonce', { address: wallet.address });
  const sig = await wallet.signMessage(n.message);
  const v = await post('/api/auth/verify', { address: wallet.address, signature: sig });
  assert.equal(v.status, 200); const token = v.body.token; ok('wallet signature login');

  // nonce is single-use
  assert.equal((await post('/api/auth/verify', { address: wallet.address, signature: sig })).status, 401); ok('nonce cannot be replayed');
  // wrong signer
  const n2 = await post('/api/auth/nonce', { address: wallet.address });
  assert.equal((await post('/api/auth/verify', { address: wallet.address, signature: await other.signMessage(n2.body.message) })).status, 401); ok('wrong signer rejected');

  assert.equal((await post('/api/battle', { tokenId: 1842 })).status, 401); ok('battle needs login');

  const mine = await call('/api/me/undeadz', {}, token);
  assert.equal(mine.body.undeadz.length, 2);
  assert.notDeepEqual(mine.body.undeadz[0].stats, mine.body.undeadz[1].stats); ok('detects owned NFTs with distinct stats');

  assert.equal((await post('/api/battle', { tokenId: 7 }, token)).status, 403); ok("cannot battle with someone else's NFT");
  assert.equal((await post('/api/battle', { tokenId: 99999 }, token)).status, 403); ok('out-of-range token rejected');

  const b = await post('/api/battle', { tokenId: 1842 }, token);
  assert.equal(b.status, 200);
  const expectXp = { win: 100, loss: 25, draw: 50 }[b.body.battle.result];
  assert.equal(b.body.reward.xp, expectXp); assert.equal(b.body.progress.xp, expectXp);
  assert.ok(b.body.battle.log.length >= 2); ok(`battle server-side (${b.body.battle.result}, ${b.body.battle.rounds} rounds, +${expectXp} XP)`);

  assert.equal((await post('/api/battle', { tokenId: 1842 }, token)).status, 429); ok('cooldown enforced');

  const lb = await call('/api/leaderboard?type=undeadz&sort=xp');
  assert.equal(lb.body.rows[0].tokenId, 1842); assert.ok(lb.body.rows[0].owner.includes('...')); ok('leaderboard (addresses shortened)');
  const lp = await call('/api/leaderboard?type=players');
  assert.equal(lp.body.rows.length, 1); ok('player leaderboard');
  assert.equal((await call('/api/admin/config')).status, 404); ok('admin disabled without ADMIN_KEY');
} finally { srv.kill(); }

// Holdings via indexer (Blockscout v2 shape): pagination, only THE UNDEADZ contract, images + traits kept
{
  const { createServer } = await import('node:http');
  const C = '0xC180F7bb3A73EDAd6D30cF22813F2eBa0fF3042D';
  const item = (id, token) => ({ id: String(id), image_url: `https://img.example/${id}.png`, token_type: 'ERC-721', token, metadata: { name: `THE UNDEADZ #${id}`, attributes: [{ trait_type: 'Eyes', value: 'Demon Eyes' }] } });
  const fake = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    assert.ok(u.pathname.endsWith(`/addresses/${wallet.address}/nft`)); assert.equal(u.searchParams.get('type'), 'ERC-721');
    res.setHeader('content-type', 'application/json');
    if (!u.searchParams.get('page')) res.end(JSON.stringify({ items: [item(1842, { address_hash: C }), item(5, { address_hash: '0x1111111111111111111111111111111111111111' })], next_page_params: { page: '2' } }));
    else res.end(JSON.stringify({ items: [item(291, { address: { hash: C.toLowerCase() } })], next_page_params: null }));
  }).listen(4555);
  process.env.INDEXER_URL = 'http://localhost:4555';
  const { holdings } = await import('../server/src/chain.mjs');
  const h = await holdings(wallet.address);
  assert.equal(h.source, 'indexer'); assert.deepEqual(h.items.map((x) => x.tokenId), [291, 1842]);
  assert.equal(h.items[1].meta.image, 'https://img.example/1842.png'); assert.equal(h.items[1].meta.attributes[0].value, 'Demon Eyes');
  fake.close(); ok('holdings: real NFT image + traits per wallet, other collections filtered, pagination');
}

// Balance + determinism checks (direct import)
const { simulate } = await import('../server/src/battle.mjs');
const { effectiveStats } = await import('../server/src/stats.mjs');
const traits = [{ traitType: 'Eyes', value: 'Bee' }];
const f = { name: 'x', traits, stats: effectiveStats(5, traits, 0) };
assert.deepEqual(simulate(f, 'abc'), simulate(f, 'abc')); ok('same seed => identical battle');

const run = (stats, n = 3000) => { const r = { win: 0, loss: 0, draw: 0, rounds: 0 };
  for (let i = 0; i < n; i++) { const s = simulate({ name: 'x', traits: [], stats }, `s${i}`); r[s.result]++; r.rounds += s.rounds; } return r; };
const common = run({ attack: 50, defense: 50, speed: 50, luck: 50, critChance: 5, health: 100 });
const rare = run({ attack: 62, defense: 58, speed: 54, luck: 58, critChance: 13, health: 100 });
console.log('  balance, average vs generated enemy (3000 fights each):');
console.log('   common:', `${(common.win / 30).toFixed(1)}% win`, `avg ${(common.rounds / 3000).toFixed(1)} rounds`);
console.log('   rare  :', `${(rare.win / 30).toFixed(1)}% win`, `avg ${(rare.rounds / 3000).toFixed(1)} rounds`);
assert.ok(common.win / 3000 > 0.3, 'commons must be able to win'); ok('commons stay competitive');
console.log(`\n${passed} checks passed`);
