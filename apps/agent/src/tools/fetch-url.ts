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

const MAX_REDIRECTS = 3;

/**
 * Null when the URL is a public http(s) target. Used before spending sats
 * and again on every redirect hop.
 */
export function publicUrlError(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "invalid URL";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "only http/https URLs are allowed";
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "URLs with credentials are not allowed";
  }
  if (isBlockedHost(parsed.hostname)) {
    return "refusing private or loopback host";
  }
  return null;
}

function isRedirect(status: number): boolean {
  switch (status) {
    case 301:
    case 302:
    case 303:
    case 307:
    case 308:
      return true;
    default:
      return false;
  }
}

/**
 * One paid tool: HTTP GET with timeout. Blocks loopback/private hosts,
 * including redirects that hop onto those hosts.
 */
export async function fetchUrl(
  url: string,
  timeoutMs: number,
): Promise<FetchUrlResult> {
  const initialError = publicUrlError(url);
  if (initialError !== null) {
    return { ok: false, url, error: initialError };
  }

  let parsed = new URL(url);
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(parsed, {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
        },
        signal,
      });

      if (isRedirect(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get("location");
        if (location === null || location.trim() === "") {
          return {
            ok: false,
            url: parsed.toString(),
            error: "redirect missing location",
          };
        }
        const next = new URL(location, parsed);
        const nextError = publicUrlError(next.toString());
        if (nextError !== null) {
          return { ok: false, url: next.toString(), error: nextError };
        }
        if (hop === MAX_REDIRECTS) {
          return { ok: false, url: next.toString(), error: "too many redirects" };
        }
        parsed = next;
        continue;
      }

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
    }
    return { ok: false, url: parsed.toString(), error: "too many redirects" };
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
