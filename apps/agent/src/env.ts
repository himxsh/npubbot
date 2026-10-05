import { config as loadEnv } from "dotenv";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentEnvSchema,
  checkAgentConfig,
  deriveMockFlags,
  type AgentEnv,
  type ConfigCheck,
} from "@npubbot/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
export const agentRoot = resolve(here, "..");
export const repoRoot = resolve(agentRoot, "../..");

loadEnv({ path: resolve(repoRoot, ".env") });
loadEnv({ path: resolve(agentRoot, ".env"), override: true });

function parseOrExit(): AgentEnv {
  let parsed: ReturnType<typeof agentEnvSchema.safeParse>;
  try {
    parsed = agentEnvSchema.safeParse(process.env);
  } catch (error) {
    // booleanFromEnv throws inside transform for values like MOCK_MODE=maybe.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[config] invalid environment: ${message}`);
    process.exit(1);
  }
  if (!parsed.success) {
    console.error("[config] invalid environment:");
    for (const issue of parsed.error.issues) {
      // Paths only — never print the offending value (it may be a secret).
      console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env: AgentEnv = parseOrExit();
export const mock = deriveMockFlags(env);
export const configCheck: ConfigCheck = checkAgentConfig(env);

export const sessionStorePath = isAbsolute(env.SESSION_STORE_PATH)
  ? env.SESSION_STORE_PATH
  : resolve(agentRoot, env.SESSION_STORE_PATH);
