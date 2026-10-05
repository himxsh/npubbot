import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentStatus,
  HealthResponse,
  InboundDevResponse,
} from "@npubbot/shared";
import {
  fetchHealth,
  fetchStatus,
  injectMockMention,
  markInvoicePaid,
} from "./api.ts";
import { buildEarnings, buildThreads, formatWhen, shortNpub } from "./format.ts";
import { AtIcon, BarsIcon, BotIcon, GridIcon, WalletIcon } from "./icons.tsx";
import { Avatar, CopyButton } from "./ui.tsx";
import {
  EarningsView,
  MentionsView,
  OverviewView,
  WalletView,
  type DashboardProps,
  type View,
} from "./views.tsx";

type LoadState =
  | { kind: "loading" }
  | { kind: "offline"; error: string }
  | { kind: "online"; health: HealthResponse; status: AgentStatus };

const NAV: { id: View; label: string; icon: typeof GridIcon }[] = [
  { id: "overview", label: "Overview", icon: GridIcon },
  { id: "mentions", label: "Mentions", icon: AtIcon },
  { id: "earnings", label: "Earnings", icon: BarsIcon },
  { id: "wallet", label: "Wallet", icon: WalletIcon },
];

const TITLES: Record<View, { title: string; sub: string }> = {
  overview: {
    title: "Overview",
    sub: "Monitor your bot, earnings, and wallet at a glance.",
  },
  mentions: {
    title: "Mentions",
    sub: "Mentions, replies, and paywalled answers from Nostr.",
  },
  earnings: {
    title: "Earnings",
    sub: "Sats received from admission quotes and spent on tools.",
  },
  wallet: {
    title: "Wallet",
    sub: "Cashu balance, mint, gate pricing, and quote sessions.",
  },
};

function initialView(): View {
  const hash = window.location.hash.replace("#", "");
  return NAV.some((n) => n.id === hash) ? (hash as View) : "overview";
}

export function App() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [view, setView] = useState<View>(initialView);
  const [paused, setPaused] = useState(false);
  const [senderNpub, setSenderNpub] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<InboundDevResponse | null>(null);
  const [composeFocus, setComposeFocus] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (paused) {
      return;
    }
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
        const message = error instanceof Error ? error.message : "agent unreachable";
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
  }, [paused]);

  useEffect(() => {
    const onHash = (): void => setView(initialView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function refresh(): Promise<void> {
    const [health, status] = await Promise.all([fetchHealth(), fetchStatus()]);
    setLoad({ kind: "online", health, status });
  }

  async function onInject(text: string): Promise<boolean> {
    setActionError(null);
    setBusy("inject");
    try {
      const result = await injectMockMention(text, senderNpub);
      setSenderNpub(result.senderNpub);
      setLastResult(result);
      await refresh();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "inject failed");
      return false;
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
      setActionError(error instanceof Error ? error.message : "mark-paid failed");
    } finally {
      setBusy(null);
    }
  }

  const navigate = useCallback((next: View, opts?: { compose?: boolean }) => {
    setView(next);
    window.history.replaceState(null, "", `#${next}`);
    mainRef.current?.scrollTo({ top: 0 });
    if (opts?.compose) {
      setComposeFocus((n) => n + 1);
    }
  }, []);

  const online = load.kind === "online";
  const status = online ? load.status : null;
  const ready = online && load.health.ready;

  const threads = useMemo(() => (status ? buildThreads(status) : []), [status]);
  const earnings = useMemo(
    () => (status ? buildEarnings(status) : null),
    [status],
  );
  const pendingCount =
    status?.sessions.filter((s) => s.state === "pending").length ?? 0;

  const statusLabel = paused
    ? "Paused"
    : load.kind === "loading"
      ? "Connecting"
      : load.kind === "offline"
        ? "Offline"
        : ready
          ? "Online"
          : "Degraded";
  const statusTone = paused
    ? "muted"
    : ready
      ? "ok"
      : load.kind === "online"
        ? "warn"
        : "off";

  const props: DashboardProps | null =
    load.kind === "online" && earnings
      ? {
          health: load.health,
          status: load.status,
          threads,
          earnings,
          now,
          busy,
          paused,
          ready,
          senderNpub,
          lastResult,
          onMarkPaid: (id) => void onMarkPaid(id),
          onInject,
          onResetSender: () => setSenderNpub(undefined),
          onTogglePause: () => setPaused((p) => !p),
          onNavigate: navigate,
          composeFocus,
        }
      : null;

  const head = TITLES[view];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <BotIcon size={22} />
          </span>
          <span className="brand-name">NpubBot</span>
        </div>

        <nav className="nav" aria-label="Primary">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item${view === item.id ? " active" : ""}`}
                onClick={() => navigate(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {item.id === "mentions" && pendingCount > 0 ? (
                  <span className="nav-badge" title="Pending quotes">
                    {pendingCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="side-status">
            <span className="label">
              <span className={`dot dot-${statusTone}`} /> Bot Status
            </span>
            <span className={`side-status-value tone-${statusTone}`}>{statusLabel}</span>
            <span className="side-status-sub">
              {status
                ? `Since ${formatWhen(status.startedAt)}`
                : load.kind === "offline"
                  ? "Agent unreachable"
                  : "Waiting for agent"}
            </span>
          </div>

          {status ? (
            <div className="operator">
              <Avatar npub={status.identity.npub} size={36} bot />
              <div className="operator-meta">
                <span className="mono operator-npub" title={status.identity.npub}>
                  {shortNpub(status.identity.npub, 8, 4)}
                </span>
                <span
                  className="operator-role"
                  title={
                    status.identity.source === "ephemeral-mock"
                      ? "Ephemeral mock identity"
                      : "Identity from env"
                  }
                >
                  Operator
                </span>
              </div>
              <CopyButton value={status.identity.npub} label="Copy npub" compact />
            </div>
          ) : null}
        </div>
      </aside>

      <main className="main" ref={mainRef}>
        <header className="page-head">
          <div>
            <h1>{head.title}</h1>
            <p>{head.sub}</p>
          </div>
          <div className="page-head-right">
            <span className={`status-pill tone-${statusTone}`}>
              <span className={`dot dot-${statusTone}`} />
              {statusLabel}
              {load.kind === "online" ? (
                <span className="status-mode">{load.health.runtime.mode}</span>
              ) : null}
            </span>
            {status ? (
              <span className="head-avatar" title={status.identity.npub}>
                <Avatar npub={status.identity.npub} size={34} bot />
              </span>
            ) : null}
          </div>
        </header>

        {load.kind === "loading" ? <p className="banner">Connecting to agent…</p> : null}
        {load.kind === "offline" ? (
          <p className="banner banner-warn">
            Agent offline ({load.error}). Start with <code>pnpm agent</code> or{" "}
            <code>pnpm dev</code>.
          </p>
        ) : null}
        {paused ? (
          <p className="banner">
            Live updates paused — data may be stale.{" "}
            <button type="button" className="link-btn" onClick={() => setPaused(false)}>
              Resume
            </button>
          </p>
        ) : null}
        {actionError ? (
          <p className="banner banner-warn">
            {actionError}{" "}
            <button type="button" className="link-btn" onClick={() => setActionError(null)}>
              Dismiss
            </button>
          </p>
        ) : null}
        {load.kind === "online" && load.health.runtime.warnings.length > 0 ? (
          <p className="banner banner-warn">
            Config: {load.health.runtime.warnings.join(" · ")}
          </p>
        ) : null}
        {status?.inbox.lastError ? (
          <p className="banner banner-warn">Relays: {status.inbox.lastError}</p>
        ) : null}
        {status?.wallet.lastError && view !== "wallet" ? (
          <p className="banner banner-warn">Mint/wallet: {status.wallet.lastError}</p>
        ) : null}

        {props ? (
          view === "overview" ? (
            <OverviewView {...props} />
          ) : view === "mentions" ? (
            <MentionsView {...props} />
          ) : view === "earnings" ? (
            <EarningsView {...props} />
          ) : (
            <WalletView {...props} />
          )
        ) : null}
      </main>
    </div>
  );
}
