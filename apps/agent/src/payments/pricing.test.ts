import assert from "node:assert/strict";
import { test } from "node:test";
import { DemandPricer } from "./pricing.ts";

test("admission stays at base until the surge threshold", () => {
  const pricer = new DemandPricer(21, 3, 60_000, 3);
  const now = 1_000_000;
  for (const expected of [21, 21, 21, 42]) {
    const price = pricer.peek(now);
    assert.equal(price.amountSats, expected);
    pricer.note(now);
  }
  assert.equal(pricer.peek(now).multiplier, 2);
  assert.equal(pricer.peek(now).recentQuotes, 4);
});

test("multiplier caps and old quotes fall out of the window", () => {
  const pricer = new DemandPricer(10, 1, 1_000, 3);
  pricer.note(0);
  pricer.note(10);
  pricer.note(20);
  assert.equal(pricer.peek(30).amountSats, 30);
  assert.equal(pricer.peek(2_000).amountSats, 10);
  assert.equal(pricer.peek(2_000).recentQuotes, 0);
});

test("surgeAfter 0 keeps the base price", () => {
  const pricer = new DemandPricer(21, 0, 60_000, 3);
  pricer.note(0);
  pricer.note(1);
  assert.equal(pricer.peek(2).amountSats, 21);
  assert.equal(pricer.peek(2).multiplier, 1);
});
