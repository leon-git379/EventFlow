# EventFlow — Smart Event Crowd & Queue Management Platform

> "Making large-scale events faster, safer, and smarter with AWS."

EventFlow is a cloud-native event operations platform that eliminates long
queues, overcrowded sponsor booths, and blind emergency response — using
QR-based check-in, virtual queues, live occupancy tracking, and real-time
dashboards. **100% serverless on AWS. No EC2. No containers.**

## 🔴 Live demo

| | |
|---|---|
| **Website (HTTPS)** | **https://main.d14v0ik5y2999t.amplifyapp.com** |
| **Demo login** | `demo@eventflow.io` / `Demo123!` |
| **API** | `https://nkryobkrbb.execute-api.ap-south-1.amazonaws.com` |

Works on laptop and phone. Use the **👤 / 🛠 / 🏢** buttons in the top bar to
switch between Attendee, Organizer, and Sponsor views with one login.

---

## The problem

| At large events… | Impact |
|---|---|
| Registration lines | 20–60 min before entering |
| Sponsor booths | One booth overflows while others sit empty |
| Food queues | Everyone arrives at once — chaos |
| Emergencies | Organizers don't know how many people are inside, or where |

## What EventFlow does

- 🎟️ **QR check-in** — attendee registers, gets a QR pass (stored in S3), organizer scans → duplicate-proof entry, live headcount
- 🎫 **Virtual queues** — join the food court from your seat, watch your token position, get notified when it's your turn
- 📊 **Booth crowd balancer** — live occupancy + wait times per booth, so attendees go where it's quiet and sponsors get even footfall
- 🚨 **Emergency headcount** — one giant number: total people inside, broken down per hall
- 🎁 **Swag redemption** — QR scan + atomic DynamoDB counters = zero double-redemption, live inventory
- 🔔 **SNS notifications** — "Token #25, your food is ready" the moment the organizer calls it

## Architecture

```
                      ┌──────────────────────┐
   Attendee /         │  Amplify Hosting     │  React + Tailwind (Vite)
   Organizer /  ─────►│  (HTTPS)             │──────────────┐
   Sponsor browser    └──────────────────────┘              │
                                                        ┌──────▼───────┐
                                                        │ API Gateway  │ Cognito JWT authorizer
                                                        │ (HTTP API v2)│
                                                        └──────┬───────┘
                                     ┌────────────────────────┼───────────────────┐
                                     │                 12 × Lambda (Node 20,      │
                                     │                 ARM64, AWS SDK v3)         │
                          ┌──────────▼─────────┐   ┌──────────▼──────┐   ┌─────▼─────┐
                          │ DynamoDB (5 tables │   │ S3 (QR images)  │   │   SNS     │
                          │ + GSIs, on-demand) │   │                 │   │ alerts    │
                          └────────────────────┘   └─────────────────┘   └───────────┘
                                     ▲
                          ┌──────────┴─────────┐
                          │ Amazon Cognito     │  user pool + app client
                          └────────────────────┘
```

| Service | Role |
|---|---|
| **Amplify Hosting** | Frontend hosting with HTTPS |
| **API Gateway (HTTP API v2)** | 12 routes, built-in CORS, JWT authorizer |
| **Lambda ×12** | All business logic (Node.js 20, SDK v3, ARM64) |
| **DynamoDB ×5 tables** | Users, Queues, Booths, Inventory, Volunteers — atomic counters for race safety |
| **Cognito** | Auth; API Gateway validates JWTs *before* Lambda runs |
| **S3** | QR pass images (public read, Lambda-only write) |
| **SNS** | Queue-call + emergency notifications |

## API — 12 endpoints

Full request/response shapes: [`backend/docs/API_CONTRACT.md`](backend/docs/API_CONTRACT.md)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/register` | — | Create user, generate QR → uploads PNG to S3 |
| POST | `/checkin` | JWT | Validate QR at the door (duplicate-proof) |
| POST | `/queue/join` | JWT | Join a queue → atomic token + position + wait |
| POST | `/queue/next` | JWT | Organizer calls next token → SNS fires |
| GET | `/queue/status` | JWT | Live position / wait time |
| GET | `/booths` | JWT | All booths with occupancy + wait |
| POST | `/booths/update` | JWT | ±1 occupancy (clamped) |
| GET | `/organizer/summary` | JWT | Total inside, per-hall, queue lengths |
| GET | `/sponsor/stats` | JWT | Visitors, avg wait, swag distributed |
| POST | `/swag/redeem` | JWT | Redeem swag (per-user dedupe + stock guard) |
| GET | `/volunteers` | JWT | Volunteer roster + assignments |
| GET | `/qr/{proxy+}` | — | Serve QR pass images from S3 |

## Repo layout — two self-contained groups

```
EventFlow/
├── backend/          ← GROUP A (AWS engineers)
│   ├── functions/        12 Lambda handlers (Node.js 20, SDK v3, ESM)
│   ├── infra/            deploy.sh · deploy-web.sh · deploy-amplify.sh · seed.js · IAM policies
│   └── docs/             API contract · DynamoDB schemas · IAM · debugging · demo risks · deploy guide
├── frontend/         ← GROUP B (React engineers)
│   ├── src/api/          THE seam: mock ⇄ live is one line in config.js
│   ├── src/pages/        Login · Attendee · Organizer · Sponsor
│   └── src/mock/         mock data matching real API shapes
└── docs/PRODUCT.md   ← the 2-minute judge pitch script
```

## Run it yourself

**Frontend locally (no AWS account needed):**

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 — mock mode, all 3 views work
```

**Full backend deploy (one shot, ~5 min):**

```bash
cd backend/infra
aws configure                       # admin keys, region ap-south-1
bash deploy.sh                      # DDB + Cognito + S3 + SNS + Lambdas + API + routes
node seed.js                        # demo data
```

The script prints the API URL, Cognito Pool ID, Client ID, and demo-login
commands. Paste those into `frontend/.env` (template: `.env.example`), flip
`USE_MOCK_API = false` in `frontend/src/api/config.js`, then:

```bash
bash deploy-amplify.sh              # → public HTTPS URL
```

Step-by-step walkthrough of every command: [`backend/docs/DEPLOY_GUIDE.md`](backend/docs/DEPLOY_GUIDE.md).

## Why the data can't race (judges ask this)

| Hazard | Fix |
|---|---|
| Two people get the same queue token | Atomic DynamoDB `ADD counter 1` — tokens are strictly sequential |
| Same token served twice | `ConditionExpression` on serving state — second call fails cleanly |
| Swag redeemed twice by one user | Per-user redemption record with `attribute_not_exists` guard |
| Occupancy goes negative / over capacity | Server-side clamping on every ±1 update |

Full list of demo-condition risks and trade-offs: [`backend/docs/DEMO_RISKS.md`](backend/docs/DEMO_RISKS.md).

## Docs index

| Doc | Contents |
|---|---|
| [`backend/docs/API_CONTRACT.md`](backend/docs/API_CONTRACT.md) | Every endpoint's request/response |
| [`backend/docs/DYNAMO_SCHEMAS.md`](backend/docs/DYNAMO_SCHEMAS.md) | Tables, keys, GSIs |
| [`backend/docs/IAM_AND_POLICIES.md`](backend/docs/IAM_AND_POLICIES.md) | Least-privilege policy (zero `"*"` wildcards) |
| [`backend/docs/DEBUGGING_LOGS.md`](backend/docs/DEBUGGING_LOGS.md) | CloudWatch triage + common failure table |
| [`backend/docs/DEMO_RISKS.md`](backend/docs/DEMO_RISKS.md) | Race conditions & demo-day gotchas |
| [`backend/docs/DEPLOY_GUIDE.md`](backend/docs/DEPLOY_GUIDE.md) | Line-by-line deploy walkthrough |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | Feature story + judge demo script |

## Honest trade-offs (MVP scope)

- `/register` and QR image routes are public — intentional for a demo
- S3 QR bucket is public-read (QR codes contain no secrets)
- No rate limiting / WAF — hackathon scope, documented in `DEMO_RISKS.md`

---

Built for an AWS hackathon · Region `ap-south-1` · 7 AWS services, zero servers
