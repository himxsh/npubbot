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

export const paymentDirectionSchema = z.enum(["in", "out"]);
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

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("npubbot-agent"),
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
  identity: z.object({
    npub: z.string(),
    source: z.enum(["env", "ephemeral-mock"]),
  }),
  wallet: z.object({
    balanceSats: z.number().int(),
    mintUrl: z.string().nullable(),
    mock: z.boolean(),
    lastError: z.string().nullable(),
  }),
  gate: z.object({
    admissionSats: z.number().int().nonnegative(),
    toolSpendSats: z.number().int().nonnegative(),
    sessionTtlSeconds: z.number().int().positive(),
    toolFetchTimeoutMs: z.number().int().positive(),
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
