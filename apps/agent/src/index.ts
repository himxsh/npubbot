import { env, mock } from "./env.ts";
import { AgentStore } from "./store.ts";
import { publicIdentity, resolveIdentity } from "./nostr/identity.ts";
import { startNostrListener } from "./nostr/listener.ts";
import { createCashuHandle } from "./payments/cashu.ts";
import { startHttpServer } from "./http/server.ts";
import { createPipelineLlm } from "./pipeline.ts";
import { spendForTool } from "./tools/spender.ts";

function seedMockLedger(store: AgentStore): void {
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  store.recordPayment({
    id: "mock-pay-in",
    amountSats: env.PAYMENT_GATE_SATS,
    direction: "in",
    state: { kind: "paid", amountSats: env.PAYMENT_GATE_SATS },
    note: "mock admission (mention)",
    createdAt,
  });
  store.credit(env.PAYMENT_GATE_SATS);
}

async function main(): Promise<void> {
  const identity = resolveIdentity(env.NOSTR_NSEC, mock.nostr);
  const cashu = createCashuHandle(env.CASHU_MINT_URL, mock.cashu);
  const llm = createPipelineLlm(env, mock.llm);
  void llm;

  const store = new AgentStore(
    publicIdentity(identity),
    mock,
    {
      admissionSats: env.PAYMENT_GATE_SATS,
      toolSpendSats: env.TOOL_SPEND_SATS,
    },
    mock.cashu ? env.MOCK_BALANCE_SATS : 0,
    cashu.mintUrl,
  );

  if (mock.cashu) {
    seedMockLedger(store);
    spendForTool({
      store,
      cashu,
      amountSats: env.TOOL_SPEND_SATS,
    });
  }

  const stopNostr = startNostrListener({
    identity,
    relays: env.NOSTR_RELAYS,
    mock: mock.nostr,
    store,
  });

  const http = await startHttpServer({
    host: env.AGENT_HTTP_HOST,
    port: env.AGENT_HTTP_PORT,
    store,
    mock,
  });

  console.info("NpubBot agent");
  console.info(`  npub     ${identity.npub}`);
  console.info(`  identity ${identity.source}`);
  console.info(
    `  mock     nostr=${mock.nostr} cashu=${mock.cashu} llm=${mock.llm}`,
  );
  console.info(`  health   ${http.url}/health`);
  console.info(`  status   ${http.url}/status`);

  const shutdown = async () => {
    stopNostr();
    await http.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error: unknown) => {
  console.error("NpubBot agent failed to start", error);
  process.exit(1);
});
