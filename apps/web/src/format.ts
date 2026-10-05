import type {
  AgentStatus,
  NostrEventSummary,
  PaymentState,
  SessionState,
  SessionSummary,
} from "@npubbot/shared";

export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

export function formatSats(value: number): string {
  return `${value.toLocaleString()} sats`;
}

export function shortNpub(npub: string, head = 7, tail = 4): string {
  if (npub.length <= head + tail + 1) {
    return npub;
  }
  return `${npub.slice(0, head)}…${npub.slice(-tail)}`;
}

function toDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(iso: string): string {
  const date = toDate(iso);
  if (!date) {
    return iso;
  }
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDate(iso: string): string {
  const date = toDate(iso);
  if (!date) {
    return iso;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatWhen(iso: string): string {
  const date = toDate(iso);
  if (!date) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const date = toDate(iso);
  if (!date) {
    return iso;
  }
  const sec = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (sec < 45) {
    return "just now";
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${Math.max(1, min)} min${min === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(min / 60);
  if (hours < 24) {
    return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function uptimeLabel(startedAt: string, now: number = Date.now()): string {
  const ms = now - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

export function expiresIn(iso: string, now: number = Date.now()): string {
  const date = toDate(iso);
  if (!date) {
    return "—";
  }
  const sec = Math.floor((date.getTime() - now) / 1000);
  if (sec <= 0) {
    return "expired";
  }
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return min > 0 ? `${min}m ${rem.toString().padStart(2, "0")}s` : `${rem}s`;
}

export function paymentStateText(state: PaymentState): string {
  switch (state.kind) {
    case "unpaid":
      return "Unpaid";
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    case "failed":
      return `Failed · ${state.reason}`;
    default:
      return assertNever(state);
  }
}

export function sessionStateText(state: SessionState): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    case "expired":
      return "Expired";
    default:
      return assertNever(state);
  }
}

export function mintHost(url: string | null): string {
  if (!url) {
    return "Mock mint (in-memory)";
  }
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/* ---------- derived mention threads ---------- */

export type ThreadState = "replied" | "awaiting" | "paywalled" | "expired" | "none";

export type Thread = {
  mention: NostrEventSummary;
  replies: NostrEventSummary[];
  session: SessionSummary | null;
  state: ThreadState;
  latencyMs: number | null;
};

export function threadStateText(state: ThreadState): string {
  switch (state) {
    case "replied":
      return "Replied";
    case "awaiting":
      return "Awaiting pay";
    case "paywalled":
      return "Paywalled";
    case "expired":
      return "Expired";
    case "none":
      return "No reply";
    default:
      return assertNever(state);
  }
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function buildThreads(status: AgentStatus): Thread[] {
  const events = [...status.events].sort(
    (a, b) => ms(b.createdAt) - ms(a.createdAt),
  );
  const outbound = events.filter((event) => event.direction === "out");
  const sessions = new Map(status.sessions.map((s) => [s.quoteId, s]));
  const used = new Set<string>();

  const mentions = events.filter(
    (event) => event.direction === "in" && event.label !== "dm",
  );

  return mentions.map((mention) => {
    const start = ms(mention.createdAt);
    const replies = outbound
      .filter((out) => {
        if (used.has(out.id)) {
          return false;
        }
        if (mention.quoteId) {
          return out.quoteId === mention.quoteId;
        }
        const delta = ms(out.createdAt) - start;
        return out.quoteId === null && delta >= -1500 && delta <= 15_000;
      })
      .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    for (const reply of replies) {
      used.add(reply.id);
    }

    const session = mention.quoteId ? (sessions.get(mention.quoteId) ?? null) : null;
    const fullReply = replies.some((reply) => !reply.gated);
    const gatedReply = replies.some((reply) => reply.gated);

    let state: ThreadState;
    if (session?.state === "pending") {
      state = "awaiting";
    } else if (fullReply) {
      state = "replied";
    } else if (session?.state === "expired") {
      state = "expired";
    } else if (gatedReply) {
      state = "paywalled";
    } else {
      state = "none";
    }

    const first = replies[0];
    const latencyMs = first ? Math.max(0, ms(first.createdAt) - start) : null;

    return { mention, replies, session, state, latencyMs };
  });
}

export function latencyLabel(value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (value < 1000) {
    return "<1 s";
  }
  return `${(value / 1000).toFixed(1)} s`;
}

/* ---------- earnings ---------- */

export type EarningsPoint = { label: string; date: string; sats: number };

export type Earnings = {
  total: number;
  last24h: number;
  prev24h: number;
  today: number;
  paidCount: number;
  spent: number;
  series: EarningsPoint[];
};

export function buildEarnings(status: AgentStatus, now: number = Date.now()): Earnings {
  let total = 0;
  let last24h = 0;
  let prev24h = 0;
  let today = 0;
  let paidCount = 0;
  let spent = 0;

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const days = 7;
  const series: EarningsPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(midnight.getTime());
    day.setDate(day.getDate() - i);
    series.push({
      label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      date: day.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      sats: 0,
    });
  }
  const firstDay = new Date(midnight.getTime());
  firstDay.setDate(firstDay.getDate() - (days - 1));

  for (const row of status.payments) {
    if (row.state.kind !== "paid") {
      continue;
    }
    if (row.direction === "out") {
      spent += row.amountSats;
      continue;
    }
    paidCount += 1;
    total += row.amountSats;
    const t = ms(row.createdAt);
    const age = now - t;
    if (age >= 0 && age < 86_400_000) {
      last24h += row.amountSats;
    } else if (age >= 86_400_000 && age < 172_800_000) {
      prev24h += row.amountSats;
    }
    if (t >= midnight.getTime()) {
      today += row.amountSats;
    }
    if (t >= firstDay.getTime()) {
      const index = Math.floor(
        (new Date(t).setHours(0, 0, 0, 0) - firstDay.getTime()) / 86_400_000,
      );
      const point = series[Math.min(days - 1, Math.max(0, Math.round(index)))];
      if (point) {
        point.sats += row.amountSats;
      }
    }
  }

  return { total, last24h, prev24h, today, paidCount, spent, series };
}
