import { z } from "zod";

const booleanFromEnv = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string(), z.undefined()])
    .transform((value): boolean => {
      if (typeof value === "boolean") {
        return value;
      }
      if (value === undefined || value.trim() === "") {
        return fallback;
      }
      const normalized = value.trim().toLowerCase();
      switch (normalized) {
        case "true":
        case "1":
        case "yes":
        case "on":
          return true;
        case "false":
        case "0":
        case "no":
        case "off":
          return false;
        default:
          throw new Error(`Expected a boolean env value, received "${value}"`);
      }
    });

const optionalString = z
  .union([z.string(), z.undefined()])
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

const commaSeparated = z
  .union([z.string(), z.undefined()])
  .transform((value) => {
    const source =
      value === undefined || value.trim() === ""
        ? "wss://relay.damus.io,wss://nos.lol"
        : value;
    return source
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  });

export const agentEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  MOCK_MODE: booleanFromEnv(true),
  AGENT_HTTP_HOST: z.string().default("127.0.0.1"),
  AGENT_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3847),
  NOSTR_RELAYS: commaSeparated,
  NOSTR_NSEC: optionalString,
  CASHU_MINT_URL: optionalString,
  PAYMENT_GATE_SATS: z.coerce.number().int().nonnegative().default(21),
  TOOL_SPEND_SATS: z.coerce.number().int().nonnegative().default(10),
  TOOL_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  MOCK_BALANCE_SATS: z.coerce.number().int().nonnegative().default(210),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  UNPAID_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(10_000),
  SESSION_STORE_PATH: z.string().default("data/sessions.json"),
  LLM_API_KEY: optionalString,
  LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().default("mock-npubbot"),
});

export type AgentEnv = z.infer<typeof agentEnvSchema>;

export const webEnvSchema = z.object({
  VITE_AGENT_BASE_URL: z.string().default("/agent"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseAgentEnv(
  raw: Record<string, string | undefined>,
): AgentEnv {
  return agentEnvSchema.parse(raw);
}

export function parseWebEnv(
  raw: Record<string, string | undefined>,
): WebEnv {
  return webEnvSchema.parse(raw);
}

export type MockFlags = {
  nostr: boolean;
  cashu: boolean;
  llm: boolean;
};

export function deriveMockFlags(env: AgentEnv): MockFlags {
  return {
    nostr: env.MOCK_MODE || env.NOSTR_NSEC === undefined,
    cashu: env.MOCK_MODE || env.CASHU_MINT_URL === undefined,
    llm: env.MOCK_MODE || env.LLM_API_KEY === undefined,
  };
}
