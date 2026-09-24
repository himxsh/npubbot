import { config as loadEnv } from "dotenv";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveMockFlags, parseAgentEnv, type AgentEnv } from "@npubbot/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
export const agentRoot = resolve(here, "..");
export const repoRoot = resolve(agentRoot, "../..");

loadEnv({ path: resolve(repoRoot, ".env") });
loadEnv({ path: resolve(agentRoot, ".env"), override: true });

export const env: AgentEnv = parseAgentEnv(process.env);
export const mock = deriveMockFlags(env);

export const sessionStorePath = isAbsolute(env.SESSION_STORE_PATH)
  ? env.SESSION_STORE_PATH
  : resolve(agentRoot, env.SESSION_STORE_PATH);
