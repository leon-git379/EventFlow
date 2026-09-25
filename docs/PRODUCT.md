# EventFlow — Product Story (shared by both groups)

> "Making large-scale events faster, safer, and smarter with AWS."

## The pitch (30 seconds)
EventFlow is a cloud-native event operations platform that eliminates long
queues, overcrowded sponsor booths, and blind-spot crowd management using
QR-based virtual queues, live occupancy tracking, and real-time dashboards —
100% AWS serverless: Cognito, API Gateway, Lambda, DynamoDB, S3, SNS,
CloudWatch. No servers, no EC2, scales to thousands of attendees.

## Problems → Features
| Problem | Feature |
|---|---|
| 20–60 min entry queues | QR check-in (duplicate-proof, live headcount) |
| Food-court chaos at lunch | Virtual queue with tokens + SNS "your turn" |
| Some booths overflow, others empty | Live booth wait times; attendees redirect to shorter lines |
| No crowd visibility | Organizer dashboard: halls, queues, booths — polled live |
| Emergency evacuation blind | Big emergency headcount number, per-hall occupancy |
| Swag chaos & double-dipping | QR redemption with DynamoDB duplicate prevention |

## Architecture
Browser (React+Tailwind) → Cognito JWT → API Gateway HTTP v2 (CORS, authorizer)
→ 12 Lambda functions (Node.js 20) → DynamoDB (5 tables) · S3 (QR PNGs) · SNS
(token-called notifications) · SSM (config) → CloudWatch (logs/metrics).

## 2-minute judge demo script
1. **Login** → pick **Attendee** → QR pass renders (S3-backed in live mode).
2. Switch: **Organizer** → dashboard: emergency headcount, hall bars, queues.
3. Paste `EF-…` into check-in scanner → ✅ valid → headcount ticks up.
4. Attendee → Queue → **Join Food Court** → token #N, position + wait time.
5. Organizer → **Call next** → token called → SNS email lands ("it's your turn").
6. Attendee → Booths → AWS 🔴 crowded vs GitHub 🟢 open → pick the short line.
7. Sponsor dashboard → visitors/avg-wait ticking; redeem swag; re-redeem →
   "already redeemed" (duplicate prevention live).

## Why it wins
- **Event infrastructure, not an event app** — works for any conference/expo/fest.
- **7 AWS services in one working flow** — all serverless, zero AI hand-waving.
- **Under demo load**: atomic counters, conditional writes, and idempotent joins
  mean the live audience *cannot* break the queue (see DEMO_RISKS.md).
- **Two-group build**: frontend never waited on backend (mock seam), backend
  never waited on frontend (contract doc).
