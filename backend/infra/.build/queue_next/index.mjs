// POST /queue/next  (auth — organizer action in the UI)
// body: { queue_id }
// resp: { called_token, remaining, notified }
// Race-safety: the "serve" flip uses ConditionExpression served = false, so a
// double-press can never call the same token twice (and can't double-notify).
import {
  cfg,
  ddb,
  json,
  parseBody,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  SNSClient,
  PublishCommand,
  requireAuth,
  fail,
  wrap,
  now,
} from "./common.mjs";

let sns;

export const handler = wrap(async (event) => {
  await requireAuth(event);
  const { queue_id } = parseBody(event);
  if (!queue_id) throw fail(400, "queue_id is required");

  const conf = await cfg();

  // lowest unserved token
  const r = await ddb.send(
    new QueryCommand({
      TableName: conf.queues,
      KeyConditionExpression: "pk = :q AND begins_with(sk, :t)",
      FilterExpression: "served = :f",
      ExpressionAttributeValues: { ":q": `QUEUE#${queue_id}`, ":t": "TOKEN#", ":f": false },
      ScanIndexForward: true,
      Limit: 1,
    })
  );
  const next = (r.Items || [])[0];
  if (!next) return json(200, { called_token: null, remaining: 0, notified: false });

  // atomic serve-flip — second press fails the condition
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: conf.queues,
        Key: { pk: next.pk, sk: next.sk },
        UpdateExpression: "SET served = :t, served_at = :ts",
        ConditionExpression: "served = :f",
        ExpressionAttributeValues: { ":t": true, ":f": false, ":ts": now() },
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      return json(409, { error: "Token already served — press again for the next" });
    }
    throw e;
  }

  // advance now_serving and bump the counter item's served count
  await ddb.send(
    new UpdateCommand({
      TableName: conf.queues,
      Key: { pk: `QUEUE#${queue_id}`, sk: "counter" },
      UpdateExpression: "ADD served_count :one",
      ExpressionAttributeValues: { ":one": 1 },
    })
  );
  await ddb.send(
    new UpdateCommand({
      TableName: conf.queues,
      Key: { pk: `QUEUE#${queue_id}`, sk: "meta" },
      UpdateExpression: "SET now_serving = :tok",
      ExpressionAttributeValues: { ":tok": next.token },
    })
  );

  // SNS notify — best effort, never blocks the demo
  let notified = false;
  try {
    sns = sns || new SNSClient({});
    await sns.send(
      new PublishCommand({
        TopicArn: conf.snsTopic,
        Subject: "EventFlow — your turn!",
        Message: `Token #${next.token} — it's your turn at ${queue_id}. Please proceed now.`,
        MessageAttributes: {
          token: { DataType: "String", StringValue: String(next.token) },
          queue_id: { DataType: "String", StringValue: queue_id },
          user_id: { DataType: "String", StringValue: next.user_id },
        },
      })
    );
    notified = true;
  } catch (e) {
    console.error("SNS publish failed (non-fatal):", e.message);
  }

  const remaining = Math.max(0, (next.position ?? 0) - 1);
  return json(200, { called_token: next.token, remaining, notified });
});
