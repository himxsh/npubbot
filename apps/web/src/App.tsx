import { useEffect, useState, type FormEvent } from "react";
import type {
  AgentStatus,
  HealthResponse,
  PaymentState,
  SessionState,
} from "@npubbot/shared";
import {
  fetchHealth,
  fetchStatus,
  injectMockMention,
  markInvoicePaid,
} from "./api.ts";

function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

type LoadState =
  | { kind: "loading" }
  | { kind: "offline"; error: string }
  | { kind: "online"; health: HealthResponse; status: AgentStatus };

function formatSats(value: number): string {
  return `${value.toLocaleString()} sat`;
}

function paymentStateText(state: PaymentState): string {
  switch (state.kind) {
    case "unpaid":
      return "unpaid";
    case "pending":
      return "pending";
    case "paid":
      return "paid";
    case "failed":
      return `failed · ${state.reason}`;
    default:
      return assertNever(state);
  }
}

function sessionStateText(state: SessionState): string {
  switch (state) {
    case "pending":
      return "pending";
    case "paid":
      return "paid";
    case "expired":
      return "expired";
    default:
      return assertNever(state);
  }
}

function shortNpub(npub: string): string {
  if (npub.length <= 20) {
    return npub;
  }
  return `${npub.slice(0, 12)}…${npub.slice(-8)}`;
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={on ? "flag flag-mock" : "flag flag-live"}>
      {label} {on ? "mock" : "live"}
    </span>
  );
}

export function App() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [mention, setMention] = useState("what's the mempool saying?");
  const [senderNpub, setSenderNpub] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function poll(): Promise<void> {
      try {
        const [health, status] = await Promise.all([
          fetchHealth(controller.signal),
          fetchStatus(controller.signal),
        ]);
        if (!cancelled) {
          setLoad({ kind: "online", health, status });
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "agent unreachable";
        setLoad({ kind: "offline", error: message });
      }
    }

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  async function refresh(): Promise<void> {
    const [health, status] = await Promise.all([
      fetchHealth(),
      fetchStatus(),
    ]);
    setLoad({ kind: "online", health, status });
  }

  async function onInject(event: FormEvent): Promise<void> {
    event.preventDefault();
    setActionError(null);
    setBusy("inject");
    try {
      const result = await injectMockMention(mention.trim(), senderNpub);
      setSenderNpub(result.senderNpub);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "inject failed");
    } finally {
      setBusy(null);
    }
  }

  async function onMarkPaid(quoteId: string): Promise<void> {
    setActionError(null);
    setBusy(quoteId);
    try {
      await markInvoicePaid(quoteId);
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "mark-paid failed",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="shell">
      <header className="mast">
        <div>
          <p className="eyebrow">localhost operator surface</p>
          <h1>NpubBot</h1>
        </div>
        <p className="lede">
          Mentions hit a Cashu admission gate. Unpaid traffic gets a quote, not
          an LLM answer. Mark a mock invoice paid to unlock the session.
        </p>
      </header>

      {load.kind === "loading" ? (
        <p className="banner">Connecting to agent…</p>
      ) : null}

      {load.kind === "offline" ? (
        <p className="banner banner-warn">
          Agent offline ({load.error}). Start it with{" "}
          <code>pnpm agent</code> or <code>pnpm dev</code>, then wait for the
          next poll.
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
          </section>

          {load.status.inbox.lastError ? (
            <p className="banner banner-warn">
              Relays: {load.status.inbox.lastError}
            </p>
          ) : null}
          {load.status.wallet.lastError ? (
            <p className="banner banner-warn">
              Mint/wallet: {load.status.wallet.lastError}
            </p>
          ) : null}

          {load.status.mock.nostr ? (
            <form className="card action-card" onSubmit={(event) => void onInject(event)}>
              <h2>Mock mention</h2>
              <p className="empty">
                Relays are not connected in mock Nostr. Inject a kind-1 mention
                to exercise the gate. After paying, try{" "}
                <code>fetch https://example.com</code>.
                {senderNpub ? (
                  <>
                    {" "}
                    Reusing {shortNpub(senderNpub)}.{" "}
                    <button
                      type="button"
                      onClick={() => setSenderNpub(undefined)}
                    >
                      New sender
                    </button>
                  </>
                ) : null}
              </p>
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
          ) : null}

          <section className="grid">
            <article className="card">
              <h2>Identity</h2>
              <dl>
                <div>
                  <dt>npub</dt>
                  <dd className="mono" title={load.status.identity.npub}>
                    {shortNpub(load.status.identity.npub)}
                  </dd>
                </div>
                <div>
                  <dt>source</dt>
                  <dd>{load.status.identity.source}</dd>
                </div>
                <div>
                  <dt>up since</dt>
                  <dd className="mono">
                    {new Date(load.status.startedAt).toLocaleString()}
                  </dd>
                </div>
              </dl>
            </article>

            <article className="card">
              <h2>Wallet</h2>
              <p className="balance">{formatSats(load.status.wallet.balanceSats)}</p>
              <dl>
                <div>
                  <dt>mint</dt>
                  <dd className="mono">
                    {load.status.wallet.mintUrl ?? "mock (no mint)"}
                  </dd>
                </div>
                <div>
                  <dt>admission</dt>
                  <dd>{formatSats(load.status.gate.admissionSats)}</dd>
                </div>
                <div>
                  <dt>tool spend</dt>
                  <dd>{formatSats(load.status.gate.toolSpendSats)}</dd>
                </div>
              </dl>
            </article>

            <article className="card">
              <h2>Tool spends</h2>
              {load.status.toolSpends.length === 0 ? (
                <p className="empty">
                  No fetch_url spends yet. After paying, send{" "}
                  <code>fetch https://example.com</code>.
                </p>
              ) : (
                <ul className="events">
                  {load.status.toolSpends.map((spend) => (
                    <li key={spend.id}>
                      <p>
                        <span className="tag">
                          {spend.ok ? "ok" : "blocked"}
                        </span>
                        <span className="mono muted">
                          {spend.tool} · {formatSats(spend.amountSats)}
                        </span>
                      </p>
                      {spend.url ? (
                        <p className="mono muted">{spend.url}</p>
                      ) : null}
                      <p>{spend.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>

          <section className="grid grid-2">
            <article className="card">
              <h2>Sessions & payments</h2>
              {load.status.sessions.length === 0 &&
              load.status.payments.length === 0 ? (
                <p className="empty">No quotes yet. Send a mention first.</p>
              ) : (
                <>
                  {load.status.sessions.length > 0 ? (
                    <ul className="events">
                      {load.status.sessions.map((session) => (
                        <li key={session.quoteId}>
                          <p>
                            <span className="tag">{sessionStateText(session.state)}</span>
                            <span className="mono muted">
                              {formatSats(session.amountSats)} · {session.quoteId}
                            </span>
                          </p>
                          <p className="mono muted">{shortNpub(session.senderNpub)}</p>
                          {session.pendingPromptPreview ? (
                            <p>held: {session.pendingPromptPreview}</p>
                          ) : null}
                          {session.state === "pending" && load.status.mock.cashu ? (
                            <button
                              type="button"
                              onClick={() => void onMarkPaid(session.quoteId)}
                              disabled={busy !== null}
                            >
                              {busy === session.quoteId
                                ? "Unlocking…"
                                : "Mark invoice paid"}
                            </button>
                          ) : null}
                          {session.state === "pending" && !load.status.mock.cashu ? (
                            <button
                              type="button"
                              onClick={() => void onMarkPaid(session.quoteId)}
                              disabled={busy !== null}
                            >
                              {busy === session.quoteId
                                ? "Checking mint…"
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
                          <th>note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {load.status.payments.map((row) => (
                          <tr key={row.id}>
                            <td>{row.direction}</td>
                            <td>{formatSats(row.amountSats)}</td>
                            <td>{paymentStateText(row.state)}</td>
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
                <p className="empty">No events yet.</p>
              ) : (
                <ul className="events">
                  {load.status.events.map((event) => (
                    <li key={event.id}>
                      <p>
                        <span className="tag">{event.direction}</span>
                        <span className="tag">{event.label}</span>
                        {event.gated ? <span className="tag">gated</span> : null}
                        <span className="mono muted">kind {event.kind}</span>
                      </p>
                      <p>{event.summary}</p>
                      <p className="mono muted">{shortNpub(event.from)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>
        </>
      ) : null}

      {load.kind !== "online" ? (
        <section className="grid">
          <article className="card">
            <h2>Wallet</h2>
            <p className="empty">Waiting for /status</p>
          </article>
          <article className="card">
            <h2>Payments</h2>
            <p className="empty">Waiting for /status</p>
          </article>
          <article className="card">
            <h2>Events</h2>
            <p className="empty">Waiting for /status</p>
          </article>
        </section>
      ) : null}
    </div>
  );
}
