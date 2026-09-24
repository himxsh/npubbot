import { assertNever } from "@npubbot/shared";
import { redactSecrets } from "./secrets.ts";

export type FaultKind =
  | "relay"
  | "mint"
  | "wallet"
  | "llm"
  | "tool"
  | "tool-timeout"
  | "insufficient-balance"
  | "unknown";

export class AgentFaultError extends Error {
  readonly fault: FaultKind;

  constructor(fault: FaultKind, detail?: string) {
    super(detail ?? faultMessage(fault));
    this.fault = fault;
    this.name = "AgentFaultError";
  }
}

function faultMessage(kind: FaultKind): string {
  switch (kind) {
    case "relay":
      return "NpubBot couldn't reach Nostr relays just now. The operator dashboard still recorded the reply; try again shortly.";
    case "mint":
      return "NpubBot's Cashu mint is unreachable, so a payment quote can't be issued. Try again in a bit.";
    case "wallet":
      return "NpubBot couldn't complete a Cashu wallet operation. No extra sats were taken. Try again shortly.";
    case "llm":
      return "NpubBot's language model is down. If you already paid, your session still stands — send the prompt again in a minute.";
    case "tool":
      return "fetch_url failed. The agent already spent sats on the attempt; try another public http(s) URL.";
    case "tool-timeout":
      return "fetch_url timed out. The agent still spent sats on the attempt; try a smaller page.";
    case "insufficient-balance":
      return "NpubBot can't afford fetch_url from its wallet right now.";
    case "unknown":
      return "NpubBot hit an unexpected error and skipped this turn. Try again.";
    default:
      return assertNever(kind);
  }
}

export function userFacingMessage(kind: FaultKind, detail?: string): string {
  const base = faultMessage(kind);
  if (kind === "tool" && detail !== undefined && detail !== "timeout") {
    return `${base} (${redactSecrets(detail)})`;
  }
  return base;
}

export function userFacingFromError(error: unknown): string {
  if (error instanceof AgentFaultError) {
    return userFacingMessage(error.fault);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/LLM HTTP|LLM response/i.test(message)) {
    return userFacingMessage("llm");
  }
  if (/mint quote unpaid/i.test(message)) {
    return "That Lightning invoice is still unpaid. Pay it, then wait a few seconds.";
  }
  if (/mint|cashu/i.test(message)) {
    return userFacingMessage("mint");
  }
  if (/relay|websocket/i.test(message)) {
    return userFacingMessage("relay");
  }
  return userFacingMessage("unknown");
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /timeout|aborted/i.test(error.message)
    );
  }
  return false;
}
