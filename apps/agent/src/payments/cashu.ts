import { MeltQuoteState, MintQuoteState, Wallet, type Proof } from "@cashu/cashu-ts";
import { assertNever } from "@npubbot/shared";
import { AgentFaultError } from "../errors.ts";
import { newId } from "../ids.ts";
import { logError, logInfo, logWarn } from "../secrets.ts";

export type AdmissionQuote = {
  quoteId: string;
  amountSats: number;
  request: string;
  mock: boolean;
};

export type QuoteSettleResult =
  | { kind: "unpaid" }
  | { kind: "paid"; amountSats: number }
  | { kind: "issued"; amountSats: number }
  | { kind: "error"; message: string };

export type CashuReceiveResult = {
  amountSats: number;
};

export type MeltForToolResult =
  | { ok: true; amountSats: number; feeSats: number; remainingSats: number }
  | { ok: false; reason: "insufficient" | "wallet"; message: string };

export type CashuHandle = {
  readonly mock: boolean;
  readonly mintUrl: string | null;
  lastError: string | null;
  createQuote: (amountSats: number) => Promise<AdmissionQuote>;
  settleQuote: (quoteId: string) => Promise<QuoteSettleResult>;
  receiveToken: (token: string) => Promise<CashuReceiveResult>;
  meltForTool: (amountSats: number) => Promise<MeltForToolResult>;
  proofBalanceSats: () => number;
};

function createMockQuote(amountSats: number): AdmissionQuote {
  const quoteId = newId("quote");
  return {
    quoteId,
    amountSats,
    mock: true,
    request: `cashu:mock:${quoteId}:${amountSats}sat`,
  };
}

function sumProofs(proofs: Proof[]): number {
  let total = 0;
  for (const proof of proofs) {
    total += proof.amount.toNumber();
  }
  return total;
}

function proofKey(proof: Proof): string {
  return `${proof.id}:${proof.secret}:${proof.C}`;
}

function withoutProofs(all: Proof[], drop: Proof[]): Proof[] {
  const dropKeys = new Set(drop.map(proofKey));
  return all.filter((proof) => !dropKeys.has(proofKey(proof)));
}

function amountFromQuote(value: { amount?: { toNumber: () => number } }): number {
  if (value.amount === undefined) {
    return 0;
  }
  return value.amount.toNumber();
}

/**
 * Mock by default (`MOCK_MODE=true` or no `CASHU_MINT_URL`).
 * Live: `@cashu/cashu-ts` Wallet — quote, receive, and melt for fetch_url.
 *
 * HTTP GET has no Lightning invoice, so tool spend melts to a mint-issued
 * bolt11 (self-pay) and does **not** remint that quote. Proofs leave the vault.
 *
 * Proofs stay in process memory and are never logged or returned on /status.
 * Persisting them across restarts is non-MVP (`TODO(cashu-mint)`): the demo
 * path is one process, mock or live.
 *
 * Tool spend melts to a fresh mint-issued bolt11 and does not remint it.
 * Proofs are selected before that invoice is created so a FakeWallet mint
 * (which marks its own invoices paid after about a second) does not win the race.
 */
export async function createCashuHandle(
  mintUrl: string | undefined,
  mock: boolean,
): Promise<CashuHandle> {
  if (mock || mintUrl === undefined) {
    logInfo("cashu", "mock wallet — not contacting a mint");
    return {
      mock: true,
      mintUrl: null,
      lastError: null,
      async createQuote(amountSats) {
        return createMockQuote(amountSats);
      },
      async settleQuote() {
        return { kind: "unpaid" };
      },
      async receiveToken() {
        throw new AgentFaultError(
          "wallet",
          "mock wallet does not receive Cashu tokens",
        );
      },
      async meltForTool() {
        throw new AgentFaultError("wallet", "mock wallet does not melt");
      },
      proofBalanceSats: () => 0,
    };
  }

  const wallet = new Wallet(mintUrl);
  const vault: Proof[] = [];
  let ready = false;
  const mintedQuoteIds = new Set<string>();
  const settleInflight = new Map<string, Promise<QuoteSettleResult>>();

  function replaceVault(next: Proof[]): void {
    vault.length = 0;
    vault.push(...next);
  }

  async function settleQuoteOnce(quoteId: string): Promise<QuoteSettleResult> {
    try {
      await ensureReady();
      const checked = await wallet.checkMintQuoteBolt11(quoteId);
      switch (checked.state) {
        case MintQuoteState.UNPAID:
          return { kind: "unpaid" };
        case MintQuoteState.ISSUED: {
          const amountSats = amountFromQuote(checked);
          logInfo("cashu", `mint quote ${quoteId} already issued`);
          return { kind: "issued", amountSats };
        }
        case MintQuoteState.PAID: {
          if (mintedQuoteIds.has(quoteId)) {
            const amountSats = amountFromQuote(checked);
            logInfo("cashu", `mint quote ${quoteId} already minted in this process`);
            return { kind: "issued", amountSats };
          }
          const amountSats = amountFromQuote(checked);
          const proofs = await wallet.mintProofsBolt11(amountSats, checked.quote);
          mintedQuoteIds.add(quoteId);
          vault.push(...proofs);
          const mintedSats = sumProofs(proofs);
          logInfo(
            "cashu",
            `minted ${mintedSats} sat (${proofs.length} proofs) — proofs not logged`,
          );
          return { kind: "paid", amountSats: mintedSats };
        }
        default:
          return assertNever(checked.state);
      }
    } catch (error) {
      handle.lastError = "mint settle failed";
      logError("cashu", error);
      return { kind: "error", message: "mint settle failed" };
    }
  }

  async function mintInvoice(amountSats: number, description: string): Promise<string> {
    try {
      const sink = await wallet.createMintQuoteBolt11(amountSats, description);
      return sink.request;
    } catch {
      const sink = await wallet.createMintQuoteBolt11(amountSats);
      return sink.request;
    }
  }

  const handle: CashuHandle = {
    mock: false,
    mintUrl,
    lastError: null,
    async createQuote(amountSats) {
      await ensureReady();
      try {
        const quote = await wallet.createMintQuoteBolt11(
          amountSats,
          "NpubBot admission",
        );
        logInfo(
          "cashu",
          `mint quote ${quote.quote} for ${amountSats} sat at ${mintUrl}`,
        );
        return {
          quoteId: quote.quote,
          amountSats,
          mock: false,
          request: quote.request,
        };
      } catch {
        try {
          const quote = await wallet.createMintQuoteBolt11(amountSats);
          logInfo(
            "cashu",
            `mint quote ${quote.quote} for ${amountSats} sat at ${mintUrl}`,
          );
          return {
            quoteId: quote.quote,
            amountSats,
            mock: false,
            request: quote.request,
          };
        } catch (retryError) {
          handle.lastError = "mint quote failed";
          logError("cashu", retryError);
          throw new AgentFaultError("mint");
        }
      }
    },
    async settleQuote(quoteId) {
      const existing = settleInflight.get(quoteId);
      if (existing) {
        return existing;
      }
      const task = settleQuoteOnce(quoteId).finally(() => {
        settleInflight.delete(quoteId);
      });
      settleInflight.set(quoteId, task);
      return task;
    },
    async receiveToken(token) {
      await ensureReady();
      try {
        const proofs = await wallet.receive(token);
        const amountSats = sumProofs(proofs);
        vault.push(...proofs);
        logInfo(
          "cashu",
          `received ${amountSats} sat (${proofs.length} proofs) — proofs not logged`,
        );
        return { amountSats };
      } catch (error) {
        handle.lastError = "token receive failed";
        logError("cashu", error);
        throw new AgentFaultError("wallet");
      }
    },
    async meltForTool(amountSats) {
      if (amountSats <= 0) {
        return {
          ok: true,
          amountSats: 0,
          feeSats: 0,
          remainingSats: sumProofs(vault),
        };
      }
      try {
        await ensureReady();
        const held = sumProofs(vault);
        if (held < amountSats) {
          return {
            ok: false,
            reason: "insufficient",
            message: `insufficient proofs (${held} sat < ${amountSats} sat)`,
          };
        }

        let active = [...vault];
        const preselect = wallet.selectProofsToSend(active, amountSats, false);
        if (sumProofs(preselect.send) < amountSats) {
          const split = await wallet.send(amountSats, active, { includeFees: true });
          if (sumProofs(split.send) < amountSats) {
            return {
              ok: false,
              reason: "wallet",
              message: "could not split proofs for melt",
            };
          }
          active = [...split.keep, ...split.send];
          replaceVault(active);
        }

        const sinkRequest = await mintInvoice(amountSats, "NpubBot fetch_url fee");
        const meltQuote = await wallet.createMeltQuoteBolt11(sinkRequest);
        const needSats = meltQuote.amount.add(meltQuote.fee_reserve).toNumber();
        if (sumProofs(active) < needSats) {
          return {
            ok: false,
            reason: "insufficient",
            message: `insufficient proofs for melt+fee (${sumProofs(active)} sat < ${needSats} sat)`,
          };
        }

        const picked = wallet.selectProofsToSend(active, needSats, false);
        const send = picked.send;
        if (sumProofs(send) < needSats) {
          return {
            ok: false,
            reason: "wallet",
            message: "could not select proofs to melt",
          };
        }
        const keep = withoutProofs(active, send);
        replaceVault(keep);

        try {
          const melted = await wallet.meltProofsBolt11(meltQuote, send);
          switch (melted.quote.state) {
            case MeltQuoteState.UNPAID:
              replaceVault([...keep, ...send]);
              handle.lastError = "melt unpaid";
              logWarn("cashu", "melt quote still unpaid — proofs kept");
              return {
                ok: false,
                reason: "wallet",
                message: "melt unpaid",
              };
            case MeltQuoteState.PENDING:
            case MeltQuoteState.PAID: {
              replaceVault([...keep, ...melted.change]);
              const remainingSats = sumProofs(vault);
              const feeSats = meltQuote.fee_reserve.toNumber();
              logInfo(
                "cashu",
                `melted ${amountSats} sat (+${feeSats} sat fee) for fetch_url self-pay; remaining ${remainingSats} sat — proofs not logged`,
              );
              handle.lastError = null;
              return { ok: true, amountSats, feeSats, remainingSats };
            }
            default:
              return assertNever(melted.quote.state);
          }
        } catch (meltError) {
          replaceVault([...keep, ...send]);
          throw meltError;
        }
      } catch (error) {
        handle.lastError = "melt failed";
        logError("cashu", error);
        return { ok: false, reason: "wallet", message: "melt failed" };
      }
    },
    proofBalanceSats: () => sumProofs(vault),
  };

  async function ensureReady(): Promise<void> {
    if (ready) {
      return;
    }
    try {
      await wallet.loadMint();
      ready = true;
      handle.lastError = null;
      logInfo("cashu", `loaded mint ${mintUrl}`);
    } catch (error) {
      handle.lastError = "mint unreachable";
      logError("cashu", error);
      throw new AgentFaultError("mint");
    }
  }

  try {
    await ensureReady();
  } catch {
    logWarn(
      "cashu",
      `mint ${mintUrl} did not load at startup — quotes will retry`,
    );
  }

  return handle;
}
