import type { ToolSpendRecord } from "@npubbot/shared";
import { newId } from "../ids.ts";
import type { AgentStore } from "../store.ts";
import type { CashuHandle } from "../payments/cashu.ts";
import { logInfo, redactSecrets } from "../secrets.ts";
import { fetchUrl, type FetchUrlResult } from "./fetch-url.ts";

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
    refunded: false,
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

type Charge =
  | { ok: false; insufficient: boolean; debited: false; record: ToolSpendRecord }
  | { ok: true; debited: boolean; record: ToolSpendRecord };

/**
 * Reserve the tool price on the ledger. Live proofs are melted only after the
 * fetch succeeds (`commitLiveMelt`), so a failed GET can be refunded without
 * burning ecash. Mock mode debits the in-memory wallet here.
 */
async function chargeForTool(options: {
  store: AgentStore;
  cashu: CashuHandle;
  amountSats: number;
  url: string | null;
}): Promise<Charge> {
  const { store, cashu, amountSats, url } = options;
  const balance = store.getBalance();

  if (cashu.mock) {
    if (balance < amountSats) {
      return {
        ok: false,
        insufficient: true,
        debited: false,
        record: recordSpend(store, {
          url,
          amountSats,
          ok: false,
          detail: `insufficient balance (${balance} sat < ${amountSats} sat)`,
        }),
      };
    }
    if (!store.debit(amountSats)) {
      return {
        ok: false,
        insufficient: true,
        debited: false,
        record: recordSpend(store, {
          url,
          amountSats,
          ok: false,
          detail: "insufficient mock balance",
        }),
      };
    }
    return {
      ok: true,
      debited: true,
      record: recordSpend(store, {
        url,
        amountSats,
        ok: true,
        detail: `mock debit ${amountSats} sat for ${TOOL_NAME}`,
      }),
    };
  }

  const held = cashu.proofBalanceSats();
  if (held < amountSats) {
    return {
      ok: false,
      insufficient: true,
      debited: false,
      record: recordSpend(store, {
        url,
        amountSats,
        ok: false,
        detail: `insufficient balance (${held} sat < ${amountSats} sat)`,
      }),
    };
  }
  const debited = store.debit(amountSats);
  return {
    ok: true,
    debited,
    record: recordSpend(store, {
      url,
      amountSats,
      ok: true,
      detail: `reserved ${amountSats} sat for ${TOOL_NAME}`,
    }),
  };
}

async function commitLiveMelt(options: {
  store: AgentStore;
  cashu: CashuHandle;
  amountSats: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (options.cashu.mock) {
    return { ok: true };
  }
  const melted = await options.cashu.meltForTool(options.amountSats);
  if (!melted.ok) {
    if (melted.reason === "insufficient") {
      options.store.setWalletError(null);
    } else {
      options.store.setWalletError(melted.message);
    }
    return { ok: false, message: melted.message };
  }
  options.store.setWalletError(null);
  options.store.setBalance(melted.remainingSats);
  logInfo(
    "cashu",
    `tool spend synced wallet to ${melted.remainingSats} sat after melt`,
  );
  return { ok: true };
}

function refundCharge(options: {
  store: AgentStore;
  record: ToolSpendRecord;
  debited: boolean;
  reason: string;
}): ToolSpendRecord {
  if (options.debited) {
    options.store.credit(options.record.amountSats);
  }
  const detail = redactSecrets(
    `refunded ${options.record.amountSats} sat (${options.reason})`,
  ).slice(0, 240);
  options.store.markToolSpendRefunded(options.record.id, detail);
  options.store.recordPayment({
    id: newId("pay"),
    quoteId: null,
    amountSats: options.record.amountSats,
    direction: "refund",
    state: { kind: "paid", amountSats: options.record.amountSats },
    note: `refund ${TOOL_NAME}: ${redactSecrets(options.reason)}`.slice(0, 240),
    senderNpub: null,
    createdAt: new Date().toISOString(),
  });
  return {
    ...options.record,
    ok: false,
    refunded: true,
    detail,
  };
}

export type PaidFetchResult =
  | { kind: "unaffordable"; spend: ToolSpendRecord }
  | { kind: "wallet"; spend: ToolSpendRecord }
  | { kind: "refunded"; spend: ToolSpendRecord; error: string }
  | { kind: "fetched"; spend: ToolSpendRecord; fetched: Extract<FetchUrlResult, { ok: true }> };

/**
 * Charge, fetch, then either keep the charge or refund it.
 * Live Cashu melts only after a successful fetch.
 */
export async function runPaidFetch(options: {
  store: AgentStore;
  cashu: CashuHandle;
  amountSats: number;
  url: string;
  timeoutMs: number;
  fetchImpl?: (url: string, timeoutMs: number) => Promise<FetchUrlResult>;
}): Promise<PaidFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetchUrl;
  const charge = await chargeForTool({
    store: options.store,
    cashu: options.cashu,
    amountSats: options.amountSats,
    url: options.url,
  });
  if (!charge.ok) {
    return charge.insufficient
      ? { kind: "unaffordable", spend: charge.record }
      : { kind: "wallet", spend: charge.record };
  }

  let fetched: FetchUrlResult;
  try {
    fetched = await fetchImpl(options.url, options.timeoutMs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "fetch failed";
    return {
      kind: "refunded",
      error: reason,
      spend: refundCharge({
        store: options.store,
        record: charge.record,
        debited: charge.debited,
        reason,
      }),
    };
  }

  if (!fetched.ok) {
    return {
      kind: "refunded",
      error: fetched.error,
      spend: refundCharge({
        store: options.store,
        record: charge.record,
        debited: charge.debited,
        reason: fetched.error,
      }),
    };
  }

  const melted = await commitLiveMelt({
    store: options.store,
    cashu: options.cashu,
    amountSats: options.amountSats,
  });
  if (!melted.ok) {
    return {
      kind: "wallet",
      spend: refundCharge({
        store: options.store,
        record: charge.record,
        debited: charge.debited,
        reason: melted.message,
      }),
    };
  }

  return { kind: "fetched", spend: charge.record, fetched };
}

export function refundedToolMessage(error: string, amountSats: number): string {
  const why =
    error === "timeout"
      ? "fetch_url timed out."
      : `fetch_url failed (${redactSecrets(error)}).`;
  return `${why} Refunded ${amountSats} sat to the wallet. Try another public http(s) URL.`;
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
