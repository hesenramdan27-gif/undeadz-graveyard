// Diagnose what the game can see for a wallet:  npm run check -- 0xYourWallet
import { ethers } from 'ethers';
import { getConfig } from '../server/src/config.mjs';
import { holdings, ownerOf } from '../server/src/chain.mjs';
import { getMetadata, seedMetadata } from '../server/src/metadata.mjs';
import { baseStats } from '../server/src/stats.mjs';

const address = process.argv[2];
if (!ethers.utils.isAddress(address || '')) { console.error('Usage: npm run check -- 0xWalletAddress'); process.exit(1); }
const { chain, collection } = getConfig();
console.log(`Chain: ${chain.name} (${chain.chainId})  RPC: ${chain.rpcUrl}\nContract: ${collection.nftContract}\nWallet: ${address}\n`);

try {
  const net = await new ethers.providers.JsonRpcProvider(chain.rpcUrl).getNetwork();
  console.log(`RPC reachable, chainId = ${net.chainId} ${net.chainId === chain.chainId ? '(matches)' : '(MISMATCH!)'}`);
} catch (e) { console.log('RPC NOT reachable:', e.message); }

try {
  const h = await holdings(address);
  console.log(`\nHoldings source: ${h.source}  ->  ${h.items.length} Undeadz`);
  for (const it of h.items.slice(0, 10)) {
    seedMetadata(it.tokenId, it.meta);
    const m = await getMetadata(it.tokenId);
    const owner = await ownerOf(it.tokenId).catch((e) => `(ownerOf failed: ${e.message})`);
    console.log(`\n#${it.tokenId}  ${m.name}  [metadata: ${m.source}]`);
    console.log('  image :', m.image || '(none)');
    console.log('  traits:', m.traits.map((t) => `${t.traitType}=${t.value}`).join(', ') || '(none)');
    console.log('  stats :', JSON.stringify(baseStats(it.tokenId, m.traits)));
    console.log('  on-chain owner:', owner, String(owner).toLowerCase() === address.toLowerCase() ? '✓ matches' : '✗');
  }
} catch (e) { console.log('\nFAILED:', e.message); }
