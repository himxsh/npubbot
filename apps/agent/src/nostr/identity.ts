import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";

export type AgentIdentity = {
  source: "env" | "ephemeral-mock";
  secretKey: Uint8Array;
  pubkeyHex: string;
  npub: string;
};

export function resolveIdentity(
  nsec: string | undefined,
  mockNostr: boolean,
): AgentIdentity {
  if (nsec !== undefined) {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== "nsec") {
      throw new Error(
        `NOSTR_NSEC must decode as nsec, got ${decoded.type}`,
      );
    }
    const secretKey = decoded.data;
    const pubkeyHex = getPublicKey(secretKey);
    return {
      source: "env",
      secretKey,
      pubkeyHex,
      npub: nip19.npubEncode(pubkeyHex),
    };
  }

  if (!mockNostr) {
    throw new Error("NOSTR_NSEC is required when Nostr mock mode is off");
  }

  const secretKey = generateSecretKey();
  const pubkeyHex = getPublicKey(secretKey);
  return {
    source: "ephemeral-mock",
    secretKey,
    pubkeyHex,
    npub: nip19.npubEncode(pubkeyHex),
  };
}

export function publicIdentity(
  identity: AgentIdentity,
): { npub: string; source: AgentIdentity["source"] } {
  return { npub: identity.npub, source: identity.source };
}
