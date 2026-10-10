// Balance + chain configuration. Edit server/config/game.config.json (or use the
// admin endpoint) — no code or frontend rebuild needed.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../config/game.config.json');
let current = JSON.parse(readFileSync(file, 'utf8'));

export const getConfig = () => current;
export const reloadConfig = () => (current = JSON.parse(readFileSync(file, 'utf8')));

// Sections the team may tune live. Chain/collection stay file-only on purpose.
const TUNABLE = ['stats', 'battle', 'enemy', 'xp', 'levels', 'levelBonus', 'limits', 'abilities', 'missions', 'tournaments'];

export function updateConfig(patch) {
  const next = structuredClone(current);
  for (const key of Object.keys(patch || {})) {
    if (!TUNABLE.includes(key)) throw new Error(`Section "${key}" cannot be changed here`);
    const v = patch[key];
    next[key] = Array.isArray(v) || typeof v !== 'object' ? v : { ...next[key], ...v };
  }
  validate(next);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, file);
  current = next;
  return current;
}

function validate(c) {
  const nums = (o, keys) => keys.forEach((k) => { if (!Number.isFinite(o[k])) throw new Error(`${k} must be a number`); });
  nums(c.battle, ['attackScale', 'defenseScale', 'variance', 'minDamage', 'critMultiplier', 'maxRounds']);
  nums(c.xp, ['win', 'loss', 'draw']);
  nums(c.enemy, ['difficultyMin', 'difficultyMax', 'scaleToPlayer']);
  if (c.enemy.difficultyMin > c.enemy.difficultyMax) throw new Error('enemy.difficultyMin > difficultyMax');
  if (!Array.isArray(c.levels) || c.levels[0] !== 0 || c.levels.some((x, i) => i && x <= c.levels[i - 1])) {
    throw new Error('levels must start at 0 and strictly increase');
  }
  if (c.battle.maxRounds < 1 || c.battle.maxRounds > 30) throw new Error('maxRounds must be 1–30');
}
