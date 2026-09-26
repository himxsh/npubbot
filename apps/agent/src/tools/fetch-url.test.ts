import assert from "node:assert/strict";
import test from "node:test";
import { fetchUrl, publicUrlError } from "./fetch-url.ts";

test("accepts public http(s) urls", () => {
  assert.equal(publicUrlError("https://example.com/path"), null);
  assert.equal(publicUrlError("http://example.com"), null);
});

test("rejects private, credentialed, and non-http urls before any spend", () => {
  assert.equal(
    publicUrlError("http://127.0.0.1/secret"),
    "refusing private or loopback host",
  );
  assert.equal(
    publicUrlError("http://localhost/x"),
    "refusing private or loopback host",
  );
  assert.equal(
    publicUrlError("http://192.168.1.4/"),
    "refusing private or loopback host",
  );
  assert.equal(
    publicUrlError("http://10.1.2.3/"),
    "refusing private or loopback host",
  );
  assert.equal(publicUrlError("ftp://example.com"), "only http/https URLs are allowed");
  assert.equal(
    publicUrlError("https://user:pass@example.com"),
    "URLs with credentials are not allowed",
  );
  assert.equal(publicUrlError("not a url"), "invalid URL");
});

test("fetchUrl refuses loopback without opening a socket", async () => {
  const result = await fetchUrl("http://127.0.0.1/nope", 1000);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "refusing private or loopback host");
  }
});
