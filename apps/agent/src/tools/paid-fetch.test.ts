import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeReport } from "@npubbot/shared";
import type { CashuHandle } from "../payments/cashu.ts";
import { AgentStore } from "../store.ts";
import { runPaidFetch } from "./spender.ts";

function testStore(balance: number): AgentStore {
  const sub = {
    mode: "mock" as const,
    ready: true,
    detail: "test",
    lastError: null,
  };
  const runtime: RuntimeReport = {
    mode: "mock",
    liveRequired: false,
    nodeEnv: "test",
    ready: true,
    subsystems: { nostr: sub, cashu: sub, llm: sub },
    warnings: [],
  };
  const store = new AgentStore(
    { npub: "npub1test", source: "ephemeral-mock" },
    { nostr: true, cashu: true, llm: true },
    {
      admissionSats: 21,
      toolSpendSats: 10,
      sessionTtlSeconds: 900,
      toolFetchTimeoutMs: 8000,
      paidRateLimit: 12,
      paidRateWindowMs: 60_000,
    },
    balance,
    null,
    { mock: true, relays: [], connected: [], lastError: null },
  );
  store.setRuntimeView(() => runtime);
  return store;
}

function cashu(options: {
  mock: boolean;
  proofs?: number;
  melt?: CashuHandle["meltForTool"];
}): CashuHandle {
  return {
    mock: options.mock,
    mintUrl: options.mock ? null : "https://mint.example",
    persisted: false,
    lastError: null,
    async createQuote(amountSats) {
      return {
        quoteId: "q",
        amountSats,
        mock: options.mock,
        request: "cashu:mock",
      };
    },
    async settleQuote() {
      return { kind: "unpaid" };
    },
    async receiveToken() {
      throw new Error("unused");
    },
    meltForTool: options.melt ?? (async () => {
      throw new Error("melt should not run");
    }),
    proofBalanceSats: () => options.proofs ?? 0,
    isReady: () => true,
    async ensureReady() {
      return true;
    },
  };
}

test("a failed fetch refunds the mock debit", async () => {
  const store = testStore(210);
  const result = await runPaidFetch({
    store,
    cashu: cashu({ mock: true }),
    amountSats: 10,
    url: "https://example.invalid/missing",
    timeoutMs: 1000,
    fetchImpl: async () => ({
      ok: false,
      url: "https://example.invalid/missing",
      error: "HTTP 404",
    }),
  });
  assert.equal(result.kind, "refunded");
  assert.equal(store.getBalance(), 210);
  const snap = store.snapshot();
  assert.equal(snap.ledger.spentSats, 10);
  assert.equal(snap.ledger.refundedSats, 10);
  assert.equal(snap.ledger.netSats, 0);
  assert.equal(snap.toolSpends[0]?.refunded, true);
  assert.equal(snap.payments.some((row) => row.direction === "refund"), true);
});

test("a successful fetch keeps the debit and does not refund", async () => {
  const store = testStore(210);
  const result = await runPaidFetch({
    store,
    cashu: cashu({ mock: true }),
    amountSats: 10,
    url: "https://example.com",
    timeoutMs: 1000,
    fetchImpl: async () => ({
      ok: true,
      url: "https://example.com",
      status: 200,
      contentType: "text/plain",
      text: "hello",
    }),
  });
  assert.equal(result.kind, "fetched");
  assert.equal(store.getBalance(), 200);
  assert.equal(store.snapshot().ledger.refundedSats, 0);
  assert.equal(store.snapshot().ledger.spentSats, 10);
});

test("a thrown fetch is refunded", async () => {
  const store = testStore(50);
  const result = await runPaidFetch({
    store,
    cashu: cashu({ mock: true }),
    amountSats: 10,
    url: "https://example.com",
    timeoutMs: 1000,
    fetchImpl: async () => {
      throw new Error("socket reset");
    },
  });
  assert.equal(result.kind, "refunded");
  if (result.kind === "refunded") {
    assert.match(result.error, /socket reset/);
  }
  assert.equal(store.getBalance(), 50);
});

test("insufficient balance does not debit", async () => {
  const store = testStore(4);
  const result = await runPaidFetch({
    store,
    cashu: cashu({ mock: true }),
    amountSats: 10,
    url: "https://example.com",
    timeoutMs: 1000,
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
  });
  assert.equal(result.kind, "unaffordable");
  assert.equal(store.getBalance(), 4);
  assert.equal(store.snapshot().ledger.spentSats, 0);
});

test("live melt runs only after a successful fetch and refunds when melt fails", async () => {
  let melts = 0;
  const store = testStore(100);
  const failed = await runPaidFetch({
    store,
    cashu: cashu({
      mock: false,
      proofs: 100,
      melt: async () => {
        melts += 1;
        return { ok: false, reason: "wallet", message: "melt failed" };
      },
    }),
    amountSats: 10,
    url: "https://example.com",
    timeoutMs: 1000,
    fetchImpl: async () => ({
      ok: false,
      url: "https://example.com",
      error: "timeout",
    }),
  });
  assert.equal(failed.kind, "refunded");
  assert.equal(melts, 0);
  assert.equal(store.getBalance(), 100);

  const melted = await runPaidFetch({
    store,
    cashu: cashu({
      mock: false,
      proofs: 100,
      melt: async () => {
        melts += 1;
        return { ok: false, reason: "wallet", message: "melt failed" };
      },
    }),
    amountSats: 10,
    url: "https://example.com",
    timeoutMs: 1000,
    fetchImpl: async () => ({
      ok: true,
      url: "https://example.com",
      status: 200,
      contentType: "text/plain",
      text: "page",
    }),
  });
  assert.equal(melted.kind, "wallet");
  assert.equal(melts, 1);
  assert.equal(store.getBalance(), 100);

  const paid = await runPaidFetch({
    store,
    cashu: cashu({
      mock: false,
      proofs: 100,
      melt: async () => ({
        ok: true,
        amountSats: 10,
        feeSats: 1,
        remainingSats: 80,
      }),
    }),
    amountSats: 10,
    url: "https://example.com",
    timeoutMs: 1000,
    fetchImpl: async () => ({
      ok: true,
      url: "https://example.com",
      status: 200,
      contentType: "text/plain",
      text: "page",
    }),
  });
  assert.equal(paid.kind, "fetched");
  assert.equal(store.getBalance(), 80);
});
