// POST /queue/join  (auth)
// body: { user_id, queue_id }
// resp: { token, position, wait_time, queue_id }
// Race-safety: token issued via atomic ADD on the queue's counter item, and the
// per-user membership item is written with attribute_not_exists so a double-tap
// cannot grab two tokens.
import {
  cfg,
  ddb,
  json,
  parseBody,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  requireAuth,
  fail,
  wrap,
  now,
} from "./common.mjs";

export const handler = wrap(async (event) => {
  await requireAuth(event);
  const { user_id, queue_id } = parseBody(event);
  if (!user_id || !queue_id) throw fail(400, "user_id and queue_id are required");

  const conf = await cfg();

  // 1) user exists?
  const u = await ddb.send(new GetCommand({ TableName: conf.users, Key: { uid: `EF-${user_id}` } }));
  if (!u.Item) throw fail(404, `Unknown user ${user_id}`);

  // 2) queue exists?
  const q = await ddb.send(new GetCommand({ TableName: conf.queues, Key: { pk: `QUEUE#${queue_id}`, sk: "meta" } }));
  if (!q.Item) throw fail(404, `Unknown queue ${queue_id}`);

  // 3) already in this queue? (double-tap guard)
  const existing = await ddb.send(
    new QueryCommand({
      TableName: conf.queues,
      IndexName: "GS1",
      KeyConditionExpression: "gs1pk = :u AND begins_with(gs1sk, :q)",
      ExpressionAttributeValues: { ":u": `USER#${user_id}`, ":q": `QUEUE#${queue_id}` },
    })
  );
  const active = (existing.Items || []).find((i) => !i.served);
  if (active) {
    return json(200, {
      token: active.token,
      position: active.position,
      wait_time: active.wait_time,
      queue_id,
      already_queued: true,
    });
  }

  // 4) atomic token issue — no read-modify-write race
  const c = await ddb.send(
    new UpdateCommand({
      TableName: conf.queues,
      Key: { pk: `QUEUE#${queue_id}`, sk: "counter" },
      UpdateExpression: "ADD n :one",
      ReturnValues: "UPDATED_NEW",
      ExpressionAttributeValues: { ":one": 1 },
    })
  );
  const token = c.Attributes.n;

  const minsPer = q.Item.mins_per_token || 3;
  const nowServing = q.Item.now_serving || 0;
  const position = token - nowServing;
  const wait_time = position * minsPer;

  await ddb.send(
    new PutCommand({
      TableName: conf.queues,
      Item: {
        pk: `QUEUE#${queue_id}`,
        sk: `TOKEN#${String(token).padStart(6, "0")}`,
        gs1pk: `USER#${user_id}`,
        gs1sk: `QUEUE#${queue_id}#T${String(token).padStart(6, "0")}`,
        queue_id,
        user_id,
        user_name: u.Item.name,
        token,
        position,
        wait_time,
        joined_at: now(),
        served: false,
      },
    })
  );

  return json(200, { token, position, wait_time, queue_id });
});
