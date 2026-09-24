import type { IncomingMessage } from "node:http";

const MAX_BODY_BYTES = 64_000;

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
