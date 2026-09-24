import { useEffect, useState } from "react";
import type {
  AgentStatus,
  HealthResponse,
  PaymentState,
} from "@npubbot/shared";
import { fetchHealth, fetchStatus } from "./api.ts";

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

  return (
    <div className="shell">
      <header className="mast">
        <div>
          <p className="eyebrow">localhost operator surface</p>
          <h1>NpubBot</h1>
        </div>
        <p className="lede">
          Nostr in, sats through the gate, one paid tool out. This dashboard
          polls the agent stubs — it is not a user-facing client.
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

      {load.kind === "online" ? (
        <>
          <section className="flags">
            <Flag on={load.status.mock.nostr} label="nostr" />
            <Flag on={load.status.mock.cashu} label="cashu" />
            <Flag on={load.status.mock.llm} label="llm" />
            <span className="flag flag-ok">health ok</span>
          </section>

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
              <h2>Last tool spend</h2>
              {load.status.lastToolSpend ? (
                <dl>
                  <div>
                    <dt>tool</dt>
                    <dd className="mono">{load.status.lastToolSpend.tool}</dd>
                  </div>
                  <div>
                    <dt>amount</dt>
                    <dd>{formatSats(load.status.lastToolSpend.amountSats)}</dd>
                  </div>
                  <div>
                    <dt>result</dt>
                    <dd>
                      {load.status.lastToolSpend.ok ? "ok" : "blocked"} ·{" "}
                      {load.status.lastToolSpend.detail}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="empty">No tool spend yet.</p>
              )}
            </article>
          </section>

          <section className="grid grid-2">
            <article className="card">
              <h2>Payments</h2>
              {load.status.payments.length === 0 ? (
                <p className="empty">No payments recorded.</p>
              ) : (
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
