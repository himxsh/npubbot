import type { ToolSpendRecord } from "@npubbot/shared";
import type { AgentStore } from "../store.ts";
import type { CashuHandle } from "../payments/cashu.ts";

export const TOOL_NAME = "lookup_note" as const;

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * The agent spends its own sats to call exactly one tool.
 * TODO(cashu-mint): melt proofs / pay a Lightning invoice for the tool
 * instead of debiting the in-memory mock balance.
 */
export function spendForTool(options: {
  store: AgentStore;
  cashu: CashuHandle;
  amountSats: number;
}): ToolSpendRecord {
  const { store, cashu, amountSats } = options;
  const createdAt = new Date().toISOString();

  if (cashu.mock) {
    const ok = store.debit(amountSats);
    const record: ToolSpendRecord = {
      id: newId("tool"),
      tool: TOOL_NAME,
      amountSats,
      ok,
      detail: ok
        ? `mock debit ${amountSats} sat for ${TOOL_NAME}`
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
        note: `tool spend (${TOOL_NAME})`,
        senderNpub: null,
        createdAt,
      });
    }
    return record;
  }

  const record: ToolSpendRecord = {
    id: newId("tool"),
    tool: TOOL_NAME,
    amountSats,
    ok: false,
    detail:
      "TODO(cashu-mint): melt/spend from Wallet before invoking lookup_note",
    createdAt,
  };
  store.recordToolSpend(record);
  return record;
}

export async function lookupNote(_noteId: string): Promise<string> {
  return "TODO: lookup_note tool — fetch a Nostr event by id after paying";
}
