import {
  assertNever,
  type AgentStatus,
  type InboxStatus,
  type MockFlags,
  type NostrEventSummary,
  type PaymentRecord,
  type PaymentState,
  type SessionSummary,
  type ToolSpendRecord,
} from "@npubbot/shared";
import { redactSecrets } from "./secrets.ts";

const MAX_ROWS = 50;

function sanitizePaymentState(state: PaymentState): PaymentState {
  switch (state.kind) {
    case "unpaid":
      return state;
    case "pending":
      return {
        kind: "pending",
        tokenOrInvoice: redactSecrets(state.tokenOrInvoice),
      };
    case "paid":
      return state;
    case "failed":
      return { kind: "failed", reason: redactSecrets(state.reason) };
    default:
      return assertNever(state);
  }
}

export type AgentIdentityView = {
  npub: string;
  source: "env" | "ephemeral-mock";
};

export class AgentStore {
  readonly startedAt = new Date().toISOString();
  private balanceSats: number;
  private readonly payments: PaymentRecord[] = [];
  private readonly events: NostrEventSummary[] = [];
  private readonly toolSpends: ToolSpendRecord[] = [];
  private lastToolSpend: ToolSpendRecord | null = null;
  private readonly seenEventIds = new Set<string>();
  private inbox: InboxStatus;
  private walletError: string | null = null;
  private sessionsView: () => SessionSummary[] = () => [];

  constructor(
    private readonly identity: AgentIdentityView,
    private readonly flags: MockFlags,
    private readonly gate: {
      admissionSats: number;
      toolSpendSats: number;
      sessionTtlSeconds: number;
      toolFetchTimeoutMs: number;
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
    this.inbox = {
      ...this.inbox,
      ...patch,
      lastError:
        patch.lastError === undefined
          ? this.inbox.lastError
          : patch.lastError === null
            ? null
            : redactSecrets(patch.lastError),
    };
  }

  setWalletError(error: string | null): void {
    this.walletError = error === null ? null : redactSecrets(error);
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

  setBalance(amountSats: number): void {
    this.balanceSats = Math.max(0, amountSats);
  }

  hasEvent(id: string): boolean {
    return this.seenEventIds.has(id);
  }

  recordPayment(record: PaymentRecord): void {
    this.payments.unshift({
      ...record,
      note: redactSecrets(record.note),
      state: sanitizePaymentState(record.state),
    });
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
    const detail = redactSecrets(record.detail).slice(0, 1200);
    this.events.unshift({
      ...record,
      summary: redactSecrets(record.summary),
      detail,
    });
    if (this.events.length > MAX_ROWS) {
      this.events.length = MAX_ROWS;
    }
  }

  recordToolSpend(record: ToolSpendRecord): void {
    this.lastToolSpend = record;
    this.toolSpends.unshift(record);
    if (this.toolSpends.length > MAX_ROWS) {
      this.toolSpends.length = MAX_ROWS;
    }
  }

  snapshot(): AgentStatus {
    return {
      observedAt: new Date().toISOString(),
      startedAt: this.startedAt,
      identity: this.identity,
      wallet: {
        balanceSats: this.balanceSats,
        mintUrl: this.mintUrl,
        mock: this.flags.cashu,
        lastError: this.walletError,
      },
      gate: this.gate,
      mock: this.flags,
      inbox: this.inbox,
      sessions: this.sessionsView().map((session) => ({
        ...session,
        request: redactSecrets(session.request),
        pendingPromptPreview: session.pendingPromptPreview
          ? redactSecrets(session.pendingPromptPreview)
          : null,
      })),
      payments: [...this.payments],
      events: [...this.events],
      toolSpends: [...this.toolSpends],
      lastToolSpend: this.lastToolSpend,
    };
  }
}
