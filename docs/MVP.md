# MVP

End-to-end loop for NpubBot. Mock path: paywalled mentions, mark-paid, then optional `fetch_url` spend. Cashu mint settlement and DM decryption remain seams.

## Goal

A Nostr user can mention the agent’s npub, pay a small Cashu amount, and receive an LLM reply. If they ask to fetch a URL, the **agent** spends sats from its own wallet to run `fetch_url`, then answers with the result. An operator watches this on localhost.

## Loop (what runs now)

1. **Listen.** Live: kind 1 `#p` mentions. Mock: `POST /dev/inbound`. DMs logged only (`TODO(nostr-dm-encryption)`).
2. **Gate.** Unpaid senders get a quote. User text is not sent to the LLM.
3. **Pay.** `POST /dev/mark-paid` (mock). Sessions in `data/sessions.json`.
4. **Route.** Paid text with an http(s) URL → `fetch_url` path. Lookup/search/fetch without a URL → ask for a link (no spend). Otherwise paid chat.
5. **Spend.** If routing to the tool: require wallet ≥ `TOOL_SPEND_SATS`, debit (mock; `TODO(cashu-mint)` melt), GET with timeout, feed result to the LLM.
6. **Broke.** If the agent cannot afford the tool, reply with wallet vs price. Do not fetch.
7. **Reply.** Kind-1 (or mock outbound) to the sender.
8. **Observe.** Dashboard: events, sessions, mark-paid, inbound inject, tool spend log.

## Operator checks

1. `pnpm install` and `pnpm typecheck`
2. Unpaid inbound → paywall, no LLM answer
3. Mark-paid → full reply
4. `fetch https://example.com` on the paid session → balance drops, reply includes fetch result
5. Tool spend appears on `/status` and the dashboard
