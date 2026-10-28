export type AdmissionPrice = {
  baseSats: number;
  amountSats: number;
  multiplier: number;
  recentQuotes: number;
};

/**
 * Step the admission price up while quotes arrive inside a window.
 * `surgeAfter` 0 disables the step (always base). The price is an integer
 * multiple of the base so quotes stay whole sats.
 */
export class DemandPricer {
  private stamps: number[] = [];

  constructor(
    private readonly baseSats: number,
    private readonly surgeAfter: number,
    private readonly windowMs: number,
    private readonly maxMultiplier: number,
  ) {}

  peek(now = Date.now()): AdmissionPrice {
    const recentQuotes = this.recent(now);
    const multiplier = this.multiplierFor(recentQuotes);
    return {
      baseSats: this.baseSats,
      amountSats: this.baseSats * multiplier,
      multiplier,
      recentQuotes,
    };
  }

  /** Record a quote that was actually issued. */
  note(now = Date.now()): void {
    this.recent(now);
    this.stamps.push(now);
  }

  private recent(now: number): number {
    if (this.windowMs <= 0) {
      this.stamps = [];
      return 0;
    }
    this.stamps = this.stamps.filter((stamp) => now - stamp < this.windowMs);
    return this.stamps.length;
  }

  private multiplierFor(recentQuotes: number): number {
    if (this.surgeAfter <= 0 || this.baseSats <= 0 || this.maxMultiplier <= 1) {
      return 1;
    }
    const steps = Math.floor(recentQuotes / this.surgeAfter);
    return Math.min(this.maxMultiplier, 1 + steps);
  }
}
