import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentStatus, HealthResponse, InboundOutcome } from "@npubbot/shared";
import {
  fetchHealth,
  fetchStatus,
  injectMockMention,
  markInvoicePaid,
} from "./api.ts";
import {
  formatAgo,
  formatDelta,
  formatSats,
  paymentStateText,
  requestKind,
  sessionStateText,
  shortNpub,
} from "./format.ts";

const POLL_MS = 1500;

type LoadState =
  | { kind: "loading" }
  | { kind: "offline"; error: string }
  | {
      kind: "online";
      health: HealthResponse;
      status: AgentStatus;
      updatedAt: number;
      staleError: string | null;
    };

type LastAction = {
  outcome: InboundOutcome | "paid";
  at: number;
};

const PRESETS = [
  { id: "ask", label: "Unpaid question", text: "what is npubbot?" },
  { id: "chat", label: "Paid chat", text: "say hi in five words" },
  { id: "fetch", label: "fetch_url", text: "fetch https://example.com" },
  { id: "lookup", label: "Lookup, no URL", text: "lookup the mempool" },
] as const;

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

function useAgentFeed(): {
  load: LoadState;
  refresh: () => Promise<void>;
} {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  const refresh = useCallback(async (): Promise<void> => {
    const [health, status] = await Promise.all([fetchHealth(), fetchStatus()]);
    setLoad({
      kind: "online",
      health,
      status,
      updatedAt: Date.now(),
      staleError: null,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inflight: AbortController | null = null;

    async function poll(): Promise<void> {
      inflight?.abort();
      const controller = new AbortController();
      inflight = controller;
      try {
        const [health, status] = await Promise.all([
          fetchHealth(controller.signal),
          fetchStatus(controller.signal),
        ]);
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setLoad({
          kind: "online",
          health,
          status,
          updatedAt: Date.now(),
          staleError: null,
        });
      } catch (error) {
        if (cancelled || controller.signal.aborted || isAbort(error)) {
          return;
        }
        const message = error instanceof Error ? error.message : "agent unreachable";
        setLoad((current) => {
          if (current.kind === "online") {
            return { ...current, staleError: message };
          }
          return { kind: "offline", error: message };
        });
      }
    }

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_MS);

    return () => {
      cancelled = true;
      inflight?.abort();
      window.clearInterval(timer);
    };
  }, []);

  return { load, refresh };
}

function demoBeats(status: AgentStatus): Array<{
  id: string;
  label: string;
  hint: string;
  done: boolean;
}> {
  const spent = status.toolSpends.some((row) => row.ok);
  const replied =
    spent ||
    status.events.some((event) => event.direction === "out" && !event.gated);
  const paid = replied || status.sessions.some((session) => session.state === "paid");
  const quoted =
    paid ||
    status.sessions.length > 0 ||
    status.events.some((event) => event.gated);
  return [
    {
      id: "quote",
      label: "Unpaid mention",
      hint: "Quote, not an LLM answer",
      done: quoted,
    },
    {
      id: "paid",
      label: "Session paid",
      hint: status.mock.cashu ? "Mark invoice paid" : "Mint quote settles",
      done: paid,
    },
    {
      id: "reply",
      label: "Full reply",
      hint: "Held prompt goes to the LLM",
      done: replied,
    },
    {
      id: "spend",
      label: "fetch_url spend",
      hint: `${status.gate.toolSpendSats} sat from the wallet`,
      done: spent,
    },
  ];
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={on ? "flag flag-mock" : "flag flag-live"}>
      {label} {on ? "mock" : "live"}
    </span>
  );
}

export function App() {
  const now = useNow(1000);
  const { load, refresh } = useAgentFeed();
  const [mention, setMention] = useState("what is npubbot?");
  const [senderNpub, setSenderNpub] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());
  const prevBalance = useRef<number | null>(null);
  const seenEvents = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const balance = load.kind === "online" ? load.status.wallet.balanceSats : null;
  const eventKey =
    load.kind === "online" ? load.status.events.map((event) => event.id).join("|") : "";

  useEffect(() => {
    if (balance === null) {
      return;
    }
    const previous = prevBalance.current;
    prevBalance.current = balance;
    if (previous === null || previous === balance) {
      return;
    }
    setDelta(balance - previous);
  }, [balance]);

  useEffect(() => {
    if (delta === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDelta(null);
    }, 2800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [delta]);

  useEffect(() => {
    if (load.kind !== "online") {
      return;
    }
    const ids = load.status.events.map((event) => event.id);
    if (!primed.current) {
      for (const id of ids) {
        seenEvents.current.add(id);
      }
      primed.current = true;
      return;
    }
    const arrived = ids.filter((id) => !seenEvents.current.has(id));
    for (const id of arrived) {
      seenEvents.current.add(id);
    }
    if (arrived.length === 0) {
      return;
    }
    setFreshIds(new Set(arrived));
  }, [load, eventKey]);

  useEffect(() => {
    if (freshIds.size === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setFreshIds(new Set());
    }, 1800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [freshIds]);

  async function sendMention(text: string): Promise<void> {
    setActionError(null);
    setBusy("inject");
    try {
      const result = await injectMockMention(text, senderNpub);
      setSenderNpub(result.senderNpub);
      setMention(text);
      setLastAction({ outcome: result.outcome, at: Date.now() });
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "inject failed");
    } finally {
      setBusy(null);
    }
  }

  async function onInject(event: FormEvent): Promise<void> {
    event.preventDefault();
    await sendMention(mention.trim());
  }

  async function onMarkPaid(quoteId: string): Promise<void> {
    setActionError(null);
    setBusy(quoteId);
    try {
      await markInvoicePaid(quoteId);
      setLastAction({ outcome: "paid", at: Date.now() });
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "mark-paid failed");
    } finally {
      setBusy(null);
    }
  }

  const beats = load.kind === "online" ? demoBeats(load.status) : [];
  const latestReply =
    load.kind === "online"
      ? load.status.events.find((event) => event.direction === "out")
      : undefined;
  const pendingCount =
    load.kind === "online"
      ? load.status.sessions.filter((session) => session.state === "pending").length
      : 0;
  const paidCount =
    load.kind === "online"
      ? load.status.sessions.filter((session) => session.state === "paid").length
      : 0;

  return (
    <div className="shell">
      <header className="mast">
        <div>
          <p className="eyebrow">localhost operator surface</p>
          <h1>NpubBot</h1>
        </div>
        <div className="mast-side">
          {load.kind === "online" ? (
            <p className="live-pill">
              <span className={load.staleError ? "live-dot live-dot-stale" : "live-dot"} />
              <span>{load.staleError ? "retrying" : "live"}</span>
              <span className="clock">{new Date(now).toLocaleTimeString()}</span>
              <span className="muted">
                polled {formatAgo(new Date(load.updatedAt).toISOString(), now)}
              </span>
            </p>
          ) : (
            <p className="live-pill">
              <span className="live-dot live-dot-stale" />
              <span>{load.kind === "loading" ? "connecting" : "offline"}</span>
            </p>
          )}
          <p className="lede">
            Mentions hit a Cashu admission gate. Unpaid traffic gets a quote.
            After it is paid, the held prompt gets a full reply.{" "}
            <code>fetch https://example.com</code> spends sats from the agent
            wallet.
          </p>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {load.kind === "online"
          ? `Wallet ${load.status.wallet.balanceSats} sat. ${pendingCount} unpaid sessions, ${paidCount} paid. Updated ${formatAgo(new Date(load.updatedAt).toISOString(), now)}.`
          : load.kind === "offline"
            ? `Agent offline. ${load.error}`
            : "Connecting to agent."}
      </p>

      {load.kind === "loading" ? (
        <p className="banner">Connecting to the agent status API…</p>
      ) : null}

      {load.kind === "offline" ? (
        <p className="banner banner-warn">
          Agent offline ({load.error}). Start it with <code>pnpm agent</code> or{" "}
          <code>pnpm dev</code>. This page keeps polling.
        </p>
      ) : null}

      {load.kind === "online" && load.staleError ? (
        <p className="banner banner-warn">
          Last poll failed ({load.staleError}). Showing the previous status and
          retrying.
        </p>
      ) : null}

      {actionError ? <p className="banner banner-warn">{actionError}</p> : null}

      {load.kind === "online" ? (
        <>
          <section className="flags">
            <Flag on={load.status.mock.nostr} label="nostr" />
            <Flag on={load.status.mock.cashu} label="cashu" />
            <Flag on={load.status.mock.llm} label="llm" />
            <span className="flag flag-ok">health ok</span>
            <span className="flag">
              relays {load.status.inbox.connected.length}/
              {load.status.inbox.relays.length}
              {load.status.inbox.mock ? " · mock inbox" : ""}
            </span>
            {lastAction ? (
              <span className="flag flag-live">
                last action {lastAction.outcome} · {formatAgo(new Date(lastAction.at).toISOString(), now)}
              </span>
            ) : null}
          </section>

          {load.status.inbox.lastError ? (
            <p className="banner banner-warn">Relays: {load.status.inbox.lastError}</p>
          ) : null}
          {load.status.wallet.lastError ? (
            <p className="banner banner-warn">
              Mint/wallet: {load.status.wallet.lastError}
            </p>
          ) : null}

          <ol className="beats">
            {beats.map((beat, index) => (
              <li key={beat.id} className={beat.done ? "beat beat-done" : "beat"}>
                <span className="beat-index">{beat.done ? "✓" : index + 1}</span>
                <span>
                  <strong>{beat.label}</strong>
                  <span className="muted">{beat.hint}</span>
                </span>
              </li>
            ))}
          </ol>

          <section className="stats">
            <article className={delta === null ? "stat" : "stat stat-flash"}>
              <h2>Wallet</h2>
              <p className="balance">
                {formatSats(load.status.wallet.balanceSats)}
                {delta !== null ? (
                  <span className={delta > 0 ? "delta delta-up" : "delta delta-down"}>
                    {formatDelta(delta)}
                  </span>
                ) : null}
              </p>
              <p className="muted fine">
                {load.status.wallet.mock
                  ? "In-memory mock sats. Mark paid credits admission. fetch_url debits the tool price. Not a Lightning payment."
                  : "Live Cashu proofs in this process. Invoices are mint quotes. Proofs are not saved across restarts."}
              </p>
            </article>
            <article className={pendingCount > 0 ? "stat attention" : "stat"}>
              <h2>Sessions</h2>
              <p className="balance balance-small">
                {pendingCount} unpaid
              </p>
              <p className="muted fine">{paidCount} paid · admission {formatSats(load.status.gate.admissionSats)}</p>
            </article>
            <article className="stat">
              <h2>Tool spends</h2>
              <p className="balance balance-small">
                {load.status.toolSpends.filter((row) => row.ok).length} ok
              </p>
              <p className="muted fine">
                {formatSats(load.status.gate.toolSpendSats)} each ·{" "}
                {load.status.toolSpends.filter((row) => !row.ok).length} blocked
              </p>
            </article>
          </section>

          {load.status.mock.nostr ? (
            <form className="card action-card" onSubmit={(event) => void onInject(event)}>
              <div className="card-head">
                <h2>Mock mention</h2>
                <p className="muted fine">
                  {senderNpub ? (
                    <>
                      Sender {shortNpub(senderNpub)}{" "}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSenderNpub(undefined)}
                      >
                        New sender
                      </button>
                    </>
                  ) : (
                    "First send creates a sender. Later sends reuse it so the paid session sticks."
                  )}
                </p>
              </div>
              <div className="presets">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void sendMention(preset.text)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <textarea
                value={mention}
                onChange={(event) => setMention(event.target.value)}
                rows={3}
                required
              />
              <button type="submit" disabled={busy !== null || mention.trim() === ""}>
                {busy === "inject" ? "Sending…" : "Send mock mention"}
              </button>
            </form>
          ) : (
            <p className="banner">
              Live Nostr inbox. Mentions on the relays show up here on the next
              poll. Use <strong>Check mint payment</strong> if Cashu is live.
            </p>
          )}

          <article className={latestReply && freshIds.has(latestReply.id) ? "card hero is-new" : "card hero"}>
            <div className="card-head">
              <h2>Latest reply</h2>
              {latestReply ? (
                <p className="muted fine">
                  {latestReply.gated ? "paywall bill" : "full reply"} ·{" "}
                  {formatAgo(latestReply.createdAt, now)}
                </p>
              ) : (
                <p className="muted fine">Waiting for the agent to publish</p>
              )}
            </div>
            {latestReply ? (
              <pre className="reply">{latestReply.detail}</pre>
            ) : (
              <p className="empty">
                Send a mock mention. The paywall quote, then the LLM reply,
                then the fetch result show up here as the agent records them.
              </p>
            )}
          </article>

          <section className="grid grid-2">
            <article className="card">
              <h2>Sessions & payments</h2>
              {load.status.sessions.length === 0 && load.status.payments.length === 0 ? (
                <p className="empty">No quotes yet. Send a mention first.</p>
              ) : (
                <>
                  {load.status.sessions.length > 0 ? (
                    <ul className="events">
                      {load.status.sessions.map((session) => (
                        <li
                          key={session.quoteId}
                          className={session.state === "pending" ? "attention-row" : undefined}
                        >
                          <p>
                            <span className={`tag tag-${session.state}`}>
                              {sessionStateText(session.state)}
                            </span>
                            <span className="mono muted">
                              {formatSats(session.amountSats)} · {session.quoteId}
                            </span>
                          </p>
                          <p className="mono muted" title={session.senderNpub}>
                            {shortNpub(session.senderNpub)} · {formatAgo(session.createdAt, now)}
                          </p>
                          {session.pendingPromptPreview ? (
                            <p>held: {session.pendingPromptPreview}</p>
                          ) : null}
                          <p className="fine muted">{requestKind(session.request, load.status.mock.cashu)}</p>
                          <p className="mono request">{session.request}</p>
                          {session.state === "pending" ? (
                            <button
                              type="button"
                              onClick={() => void onMarkPaid(session.quoteId)}
                              disabled={busy !== null}
                            >
                              {busy === session.quoteId
                                ? load.status.mock.cashu
                                  ? "Unlocking…"
                                  : "Checking mint…"
                                : load.status.mock.cashu
                                  ? "Mark invoice paid"
                                  : "Check mint payment"}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {load.status.payments.length > 0 ? (
                    <table>
                      <thead>
                        <tr>
                          <th>dir</th>
                          <th>amount</th>
                          <th>state</th>
                          <th>when</th>
                          <th>note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {load.status.payments.map((row) => (
                          <tr key={row.id}>
                            <td className={row.direction === "in" ? "dir-in" : "dir-out"}>
                              {row.direction}
                            </td>
                            <td>{formatSats(row.amountSats)}</td>
                            <td>{paymentStateText(row.state)}</td>
                            <td className="muted">{formatAgo(row.createdAt, now)}</td>
                            <td>{row.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </>
              )}
            </article>

            <article className="card">
              <h2>Recent Nostr events</h2>
              {load.status.events.length === 0 ? (
                <p className="empty">No events yet. The list fills as mentions and replies land.</p>
              ) : (
                <ul className="events">
                  {load.status.events.map((event) => (
                    <li key={event.id} className={freshIds.has(event.id) ? "is-new" : undefined}>
                      <p>
                        <span className="tag">{event.direction}</span>
                        <span className="tag">{event.label}</span>
                        {event.gated ? <span className="tag">gated</span> : null}
                        <span className="mono muted">{formatAgo(event.createdAt, now)}</span>
                      </p>
                      <p>{event.summary}</p>
                      <p className="mono muted" title={event.from}>
                        {shortNpub(event.from)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>

          <article className="card">
            <h2>Tool spend log</h2>
            {load.status.toolSpends.length === 0 ? (
              <p className="empty">
                No fetch_url spends yet. After the session is paid, send{" "}
                <code>fetch https://example.com</code>.
              </p>
            ) : (
              <ul className="events">
                {load.status.toolSpends.map((spend) => (
                  <li key={spend.id}>
                    <p>
                      <span className={spend.ok ? "tag tag-paid" : "tag tag-expired"}>
                        {spend.ok ? "ok" : "blocked"}
                      </span>
                      <span className="mono muted">
                        {spend.tool} · {formatSats(spend.amountSats)} · {formatAgo(spend.createdAt, now)}
                      </span>
                    </p>
                    {spend.url ? <p className="mono muted">{spend.url}</p> : null}
                    <p>{spend.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <p className="footnote muted">
            Identity {shortNpub(load.status.identity.npub)} ({load.status.identity.source}) · up{" "}
            {formatAgo(load.status.startedAt, now)} · status {formatAgo(load.status.observedAt, now)} · polls every {POLL_MS / 1000}s. Encrypted DMs and proof files are outside this demo.
          </p>
        </>
      ) : null}
    </div>
  );
}
