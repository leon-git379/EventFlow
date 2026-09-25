// GET /volunteers — list volunteers for the organizer dashboard
// resp: [ { volunteer_id, name, task, status, zone } ]
import { cfg, ddb, json, ScanCommand, requireAuth, wrap } from "./common.mjs";

export const handler = wrap(async (event) => {
  await requireAuth(event);
  const conf = await cfg();

  const r = await ddb.send(
    new ScanCommand({
      TableName: conf.volunteers,
      FilterExpression: "begins_with(pk, :v)",
      ExpressionAttributeValues: { ":v": "VOL#" },
    })
  );

  return json(200, (r.Items || []).map((v) => ({
    volunteer_id: v.volunteer_id || (v.pk || "").replace("VOL#", ""),
    name: v.name,
    task: v.task || "unassigned",
    status: v.status || "active",
    zone: v.zone || "",
  })));
});
