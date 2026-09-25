// GET /sponsor/stats?sponsor_id=aws
// resp: { sponsor_id, visitors_today, avg_wait, swag_distributed, swag_remaining, swag_stock }
import {
  cfg,
  ddb,
  json,
  GetCommand,
  QueryCommand,
  requireAuth,
  fail,
  wrap,
  boothWait,
} from "./common.mjs";

export const handler = wrap(async (event) => {
  await requireAuth(event);
  const sponsor_id = (event.queryStringParameters || {}).sponsor_id;
  if (!sponsor_id) throw fail(400, "sponsor_id query param is required");

  const conf = await cfg();

  const booth = await ddb.send(
    new GetCommand({ TableName: conf.booths, Key: { pk: `BOOTH#${sponsor_id}`, sk: "meta" } })
  );
  if (!booth.Item) throw fail(404, `Unknown sponsor booth ${sponsor_id}`);

  const b = booth.Item;
  const occupancy = b.occupancy ?? 0;
  const capacity = b.capacity ?? 50;

  // swag lines for this sponsor (Inventory table)
  const inv = await ddb.send(
    new QueryCommand({
      TableName: conf.inventory,
      KeyConditionExpression: "pk = :s",
      ExpressionAttributeValues: { ":s": `SPONSOR#${sponsor_id}` },
    })
  );
  let distributed = 0;
  let remaining = 0;
  for (const it of inv.Items || []) {
    distributed += it.distributed ?? 0;
    remaining += it.quantity ?? 0;
  }

  return json(200, {
    sponsor_id,
    name: b.name,
    visitors_today: b.visitors_today ?? 0,
    avg_wait: boothWait(occupancy, capacity),
    occupancy,
    capacity,
    swag_distributed: distributed,
    swag_remaining: remaining,
    swag_stock: remaining + distributed, // for "X of Y" display
  });
});
