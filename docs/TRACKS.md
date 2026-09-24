# Tracks

NpubBot is shaped so a later implementation pass can speak to these BOSS Battle tracks. Nothing here is a timeline — it is product intent for how the scaffold is laid out.

## Cypherpunk — Cashu privacy by default

- The agent’s default money path is **ecash**, not a custodial account or KYC API.
- Admission tokens and the agent’s own proofs live in wallet state, not in the dashboard payload.
- Logs and `/status` should never print tokens, secrets, or nsecs (the stub API already omits them).
- A real mint is a single config URL (`CASHU_MINT_URL`) so the operator can pick a mint they trust.

`TODO(cashu-mint)` in `apps/agent` is the plug-in point.

## Freedom Stack — Nostr + ecash

- Identity is an **npub**; transport is relays, not a product-specific chat server.
- Value is **Cashu** (with Lightning as the on/off ramp the mint already speaks).
- The localhost dashboard is an operator surface only. Users talk to the bot on Nostr.

`TODO(nostr-dm-encryption)` is the plug-in point for private inbound messages (NIP-44 preferred, NIP-04 legacy).

## Machine Money — the agent earns and spends sats

- **Earn:** a small payment unlocks a full LLM reply (payment gate).
- **Spend:** the agent may melt/pay sats from its own wallet to call **one** tool.
- Both sides show up on `/status` so the dashboard can prove the machine is a market participant, not a wrapper around a free API key.

Stubs for this are `apps/agent/src/payments/gate.ts` and `apps/agent/src/tools/spender.ts`.
