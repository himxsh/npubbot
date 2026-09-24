import type {
  AgentStatus,
  InboxStatus,
  MockFlags,
  NostrEventSummary,
  PaymentRecord,
  SessionSummary,
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
  private readonly seenEventIds = new Set<string>();
  private inbox: InboxStatus;
  private sessionsView: () => SessionSummary[] = () => [];

  constructor(
    private readonly identity: AgentIdentityView,
    private readonly flags: MockFlags,
    private readonly gate: {
      admissionSats: number;
      toolSpendSats: number;
      sessionTtlSeconds: number;
    },
    openingBalanceSats: number,
    private readonly mintUrl: string | null,
    inbox: InboxStatus,
  ) {
    this.balanceSats = openingBalanceSats;
    this.inbox = inbox;
  }

  setSessionView(view: () => SessionSummary[]): void {
    this.sessionsView = view;
  }

  setInbox(patch: Partial<InboxStatus>): void {
    this.inbox = { ...this.inbox, ...patch };
  }

  getInbox(): InboxStatus {
    return this.inbox;
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

  hasEvent(id: string): boolean {
    return this.seenEventIds.has(id);
  }

  recordPayment(record: PaymentRecord): void {
    this.payments.unshift(record);
    if (this.payments.length > MAX_ROWS) {
      this.payments.length = MAX_ROWS;
    }
  }

  findPaymentByQuoteId(quoteId: string): PaymentRecord | undefined {
    return this.payments.find((row) => row.quoteId === quoteId);
  }

  markPaymentPaid(quoteId: string, amountSats: number): void {
    const row = this.findPaymentByQuoteId(quoteId);
    if (!row) {
      return;
    }
    row.state = { kind: "paid", amountSats };
  }

  recordEvent(record: NostrEventSummary): void {
    this.seenEventIds.add(record.id);
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
      inbox: this.inbox,
      sessions: this.sessionsView(),
      payments: [...this.payments],
      events: [...this.events],
      lastToolSpend: this.lastToolSpend,
    };
  }
}
