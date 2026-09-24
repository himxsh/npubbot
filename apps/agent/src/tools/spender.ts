import type { ToolSpendRecord } from "@npubbot/shared";
import { newId } from "../ids.ts";
import type { AgentStore } from "../store.ts";
import type { CashuHandle } from "../payments/cashu.ts";

export const TOOL_NAME = "fetch_url" as const;

/**
 * Debit the agent wallet before running fetch_url.
 * Mock Cashu: in-memory debit.
 * TODO(cashu-mint): melt proofs / pay Lightning instead of debit().
 */
export function spendForTool(options: {
  store: AgentStore;
  cashu: CashuHandle;
  amountSats: number;
  url: string | null;
}): ToolSpendRecord {
  const { store, cashu, amountSats, url } = options;
  const createdAt = new Date().toISOString();
  const balance = store.getBalance();

  if (balance < amountSats) {
    const record: ToolSpendRecord = {
      id: newId("tool"),
      tool: TOOL_NAME,
      url,
      amountSats,
      ok: false,
      detail: `insufficient balance (${balance} sat < ${amountSats} sat)`,
      createdAt,
    };
    store.recordToolSpend(record);
    return record;
  }

  if (!cashu.mock) {
    console.info(
      `[cashu] TODO(cashu-mint): melt ${amountSats} sat for ${TOOL_NAME} at ${cashu.mintUrl}`,
    );
  }

  const ok = store.debit(amountSats);
  const record: ToolSpendRecord = {
    id: newId("tool"),
    tool: TOOL_NAME,
    url,
    amountSats,
    ok,
    detail: ok
      ? `${cashu.mock ? "mock debit" : "debit (mint melt TODO)"} ${amountSats} sat for ${TOOL_NAME}`
      : "insufficient mock balance",
    createdAt,
  };
  store.recordToolSpend(record);
  if (ok) {
    store.recordPayment({
      id: newId("pay"),
      quoteId: null,
      amountSats,
      direction: "out",
      state: { kind: "paid", amountSats },
      note: url
        ? `tool spend (${TOOL_NAME}) ${url}`
        : `tool spend (${TOOL_NAME})`,
      senderNpub: null,
      createdAt,
    });
  }
  return record;
}

export function insufficientToolMessage(input: {
  balanceSats: number;
  amountSats: number;
}): string {
  return [
    `NpubBot can't afford fetch_url (${input.amountSats} sat).`,
    `Wallet: ${input.balanceSats} sat.`,
    "The agent needs to earn more admission before fetching.",
  ].join(" ");
}

export function needUrlMessage(amountSats: number): string {
  return `I can fetch a public http(s) URL for ${amountSats} sat from my wallet. Send the link, e.g. fetch https://example.com`;
}
