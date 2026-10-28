# Features

Three additions on the existing mention → Cashu quote → LLM reply → `fetch_url` loop. Mock mode (`pnpm dev`) is enough to demo the refunds and the pricing. The proof vault is covered by `pnpm test` and turns on when Cashu is live.

## 1. Encrypted Cashu proof vault

**Idea.** Live proofs survive a process restart, encrypted, without ever being written in mock mode.

**Why it matters.** A restart used to drop every sat the bot had earned. The dashboard, logs, and `/status` still never contain proofs or the key.

**What was built.** `apps/agent/src/payments/proof-vault.ts` seals the proof list with AES-256-GCM. The key is HKDF-SHA256 over `CASHU_PROOF_KEY` (16+ characters), with a random salt stored in the file. Writes go to `path.tmp` and `rename` into place, so a crash mid-write keeps the previous file. A vault that fails authentication is not overwritten. `MOCK_MODE=true` never opens the path. On a live boot the wallet balance is the restored proof total.

**How to demo.**

```bash
pnpm test   # round-trip, wrong key, tamper, mock never creates the file
```

Live (FakeWallet is enough; do not commit the key):

```bash
# .env: MOCK_MODE=false, CASHU_MINT_URL=https://testnut.cashu.space
# CASHU_PROOF_KEY=<16+ chars>, leave NOSTR_NSEC and LLM_API_KEY empty
pnpm agent
```

Pay one admission, then restart `pnpm agent`. `GET /status` → `wallet.balanceSats` is restored and `wallet.proofsPersisted` is `true`. `apps/agent/data/proofs.vault` is binary (`NPB1`…); the proof secret is not in the file. With `MOCK_MODE=true` that file is never created, and the wallet card says proofs stay in memory.

## 2. Refunds when a paid fetch fails

**Idea.** The bot's own tool budget comes back when `fetch_url` does not return a page.

**Why it matters.** The debit used to stick on timeouts, HTTP errors, and private-host refusals. Operators saw a lower balance and no explanation. Live mode now melts proofs only after the GET succeeds, so a failed fetch does not burn ecash. Mock mode debits, then credits the same amount back and records a refund.

**What was built.** `runPaidFetch` in `apps/agent/src/tools/spender.ts`. `/status` `ledger` is earned, spent, refunded, and net (opening balance is not included). The Earnings page shows refunded sats and ledger net. Tool rows say **Refunded**.

**How to demo.** With `pnpm dev` and the dashboard open:

```bash
curl -sS http://127.0.0.1:3847/dev/inbound \
  -H 'content-type: application/json' \
  -d '{"text":"hello"}'
# copy quoteId and senderNpub, then:
curl -sS http://127.0.0.1:3847/dev/mark-paid \
  -H 'content-type: application/json' \
  -d '{"quoteId":"QUOTE_ID"}'
curl -sS http://127.0.0.1:3847/dev/inbound \
  -H 'content-type: application/json' \
  -d '{"text":"fetch http://127.0.0.1/secret","senderNpub":"SENDER_NPUB"}'
curl -sS http://127.0.0.1:3847/status | jq '{balance:.wallet.balanceSats, ledger}'
```

The reply says `Refunded 10 sat`. Balance is back to the post-admission number (231 with the defaults: 210 + 21). `ledger.spentSats` and `ledger.refundedSats` are both 10, so net is just the admission. Earnings → payments shows an Out and a Refund. A public URL that returns a page (`fetch https://example.com`) still keeps the debit.

On the dashboard: Mentions, send `hello`, **Mark paid**, then `fetch http://127.0.0.1/secret` from the same sender.

## 3. Demand pricing and per-user paid rate limit

**Idea.** Admission steps up while quotes are arriving, and one npub cannot run the paid bot unbounded.

**Why it matters.** A flat 21 sat quote does not react to a burst, and the old cooldown only applied to unpaid paywalls. Paid senders could hammer `fetch_url` and drain the wallet.

**What was built.**

- `DemandPricer`: after `PRICE_SURGE_AFTER` new quotes inside `PRICE_SURGE_WINDOW_MS` (defaults 3 and 60s), the next quote is 2× the base, then 3×, capped by `PRICE_MAX_MULTIPLIER`. The price is frozen on the quote. Reusing a pending quote does not reprice. `PRICE_SURGE_AFTER=0` disables it.
- `PaidRateLimit`: `PAID_RATE_LIMIT` paid messages per npub per `PAID_RATE_WINDOW_MS` (defaults 12 and 60s). The reply that mark-paid unlocks does not count. A rejected turn is not charged and does not extend the window. Outcome is `rate-limited`. `PAID_RATE_LIMIT=0` disables it.

Both show on the wallet **Gate** card (`quotedAdmissionSats`, multiplier, paid rate) and on `/status` → `gate`.

**How to demo.** Defaults, four different senders (omit `senderNpub`, or click **new sender** on Mentions between sends):

```bash
for i in 1 2 3 4; do
  curl -sS http://127.0.0.1:3847/dev/inbound \
    -H 'content-type: application/json' \
    -d "{\"text\":\"hello $i\"}"
  echo
done
```

The first three replies say `21 sat`. The fourth says `42 sat` and `Demand pricing: 2× the base 21 sat`. Wallet → Gate → **Next quote** shows the same multiple.

Rate limit, with the cap lowered so it is obvious:

```bash
# restart the agent with PAID_RATE_LIMIT=2
# pay one quote, then send three more chats from that senderNpub
```

The third reply is `rate-limited` and the balance does not move. With the default cap the Gate card already reads `12 / 60s`.
