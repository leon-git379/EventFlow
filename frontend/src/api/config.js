// ============================================================
// EventFlow — API configuration
// THE one-line mock→live switch lives here: set USE_MOCK_API=false
// and fill .env (see .env.example) after `bash deploy.sh` prints
// your values.
// ============================================================

export const USE_MOCK_API = false; // ← LIVE AWS backend (flip true for offline demo)

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "";

export const COGNITO = {
  USER_POOL_ID: import.meta.env.VITE_COGNITO_USER_POOL_ID || "",
  CLIENT_ID: import.meta.env.VITE_COGNITO_CLIENT_ID || "",
  REGION: import.meta.env.VITE_COGNITO_USER_POOL_ID
    ? import.meta.env.VITE_COGNITO_USER_POOL_ID.split("_")[0]
    : "ap-south-1",
};

export const MOCK_LATENCY_MS = 350;

export const STORAGE_KEYS = {
  SESSION: "eventflow_session",
  USER_ID: "eventflow_user_id",
  NAME: "eventflow_name",
  QR_URL: "eventflow_qr_url",
  QR_CODE: "eventflow_qr_code",
};
