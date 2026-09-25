import { useEffect, useState } from "react";
import { api } from "../api/index.js";
import { ApiError } from "../api/errors.js";
import {
  Badge,
  ErrorBanner,
  Notice,
  Skeleton,
  SkeletonList,
  SectionTitle,
  Stat,
  barTone,
} from "../components/ui.jsx";

const QUEUE_NAMES = { food_court: "🍛 Food Court", entry_main: "🚪 Main Entry" };

export default function Organizer() {
  const [summary, setSummary] = useState(null);
  const [volunteers, setVolunteers] = useState([]);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null); // 409 → expected state, not a bug
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // check-in simulator
  const [qr, setQr] = useState("");
  const [checkinResult, setCheckinResult] = useState(null);
  const [checkinBusy, setCheckinBusy] = useState(false);

  async function load() {
    try {
      const [s, v] = await Promise.all([api.organizerSummary(), api.listVolunteers()]);
      setSummary(s);
      setVolunteers(v);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 6000); // live-ish polling
    return () => clearInterval(t);
  }, []);

  async function callNext(queue_id) {
    setConflict(null);
    try {
      const r = await api.callNext({ queue_id });
      setToast(
        r.called_token
          ? `🔔 Token #${r.called_token} called${r.notified ? " — SMS/email sent via SNS" : ""}`
          : "Queue empty — nobody to call"
      );
      load();
    } catch (e) {
      setToast(null);
      if (e instanceof ApiError && e.status === 409) {
        setConflict("Token already served — press again for the next one.");
        load();
      } else {
        setError(e);
      }
    }
  }

  async function simulateCheckin() {
    setCheckinBusy(true);
    setConflict(null);
    try {
      const r = await api.checkin({ qr_code: qr.trim() });
      setCheckinResult(r);
      load();
    } catch (e) {
      setCheckinResult(null);
      if (e instanceof ApiError && e.status === 409) {
        setConflict("Already checked in — the first scan won.");
        load();
      } else {
        setError(e);
      }
    }
    setCheckinBusy(false);
  }

  if (loading) {
    // skeleton: mirrors the real dashboard layout (big number, two columns)
    return (
      <div className="mx-auto max-w-5xl p-4 pb-16">
        <Skeleton className="mb-4 h-10 w-72" />
        <div className="mb-6 card border-rose-500/30 text-center">
          <Skeleton className="mx-auto h-3 w-56" />
          <Skeleton className="mx-auto mt-3 h-16 w-40 rounded-2xl" />
          <Skeleton className="mx-auto mt-3 h-3 w-48" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <SkeletonList count={2} />
          <SkeletonList count={2} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 pb-16">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Organizer Dashboard</h1>
          <p className="text-xs text-slate-400">Auto-refreshes every 6s</p>
        </div>
        <Badge tone="info">🟢 LIVE</Badge>
      </header>

      {toast && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      {conflict && <Notice onDismiss={() => setConflict(null)}>{conflict}</Notice>}
      <ErrorBanner error={error} onRetry={load} />

      {/* Emergency headcount — the big number */}
      <div className="mb-6 card border-rose-500/40 bg-gradient-to-br from-rose-950/60 to-slate-900/80 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-rose-300">🚨 Emergency headcount — people inside</p>
        <p className="mt-1 text-7xl font-black tabular-nums text-white">{summary?.total_inside ?? "—"}</p>
        <p className="text-xs text-slate-400">
          {summary?.checked_in ?? 0} checked in · {summary?.booths?.crowded ?? 0}/{summary?.booths?.total ?? 0} booths crowded
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Halls */}
        <section>
          <SectionTitle>Hall occupancy</SectionTitle>
          <div className="flex flex-col gap-3">
            {(summary?.halls || []).map((h) => {
              const ratio = h.capacity ? h.occupancy / h.capacity : 0;
              return (
                <div key={h.hall} className="card">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold">Hall {h.hall}</span>
                    <Badge tone={ratio >= 0.85 ? "crowded" : ratio >= 0.6 ? "moderate" : "ok"}>
                      {h.occupancy}/{h.capacity}
                    </Badge>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                    <div className={`h-full ${barTone(ratio)}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                  </div>
                </div>
              );
            })}
            {!summary?.halls?.length && <p className="text-sm text-slate-500">No halls configured</p>}
          </div>
        </section>

        {/* Queues */}
        <section>
          <SectionTitle>Queues — call next token</SectionTitle>
          <div className="flex flex-col gap-3">
            {(summary?.queues || []).map((q) => (
              <div key={q.queue_id} className="card flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{QUEUE_NAMES[q.queue_id] || q.queue_id}</p>
                  <p className="text-xs text-slate-400">
                    Now serving <span className="font-bold text-orange-400">#{q.now_serving}</span> · {q.waiting} waiting
                  </p>
                </div>
                <button className="btn-primary" onClick={() => callNext(q.queue_id)}>
                  Call next
                </button>
              </div>
            ))}
            {!summary?.queues?.length && <p className="text-sm text-slate-500">No queues configured</p>}
          </div>
        </section>

        {/* Check-in simulator (demo helper) */}
        <section>
          <SectionTitle>Check-in scanner (demo)</SectionTitle>
          <div className="card flex flex-col gap-3">
            {checkinBusy ? (
              <Skeleton className="h-11 w-full" />
            ) : (
              <input className="input" value={qr} onChange={(e) => setQr(e.target.value)} placeholder="Scan or paste signed QR code (EF-u_xxx.ts.sig)" />
            )}
            <button className="btn-primary" disabled={checkinBusy || !qr.trim()} onClick={simulateCheckin}>
              {checkinBusy ? "Validating…" : "Validate & check in"}
            </button>
            {checkinResult && (
              <p className={`text-sm ${checkinResult.valid ? "text-emerald-400" : "text-amber-300"}`}>
                {checkinResult.valid
                  ? `✅ ${checkinResult.name} checked in at ${new Date(checkinResult.time).toLocaleTimeString()}`
                  : `ℹ️ ${checkinResult.reason === "qr_expired"
                      ? "Pass expired (TTL) — attendee must re-register"
                      : checkinResult.reason === "invalid_signature"
                        ? "Signature invalid — not a genuine EventFlow pass"
                        : checkinResult.reason === "already_checked_in"
                          ? "Already checked in earlier"
                          : `Not admitted: ${checkinResult.reason}`}`}
              </p>
            )}
          </div>
        </section>

        {/* Volunteers */}
        <section>
          <SectionTitle>Volunteers on duty</SectionTitle>
          <div className="card divide-y divide-slate-800 p-0">
            {volunteers.map((v) => (
              <div key={v.volunteer_id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-semibold">{v.name}</p>
                  <p className="text-xs text-slate-400">{v.task} · {v.zone}</p>
                </div>
                <Badge tone="ok">{v.status}</Badge>
              </div>
            ))}
            {!volunteers.length && <p className="px-5 py-3 text-sm text-slate-500">No volunteers configured</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
