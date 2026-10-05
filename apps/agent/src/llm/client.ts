import { AgentFaultError, isTimeoutError } from "../errors.ts";

export type LlmCompleteInput = {
  system: string;
  user: string;
};

export type LlmCompleteOutput = {
  text: string;
  model: string;
  mock: boolean;
};

export type LlmProbeResult =
  | { ok: true; detail: string }
  | { ok: false; fatal: boolean; detail: string };

export type LlmClient = {
  readonly mock: boolean;
  readonly model: string;
  /** Host only (no path / key), for honest status reporting. */
  readonly endpointHost: string | null;
  /** Last live call / probe error (redacted, no key). Null after a success. */
  lastError: string | null;
  lastOkAt: string | null;
  complete(input: LlmCompleteInput): Promise<LlmCompleteOutput>;
  /** Live: GET {base}/models with the key. Mock: always ok. */
  probe(): Promise<LlmProbeResult>;
};

const SYSTEM_PROMPT =
  "You are NpubBot, a Nostr-native assistant. The user has paid a small Cashu admission. Answer helpfully and concisely. Do not mention invoices, quotes, or payment.";

function readChoiceContent(data: unknown): string {
  if (typeof data !== "object" || data === null) {
    throw new Error("LLM response was not an object");
  }
  if (!("choices" in data) || !Array.isArray(data.choices)) {
    throw new Error("LLM response missing choices");
  }
  const first = data.choices[0] as unknown;
  if (typeof first !== "object" || first === null || !("message" in first)) {
    throw new Error("LLM response missing message");
  }
  const message = first.message;
  if (typeof message !== "object" || message === null || !("content" in message)) {
    throw new Error("LLM response missing content");
  }
  const content = message.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("LLM response content was empty");
  }
  return content.trim();
}

function hostOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

export function createLlmClient(options: {
  mock: boolean;
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}): LlmClient {
  const { mock, apiKey, baseUrl, model } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;

  if (mock || apiKey === undefined) {
    return {
      mock: true,
      model,
      endpointHost: null,
      lastError: null,
      lastOkAt: null,
      async probe() {
        return { ok: true, detail: "mock llm" };
      },
      async complete(input) {
        return {
          mock: true,
          model,
          text: `[mock llm] ${input.user.slice(0, 500)}`,
        };
      },
    };
  }

  const root = baseUrl.replace(/\/$/, "");
  const endpoint = `${root}/chat/completions`;

  const client: LlmClient = {
    mock: false,
    model,
    endpointHost: hostOf(baseUrl),
    lastError: null,
    lastOkAt: null,
    async probe() {
      let response: Response;
      try {
        response = await fetch(`${root}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
        });
      } catch (error) {
        const detail = isTimeoutError(error)
          ? "LLM probe timed out"
          : "LLM endpoint unreachable";
        client.lastError = detail;
        return { ok: false, fatal: true, detail };
      }
      if (response.status === 401 || response.status === 403) {
        const detail = `LLM rejected LLM_API_KEY (HTTP ${response.status})`;
        client.lastError = detail;
        return { ok: false, fatal: true, detail };
      }
      if (!response.ok) {
        // Some OpenAI-compatible providers do not implement /models.
        return {
          ok: false,
          fatal: false,
          detail: `LLM /models returned HTTP ${response.status} (not all providers implement it)`,
        };
      }
      client.lastError = null;
      client.lastOkAt = new Date().toISOString();
      return { ok: true, detail: `LLM key accepted by ${client.endpointHost ?? "endpoint"}` };
    },
    async complete(input) {
      try {
        const out = await callLive(input);
        client.lastError = null;
        client.lastOkAt = new Date().toISOString();
        return out;
      } catch (error) {
        client.lastError =
          error instanceof Error ? error.message : "LLM request failed";
        throw error;
      }
    },
  };

  async function callLive(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: input.user },
            ],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new AgentFaultError("llm", "LLM request timed out");
        }
        throw new AgentFaultError("llm");
      }
      if (!response.ok) {
        throw new AgentFaultError("llm", `LLM HTTP ${response.status}`);
      }
      try {
        const text = readChoiceContent(await response.json());
        return { mock: false, model, text };
      } catch {
        throw new AgentFaultError("llm", "LLM response malformed");
      }
  }

  return client;
}

export function paidSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
