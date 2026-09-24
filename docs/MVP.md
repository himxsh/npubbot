# MVP

End-to-end shape of the NpubBot MVP. This pass implements **structure and stubs only** — the steps below are the target loop, not what `pnpm dev` does today.

## Goal

A Nostr user can mention or DM the agent’s npub, pay a small Cashu (or Lightning-via-mint) amount, and receive an LLM reply. The agent can spend a little of its own balance to call one tool. An operator can watch balance, payments, and recent events on localhost.

## Actors

- **User** — any Nostr client, paying with Cashu/Lightning
- **Agent** — `apps/agent`, keyed by `NOSTR_NSEC`
- **Mint** — Cashu mint at `CASHU_MINT_URL`
- **LLM** — OpenAI-compatible HTTP API
- **Operator** — `apps/web` on loopback

## Target loop

1. **Listen.** Agent connects to `NOSTR_RELAYS` as its npub and subscribes to mentions and DMs.
2. **Decrypt DMs.** Inbound gift-wraps / kind-4 events are decrypted.
   - Plug-in: `TODO(nostr-dm-encryption)` (NIP-44 preferred).
3. **Gate.** Before a full reply, require `PAYMENT_GATE_SATS`.
   - Unpaid: reply with a compact invoice / Cashu request, not the LLM answer.
   - Paid: mark the payment on the in-memory ledger (later: persist proofs).
4. **Think.** Call the LLM interface with the user’s text (and any tool result).
5. **Optional spend.** If the prompt needs the one registered tool, the agent melts/pays `TOOL_SPEND_SATS` from its own wallet, then calls the tool.
   - Plug-in: `TODO(cashu-mint)` in the spender + wallet.
6. **Reply.** Publish the answer back to Nostr (public reply or encrypted DM).
7. **Observe.** Operator dashboard polls `GET /status` for identity, mock flags, balance, payments, and recent events.

## Out of scope for the scaffold

- Real mint quotes, melts, and proof storage
- Real relay subscribe/publish
- Real LLM completions
- Encrypted DM round-trips
- Persistence across process restarts
- Authentication on the status API (loopback-only is the MVP assumption)

## Scaffold stand-ins

| Step | Stub behavior (`MOCK_MODE=true`) |
| --- | --- |
| Listen | Seed a couple of fake events; do not open WebSockets |
| Decrypt | Not called; marker left in `nostr/encryption.ts` |
| Gate | Pure function over sat amounts; mock “paid” rows in the store |
| LLM | Returns a canned string from `llm/client.ts` |
| Spend | Debits the in-memory mock balance |
| Reply | Logged, not published |
| Observe | `GET /health` and `GET /status` on the loopback HTTP server |

## Operator checks (this pass)

1. `pnpm install` and `pnpm typecheck`
2. `pnpm agent` → `GET http://127.0.0.1:3847/health` and `/status`
3. `pnpm web` → dashboard shows placeholder status (or “agent offline” then recovers)
