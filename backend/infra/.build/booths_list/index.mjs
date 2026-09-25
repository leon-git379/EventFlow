// GET /booths
// resp: [ { booth_id, name, occupancy, capacity, wait_time, status } ]
// status/wait_time derived server-side so frontend stays dumb.
import { cfg, ddb, json, ScanCommand, requireAuth, wrap, boothStatus, boothWait } from "./common.mjs";

export const handler = wrap(async (event) => {
  await requireAuth(event);
  const conf = await cfg();

  const r = await ddb.send(
    new ScanCommand({
      TableName: conf.booths,
      FilterExpression: "begins_with(pk, :b)",
      ExpressionAttributeValues: { ":b": "BOOTH#" },
    })
  );

  const booths = (r.Items || [])
    .map((i) => ({
      booth_id: i.booth_id,
      name: i.name,
      occupancy: i.occupancy ?? 0,
      capacity: i.capacity ?? 50,
      hall: i.hall || "main",
      visitors_today: i.visitors_today ?? 0,
      wait_time: boothWait(i.occupancy ?? 0, i.capacity ?? 50),
      status: boothStatus(i.occupancy ?? 0, i.capacity ?? 50),
    }))
    .sort((a, b) => a.wait_time - b.wait_time);

  return json(200, booths);
});
