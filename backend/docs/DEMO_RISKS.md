# EventFlow — Demo-risk flags (what breaks under demo conditions & the fix)

## Race conditions — already fixed in the code

| # | Risk | Why it breaks under load | The implemented fix |
|---|---|---|---|
| 1 | Double-tap "Join queue" issues 2 tokens | Two reads both see "not queued" | GS1 pre-check + atomic `ADD n 1` counter. For absolute serializability wrap counter+token-write in a DDB transaction (production fix; low demo odds — only fires if the container freezes mid-join) |
| 2 | Same token served twice / double SNS | Two organizers press at once | /queue/next flips `served=false→true` with ConditionExpression — second press gets 409 and a clear message |
| 3 | Swag: one user, two staff scans | Two PutItems both pass a plain check | Per-user redemption row with `attribute_not_exists(pk)` — atomic, second call returns `already_redeemed` |
| 4 | Swag oversell (stock 1, two users) | Read-check-write decrement | Decrement only if `quantity >= 1` (atomic condition) — can't go negative |
| 5 | Occupancy drift (exit before entry) | Exit scans at 0 occupancy | `if_not_exists(occupancy,0)+delta >= 0` clamp condition |
| 6 | QR reuse after checkout | QR codes are static | Out of MVP scope (single-show tokens) — see hardening backlog |
| 7 | Wasted SNS SMS spend / double publish | Spam during rehearsal | queue_next wraps publish in try/catch and continues on failure; subscribe a real number only when demoing SNS |
| 8 | Cold starts on stage | First call after minutes idle adds ~1s | Warm up: invoke each ef-* function once before the pitch |
| 9 | Headcount looks wrong (0 or too low) | COUNTER#checkins missing on a fresh table | seed.js creates it; `ADD n 1` also auto-creates the row on first check-in — either path works |

## Known MVP trade-offs (fine for a hackathon, list them when judges ask)

- Scans instead of queries for booths/volunteers/queue-meta listing — tables are tiny, tables are tiny
- Role checks are UI-level only: /queue/group-level server checks not implemented — any signed-in user can hit organizer endpoints
- Static QR codes (no expiry/rotation) — single-show use is fine
- HTTP API v2 with `AllowOrigins=["*"]` + public /register — demo-appropriate; not production hardening
- Single shared Lambda role (scoped to the 5 tables/topic/bucket/SSM) — per-function roles are the production step
- Seed data with no TTL/cleanup — re-run `node seed.js` to reset the demo state
- React polling every 5–10 s (no WebSockets) — matches the "live" demo feel at zero complexity
- /queue/status `user_id` is a query param from the frontend (identity from token sub would be the hardening step)

## Hardening backlog (post-hackathon)
1. Transactions for join (counter + token row) — solves risk #1 completely
2. Cognito groups (organizers/sponsors/attendees) + group checks in the JWT
3. AppSync/WebSocket API for true live updates instead of polling
4. Per-function IAM roles; API GW WAF + throttling
5. QR with signature/expiry (HMAC on uid + timestamp) — kills QR reuse
6. Idempotency keys on register/checkin/redeem for network-retry safety
7. SNS SMS sandbox → production, sender ID registration for India DLT regs
8. Cursor pagination on scans, TTL on served tokens
