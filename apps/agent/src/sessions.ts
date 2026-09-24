import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  assertNever,
  type SessionState,
  type SessionSummary,
} from "@npubbot/shared";

const persistedSessionSchema = z.object({
  senderPubkeyHex: z.string(),
  senderNpub: z.string(),
  quoteId: z.string(),
  amountSats: z.number().int().nonnegative(),
  request: z.string(),
  state: z.enum(["pending", "paid", "expired"]),
  createdAt: z.string(),
  expiresAt: z.string(),
  paidAt: z.string().nullable(),
  paymentRecordId: z.string(),
  pendingPrompt: z
    .object({
      eventId: z.string(),
      text: z.string(),
    })
    .nullable(),
});

export type SenderSession = z.infer<typeof persistedSessionSchema>;

const fileSchema = z.object({
  sessions: z.array(persistedSessionSchema),
});

export class SessionStore {
  private sessions: SenderSession[] = [];

  constructor(
    private readonly filePath: string,
    private readonly quoteTtlMs: number,
    private readonly paidTtlMs: number,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = fileSchema.parse(JSON.parse(raw));
      this.sessions = parsed.sessions;
      this.expireStale(new Date());
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
      if (code !== "ENOENT") {
        console.warn("[sessions] could not load store, starting empty", error);
      }
      this.sessions = [];
    }
  }

  summaries(): SessionSummary[] {
    this.expireStale(new Date());
    return this.sessions.map((session) => ({
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
    }));
  }

  getBySender(senderPubkeyHex: string): SenderSession | undefined {
    this.expireStale(new Date());
    return this.sessions.find(
      (session) => session.senderPubkeyHex === senderPubkeyHex,
    );
  }

  getByQuoteId(quoteId: string): SenderSession | undefined {
    this.expireStale(new Date());
    return this.sessions.find((session) => session.quoteId === quoteId);
  }

  isPaid(senderPubkeyHex: string): boolean {
    const session = this.getBySender(senderPubkeyHex);
    return session?.state === "paid";
  }

  upsert(session: SenderSession): void {
    this.sessions = this.sessions.filter(
      (row) =>
        row.senderPubkeyHex !== session.senderPubkeyHex &&
        row.quoteId !== session.quoteId,
    );
    this.sessions.unshift(session);
    void this.persist();
  }

  setPendingPrompt(
    quoteId: string,
    prompt: { eventId: string; text: string } | null,
  ): void {
    const session = this.sessions.find((row) => row.quoteId === quoteId);
    if (!session) {
      return;
    }
    session.pendingPrompt = prompt;
    void this.persist();
  }

  markPaid(quoteId: string, now = new Date()): SenderSession | undefined {
    const session = this.sessions.find((row) => row.quoteId === quoteId);
    if (!session) {
      return undefined;
    }
    if (session.state === "expired") {
      return session;
    }
    session.state = "paid";
    session.paidAt = now.toISOString();
    session.expiresAt = new Date(now.getTime() + this.paidTtlMs).toISOString();
    void this.persist();
    return session;
  }

  clearPendingPrompt(quoteId: string): { eventId: string; text: string } | null {
    const session = this.sessions.find((row) => row.quoteId === quoteId);
    if (!session) {
      return null;
    }
    const pending = session.pendingPrompt;
    session.pendingPrompt = null;
    void this.persist();
    return pending;
  }

  private expireStale(now: Date): void {
    let changed = false;
    for (const session of this.sessions) {
      if (session.state === "expired") {
        continue;
      }
      if (Date.parse(session.expiresAt) <= now.getTime()) {
        session.state = "expired";
        changed = true;
      }
    }
    if (changed) {
      void this.persist();
    }
  }

  private ttlFor(state: SessionState, now: Date): string {
    switch (state) {
      case "pending":
        return new Date(now.getTime() + this.quoteTtlMs).toISOString();
      case "paid":
        return new Date(now.getTime() + this.paidTtlMs).toISOString();
      case "expired":
        return now.toISOString();
      default:
        return assertNever(state);
    }
  }

  expiresAtFor(state: SessionState, now = new Date()): string {
    return this.ttlFor(state, now);
  }

  private persistChain: Promise<void> = Promise.resolve();

  private persist(): Promise<void> {
    this.persistChain = this.persistChain.then(
      () => this.writeFile(),
      () => this.writeFile(),
    );
    return this.persistChain;
  }

  private async writeFile(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const payload = JSON.stringify({ sessions: this.sessions }, null, 2);
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, this.filePath);
  }
}
