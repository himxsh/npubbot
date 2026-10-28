import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { parseAgentEnv } from "@npubbot/shared";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { createInbox } from "./inbox.ts";
import { createLlmClient } from "./llm/client.ts";
import { resolveIdentity } from "./nostr/identity.ts";
import { createCashuHandle } from "./payments/cashu.ts";
import { SessionStore } from "./sessions.ts";
import { AgentStore } from "./store.ts";

const dirs: string[] = [];

after(async () => {
  // Session writes are fire-and-forget; let them finish before removing the dir.
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

function freshNpub(): string {
  return nip19.npubEncode(getPublicKey(generateSecretKey()));
}

async function boot() {
  const dir = await mkdtemp(join(tmpdir(), "npubbot-inbox-"));
  dirs.push(dir);
  const env = parseAgentEnv({
    NODE_ENV: "test",
    MOCK_MODE: "true",
    PAYMENT_GATE_SATS: "21",
    TOOL_SPEND_SATS: "10",
    MOCK_BALANCE_SATS: "210",
    PRICE_SURGE_AFTER: "3",
    PRICE_SURGE_WINDOW_MS: "60000",
    PRICE_MAX_MULTIPLIER: "3",
    PAID_RATE_LIMIT: "2",
    PAID_RATE_WINDOW_MS: "60000",
    UNPAID_COOLDOWN_MS: "0",
    SESSION_STORE_PATH: join(dir, "sessions.json"),
  });
  const identity = resolveIdentity(undefined, true);
  const cashu = await createCashuHandle(undefined, true);
  const store = new AgentStore(
    { npub: identity.npub, source: identity.source },
    { nostr: true, cashu: true, llm: true },
    {
      admissionSats: env.PAYMENT_GATE_SATS,
      toolSpendSats: env.TOOL_SPEND_SATS,
      sessionTtlSeconds: env.SESSION_TTL_SECONDS,
      toolFetchTimeoutMs: env.TOOL_FETCH_TIMEOUT_MS,
      paidRateLimit: env.PAID_RATE_LIMIT,
      paidRateWindowMs: env.PAID_RATE_WINDOW_MS,
    },
    env.MOCK_BALANCE_SATS,
    null,
    { mock: true, relays: [], connected: [], lastError: null },
    cashu.persisted,
  );
  const sessions = new SessionStore(env.SESSION_STORE_PATH, 3_600_000, 900_000);
  await sessions.load();
  store.setSessionView(() => sessions.summaries());
  const inbox = createInbox({
    env,
    mock: { nostr: true, cashu: true, llm: true },
    identity,
    store,
    sessions,
    cashu,
    llm: createLlmClient({
      mock: true,
      apiKey: undefined,
      baseUrl: "http://127.0.0.1",
      model: "mock-npubbot",
    }),
    getPool: () => null,
  });
  return { inbox, store };
}

test("the fourth fresh quote in the window is 2×", async () => {
  const { inbox } = await boot();
  const amounts = [21, 21, 21, 42];
  let last = "";
  for (const amount of amounts) {
    const result = await inbox.injectDevMention({
      text: `hello ${amount}`,
      senderNpub: freshNpub(),
    });
    assert.equal(result.outcome, "paywall");
    last = result.reply ?? "";
    assert.match(last, new RegExp(`for ${amount} sat`));
  }
  assert.match(last, /Demand pricing: 2× the base 21 sat/);
});

test("paid sends past the limit are refused without a further charge", async () => {
  const { inbox, store } = await boot();
  const senderNpub = freshNpub();
  const opened = await inbox.injectDevMention({
    text: "what is npubbot?",
    senderNpub,
  });
  assert.equal(opened.outcome, "paywall");
  assert.ok(opened.quoteId);
  await inbox.markPaid(opened.quoteId);
  const balance = store.getBalance();
  assert.equal(balance, 231);

  const first = await inbox.injectDevMention({ text: "one", senderNpub });
  const second = await inbox.injectDevMention({ text: "two", senderNpub });
  const third = await inbox.injectDevMention({ text: "three", senderNpub });
  assert.equal(first.outcome, "full");
  assert.equal(second.outcome, "full");
  assert.equal(third.outcome, "rate-limited");
  assert.match(third.reply ?? "", /rate-limiting this npub/);
  assert.equal(store.getBalance(), balance);
});

test("a blocked fetch refunds the tool spend", async () => {
  const { inbox, store } = await boot();
  const senderNpub = freshNpub();
  const opened = await inbox.injectDevMention({
    text: "fetch please",
    senderNpub,
  });
  assert.ok(opened.quoteId);
  await inbox.markPaid(opened.quoteId);
  const result = await inbox.injectDevMention({
    text: "fetch http://127.0.0.1/secret",
    senderNpub,
  });
  assert.equal(result.outcome, "error");
  assert.match(result.reply ?? "", /Refunded 10 sat/);
  assert.equal(store.getBalance(), 231);
});
