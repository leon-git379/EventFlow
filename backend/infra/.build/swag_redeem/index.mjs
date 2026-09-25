// POST /swag/redeem  (auth)
// body: { user_id, item_id, booth_id }
// resp: { redeemed, item_id?, remaining?, reason? }
// Duplicate prevention: per-user redemption row written with attribute_not_exists,
// stock decrement conditional on quantity > 0. Both atomic — no double swag.
import {
  cfg,
  ddb,
  json,
  parseBody,
  PutCommand,
  UpdateCommand,
  requireAuth,
  fail,
  wrap,
  now,
} from "./common.mjs";

export const handler = wrap(async (event) => {
  await requireAuth(event);
  const { user_id, item_id, booth_id } = parseBody(event);
  if (!user_id || !item_id || !booth_id) throw fail(400, "user_id, item_id, booth_id are required");

  const conf = await cfg();

  // 1) per-user duplicate guard — atomic
  try {
    await ddb.send(
      new PutCommand({
        TableName: conf.inventory,
        Item: {
          pk: `USER#${user_id}`,
          sk: `ITEM#${item_id}`,
          user_id,
          item_id,
          booth_id,
          redeemed_at: now(),
        },
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      return json(200, { redeemed: false, reason: "already_redeemed" });
    }
    throw e;
  }

  // 2) atomic stock decrement, only if stock remains
  try {
    const r = await ddb.send(
      new UpdateCommand({
        TableName: conf.inventory,
        Key: { pk: `SPONSOR#${booth_id}`, sk: `ITEM#${item_id}` },
        UpdateExpression: "SET distributed = if_not_exists(distributed, :zero) + :one ADD quantity :neg",
        ConditionExpression: "quantity >= :one",
        ExpressionAttributeValues: { ":one": 1, ":neg": -1, ":zero": 0 },
        ReturnValues: "ALL_NEW",
      })
    );
    return json(200, {
      redeemed: true,
      item_id,
      remaining: r.Attributes.quantity,
      redeemed_at: now(),
    });
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      return json(200, { redeemed: false, reason: "out_of_stock" });
    }
    throw e;
  }
});
