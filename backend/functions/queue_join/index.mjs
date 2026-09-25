// POST /queue/join  (auth)
// body: { user_id?, queue_id }  — user_id is ignored in live mode: identity
//       comes from the validated JWT `sub` claim, never the client payload.
// resp: { token, position, wait_time, queue_id }
//
// Race-safety (complete fix): the counter increment (ADD n 1) and the token-row
// write happen in ONE TransactWriteItems call — both succeed or both fail.
// The update is conditioned on the counter value we read immediately before
// (strongly consistent), so under concurrent joins exactly one writer wins per
// token; losers retry with a fresh read. A token can never be issued without
// its membership row, and vice versa.
import {
  cfg,
  ddb,
  json,
  parseBody,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  requireAuth,
  fail,
  wrap,
  now,
} from "./common.mjs";

const pad = (n) => String(n).padStart(6, "0");
const MAX_ATTEMPTS = 5;

export const handler = wrap(async (event) => {
  const auth = await requireAuth(event); // signature-validated claims
  const sub = auth.sub; // queue identity = Cognito subject, not body input
  const displayName = auth.name || auth.email || "Attendee";

  const { queue_id } = parseBody(event);
  if (!queue_id) throw fail(400, "queue_id is required");

  const conf = await cfg();

  // queue exists?
  const q = await ddb.send(
    new GetCommand({ TableName: conf.queues, Key: { pk: `QUEUE#${queue_id}`, sk: "meta" } })
  );
  if (!q.Item) throw fail(404, `Unknown queue ${queue_id}`);

  // fast path: already holding an unserved token in this queue? (double-tap)
  const existing = await ddb.send(
    new QueryCommand({
      TableName: conf.queues,
      IndexName: "GS1",
      KeyConditionExpression: "gs1pk = :u AND begins_with(gs1sk, :q)",
      ExpressionAttributeValues: { ":u": `USER#${sub}`, ":q": `QUEUE#${queue_id}` },
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

  const minsPer = q.Item.mins_per_token || 3;
  const nowServing = q.Item.now_serving || 0;

  // atomic token issue: read counter → transact(ADD conditioned on that read,
  // membership Put) → on contention, retry with a fresh read.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const c = await ddb.send(
      new GetCommand({
        TableName: conf.queues,
        Key: { pk: `QUEUE#${queue_id}`, sk: "counter" },
        ConsistentRead: true, // never build on a stale counter
      })
    );
    const prev = c.Item?.n ?? 0;
    const token = prev + 1;
    const position = Math.max(1, token - nowServing);
    const wait_time = position * minsPer;

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              // increments ONLY if nobody else moved the counter since our read
              Update: {
                TableName: conf.queues,
                Key: { pk: `QUEUE#${queue_id}`, sk: "counter" },
                UpdateExpression: "ADD #n :one",
                ConditionExpression: "#n = :prev",
                ExpressionAttributeNames: { "#n": "n" },
                ExpressionAttributeValues: { ":one": 1, ":prev": prev },
              },
            },
            {
              // membership row — exists only if the counter bump also succeeded
              Put: {
                TableName: conf.queues,
                Item: {
                  pk: `QUEUE#${queue_id}`,
                  sk: `TOKEN#${pad(token)}`,
                  gs1pk: `USER#${sub}`,
                  gs1sk: `QUEUE#${queue_id}#T${pad(token)}`,
                  queue_id,
                  user_id: sub,
                  user_name: displayName,
                  auth_sub: sub,
                  token,
                  position,
                  wait_time,
                  joined_at: now(),
                  served: false,
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
          ],
        })
      );
      return json(200, { token, position, wait_time, queue_id });
    } catch (e) {
      if (e?.name === "TransactionCanceledException") {
        // counter moved (or row appeared) under us — retry with a fresh read
        continue;
      }
      throw e;
    }
  }

  throw fail(409, "Queue is busy — please try again");
});
