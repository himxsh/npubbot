# Devfolio / BOSS Battle submit copy

Paste-ready draft for the Bitshala BOSS Battle listing. Recording the demo video is on the operator; this file is words only. Follow [DEMO.md](DEMO.md) for the mock walkthrough.

## Title

NpubBot

## Tagline

Nostr-native AI agent that gets paid in sats (Cashu).

## Problem statement

Most AI bots sit behind platform accounts, API keys, and custodial billing. NpubBot is an agent you talk to on **Nostr**: mention its npub, pay a small **Cashu** admission, and it answers. If you ask it to fetch a URL, it **spends its own sats** (mock debit, or a real Cashu melt in live mode) to run that tool. The operator dashboard is localhost-only; users never leave the relay + ecash stack.

## How it works (one paragraph)

An unpaid mention gets a quote, not an LLM reply. After payment (dashboard mark-paid in mock; Lightning invoice / Cashu token when `CASHU_MINT_URL` is live), the held prompt is answered. `fetch https://example.com` debits `TOOL_SPEND_SATS` from the agent wallet, GETs the page, and folds the result into the reply. Secrets (nsec, API keys, proofs) never appear on `/status` or the dashboard.

## Tech stack

- TypeScript / Node.js 22, pnpm workspaces
- `nostr-tools` (SimplePool, kind-1 mentions and replies)
- `@cashu/cashu-ts` (mint quote, receive, melt)
- OpenAI-compatible LLM client (mock if no key)
- Vite + React operator dashboard
- Loopback HTTP: `/health`, `/status`, `/dev/inbound`, `/dev/mark-paid`

## Track mapping

- **Cypherpunk** — Cashu by default; proofs and nsec stay off logs and `/status`; operator chooses `CASHU_MINT_URL`.
- **Freedom Stack** — npub identity, relay transport, Cashu value (Lightning as the mint’s on/off ramp); dashboard is operator-only.
- **Machine Money** — the agent **earns** admission to unlock replies and **spends** sats from its own wallet to run `fetch_url`.

## Links to include

- GitHub repo (this tree)
- README quickstart (mock unpaid → paid → `fetch_url`)
- `docs/DEMO.md` (recording script + screenshot captions)
- `docs/TRACKS.md` (longer track intent)
