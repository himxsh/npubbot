import type { AgentEnv } from "@npubbot/shared";
import { describeGateDecision, evaluateAdmission } from "./payments/gate.ts";
import { createLlmClient, type LlmClient } from "./llm/client.ts";
import { spendForTool, lookupNote } from "./tools/spender.ts";
import type { AgentStore } from "./store.ts";
import type { CashuHandle } from "./payments/cashu.ts";

/**
 * Orchestrates mention/DM → gate → LLM → optional tool spend → reply.
 * Intentionally not invoked on a live relay loop in this scaffold pass.
 */
export async function handleInboundPrompt(options: {
  env: AgentEnv;
  store: AgentStore;
  cashu: CashuHandle;
  llm: LlmClient;
  userText: string;
  paidSats: number;
  wantsTool: boolean;
}): Promise<string> {
  const { env, store, cashu, llm, userText, paidSats, wantsTool } = options;
  const decision = evaluateAdmission({
    paidSats,
    requiredSats: env.PAYMENT_GATE_SATS,
  });

  if (decision.kind === "require_payment") {
    return describeGateDecision(decision);
  }

  let toolContext = "";
  if (wantsTool) {
    const spend = spendForTool({
      store,
      cashu,
      amountSats: env.TOOL_SPEND_SATS,
    });
    if (spend.ok) {
      toolContext = await lookupNote("mock-note-id");
    }
  }

  const completion = await llm.complete({
    system: "You are NpubBot, a Nostr-native assistant paid in sats.",
    user: toolContext ? `${userText}\n\n${toolContext}` : userText,
  });
  return completion.text;
}

export function createPipelineLlm(env: AgentEnv, mockLlm: boolean): LlmClient {
  return createLlmClient({
    mock: mockLlm,
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
  });
}
