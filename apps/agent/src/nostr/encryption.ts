/**
 * TODO(nostr-dm-encryption): Decrypt inbound DMs before the payment gate.
 *
 * Preferred: NIP-44 (and NIP-17 gift wrap).
 * Legacy: NIP-04 kind 4.
 *
 * Never log plaintext, conversation keys, or the agent nsec.
 */

export type DecryptDirectMessageInput = {
  kind: number;
  senderPubkeyHex: string;
  ciphertext: string;
  secretKey: Uint8Array;
};

export async function decryptDirectMessage(
  _input: DecryptDirectMessageInput,
): Promise<string> {
  throw new Error(
    "TODO(nostr-dm-encryption): plug in nostr-tools/nip44 (or nip04) here",
  );
}

export async function encryptDirectMessage(
  _plaintext: string,
  _recipientPubkeyHex: string,
  _secretKey: Uint8Array,
): Promise<string> {
  throw new Error(
    "TODO(nostr-dm-encryption): plug in nostr-tools/nip44 (or nip04) here",
  );
}
