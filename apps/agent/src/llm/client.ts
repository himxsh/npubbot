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
  complete(input: LlmCompleteInput): Promise<LlmCompleteOutput>;
};

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
      async complete(input) {
        return {
          mock: true,
          model,
          text: `mock reply to: ${input.user.slice(0, 140)}`,
        };
      },
    };
  }

  return {
    mock: false,
    async complete() {
      void apiKey;
      void baseUrl;
      throw new Error(
        "TODO: live OpenAI-compatible LLM client is not wired in this scaffold",
      );
    },
  };
}
