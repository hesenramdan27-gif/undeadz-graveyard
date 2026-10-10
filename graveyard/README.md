# THE UNDEADZ — GRAVEYARD V1

```bash
npm install
npm test                      # 14 end-to-end checks on a mock chain (no RPC needed)
MOCK_CHAIN=1 npm start        # try the UI locally with fake ownership (MOCK_OWNERS='{"0xYourAddr":[1,2,3]}')
SESSION_SECRET=$(openssl rand -hex 32) npm start     # production: real Robinhood Chain reads
```

Environment: `PORT` (3000), `SESSION_SECRET` (required in prod), `ADMIN_KEY` (enables `/api/admin/config`), `DATA_DIR`.

Tune the game live (no rebuild):
```bash
curl -X POST $HOST/api/admin/config -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"xp":{"win":120},"enemy":{"difficultyMax":1.05}}'
```
Set the contract/RPC in `server/config/game.config.json` (`collection.nftContract`, `chain.rpcUrl`).
See ARCHITECTURE.md for the on-chain/off-chain split and open decisions.

## Check what the game sees for a real wallet
```bash
npm run check -- 0xHolderWalletAddress
```
Prints: RPC reachable?, which source answered (indexer = Blockscout, rpc = contract), each token's real image/traits/stats, and the on-chain owner check.
Holdings come from the Blockscout API (`chain.indexerApi` in the config; override with `INDEXER_URL`), falling back to reading the contract directly.
