// GET /queue/status?queue_id=food_court
// resp: { queue_id, now_serving, waiting, avg_wait, me?: { token, position, wait_time } }
// Identity: `me` is derived from the JWT `sub` — any user_id in the query
// string is ignored, so one attendee can never read another's token position.
import {
  cfg,
  ddb,
  json,
  GetCommand,
  QueryCommand,
  requireAuth,
  subFrom,
  fail,
  wrap,
} from "./common.mjs";

export const handler = wrap(async (event) => {
  const auth = await requireAuth(event);
  const sub = subFrom(event, auth); // identity from the validated token
  const q = event.queryStringParameters || {};
  const queue_id = q.queue_id;
  if (!queue_id) throw fail(400, "queue_id query param is required");

  const conf = await cfg();

  const meta = await ddb.send(new GetCommand({ TableName: conf.queues, Key: { pk: `QUEUE#${queue_id}`, sk: "meta" } }));
  if (!meta.Item) throw fail(404, `Unknown queue ${queue_id}`);

  const counter = await ddb.send(
    new GetCommand({ TableName: conf.queues, Key: { pk: `QUEUE#${queue_id}`, sk: "counter" } })
  );
  const nowServing = meta.Item.now_serving || 0;
  const issued = counter.Item?.n || 0;
  const servedCount = counter.Item?.served_count || 0;
  const waiting = Math.max(0, issued - servedCount);
  const minsPer = meta.Item.mins_per_token || 3;

  const out = {
    queue_id,
    now_serving: nowServing,
    waiting,
    avg_wait: waiting * minsPer,
  };

  {
    const mine = await ddb.send(
      new QueryCommand({
        TableName: conf.queues,
        IndexName: "GS1",
        KeyConditionExpression: "gs1pk = :u AND begins_with(gs1sk, :q)",
        FilterExpression: "served = :f",
        ExpressionAttributeValues: {
          ":u": `USER#${sub}`,
          ":q": `QUEUE#${queue_id}`,
          ":f": false,
        },
      })
    );
    const t = (mine.Items || [])[0];
    if (t) {
      const position = Math.max(1, t.token - nowServing);
      out.me = { token: t.token, position, wait_time: position * minsPer };
    } else {
      out.me = null;
    }
  }

  return json(200, out);
});
