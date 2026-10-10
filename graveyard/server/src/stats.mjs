// Trait -> stat mapping. All numbers live in game.config.json (stats.traitRules etc).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.mjs';
import { clamp, sha256Int } from './util.mjs';

const CORE = ['attack', 'defense', 'speed', 'luck'];

// Optional rarity file: { "1842": 0.93, ... } with 0 (common) .. 1 (rarest).
const rarityFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/rarity.json');
let rarity = existsSync(rarityFile) ? JSON.parse(readFileSync(rarityFile, 'utf8')) : {};

export function baseStats(tokenId, traits) {
  const { stats } = getConfig();
  const s = { ...stats.base };
  const matchedTraits = new Set();

  for (const rule of stats.traitRules) {
    const v = rule.value.toLowerCase();
    const t = (rule.traitType || '').toLowerCase();
    traits.forEach((tr, i) => {
      if (tr.value.toLowerCase().includes(v) && tr.traitType.toLowerCase().includes(t)) {
        matchedTraits.add(i);
        for (const [k, n] of Object.entries(rule.bonus)) s[k] += n;
      }
    });
  }

  // Traits with no rule still make each NFT different: a small, deterministic nudge.
  if (stats.hashFallback.enabled) {
    const max = stats.hashFallback.maxPoints;
    const list = traits.length ? traits.map((t) => `${t.traitType}:${t.value}`) : [`token:${tokenId}`];
    list.forEach((key, i) => {
      if (traits.length && matchedTraits.has(i)) return;
      const h = sha256Int(key);
      s[CORE[h % 4]] += (h >> 4) % (max + 1);
    });
  }

  // Rarity = specialisation, not raw power: a few extra points in the strongest stat.
  const r = rarity[tokenId];
  if (r) {
    const top = CORE.reduce((a, b) => (s[b] > s[a] ? b : a));
    s[top] += Math.round(r * stats.rarityMaxPoints);
  }

  // Budget cap keeps commons competitive: scale bonuses down if total goes too high.
  const baseTotal = CORE.reduce((n, k) => n + stats.base[k], 0);
  const total = CORE.reduce((n, k) => n + s[k], 0);
  if (total > stats.budgetCap) {
    const f = (stats.budgetCap - baseTotal) / (total - baseTotal);
    for (const k of CORE) s[k] = Math.round(stats.base[k] + (s[k] - stats.base[k]) * f);
  }
  s.critChance = clamp(s.critChance, 0, stats.maxCritChance);
  return s;
}

export function levelFor(xp) {
  const L = getConfig().levels;
  let lv = 1;
  for (let i = 0; i < L.length; i++) if (xp >= L[i]) lv = i + 1;
  return lv;
}

export function levelInfo(xp) {
  const L = getConfig().levels;
  const level = levelFor(xp);
  const floor = L[level - 1];
  const next = L[level] ?? null; // null = max level
  return { level, xp, levelFloor: floor, nextLevelXp: next, maxLevel: next === null };
}

// Final stats = trait stats + capped level bonus. Level bonus is deliberately small.
export function effectiveStats(tokenId, traits, xp) {
  const { levelBonus, battle } = getConfig();
  const s = baseStats(tokenId, traits);
  const lv = levelFor(xp);
  for (const k of CORE) s[k] += Math.min(levelBonus.maxBonusPerStat, (lv - 1) * (levelBonus.perLevel[k] || 0));
  s.health += (lv - 1) * battle.hpPerLevel;
  return s;
}
