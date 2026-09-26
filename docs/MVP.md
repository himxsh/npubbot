# MVP

End-to-end loop for NpubBot. Mock path: paywalled mentions, mark-paid, then optional `fetch_url` spend. Live mint quote/receive/melt is behind `CASHU_MINT_URL` when `MOCK_MODE=false`. DM decryption remains a seam.

## Goal

A Nostr user can mention the agent’s npub, pay a small Cashu amount, and receive an LLM reply. If they ask to fetch a URL, the **agent** spends sats from its own wallet to run `fetch_url`, then answers with the result. An operator watches this on localhost.

## Loop (what runs now)

1. **Listen.** Live: kind 1 `#p` mentions. Mock: `POST /dev/inbound`. DMs are logged only. Decrypting them is non-MVP (`TODO(nostr-dm-encryption)`).
2. **Gate.** Unpaid senders get a quote. User text is not sent to the LLM. Extra unpaid mentions from the same pubkey inside `UNPAID_COOLDOWN_MS` are soft-throttled: no second bill, and the original held prompt stays.
3. **Pay.** Mock: `POST /dev/mark-paid`. Live: mint bolt11 quote + poll/`receive` token.
4. **Route.** Paid text with an http(s) URL → `fetch_url` path. Lookup/search/fetch without a URL → ask for a link (no spend). Otherwise paid chat.
5. **Spend.** If routing to the tool: require wallet ≥ `TOOL_SPEND_SATS`. Mock: in-memory debit. Live: melt proofs to a mint-issued bolt11 (self-pay, not reminted) then GET with timeout and feed the result to the LLM.
6. **Broke.** If the agent cannot afford the tool, reply with wallet vs price. Do not fetch.
7. **Reply.** Live: kind-1 to the sender. Mock: sign locally, HTTP/dev returns the text. Publish failures are logged; the loop continues.
8. **Observe.** Dashboard: events, sessions, mark-paid / check mint, inbound inject, tool spend log, relay/mint errors.
9. **Faults.** Relay down, mint/wallet failure, LLM down, tool timeout, insufficient balance → user-facing copy. No crash of the inbox loop.

## Operator checks

1. `pnpm install` and `pnpm typecheck`
2. Unpaid inbound → paywall, no LLM answer
3. Second unpaid (same sender, inside cooldown) → `throttled`
4. Mark-paid → full reply
5. `fetch https://example.com` on the paid session → balance drops, reply includes fetch result
6. Tool spend appears on `/status` and the dashboard
7. `GET /status` has no nsec, API keys, or Cashu proofs

Demo recording: [DEMO.md](DEMO.md). The dashboard polls; operator checks do not need a manual reload.

## Not on the demo path

- Persisting Cashu proofs across restarts (`TODO(cashu-mint)`). Mock sats and a single live process cover the demo.
- Decrypting Nostr DMs (`TODO(nostr-dm-encryption)`). Kind-1 mentions are the paid inbox.
