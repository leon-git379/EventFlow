// POST /checkin  (auth)
// body: { qr_code }   e.g. "EF-u_7f3a2c"
// resp: { valid, name?, time, reason? }
import {
  cfg,
  ddb,
  json,
  parseBody,
  GetCommand,
  UpdateCommand,
  requireAuth,
  fail,
  wrap,
  now,
} from "./common.mjs";

export const handler = wrap(async (event) => {
  await requireAuth(event);
  const { qr_code } = parseBody(event);
  if (!qr_code) throw fail(400, "qr_code is required");

  const conf = await cfg();
  const user = await ddb.send(new GetCommand({ TableName: conf.users, Key: { uid: qr_code } }));
  if (!user.Item) return json(200, { valid: false, reason: "unknown_qr", time: now() });

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: conf.users,
        Key: { uid: qr_code },
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
