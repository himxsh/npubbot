import { newId } from "../ids.ts";
import type { CashuHandle } from "./cashu.ts";

export type AdmissionQuote = {
  quoteId: string;
  amountSats: number;
  request: string;
  mock: boolean;
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

/**
 * TODO(cashu-mint): Call wallet.loadMint() then createMintQuoteBolt11(amount)
 * and return the mint quote id + lightning invoice / Cashu request.
 * Never log the paid token or proofs.
 */
async function createMintQuote(
  handle: Extract<CashuHandle, { mock: false }>,
  amountSats: number,
): Promise<AdmissionQuote> {
  void handle.wallet;
  console.info(
    `[cashu] TODO(cashu-mint): createMintQuoteBolt11(${amountSats}) at ${handle.mintUrl}`,
  );
  const mock = createMockQuote(amountSats);
  return {
    ...mock,
    mock: false,
    request: `cashu:todo-mint:${mock.quoteId}:${amountSats}sat`,
  };
}

export async function createAdmissionQuote(
  handle: CashuHandle,
  amountSats: number,
): Promise<AdmissionQuote> {
  if (handle.mock) {
    return createMockQuote(amountSats);
  }
  return createMintQuote(handle, amountSats);
}

export function paywallMessage(input: {
  amountSats: number;
  quoteId: string;
  request: string;
  mock: boolean;
}): string {
  const lines = [
    `NpubBot unlocks a full reply for ${input.amountSats} sat.`,
    `Quote: ${input.quoteId}`,
    `Pay: ${input.request}`,
  ];
  if (input.mock) {
    lines.push(
      "Mock mint: an operator can mark this quote paid on the localhost dashboard.",
    );
  }
  return lines.join("\n");
}
