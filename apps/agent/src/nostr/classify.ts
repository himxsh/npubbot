import {
  EncryptedDirectMessage,
  GiftWrap,
  ShortTextNote,
} from "nostr-tools/kinds";
import type { Event } from "nostr-tools/pure";
import type { NostrEventKindLabel } from "@npubbot/shared";
import { assertNever } from "@npubbot/shared";

export type InboundKindClass =
  | { label: "mention"; plaintext: true }
  | { label: "dm"; plaintext: false }
  | { label: "other"; plaintext: false };

export function classifyInboundKind(kind: number): InboundKindClass {
  switch (kind) {
    case ShortTextNote:
      return { label: "mention", plaintext: true };
    case EncryptedDirectMessage:
    case GiftWrap:
      return { label: "dm", plaintext: false };
    default:
      return { label: "other", plaintext: false };
  }
}

export function eventMentionsPubkey(event: Event, pubkeyHex: string): boolean {
  return event.tags.some(
    (tag) => tag[0] === "p" && tag[1] === pubkeyHex,
  );
}

export function labelToLog(label: NostrEventKindLabel): string {
  switch (label) {
    case "mention":
      return "mention";
    case "dm":
      return "dm";
    case "reply":
      return "reply";
    case "other":
      return "other";
    default:
      return assertNever(label);
  }
}
