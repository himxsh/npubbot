import { z } from "zod";

export const paymentStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unpaid") }),
  z.object({
    kind: z.literal("pending"),
    tokenOrInvoice: z.string(),
  }),
  z.object({
    kind: z.literal("paid"),
    amountSats: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("failed"),
    reason: z.string(),
  }),
]);

export type PaymentState = z.infer<typeof paymentStateSchema>;

export const paymentDirectionSchema = z.enum(["in", "out", "refund"]);
export type PaymentDirection = z.infer<typeof paymentDirectionSchema>;

export const paymentRecordSchema = z.object({
  id: z.string(),
  quoteId: z.string().nullable(),
  amountSats: z.number().int().nonnegative(),
  direction: paymentDirectionSchema,
  state: paymentStateSchema,
  note: z.string(),
  senderNpub: z.string().nullable(),
  createdAt: z.string(),
});

export type PaymentRecord = z.infer<typeof paymentRecordSchema>;

export const nostrEventKindLabelSchema = z.enum([
  "mention",
  "dm",
  "reply",
  "other",
]);
export type NostrEventKindLabel = z.infer<typeof nostrEventKindLabelSchema>;

export const nostrEventDirectionSchema = z.enum(["in", "out"]);
export type NostrEventDirection = z.infer<typeof nostrEventDirectionSchema>;

export const nostrEventSummarySchema = z.object({
  id: z.string(),
  kind: z.number().int(),
  label: nostrEventKindLabelSchema,
  direction: nostrEventDirectionSchema,
  from: z.string(),
  summary: z.string(),
  createdAt: z.string(),
  gated: z.boolean(),
  quoteId: z.string().nullable(),
});

export type NostrEventSummary = z.infer<typeof nostrEventSummarySchema>;

export const sessionStateSchema = z.enum(["pending", "paid", "expired"]);
export type SessionState = z.infer<typeof sessionStateSchema>;

export const sessionSummarySchema = z.object({
  quoteId: z.string(),
  senderNpub: z.string(),
  amountSats: z.number().int().nonnegative(),
  state: sessionStateSchema,
  request: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  paidAt: z.string().nullable(),
  pendingPromptPreview: z.string().nullable(),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const toolNameSchema = z.literal("fetch_url");
export type ToolName = z.infer<typeof toolNameSchema>;

export const toolSpendSchema = z.object({
  id: z.string(),
  tool: toolNameSchema,
  url: z.string().nullable(),
  amountSats: z.number().int().nonnegative(),
  ok: z.boolean(),
  refunded: z.boolean(),
  detail: z.string(),
  createdAt: z.string(),
});

export type ToolSpendRecord = z.infer<typeof toolSpendSchema>;

export const inboxStatusSchema = z.object({
  mock: z.boolean(),
  relays: z.array(z.string()),
  connected: z.array(z.string()),
  lastError: z.string().nullable(),
});

export type InboxStatus = z.infer<typeof inboxStatusSchema>;

export const subsystemReportSchema = z.object({
  /** "live" talks to real relays / mint / LLM; "mock" is in-process only. */
  mode: z.enum(["live", "mock"]),
  /** Live: reachable right now. Mock: always true. */
  ready: z.boolean(),
  /** Why it is mocked, or what it is connected to. Never contains secrets. */
  detail: z.string(),
  lastError: z.string().nullable(),
});

export type SubsystemReport = z.infer<typeof subsystemReportSchema>;

export const runtimeReportSchema = z.object({
  /** mock = all mocked, live = all live, partial = mixed. */
  mode: z.enum(["mock", "partial", "live"]),
  /** LIVE_MODE=true: anything short of all-live + ready is "not ready". */
  liveRequired: z.boolean(),
  nodeEnv: z.enum(["development", "test", "production"]),
  /** All subsystems ready, and all live when liveRequired. */
  ready: z.boolean(),
  subsystems: z.object({
    nostr: subsystemReportSchema,
    cashu: subsystemReportSchema,
    llm: subsystemReportSchema,
  }),
  warnings: z.array(z.string()),
});

export type RuntimeReport = z.infer<typeof runtimeReportSchema>;

export const healthResponseSchema = z.object({
  /** Process is up and serving HTTP. Use `ready` / GET /ready for live readiness. */
  ok: z.literal(true),
  service: z.literal("npubbot-agent"),
  ready: z.boolean(),
  runtime: runtimeReportSchema,
  mock: z.object({
    nostr: z.boolean(),
    cashu: z.boolean(),
    llm: z.boolean(),
  }),
  inbox: inboxStatusSchema,
  llm: z.object({
    mock: z.boolean(),
    model: z.string(),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const agentStatusSchema = z.object({
  startedAt: z.string(),
  runtime: runtimeReportSchema,
  identity: z.object({
    npub: z.string(),
    source: z.enum(["env", "ephemeral-mock"]),
  }),
  wallet: z.object({
    balanceSats: z.number().int(),
    mintUrl: z.string().nullable(),
    mock: z.boolean(),
    lastError: z.string().nullable(),
    /** Live vault with a key loaded. Mock is always false and never writes a file. */
    proofsPersisted: z.boolean(),
  }),
  ledger: z.object({
    earnedSats: z.number().int().nonnegative(),
    spentSats: z.number().int().nonnegative(),
    refundedSats: z.number().int().nonnegative(),
    /** earned − spent + refunded. Opening balance is not included. */
    netSats: z.number().int(),
  }),
  gate: z.object({
    /** Base admission before demand pricing. */
    admissionSats: z.number().int().nonnegative(),
    /** Price the next new quote would charge. */
    quotedAdmissionSats: z.number().int().nonnegative(),
    priceMultiplier: z.number().int().positive(),
    recentQuotes: z.number().int().nonnegative(),
    toolSpendSats: z.number().int().nonnegative(),
    sessionTtlSeconds: z.number().int().positive(),
    toolFetchTimeoutMs: z.number().int().positive(),
    paidRateLimit: z.number().int().nonnegative(),
    paidRateWindowMs: z.number().int().nonnegative(),
  }),
  mock: z.object({
    nostr: z.boolean(),
    cashu: z.boolean(),
    llm: z.boolean(),
  }),
  inbox: inboxStatusSchema,
  sessions: z.array(sessionSummarySchema),
  payments: z.array(paymentRecordSchema),
  events: z.array(nostrEventSummarySchema),
  toolSpends: z.array(toolSpendSchema),
  lastToolSpend: toolSpendSchema.nullable(),
});

export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const inboundDevRequestSchema = z.object({
  text: z.string().min(1),
  senderNpub: z.string().optional(),
});

export type InboundDevRequest = z.infer<typeof inboundDevRequestSchema>;

export const markPaidRequestSchema = z.object({
  quoteId: z.string().min(1),
});

export type MarkPaidRequest = z.infer<typeof markPaidRequestSchema>;

export const inboundOutcomeSchema = z.enum([
  "paywall",
  "full",
  "tool",
  "tool-unaffordable",
  "tool-need-url",
  "throttled",
  "error",
  "ignored-dm",
  "ignored-self",
  "duplicate",
  "rate-limited",
]);

export type InboundOutcome = z.infer<typeof inboundOutcomeSchema>;

export const inboundDevResponseSchema = z.object({
  ok: z.literal(true),
  eventId: z.string(),
  senderNpub: z.string(),
  outcome: inboundOutcomeSchema,
  reply: z.string().nullable(),
  quoteId: z.string().nullable(),
});

export type InboundDevResponse = z.infer<typeof inboundDevResponseSchema>;

export const markPaidResponseSchema = z.object({
  ok: z.literal(true),
  quoteId: z.string(),
  reply: z.string().nullable(),
  session: sessionSummarySchema,
});

export type MarkPaidResponse = z.infer<typeof markPaidResponseSchema>;
