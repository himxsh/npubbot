# Tracks

NpubBot is shaped so implementation can speak to these BOSS Battle tracks. Nothing here is a timeline — it is product intent.

## Cypherpunk — Cashu privacy by default

- The agent’s default money path is **ecash**, not a custodial account or KYC API.
- Admission tokens and the agent’s own proofs live in an in-memory vault, not in the dashboard payload.
- Logs, `/status`, and the dashboard redact nsecs, API keys, and Cashu tokens/proofs.
- A real mint is a single config URL (`CASHU_MINT_URL`) so the operator can pick a mint they trust. `MOCK_MODE=true` never contacts it.

Live quote + receive is wired with `@cashu/cashu-ts` when `MOCK_MODE=false` and `CASHU_MINT_URL` is set. **TODO(cashu-mint):** encrypted proof persistence and Lightning melt for tool spend.

## Freedom Stack — Nostr + ecash

- Identity is an **npub**; transport is relays, not a product-specific chat server.
- Value is **Cashu** (with Lightning as the on/off ramp the mint already speaks).
- The localhost dashboard is an operator surface only. Users talk to the bot on Nostr.
- Live outbound replies are kind-1 notes tagged to the sender. Mock mode keeps `/dev/inbound`.

`TODO(nostr-dm-encryption)` is the plug-in point for private inbound messages (NIP-44 preferred, NIP-04 legacy).

## Machine Money — the agent earns and spends sats

- **Earn:** a small payment unlocks a full LLM reply (payment gate / paid session).
- **Spend:** if the user asks to fetch/lookup/search a URL, the agent debits `TOOL_SPEND_SATS` from its own wallet and runs **one** tool: `fetch_url` (timeout, public http(s) only).
- Insufficient balance returns a clear “can’t afford fetch_url” reply — no silent skip.
- Both admission (in) and tool spend (out) show on `/status` and the dashboard.

### Tool-spend demo

1. Pay admission (`POST /dev/mark-paid` or the dashboard control).
2. Send `fetch https://example.com` (same sender).
3. Wallet balance drops by `TOOL_SPEND_SATS`.
4. The Nostr/mock reply includes the fetched page text (via the LLM, or the mock LLM echo).
5. Dashboard **Tool spends** lists the debit.

Real mint melt for that debit remains `TODO(cashu-mint)` in `apps/agent/src/tools/spender.ts`.

Devfolio field mapping: [DEMO.md](DEMO.md).
