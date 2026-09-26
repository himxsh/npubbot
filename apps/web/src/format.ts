import { assertNever, type PaymentState, type SessionState } from "@npubbot/shared";

export function formatSats(value: number): string {
  return `${value.toLocaleString()} sat`;
}

export function formatAgo(iso: string, now: number): string {
  const delta = Math.max(0, now - Date.parse(iso));
  if (Number.isNaN(delta)) {
    return "—";
  }
  if (delta < 1500) {
    return "just now";
  }
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function formatDelta(delta: number): string {
  if (delta > 0) {
    return `+${delta}`;
  }
  return String(delta);
}

export function shortNpub(npub: string): string {
  if (npub.length <= 20) {
    return npub;
  }
  return `${npub.slice(0, 12)}…${npub.slice(-8)}`;
}

export function paymentStateText(state: PaymentState): string {
  switch (state.kind) {
    case "unpaid":
      return "unpaid";
    case "pending":
      return "pending";
    case "paid":
      return "paid";
    case "failed":
      return `failed · ${state.reason}`;
    default:
      return assertNever(state);
  }
}

export function sessionStateText(state: SessionState): string {
  switch (state) {
    case "pending":
      return "pending";
    case "paid":
      return "paid";
    case "expired":
      return "expired";
    default:
      return assertNever(state);
  }
}

export function requestKind(request: string, mockCashu: boolean): string {
  if (mockCashu || request.startsWith("cashu:mock:")) {
    return "Mock quote";
  }
  if (request === "cashu:received") {
    return "Cashu receive";
  }
  if (request.startsWith("ln")) {
    return "Lightning invoice";
  }
  return "Payment request";
}
