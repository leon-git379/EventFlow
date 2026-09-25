// GET /organizer/summary  (organizer only — JWT group check)
// resp: { total_inside, checked_in, halls: [...], queues: [...], booths: {...} }
// Powers the emergency headcount number on the organizer dashboard.
import {
  cfg,
  ddb,
  json,
  GetCommand,
  ScanCommand,
  requireAuth,
  requireGroup,
  wrap,
  boothStatus,
} from "./common.mjs";

export const handler = wrap(async (event) => {
  const auth = await requireAuth(event);
  requireGroup(auth, "organizer"); // 403 for non-organizers
  const conf = await cfg();

  // global headcount counter (written by /checkin)
  const counter = await ddb.send(
    new GetCommand({ TableName: conf.users, Key: { uid: "COUNTER#checkins" } })
  );
  const checkedIn = counter.Item?.n || 0;

  // halls (stored in Booths table as HALL# rows)
  const halls = await ddb.send(
    new ScanCommand({
      TableName: conf.booths,
      FilterExpression: "begins_with(pk, :h)",
      ExpressionAttributeValues: { ":h": "HALL#" },
    })
  );

  // queues: meta rows only
  const queues = await ddb.send(
    new ScanCommand({
      TableName: conf.queues,
      FilterExpression: "sk = :meta",
      ExpressionAttributeValues: { ":meta": "meta" },
    })
  );

  // booths snapshot for the crowded/total badge
  const booths = await ddb.send(
    new ScanCommand({
      TableName: conf.booths,
      FilterExpression: "begins_with(pk, :b)",
      ExpressionAttributeValues: { ":b": "BOOTH#" },
    })
  );
  const boothItems = booths.Items || [];
  const crowded = boothItems.filter(
    (b) => boothStatus(b.occupancy ?? 0, b.capacity ?? 50) === "crowded"
  ).length;

  return json(200, {
    total_inside: checkedIn,
    checked_in: checkedIn,
    halls: (halls.Items || []).map((h) => ({
      hall: h.hall || (h.pk || "").replace("HALL#", ""),
      occupancy: h.occupancy ?? 0,
      capacity: h.capacity ?? 250,
    })),
    queues: (queues.Items || []).map((qq) => ({
      queue_id: qq.queue_id || (qq.pk || "").replace("QUEUE#", ""),
      name: qq.name,
      now_serving: qq.now_serving || 0,
      waiting: qq.waiting || 0,
    })),
    booths: { crowded, total: boothItems.length },
  });
});
