// EventFlow demo seed — run AFTER deploy.sh:  node seed.js
// Idempotent: PutItem overwrites meta rows; counters initialized with :zero.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "ap-south-1";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const T = {
  users: "eventflow-users",
  queues: "eventflow-queues",
  booths: "eventflow-booths",
  inventory: "eventflow-inventory",
  volunteers: "eventflow-volunteers",
};

const put = (TableName, Item) => ddb.send(new PutCommand({ TableName, Item }));
const add = (TableName, Key, attr) =>
  ddb.send(
    new UpdateCommand({
      TableName,
      Key,
      UpdateExpression: `ADD ${attr} :zero`,
      ExpressionAttributeValues: { ":zero": 0 },
    })
  );

async function main() {
  for (const h of [
    { hall: "A", occupancy: 180, capacity: 250 },
    { hall: "B", occupancy: 95, capacity: 250 },
  ]) {
    await put(T.booths, { pk: `HALL#${h.hall}`, sk: "meta", ...h });
  }
  for (const b of [
    { booth_id: "aws", name: "AWS", occupancy: 42, capacity: 50, hall: "A", visitors_today: 311 },
    { booth_id: "github", name: "GitHub", occupancy: 8, capacity: 40, hall: "A", visitors_today: 122 },
    { booth_id: "mongodb", name: "MongoDB", occupancy: 3, capacity: 40, hall: "B", visitors_today: 87 },
    { booth_id: "zoho", name: "Zoho", occupancy: 12, capacity: 40, hall: "B", visitors_today: 64 },
  ]) {
    await put(T.booths, { pk: `BOOTH#${b.booth_id}`, sk: "meta", ...b });
  }
  for (const qq of [
    { queue_id: "food_court", name: "Food Court", mins_per_token: 2 },
    { queue_id: "entry_main", name: "Main Entry", mins_per_token: 1 },
  ]) {
    await put(T.queues, { pk: `QUEUE#${qq.queue_id}`, sk: "meta", ...qq, now_serving: 0 });
    await add(T.queues, { pk: `QUEUE#${qq.queue_id}`, sk: "counter" }, "n");
    await add(T.queues, { pk: `QUEUE#${qq.queue_id}`, sk: "counter" }, "served_count");
  }
  for (const it of [
    { booth_id: "aws", item_id: "aws_tshirt", name: "AWS T-shirt", quantity: 60 },
    { booth_id: "aws", item_id: "aws_stickers", name: "AWS Stickers", quantity: 300 },
    { booth_id: "github", item_id: "github_stickers", name: "GitHub Stickers", quantity: 200 },
    { booth_id: "zoho", item_id: "zoho_coupon", name: "Zoho Coupon", quantity: 150 },
  ]) {
    await put(T.inventory, {
      pk: `SPONSOR#${it.booth_id}`,
      sk: `ITEM#${it.item_id}`,
      ...it,
      distributed: 0,
    });
  }
  for (const v of [
    { volunteer_id: "v1", name: "Ravi", task: "Registration desk", zone: "entry", status: "active", phone: "+911234567890" },
    { volunteer_id: "v2", name: "Meera", task: "Food counter", zone: "food_court", status: "active", phone: "+911234567891" },
    { volunteer_id: "v3", name: "Arjun", task: "AWS booth marshal", zone: "hall-A", status: "active", phone: "+911234567892" },
  ]) {
    await put(T.volunteers, { pk: `VOL#${v.volunteer_id}`, sk: "profile", ...v });
  }
  await add(T.users, { uid: "COUNTER#checkins" }, "n");
  await ddb.send(
    new UpdateCommand({
      TableName: T.users,
      Key: { uid: "COUNTER#checkins" },
      UpdateExpression: "SET #t = :t", // "type" is a DDB reserved keyword
      ExpressionAttributeNames: { "#t": "type" },
      ExpressionAttributeValues: { ":t": "counter" },
    })
  );
  console.log("Seed complete.");
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
