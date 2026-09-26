# Demo pack

Operator script for the Bitshala BOSS Battle / Devfolio recording. Default path is **mock** (`MOCK_MODE=true`). Nothing here spends mainnet sats.

## Setup (once)

```bash
pnpm install
cp .env.example .env
# leave MOCK_MODE=true
pnpm typecheck
pnpm dev
```

| Surface | URL |
| --- | --- |
| Agent health | http://127.0.0.1:3847/health |
| Agent status | http://127.0.0.1:3847/status |
| Dashboard | http://127.0.0.1:5173 |

Confirm `/health` shows `mock.nostr`, `mock.cashu`, and `mock.llm` all `true`.

## Script — unpaid → pay → reply → fetch_url spend

Leave the dashboard open. It polls `/status` about every 1.5s, so the wallet, sessions, latest reply, and tool spends change on screen without a reload. The live dot and “polled … ago” line keep moving between events.

Reuse one sender (`senderNpub`) after the first inbound so the paid session sticks. Preset buttons (**Unpaid question**, **Paid chat**, **fetch_url**) send as that sender.

### 1. Unpaid mention (must not call the LLM)

Dashboard: **Send mock mention** with `what is npubbot?`

or:

```bash
curl -sS http://127.0.0.1:3847/dev/inbound \
  -H 'content-type: application/json' \
  -d '{"text":"what is npubbot?"}'
```

**Expect:** `outcome` is `paywall`. Reply lists a quote id and `cashu:mock:…`. The reply is **not** `[mock llm] …`. Wallet is still the opening mock balance (`MOCK_BALANCE_SATS`, default 210).

Screenshot caption 1: *Dashboard after an unpaid mention — session pending, quote in Recent Nostr events, wallet unchanged.*

### 2. Unpaid spam (cooldown)

Send the same sender a second mention immediately.

**Expect:** `outcome` is `throttled`, `reply` is `null`. The original prompt stays held; the extra mention does not replace it or send a second paywall.

### 3. Pay (mock mint)

Dashboard: **Mark invoice paid**

or:

```bash
curl -sS http://127.0.0.1:3847/dev/mark-paid \
  -H 'content-type: application/json' \
  -d '{"quoteId":"QUOTE_ID"}'
```

**Expect:** session `paid`. A full reply is logged (`[mock llm] what is npubbot?`). Wallet **credits** admission (`PAYMENT_GATE_SATS`, default 21) → 231 with defaults.

Screenshot caption 2: *After Mark invoice paid — session paid, LLM reply in Recent Nostr events, wallet up by admission sats.*

### 4. Paid chat (no extra spend)

Same sender, text without a URL and without fetch/lookup/search:

```bash
curl -sS http://127.0.0.1:3847/dev/inbound \
  -H 'content-type: application/json' \
  -d '{"text":"say hi in five words","senderNpub":"SENDER_NPUB"}'
```

**Expect:** `outcome` is `full`. Wallet unchanged.

### 5. Tool spend (`fetch_url`)

```bash
curl -sS http://127.0.0.1:3847/dev/inbound \
  -H 'content-type: application/json' \
  -d '{"text":"fetch https://example.com","senderNpub":"SENDER_NPUB"}'
```

**Expect:** `outcome` is `tool`. Wallet **debits** `TOOL_SPEND_SATS` (default 10) → 221 with defaults. Reply includes fetched page text (Example Domain via the mock LLM echo). Dashboard **Tool spends** shows an `ok` row.

Screenshot caption 3: *fetch_url spend — Tool spends lists a 10 sat debit, wallet down, reply cites example.com.*

### 6. Insufficient tool balance (optional)

Repeat `fetch https://example.com` until the wallet is below `TOOL_SPEND_SATS`.

**Expect:** `outcome` is `tool-unaffordable`. Clear “can't afford fetch_url” reply. No HTTP GET.

### 7. Secrets check

```bash
curl -sS http://127.0.0.1:3847/status | python3 -c '
import json,sys,re
raw=sys.stdin.read()
blob=json.loads(raw)
text=json.dumps(blob)
needles=["nsec1","sk-","cashuA","cashuB","BEGIN "]
hits=[n for n in needles if n.lower() in text.lower()]
print("status keys", sorted(blob.keys()))
print("secret hits", hits or "none")
'
```

**Expect:** no `nsec`, API keys, or Cashu proofs/tokens. Pending Lightning invoices (live) and `cashu:mock:…` URIs are payment requests, not proofs.

## Live mint (optional, not the default demo)

`testnut.cashu.space` is a public **FakeWallet** mint: invoices flip to paid after about a second, so you can exercise `createMintQuoteBolt11` / `mintProofsBolt11` / `receive` without real Lightning. The agent polls every 5s, or use **Check mint payment** on the dashboard.

```bash
# MOCK_MODE=false is required — mock mode never contacts the mint
MOCK_MODE=false
CASHU_MINT_URL=https://testnut.cashu.space
# omit NOSTR_NSEC to keep the HTTP/dev inbox
# omit LLM_API_KEY to keep the mock LLM
```

Restart `pnpm agent`. Unpaid inbound returns a **bolt11** invoice. The agent polls the mint every 5s (or click **Check mint payment**). Proofs stay in memory and never appear on `/status`. After a paid session, `fetch https://example.com` **melts** `TOOL_SPEND_SATS` to a mint-issued invoice (self-pay; not reminted) so sats leave the wallet. Fees may take an extra sat or two.

If the mint is down, the sender gets a mint-unreachable message; the agent loop keeps running.

Exact flip steps: [README](../README.md#live-cashu-mint).

Not on this demo path (non-MVP): persisting Cashu proofs across restarts (`TODO(cashu-mint)`), and decrypting Nostr DMs (`TODO(nostr-dm-encryption)`). Kind-1 mentions are the paid inbox. One agent process is enough for the mock demo and for a single live mint session.

## Live Nostr replies

With `MOCK_MODE=false` and `NOSTR_NSEC=nsec1…`, mentions on `NOSTR_RELAYS` get kind-1 replies tagged `e`/`p` toward the sender. Mock Nostr still uses `/dev/inbound` only.

## Devfolio submission checklist

### Fields

| Field | What to put |
| --- | --- |
| **Project title** | NpubBot |
| **Tagline** | Nostr-native AI agent that gets paid in sats (Cashu) |
| **Description** | Listens for Nostr mentions, gates the LLM behind a small Cashu/Lightning admission, spends sats from its own wallet (mock debit or live Cashu melt) to run one tool (`fetch_url`), operator dashboard on localhost. |
| **Demo video** | Follow the script above: unpaid paywall → mark-paid LLM reply → `fetch https://example.com` debit. 2–3 minutes. |
| **GitHub** | This repo (include README + `docs/DEMO.md`) |
| **Website / demo** | Localhost URLs in the README; optional public npub if you ran live relays |
| **Built with** | Nostr, Cashu, Lightning, TypeScript, Node.js, nostr-tools, cashu-ts, Vite/React |
| **Cover / screenshots** | Use the three captions above if the VM has no PNG exports |

### Track mapping

- **Cypherpunk** — default money path is ecash; proofs and nsec never hit logs/`/status`/dashboard; operator picks `CASHU_MINT_URL`.
- **Freedom Stack** — identity is an npub; transport is relays; value is Cashu (Lightning as the mint's on/off ramp); dashboard is operator-only.
- **Machine Money** — agent **earns** admission sats to unlock LLM replies and **spends** `TOOL_SPEND_SATS` from its own wallet to fetch a URL; insufficient balance is a spoken refusal, not a silent skip.

See [TRACKS.md](TRACKS.md), [MVP.md](MVP.md), and paste-ready Devfolio copy in [SUBMIT.md](SUBMIT.md).
