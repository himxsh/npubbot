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
  amountSats: z.number().int().nonnegative(),
  direction: paymentDirectionSchema,
  state: paymentStateSchema,
  note: z.string(),
  createdAt: z.string(),
});

export type PaymentRecord = z.infer<typeof paymentRecordSchema>;

export const nostrEventKindLabelSchema = z.enum(["mention", "dm", "other"]);
export type NostrEventKindLabel = z.infer<typeof nostrEventKindLabelSchema>;

export const nostrEventSummarySchema = z.object({
  id: z.string(),
  kind: z.number().int(),
  label: nostrEventKindLabelSchema,
  from: z.string(),
  summary: z.string(),
  createdAt: z.string(),
  gated: z.boolean(),
});

export type NostrEventSummary = z.infer<typeof nostrEventSummarySchema>;

export const toolSpendSchema = z.object({
  id: z.string(),
  tool: z.literal("lookup_note"),
  amountSats: z.number().int().nonnegative(),
  ok: z.boolean(),
  detail: z.string(),
  createdAt: z.string(),
});

export type ToolSpendRecord = z.infer<typeof toolSpendSchema>;

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("npubbot-agent"),
  mock: z.object({
    nostr: z.boolean(),
    cashu: z.boolean(),
    llm: z.boolean(),
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
  }),
  gate: z.object({
    admissionSats: z.number().int().nonnegative(),
    toolSpendSats: z.number().int().nonnegative(),
  }),
  mock: z.object({
    nostr: z.boolean(),
    cashu: z.boolean(),
    llm: z.boolean(),
  }),
  payments: z.array(paymentRecordSchema),
  events: z.array(nostrEventSummarySchema),
  lastToolSpend: toolSpendSchema.nullable(),
});

export type AgentStatus = z.infer<typeof agentStatusSchema>;
