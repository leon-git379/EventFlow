// Mock dataset — mirrors backend/infra/seed.js so UI matches the live demo.
export const booths = [
  { booth_id: "aws", name: "AWS", occupancy: 42, capacity: 50, hall: "A", visitors_today: 311 },
  { booth_id: "github", name: "GitHub", occupancy: 8, capacity: 40, hall: "A", visitors_today: 122 },
  { booth_id: "mongodb", name: "MongoDB", occupancy: 3, capacity: 40, hall: "B", visitors_today: 87 },
  { booth_id: "zoho", name: "Zoho", occupancy: 12, capacity: 40, hall: "B", visitors_today: 64 },
];

export const halls = [
  { hall: "A", occupancy: 180, capacity: 250 },
  { hall: "B", occupancy: 95, capacity: 250 },
];

export const queues = [
  { queue_id: "food_court", name: "Food Court", now_serving: 18, tokens: 6, mins_per_token: 2 },
  { queue_id: "entry_main", name: "Main Entry", now_serving: 7, tokens: 2, mins_per_token: 1 },
];

export const inventory = {
  aws: [
    { item_id: "aws_tshirt", name: "AWS T-shirt", remaining: 60, distributed: 0 },
    { item_id: "aws_stickers", name: "AWS Stickers", remaining: 300, distributed: 0 },
  ],
  github: [{ item_id: "github_stickers", name: "GitHub Stickers", remaining: 200, distributed: 0 }],
  zoho: [{ item_id: "zoho_coupon", name: "Zoho Coupon", remaining: 150, distributed: 0 }],
};

export const volunteers = [
  { volunteer_id: "v1", name: "Ravi", task: "Registration desk", zone: "entry", status: "active" },
  { volunteer_id: "v2", name: "Meera", task: "Food counter", zone: "food_court", status: "active" },
  { volunteer_id: "v3", name: "Arjun", task: "AWS booth marshal", zone: "hall-A", status: "active" },
];

export const sponsorStats = {
  aws: { visitors_today: 311, avg_wait: 25, swag_distributed: 4, swag_remaining: 360, swag_stock: 364 },
  github: { visitors_today: 122, avg_wait: 6, swag_distributed: 2, swag_remaining: 200, swag_stock: 202 },
  mongodb: { visitors_today: 87, avg_wait: 2, swag_distributed: 0, swag_remaining: 0, swag_stock: 0 },
  zoho: { visitors_today: 64, avg_wait: 9, swag_distributed: 1, swag_remaining: 150, swag_stock: 151 },
};

export const checkinCounter = { n: 275 };
