import { finalizeEvent, type Event } from "nostr-tools/pure";
import type { SimplePool } from "nostr-tools/pool";
import type { AgentIdentity } from "./identity.ts";

export type PublishReplyInput = {
  pool: SimplePool | null;
  relays: string[];
  identity: AgentIdentity;
  mockPublish: boolean;
  content: string;
  replyTo: { id: string; pubkeyHex: string };
};

export async function publishTextReply(
  input: PublishReplyInput,
): Promise<Event> {
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
    console.info(`[nostr] mock publish ${event.id.slice(0, 12)}…`);
    return event;
  }

  const results = await Promise.allSettled(
    input.pool.publish(input.relays, event),
  );
  const ok = results.filter((result) => result.status === "fulfilled").length;
  console.info(
    `[nostr] published reply ${event.id.slice(0, 12)}… to ${ok}/${input.relays.length} relays`,
  );
  return event;
}
