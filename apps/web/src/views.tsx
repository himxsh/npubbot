import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  AgentStatus,
  HealthResponse,
  InboundDevResponse,
  NostrEventSummary,
  SessionSummary,
} from "@npubbot/shared";
import {
  formatDate,
  formatSats,
  formatTime,
  formatWhen,
  latencyLabel,
  mintHost,
  paymentStateText,
  sessionStateText,
  shortNpub,
  threadStateText,
  timeAgo,
  uptimeLabel,
  type Earnings,
  type Thread,
  type ThreadState,
} from "./format.ts";
import {
  ArrowRight,
  AtIcon,
  BoltIcon,
  BotIcon,
  CoinsIcon,
  ExternalIcon,
  PauseIcon,
  PlayIcon,
  RelayIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  ToolIcon,
  TrendIcon,
  WalletIcon,
} from "./icons.tsx";
import {
  Avatar,
  CopyButton,
  EarningsChart,
  PagerControls,
  Paywall,
  Pill,
  usePager,
  type Tone,
} from "./ui.tsx";

export type View = "overview" | "mentions" | "earnings" | "wallet";

export type DashboardProps = {
  health: HealthResponse;
  status: AgentStatus;
  threads: Thread[];
  earnings: Earnings;
  now: number;
  busy: string | null;
  paused: boolean;
  ready: boolean;
  senderNpub: string | undefined;
  lastResult: InboundDevResponse | null;
  onMarkPaid: (quoteId: string) => void;
  onInject: (text: string) => Promise<boolean>;
  onResetSender: () => void;
  onTogglePause: () => void;
  onNavigate: (view: View, opts?: { compose?: boolean }) => void;
  composeFocus: number;
};

function threadTone(state: ThreadState): Tone {
  switch (state) {
    case "replied":
      return "ok";
    case "awaiting":
      return "warn";
    case "paywalled":
      return "neutral";
    case "expired":
    case "none":
      return "muted";
  }
}

function lastActive(status: AgentStatus): string | null {
  let latest: string | null = null;
  for (const event of status.events) {
    if (!latest || new Date(event.createdAt) > new Date(latest)) {
      latest = event.createdAt;
    }
  }
  return latest;
}

function Card({
  title,
  icon,
  action,
  className,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ""}`}>
      <header className="card-head">
        <h2>
          <span className="card-icon">{icon}</span>
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/* ================= Overview ================= */

export function OverviewView(props: DashboardProps) {
  const { status, health, threads, earnings, ready, now } = props;
  const latest = lastActive(status);
  const pager = usePager(threads, 5);
  const delta =
    earnings.prev24h > 0
      ? ((earnings.last24h - earnings.prev24h) / earnings.prev24h) * 100
      : null;
  const pendingCount = status.sessions.filter((s) => s.state === "pending").length;

  return (
    <div className="view">
      <div className="grid-2">
        <Card title="Bot Status" icon={<BotIcon />}>
          <div className={`bot-state ${ready ? "is-ok" : "is-warn"}`}>
            <span className="dot" />
            {ready ? "Online" : "Degraded"}
          </div>
          <p className="card-sub">
            {ready
              ? "NpubBot is running and ready to respond."
              : health.runtime.warnings[0] ?? "Some subsystems are not ready."}
          </p>
          <dl className="kv">
            <div>
              <dt>Uptime</dt>
              <dd className="mono">{uptimeLabel(status.startedAt, now)}</dd>
            </div>
            <div>
              <dt>Last Active</dt>
              <dd>
                {latest ? (
                  <>
                    <span className="mono">{formatTime(latest)}</span>
                    <small>{formatDate(latest)}</small>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          <div className="flags">
            {(["nostr", "cashu", "llm"] as const).map((key) => {
              const sub = health.runtime.subsystems[key];
              return (
                <span
                  key={key}
                  className={`flag${sub.ready ? "" : " flag-bad"}`}
                  title={sub.detail}
                >
                  {key} <b>{sub.mode}</b>
                </span>
              );
            })}
            <span className="flag" title={status.inbox.relays.join("\n")}>
              relays{" "}
              <b>
                {status.inbox.connected.length}/{status.inbox.relays.length}
              </b>
            </span>
          </div>
        </Card>

        <Card title="Cashu Wallet" icon={<WalletIcon />}>
          <div className="big-number mono">
            {status.wallet.balanceSats.toLocaleString()} <span>sats</span>
          </div>
          <p className="card-sub">Balance available to spend.</p>
          <div className="mint-row">
            <span className="mint-icon">
              <CoinsIcon size={22} />
            </span>
            <div className="mint-meta">
              <span className="label">Mint</span>
              <span className="mint-name" title={status.wallet.mintUrl ?? undefined}>
                {mintHost(status.wallet.mintUrl)}
              </span>
            </div>
            {status.wallet.mintUrl ? (
              <a
                className="icon-btn boxed"
                href={status.wallet.mintUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open mint"
              >
                <ExternalIcon size={16} />
              </a>
            ) : (
              <button
                type="button"
                className="icon-btn boxed"
                onClick={() => props.onNavigate("wallet")}
                aria-label="Open wallet"
              >
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </Card>
      </div>

      <Card title="Earnings" icon={<TrendIcon />} className="earnings-card">
        <div className="earnings">
          <div className="earnings-total">
            <span className="label">Total Earnings</span>
            <span className="big-number mono">
              {earnings.total.toLocaleString()} <span>sats</span>
            </span>
            <span className="earn-today">
              <b className="mono">+{formatSats(earnings.today)}</b> today
            </span>
          </div>
          <div className="earnings-chart">
            <div className="earnings-24h">
              <span className="label">24h Earnings</span>
              <span className="mid-number mono">{formatSats(earnings.last24h)}</span>
              <span className="earn-delta">
                {delta === null ? (
                  <>{earnings.paidCount} paid quotes total</>
                ) : (
                  <>
                    <b className={delta >= 0 ? "up" : "down"}>
                      {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}%
                    </b>{" "}
                    vs yesterday
                  </>
                )}
              </span>
            </div>
            <EarningsChart series={earnings.series} />
          </div>
        </div>
      </Card>

      <Card
        title="Latest Mentions"
        icon={<AtIcon />}
        action={
          <button
            type="button"
            className="link-btn"
            onClick={() => props.onNavigate("mentions")}
          >
            View all mentions <ArrowRight size={14} />
          </button>
        }
      >
        {threads.length === 0 ? (
          <p className="empty">
            No mentions yet.{" "}
            {status.mock.nostr
              ? "Use “Send mock mention” below to exercise the gate."
              : "Waiting for mentions on your relays."}
          </p>
        ) : (
          <>
            <div className="mention-table" role="table">
              {pager.slice.map((thread) => (
                <button
                  type="button"
                  role="row"
                  key={thread.mention.id}
                  className="mention-row"
                  onClick={() => props.onNavigate("mentions")}
                >
                  <span className="mr-from">
                    <Avatar npub={thread.mention.from} size={22} />
                    <span className="mono">{shortNpub(thread.mention.from)}</span>
                  </span>
                  <span className="mr-time mono">{formatTime(thread.mention.createdAt)}</span>
                  <span className="mr-text">{thread.mention.summary}</span>
                  <span className="mr-lat mono">{latencyLabel(thread.latencyMs)}</span>
                  <span className="mr-state">
                    <Pill tone={threadTone(thread.state)}>
                      {threadStateText(thread.state)}
                    </Pill>
                  </span>
                </button>
              ))}
            </div>
            <PagerControls pager={pager} noun="mentions" />
          </>
        )}
      </Card>

      <div className="actions">
        <button type="button" className="action action-secondary" onClick={props.onTogglePause}>
          <span className="action-icon">
            {props.paused ? <PlayIcon size={22} /> : <PauseIcon size={22} />}
          </span>
          <span className="action-text">
            <b>{props.paused ? "Resume Updates" : "Pause Updates"}</b>
            <small>
              {props.paused
                ? "Live polling is frozen — click to resume"
                : "Freeze live polling (agent keeps running)"}
            </small>
          </span>
        </button>
        {pendingCount > 0 ? (
          <button
            type="button"
            className="action action-primary"
            onClick={() => props.onNavigate("wallet")}
          >
            <span className="action-icon">
              <BoltIcon size={22} />
            </span>
            <span className="action-text">
              <b>Settle Quotes</b>
              <small>
                {pendingCount} pending quote{pendingCount === 1 ? "" : "s"} awaiting
                payment
              </small>
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="action action-primary"
            onClick={() => props.onNavigate("mentions", { compose: true })}
            disabled={!status.mock.nostr}
            title={status.mock.nostr ? undefined : "Live Nostr: mentions arrive from relays"}
          >
            <span className="action-icon">
              <SendIcon size={22} />
            </span>
            <span className="action-text">
              <b>Send Mock Mention</b>
              <small>
                {status.mock.nostr
                  ? "Inject a kind-1 mention to exercise the gate"
                  : "Live Nostr — mentions arrive from relays"}
              </small>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ================= Mentions (feed) ================= */

function FeedNote({
  event,
  bot,
  thread,
  children,
  footer,
}: {
  event: NostrEventSummary;
  bot: boolean;
  thread: Thread;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className={`note${bot ? " note-bot" : ""}`}>
      <div className="note-avatar">
        <Avatar npub={event.from} size={44} bot={bot} />
        {bot ? <span className="note-tag">NpubBot</span> : null}
      </div>
      <div className="note-main">
        <header className="note-head">
          <span className="note-name">{bot ? "NpubBot" : shortNpub(event.from, 9, 4)}</span>
          {bot ? <span className="badge">AI</span> : null}
          <span className="note-npub mono">{shortNpub(event.from, 9, 4)}</span>
          <span className="note-when" title={formatWhen(event.createdAt)}>
            {timeAgo(event.createdAt)}
          </span>
        </header>
        {children ?? <p className="note-body">{event.summary}</p>}
        <footer className="note-foot">
          <span className="note-meta">
            <ReplyIcon size={15} /> kind {event.kind}
          </span>
          <span className="note-meta">{event.label}</span>
          {thread.mention.quoteId ? (
            <span className="note-meta mono">{thread.mention.quoteId}</span>
          ) : null}
          <span className="spacer" />
          {footer}
        </footer>
      </div>
    </article>
  );
}

function ThreadView({
  thread,
  props,
}: {
  thread: Thread;
  props: DashboardProps;
}) {
  const { status, busy, now } = props;
  const session = thread.session;
  const pending = session?.state === "pending";
  const fullReplies = thread.replies.filter((r) => !r.gated);
  const gatedReplies = thread.replies.filter((r) => r.gated);

  return (
    <div className="thread">
      <FeedNote
        event={thread.mention}
        bot={false}
        thread={thread}
        footer={
          <Pill tone={threadTone(thread.state)}>{threadStateText(thread.state)}</Pill>
        }
      />
      {pending && session ? (
        <FeedNote
          event={gatedReplies[0] ?? thread.mention}
          bot
          thread={thread}
          footer={<span className="note-meta">Paywall · {formatSats(session.amountSats)}</span>}
        >
          <Paywall
            session={session}
            mockCashu={status.mock.cashu}
            busy={busy === session.quoteId}
            disabled={busy !== null}
            onUnlock={() => props.onMarkPaid(session.quoteId)}
            now={now}
          />
        </FeedNote>
      ) : null}
      {!pending
        ? (fullReplies.length > 0 ? fullReplies : gatedReplies).map((reply) => (
            <FeedNote
              key={reply.id}
              event={reply}
              bot
              thread={thread}
              footer={
                session?.state === "paid" && !reply.gated ? (
                  <span className="sats-chip">
                    <BoltIcon size={14} /> +{formatSats(session.amountSats)}
                    <small>via Cashu</small>
                  </span>
                ) : reply.gated ? (
                  <span className="note-meta">
                    paywall {session ? `· ${sessionStateText(session.state).toLowerCase()}` : ""}
                  </span>
                ) : null
              }
            />
          ))
        : null}
    </div>
  );
}

export function MentionsView(props: DashboardProps) {
  const { status, threads } = props;
  const [query, setQuery] = useState("");
  const [text, setText] = useState("what's the mempool saying?");
  const searchRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (props.composeFocus > 0) {
      composeRef.current?.focus();
    }
  }, [props.composeFocus]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return threads;
    }
    return threads.filter(
      (t) =>
        t.mention.summary.toLowerCase().includes(q) ||
        t.mention.from.toLowerCase().includes(q) ||
        (t.mention.quoteId ?? "").toLowerCase().includes(q) ||
        t.replies.some((r) => r.summary.toLowerCase().includes(q)),
    );
  }, [threads, query]);

  const feed = usePager(filtered, 5);
  const events = useMemo(
    () =>
      [...status.events].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [status.events],
  );
  const log = usePager(events, 8);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (await props.onInject(text.trim())) {
      feed.setPage(0);
    }
  }

  return (
    <div className="view">
      <div className="toolbar">
        <label className="search">
          <SearchIcon size={16} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              feed.setPage(0);
            }}
            placeholder="Search mentions, npubs, quotes…"
            aria-label="Search mentions"
          />
          <kbd>⌘ K</kbd>
        </label>
      </div>

      {status.mock.nostr ? (
        <form className="composer" onSubmit={(e) => void submit(e)}>
          <Avatar npub={props.senderNpub ?? "npub1mock"} size={40} />
          <div className="composer-main">
            <textarea
              ref={composeRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              required
              aria-label="Mock mention text"
              placeholder="Mention @NpubBot…"
            />
            <div className="composer-foot">
              <span className="composer-hint">
                Mock Nostr · after paying, try <code>fetch https://example.com</code>
                {props.senderNpub ? (
                  <>
                    {" "}· as <span className="mono">{shortNpub(props.senderNpub)}</span>{" "}
                    <button type="button" className="link-btn" onClick={props.onResetSender}>
                      new sender
                    </button>
                  </>
                ) : null}
              </span>
              <button
                type="submit"
                className="btn-primary"
                disabled={props.busy !== null || text.trim() === ""}
              >
                <SendIcon size={15} />
                {props.busy === "inject" ? "Sending…" : "Send mention"}
              </button>
            </div>
            {props.lastResult ? (
              <p className="composer-result">
                Outcome <b>{props.lastResult.outcome}</b>
                {props.lastResult.quoteId ? (
                  <>
                    {" "}· quote <span className="mono">{props.lastResult.quoteId}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="notice">
          <RelayIcon size={15} /> Live Nostr — listening on{" "}
          {status.inbox.connected.length}/{status.inbox.relays.length} relays.
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="empty card">
          {query ? "No mentions match your search." : "No mentions yet."}
        </p>
      ) : (
        <div className="feed">
          {feed.slice.map((thread) => (
            <ThreadView key={thread.mention.id} thread={thread} props={props} />
          ))}
          <PagerControls pager={feed} noun="threads" />
          {feed.page === 0 ? (
            <p className="uptodate">
              <BoltIcon size={15} /> You’re up to date. New notes will appear here.
            </p>
          ) : null}
        </div>
      )}

      <Card title="Event Log" icon={<RelayIcon />} action={<span className="card-meta">{events.length} recent</span>}>
        {events.length === 0 ? (
          <p className="empty">No events yet.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>From</th>
                    <th>Type</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {log.slice.map((event) => (
                    <tr key={event.id}>
                      <td className="mono nowrap">{formatTime(event.createdAt)}</td>
                      <td className="mono nowrap">{shortNpub(event.from)}</td>
                      <td className="nowrap">
                        <Pill tone={event.direction === "out" ? "neutral" : "muted"}>
                          {event.direction} · {event.label}
                        </Pill>
                        {event.gated ? <Pill tone="warn">gated</Pill> : null}
                      </td>
                      <td className="truncate" title={event.summary}>
                        {event.summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PagerControls pager={log} noun="events" />
          </>
        )}
      </Card>
    </div>
  );
}

/* ================= Earnings ================= */

function ToolSpendsCard({ status }: { status: AgentStatus }) {
  const pager = usePager(status.toolSpends, 6);
  return (
    <Card
      title="Tool Spends"
      icon={<ToolIcon />}
      action={
        <span className="card-meta">
          {formatSats(status.gate.toolSpendSats)} per fetch_url
        </span>
      }
    >
      {status.toolSpends.length === 0 ? (
        <p className="empty">
          No fetch_url spends yet. After paying, send <code>fetch https://example.com</code>.
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>URL / detail</th>
                </tr>
              </thead>
              <tbody>
                {pager.slice.map((spend) => (
                  <tr key={spend.id}>
                    <td className="mono nowrap">{formatWhen(spend.createdAt)}</td>
                    <td>
                      <Pill tone={spend.ok ? "ok" : "warn"}>{spend.ok ? "OK" : "Blocked"}</Pill>
                    </td>
                    <td className="mono nowrap">{formatSats(spend.amountSats)}</td>
                    <td className="truncate" title={`${spend.url ?? ""} ${spend.detail}`}>
                      {spend.url ? <span className="mono">{spend.url}</span> : null}
                      <span className="muted"> {spend.detail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PagerControls pager={pager} noun="spends" />
        </>
      )}
    </Card>
  );
}

export function EarningsView(props: DashboardProps) {
  const { status, earnings } = props;
  const payments = useMemo(
    () =>
      [...status.payments].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [status.payments],
  );
  const pager = usePager(payments, 8);

  return (
    <div className="view">
      <div className="stats">
        <div className="stat">
          <span className="label">Total earned</span>
          <span className="mid-number mono">{formatSats(earnings.total)}</span>
        </div>
        <div className="stat">
          <span className="label">Last 24h</span>
          <span className="mid-number mono">{formatSats(earnings.last24h)}</span>
        </div>
        <div className="stat">
          <span className="label">Paid quotes</span>
          <span className="mid-number mono">{earnings.paidCount}</span>
        </div>
        <div className="stat">
          <span className="label">Spent on tools</span>
          <span className="mid-number mono">{formatSats(earnings.spent)}</span>
        </div>
      </div>

      <Card title="Earnings · last 7 days" icon={<TrendIcon />}>
        <EarningsChart series={earnings.series} height={220} />
      </Card>

      <Card
        title="Payments"
        icon={<CoinsIcon />}
        action={<span className="card-meta">{payments.length} records</span>}
      >
        {payments.length === 0 ? (
          <p className="empty">No payments yet. Quotes appear here once mentions are gated.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Dir</th>
                    <th>Amount</th>
                    <th>State</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((row) => (
                    <tr key={row.id}>
                      <td className="mono nowrap">{formatWhen(row.createdAt)}</td>
                      <td>{row.direction === "in" ? "In" : "Out"}</td>
                      <td className="mono nowrap">{formatSats(row.amountSats)}</td>
                      <td>
                        <Pill
                          tone={
                            row.state.kind === "paid"
                              ? "ok"
                              : row.state.kind === "failed"
                                ? "danger"
                                : row.state.kind === "pending"
                                  ? "warn"
                                  : "muted"
                          }
                        >
                          {paymentStateText(row.state)}
                        </Pill>
                      </td>
                      <td className="truncate" title={row.note}>
                        {row.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PagerControls pager={pager} noun="payments" />
          </>
        )}
      </Card>

      <ToolSpendsCard status={status} />
    </div>
  );
}

/* ================= Wallet ================= */

function sessionTone(session: SessionSummary): Tone {
  switch (session.state) {
    case "paid":
      return "ok";
    case "pending":
      return "warn";
    case "expired":
      return "muted";
  }
}

export function WalletView(props: DashboardProps) {
  const { status, busy, now } = props;
  const pending = useMemo(
    () => status.sessions.filter((s) => s.state === "pending"),
    [status.sessions],
  );
  const sessions = useMemo(
    () =>
      [...status.sessions].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [status.sessions],
  );
  const pendingPager = usePager(pending, 2);
  const pager = usePager(sessions, 6);

  return (
    <div className="view">
      <div className="grid-2">
        <Card title="Cashu Wallet" icon={<WalletIcon />}>
          <div className="big-number mono">
            {status.wallet.balanceSats.toLocaleString()} <span>sats</span>
          </div>
          <p className="card-sub">Balance available to spend.</p>
          <div className="mint-row">
            <span className="mint-icon">
              <CoinsIcon size={22} />
            </span>
            <div className="mint-meta">
              <span className="label">Mint</span>
              <span className="mint-name mono" title={status.wallet.mintUrl ?? undefined}>
                {status.wallet.mintUrl ?? "Mock mint (in-memory)"}
              </span>
            </div>
            {status.wallet.mintUrl ? (
              <CopyButton value={status.wallet.mintUrl} label="Copy mint URL" compact />
            ) : null}
          </div>
          {status.wallet.lastError ? (
            <p className="inline-warn">{status.wallet.lastError}</p>
          ) : null}
        </Card>

        <Card title="Gate" icon={<BoltIcon />}>
          <dl className="kv kv-grid">
            <div>
              <dt>Admission</dt>
              <dd className="mono">{formatSats(status.gate.admissionSats)}</dd>
            </div>
            <div>
              <dt>Tool spend</dt>
              <dd className="mono">{formatSats(status.gate.toolSpendSats)}</dd>
            </div>
            <div>
              <dt>Session TTL</dt>
              <dd className="mono">{Math.round(status.gate.sessionTtlSeconds / 60)} min</dd>
            </div>
            <div>
              <dt>Fetch timeout</dt>
              <dd className="mono">{(status.gate.toolFetchTimeoutMs / 1000).toFixed(0)} s</dd>
            </div>
            <div>
              <dt>Wallet mode</dt>
              <dd>{status.wallet.mock ? "Mock" : "Live"}</dd>
            </div>
            <div>
              <dt>Sessions</dt>
              <dd className="mono">{status.sessions.length}</dd>
            </div>
          </dl>
        </Card>
      </div>

      {pending.length > 0 ? (
        <Card
          title="Pay for answer"
          icon={<BoltIcon />}
          action={<span className="card-meta">{pending.length} pending</span>}
        >
          <div className="paywall-list">
            {pendingPager.slice.map((session) => (
              <div key={session.quoteId} className="paywall-item">
                <div className="paywall-who">
                  <Avatar npub={session.senderNpub} size={22} />
                  <span className="mono">{shortNpub(session.senderNpub)}</span>
                  <span className="muted mono">{session.quoteId}</span>
                </div>
                <Paywall
                  session={session}
                  mockCashu={status.mock.cashu}
                  busy={busy === session.quoteId}
                  disabled={busy !== null}
                  onUnlock={() => props.onMarkPaid(session.quoteId)}
                  now={now}
                />
              </div>
            ))}
          </div>
          <PagerControls pager={pendingPager} noun="pending" />
        </Card>
      ) : null}

      <Card
        title="Sessions"
        icon={<CoinsIcon />}
        action={<span className="card-meta">{sessions.length} total</span>}
      >
        {sessions.length === 0 ? (
          <p className="empty">No quotes yet. Send a mention first.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Sender</th>
                    <th>Amount</th>
                    <th>State</th>
                    <th>Quote</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((session) => (
                    <tr key={session.quoteId}>
                      <td className="mono nowrap">{formatWhen(session.createdAt)}</td>
                      <td className="mono nowrap">{shortNpub(session.senderNpub)}</td>
                      <td className="mono nowrap">{formatSats(session.amountSats)}</td>
                      <td>
                        <Pill tone={sessionTone(session)}>{sessionStateText(session.state)}</Pill>
                      </td>
                      <td className="mono truncate" title={session.request}>
                        {session.quoteId}
                      </td>
                      <td className="right">
                        {session.state === "pending" ? (
                          <button
                            type="button"
                            className="btn-small"
                            onClick={() => props.onMarkPaid(session.quoteId)}
                            disabled={busy !== null}
                          >
                            {busy === session.quoteId
                              ? status.mock.cashu
                                ? "Marking…"
                                : "Checking…"
                              : status.mock.cashu
                                ? "Mark paid"
                                : "Check mint"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PagerControls pager={pager} noun="sessions" />
          </>
        )}
      </Card>

      <ToolSpendsCard status={status} />
    </div>
  );
}
