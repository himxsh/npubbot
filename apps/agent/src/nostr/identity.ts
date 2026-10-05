import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";

/**
 * Resolve the agent identity from NOSTR_NSEC or an ephemeral mock key.
 * Never log `secretKey` or the nsec string — only `npub` / `source`.
 */
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
    let decoded: ReturnType<typeof nip19.decode>;
    try {
      decoded = nip19.decode(nsec);
    } catch {
      // Never include the input in the message — it is the private key.
      throw new Error("NOSTR_NSEC is not a valid bech32 nsec1… key");
    }
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
