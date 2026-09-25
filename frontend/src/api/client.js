// Thin fetch wrapper — the ONLY place that talks to API Gateway in live mode.
import { API_BASE_URL } from "./config.js";
import { getSession } from "./cognito.js";
import { ApiError, toApiError } from "./errors.js";

const TIMEOUT_MS = 10000;

export async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const session = getSession();
    if (session?.idToken) headers.Authorization = `Bearer ${session.idToken}`;
  }

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      // 409 = expected business conflict (already redeemed / already served /
      // queue busy). It gets its own kind so screens can show it as a calm
      // notice instead of a scary red error.
      const kind =
        res.status === 401 || res.status === 403
          ? "auth"
          : res.status === 409
            ? "conflict"
            : res.status >= 500
              ? "server"
              : "client";
      throw new ApiError(data.error || `HTTP ${res.status}`, kind, res.status);
    }
    return data;
  } catch (err) {
    throw toApiError(err);
  } finally {
    clearTimeout(t);
  }
}
