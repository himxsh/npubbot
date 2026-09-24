import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AgentStatus, HealthResponse } from "@npubbot/shared";
import type { AgentStore } from "../store.ts";
import type { MockFlags } from "@npubbot/shared";

export type HttpServerOptions = {
  host: string;
  port: number;
  store: AgentStore;
  mock: MockFlags;
};

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body, null, 2);
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

export async function startHttpServer(options: HttpServerOptions): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const { host, port, store, mock } = options;

  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      setCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const path = pathnameOf(req);

    switch (path) {
      case "/":
        sendJson(res, 200, {
          service: "npubbot-agent",
          endpoints: ["/health", "/status"],
        });
        return;
      case "/health": {
        const body: HealthResponse = {
          ok: true,
          service: "npubbot-agent",
          mock,
        };
        sendJson(res, 200, body);
        return;
      }
      case "/status": {
        const body: AgentStatus = store.snapshot();
        sendJson(res, 200, body);
        return;
      }
      default:
        sendJson(res, 404, { error: "not_found" });
    }
  });

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
