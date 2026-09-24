import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";
import type { AgentStore } from "../store.ts";
import type { AgentIdentity } from "./identity.ts";
import { decryptDirectMessage } from "./encryption.ts";

let nodeWebSocketInstalled = false;

function ensureNodeWebSocket(): void {
  if (nodeWebSocketInstalled) {
    return;
  }
  useWebSocketImplementation(WebSocket);
  nodeWebSocketInstalled = true;
}

function seedMockEvents(store: AgentStore, agentNpub: string): void {
  const now = Date.now();
  store.recordEvent({
    id: "mock-evt-mention",
    kind: 1,
    label: "mention",
    from: "npub1mockaskerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    summary: `gm ${agentNpub.slice(0, 12)}… — what's the mempool saying?`,
    createdAt: new Date(now - 90_000).toISOString(),
    gated: true,
  });
  store.recordEvent({
    id: "mock-evt-dm",
    kind: 4,
    label: "dm",
    from: "npub1mockpayerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    summary: "[encrypted dm stub] paywalled prompt held until Cashu receipt",
    createdAt: new Date(now - 45_000).toISOString(),
    gated: true,
  });
}

export type StopNostrListener = () => void;

/**
 * Mock: seed dashboard events, no sockets.
 * Live (still a stub this pass): construct SimplePool so the import path is
 * real, but do not subscribe or publish yet.
 */
export function startNostrListener(options: {
  identity: AgentIdentity;
  relays: string[];
  mock: boolean;
  store: AgentStore;
}): StopNostrListener {
  const { identity, relays, mock, store } = options;

  if (mock) {
    console.info("[nostr] mock listener — not connecting to relays");
    seedMockEvents(store, identity.npub);
    return () => undefined;
  }

  ensureNodeWebSocket();
  const pool = new SimplePool();
  console.info(
    `[nostr] TODO: SimplePool.subscribe on ${relays.join(", ")} for ${identity.npub}`,
  );
  console.info(
    "[nostr] TODO(nostr-dm-encryption): decrypt kind 4 / NIP-17 before gating",
  );
  void decryptDirectMessage;
  void pool;

  return () => {
    pool.close(relays);
  };
}
