import { assertNever } from "@npubbot/shared";

export type ToolIntent =
  | { kind: "chat" }
  | { kind: "fetch_url"; url: string }
  | { kind: "fetch_url_missing" };

const TOOL_HINT =
  /\b(fetch|lookup|look\s*up|search|retrieve|scrape|download|curl)\b/i;

export function extractHttpUrl(text: string): string | undefined {
  const match = /https?:\/\/[^\s<>"'\]\)]+/i.exec(text);
  const raw = match?.[0];
  if (raw === undefined) {
    return undefined;
  }
  return raw.replace(/[.,;:!?]+$/u, "");
}

export function routeIntent(text: string): ToolIntent {
  const url = extractHttpUrl(text);
  if (url !== undefined) {
    return { kind: "fetch_url", url };
  }
  if (TOOL_HINT.test(text)) {
    return { kind: "fetch_url_missing" };
  }
  return { kind: "chat" };
}

export function describeIntent(intent: ToolIntent): string {
  switch (intent.kind) {
    case "chat":
      return "chat";
    case "fetch_url":
      return `fetch_url ${intent.url}`;
    case "fetch_url_missing":
      return "fetch_url (no url)";
    default:
      return assertNever(intent);
  }
}
