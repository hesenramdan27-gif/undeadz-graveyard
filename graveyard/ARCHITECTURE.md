# THE UNDEADZ — GRAVEYARD V1: Architecture (for team approval)

**Nothing in V1 is deployed on-chain. No contract is created, no transaction is sent, no key is held.**

## 1. On-chain vs off-chain

| Piece | Where | Notes |
|---|---|---|
| NFT ownership (`ownerOf`, `balanceOf`, `tokenOfOwnerByIndex`) | **On-chain, read-only** | Server reads the existing ERC-721 `0xc180…042d` on Robinhood Chain (4663). Re-checked at every battle. |
| Token URI / traits / image | **On-chain pointer → off-chain JSON** | `tokenURI()` is read from chain; the JSON/image come from IPFS/HTTP. Cached 24h. |
| Wallet login | **Off-chain signature** | Wallet signs a plain-text nonce message. Free, no gas, no approval, no funds access. |
| XP, level, wins, losses, battle history | **Off-chain (game server)** | Never trusted from the browser. |
| Battle result | **Off-chain (server)** | Seeded deterministic sim; seed stored so any fight can be replayed. |
| Leaderboards | **Off-chain (server)** | Computed from server records. Addresses shortened. |
| Balance config | **Off-chain (JSON / admin endpoint)** | No rebuild needed. |
| Rewards, ETH prizes, evolution, NFT minting | **Not in V1** | Phase 4, only after gameplay is proven and this doc is re-approved. |

## 2. Flow

```
Browser ──(1) POST /api/auth/nonce {address}──────────▶ Server
        ◀─(2) message to sign ─────────────────────────
Wallet signs (personal_sign, free)
        ──(3) POST /api/auth/verify {address, signature}▶ recover signer, single-use nonce
        ◀─(4) 12h HMAC session token
        ──(5) GET /api/me/undeadz ─────────────────────▶ chain: balanceOf/tokenOfOwnerByIndex
                                                          metadata: tokenURI → JSON → traits → stats
        ──(6) POST /api/battle {tokenId} ───────────────▶ chain: ownerOf(tokenId) == session wallet ?
                                                          cooldown + daily-XP cap → simulate(seed)
                                                          write XP/wins → return log + result
Browser replays the log as an animation (≈10–15 s). It cannot alter any outcome.
```

## 3. Security (what the server never trusts)
- Browser-supplied XP / wins / rank / ownership: **ignored**. Only `tokenId` is sent, then verified against the chain for the signed-in wallet.
- Login: single-use 5-minute nonce, recovered signer must equal the claimed address, session token is HMAC-signed (`SESSION_SECRET`).
- Abuse limits: per-token battle cooldown (6s), daily XP cap per token (60 fights), per-IP rate limit, 20 KB body limit, strict CSP.
- Untrusted metadata is rendered with `textContent`; images must be `https`.
- Private keys / seed phrases: never requested, stored or logged. The server has no signing code.

## 4. Modules (where to add things later)
```
server/config/game.config.json   all balance: stats, trait rules, battle formula, XP, levels, limits
server/src/stats.mjs             trait → stat mapping, rarity, budget cap, level bonus
server/src/battle.mjs            formula + enemy generation (PvE). PvP = same simulate() with two real fighters
server/src/abilities.mjs         SWARM / CRITICAL_VISION / DEATH_STRIKE hooks (off until config.abilities.enabled)
server/src/metadata.mjs          metadata adapter — swap the data source in getRaw() only
server/src/store.mjs             JSON file store — replace with SQLite/Postgres without touching game logic
server/src/chain.mjs             all RPC reads (ERC721Enumerable, with ownerOf-scan fallback)
```
Phase 2 PvP, missions, tournaments plug into `game.mjs` (the only module that writes XP).

## 5. Balance (current config, simulated 3,000 fights each)
- Baseline NFT (all 50s): **~51% win**, ~6 rounds.
- Strongly-specialised NFT (+40 total stat points): **~79% win**.
- `budgetCap` limits total bonus points so rarity gives specialisation, not an automatic win. Tune `stats.budgetCap`, `enemy.scaleToPlayer`, `enemy.difficulty*`.

## 6. Decisions needed from the team
1. **Real trait names.** `traitRules` uses the brief's examples (Bee, Demon Eyes, Skull, Armor, Speed). Unmapped traits get a small deterministic nudge so every NFT still differs. Send the real trait list to map properly.
2. **Rarity source.** Optional `data/rarity.json` (`{"1842":0.93}`) — otherwise rarity adds nothing.
3. **Hosting + database** (JSON file is fine for launch, not for scale) and where to mount it in the existing site (`🎮 GAME` nav → this app, or reverse-proxy `/game`).
4. **Wallet reuse.** The frontend uses standard EIP-1193 / EIP-6963 (MetaMask, Rabby, Zerion, Coinbase, injected). To skip a second connect, the main site calls `window.UndeadzGame.attachProvider(provider)`.
5. **Approve before Phase 4** (any on-chain rewards/evolution).
