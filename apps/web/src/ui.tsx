import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SessionSummary } from "@npubbot/shared";
import {
  expiresIn,
  formatSats,
  type EarningsPoint,
} from "./format.ts";
import {
  BoltIcon,
  CheckIcon,
  ChevronLeft,
  ChevronRight,
  CopyIcon,
  LockIcon,
} from "./icons.tsx";

/* ---------- pagination ---------- */

export type Pager<T> = {
  page: number;
  pages: number;
  slice: T[];
  total: number;
  size: number;
  setPage: (page: number) => void;
};

export function usePager<T>(items: readonly T[], size: number): Pager<T> {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages - 1);
  const slice = useMemo(
    () => items.slice(current * size, current * size + size),
    [items, current, size],
  );
  return { page: current, pages, slice, total: items.length, size, setPage };
}

export function PagerControls<T>({
  pager,
  noun = "items",
}: {
  pager: Pager<T>;
  noun?: string;
}) {
  if (pager.total === 0) {
    return null;
  }
  const from = pager.page * pager.size + 1;
  const to = Math.min(pager.total, from + pager.size - 1);
  return (
    <div className="pager">
      <span className="pager-range">
        {from}–{to} of {pager.total} {noun}
      </span>
      <div className="pager-buttons">
        <button
          type="button"
          className="pager-btn"
          onClick={() => pager.setPage(pager.page - 1)}
          disabled={pager.page === 0}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
          Prev
        </button>
        <span className="pager-page mono">
          {pager.page + 1} / {pager.pages}
        </span>
        <button
          type="button"
          className="pager-btn"
          onClick={() => pager.setPage(pager.page + 1)}
          disabled={pager.page >= pager.pages - 1}
          aria-label="Next page"
        >
          Next
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------- small primitives ---------- */

export type Tone = "ok" | "warn" | "danger" | "muted" | "neutral";

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function Avatar({
  npub,
  size = 28,
  bot = false,
}: {
  npub: string;
  size?: number;
  bot?: boolean;
}) {
  const tone = hash(npub) % 4;
  const letters = npub.startsWith("npub1") ? npub.slice(5, 7) : npub.slice(0, 2);
  return (
    <span
      className={`avatar avatar-t${tone}${bot ? " avatar-bot" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {letters.toUpperCase()}
    </span>
  );
}

export function CopyButton({
  value,
  label = "Copy",
  compact = false,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button
      type="button"
      className={compact ? "icon-btn" : "ghost-btn"}
      onClick={() => void copy()}
      title={copied ? "Copied" : `${label}: ${value}`}
      aria-label={label}
    >
      {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      {compact ? null : <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

/* ---------- earnings chart ---------- */

function niceStep(raw: number): number {
  if (raw <= 0) {
    return 1;
  }
  const exp = 10 ** Math.floor(Math.log10(raw));
  const n = raw / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return Math.max(1, step * exp);
}

function compact(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }
  return String(value);
}

export function EarningsChart({
  series,
  height = 132,
}: {
  series: EarningsPoint[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(620);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) {
      return;
    }
    const update = (): void => setWidth(Math.max(240, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const padL = 34;
  const padR = 12;
  const padT = 10;
  const padB = 24;
  const tickStep = niceStep(Math.max(...series.map((p) => p.sats), 0) / 3);
  const max = tickStep * 3;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const step = series.length > 1 ? innerW / (series.length - 1) : innerW;
  const pts = series.map((p, i) => ({
    x: padL + i * step,
    y: padT + innerH - (p.sats / max) * innerH,
  }));

  let line = "";
  pts.forEach((pt, i) => {
    if (i === 0) {
      line = `M${pt.x},${pt.y}`;
      return;
    }
    const prev = pts[i - 1];
    if (!prev) {
      return;
    }
    const mx = (prev.x + pt.x) / 2;
    line += ` C${mx},${prev.y} ${mx},${pt.y} ${pt.x},${pt.y}`;
  });
  const last = pts[pts.length - 1];
  const first = pts[0];
  const area =
    last && first
      ? `${line} L${last.x},${padT + innerH} L${first.x},${padT + innerH} Z`
      : "";

  const active = hover ?? series.length - 1;
  const activePt = pts[active];
  const activePoint = series[active];
  const ticks = [0, tickStep, tickStep * 2, max];

  return (
    <div className="chart" ref={boxRef}>
      {activePoint && activePt ? (
        <div
          className="chart-tip"
          style={{
            left: `${(activePt.x / width) * 100}%`,
            transform:
              activePt.x > width - 90
                ? "translateX(calc(-100% + 8px))"
                : activePt.x < 90
                  ? "translateX(-8px)"
                  : "translateX(-50%)",
          }}
        >
          <span className="chart-tip-date">{activePoint.date}</span>
          <span className="chart-tip-value mono">{formatSats(activePoint.sats)}</span>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label="Earnings over the last 7 days"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * width;
          const index = Math.round((x - padL) / step);
          setHover(Math.min(series.length - 1, Math.max(0, index)));
        }}
      >
        <defs>
          <linearGradient id="earnFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#9aa4b1" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#9aa4b1" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => {
          const y = padT + innerH - (tick / max) * innerH;
          return (
            <g key={tick}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} className="chart-grid" />
              <text x={padL - 8} y={y + 3} className="chart-axis" textAnchor="end">
                {compact(Math.round(tick))}
              </text>
            </g>
          );
        })}
        <path d={area} fill="url(#earnFill)" />
        <path d={line} className="chart-line" fill="none" />
        {activePt ? (
          <>
            <line
              x1={activePt.x}
              x2={activePt.x}
              y1={activePt.y}
              y2={padT + innerH}
              className="chart-cursor"
            />
            <circle cx={activePt.x} cy={activePt.y} r={4} className="chart-dot" />
          </>
        ) : null}
        {series.map((p, i) => (
          <text
            key={p.label}
            x={padL + i * step}
            y={height - 6}
            className="chart-axis"
            textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}
          >
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ---------- paywall ---------- */

export function Paywall({
  session,
  mockCashu,
  busy,
  disabled,
  onUnlock,
  now,
}: {
  session: SessionSummary;
  mockCashu: boolean;
  busy: boolean;
  disabled: boolean;
  onUnlock: () => void;
  now: number;
}) {
  return (
    <div className="paywall">
      <div className="paywall-head">
        <div className="paywall-method">
          <div className="paywall-method-title">
            <span className="btc" aria-hidden="true">
              ₿
            </span>
            <span>Cashu</span>
            <span className="slash">/</span>
            <span>Lightning</span>
          </div>
          <p className="paywall-sub">Instant, private, and low-fee payment.</p>
        </div>
        <div className="paywall-amount">
          <span className="paywall-amount-value mono">
            {session.amountSats.toLocaleString()}
          </span>
          <span className="paywall-amount-unit">sats</span>
        </div>
      </div>

      <div className="paywall-preview">
        <div className="paywall-preview-head">
          <span>AI reply preview</span>
          <span className="paywall-locked">
            <LockIcon size={14} /> Locked
          </span>
        </div>
        <div className="blur-lines" aria-hidden="true">
          <span style={{ width: "34%" }} />
          <span style={{ width: "26%" }} />
          <span style={{ width: "18%" }} />
          <span style={{ width: "22%" }} />
          <span style={{ width: "19%" }} />
          <span style={{ width: "15%" }} />
          <span style={{ width: "4%" }} />
        </div>
        {session.pendingPromptPreview ? (
          <p className="paywall-held">
            Held prompt: <span>{session.pendingPromptPreview}</span>
          </p>
        ) : null}
        <p className="paywall-foot">
          <LockIcon size={13} /> Pay {formatSats(session.amountSats)} to unlock the
          full reply · expires in {expiresIn(session.expiresAt, now)}
        </p>
      </div>

      <div className="paywall-request">
        <span className="mono" title={session.request}>
          {session.request}
        </span>
        <CopyButton value={session.request} label="Copy request" compact />
      </div>

      <button
        type="button"
        className="btn-unlock"
        onClick={onUnlock}
        disabled={disabled}
      >
        <BoltIcon size={18} />
        {busy
          ? mockCashu
            ? "Unlocking…"
            : "Checking mint…"
          : mockCashu
            ? "Unlock reply"
            : "Check mint & unlock"}
      </button>
      {mockCashu ? (
        <p className="paywall-note">Mock mint — unlocking marks this quote paid.</p>
      ) : null}
    </div>
  );
}
