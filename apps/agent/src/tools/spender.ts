import type { ToolSpendRecord } from "@npubbot/shared";
import { assertNever } from "@npubbot/shared";
import { newId } from "../ids.ts";
import type { AgentStore } from "../store.ts";
import type { CashuHandle } from "../payments/cashu.ts";
import { logInfo } from "../secrets.ts";

export const TOOL_NAME = "fetch_url" as const;

function recordSpend(
  store: AgentStore,
  input: {
    url: string | null;
    amountSats: number;
    ok: boolean;
    detail: string;
  },
): ToolSpendRecord {
  const createdAt = new Date().toISOString();
  const record: ToolSpendRecord = {
    id: newId("tool"),
    tool: TOOL_NAME,
    url: input.url,
    amountSats: input.amountSats,
    ok: input.ok,
    detail: input.detail,
    createdAt,
  };
  store.recordToolSpend(record);
  if (input.ok) {
    store.recordPayment({
      id: newId("pay"),
      quoteId: null,
      amountSats: input.amountSats,
      direction: "out",
      state: { kind: "paid", amountSats: input.amountSats },
      note: input.url
        ? `tool spend (${TOOL_NAME}) ${input.url}`
        : `tool spend (${TOOL_NAME})`,
      senderNpub: null,
      createdAt,
    });
  }
  return record;
}

/**
 * Debit the agent wallet before running fetch_url.
 * Mock Cashu: in-memory debit.
 * Live Cashu: melt proofs to a mint-issued bolt11 (self-pay) and do not remint
 * that quote, so sats leave the vault. HTTP GET has no Lightning invoice.
 */
export async function spendForTool(options: {
  store: AgentStore;
  cashu: CashuHandle;
  amountSats: number;
  url: string | null;
}): Promise<ToolSpendRecord> {
  const { store, cashu, amountSats, url } = options;
  const balance = store.getBalance();

  if (cashu.mock) {
    if (balance < amountSats) {
      return recordSpend(store, {
        url,
        amountSats,
        ok: false,
        detail: `insufficient balance (${balance} sat < ${amountSats} sat)`,
      });
    }
    const ok = store.debit(amountSats);
    return recordSpend(store, {
      url,
      amountSats,
      ok,
      detail: ok
        ? `mock debit ${amountSats} sat for ${TOOL_NAME}`
        : "insufficient mock balance",
    });
  }

  const melted = await cashu.meltForTool(amountSats);
  if (!melted.ok) {
    switch (melted.reason) {
      case "insufficient":
        store.setWalletError(null);
        store.setBalance(cashu.proofBalanceSats());
        return recordSpend(store, {
          url,
          amountSats,
          ok: false,
          detail: `insufficient balance (${cashu.proofBalanceSats()} sat < ${amountSats} sat)`,
        });
      case "wallet":
        store.setWalletError(melted.message);
        return recordSpend(store, {
          url,
          amountSats,
          ok: false,
          detail: melted.message,
        });
      default:
        return assertNever(melted.reason);
    }
  }

  store.setWalletError(null);
  store.setBalance(melted.remainingSats);
  logInfo(
    "cashu",
    `tool spend synced wallet to ${melted.remainingSats} sat after melt`,
  );
  return recordSpend(store, {
    url,
    amountSats,
    ok: true,
    detail: `melt ${amountSats} sat (+${melted.feeSats} sat fee) for ${TOOL_NAME}`,
  });
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
