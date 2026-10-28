/**
 * In-memory cooldown for unpaid senders. Does not persist across process restarts.
 * Paid sessions are never throttled by this map.
 */
export class UnpaidCooldown {
  private readonly lastReplyAt = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  shouldSkip(pubkeyHex: string, now = Date.now()): boolean {
    if (this.ttlMs <= 0) {
      return false;
    }
    const last = this.lastReplyAt.get(pubkeyHex);
    if (last === undefined) {
      return false;
    }
    return now - last < this.ttlMs;
  }

  markSent(pubkeyHex: string, now = Date.now()): void {
    this.lastReplyAt.set(pubkeyHex, now);
  }
}

/**
 * Cap how many paid turns one pubkey can take inside a window.
 * `limit` or `windowMs` of 0 disables the cap. A rejected turn is not recorded,
 * so retries do not push the window forward.
 */
export class PaidRateLimit {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(
    pubkeyHex: string,
    now = Date.now(),
  ): { ok: true; remaining: number } | { ok: false; retryMs: number } {
    if (this.limit <= 0 || this.windowMs <= 0) {
      return { ok: true, remaining: Number.POSITIVE_INFINITY };
    }
    const fresh = (this.hits.get(pubkeyHex) ?? []).filter(
      (stamp) => now - stamp < this.windowMs,
    );
    if (fresh.length >= this.limit) {
      this.hits.set(pubkeyHex, fresh);
      const oldest = fresh[0] ?? now;
      return { ok: false, retryMs: Math.max(0, this.windowMs - (now - oldest)) };
    }
    fresh.push(now);
    this.hits.set(pubkeyHex, fresh);
    return { ok: true, remaining: this.limit - fresh.length };
  }
}
