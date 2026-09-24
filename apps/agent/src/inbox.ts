import { generateSecretKey, getPublicKey, type Event } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import {
  inboundDevRequestSchema,
  type InboundDevResponse,
  type InboundOutcome,
  type MarkPaidResponse,
} from "@npubbot/shared";
import type { AgentEnv, MockFlags } from "@npubbot/shared";
import { newId, syntheticEventId } from "./ids.ts";
import type { AgentStore } from "./store.ts";
import { SessionStore, type SenderSession } from "./sessions.ts";
import type { CashuHandle } from "./payments/cashu.ts";
import { createAdmissionQuote, paywallMessage } from "./payments/quotes.ts";
import {
  createLlmClient,
  paidSystemPrompt,
  type LlmClient,
} from "./llm/client.ts";
import type { AgentIdentity } from "./nostr/identity.ts";
import { classifyInboundKind } from "./nostr/classify.ts";
import { publishTextReply } from "./nostr/publish.ts";
import type { SimplePool } from "nostr-tools/pool";

export type Inbox = {
  handleNostrEvent: (event: Event) => Promise<void>;
  injectDevMention: (raw: unknown) => Promise<InboundDevResponse>;
  markPaid: (quoteId: string) => Promise<MarkPaidResponse>;
};

export type InboxDeps = {
  env: AgentEnv;
  mock: MockFlags;
  identity: AgentIdentity;
  store: AgentStore;
  sessions: SessionStore;
  cashu: CashuHandle;
  llm: LlmClient;
  getPool: () => SimplePool | null;
};

function npubOfHex(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex);
}

function decodeSenderNpub(nsecOrNpub: string | undefined): {
  pubkeyHex: string;
  npub: string;
} {
  if (nsecOrNpub !== undefined && nsecOrNpub.startsWith("npub1")) {
    const decoded = nip19.decode(nsecOrNpub);
    if (decoded.type !== "npub") {
      throw new Error("senderNpub must be an npub");
    }
    const pubkeyHex = decoded.data;
    return { pubkeyHex, npub: nip19.npubEncode(pubkeyHex) };
  }
  const secretKey = generateSecretKey();
  const pubkeyHex = getPublicKey(secretKey);
  return { pubkeyHex, npub: nip19.npubEncode(pubkeyHex) };
}

function preview(text: string): string {
  const trimmed = text.replaceAll("\n", " ").trim();
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}…`;
}

export function createInbox(deps: InboxDeps): Inbox {
  const { env, mock, identity, store, sessions, cashu, llm, getPool } = deps;
  const chains = new Map<string, Promise<unknown>>();

  function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    chains.set(key, next);
    return next;
  }

  async function sendReply(input: {
    content: string;
    replyTo: { id: string; pubkeyHex: string };
    gated: boolean;
    quoteId: string | null;
  }): Promise<Event> {
    const published = await publishTextReply({
      pool: getPool(),
      relays: env.NOSTR_RELAYS,
      identity,
      mockPublish: mock.nostr,
      content: input.content,
      replyTo: input.replyTo,
    });
    store.recordEvent({
      id: published.id,
      kind: published.kind,
      label: "reply",
      direction: "out",
      from: identity.npub,
      summary: preview(input.content),
      createdAt: new Date(published.created_at * 1000).toISOString(),
      gated: input.gated,
      quoteId: input.quoteId,
    });
    return published;
  }

  async function completePaid(text: string): Promise<string> {
    const result = await llm.complete({
      system: paidSystemPrompt(),
      user: text,
    });
    return result.text.slice(0, 2000);
  }

  async function openPaywall(input: {
    senderPubkeyHex: string;
    senderNpub: string;
    eventId: string;
    text: string;
  }): Promise<{ quoteId: string; message: string; session: SenderSession }> {
    const existing = sessions.getBySender(input.senderPubkeyHex);
    if (existing && existing.state === "pending") {
      sessions.setPendingPrompt(existing.quoteId, {
        eventId: input.eventId,
        text: input.text,
      });
      return {
        quoteId: existing.quoteId,
        session: existing,
        message: paywallMessage({
          amountSats: existing.amountSats,
          quoteId: existing.quoteId,
          request: existing.request,
          mock: cashu.mock,
        }),
      };
    }

    const quote = await createAdmissionQuote(cashu, env.PAYMENT_GATE_SATS);
    const now = new Date();
    const paymentRecordId = newId("pay");
    const session: SenderSession = {
      senderPubkeyHex: input.senderPubkeyHex,
      senderNpub: input.senderNpub,
      quoteId: quote.quoteId,
      amountSats: quote.amountSats,
      request: quote.request,
      state: "pending",
      createdAt: now.toISOString(),
      expiresAt: sessions.expiresAtFor("pending", now),
      paidAt: null,
      paymentRecordId,
      pendingPrompt: { eventId: input.eventId, text: input.text },
    };
    sessions.upsert(session);
    store.recordPayment({
      id: paymentRecordId,
      quoteId: quote.quoteId,
      amountSats: quote.amountSats,
      direction: "in",
      state: { kind: "pending", tokenOrInvoice: quote.request },
      note: `admission quote for ${input.senderNpub}`,
      senderNpub: input.senderNpub,
      createdAt: now.toISOString(),
    });
    return {
      quoteId: quote.quoteId,
      session,
      message: paywallMessage({
        amountSats: quote.amountSats,
        quoteId: quote.quoteId,
        request: quote.request,
        mock: quote.mock,
      }),
    };
  }

  async function processPlaintext(input: {
    eventId: string;
    kind: number;
    senderPubkeyHex: string;
    senderNpub: string;
    text: string;
    createdAt: string;
  }): Promise<{ outcome: InboundOutcome; reply: string | null; quoteId: string | null }> {
    if (sessions.isPaid(input.senderPubkeyHex)) {
      const quoteId = sessions.getBySender(input.senderPubkeyHex)?.quoteId ?? null;
      store.recordEvent({
        id: input.eventId,
        kind: input.kind,
        label: "mention",
        direction: "in",
        from: input.senderNpub,
        summary: preview(input.text),
        createdAt: input.createdAt,
        gated: false,
        quoteId,
      });
      const reply = await completePaid(input.text);
      await sendReply({
        content: reply,
        replyTo: { id: input.eventId, pubkeyHex: input.senderPubkeyHex },
        gated: false,
        quoteId,
      });
      return { outcome: "full", reply, quoteId };
    }

    const paywall = await openPaywall({
      senderPubkeyHex: input.senderPubkeyHex,
      senderNpub: input.senderNpub,
      eventId: input.eventId,
      text: input.text,
    });
    store.recordEvent({
      id: input.eventId,
      kind: input.kind,
      label: "mention",
      direction: "in",
      from: input.senderNpub,
      summary: preview(input.text),
      createdAt: input.createdAt,
      gated: true,
      quoteId: paywall.quoteId,
    });
    await sendReply({
      content: paywall.message,
      replyTo: { id: input.eventId, pubkeyHex: input.senderPubkeyHex },
      gated: true,
      quoteId: paywall.quoteId,
    });
    return {
      outcome: "paywall",
      reply: paywall.message,
      quoteId: paywall.quoteId,
    };
  }

  async function handleNormalized(input: {
    eventId: string;
    kind: number;
    senderPubkeyHex: string;
    createdAt: string;
    content: string;
  }): Promise<{
    outcome: InboundOutcome;
    reply: string | null;
    quoteId: string | null;
    senderNpub: string;
  }> {
    const senderNpub = npubOfHex(input.senderPubkeyHex);
    if (input.senderPubkeyHex === identity.pubkeyHex) {
      return {
        outcome: "ignored-self",
        reply: null,
        quoteId: null,
        senderNpub,
      };
    }
    if (store.hasEvent(input.eventId)) {
      return {
        outcome: "duplicate",
        reply: null,
        quoteId: null,
        senderNpub,
      };
    }

    const classified = classifyInboundKind(input.kind);
    if (!classified.plaintext) {
      store.recordEvent({
        id: input.eventId,
        kind: input.kind,
        label: classified.label,
        direction: "in",
        from: senderNpub,
        summary:
          "[encrypted DM] not decrypted — mentions only until TODO(nostr-dm-encryption)",
        createdAt: input.createdAt,
        gated: false,
        quoteId: null,
      });
      return {
        outcome: "ignored-dm",
        reply: null,
        quoteId: null,
        senderNpub,
      };
    }

    const result = await processPlaintext({
      eventId: input.eventId,
      kind: input.kind,
      senderPubkeyHex: input.senderPubkeyHex,
      senderNpub,
      text: input.content,
      createdAt: input.createdAt,
    });
    return { ...result, senderNpub };
  }

  return {
    async handleNostrEvent(event) {
      await enqueue(event.pubkey, () =>
        handleNormalized({
          eventId: event.id,
          kind: event.kind,
          senderPubkeyHex: event.pubkey,
          createdAt: new Date(event.created_at * 1000).toISOString(),
          content: event.content,
        }),
      );
    },

    async injectDevMention(raw) {
      const body = inboundDevRequestSchema.parse(raw);
      const sender = decodeSenderNpub(body.senderNpub);
      const eventId = syntheticEventId();
      const result = await enqueue(sender.pubkeyHex, () =>
        handleNormalized({
          eventId,
          kind: 1,
          senderPubkeyHex: sender.pubkeyHex,
          createdAt: new Date().toISOString(),
          content: body.text,
        }),
      );
      return {
        ok: true as const,
        eventId,
        senderNpub: result.senderNpub,
        outcome: result.outcome,
        reply: result.reply,
        quoteId: result.quoteId,
      };
    },

    async markPaid(quoteId) {
      const session = sessions.getByQuoteId(quoteId);
      if (!session) {
        throw new Error(`unknown quote ${quoteId}`);
      }
      if (session.state === "expired") {
        throw new Error("quote expired");
      }
      if (session.state === "paid") {
        return {
          ok: true as const,
          quoteId,
          reply: null,
          session: sessions.summaries().find((row) => row.quoteId === quoteId) ?? {
            quoteId: session.quoteId,
            senderNpub: session.senderNpub,
            amountSats: session.amountSats,
            state: session.state,
            request: session.request,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            paidAt: session.paidAt,
            pendingPromptPreview: session.pendingPrompt
              ? session.pendingPrompt.text.slice(0, 140)
              : null,
          },
        };
      }

      const updated = sessions.markPaid(quoteId);
      if (!updated) {
        throw new Error(`unknown quote ${quoteId}`);
      }
      store.markPaymentPaid(quoteId, updated.amountSats);
      store.credit(updated.amountSats);

      const pending = sessions.clearPendingPrompt(quoteId);
      let reply: string | null = null;
      if (pending) {
        reply = await completePaid(pending.text);
        await sendReply({
          content: reply,
          replyTo: { id: pending.eventId, pubkeyHex: updated.senderPubkeyHex },
          gated: false,
          quoteId,
        });
      }

      const summary = sessions.summaries().find((row) => row.quoteId === quoteId);
      if (!summary) {
        throw new Error("session missing after mark-paid");
      }
      return {
        ok: true as const,
        quoteId,
        reply,
        session: summary,
      };
    },
  };
}

export function createPipelineLlm(env: AgentEnv, mockLlm: boolean): LlmClient {
  return createLlmClient({
    mock: mockLlm,
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
  });
}
