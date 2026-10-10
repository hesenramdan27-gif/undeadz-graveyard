// Metadata adapter. Today: contract.tokenURI -> JSON (ipfs/http/data URIs).
// To use another source (OpenSea API, your own API), change only getRaw().
import { getConfig } from './config.mjs';
import { tokenUri, isMock } from './chain.mjs';

const cache = new Map(); // tokenId -> { meta, at }

function resolveUrl(u) {
  if (!u) return null;
  const { ipfsGateway } = getConfig().metadata;
  if (u.startsWith('ipfs://')) return ipfsGateway + u.slice(7).replace(/^ipfs\//, '');
  return u;
}

async function getRaw(tokenId) {
  if (isMock()) {
    const pool = ['Bee', 'Demon Eyes', 'Skull', 'Armor', 'Fast Boots', 'Top Hat', 'Moss', 'Green Skin', 'Gold Tooth'];
    const pick = (n) => pool[(tokenId * 7 + n * 3) % pool.length];
    return { name: `THE UNDEADZ #${tokenId}`, image: null, attributes: [
      { trait_type: 'Eyes', value: pick(1) }, { trait_type: 'Head', value: pick(2) }, { trait_type: 'Body', value: pick(3) } ] };
  }
  const uri = await tokenUri(tokenId);
  if (uri.startsWith('data:')) {
    const [head, body] = uri.split(/,(.*)/s);
    return JSON.parse(head.includes('base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body));
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), getConfig().metadata.fetchTimeoutMs);
  try {
    const res = await fetch(resolveUrl(uri), { signal: ctl.signal });
    if (!res.ok) throw new Error(`metadata HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export async function getMetadata(tokenId) {
  const ttl = getConfig().metadata.cacheHours * 3600_000;
  const hit = cache.get(tokenId);
  if (hit && Date.now() - hit.at < (hit.meta.source === 'fallback' ? 60_000 : ttl)) return hit.meta;
  let meta;
  try {
    const raw = await getRaw(tokenId);
    meta = {
      source: 'metadata',
      name: raw.name || `THE UNDEADZ #${tokenId}`,
      image: resolveUrl(raw.image || raw.image_url),
      traits: (raw.attributes || raw.traits || []).map((a) => ({ traitType: String(a.trait_type ?? a.traitType ?? ''), value: String(a.value ?? '') })),
    };
  } catch {
    meta = { source: 'fallback', name: `THE UNDEADZ #${tokenId}`, image: null, traits: [] };
  }
  cache.set(tokenId, { meta, at: Date.now() });
  return meta;
}
