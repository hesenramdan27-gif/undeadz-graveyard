// Tiny JSON-file store. Swap this module for SQLite/Postgres later; the rest of the
// code only uses these functions.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const localDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
let dir = process.env.DATA_DIR || localDir;
try { mkdirSync(dir, { recursive: true }); }
catch (e) {
  // e.g. DATA_DIR=/var/data but no persistent disk is mounted: don't crash, but warn loudly.
  console.warn(`[store] Cannot use DATA_DIR "${dir}" (${e.code}). Falling back to ${localDir} — progress will be LOST on redeploy. Mount a persistent disk or unset DATA_DIR.`);
  dir = localDir;
  mkdirSync(dir, { recursive: true });
}
const file = path.join(dir, 'db.json');

let db = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { tokens: {}, players: {}, history: [] };
let timer = null;

function flush() {
  timer = null;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(db));
  renameSync(tmp, file);
}
export const save = () => { if (!timer) timer = setTimeout(flush, 300); };
export const flushNow = () => { if (timer) clearTimeout(timer); flush(); };

const emptyToken = () => ({ xp: 0, wins: 0, losses: 0, draws: 0, battles: 0, lastBattleAt: 0, day: '', dayBattles: 0, lastWallet: '' });
const emptyPlayer = () => ({ wins: 0, losses: 0, draws: 0, battles: 0, xp: 0 });

export const getToken = (id) => db.tokens[id] || emptyToken();
export const setToken = (id, v) => { db.tokens[id] = v; save(); };
export const getPlayer = (addr) => db.players[addr] || emptyPlayer();
export const setPlayer = (addr, v) => { db.players[addr] = v; save(); };
export const allTokens = () => db.tokens;
export const allPlayers = () => db.players;
export const addHistory = (entry) => { db.history.push(entry); if (db.history.length > 5000) db.history.splice(0, db.history.length - 5000); save(); };
export const historyFor = (tokenId, limit = 20) => db.history.filter((h) => String(h.tokenId) === String(tokenId)).slice(-limit).reverse();
