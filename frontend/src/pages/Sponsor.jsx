import { useEffect, useState } from "react";
import { api } from "../api/index.js";
import { STORAGE_KEYS } from "../api/config.js";
import { ApiError } from "../api/errors.js";
import {
  Badge,
  ErrorBanner,
  Notice,
  SkeletonStatGrid,
  SkeletonList,
  SectionTitle,
  Stat,
} from "../components/ui.jsx";

const SPONSORS = [
  { id: "aws", name: "AWS", emoji: "☁️" },
  { id: "github", name: "GitHub", emoji: "🐙" },
  { id: "mongodb", name: "MongoDB", emoji: "🍃" },
  { id: "zoho", name: "Zoho", emoji: "⚡" },
];

export default function Sponsor() {
  const [sponsorId, setSponsorId] = useState("aws");
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState(null); // 409 → expected, not a bug
  const [redeemMsg, setRedeemMsg] = useState(null);

  const user_id = localStorage.getItem(STORAGE_KEYS.USER_ID) || "u_spdemo";

  async function load(id = sponsorId) {
    try {
      setStats(await api.sponsorStats({ sponsor_id: id }));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load(sponsorId);
    const t = setInterval(() => load(sponsorId), 8000);
    return () => clearInterval(t);
  }, [sponsorId]);

  async function redeem(item_id) {
    setRedeemMsg(null);
    setConflict(null);
    try {
      const r = await api.redeemSwag({ user_id, item_id, booth_id: sponsorId });
      setRedeemMsg(
        r.redeemed
          ? `🎁 Redeemed! ${r.remaining} left`
          : r.reason === "already_redeemed"
            ? "You already redeemed this item"
            : "Out of stock"
      );
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // duplicate redemption raced through as a conflict — same meaning
        setConflict("Already redeemed — the first scan won, no double swag.");
        load();
      } else {
        setError(e);
      }
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 pb-16">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Sponsor Dashboard</h1>
          <p className="text-xs text-slate-400">Booth engagement & swag inventory</p>
        </div>
        <Badge tone="info">🟢 LIVE</Badge>
      </header>

      <Notice onDismiss={() => setConflict(null)}>{conflict}</Notice>
      <ErrorBanner error={error} onRetry={() => load()} />

      <nav className="mb-4 flex flex-wrap gap-2">
        {SPONSORS.map((s) => (
          <button key={s.id} onClick={() => setSponsorId(s.id)} className={sponsorId === s.id ? "btn-primary" : "btn-ghost"}>
            {s.emoji} {s.name}
          </button>
        ))}
      </nav>

      {loading ? (
        <>
          {/* skeleton mirrors the real layout: 4 stat tiles + 2 content cards */}
          <SkeletonStatGrid count={4} />
          <SkeletonList count={2} />
        </>
      ) : (
        stats && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Visitors today" value={stats.visitors_today} tone="text-sky-400" />
              <Stat label="Avg wait" value={`${stats.avg_wait}m`} tone="text-amber-400" />
              <Stat label="Swag given" value={stats.swag_distributed} tone="text-emerald-400" />
              <Stat label="Swag left" value={stats.swag_remaining} tone="text-white" />
            </div>

            <SectionTitle>Booth status</SectionTitle>
            <div className="mb-6 card">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="text-slate-400">Current occupancy</span>
                <span className="font-semibold">{stats.occupancy ?? 0}/{stats.capacity ?? 0} inside</span>
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
                <span className="text-slate-400">Swag stock</span>
                <span className="font-semibold">
                  {stats.swag_distributed} of {stats.swag_stock ?? stats.swag_distributed + stats.swag_remaining} distributed
                </span>
              </div>
            </div>

            <SectionTitle>Redeem swag (demo)</SectionTitle>
            <div className="card flex flex-col gap-2">
              <button className="btn-primary" onClick={() => redeem("aws_tshirt")}>
                Redeem AWS T-shirt
              </button>
              <button className="btn-ghost" onClick={() => redeem("aws_stickers")}>
                Redeem AWS Stickers
              </button>
              {redeemMsg && <p className="text-sm text-slate-300">{redeemMsg}</p>}
              <p className="text-xs text-slate-500">
                Duplicate-proof: same attendee can't redeem twice (enforced in DynamoDB, not the UI).
              </p>
            </div>
          </>
        )
      )}
    </div>
  );
}
