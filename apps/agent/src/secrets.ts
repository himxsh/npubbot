const REDACTED = "[redacted]";

const PATTERNS: ReadonlyArray<RegExp> = [
  /\bnsec1[02-9ac-hj-np-z]+/giu,
  /\bcashu[AB][A-Za-z0-9+/=_-]{16,}/gu,
  /\bsk-[A-Za-z0-9_-]{10,}/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu,
  /"(?:secret|C|proofs|nsec|apiKey|api_key)"\s*:\s*"[^"]*"/giu,
];

const SECRET_KEYS = new Set([
  "nsec",
  "NOSTR_NSEC",
  "secretKey",
  "secret",
  "apiKey",
  "LLM_API_KEY",
  "proofs",
  "token",
  "cashuToken",
  "C",
]);

export function redactSecrets(input: string): string {
  let next = input;
  for (const pattern of PATTERNS) {
    next = next.replace(pattern, REDACTED);
  }
  return next;
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(record)) {
      if (SECRET_KEYS.has(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactUnknown(inner);
    }
    return out;
  }
  return value;
}

export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  return value;
}

export function logInfo(scope: string, message: string): void {
  console.info(`[${scope}] ${redactSecrets(message)}`);
}

export function logWarn(scope: string, message: string): void {
  console.warn(`[${scope}] ${redactSecrets(message)}`);
}

export function logError(scope: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[${scope}] ${redactSecrets(error.message)}`);
    if (error.stack !== undefined) {
      console.error(redactSecrets(error.stack));
    }
    return;
  }
  console.error(`[${scope}] ${redactSecrets(String(error))}`);
}
