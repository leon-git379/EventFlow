// EventFlow shared helpers — copied into every function zip by deploy.sh
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";
import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
  randomUUID,
} from "node:crypto";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

export {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  SNSClient,
  PublishCommand,
  randomUUID,
};

const REGION = process.env.AWS_REGION || "ap-south-1";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
export { ddb, REGION };

// ---- config from SSM (cached per warm container) ---------------------------
let CONFIG = null;
export async function cfg() {
  if (CONFIG) return CONFIG;
  const ssm = new SSMClient({ region: REGION });
  const names = [
    "/eventflow/ddb_users",
    "/eventflow/ddb_queues",
    "/eventflow/ddb_booths",
    "/eventflow/ddb_inventory",
    "/eventflow/ddb_volunteers",
    "/eventflow/sns_topic",
    "/eventflow/s3_bucket",
    "/eventflow/cognito_pool_id",
    "/eventflow/qr_secret",
    "/eventflow/qr_ttl_hours",
  ];
  // WithDecryption: qr_secret is a SecureString; plain String params unaffected
  const out = await ssm.send(new GetParametersCommand({ Names: names, WithDecryption: true }));
  const map = {};
  for (const p of out.Parameters || []) map[p.Name] = p.Value;
  CONFIG = {
    users: map["/eventflow/ddb_users"],
    queues: map["/eventflow/ddb_queues"],
    booths: map["/eventflow/ddb_booths"],
    inventory: map["/eventflow/ddb_inventory"],
    volunteers: map["/eventflow/ddb_volunteers"],
    snsTopic: map["/eventflow/sns_topic"],
    s3Bucket: map["/eventflow/s3_bucket"],
    poolId: map["/eventflow/cognito_pool_id"],
    qrSecret: map["/eventflow/qr_secret"],
    qrTtlHours: Number(map["/eventflow/qr_ttl_hours"] || 12),
  };
  return CONFIG;
}

// ---- HTTP helpers ----------------------------------------------------------
export const json = (status, body) => ({
  statusCode: status,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(body),
});

export const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  return e;
};

export function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    throw fail(400, "Malformed JSON body");
  }
}

// wrap(handler): uniform error mapping for every route.
// TransactionCancellationException is TransactWriteItems' aggregate failure
// shape — a condition inside the transaction failed (e.g. user was already
// in the queue), so it surfaces to the client as a conflict.
export const wrap = (fn) => async (event) => {
  try {
    return await fn(event);
  } catch (err) {
    if (
      err?.name === "ConditionalCheckFailedException" ||
      err?.name === "TransactionCanceledException"
    ) {
      return json(409, { error: "Conflict — state changed, retry" });
    }
    if (err?.status) return json(err.status, { error: err.message });
    console.error("UNHANDLED", err);
    return json(500, { error: "Internal error" });
  }
};

// ---- RBAC: route-level role checks from the validated JWT ------------------
// Cognito groups arrive on the id token as "cognito:groups" (array of group
// names). Organizer-only and sponsor-only routes call requireGroup(event, ...).
// NOTE: the API Gateway JWT authorizer passes ALLOWED claims through, so the
// handler checks here rather than trusting route config alone.
export function requireGroup(source, ...allowed) {
  // Accepts EITHER the raw event (authorizer claims — but note: HTTP API JWT
  // authorizers can omit array claims like cognito:groups) OR the decoded
  // token payload returned by requireAuth — the reliable, signature-verified
  // source. Handlers should prefer:  requireGroup(await requireAuth(event), role)
  const claims =
    source?.requestContext?.authorizer?.jwt?.claims ||
    source?.requestContext?.authorizer?.claims ||
    (source && typeof source === "object" ? source : {});
  // HTTP API JWT authorizers may flatten dotted claim keys — accept both
  // "cognito:groups" and "groups".
  const raw = claims["cognito:groups"] ?? claims.groups;
  const groups = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",").map((g) => g.trim()).filter(Boolean)
      : [];
  if (!allowed.some((g) => groups.includes(g))) {
    if (!raw) {
      // one-line breadcrumb when a token carries no recognizable group claim
      console.log("RBAC: no group claim on token. keys=%j", Object.keys(claims));
    }
    throw fail(403, `Forbidden — requires one of: ${allowed.join(", ")}`);
  }
  return claims;
}

// identity straight from the ALREADY-VALIDATED token — never from query/body
export function subFrom(event, claims) {
  const c = claims || event?.requestContext?.authorizer?.jwt?.claims || {};
  if (c.sub) return c.sub;
  throw fail(401, "Unauthorized — token has no subject");
}

// ---- auth: verify Cognito JWT against the pool's JWKS ----------------------
let JWKS = null;
let JWKS_AT = 0;

async function jwks(poolId) {
  if (JWKS && Date.now() - JWKS_AT < 3600_000) return JWKS;
  const url = `https://cognito-idp.${REGION}.amazonaws.com/${poolId}/.well-known/jwks.json`;
  const res = await fetch(url);
  if (!res.ok) throw fail(500, "Cannot fetch Cognito JWKS");
  JWKS = await res.json();
  JWKS_AT = Date.now();
  return JWKS;
}

const b64url = {
  decode: (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
};

export function decodeJwtPayload(token) {
  try {
    return JSON.parse(b64url.decode(token.split(".")[1]));
  } catch {
    return null;
  }
}

export async function requireAuth(event) {
  const header =
    event.headers?.authorization || event.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw fail(401, "Unauthorized — missing Bearer token");

  const payload = decodeJwtPayload(token);
  if (!payload) throw fail(401, "Unauthorized — malformed token");
  if (payload.exp * 1000 < Date.now()) throw fail(401, "Unauthorized — token expired");

  const conf = await cfg();
  const keys = (await jwks(conf.poolId)).keys || [];
  const jwk = keys.find((k) => k.kid === payload.header?.kid || k.kid === headerKid(token));
  if (!jwk) throw fail(401, "Unauthorized — unknown token key");

  const [h, s, sig] = token.split(".");
  const ok = cryptoVerify(
    "sha256", // Node wants the digest name, not the JOSE name ("RS256")
    Buffer.from(`${h}.${s}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  );
  if (!ok) throw fail(401, "Unauthorized — bad signature");
  return payload; // { sub, email, name?, exp, ... }
}

function headerKid(token) {
  try {
    return JSON.parse(b64url.decode(token.split(".")[0])).kid;
  } catch {
    return undefined;
  }
}

// ---- QR pass signing (HMAC-SHA256, secret from SSM) -----------------------
// Payload format: EF-<user_id>.<issuedAtMs>.<hmac>
// checkin recomputes the HMAC and rejects tampered or stale (> TTL) passes.
const b64u = {
  enc: (buf) => Buffer.from(buf).toString("base64url"),
};

export function signQrCode(user_id, issuedAtMs, secret) {
  const payload = `${user_id}:${issuedAtMs}`;
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `EF-${user_id}.${issuedAtMs}.${b64u.enc(sig)}`;
}

export function verifyQrCode(qrCode, secret, ttlHours) {
  const m = /^EF-(u_[0-9a-f]+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(qrCode || "");
  if (!m) return { ok: false, reason: "malformed_qr" };
  const [, user_id, issuedAtStr, sigB64] = m;
  const issuedAt = Number(issuedAtStr);
  const expected = createHmac("sha256", secret)
    .update(`${user_id}:${issuedAtStr}`)
    .digest();
  const got = Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return { ok: false, reason: "invalid_signature" };
  }
  const ageMs = Date.now() - issuedAt;
  if (ageMs < 0) return { ok: false, reason: "invalid_signature" }; // future timestamp
  const ttlMs = ttlHours * 3600_000;
  if (ageMs > ttlMs) return { ok: false, reason: "qr_expired" };
  return { ok: true, user_id, issuedAt };
}

// ---- shared domain helpers -------------------------------------------------
export const now = () => new Date().toISOString();

export const boothStatus = (occupancy, capacity) => {
  const r = capacity > 0 ? occupancy / capacity : 0;
  if (r >= 0.85) return "crowded";
  if (r >= 0.6) return "moderate";
  return "ok";
};

export const boothWait = (occupancy, capacity) =>
  Math.min(60, Math.round((capacity > 0 ? occupancy / capacity : 0) * 30));
