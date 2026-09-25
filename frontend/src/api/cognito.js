// ============================================================
// EventFlow — Cognito auth, zero dependencies (plain REST calls
// to the user pool's JSON endpoints — the simplest thing that
// works on a hackathon timeline, no Amplify SDK).
// ============================================================
import { COGNITO, STORAGE_KEYS } from "./config.js";

const IDP = `https://cognito-idp.${COGNITO.REGION}.amazonaws.com/`;
const HDR = "X-Amz-Target";
const PREFIX = "AWSCognitoIdentityProviderService.";

async function cognito(op, payload) {
  const res = await fetch(IDP, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", [HDR]: PREFIX + op },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data.message || data.__type || "Cognito error");
    e.kind = "auth";
    e.code = data.__type || ""; // e.g. UserNotConfirmedException
    throw e;
  }
  return data;
}

export async function login(email, password) {
  const d = await cognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: COGNITO.CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  const ar = d.AuthenticationResult;
  const session = {
    idToken: ar.IdToken,
    accessToken: ar.AccessToken,
    refreshToken: ar.RefreshToken,
    email: email,
    expiresAt: Date.now() + ar.ExpiresIn * 1000,
  };
  localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
  return session;
}

export async function signUp(email, password, name) {
  return cognito("SignUp", {
    ClientId: COGNITO.CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "name", Value: name },
    ],
  });
}

export async function confirmSignUp(email, code) {
  return cognito("ConfirmSignUp", {
    ClientId: COGNITO.CLIENT_ID,
    Username: email,
    ConfirmationCode: code,
  });
}

export async function resendConfirmationCode(email) {
  return cognito("ResendConfirmationCode", {
    ClientId: COGNITO.CLIENT_ID,
    Username: email,
  });
}

// Demo-simple refresh: USER_PASSWORD_AUTH re-login using stored credentials.
// (REFRESH_TOKEN_AUTH would be the production path; this needs email+password
//  kept in memory which we do NOT persist.)
export async function refreshSession() {
  return null; // live layer falls back to redirect-to-login on 401
}

export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() > s.expiresAt) return null;
    return s;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem(STORAGE_KEYS.SESSION);
}
