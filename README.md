# NpubBot

Nostr-native AI agent that gets paid in sats (Cashu).

Bitshala BOSS Battle MVP: listen on Nostr, gate full replies behind a small Cashu/Lightning payment, spend sats later for one tool, and watch it on a localhost dashboard.

## Architecture

```
Nostr relays ──► apps/agent inbox
                      │
                      ├─ payment sessions (quote → mark-paid / mint TODO)
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

Tracks: **Cypherpunk** (Cashu privacy by default), **Freedom Stack** (Nostr + ecash), **Machine Money** (agent earns and spends sats). See [docs/TRACKS.md](docs/TRACKS.md) and [docs/MVP.md](docs/MVP.md).

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

### Mock happy path

With `MOCK_MODE=true` (default):

1. Open the dashboard (or `POST /dev/inbound` with `{ "text": "hello" }`).
2. The agent replies with a Cashu **quote**, not an LLM answer.
3. Click **Mark invoice paid** (or `POST /dev/mark-paid` with `{ "quoteId": "…" }`).
4. The held prompt is sent to the (mock) LLM and a full reply is logged.
5. Send a tool request (`fetch https://example.com`). The agent debits `TOOL_SPEND_SATS`, fetches the URL, and the reply includes the tool result.

```bash
curl -sS http://127.0.0.1:3847/dev/inbound \
  -H 'content-type: application/json' \
  -d '{"text":"what is npubbot?"}'
# copy quoteId from the paywall reply, then:
curl -sS http://127.0.0.1:3847/dev/mark-paid \
  -H 'content-type: application/json' \
  -d '{"quoteId":"QUOTE_ID"}'
# paid session: spend sats to fetch
curl -sS http://127.0.0.1:3847/dev/inbound \
  -H 'content-type: application/json' \
  -d '{"text":"fetch https://example.com","senderNpub":"SENDER_NPUB"}'
```

`/dev/*` is served only when the agent binds loopback (`127.0.0.1`).

### Live Nostr (mentions)

Set `MOCK_MODE=false` and `NOSTR_NSEC=nsec1…`. The agent connects to `NOSTR_RELAYS` with `nostr-tools` `SimplePool` and subscribes to:

- kind **1** mentions (`#p` = agent pubkey) — these enter the payment gate
- kind **4** and **1059** (legacy DM / NIP-17 gift wrap) — logged only

**DM tradeoff:** encrypted DMs are not decrypted this slice (`TODO(nostr-dm-encryption)`). Mentions are the paid inbox. Replies are kind-1 notes tagged to the sender.

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
| `MOCK_MODE` | `true` (default): mock inbox + mock mint + mock LLM unless keys are present |
| `AGENT_HTTP_HOST` / `AGENT_HTTP_PORT` | Loopback status server |
| `NOSTR_RELAYS` | Relays used when Nostr is live |
| `NOSTR_NSEC` | Agent secret (`nsec1…`). Empty → ephemeral mock identity |
| `CASHU_MINT_URL` | Mint URL. **TODO(cashu-mint)** still falls back to mock quotes |
| `PAYMENT_GATE_SATS` | Admission amount before a full reply |
| `TOOL_SPEND_SATS` | What the agent pays from its wallet to run `fetch_url` |
| `TOOL_FETCH_TIMEOUT_MS` | Timeout for `fetch_url` |
| `SESSION_TTL_SECONDS` | Paid session lifetime |
| `QUOTE_TTL_SECONDS` | Unpaid quote lifetime |
| `SESSION_STORE_PATH` | JSON file for sessions (`apps/agent/data/sessions.json`) |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | OpenAI-compatible client; mock if no key |
| `VITE_AGENT_BASE_URL` | Dashboard fetch base (`/agent` via Vite proxy) |

The HTTP API **never** returns the nsec or Cashu proofs.

## Plug-in points

- `TODO(cashu-mint)` — `createMintQuoteBolt11`, receive tokens, melt for tool spend
- `TODO(nostr-dm-encryption)` — NIP-44 / NIP-17 decrypt so DMs can enter the gate

## License

[MIT](LICENSE)
