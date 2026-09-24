import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveMockFlags, parseAgentEnv, type AgentEnv } from "@npubbot/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
const agentRoot = resolve(here, "..");
const repoRoot = resolve(agentRoot, "../..");

loadEnv({ path: resolve(repoRoot, ".env") });
loadEnv({ path: resolve(agentRoot, ".env"), override: true });

export const env: AgentEnv = parseAgentEnv(process.env);
export const mock = deriveMockFlags(env);
