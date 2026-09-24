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

export type LlmClient = {
  readonly mock: boolean;
  readonly model: string;
  complete(input: LlmCompleteInput): Promise<LlmCompleteOutput>;
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

export function createLlmClient(options: {
  mock: boolean;
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
}): LlmClient {
  const { mock, apiKey, baseUrl, model } = options;

  if (mock || apiKey === undefined) {
    return {
      mock: true,
      model,
      async complete(input) {
        return {
          mock: true,
          model,
          text: `[mock llm] ${input.user.slice(0, 500)}`,
        };
      },
    };
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  return {
    mock: false,
    model,
    async complete(input) {
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
          signal: AbortSignal.timeout(30_000),
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
        throw new AgentFaultError("llm");
      }
    },
  };
}

export function paidSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
