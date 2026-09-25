// POST /register  (public — no auth)
// body: { name, email, phone }
// resp: { user_id, qr_code, qr_url }
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import QRCode from "qrcode";
import { cfg, ddb, json, parseBody, PutCommand, randomUUID, fail, wrap, now } from "./common.mjs";

const s3 = new S3Client({});

export const handler = wrap(async (event) => {
  const body = parseBody(event);
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  if (!name || !email) throw fail(400, "name and email are required");

  const conf = await cfg();
  const user_id = `u_${randomUUID().slice(0, 6)}`; // e.g. u_7f3a2c
  const uid = `EF-${user_id}`; // primary key + QR payload

  await ddb.send(
    new PutCommand({
      TableName: conf.users,
      Item: {
        uid,
        user_id,
        name,
        email,
        phone: body.phone || "",
        role: "attendee",
        checked_in: false,
        redeemed_items: [],
        created_at: now(),
      },
      ConditionExpression: "attribute_not_exists(uid)",
    })
  );

  const png = await QRCode.toBuffer(uid, { margin: 2, width: 512, errorCorrectionLevel: "M" });
  const key = `qr/${user_id}.png`;
  await s3.send(
    new PutObjectCommand({
      Bucket: conf.s3Bucket,
      Key: key,
      Body: png,
      ContentType: "image/png",
      CacheControl: "public,max-age=86400",
    })
  );

  const qr_url = `https://${conf.s3Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  return json(200, { user_id, qr_code: uid, qr_url });
});
