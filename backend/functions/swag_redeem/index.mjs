// POST /swag/redeem  (sponsor or organizer — JWT group check)
// body: { user_id?, item_id, booth_id } — user_id is ignored in live mode:
//       the redeeming identity comes from the JWT `sub` (whose swag it is).
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
  requireGroup,
  subFrom,
  fail,
  wrap,
  now,
} from "./common.mjs";

export const handler = wrap(async (event) => {
  const auth = await requireAuth(event);
  requireGroup(auth, "sponsor", "organizer", "attendee");
  const { item_id, booth_id } = parseBody(event);
  if (!item_id || !booth_id) throw fail(400, "item_id, booth_id are required");
  const user_id = subFrom(event, auth); // identity from JWT, not the body

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
