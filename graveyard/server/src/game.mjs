// Game service: the only place that mutates XP / wins / losses.
import { randomBytes } from 'node:crypto';
import { getConfig } from './config.mjs';
import { ownsToken, holdings } from './chain.mjs';
import { getMetadata, seedMetadata } from './metadata.mjs';
import { effectiveStats, levelInfo } from './stats.mjs';
import { simulate } from './battle.mjs';
import * as db from './store.mjs';
import { shortAddr } from './util.mjs';

export class GameError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

const dayKey = () => new Date().toISOString().slice(0, 10);

function record(t) {
  const battles = t.battles;
  return { wins: t.wins, losses: t.losses, draws: t.draws, battles, winRate: battles ? Math.round((t.wins / battles) * 1000) / 10 : 0 };
}

export async function describeToken(tokenId) {
  const meta = await getMetadata(tokenId);
  const t = db.getToken(tokenId);
  return {
    tokenId, name: meta.name, image: meta.image, traits: meta.traits, metaSource: meta.source,
    stats: effectiveStats(tokenId, meta.traits, t.xp),
    progress: levelInfo(t.xp), record: record(t),
  };
}

export async function listMyUndeadz(address) {
  let h;
  try { h = await holdings(address); } catch (e) { throw new GameError(e.message, 502); }
  h.items.forEach((x) => seedMetadata(x.tokenId, x.meta));
  const undeadz = await Promise.all(h.items.map((x) => describeToken(x.tokenId)));
  return { source: h.source, undeadz };
}

export async function battle(address, tokenId) {
  const cfg = getConfig();
  tokenId = Number(tokenId);
  // 1) Ownership is checked on-chain, right now, for the signed-in wallet. Never from the client.
  if (!(await ownsToken(address, tokenId))) throw new GameError('This Undeadz is not in your wallet.', 403);

  const t = { ...db.getToken(tokenId) };
  const now = Date.now();
  const wait = Math.ceil((t.lastBattleAt + cfg.limits.battleCooldownSec * 1000 - now) / 1000);
  if (wait > 0) throw new GameError(`Your Undeadz is resting. Try again in ${wait}s.`, 429);

  const meta = await getMetadata(tokenId);
  const before = levelInfo(t.xp);
  const fighter = { name: meta.name, traits: meta.traits, stats: effectiveStats(tokenId, meta.traits, t.xp) };
  const out = simulate(fighter, randomBytes(16).toString('hex'));

  // 2) XP is computed here, with a daily cap so battles can't be farmed endlessly.
  const today = dayKey();
  if (t.day !== today) { t.day = today; t.dayBattles = 0; }
  const capped = t.dayBattles >= cfg.limits.maxXpBattlesPerDay;
  const xpGain = capped ? 0 : cfg.xp[out.result];
  t.dayBattles++;
  t.xp += xpGain; t.battles++; t.lastBattleAt = now; t.lastWallet = address;
  if (out.result === 'win') t.wins++; else if (out.result === 'loss') t.losses++; else t.draws++;
  db.setToken(tokenId, t);

  const p = { ...db.getPlayer(address) };
  p.battles++; p.xp += xpGain;
  if (out.result === 'win') p.wins++; else if (out.result === 'loss') p.losses++; else p.draws++;
  db.setPlayer(address, p);

  db.addHistory({ at: now, tokenId, wallet: address, result: out.result, xp: xpGain, rounds: out.rounds, seed: out.seed, enemy: out.enemy.name });

  const after = levelInfo(t.xp);
  const newStats = effectiveStats(tokenId, meta.traits, t.xp);
  return {
    battle: { ...out, player: { name: meta.name, tokenId, stats: fighter.stats } },
    reward: { xp: xpGain, capped, leveledUp: after.level > before.level, level: after.level, gains: after.level > before.level ? diff(fighter.stats, newStats) : null },
    progress: after, record: record(t), stats: newStats,
  };
}

function diff(a, b) {
  const out = {};
  for (const k of ['attack', 'defense', 'speed', 'luck', 'health']) if (b[k] - a[k]) out[k] = b[k] - a[k];
  return out;
}

export async function leaderboard(type = 'undeadz', sort = 'wins') {
  const rows = [];
  if (type === 'players') {
    for (const [addr, p] of Object.entries(db.allPlayers())) {
      rows.push({ player: shortAddr(addr), wins: p.wins, losses: p.losses, battles: p.battles, xp: p.xp, winRate: p.battles ? Math.round((p.wins / p.battles) * 1000) / 10 : 0 });
    }
  } else {
    for (const [id, t] of Object.entries(db.allTokens())) {
      if (!t.battles) continue;
      rows.push({ tokenId: Number(id), owner: shortAddr(t.lastWallet), wins: t.wins, losses: t.losses, battles: t.battles, xp: t.xp, level: levelInfo(t.xp).level, winRate: record(t).winRate });
    }
  }
  const key = ['wins', 'xp', 'winRate', 'level'].includes(sort) ? sort : 'wins';
  // Win rate only ranks fairly with a minimum sample.
  const pool = key === 'winRate' ? rows.filter((r) => r.battles >= 5) : rows;
  pool.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0) || b.xp - a.xp);
  return pool.slice(0, 50).map((r, i) => ({ rank: i + 1, ...r }));
}

export const history = (tokenId) => db.historyFor(tokenId);
