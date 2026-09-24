import { generateSecretKey, getPublicKey, type Event } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import {
  assertNever,
  inboundDevRequestSchema,
  type AgentEnv,
  type InboundDevResponse,
  type InboundOutcome,
  type MarkPaidResponse,
  type MockFlags,
} from "@npubbot/shared";
import { AgentFaultError, userFacingFromError, userFacingMessage } from "./errors.ts";
import { newId, syntheticEventId } from "./ids.ts";
import type { AgentStore } from "./store.ts";
import { SessionStore, type SenderSession } from "./sessions.ts";
import type { CashuHandle } from "./payments/cashu.ts";
import { createAdmissionQuote, paywallMessage } from "./payments/quotes.ts";
import { extractCashuToken, stripCashuTokens } from "./payments/token.ts";
import {
  createLlmClient,
  paidSystemPrompt,
  type LlmClient,
} from "./llm/client.ts";
import type { AgentIdentity } from "./nostr/identity.ts";
import { classifyInboundKind } from "./nostr/classify.ts";
import { publishTextReply } from "./nostr/publish.ts";
import type { SimplePool } from "nostr-tools/pool";
import { routeIntent } from "./tools/intent.ts";
import { fetchUrl, formatFetchResult } from "./tools/fetch-url.ts";
import {
  insufficientToolMessage,
  needUrlMessage,
  spendForTool,
} from "./tools/spender.ts";
import { UnpaidCooldown } from "./rate-limit.ts";
import { logError, logInfo, redactSecrets } from "./secrets.ts";

export type Inbox = {
  handleNostrEvent: (event: Event) => Promise<void>;
  injectDevMention: (raw: unknown) => Promise<InboundDevResponse>;
  markPaid: (quoteId: string) => Promise<MarkPaidResponse>;
  settleMintQuotes: () => Promise<number>;
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
  const trimmed = redactSecrets(text.replaceAll("\n", " ").trim());
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}…`;
}

export function createInbox(deps: InboxDeps): Inbox {
  const { env, mock, identity, store, sessions, cashu, llm, getPool } = deps;
  const chains = new Map<string, Promise<unknown>>();
  const unpaidCooldown = new UnpaidCooldown(env.UNPAID_COOLDOWN_MS);
  let settling = false;

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
    if (!published.ok) {
      store.setInbox({ lastError: userFacingMessage("relay") });
    }
    store.recordEvent({
      id: published.event.id,
      kind: published.event.kind,
      label: "reply",
      direction: "out",
      from: identity.npub,
      summary: preview(input.content),
      createdAt: new Date(published.event.created_at * 1000).toISOString(),
      gated: input.gated,
      quoteId: input.quoteId,
    });
    return published.event;
  }

  async function completePaid(text: string): Promise<string> {
    const result = await llm.complete({
      system: paidSystemPrompt(),
      user: stripCashuTokens(text),
    });
    return result.text.slice(0, 2000);
  }

  async function answerPaidPrompt(text: string): Promise<{
    reply: string;
    outcome: Extract<
      InboundOutcome,
      "full" | "tool" | "tool-unaffordable" | "tool-need-url" | "error"
    >;
  }> {
    const intent = routeIntent(text);
    switch (intent.kind) {
      case "chat": {
        try {
          const reply = await completePaid(text);
          return { reply, outcome: "full" };
        } catch (error) {
          logError("llm", error);
          return { reply: userFacingFromError(error), outcome: "error" };
        }
      }
      case "fetch_url_missing":
        return {
          reply: needUrlMessage(env.TOOL_SPEND_SATS),
          outcome: "tool-need-url",
        };
      case "fetch_url": {
        const spend = await spendForTool({
          store,
          cashu,
          amountSats: env.TOOL_SPEND_SATS,
          url: intent.url,
        });
        if (!spend.ok) {
          const insufficient = spend.detail.startsWith("insufficient");
          if (insufficient) {
            return {
              reply: insufficientToolMessage({
                balanceSats: store.getBalance(),
                amountSats: env.TOOL_SPEND_SATS,
              }),
              outcome: "tool-unaffordable",
            };
          }
          return {
            reply: userFacingMessage("wallet"),
            outcome: "error",
          };
        }
        let fetched;
        try {
          fetched = await fetchUrl(intent.url, env.TOOL_FETCH_TIMEOUT_MS);
        } catch (error) {
          logError("tool", error);
          return {
            reply: userFacingMessage("tool"),
            outcome: "error",
          };
        }
        if (!fetched.ok) {
          const reply =
            fetched.error === "timeout"
              ? userFacingMessage("tool-timeout")
              : userFacingMessage("tool", fetched.error);
          return { reply, outcome: "error" };
        }
        const toolBlob = formatFetchResult(fetched);
        try {
          const result = await llm.complete({
            system: `${paidSystemPrompt()} A fetch_url result is attached. Use it in the answer.`,
            user: `User: ${stripCashuTokens(text)}\n\n${toolBlob}`,
          });
          return { reply: result.text.slice(0, 2000), outcome: "tool" };
        } catch (error) {
          logError("llm", error);
          return {
            reply: `${userFacingMessage("llm")}\n\n${toolBlob}`.slice(0, 2000),
            outcome: "tool",
          };
        }
      }
      default:
        return assertNever(intent);
    }
  }

  async function openPaywall(input: {
    senderPubkeyHex: string;
    senderNpub: string;
    eventId: string;
    text: string;
  }): Promise<
    | { ok: true; quoteId: string; message: string; session: SenderSession }
    | { ok: false; message: string }
  > {
    const existing = sessions.getBySender(input.senderPubkeyHex);
    if (existing && existing.state === "pending") {
      sessions.setPendingPrompt(existing.quoteId, {
        eventId: input.eventId,
        text: stripCashuTokens(input.text),
      });
      return {
        ok: true,
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

    let quote;
    try {
      quote = await createAdmissionQuote(cashu, env.PAYMENT_GATE_SATS);
      store.setWalletError(null);
    } catch (error) {
      logError("cashu", error);
      store.setWalletError(userFacingMessage("mint"));
      store.recordPayment({
        id: newId("pay"),
        quoteId: null,
        amountSats: env.PAYMENT_GATE_SATS,
        direction: "in",
        state: { kind: "failed", reason: "mint unreachable" },
        note: `admission quote failed for ${input.senderNpub}`,
        senderNpub: input.senderNpub,
        createdAt: new Date().toISOString(),
      });
      return { ok: false, message: userFacingFromError(error) };
    }

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
      pendingPrompt: {
        eventId: input.eventId,
        text: stripCashuTokens(input.text),
      },
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
      ok: true,
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

  async function applyPaid(quoteId: string): Promise<MarkPaidResponse> {
    const updated = sessions.markPaid(quoteId);
    if (!updated) {
      throw new Error(`unknown quote ${quoteId}`);
    }
    store.markPaymentPaid(quoteId, updated.amountSats);
    store.credit(updated.amountSats);

    const pending = sessions.clearPendingPrompt(quoteId);
    let reply: string | null = null;
    if (pending) {
      const answered = await answerPaidPrompt(pending.text);
      reply = answered.reply;
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
  }

  async function tryReceiveToken(input: {
    eventId: string;
    kind: number;
    senderPubkeyHex: string;
    senderNpub: string;
    text: string;
    createdAt: string;
  }): Promise<{
    handled: boolean;
    outcome: InboundOutcome;
    reply: string | null;
    quoteId: string | null;
  }> {
    const token = extractCashuToken(input.text);
    if (token === undefined || cashu.mock) {
      return {
        handled: false,
        outcome: "paywall",
        reply: null,
        quoteId: null,
      };
    }

    store.recordEvent({
      id: input.eventId,
      kind: input.kind,
      label: "mention",
      direction: "in",
      from: input.senderNpub,
      summary: preview(input.text),
      createdAt: input.createdAt,
      gated: true,
      quoteId: null,
    });

    try {
      const received = await cashu.receiveToken(token);
      store.setWalletError(null);
      store.credit(received.amountSats);
      store.recordPayment({
        id: newId("pay"),
        quoteId: null,
        amountSats: received.amountSats,
        direction: "in",
        state: { kind: "paid", amountSats: received.amountSats },
        note: `cashu token receive from ${input.senderNpub}`,
        senderNpub: input.senderNpub,
        createdAt: new Date().toISOString(),
      });

      if (received.amountSats < env.PAYMENT_GATE_SATS) {
        const message = [
          `Received ${received.amountSats} sat as Cashu.`,
          `Admission is ${env.PAYMENT_GATE_SATS} sat — send the rest to unlock a full reply.`,
        ].join(" ");
        await sendReply({
          content: message,
          replyTo: { id: input.eventId, pubkeyHex: input.senderPubkeyHex },
          gated: true,
          quoteId: null,
        });
        return {
          handled: true,
          outcome: "paywall",
          reply: message,
          quoteId: null,
        };
      }

      const existing = sessions.getBySender(input.senderPubkeyHex);
      const quoteId = existing?.quoteId ?? newId("quote");
      if (existing && existing.state === "pending") {
        sessions.markPaid(quoteId);
        store.markPaymentPaid(quoteId, existing.amountSats);
      } else {
        const now = new Date();
        sessions.upsert({
          senderPubkeyHex: input.senderPubkeyHex,
          senderNpub: input.senderNpub,
          quoteId,
          amountSats: received.amountSats,
          request: "cashu:received",
          state: "paid",
          createdAt: now.toISOString(),
          expiresAt: sessions.expiresAtFor("paid", now),
          paidAt: now.toISOString(),
          paymentRecordId: newId("pay"),
          pendingPrompt: null,
        });
      }

      const answered = await answerPaidPrompt(stripCashuTokens(input.text));
      await sendReply({
        content: answered.reply,
        replyTo: { id: input.eventId, pubkeyHex: input.senderPubkeyHex },
        gated: false,
        quoteId,
      });
      return {
        handled: true,
        outcome: answered.outcome,
        reply: answered.reply,
        quoteId,
      };
    } catch (error) {
      logError("cashu", error);
      store.setWalletError(userFacingMessage("wallet"));
      const message = userFacingFromError(error);
      await sendReply({
        content: message,
        replyTo: { id: input.eventId, pubkeyHex: input.senderPubkeyHex },
        gated: true,
        quoteId: null,
      });
      return { handled: true, outcome: "error", reply: message, quoteId: null };
    }
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
      const answered = await answerPaidPrompt(input.text);
      await sendReply({
        content: answered.reply,
        replyTo: { id: input.eventId, pubkeyHex: input.senderPubkeyHex },
        gated: false,
        quoteId,
      });
      return { outcome: answered.outcome, reply: answered.reply, quoteId };
    }

    const received = await tryReceiveToken(input);
    if (received.handled) {
      return {
        outcome: received.outcome,
        reply: received.reply,
        quoteId: received.quoteId,
      };
    }

    const existing = sessions.getBySender(input.senderPubkeyHex);
    if (
      existing?.state === "pending" &&
      unpaidCooldown.shouldSkip(input.senderPubkeyHex)
    ) {
      sessions.setPendingPrompt(existing.quoteId, {
        eventId: input.eventId,
        text: stripCashuTokens(input.text),
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
        quoteId: existing.quoteId,
      });
      logInfo(
        "inbox",
        `unpaid cooldown: skipped extra paywall for ${input.senderNpub}`,
      );
      return {
        outcome: "throttled",
        reply: null,
        quoteId: existing.quoteId,
      };
    }

    const paywall = await openPaywall({
      senderPubkeyHex: input.senderPubkeyHex,
      senderNpub: input.senderNpub,
      eventId: input.eventId,
      text: input.text,
    });

    if (!paywall.ok) {
      store.recordEvent({
        id: input.eventId,
        kind: input.kind,
        label: "mention",
        direction: "in",
        from: input.senderNpub,
        summary: preview(input.text),
        createdAt: input.createdAt,
        gated: true,
        quoteId: null,
      });
      await sendReply({
        content: paywall.message,
        replyTo: { id: input.eventId, pubkeyHex: input.senderPubkeyHex },
        gated: true,
        quoteId: null,
      });
      return { outcome: "error", reply: paywall.message, quoteId: null };
    }

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
    unpaidCooldown.markSent(input.senderPubkeyHex);
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
    try {
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
    } catch (error) {
      logError("inbox", error);
      const message = userFacingFromError(error);
      try {
        await sendReply({
          content: message,
          replyTo: { id: input.eventId, pubkeyHex: input.senderPubkeyHex },
          gated: false,
          quoteId: null,
        });
      } catch (publishError) {
        logError("inbox", publishError);
      }
      return {
        outcome: "error",
        reply: message,
        quoteId: null,
        senderNpub,
      };
    }
  }

  return {
    async handleNostrEvent(event) {
      try {
        await enqueue(event.pubkey, () =>
          handleNormalized({
            eventId: event.id,
            kind: event.kind,
            senderPubkeyHex: event.pubkey,
            createdAt: new Date(event.created_at * 1000).toISOString(),
            content: event.content,
          }),
        );
      } catch (error) {
        logError("inbox", error);
        store.setInbox({ lastError: userFacingFromError(error) });
      }
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
          session:
            sessions.summaries().find((row) => row.quoteId === quoteId) ?? {
              quoteId: session.quoteId,
              senderNpub: session.senderNpub,
              amountSats: session.amountSats,
              state: session.state,
              request: session.request,
              createdAt: session.createdAt,
              expiresAt: session.expiresAt,
              paidAt: session.paidAt,
              pendingPromptPreview: session.pendingPrompt
                ? redactSecrets(session.pendingPrompt.text).slice(0, 140)
                : null,
            },
        };
      }

      if (!cashu.mock) {
        const settled = await cashu.settleQuote(quoteId);
        switch (settled.kind) {
          case "unpaid":
            throw new Error("mint quote unpaid");
          case "error":
            store.setWalletError(settled.message);
            throw new AgentFaultError("mint", settled.message);
          case "paid":
          case "issued":
            store.setWalletError(null);
            break;
          default:
            return assertNever(settled);
        }
      }

      return applyPaid(quoteId);
    },

    async settleMintQuotes() {
      if (cashu.mock || settling) {
        return 0;
      }
      settling = true;
      let count = 0;
      try {
        const pending = sessions
          .summaries()
          .filter((row) => row.state === "pending");
        for (const row of pending) {
          const settled = await cashu.settleQuote(row.quoteId);
          switch (settled.kind) {
            case "unpaid":
              break;
            case "error":
              store.setWalletError(settled.message);
              break;
            case "paid":
            case "issued":
              store.setWalletError(null);
              await applyPaid(row.quoteId);
              count += 1;
              break;
            default:
              return assertNever(settled);
          }
        }
      } catch (error) {
        logError("cashu", error);
        store.setWalletError(userFacingFromError(error));
      } finally {
        settling = false;
      }
      return count;
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
