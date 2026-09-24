import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  inboundDevRequestSchema,
  markPaidRequestSchema,
  type AgentStatus,
  type HealthResponse,
  type MockFlags,
} from "@npubbot/shared";
import { ZodError } from "zod";
import type { AgentStore } from "../store.ts";
import type { Inbox } from "../inbox.ts";
import type { LlmClient } from "../llm/client.ts";
import { isLoopbackHost, readJsonBody } from "./body.ts";
import { jsonReplacer, logError, redactSecrets } from "../secrets.ts";

export type HttpServerOptions = {
  host: string;
  port: number;
  store: AgentStore;
  mock: MockFlags;
  inbox: Inbox;
  llm: LlmClient;
};

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body, jsonReplacer, 2);
  setCors(res);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function pathnameOf(req: IncomingMessage): string {
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  return url.pathname;
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return "unknown error";
}

export async function startHttpServer(options: HttpServerOptions): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const { host, port, store, mock, inbox, llm } = options;
  const devEnabled = isLoopbackHost(host);

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (req.method === "OPTIONS") {
      setCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const path = pathnameOf(req);
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && path === "/") {
        sendJson(res, 200, {
          service: "npubbot-agent",
          endpoints: [
            "/health",
            "/status",
            "/dev/inbound",
            "/dev/mark-paid",
          ],
        });
        return;
      }

      if (method === "GET" && path === "/health") {
        const body: HealthResponse = {
          ok: true,
          service: "npubbot-agent",
          mock,
          inbox: store.getInbox(),
          llm: { mock: llm.mock, model: llm.model },
        };
        sendJson(res, 200, body);
        return;
      }

      if (method === "GET" && path === "/status") {
        const body: AgentStatus = store.snapshot();
        sendJson(res, 200, body);
        return;
      }

      if (method === "POST" && path === "/dev/inbound") {
        if (!devEnabled) {
          sendJson(res, 403, { error: "dev_endpoints_loopback_only" });
          return;
        }
        const raw = await readJsonBody(req);
        inboundDevRequestSchema.parse(raw);
        const result = await inbox.injectDevMention(raw);
        sendJson(res, 200, result);
        return;
      }

      if (method === "POST" && path === "/dev/mark-paid") {
        if (!devEnabled) {
          sendJson(res, 403, { error: "dev_endpoints_loopback_only" });
          return;
        }
        const raw = await readJsonBody(req);
        const body = markPaidRequestSchema.parse(raw);
        const result = await inbox.markPaid(body.quoteId);
        sendJson(res, 200, result);
        return;
      }

      if (method === "POST" || method === "GET") {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      sendJson(res, 405, { error: "method_not_allowed" });
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof ZodError) {
        sendJson(res, 400, { error: message });
        return;
      }
      if (message.startsWith("unknown quote")) {
        sendJson(res, 404, { error: message });
        return;
      }
      if (message === "quote expired" || message === "mint quote unpaid") {
        sendJson(res, 409, { error: message });
        return;
      }
      logError("http", error);
      sendJson(res, 500, { error: message });
    }
  }

  const url = `http://${host}:${port}`;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve();
    });
  });

  return {
    url,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      }),
  };
}
