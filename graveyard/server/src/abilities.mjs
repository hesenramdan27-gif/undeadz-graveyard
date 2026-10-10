// Extension point for special abilities (Phase 3). Disabled by default via config.abilities.enabled.
// Add an entry, flip the flag — battle.mjs already calls these hooks.
export const ABILITIES = {
  SWARM:           { traitMatch: 'bee',        onAttack: (ctx) => { if (ctx.rng() < 0.12) ctx.extraAttack = true; } },
  CRITICAL_VISION: { traitMatch: 'demon eyes', onAttack: (ctx) => { ctx.critChance += 6; } },
  DEATH_STRIKE:    { traitMatch: 'skull',      onAttack: (ctx) => { if (ctx.rng() < 0.08) ctx.damageMult *= 1.8; } },
};
export function abilitiesFor(traits) {
  return Object.entries(ABILITIES).filter(([, a]) => traits.some((t) => t.value.toLowerCase().includes(a.traitMatch))).map(([name]) => name);
}
