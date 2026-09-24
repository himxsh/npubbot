import { MintQuoteState, Wallet, type Proof } from "@cashu/cashu-ts";
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

export type CashuHandle = {
  readonly mock: boolean;
  readonly mintUrl: string | null;
  lastError: string | null;
  createQuote: (amountSats: number) => Promise<AdmissionQuote>;
  settleQuote: (quoteId: string) => Promise<QuoteSettleResult>;
  receiveToken: (token: string) => Promise<CashuReceiveResult>;
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

function amountFromQuote(value: { amount?: { toNumber: () => number } }): number {
  if (value.amount === undefined) {
    return 0;
  }
  return value.amount.toNumber();
}

/**
 * Mock by default (`MOCK_MODE=true` or no `CASHU_MINT_URL`).
 * Live: `@cashu/cashu-ts` Wallet against `CASHU_MINT_URL` — quote + receive.
 *
 * Proofs stay in a WeakMap vault and are never logged or returned on /status.
 *
 * TODO(cashu-mint): persist proofs encrypted at rest; meltProofsBolt11 when
 * fetch_url has a Lightning sink (no LN invoice for the HTTP GET today).
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
      proofBalanceSats: () => 0,
    };
  }

  const wallet = new Wallet(mintUrl);
  const vault: Proof[] = [];
  let ready = false;
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
            const amountSats = amountFromQuote(checked);
            const proofs = await wallet.mintProofsBolt11(amountSats, checked.quote);
            vault.push(...proofs);
            logInfo(
              "cashu",
              `minted ${amountSats} sat (${proofs.length} proofs) — proofs not logged`,
            );
            return { kind: "paid", amountSats };
          }
          default:
            return assertNever(checked.state);
        }
      } catch (error) {
        handle.lastError = "mint settle failed";
        logError("cashu", error);
        return { kind: "error", message: "mint settle failed" };
      }
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
