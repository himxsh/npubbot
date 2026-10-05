/**
 * `pnpm live:check` — validate .env without booting relays / mint / LLM.
 * Prints which subsystems would be live vs mocked and every missing secret.
 * Never prints secret values. Exit 1 when the agent would refuse to start.
 */
import { deriveRuntimeMode, mockReason } from "@npubbot/shared";
import { configCheck, env, mock } from "./env.ts";

const mode = deriveRuntimeMode(mock);
const present = (value: string | undefined) => (value === undefined ? "MISSING" : "set");

console.log(`mode:        ${mode}${env.LIVE_MODE ? " (LIVE_MODE strict)" : ""}`);
console.log(`NODE_ENV:    ${env.NODE_ENV}`);
console.log(`MOCK_MODE:   ${env.MOCK_MODE}`);
console.log(`LIVE_MODE:   ${env.LIVE_MODE}`);
console.log("");
for (const subsystem of ["nostr", "cashu", "llm"] as const) {
  const reason = mockReason(env, subsystem);
  console.log(`${subsystem.padEnd(6)} ${reason === null ? "LIVE" : `mock  (${reason})`}`);
}
console.log("");
console.log(`NOSTR_NSEC      ${present(env.NOSTR_NSEC)}`);
console.log(`NOSTR_RELAYS    ${env.NOSTR_RELAYS.join(", ") || "MISSING"}`);
console.log(`CASHU_MINT_URL  ${env.CASHU_MINT_URL ?? "MISSING"}`);
console.log(`LLM_API_KEY     ${present(env.LLM_API_KEY)}`);
console.log(`LLM_BASE_URL    ${env.LLM_BASE_URL}`);
console.log(`LLM_MODEL       ${env.LLM_MODEL || "MISSING"}`);
console.log("");
for (const warning of configCheck.warnings) {
  console.log(`warn:  ${warning}`);
}
for (const error of configCheck.errors) {
  console.log(`ERROR: ${error}`);
}
if (configCheck.errors.length > 0) {
  console.log("\nnot ready — the agent will refuse to start with this .env");
  process.exit(1);
}
console.log(
  env.LIVE_MODE
    ? "\nconfig OK — `pnpm agent` will still probe mint, LLM and relays before serving"
    : "\nconfig OK",
);
