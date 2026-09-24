import { env, mock, sessionStorePath } from "./env.ts";
import { AgentStore } from "./store.ts";
import { SessionStore } from "./sessions.ts";
import { publicIdentity, resolveIdentity } from "./nostr/identity.ts";
import { startNostrListener } from "./nostr/listener.ts";
import { createCashuHandle } from "./payments/cashu.ts";
import { startHttpServer } from "./http/server.ts";
import { createLlmClient } from "./llm/client.ts";
import { createInbox } from "./inbox.ts";
import { logError, logInfo } from "./secrets.ts";
import { userFacingFromError } from "./errors.ts";

const MINT_POLL_MS = 5_000;

async function main(): Promise<void> {
  const identity = resolveIdentity(env.NOSTR_NSEC, mock.nostr);
  const cashu = await createCashuHandle(env.CASHU_MINT_URL, mock.cashu);
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
  store.setWalletError(cashu.lastError);

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
      void inbox.handleNostrEvent(event);
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

  const mintPoll = cashu.mock
    ? null
    : setInterval(() => {
        void inbox.settleMintQuotes().then((count) => {
          if (count > 0) {
            logInfo("cashu", `settled ${count} mint quote(s)`);
          }
        });
      }, MINT_POLL_MS);

  logInfo("agent", `npub ${identity.npub}`);
  logInfo("agent", `identity ${identity.source}`);
  logInfo(
    "agent",
    `mock nostr=${mock.nostr} cashu=${mock.cashu} llm=${mock.llm}`,
  );
  logInfo("agent", `health ${http.url}/health`);
  logInfo("agent", `status ${http.url}/status`);
  logInfo("agent", `inbound POST ${http.url}/dev/inbound`);
  logInfo("agent", `markpaid POST ${http.url}/dev/mark-paid`);

  const shutdown = async () => {
    if (mintPoll !== null) {
      clearInterval(mintPoll);
    }
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
  process.on("unhandledRejection", (reason: unknown) => {
    logError("unhandledRejection", reason);
  });
  process.on("uncaughtException", (error: Error) => {
    logError("uncaughtException", error);
  });
}

main().catch((error: unknown) => {
  logError("agent", error);
  console.error(userFacingFromError(error));
  process.exit(1);
});
