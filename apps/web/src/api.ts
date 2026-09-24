import type {
  AgentStatus,
  HealthResponse,
  InboundDevResponse,
  MarkPaidResponse,
} from "@npubbot/shared";

const base = (import.meta.env.VITE_AGENT_BASE_URL ?? "/agent").replace(
  /\/$/,
  "",
);

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${base}${path}`, { signal });
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }
  return response.json();
}

async function postJson(
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `${path} failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return (await getJson("/health", signal)) as HealthResponse;
}

export async function fetchStatus(signal?: AbortSignal): Promise<AgentStatus> {
  return (await getJson("/status", signal)) as AgentStatus;
}

export async function injectMockMention(
  text: string,
  senderNpub?: string,
): Promise<InboundDevResponse> {
  return (await postJson("/dev/inbound", {
    text,
    senderNpub,
  })) as InboundDevResponse;
}

export async function markInvoicePaid(
  quoteId: string,
): Promise<MarkPaidResponse> {
  return (await postJson("/dev/mark-paid", { quoteId })) as MarkPaidResponse;
}
