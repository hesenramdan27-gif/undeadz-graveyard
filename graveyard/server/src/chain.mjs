// ON-CHAIN READS ONLY. This server never signs or sends a transaction and never holds a key.
import { ethers } from 'ethers';
import { getConfig } from './config.mjs';

const ABI = [
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function tokenURI(uint256) view returns (string)',
];

const MOCK = process.env.MOCK_CHAIN === '1';
let mockOwners = {};
export const setMockOwners = (map) => { mockOwners = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v.map(Number)])); };
if (MOCK && process.env.MOCK_OWNERS) setMockOwners(JSON.parse(process.env.MOCK_OWNERS));

let contract;
function nft() {
  if (contract) return contract;
  const { chain, collection } = getConfig();
  const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl, { chainId: chain.chainId, name: 'robinhood' });
  contract = new ethers.Contract(collection.nftContract, ABI, provider);
  return contract;
}

const ownerCache = new Map(); // tokenId -> { owner, at }
export async function ownerOf(tokenId, maxAgeSec = 0) {
  if (MOCK) {
    for (const [addr, ids] of Object.entries(mockOwners)) if (ids.includes(Number(tokenId))) return addr;
    return null;
  }
  const hit = ownerCache.get(tokenId);
  if (hit && Date.now() - hit.at < maxAgeSec * 1000) return hit.owner;
  try {
    const owner = (await nft().ownerOf(tokenId)).toLowerCase();
    ownerCache.set(tokenId, { owner, at: Date.now() });
    return owner;
  } catch (e) {
    if (e.code === 'CALL_EXCEPTION') return null; // token does not exist
    throw new Error('Could not reach Robinhood Chain right now. Please try again in a moment.');
  }
}

export async function ownsToken(address, tokenId) {
  const { collection, limits } = getConfig();
  const id = Number(tokenId);
  if (!Number.isInteger(id) || id < collection.firstTokenId || id >= collection.firstTokenId + collection.maxSupply) return false;
  return (await ownerOf(id, limits.ownershipCacheSec)) === address.toLowerCase();
}

// Finds token IDs for a wallet. Tries ERC721Enumerable first; if the contract does not
// implement it, scans ownerOf() across the supply (batched, cached for 60s).
let scanCache = { at: 0, map: null };
export async function tokensOf(address) {
  const addr = address.toLowerCase();
  const { collection, metadata } = getConfig();
  if (MOCK) return (mockOwners[addr] || []).slice(0, metadata.maxTokensShown);
  const c = nft();
  const balance = (await c.balanceOf(address)).toNumber();
  if (balance === 0) return [];
  try {
    const n = Math.min(balance, metadata.maxTokensShown);
    const ids = await Promise.all(Array.from({ length: n }, (_, i) => c.tokenOfOwnerByIndex(address, i)));
    return ids.map((b) => b.toNumber()).sort((a, b) => a - b);
  } catch {
    if (!scanCache.map || Date.now() - scanCache.at > 60_000) {
      const map = new Map();
      const start = collection.firstTokenId;
      for (let i = 0; i < collection.maxSupply; i += 50) {
        const batch = Array.from({ length: Math.min(50, collection.maxSupply - i) }, (_, k) => start + i + k);
        const owners = await Promise.all(batch.map((id) => c.ownerOf(id).then((o) => o.toLowerCase()).catch(() => null)));
        batch.forEach((id, k) => { if (owners[k]) { (map.get(owners[k]) || map.set(owners[k], []).get(owners[k])).push(id); } });
      }
      scanCache = { at: Date.now(), map };
    }
    return (scanCache.map.get(addr) || []).slice(0, metadata.maxTokensShown);
  }
}

// Blockscout API v2 lists every NFT a wallet holds, with image + attributes already resolved.
const indexerBase = () => process.env.INDEXER_URL || getConfig().chain.indexerApi || '';
const addrOf = (t) => String(t?.address_hash || (typeof t?.address === 'object' ? t.address?.hash : t?.address) || '').toLowerCase();

async function fromIndexer(address) {
  const base = indexerBase();
  if (!base) return null;
  const { collection, metadata } = getConfig();
  const contract = collection.nftContract.toLowerCase();
  const out = [];
  let params = '';
  for (let page = 0; page < 10; page++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(`${base}/addresses/${address}/nft?type=ERC-721${params}`, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
      const data = await res.json();
      for (const it of data.items || []) {
        if (addrOf(it.token) !== contract) continue; // only THE UNDEADZ, not other collections
        const md = it.metadata || {};
        out.push({ tokenId: Number(it.id), meta: { name: md.name, image: it.image_url || md.image || md.image_url, attributes: md.attributes } });
      }
      if (!data.next_page_params) break;
      params = '&' + new URLSearchParams(data.next_page_params).toString();
    } finally { clearTimeout(timer); }
  }
  return out.filter((x) => Number.isInteger(x.tokenId)).sort((a, b) => a.tokenId - b.tokenId).slice(0, metadata.maxTokensShown);
}

// What does this wallet hold? Returns { source, items:[{tokenId, meta?}] }.
export async function holdings(address) {
  if (MOCK) return { source: 'mock', items: (await tokensOf(address)).map((tokenId) => ({ tokenId })) };
  let indexerError = null;
  try {
    const items = await fromIndexer(address);
    if (items && items.length) return { source: 'indexer', items };
  } catch (e) { indexerError = e.message; }
  try {
    return { source: 'rpc', items: (await tokensOf(address)).map((tokenId) => ({ tokenId })) };
  } catch (e) {
    throw new Error(`Could not read your wallet's Undeadz${indexerError ? ` (${indexerError})` : ''}. ${e.message}`);
  }
}

export async function tokenUri(tokenId) {
  return nft().tokenURI(tokenId);
}
export const isMock = () => MOCK;
