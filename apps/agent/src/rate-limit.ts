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
