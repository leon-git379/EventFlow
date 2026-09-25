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
