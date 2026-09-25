// Classifies failures from fetch so every screen can show a friendly message.
export class ApiError extends Error {
  constructor(message, kind, status = 0) {
    super(message);
    this.kind = kind; // 'auth' | 'cors' | 'network' | 'timeout' | 'server' | 'client'
    this.status = status;
  }
}

export function toApiError(err) {
  if (err instanceof ApiError) return err;
  if (err?.name === "AbortError") {
    return new ApiError("Request timed out — try again", "timeout");
  }
  // fetch() throws TypeError on network failure / CORS blocks
  if (err instanceof TypeError) {
    return new ApiError(
      "Network or CORS error — is the API URL right and CORS deployed?",
      "cors"
    );
  }
  return new ApiError(err?.message || "Unexpected error", "server");
}

export const friendly = {
  auth: "Session expired — please log in again.",
  conflict: "Already handled — the first request won. Refreshing…",
  cors: "Can't reach the API (CORS/network). Check the deployed URL and that deploy.sh ran with CORS enabled.",
  network: "Network error — check your connection.",
  timeout: "The server took too long — try again.",
  server: "Backend error — check CloudWatch logs for this endpoint.",
  client: "Bad request — check the input.",
};

export const messageFor = (err) =>
  err instanceof ApiError ? err.message || friendly[err.kind] : friendly.server;

// Cognito errors deserve their real message, not "check CloudWatch".
const AUTH_MSGS = [
  ["NotAuthorizedException", "Wrong email or password."],
  ["UserNotConfirmedException", "Account not confirmed — enter the code we emailed you below."],
  ["UserNotFoundException", "No account with that email — create one first."],
  ["UsernameExistsException", "That email is already registered — sign in instead."],
  ["CodeMismatchException", "That code is wrong — check the latest email."],
  ["ExpiredCodeException", "That code expired — resend a new one below."],
  ["InvalidPasswordException", "Password must be 8+ characters."],
  ["LimitExceededException", "Too many tries — wait a minute and retry."],
];

export function authMessage(err) {
  const hay = `${err?.code || ""} ${err?.message || ""}`;
  for (const [sig, msg] of AUTH_MSGS) if (hay.includes(sig)) return msg;
  return err?.message || friendly.server;
}
