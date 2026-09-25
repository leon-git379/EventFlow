# EventFlow — API Contract

**Single source of truth between Group A (backend) and Group B (frontend).**
Region: `ap-south-1` · API Gateway **HTTP API v2** · Auth: Cognito JWT
(`Authorization: Bearer <id_token>`)

Every handler lives in `backend/functions/<name>/index.mjs`. Stage is `$default`.
Base URL looks like: `https://<api-id>.execute-api.ap-south-1.amazonaws.com`

> All routes below are grouped under one HTTP API. `$default` routes mean the
> path is passed through; the Lambda routes internally where noted.

## Conventions

- Success → `200` with a JSON body. No `200` wrapper envelopes.
- Client errors → `400` with `{ "error": "<human readable message>" }`.
- Auth errors → `401 { "error": "Unauthorized" }` (missing/expired token).
- Missing/unknown resource → `404 { "error": "Not found" }`.
- All timestamps are ISO-8601 strings in UTC, e.g. `"2026-09-20T10:15:00Z"`.

## Routes

| # | Endpoint | Method | Request body | Response body `200` | Notes |
|---|----------|--------|--------------|---------------------|-------|
| 1 | `/register` | POST | `{ "name": "Asha", "email": "a@x.com", "phone": "+911234567890" }` | `{ "user_id": "u_7f3a", "qr_code": "EF-u_7f3a", "qr_url": "https://…s3…/qr/u_7f3a.png" }` | Public (no auth). Generates QR PNG into S3, returns its URL. |
| 2 | `/checkin` | POST | `{ "qr_code": "EF-u_7f3a" }` | `{ "valid": true, "name": "Asha", "time": "2026-09-20T10:15:00Z" }` | Duplicate scan → `valid:false, reason:"already_checked_in"`. |
| 3 | `/queue/join` | POST | `{ "user_id": "u_7f3a", "queue_id": "food_court" }` | `{ "token": 42, "position": 7, "wait_time": 14, "queue_id": "food_court" }` | Atomic counter; `wait_time` = position × mins_per_token. |
| 4 | `/queue/next` | POST | `{ "queue_id": "food_court" }` | `{ "called_token": 36, "remaining": 6 }` | Organizer action. Publishes SNS notify for that token. |
| 5 | `/queue/status` | GET `?queue_id=food_court` | — | `{ "queue_id": "food_court", "now_serving": 36, "waiting": 6, "avg_wait": 14 }` | Also returns this user's token if `user_id` query param given. |
| 6 | `/booths` | GET | — | `[ { "booth_id": "aws", "name": "AWS", "occupancy": 42, "capacity": 50, "wait_time": 12, "status": "crowded" } ]` | `status` derived: ok <60%, moderate <85%, crowded ≥85% of capacity. |
| 7 | `/booths/update` | POST | `{ "booth_id": "aws", "delta": 1 }` | `{ "booth_id": "aws", "occupancy": 43, "capacity": 50, "wait_time": 12, "status": "crowded" }` | `delta` −1 or +1 (entry/exit scan at booth). |
| 8 | `/organizer/summary` | GET | — | `{ "total_inside": 412, "checked_in": 412, "halls": [ { "hall": "A", "occupancy": 180, "capacity": 250 } ], "queues": [ { "queue_id": "food_court", "waiting": 6, "now_serving": 36 } ], "booths": { "crowded": 2, "total": 5 } }` | Powers the big emergency headcount number. |
| 9 | `/sponsor/stats` | GET `?sponsor_id=aws` | — | `{ "sponsor_id": "aws", "visitors_today": 428, "avg_wait": 6, "swag_distributed": 210, "swag_remaining": 40 }` | Frontend route `/sponsor/:id` maps to this query param. |
| 10 | `/swag/redeem` | POST | `{ "user_id": "u_7f3a", "item_id": "aws_tshirt", "booth_id": "aws" }` | `{ "redeemed": true, "item_id": "aws_tshirt", "remaining": 39 }` | Duplicate → `redeemed:false, reason:"already_redeemed"`. Out of stock → `reason:"out_of_stock"`. |

## Auth matrix (hackathon-simple)

| Route | Auth |
|-------|------|
| `/register` | none |
| everything else | Cognito JWT (any authenticated user) |

Role checks (organizer-only on `/queue/next`, sponsor on `/sponsor/stats`) are
**not** enforced server-side in the MVP — the UI gates them. Flagged in
`DEMO_RISKS.md`.

## CORS

HTTP API v2 CORS is configured once for the whole API in `deploy.sh`
(`--cors AllowOrigin=* AllowHeaders=*"AllowMethods=*"`), so no per-route
OPTIONS lambdas are needed. Preflights are answered by API Gateway itself.
