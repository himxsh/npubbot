# Operator dashboard — Vercel (static)

Deploys **only** the Vite+React UI (`@npubbot/web`). Do **not** run `@npubbot/agent` on Vercel.

## Build / output

- Install: `pnpm install` (monorepo root; needs `@npubbot/shared`)
- Build: `pnpm --filter @npubbot/web build`
- Output: `apps/web/dist`
- Root `vercel.json` sets these for CLI / Git integration

## Agent API (`VITE_AGENT_BASE_URL`)

Locally, Vite proxies `/agent` → `http://127.0.0.1:3847`.

On this static deploy, leave `VITE_AGENT_BASE_URL` **unset**. The UI will call `/agent` on the same origin and will **not** reach a live agent until you set a public agent URL, for example:

```bash
vercel env add VITE_AGENT_BASE_URL production
# value: https://your-public-agent.example.com
```

Never upload `.env` / nsecs / API keys to Vercel for this dashboard-only deploy.
