import type {
  AgentStatus,
  MockFlags,
  NostrEventSummary,
  PaymentRecord,
  ToolSpendRecord,
} from "@npubbot/shared";

const MAX_ROWS = 50;

export type AgentIdentityView = {
  npub: string;
  source: "env" | "ephemeral-mock";
};

export class AgentStore {
  readonly startedAt = new Date().toISOString();
  private balanceSats: number;
  private readonly payments: PaymentRecord[] = [];
  private readonly events: NostrEventSummary[] = [];
  private lastToolSpend: ToolSpendRecord | null = null;

  constructor(
    private readonly identity: AgentIdentityView,
    private readonly flags: MockFlags,
    private readonly gate: { admissionSats: number; toolSpendSats: number },
    openingBalanceSats: number,
    private readonly mintUrl: string | null,
  ) {
    this.balanceSats = openingBalanceSats;
  }

  getBalance(): number {
    return this.balanceSats;
  }

  credit(amountSats: number): void {
    this.balanceSats += amountSats;
  }

  debit(amountSats: number): boolean {
    if (this.balanceSats < amountSats) {
      return false;
    }
    this.balanceSats -= amountSats;
    return true;
  }

  recordPayment(record: PaymentRecord): void {
    this.payments.unshift(record);
    if (this.payments.length > MAX_ROWS) {
      this.payments.length = MAX_ROWS;
    }
  }

  recordEvent(record: NostrEventSummary): void {
    this.events.unshift(record);
    if (this.events.length > MAX_ROWS) {
      this.events.length = MAX_ROWS;
    }
  }

  recordToolSpend(record: ToolSpendRecord): void {
    this.lastToolSpend = record;
  }

  snapshot(): AgentStatus {
    return {
      startedAt: this.startedAt,
      identity: this.identity,
      wallet: {
        balanceSats: this.balanceSats,
        mintUrl: this.mintUrl,
        mock: this.flags.cashu,
      },
      gate: this.gate,
      mock: this.flags,
      payments: [...this.payments],
      events: [...this.events],
      lastToolSpend: this.lastToolSpend,
    };
  }
}
