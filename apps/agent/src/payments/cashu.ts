import {
  MeltQuoteState,
  MintQuoteState,
  Wallet,
  normalizeProofAmounts,
  type Proof,
  type ProofLike,
} from "@cashu/cashu-ts";
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

/** Disk vault. Mock handles must not call it. */
export type ProofPersistence = {
  readonly enabled: boolean;
  load(): Promise<unknown>;
  save(payload: unknown): Promise<void>;
};

export type CashuHandle = {
  readonly mock: boolean;
  readonly mintUrl: string | null;
  /** True only when a live vault loaded and will be rewritten after spends. */
  readonly persisted: boolean;
  lastError: string | null;
  createQuote: (amountSats: number) => Promise<AdmissionQuote>;
  settleQuote: (quoteId: string) => Promise<QuoteSettleResult>;
  receiveToken: (token: string) => Promise<CashuReceiveResult>;
  meltForTool: (amountSats: number) => Promise<MeltForToolResult>;
  proofBalanceSats: () => number;
  /** Live: mint keys loaded (loadMint succeeded). Mock: always true. */
  isReady: () => boolean;
  /** Live: retry loadMint now. Resolves true when the mint is reachable. */
  ensureReady: () => Promise<boolean>;
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

function encodeProofs(proofs: Proof[]): unknown[] {
  return proofs.map((proof) => ({
    ...proof,
    amount: proof.amount.toNumber(),
  }));
}

function decodeProofs(payload: unknown): Proof[] {
  if (!Array.isArray(payload)) {
    throw new Error("proof vault payload is not a list");
  }
  if (payload.length === 0) {
    return [];
  }
  return normalizeProofAmounts(payload as ProofLike[]);
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
 * Proofs are never logged or returned on /status. When `persistence` is
 * enabled they are rewritten after each mint, receive, or melt. Mock mode
 * returns before that handle is touched, so it never reads or writes the file.
 */
export async function createCashuHandle(
  mintUrl: string | undefined,
  mock: boolean,
  persistence?: ProofPersistence,
): Promise<CashuHandle> {
  if (mock || mintUrl === undefined) {
    logInfo("cashu", "mock wallet — not contacting a mint");
    return {
      mock: true,
      mintUrl: null,
      persisted: false,
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
      isReady: () => true,
      ensureReady: async () => true,
    };
  }

  const wallet = new Wallet(mintUrl);
  const vault: Proof[] = [];
  let ready = false;
  let persisted = false;
  let vaultError: string | null = null;

  if (persistence?.enabled) {
    try {
      const loaded = decodeProofs(await persistence.load());
      vault.push(...loaded);
      persisted = true;
      const sats = sumProofs(vault);
      logInfo(
        "cashu",
        loaded.length === 0
          ? "encrypted proof vault empty"
          : `restored ${loaded.length} proofs (${sats} sat) from encrypted vault`,
      );
    } catch (error) {
      persisted = false;
      vaultError = "proof vault unreadable — not overwriting";
      logError("cashu", error);
    }
  }

  function replaceVault(next: Proof[]): void {
    vault.length = 0;
    vault.push(...next);
  }

  async function persist(): Promise<void> {
    if (!persisted || persistence === undefined) {
      return;
    }
    try {
      await persistence.save(encodeProofs(vault));
      if (handle.lastError === "proof vault save failed") {
        handle.lastError = vaultError;
      }
    } catch (error) {
      handle.lastError = "proof vault save failed";
      logError("cashu", error);
    }
  }

  const handle: CashuHandle = {
    mock: false,
    mintUrl,
    persisted,
    lastError: vaultError,
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
            await persist();
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
        await persist();
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

        let sinkRequest: string;
        try {
          const sink = await wallet.createMintQuoteBolt11(
            amountSats,
            "NpubBot fetch_url fee",
          );
          sinkRequest = sink.request;
        } catch {
          const sink = await wallet.createMintQuoteBolt11(amountSats);
          sinkRequest = sink.request;
        }

        const meltQuote = await wallet.createMeltQuoteBolt11(sinkRequest);
        const need = meltQuote.amount.add(meltQuote.fee_reserve);
        const needSats = need.toNumber();
        if (held < needSats) {
          return {
            ok: false,
            reason: "insufficient",
            message: `insufficient proofs for melt+fee (${held} sat < ${needSats} sat)`,
          };
        }

        const { keep, send } = await wallet.send(need, vault, {
          includeFees: true,
        });
        replaceVault([...keep, ...send]);

        const melted = await wallet.meltProofsBolt11(meltQuote, send);
        switch (melted.quote.state) {
          case MeltQuoteState.UNPAID:
            handle.lastError = "melt unpaid";
            logWarn("cashu", "melt quote still unpaid — proofs kept");
            await persist();
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
            handle.lastError = vaultError;
            await persist();
            return { ok: true, amountSats, feeSats, remainingSats };
          }
          default:
            return assertNever(melted.quote.state);
        }
      } catch (error) {
        handle.lastError = "melt failed";
        logError("cashu", error);
        await persist();
        return { ok: false, reason: "wallet", message: "melt failed" };
      }
    },
    proofBalanceSats: () => sumProofs(vault),
    isReady: () => ready,
    ensureReady: async () => {
      try {
        await ensureReady();
        return true;
      } catch {
        return false;
      }
    },
  };

  async function ensureReady(): Promise<void> {
    if (ready) {
      return;
    }
    try {
      await wallet.loadMint();
      ready = true;
      handle.lastError = vaultError;
      logInfo("cashu", `loaded mint ${mintUrl}`);
    } catch (error) {
      handle.lastError =
        vaultError === null
          ? "mint unreachable"
          : `${vaultError}; mint unreachable`;
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
