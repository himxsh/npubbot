import {
  deriveRuntimeMode,
  mockReason,
  type AgentEnv,
  type MockFlags,
  type RuntimeReport,
  type SubsystemReport,
} from "@npubbot/shared";
import type { AgentStore } from "./store.ts";
import type { CashuHandle } from "./payments/cashu.ts";
import type { LlmClient } from "./llm/client.ts";
import { redactSecrets } from "./secrets.ts";

/**
 * Honest per-subsystem live/mock + readiness report for /health, /ready and
 * /status. Never includes nsec, API keys, or proofs.
 */
export function createRuntimeReporter(deps: {
  env: AgentEnv;
  mock: MockFlags;
  store: AgentStore;
  cashu: CashuHandle;
  llm: LlmClient;
  warnings: string[];
}): () => RuntimeReport {
  const { env, mock, store, cashu, llm, warnings } = deps;

  function nostr(): SubsystemReport {
    const inbox = store.getInbox();
    if (mock.nostr) {
      return {
        mode: "mock",
        ready: true,
        detail: `mock inbox via POST /dev/inbound (${mockReason(env, "nostr") ?? "mocked"})`,
        lastError: null,
      };
    }
    const connected = inbox.connected.length;
    return {
      mode: "live",
      ready: connected > 0,
      detail: `${connected}/${inbox.relays.length} relays connected`,
      lastError: inbox.lastError,
    };
  }

  function cashuReport(): SubsystemReport {
    if (mock.cashu || cashu.mock) {
      return {
        mode: "mock",
        ready: true,
        detail: `in-memory mock wallet (${mockReason(env, "cashu") ?? "mocked"})`,
        lastError: null,
      };
    }
    const lastError = cashu.lastError ?? store.getWalletError();
    return {
      mode: "live",
      ready: cashu.isReady(),
      detail: cashu.isReady()
        ? `mint ${cashu.mintUrl ?? "?"} loaded; ${cashu.proofBalanceSats()} sat in proofs`
        : `mint ${cashu.mintUrl ?? "?"} not loaded (unreachable)`,
      lastError: lastError === null ? null : redactSecrets(lastError),
    };
  }

  function llmReport(): SubsystemReport {
    if (mock.llm || llm.mock) {
      return {
        mode: "mock",
        ready: true,
        detail: `mock echo model (${mockReason(env, "llm") ?? "mocked"})`,
        lastError: null,
      };
    }
    return {
      mode: "live",
      // Configured; a failed probe/call flips it until the next success.
      ready: llm.lastError === null,
      detail: `model ${llm.model} at ${llm.endpointHost ?? "?"}${llm.lastOkAt ? `; last ok ${llm.lastOkAt}` : ""}`,
      lastError: llm.lastError === null ? null : redactSecrets(llm.lastError),
    };
  }

  return () => {
    const subsystems = {
      nostr: nostr(),
      cashu: cashuReport(),
      llm: llmReport(),
    };
    const mode = deriveRuntimeMode(mock);
    const allReady =
      subsystems.nostr.ready && subsystems.cashu.ready && subsystems.llm.ready;
    return {
      mode,
      liveRequired: env.LIVE_MODE,
      nodeEnv: env.NODE_ENV,
      ready: allReady && (!env.LIVE_MODE || mode === "live"),
      subsystems,
      warnings: warnings.map(redactSecrets),
    };
  };
}
