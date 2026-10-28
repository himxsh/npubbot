import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const MAGIC = Buffer.from("NPB1");
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;
const HKDF_INFO = Buffer.from("npubbot/cashu-proof-vault/v1");

export const MIN_PROOF_KEY_LENGTH = 16;

/**
 * Encrypted proof file. `enabled: false` (mock Cashu) never reads or writes
 * `filePath`.
 */
export type ProofVault = {
  readonly enabled: boolean;
  load(): Promise<unknown>;
  save(payload: unknown): Promise<void>;
};

function deriveKey(keyMaterial: string, salt: Buffer): Buffer {
  const raw = hkdfSync(
    "sha256",
    Buffer.from(keyMaterial, "utf8"),
    salt,
    HKDF_INFO,
    32,
  );
  return Buffer.from(raw);
}

function seal(plaintext: Buffer, keyMaterial: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(keyMaterial, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const aad = Buffer.concat([MAGIC, salt]);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
}

function open(blob: Buffer, keyMaterial: string): unknown {
  if (blob.length < HEADER_LEN || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("proof vault header");
  }
  const salt = blob.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
  const ivStart = MAGIC.length + SALT_LEN;
  const iv = blob.subarray(ivStart, ivStart + IV_LEN);
  const tagStart = ivStart + IV_LEN;
  const tag = blob.subarray(tagStart, tagStart + TAG_LEN);
  const ciphertext = blob.subarray(tagStart + TAG_LEN);
  const key = deriveKey(keyMaterial, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.concat([MAGIC, salt]));
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("proof vault authentication failed");
  }
  try {
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch {
    throw new Error("proof vault payload");
  }
}

export function createProofVault(options: {
  enabled: boolean;
  filePath: string;
  keyMaterial: string | undefined;
}): ProofVault {
  if (!options.enabled) {
    return {
      enabled: false,
      async load() {
        return [];
      },
      async save() {
        // Mock mode: do not stat, create, or write the vault path.
      },
    };
  }

  const keyMaterial = options.keyMaterial;
  if (keyMaterial === undefined || keyMaterial.length < MIN_PROOF_KEY_LENGTH) {
    throw new Error(
      `CASHU_PROOF_KEY must be at least ${MIN_PROOF_KEY_LENGTH} characters`,
    );
  }
  const filePath = options.filePath;

  return {
    enabled: true,
    async load() {
      let blob: Buffer;
      try {
        blob = await readFile(filePath);
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "";
        if (code === "ENOENT") {
          return [];
        }
        throw error;
      }
      return open(blob, keyMaterial);
    },
    async save(payload: unknown) {
      const blob = seal(Buffer.from(JSON.stringify(payload), "utf8"), keyMaterial);
      const dir = dirname(filePath);
      await mkdir(dir, { recursive: true });
      const tmp = `${filePath}.tmp`;
      // ponytail: rename is atomic on one filesystem; a power cut can still
      // drop the last write. Upgrade: fsync the temp file and its directory.
      await writeFile(tmp, blob, { mode: 0o600 });
      await rename(tmp, filePath);
    },
  };
}
