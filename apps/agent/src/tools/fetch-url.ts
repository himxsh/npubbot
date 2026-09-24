import { isIP } from "node:net";
import { isTimeoutError } from "../errors.ts";

export type FetchUrlResult =
  | { ok: true; url: string; status: number; contentType: string; text: string }
  | { ok: false; url: string; error: string };

const MAX_CHARS = 4_000;

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return true;
  }

  const ip = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map((part) => Number(part));
    const a = parts[0];
    const b = parts[1];
    if (a === undefined || b === undefined) {
      return true;
    }
    if (a === 10 || a === 127 || a === 0) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
  }
  if (isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80")) {
      return true;
    }
  }
  return false;
}

function stripMarkup(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * One paid tool: HTTP GET with timeout. Blocks loopback/private hosts.
 */
export async function fetchUrl(
  url: string,
  timeoutMs: number,
): Promise<FetchUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, url, error: "invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, url, error: "only http/https URLs are allowed" };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, url, error: "refusing private or loopback host" };
  }

  try {
    const response = await fetch(parsed, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentType = response.headers.get("content-type") ?? "unknown";
    const raw = (await response.text()).slice(0, MAX_CHARS * 2);
    const text = stripMarkup(raw).slice(0, MAX_CHARS);
    if (!response.ok) {
      return {
        ok: false,
        url: parsed.toString(),
        error: `HTTP ${response.status} ${text.slice(0, 200)}`.trim(),
      };
    }
    return {
      ok: true,
      url: parsed.toString(),
      status: response.status,
      contentType,
      text: text.length > 0 ? text : "(empty body)",
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      return { ok: false, url: parsed.toString(), error: "timeout" };
    }
    const message = error instanceof Error ? error.message : "fetch failed";
    return { ok: false, url: parsed.toString(), error: message };
  }
}

export function formatFetchResult(result: FetchUrlResult): string {
  if (result.ok) {
    return `fetch_url ${result.url} → HTTP ${result.status} (${result.contentType})\n${result.text}`;
  }
  return `fetch_url ${result.url} failed: ${result.error}`;
}
