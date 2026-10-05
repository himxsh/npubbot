# Going live (Nostr + Cashu + LLM)

Dev stays on `MOCK_MODE=true`. Production is one explicit flip: `MOCK_MODE=false` + `LIVE_MODE=true`.

| Config | Behaviour |
| --- | --- |
| `MOCK_MODE=true` (default) | Everything mocked, even if keys are set. `/dev/inbound` + `/dev/mark-paid` drive the loop. |
| `MOCK_MODE=false`, `LIVE_MODE=false` | **Partial** flip. Each subsystem is live only if its secret is set; the rest stay mocked and are logged as warnings and listed on `/health`. Good for testing the mint alone. |
| `MOCK_MODE=false`, `LIVE_MODE=true` | **Strict live.** The agent **refuses to start** unless all three subsystems are configured *and* reachable at boot. |

## Secrets you must provide

| Variable | What | Where it comes from |
| --- | --- | --- |
| `NOSTR_NSEC` | Agent private key, `nsec1…` (bech32, not hex) | A dedicated bot key (e.g. generated in a Nostr client or `nak key generate`). Don't reuse your personal nsec. |
| `CASHU_MINT_URL` | `https://` mint | `https://testnut.cashu.space` for a demo (FakeWallet: invoices auto-pay, sats not real), or a mainnet mint you trust. |
| `LLM_API_KEY` | Gemini API key (OpenAI-compatible client) | https://aistudio.google.com/apikey |
| `LLM_MODEL` | Real Gemini model id | e.g. `gemini-2.0-flash`. `mock-npubbot` is rejected. |
| `LLM_BASE_URL` | Gemini OpenAI-compatible base (default) | Default `https://generativelanguage.googleapis.com/v1beta/openai/`; other OpenAI-compatible providers work too |

Optional: `NOSTR_RELAYS` (comma-separated `wss://`), `PAYMENT_GATE_SATS`, `TOOL_SPEND_SATS`.

## Steps

```bash
pnpm install
pnpm typecheck && pnpm build

cp .env.live.example .env      # fill NOSTR_NSEC, CASHU_MINT_URL, LLM_API_KEY, LLM_MODEL
pnpm live:check                # offline validation; exit 1 lists every missing/invalid value
pnpm agent                     # or `pnpm dev` for agent + dashboard
```

Then:

```bash
curl -s http://127.0.0.1:3847/ready      # 200 = all live + ready, 503 otherwise
curl -s http://127.0.0.1:3847/health     # runtime.mode / runtime.subsystems.*
```

The startup log prints `MODE LIVE (LIVE_MODE strict)` and the agent npub. Mention that npub from any Nostr client to test.

## What fail-fast checks

Before the HTTP server binds, in `LIVE_MODE`:

1. **Config** — `MOCK_MODE=false`; `NOSTR_NSEC` present and bech32 `nsec1…`; `CASHU_MINT_URL` is `https://` (http only for localhost); `LLM_API_KEY` present; `LLM_MODEL` real; relays are `wss://`.
2. **Mint** — `loadMint()` succeeds.
3. **LLM** — `GET {LLM_BASE_URL}/models` with the key. 401/403 or unreachable → refuse. Other non-2xx (some providers have no `/models`) → warning only.
4. **Relays** — at least one relay connects within `LIVE_RELAY_CONNECT_TIMEOUT_MS` (default 15s).

Errors never print secret values. `LIVE_STARTUP_PROBES=false` skips 2–4 (config checks still apply).

Outside `LIVE_MODE`, malformed values (bad nsec, `ftp://` mint, key set with `LLM_MODEL=mock-npubbot`) are still fatal; missing ones just leave that subsystem mocked, with a warning.

## Honest status

`GET /health` (always 200 while the process is up) and `GET /status` include:

```json
"runtime": {
  "mode": "live | partial | mock",
  "liveRequired": true,
  "ready": true,
  "subsystems": {
    "nostr": { "mode": "live", "ready": true, "detail": "2/2 relays connected", "lastError": null },
    "cashu": { "mode": "live", "ready": true, "detail": "mint https://… loaded; 0 sat in proofs", "lastError": null },
    "llm":   { "mode": "live", "ready": true, "detail": "model … at generativelanguage.googleapis.com", "lastError": null }
  },
  "warnings": []
}
```

`GET /ready` returns **503** when any subsystem is not ready, or (in `LIVE_MODE`) when anything is mocked. Mocked subsystems say *why* (`MOCK_MODE=true`, `NOSTR_NSEC is empty`, …). The dashboard header shows the mode and ready state.

## Caveats

- Live Cashu proofs live in **process memory only**. Restarting drops them (`TODO(cashu-mint)`). Keep demo balances small.
- With live Nostr, `/dev/inbound` replies are **published to real relays** (synthetic event ids). It's a loopback-only smoke test.
- `/dev/mark-paid` never forces a live payment; it only asks the mint whether the quote is paid.
- Keep `AGENT_HTTP_HOST=127.0.0.1`. The status API has no auth.
