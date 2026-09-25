# EventFlow — Smart Event Crowd & Queue Management Platform

> "Making large-scale events faster, safer, and smarter with AWS."

Cloud-native event operations platform: QR check-in, virtual queues, live booth
occupancy, emergency headcount, and swag redemption — 100% serverless on AWS.

**Region: `ap-south-1` (Mumbai)** · API Gateway **HTTP API v2** · Frontend **React (Vite) + Tailwind** · Backend **Lambda (Node.js 20, AWS SDK v3)**

---

## 🔀 Team split — two self-contained groups

```
EventFlow/
├── backend/          ← GROUP A (AWS + Lambda engineers)
│   ├── functions/        10 Lambda handlers, Node.js, AWS SDK v3
│   ├── infra/            deploy.sh (one-shot AWS CLI) + seed.js + IAM policies
│   └── docs/             API contract, DynamoDB schemas, IAM, debugging, demo risks
│
├── frontend/         ← GROUP B (React engineers)
│   ├── src/api/          THE integration seam (mock ⇄ live is one line)
│   ├── src/pages/        Login, Attendee, Organizer, Sponsor screens
│   ├── src/components/   shared UI pieces
│   └── src/mock/         mock data matching the real API shapes
│
└── docs/PRODUCT.md   ← shared story: features, architecture, demo script
```

**Contract between the groups:** `backend/docs/API_CONTRACT.md`.
Group B builds against mocks with the exact shapes in that file; Group A makes
the live API obey it. Neither group is blocked on the other.

## Run the frontend (no AWS account needed)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 — mock mode, all 3 role views work
```

## Deploy the backend (Group A machine)

```bash
cd backend/infra
aws configure                     # keys for an admin user in ap-south-1
bash deploy.sh                    # creates EVERYTHING and prints the live URLs
node seed.js                      # loads demo queues/booths/sponsor/inventory
```

## Flip the frontend from mock → live (the one-line change)

`frontend/src/api/config.js`:

```js
export const USE_MOCK_API = true;   // ← set to false once deploy.sh prints the API URL
```

Then paste the printed values into `frontend/.env` (template: `.env.example`):
`VITE_API_BASE_URL`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`.

## The 2-minute demo path

1. Attendee registers → QR pass appears (S3-hosted PNG)
2. Organizer check-in page scans/validates → headcount increments
3. Attendee joins Food Court queue → token #N, live wait time
4. Organizer calls next token → **SNS email/SMS fires**
5. Sponsor dashboard ticks up: visitors, avg wait, swag distributed
6. Emergency headcount panel shows total inside, per hall

Full judge script: `docs/PRODUCT.md`.
