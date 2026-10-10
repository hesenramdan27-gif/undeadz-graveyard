// THE UNDEADZ — GRAVEYARD frontend. Display + wallet only: the server decides every
// result, XP and rank. Nothing here can change them.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const S = { cfg: null, provider: null, address: null, token: null, undeadz: [], selected: null, busy: false, cooldownUntil: 0, skip: false };

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token) { signOut(); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/* ---------- Wallet ---------- */
const discovered = new Map(); // EIP-6963: MetaMask, Rabby, Zerion, Coinbase... announce themselves
window.addEventListener('eip6963:announceProvider', (e) => discovered.set(e.detail.info.uuid, e.detail));
window.dispatchEvent(new Event('eip6963:requestProvider'));

// Integration hook: the main THE UNDEADZ site can hand over its already-connected provider
// so players don't connect twice:  window.UndeadzGame.attachProvider(window.ethereum)
window.UndeadzGame = { attachProvider: (p) => { S.provider = p; connect(true); } };

function walletOptions() {
  const list = [...discovered.values()].map((d) => ({ name: d.info.name, icon: d.info.icon, provider: d.provider }));
  if (!list.length && window.ethereum) list.push({ name: 'Browser wallet', provider: window.ethereum });
  return list;
}
function choose(options) {
  if (options.length === 1) return Promise.resolve(options[0]);
  return new Promise((resolve) => {
    const box = $('#pickerList'); box.replaceChildren();
    options.forEach((o) => {
      const b = el('button', 'opt'); if (o.icon && o.icon.startsWith('data:image')) { const i = el('img'); i.src = o.icon; i.alt = ''; b.append(i); }
      b.append(el('span', '', o.name)); b.onclick = () => { $('#picker').hidden = true; resolve(o); }; box.append(b);
    });
    $('#picker').hidden = false;
    $('#pickerClose').onclick = () => { $('#picker').hidden = true; resolve(null); };
  });
}

async function ensureChain(p) {
  const c = S.cfg.chain;
  const now = await p.request({ method: 'eth_chainId' });
  if (parseInt(now, 16) === c.chainId) return;
  notice('Please switch to Robinhood Chain.');
  try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: c.chainIdHex }] }); }
  catch (e) {
    if (e.code !== 4902 && e.code !== -32603) throw e;
    await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: c.chainIdHex, chainName: c.name, rpcUrls: [c.rpcUrl], blockExplorerUrls: [c.explorerUrl], nativeCurrency: { name: c.currency, symbol: c.currency, decimals: 18 } }] });
  }
  notice('');
}

async function connect(attached = false) {
  if (S.busy) return; S.busy = true; renderCta();
  try {
    notice('');
    if (!attached) {
      const opts = walletOptions();
      if (!opts.length) { notice('No wallet found. Open this page in MetaMask, Rabby, Zerion or Coinbase Wallet.'); return; }
      const pick = await choose(opts); if (!pick) return;
      S.provider = pick.provider;
    }
    const [account] = await S.provider.request({ method: 'eth_requestAccounts' });
    await ensureChain(S.provider);
    const { message } = await api('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ address: account }) });
    const signature = await S.provider.request({ method: 'personal_sign', params: [message, account] });
    const { token, address } = await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ address: account, signature }) });
    S.token = token; S.address = address; sessionStorage.setItem('ug', JSON.stringify({ token, address }));
    bindWalletEvents();
    await loadUndeadz();
  } catch (e) {
    notice(e.code === 4001 ? 'Request cancelled. Tap Connect wallet when you are ready.' : e.message || 'Could not connect.');
  } finally { S.busy = false; renderAll(); }
}

function bindWalletEvents() {
  if (S.bound || !S.provider.on) return; S.bound = true;
  S.provider.on('accountsChanged', () => { signOut(); notice('Wallet changed. Connect again to continue.'); });
  S.provider.on('chainChanged', (id) => { if (parseInt(id, 16) !== S.cfg.chain.chainId) notice('Please switch to Robinhood Chain.'); else notice(''); });
}

function signOut() { S.token = S.address = S.selected = null; S.undeadz = []; sessionStorage.removeItem('ug'); renderAll(); }

async function loadUndeadz() {
  const { undeadz } = await api('/api/me/undeadz');
  S.undeadz = undeadz;
  if (S.selected) S.selected = undeadz.find((u) => u.tokenId === S.selected.tokenId) || null;
  if (!undeadz.length) notice('No Undeadz found in this wallet yet. Get one from the official site, then come back.');
  else if (undeadz.length === 1) S.selected = undeadz[0]; // one NFT: skip the choosing step
}

/* ---------- Views ---------- */
function go(view) {
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${view}`));
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'board') loadBoard();
  if (view === 'arena') renderArena();
  scrollTo(0, 0);
}
$$('#tabs button').forEach((b) => b.onclick = () => go(b.dataset.view));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

function notice(msg) { const n = $('#notice'); n.textContent = msg; n.hidden = !msg; }
const short = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '');

function renderAll() { renderWallet(); renderCta(); renderSteps(); renderCrypt(); renderArena(); }

function renderWallet() {
  const b = $('#walletBtn');
  b.textContent = S.address ? short(S.address) : 'Connect wallet'; b.classList.toggle('live', !!S.address);
  b.onclick = S.address ? signOut : () => connect();
  b.title = S.address ? 'Tap to sign out' : '';
}
function renderCta() {
  const b = $('#mainCta');
  b.disabled = S.busy;
  if (!S.address) { b.textContent = S.busy ? 'Waiting for your wallet…' : 'Connect wallet'; b.onclick = () => connect(); }
  else if (!S.selected) { b.textContent = S.undeadz.length ? 'Choose your Undeadz' : 'No Undeadz found'; b.onclick = () => S.undeadz.length && go('crypt'); b.disabled = !S.undeadz.length; }
  else { b.textContent = `Battle with #${S.selected.tokenId}`; b.onclick = () => go('arena'); }
}
function renderSteps() {
  const at = !S.address ? 1 : !S.selected ? 2 : 3;
  $$('#steps li').forEach((li) => { const n = Number(li.dataset.step); li.className = n < at ? 'done' : n === at ? 'now' : ''; });
}

/* ---------- Cards ---------- */
function avatar(u, name) {
  const box = el('div', 'art');
  const fallback = () => {
    const h = ((u.tokenId || name.length) * 47) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${h} 35% 16%)"/><ellipse cx="50" cy="56" rx="26" ry="30" fill="hsl(${h} 45% 62%)"/><circle cx="40" cy="50" r="6" fill="#100d1b"/><circle cx="60" cy="50" r="6" fill="#100d1b"/><rect x="40" y="70" width="20" height="5" rx="2" fill="#100d1b"/></svg>`;
    const i = el('img'); i.alt = ''; i.src = `data:image/svg+xml,${encodeURIComponent(svg)}`; box.replaceChildren(i);
  };
  if (u.image && /^https:\/\//.test(u.image)) { const i = el('img'); i.alt = name; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.src = u.image; i.onerror = fallback; box.append(i); }
  else fallback();
  return box;
}
const STAT_ROWS = [['atk', '⚔', 'Attack', 'attack'], ['def', '🛡', 'Defense', 'defense'], ['spd', '⚡', 'Speed', 'speed'], ['lck', '🍀', 'Luck', 'luck']];
function statBlock(stats) {
  const wrap = el('div', 'stats');
  for (const [cls, icon, label, key] of STAT_ROWS) {
    const r = el('div', `stat ${cls}`); const bar = el('div', 'bar'); const f = el('b'); f.style.width = `${Math.min(100, (stats[key] / 100) * 100)}%`; bar.append(f);
    r.append(el('i', '', icon), el('span', '', label), bar, el('span', '', String(stats[key]))); wrap.append(r);
  }
  const hp = el('div', 'stat'); hp.append(el('i', '', '❤️'), el('span', '', 'Health'), el('span'), el('span', '', String(stats.health))); wrap.append(hp);
  return wrap;
}
function xpBlock(p) {
  const box = el('div', 'xp');
  box.append(el('span', '', p.maxLevel ? `XP ${p.xp.toLocaleString()} (max level)` : `XP ${p.xp.toLocaleString()} / ${p.nextLevelXp.toLocaleString()}`));
  const bar = el('div', 'bar'), f = el('b'); f.style.width = p.maxLevel ? '100%' : `${((p.xp - p.levelFloor) / (p.nextLevelXp - p.levelFloor)) * 100}%`; bar.append(f); box.append(bar);
  return box;
}
function recText(r) { return `${r.battles} battles · ${r.wins} wins · ${r.losses} losses · ${r.winRate}% win rate`; }

function card(u, { tag = 'button', onClick } = {}) {
  const c = el(tag, 'stone' + (S.selected && S.selected.tokenId === u.tokenId ? ' sel' : ''));
  if (tag === 'button') { c.type = 'button'; c.onclick = onClick; }
  const body = el('div', 'body');
  const head = el('div', 'head'); head.append(el('h3', '', u.name && u.name.includes('#') ? u.name : `#${u.tokenId}`), el('span', 'lv', `Lv ${u.progress.level}`));
  body.append(head, statBlock(u.stats), xpBlock(u.progress), el('div', 'rec', recText(u.record)));
  if (u.traits?.length) { const t = el('div', 'traits'); u.traits.slice(0, 6).forEach((x) => t.append(el('span', '', x.value))); body.append(t); }
  c.append(avatar(u, u.name), body);
  return c;
}

function renderCrypt() {
  const g = $('#cryptGrid'); g.replaceChildren();
  $('#cryptSub').textContent = !S.address ? 'Connect your wallet to see your Undeadz.'
    : S.undeadz.length ? `${short(S.address)} holds ${S.undeadz.length} Undeadz. Tap one to make it your fighter.` : `No Undeadz found in ${short(S.address)}.`;
  S.undeadz.forEach((u) => g.append(card(u, { onClick: () => { S.selected = u; renderAll(); go('arena'); } })));
}

/* ---------- Arena ---------- */
function fighterCard(box, f, enemy) {
  box.replaceChildren(); box.className = `fighter${enemy ? ' enemy' : ''}`;
  const c = el('div', 'stone');
  const body = el('div', 'body'); const head = el('div', 'head');
  head.append(el('h3', '', enemy ? f.name : (f.name && f.name.includes('#') ? f.name : `#${f.tokenId}`)));
  if (!enemy) head.append(el('span', 'lv', `Lv ${f.progress.level}`));
  const hp = el('div', 'hp'); const bar = el('div', 'bar'); const b = el('b'); bar.append(b); const t = el('small', '', '');
  hp.append(bar, t); body.append(head, hp, statBlock(f.stats));
  c.append(avatar(enemy ? { tokenId: 0 } : f, f.name), body); box.append(c);
  box._hp = { b, t, max: f.stats.health, card: box }; return box;
}
function setHp(h, v) { h.b.style.width = `${(v / h.max) * 100}%`; h.b.classList.toggle('low', v / h.max < 0.3); h.t.textContent = `${v} / ${h.max} HP`; }

function renderArena() {
  const has = !!(S.address && S.selected);
  $('#arenaEmpty').hidden = has; $('#arenaMain').hidden = !has;
  if (!has) return;
  fighterCard($('#fighterA'), S.selected, false);
  const preview = { name: 'Unknown challenger', stats: { attack: '?', defense: '?', speed: '?', luck: '?', health: '?' } };
  const B = $('#fighterB'); fighterCard(B, preview, true); B._hp.t.textContent = ''; B._hp.b.style.width = '100%';
  setHp($('#fighterA')._hp, S.selected.stats.health);
  $('#feed').replaceChildren(); $('#result').hidden = true; $('#roundLabel').textContent = '';
  $('#fightBtn').onclick = fight; updateFightBtn();
}
function updateFightBtn() {
  const b = $('#fightBtn'); const left = Math.ceil((S.cooldownUntil - Date.now()) / 1000);
  b.disabled = S.fighting || left > 0; b.textContent = S.fighting ? 'Fighting…' : left > 0 ? `Resting ${left}s` : 'Fight';
  if (left > 0 && !S.fighting) setTimeout(updateFightBtn, 500);
}
const wait = (ms) => new Promise((r) => setTimeout(r, S.skip ? 0 : ms));

async function fight() {
  if (S.fighting) return; S.fighting = true; S.skip = false; updateFightBtn();
  $('#result').hidden = true; $('#feed').replaceChildren(); $('#skipBtn').hidden = false; $('#skipBtn').onclick = () => { S.skip = true; };
  try {
    const out = await api('/api/battle', { method: 'POST', body: JSON.stringify({ tokenId: S.selected.tokenId }) });
    const { battle } = out;
    const A = $('#fighterA'), B = fighterCard($('#fighterB'), { name: battle.enemy.name, stats: battle.enemy.stats }, true);
    setHp(A._hp, battle.hpStart.player); setHp(B._hp, battle.hpStart.enemy);
    const feed = $('#feed'); let lastRound = 0;
    const line = (txt, cls) => { const li = el('li', cls, txt); feed.prepend(li); };
    for (const ev of battle.log) {
      if (ev.round !== lastRound) { lastRound = ev.round; $('#roundLabel').textContent = `Round ${ev.round}`; }
      const mine = ev.attacker === 'player';
      const who = mine ? `#${S.selected.tokenId}` : battle.enemy.name, foe = mine ? battle.enemy.name : `#${S.selected.tokenId}`;
      if (ev.type === 'dodge') line(`${foe} dodges ${who}'s attack!`, 'x');
      else line(`${ev.type === 'crit' ? 'Critical hit! ' : ''}${who} hits for ${ev.damage}.`, `${mine ? 'p' : 'e'}${ev.type === 'crit' ? ' crit' : ''}`);
      setHp(A._hp, ev.hp.player); setHp(B._hp, ev.hp.enemy);
      if (ev.type !== 'dodge' && !S.skip) { const t = mine ? B : A; t.classList.add('hit'); setTimeout(() => t.classList.remove('hit'), 360); }
      await wait(850);
    }
    setHp(A._hp, battle.hpEnd.player); setHp(B._hp, battle.hpEnd.enemy);
    showResult(out);
    const idx = S.undeadz.findIndex((u) => u.tokenId === S.selected.tokenId);
    S.selected = { ...S.selected, stats: out.stats, progress: out.progress, record: out.record }; if (idx >= 0) S.undeadz[idx] = S.selected;
    S.cooldownUntil = Date.now() + S.cfg.cooldownSec * 1000;
  } catch (e) { $('#feed').prepend(el('li', 'e', e.message)); }
  finally { S.fighting = false; $('#skipBtn').hidden = true; updateFightBtn(); renderCrypt(); renderSteps(); renderCta(); }
}

function showResult(out) {
  const r = $('#result'); r.hidden = false; r.className = `result ${out.battle.result}`; r.replaceChildren();
  r.append(el('h3', '', { win: 'Victory!', loss: 'Defeated', draw: 'Draw' }[out.battle.result]));
  r.append(el('p', '', out.reward.capped ? 'Daily XP limit reached. Come back tomorrow for more XP.' : `+${out.reward.xp} XP`));
  if (out.reward.leveledUp) {
    const g = Object.entries(out.reward.gains || {}).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} +${v}`).join('   ');
    r.append(el('div', 'lvlup', `Level up! Now level ${out.reward.level}${g ? ` · ${g}` : ''}`));
  }
  r.append(el('p', 'rec', recText(out.record)));
  const again = el('button', 'btn', 'Fight again'); again.onclick = () => { renderArena(); };
  const other = el('button', 'btn ghost', 'Choose another'); other.onclick = () => go('crypt');
  r.append(again, ' ', other);
}

/* ---------- Leaderboard ---------- */
let boardType = 'undeadz';
$$('#boardType button').forEach((b) => b.onclick = () => { boardType = b.dataset.t; $$('#boardType button').forEach((x) => x.classList.toggle('on', x === b)); loadBoard(); });
$('#boardSort').onchange = loadBoard;
async function loadBoard() {
  const t = $('#boardTable'); t.replaceChildren();
  try {
    const { rows } = await api(`/api/leaderboard?type=${boardType}&sort=${$('#boardSort').value}`);
    const cols = boardType === 'undeadz' ? [['#', 'rank'], ['Undeadz', 'tokenId'], ['Owner', 'owner'], ['Wins', 'wins'], ['Level', 'level'], ['XP', 'xp'], ['Win rate', 'winRate']] : [['#', 'rank'], ['Player', 'player'], ['Wins', 'wins'], ['Battles', 'battles'], ['XP', 'xp'], ['Win rate', 'winRate']];
    const head = el('tr'); cols.forEach(([n]) => head.append(el('th', '', n))); t.append(head);
    if (!rows.length) { const r = el('tr'); const d = el('td', '', 'No battles yet. Be the first on the board.'); d.colSpan = cols.length; r.append(d); t.append(r); }
    rows.forEach((row) => { const tr = el('tr'); cols.forEach(([, k]) => { const v = row[k]; tr.append(el('td', k === 'rank' ? 'r' : '', k === 'tokenId' ? `#${v}` : k === 'winRate' ? `${v}%` : String(v))); }); t.append(tr); });
  } catch (e) { const r = el('tr'); r.append(el('td', '', e.message)); t.append(r); }
}

/* ---------- Boot ---------- */
(async function init() {
  S.cfg = await fetch('/api/config').then((r) => r.json());
  const saved = JSON.parse(sessionStorage.getItem('ug') || 'null');
  if (saved) { S.token = saved.token; S.address = saved.address; try { await loadUndeadz(); } catch { signOut(); } }
  renderAll();
})();
