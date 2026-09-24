import { finalizeEvent, type Event } from "nostr-tools/pure";
import type { SimplePool } from "nostr-tools/pool";
import { AgentFaultError } from "../errors.ts";
import { logError, logInfo } from "../secrets.ts";
import type { AgentIdentity } from "./identity.ts";

export type PublishReplyInput = {
  pool: SimplePool | null;
  relays: string[];
  identity: AgentIdentity;
  mockPublish: boolean;
  content: string;
  replyTo: { id: string; pubkeyHex: string };
};

export type PublishReplyResult = {
  event: Event;
  ok: boolean;
  mock: boolean;
  error: string | null;
};

/**
 * Live: kind-1 note with `e` reply + `p` sender tags, published to NOSTR_RELAYS.
 * Mock (or no pool): sign locally and skip sockets so /dev/inbound still works.
 */
export async function publishTextReply(
  input: PublishReplyInput,
): Promise<PublishReplyResult> {
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", input.replyTo.id, "", "reply"],
        ["p", input.replyTo.pubkeyHex],
      ],
      content: input.content,
    },
    input.identity.secretKey,
  );

  if (input.mockPublish || input.pool === null) {
    if (!input.mockPublish && input.pool === null) {
      logError(
        "nostr",
        new AgentFaultError("relay", "no relay pool — live publish skipped"),
      );
      return {
        event,
        ok: false,
        mock: true,
        error: "relays unavailable",
      };
    }
    logInfo("nostr", `mock publish ${event.id.slice(0, 12)}…`);
    return { event, ok: true, mock: true, error: null };
  }

  try {
    const results = await Promise.allSettled(
      input.pool.publish(input.relays, event),
    );
    const ok = results.filter((result) => result.status === "fulfilled").length;
    if (ok === 0) {
      logError(
        "nostr",
        new AgentFaultError("relay", "publish failed on every relay"),
      );
      return {
        event,
        ok: false,
        mock: false,
        error: "relays unavailable",
      };
    }
    logInfo(
      "nostr",
      `published reply ${event.id.slice(0, 12)}… to ${ok}/${input.relays.length} relays`,
    );
    return { event, ok: true, mock: false, error: null };
  } catch (error) {
    logError("nostr", error);
    return {
      event,
      ok: false,
      mock: false,
      error: "relays unavailable",
    };
  }
}
