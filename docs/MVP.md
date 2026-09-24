# MVP

End-to-end loop for NpubBot. The current branch implements the **mock happy path** plus live Nostr mention subscribe. Cashu mint settlement and DM decryption remain seams.

## Goal

A Nostr user can mention the agent’s npub, pay a small Cashu (or Lightning-via-mint) amount, and receive an LLM reply. Encrypted DMs are recorded but not answered until decryption lands. An operator can watch balance, payments, and events on localhost, and mark mock invoices paid.

## Actors

- **User** — any Nostr client (mentions today; DMs later)
- **Agent** — `apps/agent`, keyed by `NOSTR_NSEC`
- **Mint** — Cashu mint at `CASHU_MINT_URL` (TODO hook; mock quotes meanwhile)
- **LLM** — OpenAI-compatible HTTP API, or mock if no key
- **Operator** — `apps/web` on loopback

## Loop (what runs now)

1. **Listen.** Live: `SimplePool.subscribe` on `NOSTR_RELAYS` for kind 1 `#p` mentions, plus kind 4 / 1059 DMs. Mock: `POST /dev/inbound`.
2. **DMs.** Kind 4 / gift wraps are stored as encrypted stubs. They do **not** enter the gate.
   - Plug-in: `TODO(nostr-dm-encryption)`.
3. **Gate.** If the sender has no paid session, create an admission quote and reply with pay instructions. The user text is **not** sent to the LLM.
4. **Pay.** Mock: `POST /dev/mark-paid`. Live mint: `TODO(cashu-mint)` (`createMintQuoteBolt11` / proofs). Sessions persist in `data/sessions.json`.
5. **Think.** After payment, the held prompt (or a later mention in the session TTL) is sent to the LLM.
6. **Reply.** Kind-1 reply tagged to the sender (logged only in mock Nostr).
7. **Observe.** Dashboard polls `/health` and `/status` and can inject mentions / mark invoices paid.

## DM tradeoff

Mentions are straightforward plaintext and are the paid inbox. NIP-04 kind-4 and NIP-17 gift wraps need decryption before we can safely gate or answer them. Until `TODO(nostr-dm-encryption)`, those events are visible on the dashboard and ignored by the LLM.

## Operator checks

1. `pnpm install` and `pnpm typecheck`
2. `pnpm agent` → `GET /health` and `/status`
3. `POST /dev/inbound` → paywall reply, no LLM answer in the paywall text
4. `POST /dev/mark-paid` → full mock LLM reply appears on `/status`
5. Dashboard shows events, sessions, and a **Mark invoice paid** control
