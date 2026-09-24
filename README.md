# NpubBot

Nostr-native AI agent that gets paid in sats (Cashu).

Bitshala BOSS Battle MVP: listen on Nostr, gate full replies behind a small Cashu/Lightning payment, spend sats from the agent wallet on one tool (`fetch_url`), and watch it on a localhost dashboard.

## Architecture

```
Nostr relays ──► apps/agent inbox
                      │
                      ├─ payment sessions (mock mark-paid / live mint quote+receive)
                      ├─ OpenAI-compatible LLM (skipped unless paid)
                      ├─ one tool: fetch_url (agent spends sats)
                      └─ HTTP  /health  /status  /dev/inbound  /dev/mark-paid
                              ▲
                              │ poll + mock controls
                       apps/web (Vite dashboard)

packages/shared — Zod env schema + status payload types
```

| Package | Role |
| --- | --- |
| `apps/agent` | Inbox, payment gate, LLM, `fetch_url` spend, loopback mock APIs |
| `apps/web` | Dashboard: events, sessions, mark-paid, mock mention, tool spends |
| `packages/shared` | Shared TypeScript types and env schema |

See [docs/TRACKS.md](docs/TRACKS.md), [docs/MVP.md](docs/MVP.md), the recording script in [docs/DEMO.md](docs/DEMO.md), and suggested Devfolio copy in [docs/SUBMIT.md](docs/SUBMIT.md).

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io) 10 (`corepack enable` then `corepack prepare pnpm@10.33.3 --activate`)

## How to run

```bash
pnpm install
cp .env.example .env
pnpm dev
```

| Process | URL |
| --- | --- |
| Agent | http://127.0.0.1:3847/health and `/status` |
| Dashboard | http://127.0.0.1:5173 |

`pnpm typecheck` should pass after install.

### Mock happy path (default)

With `MOCK_MODE=true` (the default in `.env.example`):

1. Open the dashboard (or `POST /dev/inbound` with `{ "text": "hello" }`).
2. The agent replies with a Cashu **quote**, not an LLM answer. Wallet stays at `MOCK_BALANCE_SATS` (default 210).
3. Click **Mark invoice paid** (or `POST /dev/mark-paid` with `{ "quoteId": "…" }`).
4. The held prompt is sent to the (mock) LLM. A full reply is logged. Wallet **credits** `PAYMENT_GATE_SATS` (default 21) → 231.
5. Send a tool request from the **same sender** (`fetch https://example.com`). The agent **debits** `TOOL_SPEND_SATS` (default 10) → 221, GETs the URL, and the reply includes the page text (mock LLM echoes it). Dashboard **Tool spends** lists the debit. Live Cashu melts proofs instead of a mock debit (see below).

A second unpaid mention from the same pubkey within `UNPAID_COOLDOWN_MS` (default 10s) is **throttled** (no extra paywall). Paid traffic is not throttled.

```bash
curl -sS http://127.0.0.1:3847/dev/inbound \
  -H 'content-type: application/json' \
  -d '{"text":"what is npubbot?"}'
# copy quoteId and senderNpub from the JSON, then:
curl -sS http://127.0.0.1:3847/dev/mark-paid \
  -H 'content-type: application/json' \
  -d '{"quoteId":"QUOTE_ID"}'
# paid session: spend sats to fetch (must pass senderNpub)
curl -sS http://127.0.0.1:3847/dev/inbound \
  -H 'content-type: application/json' \
  -d '{"text":"fetch https://example.com","senderNpub":"SENDER_NPUB"}'
```

`/dev/*` is served only when the agent binds loopback (`127.0.0.1`).

Errors (relay down, mint/wallet failure, LLM down, tool timeout, insufficient balance) are **user-facing replies**. The inbox loop logs and continues; it does not take down the process.

### Live Nostr (mentions + kind-1 replies)

Set `MOCK_MODE=false` and `NOSTR_NSEC=nsec1…`. The agent connects to `NOSTR_RELAYS` with `nostr-tools` `SimplePool` and subscribes to:

- kind **1** mentions (`#p` = agent pubkey) — these enter the payment gate
- kind **4** and **1059** (legacy DM / NIP-17 gift wrap) — logged only

Replies are **kind-1** notes with `e` (reply) and `p` (sender) tags. If every relay publish fails, the dashboard still records the outbound note and shows a relay error; the loop keeps running.

**DM tradeoff:** encrypted DMs are not decrypted (`TODO(nostr-dm-encryption)`). Mentions are the paid inbox. Mock Nostr (`MOCK_MODE=true` or no nsec) keeps the HTTP `/dev/inbound` path only.

### Live Cashu mint

`MOCK_MODE=true` **never** talks to a mint, even if `CASHU_MINT_URL` is set.

To flip:

1. `MOCK_MODE=false`
2. `CASHU_MINT_URL=https://testnut.cashu.space` (public FakeWallet test mint — invoices auto-mark paid; other mints need a real Lightning pay)
3. Leave `NOSTR_NSEC` and `LLM_API_KEY` empty to keep mock inbox + mock LLM while testing the mint
4. Restart `pnpm agent`

Live gate:

- **Quote:** `Wallet.createMintQuoteBolt11` → bolt11 in the paywall reply
- **Settle:** poll `checkMintQuoteBolt11` (5s) or dashboard **Check mint payment** → `mintProofsBolt11`
- **Receive:** a `cashuA` / `cashuB` token in a mention is `wallet.receive`'d (never logged)
- **Tool spend:** `createMeltQuoteBolt11` + `meltProofsBolt11`. `fetch_url` is a plain HTTP GET (no invoice), so the agent melts to a **mint-issued bolt11** for `TOOL_SPEND_SATS` and does **not** remint that quote. Sats leave the proof vault (plus Lightning/mint fees). Mock mode still uses an in-memory debit.

Proofs stay in process memory. `/status`, logs, and the dashboard never include nsec, API keys, or proofs.

**TODO(cashu-mint):** persist proofs encrypted at rest across restarts.

If `loadMint` / quote / receive / melt fails, senders get a mint/wallet error string and the agent keeps serving `/health`.

### Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Agent + dashboard in watch mode |
| `pnpm agent` | Agent only |
| `pnpm web` | Dashboard only |
| `pnpm typecheck` | Typecheck all workspaces |
| `pnpm build` | Typecheck agent/shared and production-build the dashboard |

## Environment variables

Copy [`.env.example`](.env.example). **Do not put real nsecs or API keys in git.**

| Variable | Purpose |
| --- | --- |
| `MOCK_MODE` | `true` (default): mock inbox + mock mint + mock LLM |
| `AGENT_HTTP_HOST` / `AGENT_HTTP_PORT` | Loopback status server |
| `NOSTR_RELAYS` | Relays used when Nostr is live |
| `NOSTR_NSEC` | Agent secret (`nsec1…`). Empty → ephemeral mock identity |
| `CASHU_MINT_URL` | Mint URL used only when `MOCK_MODE=false` |
| `PAYMENT_GATE_SATS` | Admission amount before a full reply |
| `TOOL_SPEND_SATS` | What the agent pays from its wallet to run `fetch_url` |
| `TOOL_FETCH_TIMEOUT_MS` | Timeout for `fetch_url` |
| `UNPAID_COOLDOWN_MS` | Soft-throttle extra unpaid paywalls per pubkey (`0` disables) |
| `SESSION_TTL_SECONDS` | Paid session lifetime |
| `QUOTE_TTL_SECONDS` | Unpaid quote lifetime |
| `SESSION_STORE_PATH` | JSON file for sessions (`apps/agent/data/sessions.json`) |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | OpenAI-compatible client; mock if no key |
| `VITE_AGENT_BASE_URL` | Dashboard fetch base (`/agent` via Vite proxy) |

The HTTP API **never** returns the nsec, LLM keys, or Cashu proofs. String fields on `/status` are redacted if they look like those secrets.

## Plug-in points

- `TODO(cashu-mint)` — persist proofs encrypted at rest (`apps/agent/src/payments/cashu.ts`)
- `TODO(nostr-dm-encryption)` — NIP-44 / NIP-17 decrypt so DMs can enter the gate

## License

[MIT](LICENSE)
