// POST /booths/update  (auth — booth staff scan in/out)
// body: { booth_id, delta }   delta: +1 entry, -1 exit
// resp: { booth_id, occupancy, capacity, wait_time, status, visitors_today }
import {
  cfg,
  ddb,
  json,
  parseBody,
  UpdateCommand,
  requireAuth,
  fail,
  wrap,
  now,
  boothStatus,
  boothWait,
} from "./common.mjs";

export const handler = wrap(async (event) => {
  await requireAuth(event);
  const { booth_id, delta } = parseBody(event);
  if (!booth_id || ![1, -1].includes(delta)) throw fail(400, "booth_id and delta (+1/-1) are required");

  const conf = await cfg();

  const r = await ddb.send(
    new UpdateCommand({
      TableName: conf.booths,
      Key: { pk: `BOOTH#${booth_id}`, sk: "meta" },
      UpdateExpression:
        "SET occupancy = if_not_exists(occupancy, :zero) + :d, visitors_today = if_not_exists(visitors_today, :zero) + :up, updated_at = :ts",
      // clamp at zero so exit scans can't drive it negative
      ConditionExpression: "if_not_exists(occupancy, :zero) + :d >= :zero",
      ExpressionAttributeValues: {
        ":d": delta,
        ":zero": 0,
        ":up": delta > 0 ? 1 : 0,
        ":ts": now(),
      },
      ReturnValues: "ALL_NEW",
    })
  ).catch((e) => {
    if (e.name === "ConditionalCheckFailedException") {
      return { Attributes: { occupancy: 0, capacity: 50, visitors_today: 0 } };
    }
    throw e;
  });

  const a = r.Attributes;
  const occupancy = a.occupancy ?? 0;
  const capacity = a.capacity ?? 50;
  return json(200, {
    booth_id,
    occupancy,
    capacity,
    visitors_today: a.visitors_today ?? 0,
    wait_time: boothWait(occupancy, capacity),
    status: boothStatus(occupancy, capacity),
  });
});
