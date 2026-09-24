import { env, mock, sessionStorePath } from "./env.ts";
import { AgentStore } from "./store.ts";
import { SessionStore } from "./sessions.ts";
import { publicIdentity, resolveIdentity } from "./nostr/identity.ts";
import { startNostrListener } from "./nostr/listener.ts";
import { createCashuHandle } from "./payments/cashu.ts";
import { startHttpServer } from "./http/server.ts";
import { createLlmClient } from "./llm/client.ts";
import { createInbox } from "./inbox.ts";

async function main(): Promise<void> {
  const identity = resolveIdentity(env.NOSTR_NSEC, mock.nostr);
  const cashu = createCashuHandle(env.CASHU_MINT_URL, mock.cashu);
  const llm = createLlmClient({
    mock: mock.llm,
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
  });

  const store = new AgentStore(
    publicIdentity(identity),
    mock,
    {
      admissionSats: env.PAYMENT_GATE_SATS,
      toolSpendSats: env.TOOL_SPEND_SATS,
      sessionTtlSeconds: env.SESSION_TTL_SECONDS,
      toolFetchTimeoutMs: env.TOOL_FETCH_TIMEOUT_MS,
    },
    mock.cashu ? env.MOCK_BALANCE_SATS : 0,
    cashu.mintUrl,
    {
      mock: mock.nostr,
      relays: env.NOSTR_RELAYS,
      connected: [],
      lastError: null,
    },
  );

  const sessions = new SessionStore(
    sessionStorePath,
    env.QUOTE_TTL_SECONDS * 1000,
    env.SESSION_TTL_SECONDS * 1000,
  );
  await sessions.load();
  store.setSessionView(() => sessions.summaries());

  let poolRef: ReturnType<typeof startNostrListener>["pool"] = null;
  const inbox = createInbox({
    env,
    mock,
    identity,
    store,
    sessions,
    cashu,
    llm,
    getPool: () => poolRef,
  });

  const listener = startNostrListener({
    identity,
    relays: env.NOSTR_RELAYS,
    mock: mock.nostr,
    store,
    onEvent: (event) => {
      void inbox.handleNostrEvent(event).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[inbox] nostr event failed", error);
        store.setInbox({ lastError: message });
      });
    },
  });
  poolRef = listener.pool;

  const http = await startHttpServer({
    host: env.AGENT_HTTP_HOST,
    port: env.AGENT_HTTP_PORT,
    store,
    mock,
    inbox,
    llm,
  });

  console.info("NpubBot agent");
  console.info(`  npub     ${identity.npub}`);
  console.info(`  identity ${identity.source}`);
  console.info(
    `  mock     nostr=${mock.nostr} cashu=${mock.cashu} llm=${mock.llm}`,
  );
  console.info(`  health   ${http.url}/health`);
  console.info(`  status   ${http.url}/status`);
  console.info(`  inbound  POST ${http.url}/dev/inbound`);
  console.info(`  markpaid POST ${http.url}/dev/mark-paid`);

  const shutdown = async () => {
    listener.stop();
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
