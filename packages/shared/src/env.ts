import { z } from "zod";

const booleanFromEnv = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    // zod v4: a missing key needs .optional(), not a z.undefined() member.
    .optional()
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
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

const commaSeparated = z
  .string()
  .optional()
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
  // Strict production flip: every subsystem (nostr + cashu + llm) must be live
  // and reachable at startup, otherwise the agent refuses to boot.
  LIVE_MODE: booleanFromEnv(false),
  // Startup reachability probes (mint loadMint, LLM /models, relay connect)
  // when a subsystem is live. Failures are fatal only under LIVE_MODE.
  LIVE_STARTUP_PROBES: booleanFromEnv(true),
  // How long LIVE_MODE waits for at least one relay to connect at boot.
  LIVE_RELAY_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15_000),
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
  LLM_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta/openai/"),
  LLM_MODEL: z.string().default("mock-npubbot"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
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

export const MOCK_LLM_MODEL = "mock-npubbot";

export type RuntimeMode = "mock" | "partial" | "live";

export function deriveRuntimeMode(flags: MockFlags): RuntimeMode {
  const mocked = [flags.nostr, flags.cashu, flags.llm].filter(Boolean).length;
  if (mocked === 0) {
    return "live";
  }
  if (mocked === 3) {
    return "mock";
  }
  return "partial";
}

/** Human-readable reason a subsystem is mocked (never includes secret values). */
export function mockReason(
  env: AgentEnv,
  subsystem: keyof MockFlags,
): string | null {
  const flags = deriveMockFlags(env);
  if (!flags[subsystem]) {
    return null;
  }
  if (env.MOCK_MODE) {
    return "MOCK_MODE=true";
  }
  switch (subsystem) {
    case "nostr":
      return "NOSTR_NSEC is empty";
    case "cashu":
      return "CASHU_MINT_URL is empty";
    case "llm":
      return "LLM_API_KEY is empty";
  }
}

export type ConfigCheck = {
  errors: string[];
  warnings: string[];
};

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function checkUrl(
  name: string,
  value: string,
  allowed: ReadonlyArray<string>,
  secureProtocol: string,
  out: ConfigCheck,
): void {
  // Regex instead of WHATWG URL: this package ships no DOM / node typings.
  const match = /^([a-z][a-z0-9+.-]*:)\/\/(\[[^\]]+\]|[^/:?#\s]+)(:\d+)?([/?#]\S*)?$/iu.exec(
    value,
  );
  if (match === null) {
    out.errors.push(`${name} is not a valid URL`);
    return;
  }
  const url = {
    protocol: (match[1] ?? "").toLowerCase(),
    hostname: (match[2] ?? "").toLowerCase(),
  };
  if (!allowed.includes(url.protocol)) {
    out.errors.push(
      `${name} must use ${allowed.map((p) => p.replace(":", "://")).join(" or ")} (got ${url.protocol}//)`,
    );
    return;
  }
  if (url.protocol !== secureProtocol && !isLocalHostname(url.hostname)) {
    out.errors.push(
      `${name} must use ${secureProtocol.replace(":", "://")} for non-local hosts`,
    );
  }
}

/**
 * Validate the live/mock configuration. Pure: never echoes secret values.
 *
 * - `LIVE_MODE=true` is strict: NOSTR_NSEC, CASHU_MINT_URL, LLM_API_KEY and a
 *   real LLM_MODEL are all required and MOCK_MODE must be false.
 * - `MOCK_MODE=false` without LIVE_MODE allows a partial flip (e.g. mint only),
 *   but malformed values are still errors and silent fallbacks become warnings.
 */
export function checkAgentConfig(env: AgentEnv): ConfigCheck {
  const out: ConfigCheck = { errors: [], warnings: [] };

  if (env.LIVE_MODE && env.MOCK_MODE) {
    out.errors.push(
      "LIVE_MODE=true conflicts with MOCK_MODE=true — set MOCK_MODE=false to go live",
    );
  }

  if (env.LIVE_MODE) {
    if (env.NOSTR_NSEC === undefined) {
      out.errors.push("NOSTR_NSEC is required in LIVE_MODE (nsec1… agent key)");
    }
    if (env.CASHU_MINT_URL === undefined) {
      out.errors.push("CASHU_MINT_URL is required in LIVE_MODE");
    }
    if (env.LLM_API_KEY === undefined) {
      out.errors.push("LLM_API_KEY is required in LIVE_MODE");
    }
    if (env.LLM_MODEL.trim() === "" || env.LLM_MODEL === MOCK_LLM_MODEL) {
      out.errors.push(
        `LLM_MODEL must name a real model in LIVE_MODE (got "${env.LLM_MODEL}")`,
      );
    }
    if (env.NOSTR_RELAYS.length === 0) {
      out.errors.push("NOSTR_RELAYS must list at least one relay in LIVE_MODE");
    }
    if (env.PAYMENT_GATE_SATS === 0) {
      out.warnings.push("PAYMENT_GATE_SATS=0 — the paywall admits everyone for free");
    }
  }

  if (!env.MOCK_MODE) {
    if (
      env.NOSTR_NSEC !== undefined &&
      !env.NOSTR_NSEC.toLowerCase().startsWith("nsec1")
    ) {
      out.errors.push("NOSTR_NSEC must be a bech32 nsec1… key (not hex / npub)");
    }
    if (env.NOSTR_NSEC !== undefined) {
      for (const relay of env.NOSTR_RELAYS) {
        checkUrl(`NOSTR_RELAYS entry "${relay}"`, relay, ["wss:", "ws:"], "wss:", out);
      }
    }
    if (env.CASHU_MINT_URL !== undefined) {
      checkUrl("CASHU_MINT_URL", env.CASHU_MINT_URL, ["https:", "http:"], "https:", out);
      if (/testnut\.cashu\.space/iu.test(env.CASHU_MINT_URL)) {
        out.warnings.push(
          "CASHU_MINT_URL is the public FakeWallet test mint — invoices auto-pay, sats are not real",
        );
      }
    }
    if (env.LLM_API_KEY !== undefined) {
      checkUrl("LLM_BASE_URL", env.LLM_BASE_URL, ["https:", "http:"], "https:", out);
      if (!env.LIVE_MODE && env.LLM_MODEL === MOCK_LLM_MODEL) {
        out.errors.push(
          `LLM_API_KEY is set but LLM_MODEL is still "${MOCK_LLM_MODEL}" — set a real model id`,
        );
      }
    }
    if (!env.LIVE_MODE) {
      for (const subsystem of ["nostr", "cashu", "llm"] as const) {
        const reason = mockReason(env, subsystem);
        if (reason !== null) {
          out.warnings.push(
            `MOCK_MODE=false but ${subsystem} stays MOCKED (${reason}). Set LIVE_MODE=true to make this fatal.`,
          );
        }
      }
    }
  }

  if (env.NODE_ENV === "production" && !env.LIVE_MODE) {
    out.warnings.push(
      "NODE_ENV=production without LIVE_MODE=true — mocked subsystems are allowed. Set LIVE_MODE=true for a strict live boot.",
    );
  }

  return out;
}
