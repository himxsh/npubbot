import type { AdmissionQuote, CashuHandle } from "./cashu.ts";

export type { AdmissionQuote } from "./cashu.ts";

export async function createAdmissionQuote(
  handle: CashuHandle,
  amountSats: number,
): Promise<AdmissionQuote> {
  return handle.createQuote(amountSats);
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
  } else {
    lines.push(
      "Live mint: pay the Lightning invoice. The agent notices payment automatically. You can also send a Cashu token (cashuA/cashuB) in a mention.",
    );
  }
  return lines.join("\n");
}
