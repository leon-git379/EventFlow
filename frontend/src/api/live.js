// Live API — real calls to API Gateway. Same signatures as mockApi.
import { apiFetch } from "./client.js";

export const liveApi = {
  register: (body) => apiFetch("/register", { method: "POST", body, auth: false }),
  checkin: (body) => apiFetch("/checkin", { method: "POST", body }),
  joinQueue: (body) => apiFetch("/queue/join", { method: "POST", body }),
  queueStatus: ({ queue_id, user_id }) =>
    apiFetch(`/queue/status?queue_id=${encodeURIComponent(queue_id)}&user_id=${encodeURIComponent(user_id || "")}`),
  callNext: (body) => apiFetch("/queue/next", { method: "POST", body }),
  listBooths: () => apiFetch("/booths"),
  updateBooth: (body) => apiFetch("/booths/update", { method: "POST", body }),
  organizerSummary: () => apiFetch("/organizer/summary"),
  sponsorStats: ({ sponsor_id }) =>
    apiFetch(`/sponsor/stats?sponsor_id=${encodeURIComponent(sponsor_id)}`),
  redeemSwag: (body) => apiFetch("/swag/redeem", { method: "POST", body }),
  listVolunteers: () => apiFetch("/volunteers"),
  qrPass: (user_id) => apiFetch(`/qr/${encodeURIComponent(user_id)}`, { auth: false }),
};
