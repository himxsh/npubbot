import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import {
  EncryptedDirectMessage,
  GiftWrap,
  ShortTextNote,
} from "nostr-tools/kinds";
import type { Event } from "nostr-tools/pure";
import WebSocket from "ws";
import type { AgentStore } from "../store.ts";
import type { AgentIdentity } from "./identity.ts";

let nodeWebSocketInstalled = false;

function ensureNodeWebSocket(): void {
  if (nodeWebSocketInstalled) {
    return;
  }
  useWebSocketImplementation(WebSocket);
  nodeWebSocketInstalled = true;
}

export type StopNostrListener = () => void;

export type NostrListener = {
  stop: StopNostrListener;
  pool: SimplePool | null;
};

/**
 * Live: subscribe to kind-1 mentions (`#p` = our pubkey) plus kind-4 / 1059 DMs.
 * DMs are logged only until TODO(nostr-dm-encryption) is implemented.
 * Mock: no sockets; inbound traffic comes from POST /dev/inbound.
 */
export function startNostrListener(options: {
  identity: AgentIdentity;
  relays: string[];
  mock: boolean;
  store: AgentStore;
  onEvent: (event: Event) => void;
}): NostrListener {
  const { identity, relays, mock, store, onEvent } = options;

  if (mock) {
    console.info(
      "[nostr] mock inbox — not connecting to relays; use POST /dev/inbound",
    );
    store.setInbox({
      mock: true,
      relays,
      connected: [],
      lastError: null,
    });
    return { stop: () => undefined, pool: null };
  }

  if (relays.length === 0) {
    const message = "NOSTR_RELAYS is empty";
    console.warn(`[nostr] ${message}`);
    store.setInbox({
      mock: false,
      relays,
      connected: [],
      lastError: message,
    });
    return { stop: () => undefined, pool: null };
  }

  ensureNodeWebSocket();
  const pool = new SimplePool({ enableReconnect: true });
  const since = Math.floor(Date.now() / 1000) - 5;
  const filter = {
    kinds: [ShortTextNote, EncryptedDirectMessage, GiftWrap],
    "#p": [identity.pubkeyHex],
    since,
  };

  console.info(
    `[nostr] subscribe mentions+DMs as ${identity.npub} on ${relays.join(", ")}`,
  );
  console.info(
    "[nostr] DM tradeoff: kind 4 / NIP-17 gift wraps are recorded, not decrypted (TODO(nostr-dm-encryption)). Mentions (kind 1) enter the payment gate.",
  );

  const sub = pool.subscribe(relays, filter, {
    onevent(event) {
      onEvent(event);
    },
    onclose(reasons) {
      const text = reasons.map((row) => `${row.url}: ${row.reason}`).join("; ");
      if (text.length > 0) {
        store.setInbox({ lastError: text });
      }
    },
  });

  const timer = setInterval(() => {
    const connected: string[] = [];
    for (const [url, isUp] of pool.listConnectionStatus()) {
      if (isUp) {
        connected.push(url);
      }
    }
    store.setInbox({
      mock: false,
      relays,
      connected,
      lastError: store.getInbox().lastError,
    });
  }, 3000);

  return {
    pool,
    stop: () => {
      clearInterval(timer);
      sub.close();
      pool.close(relays);
    },
  };
}
