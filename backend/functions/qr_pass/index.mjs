// GET /qr/{user_id} — public route for the attendee pass screen.
// resp: { user_id, qr_code, qr_url }
import { cfg, ddb, json, GetCommand, wrap, fail } from "./common.mjs";

export const handler = wrap(async (event) => {
  const user_id = (event.pathParameters || {}).proxy || "";
  if (!user_id) throw fail(400, "user_id path param required");

  const conf = await cfg();
  const r = await ddb.send(
    new GetCommand({ TableName: conf.users, Key: { uid: `EF-${user_id}` } })
  );
  if (!r.Item) throw fail(404, "User not found");

  const key = `qr/${user_id}.png`;
  const qr_url = `https://${conf.s3Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  return json(200, { user_id, qr_code: r.Item.uid, qr_url });
});
