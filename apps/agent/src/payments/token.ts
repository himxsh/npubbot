const CASHU_TOKEN = /\bcashu[AB][A-Za-z0-9+/=_-]{16,}/u;

export function extractCashuToken(text: string): string | undefined {
  return CASHU_TOKEN.exec(text)?.[0];
}

export function stripCashuTokens(text: string): string {
  return text.replace(CASHU_TOKEN, "[cashu-token]");
}
