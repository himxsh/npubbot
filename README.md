# NpubBot

Nostr-native AI agent that gets paid in sats (Cashu).

This repository is the Bitshala BOSS Battle MVP scaffold: a listener identity on Nostr, a small Cashu/Lightning admission gate, one tool the agent can pay for, and a localhost dashboard. **This pass is stubs only** — mock mode boots without mint, relay, or LLM keys.

## Architecture

```
Nostr relays ──► apps/agent (listener stub)
                      │
                      ├─ payment gate stub (Cashu / Lightning)
                      ├─ LLM interface stub
                      ├─ tool spender stub (agent pays sats)
                      └─ HTTP  /health  /status
                              ▲
                              │ poll
                       apps/web (Vite dashboard)

packages/shared — Zod env schema + status payload types
```

| Package | Role |
| --- | --- |
| `apps/agent` | Loopback status API plus Nostr / Cashu / LLM / tool stubs |
| `apps/web` | Minimal dashboard that polls the agent |
| `packages/shared` | Shared TypeScript types and env schema |

Tracks this shape is meant to support: **Cypherpunk** (Cashu privacy by default), **Freedom Stack** (Nostr + ecash), **Machine Money** (agent earns and spends sats). See [docs/TRACKS.md](docs/TRACKS.md) and [docs/MVP.md](docs/MVP.md).

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io) 10 (`corepack enable` then `corepack prepare pnpm@10.33.3 --activate`)

## How to run (stubs)

```bash
pnpm install
cp .env.example .env
pnpm dev
```

That starts both processes:

| Process | URL |
| --- | --- |
| Agent status API | http://127.0.0.1:3847/health and `/status` |
| Dashboard | http://127.0.0.1:5173 |

`MOCK_MODE=true` (the default in `.env.example`) means:

- No connection to relays or a Cashu mint
- No LLM API calls
- Ephemeral npub (new each agent start unless `NOSTR_NSEC` is set)
- In-memory balance, payments, and events for the dashboard

### Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Agent + dashboard in watch mode |
| `pnpm agent` | Agent only (`tsx` on `apps/agent`) |
| `pnpm web` | Dashboard only |
| `pnpm typecheck` | Typecheck all workspaces |
| `pnpm build` | Typecheck agent/shared and production-build the dashboard |

The dashboard proxies `/agent/*` to the status API. If you open the UI without the agent, it shows an offline state and retries.

## Environment variables

Copy [`.env.example`](.env.example). All values are placeholders — **do not put real nsecs or API keys in git**.

| Variable | Purpose |
| --- | --- |
| `MOCK_MODE` | `true` (default) boots without live mint/LLM/relays |
| `AGENT_HTTP_HOST` / `AGENT_HTTP_PORT` | Loopback status server |
| `NOSTR_RELAYS` | Comma-separated relay URLs (unused in mock) |
| `NOSTR_NSEC` | Agent secret key (`nsec1…`). Empty → ephemeral mock identity |
| `CASHU_MINT_URL` | Mint the wallet will trust. **TODO(cashu-mint)** |
| `PAYMENT_GATE_SATS` | Admission amount before a full reply |
| `TOOL_SPEND_SATS` | What the agent pays to invoke its one tool |
| `MOCK_BALANCE_SATS` | Starting mock wallet balance |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | LLM stub config |
| `VITE_AGENT_BASE_URL` | Dashboard fetch base (`/agent` via Vite proxy) |

The HTTP API **never** returns the nsec or Cashu proofs — only npub, mock flags, balances, and summaries.

## Plug-in points (not implemented yet)

Search the repo for these markers:

- `TODO(cashu-mint)` — receive tokens, check admission, melt/spend for the tool
- `TODO(nostr-dm-encryption)` — NIP-44 (preferred) / NIP-04 decrypt of inbound DMs

## License

[MIT](LICENSE)
