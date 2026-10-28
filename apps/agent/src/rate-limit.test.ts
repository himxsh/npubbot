import assert from "node:assert/strict";
import { test } from "node:test";
import { PaidRateLimit } from "./rate-limit.ts";

test("paid turns are capped per pubkey and do not share a bucket", () => {
  const limit = new PaidRateLimit(2, 1_000);
  assert.equal(limit.allow("a", 0).ok, true);
  assert.equal(limit.allow("a", 10).ok, true);
  const blocked = limit.allow("a", 20);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.retryMs, 980);
  }
  assert.equal(limit.allow("b", 20).ok, true);
  assert.equal(limit.allow("a", 1_000).ok, true);
});

test("a rejected turn does not extend the window", () => {
  const limit = new PaidRateLimit(1, 1_000);
  assert.equal(limit.allow("a", 0).ok, true);
  assert.equal(limit.allow("a", 900).ok, false);
  const again = limit.allow("a", 1_000);
  assert.equal(again.ok, true);
});

test("limit 0 disables the cap", () => {
  const limit = new PaidRateLimit(0, 1_000);
  assert.equal(limit.allow("a", 0).ok, true);
  assert.equal(limit.allow("a", 1).ok, true);
});
