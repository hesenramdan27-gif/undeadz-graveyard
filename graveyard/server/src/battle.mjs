// Deterministic battle simulation. Same (seed, fighters, config) => same result.
// The SERVER runs this; the browser only replays the returned log.
import { getConfig } from './config.mjs';
import { clamp, mulberry32, sha256Int } from './util.mjs';
import { ABILITIES } from './abilities.mjs';

export function makeEnemy(player, rng) {
  const { enemy, battle } = getConfig();
  const d = enemy.difficultyMin + rng() * (enemy.difficultyMax - enemy.difficultyMin);
  const keys = ['attack', 'defense', 'speed', 'luck'];
  const s = {};
  // Enemies only partly mirror the player, so a stronger NFT really is stronger (scaleToPlayer: 0 = fixed, 1 = mirror).
  const base = getConfig().stats.base;
  const mix = (k) => base[k] + (player.stats[k] - base[k]) * enemy.scaleToPlayer;
  for (const k of keys) s[k] = Math.max(20, Math.round(mix(k) * d));
  // Specialise: move some points from one stat to another so enemies feel different.
  const from = keys[Math.floor(rng() * 4)];
  let to = keys[Math.floor(rng() * 4)];
  if (to === from) to = keys[(keys.indexOf(from) + 1) % 4];
  const shift = Math.round(rng() * enemy.specialize);
  s[from] = Math.max(20, s[from] - shift);
  s[to] += shift;
  s.critChance = Math.round(mix('critChance') * d);
  s.health = Math.round(mix('health') * d);
  const name = enemy.names[Math.floor(rng() * enemy.names.length)];
  return { name, stats: s, traits: [], isEnemy: true };
}

function chances(f) {
  const { battle } = getConfig();
  const crit = clamp(f.stats.critChance + Math.max(0, f.stats.luck - 50) * battle.critPerLuck, 0, 60);
  const dodge = clamp(battle.dodgeBase + (f.stats.luck - 50) * battle.dodgePerLuck + (f.stats.speed - 50) * battle.dodgePerSpeed, 0, battle.dodgeCap);
  return { crit, dodge };
}

export function simulate(playerFighter, seed) {
  const cfg = getConfig();
  const b = cfg.battle;
  const rng = mulberry32(sha256Int(seed));
  const enemy = makeEnemy(playerFighter, rng);
  const A = { ...playerFighter, hp: playerFighter.stats.health, max: playerFighter.stats.health, side: 'player' };
  const B = { ...enemy, hp: enemy.stats.health, max: enemy.stats.health, side: 'enemy' };

  // Speed decides who strikes first each round; exact ties are settled by the seed.
  const first = A.stats.speed > B.stats.speed || (A.stats.speed === B.stats.speed && rng() < 0.5) ? [A, B] : [B, A];
  const log = [];
  let round = 0;

  const strike = (att, def, extra = false) => {
    const ctx = { rng, critChance: chances(att).crit, damageMult: 1, extraAttack: false };
    if (cfg.abilities.enabled) {
      for (const a of Object.values(ABILITIES)) if (att.traits.some((t) => t.value.toLowerCase().includes(a.traitMatch))) a.onAttack(ctx);
    }
    const base = { round, attacker: att.side, defender: def.side };
    if (rng() * 100 < chances(def).dodge) {
      log.push({ ...base, type: 'dodge', damage: 0, hp: { player: A.hp, enemy: B.hp } });
      return ctx;
    }
    const crit = rng() * 100 < ctx.critChance;
    const variance = 1 + (rng() * 2 - 1) * b.variance;
    let dmg = att.stats.attack * b.attackScale * variance * ctx.damageMult * (crit ? b.critMultiplier : 1) - def.stats.defense * b.defenseScale;
    dmg = Math.max(b.minDamage, Math.round(dmg));
    def.hp = Math.max(0, def.hp - dmg);
    log.push({ ...base, type: crit ? 'crit' : 'hit', damage: dmg, hp: { player: A.hp, enemy: B.hp }, bonus: extra ? 'extra' : undefined });
    return ctx;
  };

  while (round < b.maxRounds && A.hp > 0 && B.hp > 0) {
    round++;
    for (const [att, def] of [first, [first[1], first[0]]]) {
      if (A.hp <= 0 || B.hp <= 0) break;
      const ctx = strike(att, def);
      if (ctx.extraAttack && def.hp > 0) strike(att, def, true);
    }
  }

  let result;
  if (A.hp > 0 && B.hp <= 0) result = 'win';
  else if (B.hp > 0 && A.hp <= 0) result = 'loss';
  else {
    const pa = A.hp / A.max, pb = B.hp / B.max; // time ran out: more HP% wins
    result = Math.abs(pa - pb) < 0.005 ? 'draw' : pa > pb ? 'win' : 'loss';
  }
  return { seed, result, rounds: round, enemy: { name: enemy.name, stats: enemy.stats }, hpStart: { player: A.max, enemy: B.max }, hpEnd: { player: A.hp, enemy: B.hp }, log };
}
