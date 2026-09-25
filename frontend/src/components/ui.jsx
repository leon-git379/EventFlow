import { messageFor } from "../api/errors.js";

export function Badge({ tone, children }) {
  const tones = {
    ok: "bg-emerald-500/15 text-emerald-400",
    moderate: "bg-amber-500/15 text-amber-400",
    crowded: "bg-rose-500/15 text-rose-400",
    info: "bg-sky-500/15 text-sky-400",
    muted: "bg-slate-700/50 text-slate-300",
  };
  return <span className={`pill ${tones[tone] || tones.muted}`}>{children}</span>;
}

export function Stat({ label, value, sub, tone = "text-white" }) {
  return (
    <div className="card flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <span className={`text-3xl font-bold ${tone}`}>{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      <span>⚠️ {messageFor(error)}</span>
      {onRetry && (
        <button className="rounded-lg border border-rose-400/40 px-3 py-1 text-xs font-semibold hover:bg-rose-500/20" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// 409s are EXPECTED states (already redeemed / already served / queue busy),
// not bugs — they render as a calm amber notice, never the red error banner.
export function Notice({ children, onDismiss }) {
  if (!children) return null;
  return (
    <div
      className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
      onClick={onDismiss}
    >
      <span>ℹ️ {children}</span>
      {onDismiss && <span className="cursor-pointer text-xs text-amber-400/70">dismiss</span>}
    </div>
  );
}

// Skeleton loaders — Lambda cold starts take ~1s, so every screen shows
// layout-shaped shimmer blocks instead of spinners (feels instant, looks
// deliberate on a projector).
export function Skeleton({ className = "", style }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

export function SkeletonStatGrid({ count = 4 }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 2 }) {
  return (
    <div className="card flex flex-col gap-3">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${85 - i * 20}%` }} />
      ))}
    </div>
  );
}

export function SkeletonList({ count = 4 }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={2} />
      ))
      }
    </div>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-orange-400" />
      {label}
    </div>
  );
}

export function SectionTitle({ children }) {
  return <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{children}</h2>;
}

export function barTone(ratio) {
  if (ratio >= 0.85) return "bg-rose-500";
  if (ratio >= 0.6) return "bg-amber-400";
  return "bg-emerald-500";
}
