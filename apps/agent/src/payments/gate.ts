import { assertNever } from "@npubbot/shared";

export type GateDecision =
  | { kind: "allow"; paidSats: number }
  | { kind: "require_payment"; amountSats: number };

export function evaluateAdmission(input: {
  paidSats: number;
  requiredSats: number;
}): GateDecision {
  if (input.paidSats >= input.requiredSats) {
    return { kind: "allow", paidSats: input.paidSats };
  }
  return { kind: "require_payment", amountSats: input.requiredSats };
}

export function describeGateDecision(decision: GateDecision): string {
  switch (decision.kind) {
    case "allow":
      return `admission paid (${decision.paidSats} sat)`;
    case "require_payment":
      return `full reply gated — send ${decision.amountSats} sat`;
    default:
      return assertNever(decision);
  }
}

/**
 * Placeholder the agent would attach to an unpaid Nostr reply.
 * Live quotes come from `createAdmissionQuote` / `@cashu/cashu-ts`.
 */
export function mockPaymentRequest(amountSats: number): string {
  return `cashu:mock-admission-${amountSats}sat`;
}
