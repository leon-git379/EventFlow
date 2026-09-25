import { useState } from "react";
import { api } from "../api/index.js";
import { getSession } from "../api/cognito.js";
import { STORAGE_KEYS } from "../api/config.js";
import { ApiError } from "../api/errors.js";
import {
  Badge,
  ErrorBanner,
  Notice,
  Skeleton,
  SkeletonList,
  SectionTitle,
  barTone,
} from "../components/ui.jsx";

const QUEUES = [
  { queue_id: "food_court", name: "Food Court", emoji: "🍛" },
  { queue_id: "entry_main", name: "Main Entry", emoji: "🚪" },
];

export default function Attendee() {
  const user_id = localStorage.getItem(STORAGE_KEYS.USER_ID) || "u_atdemo";
  const name = localStorage.getItem(STORAGE_KEYS.NAME) || "Attendee";

  const [tab, setTab] = useState("pass");
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null); // 409 → expected, not a bug
  const [busy, setBusy] = useState(false);

  // pass
  const [pass, setPass] = useState(null);
  const [regForm, setRegForm] = useState(false);
  const [form, setForm] = useState({ name, email: "demo@eventflow.io", phone: "" });

  // queue
  const [queueId, setQueueId] = useState("food_court");
  const [ticket, setTicket] = useState(null);
  const [status, setStatus] = useState(null);

  // booths
  const [booths, setBooths] = useState([]);
  const [boothsLoaded, setBoothsLoaded] = useState(false);

  async function ensurePass() {
    if (pass) return pass;
    try {
      let p;
      const saved = localStorage.getItem(STORAGE_KEYS.QR_URL);
      if (saved) {
        p = { user_id, qr_code: localStorage.getItem(STORAGE_KEYS.QR_CODE) || `EF-${user_id}`, qr_url: saved };
      } else {
        p = await api.register({ name, email: form.email, phone: form.phone });
        localStorage.setItem(STORAGE_KEYS.QR_URL, p.qr_url);
        localStorage.setItem(STORAGE_KEYS.QR_CODE, p.qr_code);
      }
      setPass(p);
      return p;
    } catch (e) {
      setError(e);
      return null;
    }
  }

  async function ensureBooths() {
    if (boothsLoaded) return;
    try {
      setBooths(await api.listBooths());
      setBoothsLoaded(true);
    } catch (e) {
      setError(e);
    }
  }

  if (tab === "pass" && !pass) ensurePass();
  if (tab === "booths" && !boothsLoaded) ensureBooths();

  async function join() {
    setBusy(true);
    setError(null);
    setConflict(null);
    try {
      const r = idempotentJoin();
      setTicket(await r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // queue busy under heavy concurrent joins — calm notice, retry makes sense
        setConflict("Queue is busy right now — tap Join again to grab your token.");
      } else {
        setError(e);
      }
    }
    setBusy(false);
  }

  function idempotentJoin() {
    return api.joinQueue({ user_id, queue_id: queueId });
  }

  async function refreshStatus() {
    try {
      setStatus(await api.queueStatus({ queue_id: queueId, user_id }));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="mx-auto max-w-md p-4 pb-24">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">
            Hi, <span className="text-orange-500">{name}</span>
          </h1>
          <p className="text-xs text-slate-400">Your event companion</p>
        </div>
        <Badge tone="info">📶 live</Badge>
      </header>

      <Notice onDismiss={() => setConflict(null)}>{conflict}</Notice>
      <ErrorBanner error={error} onRetry={() => setError(null)} />

      <nav className="mb-4 grid grid-cols-3 gap-2">
        {[
          ["pass", "🎫 Pass"],
          ["queue", "⏳ Queue"],
          ["booths", "🏪 Booths"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={tab === k ? "btn-primary" : "btn-ghost"}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "pass" && (
        <section className="flex flex-col gap-4">
          <div className="card flex flex-col items-center gap-3">
            {pass ? (
              <>
                <img src={pass.qr_url} alt="QR pass" className="h-56 w-56 rounded-xl bg-white p-2" />
                <p className="font-mono text-sm text-slate-300">{pass.qr_code}</p>
                <Badge tone="ok">✅ Valid pass — scan at entry</Badge>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="h-56 w-56" />
                <Skeleton className="h-4 w-40" />
              </div>
            )}
          </div>
          <div className="card">
            <p className="text-xs uppercase tracking-wider text-slate-400">Attendee tips</p>
            <ul className="mt-2 list-inside list-disc text-sm text-slate-300">
              <li>Join the Food Court queue before lunch rush</li>
              <li>Booth tab shows the shortest wait right now</li>
            </ul>
          </div>
        </section>
      )}

      {tab === "queue" && (
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {QUEUES.map((q) => (
              <button
                key={q.queue_id}
                onClick={() => {
                  setQueueId(q.queue_id);
                  setTicket(null);
                  setStatus(null);
                }}
                className={queueId === q.queue_id ? "btn-primary" : "btn-ghost"}
              >
                {q.emoji} {q.name}
              </button>
            ))}
          </div>

          {ticket ? (
            <div className="card flex flex-col items-center gap-2 text-center">
              <p className="text-xs uppercase tracking-wider text-slate-400">Your token</p>
              <p className="text-6xl font-black text-orange-500">#{ticket.token}</p>
              <p className="text-sm text-slate-300">
                Position {ticket.position} · ~{ticket.wait_time} min wait
              </p>
              {ticket.already_queued && <Badge tone="muted">already in queue</Badge>}
              <button className="btn-ghost mt-2 w-full" onClick={refreshStatus}>
                Refresh my position
              </button>
            </div>
          ) : (
            <div className="card">
              <p className="mb-3 text-sm text-slate-300">Skip the line — get a token and walk around.</p>
              <button className="btn-primary w-full" disabled={busy} onClick={join}>
                {busy ? "Joining…" : `Join ${QUEUES.find((q) => q.queue_id === queueId)?.name} queue`}
              </button>
            </div>
          )}

          {status?.me && (
            <div className="card text-center">
              <p className="text-xs uppercase tracking-wider text-slate-400">Now serving</p>
              <p className="text-4xl font-black">#{status.now_serving}</p>
              <p className="mt-1 text-sm text-slate-300">
                You are #{status.me.token} — {status.me.position} ahead of you
              </p>
            </div>
          )}

          {status && (
            <div className="card">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Waiting in queue</span>
                <span className="font-semibold">{status.waiting}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Estimated wait</span>
                <span className="font-semibold">{status.avg_wait} min</span>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === "booths" && (
        <section className="flex flex-col gap-3">
          {booths.length === 0 && (
            <SkeletonList count={4} />
          )}
          {booths.map((b) => (
            <div key={b.booth_id} className="card flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{b.name}</span>
                <Badge tone={b.status}>{b.status === "ok" ? "🟢 open" : b.status === "moderate" ? "🟡 moderate" : "🔴 crowded"}</Badge>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className={`h-full ${barTone(b.occupancy / b.capacity)}`} style={{ width: `${Math.min(100, (b.occupancy / b.capacity) * 100)}%` }} />
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>{b.occupancy}/{b.capacity} inside</span>
                <span>~{b.wait_time} min wait</span>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
