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
  } catch {
    return null; // token does not exist
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

export async function tokenUri(tokenId) {
  return nft().tokenURI(tokenId);
}
export const isMock = () => MOCK;
