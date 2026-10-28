import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkAgentConfig, parseAgentEnv } from "@npubbot/shared";
import { createCashuHandle } from "./cashu.ts";
import { createProofVault } from "./proof-vault.ts";

const KEY = "0123456789abcdef";
const SECRET = "super-secret-proof-value";

function flipLastByte(blob: Buffer): void {
  const index = blob.length - 1;
  const byte = blob[index];
  if (byte === undefined) {
    throw new Error("empty vault");
  }
  blob[index] = byte ^ 0xff;
}
const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "npubbot-vault-"));
  dirs.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test("disabled vault never creates a file", async () => {
  const file = join(await tempDir(), "proofs.vault");
  const vault = createProofVault({
    enabled: false,
    filePath: file,
    keyMaterial: KEY,
  });
  assert.equal(vault.enabled, false);
  assert.deepEqual(await vault.load(), []);
  await vault.save([{ secret: SECRET }]);
  await assert.rejects(readFile(file));
});

test("round-trips proofs and keeps the secret out of the file", async () => {
  const file = join(await tempDir(), "proofs.vault");
  const vault = createProofVault({
    enabled: true,
    filePath: file,
    keyMaterial: KEY,
  });
  const payload = [{ id: "00", amount: 21, secret: SECRET, C: "02" }];
  await vault.save(payload);
  assert.deepEqual(await vault.load(), payload);
  const raw = await readFile(file);
  assert.equal(raw.includes(SECRET), false);
  assert.equal(raw.subarray(0, 4).toString("utf8"), "NPB1");
  await assert.rejects(readFile(`${file}.tmp`));
});

test("wrong key and tampering fail closed", async () => {
  const file = join(await tempDir(), "proofs.vault");
  const vault = createProofVault({
    enabled: true,
    filePath: file,
    keyMaterial: KEY,
  });
  await vault.save([{ secret: SECRET }]);
  const other = createProofVault({
    enabled: true,
    filePath: file,
    keyMaterial: "different-key-value",
  });
  await assert.rejects(other.load(), /authentication failed/);

  const blob = await readFile(file);
  flipLastByte(blob);
  await writeFile(file, blob);
  await assert.rejects(vault.load(), /authentication failed/);
});

test("a second save replaces the vault", async () => {
  const file = join(await tempDir(), "proofs.vault");
  const vault = createProofVault({
    enabled: true,
    filePath: file,
    keyMaterial: KEY,
  });
  await vault.save([{ amount: 1 }]);
  await vault.save([{ amount: 2 }]);
  assert.deepEqual(await vault.load(), [{ amount: 2 }]);
});

test("mock cashu never calls the vault", async () => {
  let touched = false;
  const handle = await createCashuHandle("https://mint.example", true, {
    enabled: true,
    async load() {
      touched = true;
      return [];
    },
    async save() {
      touched = true;
    },
  });
  assert.equal(handle.mock, true);
  assert.equal(handle.persisted, false);
  await handle.createQuote(21);
  assert.equal(touched, false);
});

test("live handle restores proofs and does not overwrite a bad vault", async () => {
  const file = join(await tempDir(), "proofs.vault");
  const vault = createProofVault({
    enabled: true,
    filePath: file,
    keyMaterial: KEY,
  });
  await vault.save([{ id: "00", amount: 8, secret: SECRET, C: "02" }]);
  const restored = await createCashuHandle("http://127.0.0.1:1", false, vault);
  assert.equal(restored.persisted, true);
  assert.equal(restored.proofBalanceSats(), 8);
  assert.equal(restored.mock, false);

  const blob = await readFile(file);
  flipLastByte(blob);
  await writeFile(file, blob);
  const broken = await createCashuHandle("http://127.0.0.1:1", false, vault);
  assert.equal(broken.persisted, false);
  assert.equal(broken.proofBalanceSats(), 0);
  assert.match(broken.lastError ?? "", /not overwriting/);
  const after = await readFile(file);
  assert.deepEqual(after, blob);
});

test("proof key rules do not echo the secret", () => {
  const short = checkAgentConfig(
    parseAgentEnv({
      MOCK_MODE: "false",
      CASHU_MINT_URL: "https://example.com",
      CASHU_PROOF_KEY: "too-short",
    }),
  );
  assert.ok(short.errors.some((line) => line.includes("CASHU_PROOF_KEY")));
  assert.equal(short.errors.some((line) => line.includes("too-short")), false);

  const missing = checkAgentConfig(
    parseAgentEnv({
      MOCK_MODE: "false",
      CASHU_MINT_URL: "https://example.com",
    }),
  );
  assert.ok(missing.warnings.some((line) => line.includes("CASHU_PROOF_KEY")));

  const mocked = checkAgentConfig(
    parseAgentEnv({
      MOCK_MODE: "true",
      CASHU_MINT_URL: "https://example.com",
    }),
  );
  assert.equal(
    mocked.warnings.some((line) => line.includes("CASHU_PROOF_KEY")),
    false,
  );
});
