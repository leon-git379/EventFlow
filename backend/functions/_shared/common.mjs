// EventFlow shared helpers — copied into every function zip by deploy.sh
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";
import { createPublicKey, verify as cryptoVerify, randomUUID } from "node:crypto";

export { GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand, randomUUID };

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
  ];
  const out = await ssm.send(new GetParametersCommand({ Names: names, WithDecryption: false }));
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

// wrap(handler): uniform error mapping for every route
export const wrap = (fn) => async (event) => {
  try {
    return await fn(event);
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      return json(409, { error: "Conflict — state changed, retry" });
    }
    if (err?.status) return json(err.status, { error: err.message });
    console.error("UNHANDLED", err);
    return json(500, { error: "Internal error" });
  }
};

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
