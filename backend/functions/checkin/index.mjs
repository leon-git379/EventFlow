// POST /checkin  (organizer only — JWT group check)
// body: { qr_code }   e.g. "EF-u_7f3a2c.1727300000000.kW3h…"
// resp: { valid, name?, time, reason? }
// Validation order: HMAC signature (timing-safe) → TTL (configurable via SSM
// /eventflow/qr_ttl_hours, default 12h) → duplicate-entry condition.
// Unsigned legacy codes (plain "EF-<id>") are rejected as invalid_signature.
import {
  cfg,
  ddb,
  json,
  parseBody,
  GetCommand,
  UpdateCommand,
  requireAuth,
  requireGroup,
  verifyQrCode,
  fail,
  wrap,
  now,
} from "./common.mjs";

export const handler = wrap(async (event) => {
  const auth = await requireAuth(event);
  requireGroup(auth, "organizer"); // 403 for non-organizers
  const { qr_code } = parseBody(event);
  if (!qr_code) throw fail(400, "qr_code is required");

  const conf = await cfg();
  if (!conf.qrSecret) throw fail(500, "Server config missing qr_secret (SSM)");

  // 1) signature + freshness
  const v = verifyQrCode(qr_code, conf.qrSecret, conf.qrTtlHours || 12);
  if (!v.ok) {
    return json(200, { valid: false, reason: v.reason, time: now() });
  }

  // 2) user exists?
  const uid = `EF-${v.user_id}`;
  const user = await ddb.send(new GetCommand({ TableName: conf.users, Key: { uid } }));
  if (!user.Item) return json(200, { valid: false, reason: "unknown_qr", time: now() });

  // 3) duplicate entry — atomic condition, second scan fails cleanly
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: conf.users,
        Key: { uid },
        UpdateExpression: "SET checked_in = :t, checked_in_at = :ts",
        ConditionExpression: "attribute_not_exists(checked_in) OR checked_in = :f",
        ExpressionAttributeValues: { ":t": true, ":f": false, ":ts": now() },
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      return json(200, { valid: false, reason: "already_checked_in", name: user.Item.name, time: now() });
    }
    throw e;
  }

  // atomic global headcount (item lives in Users table as a counter row)
  await ddb.send(
    new UpdateCommand({
      TableName: conf.users,
      Key: { uid: "COUNTER#checkins" },
      UpdateExpression: "ADD n :one",
      ExpressionAttributeValues: { ":one": 1 },
    })
  );

  return json(200, { valid: true, name: user.Item.name, time: now() });
});
