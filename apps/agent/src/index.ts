import { deriveRuntimeMode } from "@npubbot/shared";
import { configCheck, env, mock, sessionStorePath } from "./env.ts";
import { AgentStore } from "./store.ts";
import { SessionStore } from "./sessions.ts";
import { publicIdentity, resolveIdentity } from "./nostr/identity.ts";
import { startNostrListener } from "./nostr/listener.ts";
import { createCashuHandle } from "./payments/cashu.ts";
import { startHttpServer } from "./http/server.ts";
import { createLlmClient } from "./llm/client.ts";
import { createInbox } from "./inbox.ts";
import { createRuntimeReporter } from "./runtime.ts";
import { logError, logInfo, logWarn, redactSecrets } from "./secrets.ts";
import { userFacingFromError } from "./errors.ts";

const MINT_POLL_MS = 5_000;

/** Startup refusal: printed without a stack trace, exits 1. */
class StartupError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("; "));
    this.name = "StartupError";
  }
}

async function waitForRelay(
  pool: NonNullable<ReturnType<typeof startNostrListener>["pool"]>,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const up: string[] = [];
    for (const [url, isUp] of pool.listConnectionStatus()) {
      if (isUp) {
        up.push(url);
      }
    }
    if (up.length > 0) {
      return up;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return [];
}

async function main(): Promise<void> {
  const strict = env.LIVE_MODE;
  const probes = env.LIVE_STARTUP_PROBES;
  const warnings = [...configCheck.warnings];

  for (const warning of configCheck.warnings) {
    logWarn("config", warning);
  }
  if (configCheck.errors.length > 0) {
    throw new StartupError(configCheck.errors);
  }

  /** Strict LIVE_MODE: fatal. Otherwise: warn and keep booting. */
  const problem = (message: string): void => {
    if (strict) {
      throw new StartupError([message]);
    }
    warnings.push(message);
    logWarn("startup", message);
  };

  const identity = resolveIdentity(env.NOSTR_NSEC, mock.nostr);
  const cashu = await createCashuHandle(env.CASHU_MINT_URL, mock.cashu);
  if (!cashu.mock && probes && !cashu.isReady()) {
    problem(
      `Cashu mint ${cashu.mintUrl ?? "?"} is unreachable (loadMint failed)`,
    );
  }

  const llm = createLlmClient({
    mock: mock.llm,
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
  });
  if (!llm.mock && probes) {
    const probe = await llm.probe();
    if (probe.ok) {
      logInfo("llm", probe.detail);
    } else if (probe.fatal) {
      problem(probe.detail);
    } else {
      warnings.push(probe.detail);
      logWarn("llm", probe.detail);
    }
  }

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

  const runtime = createRuntimeReporter({
    env,
    mock,
    store,
    cashu,
    llm,
    warnings,
  });
  store.setRuntimeView(runtime);

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

  if (!mock.nostr && strict && probes) {
    if (listener.pool === null) {
      listener.stop();
      throw new StartupError(["Nostr listener did not start (no relays)"]);
    }
    logInfo(
      "nostr",
      `LIVE_MODE: waiting up to ${env.LIVE_RELAY_CONNECT_TIMEOUT_MS}ms for a relay`,
    );
    const up = await waitForRelay(
      listener.pool,
      env.LIVE_RELAY_CONNECT_TIMEOUT_MS,
    );
    if (up.length === 0) {
      listener.stop();
      throw new StartupError([
        `no Nostr relay connected within ${env.LIVE_RELAY_CONNECT_TIMEOUT_MS}ms (${env.NOSTR_RELAYS.join(", ")})`,
      ]);
    }
    store.setInbox({ connected: up });
    logInfo("nostr", `connected ${up.join(", ")}`);
  }

  const http = await startHttpServer({
    host: env.AGENT_HTTP_HOST,
    port: env.AGENT_HTTP_PORT,
    store,
    mock,
    inbox,
    llm,
    runtime,
  });

  const mintPoll = cashu.mock
    ? null
    : setInterval(() => {
        if (!cashu.isReady()) {
          void cashu.ensureReady();
        }
        void inbox.settleMintQuotes().then((count) => {
          if (count > 0) {
            logInfo("cashu", `settled ${count} mint quote(s)`);
          }
        });
      }, MINT_POLL_MS);

  const mode = deriveRuntimeMode(mock);
  logInfo(
    "agent",
    `MODE ${mode.toUpperCase()}${strict ? " (LIVE_MODE strict)" : ""} · NODE_ENV=${env.NODE_ENV}`,
  );
  logInfo("agent", `npub ${identity.npub}`);
  logInfo("agent", `identity ${identity.source}`);
  logInfo(
    "agent",
    `nostr=${mock.nostr ? "mock" : "LIVE"} cashu=${mock.cashu ? "mock" : "LIVE"} llm=${mock.llm ? "mock" : "LIVE"}`,
  );
  logInfo("agent", `health ${http.url}/health`);
  logInfo("agent", `ready  ${http.url}/ready`);
  logInfo("agent", `status ${http.url}/status`);
  logInfo("agent", `inbound POST ${http.url}/dev/inbound`);
  logInfo("agent", `markpaid POST ${http.url}/dev/mark-paid`);
  if (!mock.nostr) {
    logWarn(
      "agent",
      "Nostr is LIVE: replies from /dev/inbound are published to real relays",
    );
  }

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
  if (error instanceof StartupError) {
    console.error("[startup] refusing to start:");
    for (const line of error.problems) {
      console.error(`  - ${redactSecrets(line)}`);
    }
    console.error(
      "[startup] fix .env (see .env.example and docs/LIVE.md), or set MOCK_MODE=true for local dev.",
    );
    process.exit(1);
  }
  logError("agent", error);
  console.error(userFacingFromError(error));
  process.exit(1);
});
