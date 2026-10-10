import { createHash } from 'node:crypto';

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const shortAddr = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '');
export const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
export const sha256Int = (s) => createHash('sha256').update(String(s)).digest().readUInt32BE(0);

// Small deterministic PRNG: same seed -> same battle, so any result can be replayed/audited.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
