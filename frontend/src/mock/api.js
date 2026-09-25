// Mock API — same function signatures/response shapes as src/api/live.js so the
// UI can't tell them apart. State mutates a little each poll to feel live.
import { MOCK_LATENCY_MS, STORAGE_KEYS } from "../api/config.js";
import * as seed from "./data.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (n, pct = 0.15) => Math.max(0, Math.round(n * (1 + (Math.random() * 2 - 1) * pct)));
const iso = () => new Date().toISOString();

const state = {
  booths: JSON.parse(JSON.stringify(seed.booths)),
  halls: JSON.parse(JSON.stringify(seed.halls)),
  queues: JSON.parse(JSON.stringify(seed.queues)),
  inventory: JSON.parse(JSON.stringify(seed.inventory)),
  sponsorStats: JSON.parse(JSON.stringify(seed.sponsorStats)),
  checkins: seed.checkinCounter.n,
  userTokens: {}, // user_id -> { queue_id, token }
  redeemed: new Set(),
  tokenCounters: { food_court: 25, entry_main: 9 },
  nowServing: { food_court: 18, entry_main: 7 },
};

async function latency() {
  await sleep(MOCK_LATENCY_MS + Math.random() * 200);
}

export const mockApi = {
  async register({ name, email }) {
    await latency();
    const user_id = `u_${Math.random().toString(16).slice(2, 8)}`;
    const qr_code = `EF-${user_id}`;
    const qr_url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr_code)}`;
    return { user_id, qr_code, qr_url };
  },

  async checkin({ qr_code }) {
    await latency();
    if (!qr_code || !qr_code.startsWith("EF-")) return { valid: false, reason: "unknown_qr", time: iso() };
    state.checkins += 1;
    return { valid: true, name: "Asha (mock)", time: iso() };
  },

  async joinQueue({ user_id, queue_id }) {
    await latency();
    const q = state.queues.find((x) => x.queue_id === queue_id);
    if (!q) throw new Error(`Unknown queue ${queue_id}`);
    if (state.userTokens[user_id]?.queue_id === queue_id) {
      const t = state.userTokens[user_id];
      const position = t.token - state.nowServing[queue_id];
      return { token: t.token, position, wait_time: position * q.mins_per_token, queue_id, already_queued: true };
    }
    const token = ++state.tokenCounters[queue_id];
    state.userTokens[user_id] = { queue_id, token };
    q.tokens += 1;
    const position = token - state.nowServing[queue_id];
    return { token, position, wait_time: position * q.mins_per_token, queue_id };
  },

  async queueStatus({ queue_id, user_id }) {
    await latency();
    const q = state.queues.find((x) => x.queue_id === queue_id);
    if (!q) throw new Error(`Unknown queue ${queue_id}`);
    if (Math.random() < 0.4 && state.nowServing[queue_id] < state.tokenCounters[queue_id]) {
      state.nowServing[queue_id] += 1;
      q.now_serving = state.nowServing[queue_id];
      q.tokens = Math.max(0, q.tokens - 1);
    }
    const waiting = q.tokens;
    const out = {
      queue_id,
      now_serving: state.nowServing[queue_id],
      waiting,
      avg_wait: waiting * q.mins_per_token,
      me: null,
    };
    const mine = user_id ? state.userTokens[user_id] : null;
    if (mine?.queue_id === queue_id) {
      const position = Math.max(0, mine.token - state.nowServing[queue_id]);
      out.me = { token: mine.token, position, wait_time: position * q.mins_per_token };
    }
    return out;
  },

  async callNext({ queue_id }) {
    await latency();
    if (state.nowServing[queue_id] < state.tokenCounters[queue_id]) {
      state.nowServing[queue_id] += 1;
      const q = state.queues.find((x) => x.queue_id === queue_id);
      q.now_serving = state.nowServing[queue_id];
      q.tokens = Math.max(0, q.tokens - 1);
      return { called_token: state.nowServing[queue_id], remaining: q.tokens, notified: true };
    }
    return { called_token: null, remaining: 0, notified: false };
  },

  async listBooths() {
    await latency();
    for (const b of state.booths) {
      b.occupancy = Math.max(0, Math.min(b.capacity, b.occupancy + (Math.random() < 0.5 ? 0 : Math.random() < 0.6 ? 1 : -1)));
      b.visitors_today += b.occupancy % 2;
    }
    return state.booths.map((b) => ({
      ...b,
      wait_time: Math.min(60, Math.round((b.occupancy / b.capacity) * 30)),
      status: b.occupancy / b.capacity >= 0.85 ? "crowded" : b.occupancy / b.capacity >= 0.6 ? "moderate" : "ok",
    }));
  },

  async updateBooth({ booth_id, delta }) {
    await latency();
    const b = state.booths.find((x) => x.booth_id === booth_id);
    if (!b) throw new Error(`Unknown booth ${booth_id}`);
    b.occupancy = Math.max(0, b.occupancy + delta);
    if (delta > 0) b.visitors_today += 1;
    return {
      booth_id,
      occupancy: b.occupancy,
      capacity: b.capacity,
      wait_time: Math.min(60, Math.round((b.occupancy / b.capacity) * 30)),
      status: b.occupancy / b.capacity >= 0.85 ? "crowded" : b.occupancy / b.capacity >= 0.6 ? "moderate" : "ok",
    };
  },

  async organizerSummary() {
    await latency();
    return {
      total_inside: state.checkins + jitter(6, 0.2),
      checked_in: state.checkins,
      halls: state.halls.map((h) => ({ ...h, occupancy: jitter(h.occupancy, 0.05) })),
      queues: state.queues.map((q) => ({ queue_id: q.queue_id, name: q.name, now_serving: state.nowServing[q.queue_id], waiting: q.tokens })),
      booths: {
        crowded: state.booths.filter((b) => b.occupancy / b.capacity >= 0.85).length,
        total: state.booths.length,
      },
    };
  },

  async sponsorStats({ sponsor_id }) {
    await latency();
    const s = state.sponsorStats[sponsor_id];
    if (!s) throw new Error(`Unknown sponsor ${sponsor_id}`);
    const out = { sponsor_id, ...s };
    out.visitors_today += Math.floor(Math.random() * 3);
    out.avg_wait = jitter(out.avg_wait, 0.2);
    return out;
  },

  async redeemSwag({ user_id, item_id, booth_id }) {
    await latency();
    const key = `${user_id}:${item_id}`;
    if (state.redeemed.has(key)) return { redeemed: false, reason: "already_redeemed" };
    const list = state.inventory[booth_id] || [];
    const item = list.find((i) => i.item_id === item_id);
    if (!item || item.remaining <= 0) return { redeemed: false, reason: "out_of_stock" };
    item.remaining -= 1;
    state.redeemed.add(key);
    const s = state.sponsorStats[booth_id];
    if (s) {
      s.swag_distributed += 1;
      s.swag_remaining -= 1;
    }
    return { redeemed: true, item_id, remaining: item.remaining };
  },

  async listVolunteers() {
    await latency();
    return JSON.parse(JSON.stringify(seed.volunteers));
  },

  async qrPass({ user_id }) {
    await latency();
    const qr_code = `EF-${user_id}`;
    return {
      user_id,
      qr_code,
      qr_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr_code)}`,
    };
  },
};
