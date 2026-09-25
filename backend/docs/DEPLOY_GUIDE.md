# EventFlow — deploy.sh Line-by-Line Guide

What every block of `backend/infra/deploy.sh` does, in execution order.
Run it from any directory: `bash backend/infra/deploy.sh`

---

## 0. Before you run it (one-time)

| Need | Command / check |
|---|---|
| AWS account + IAM user with admin (hackathon) | Console → IAM → create user → access keys |
| AWS CLI v2 installed | `aws --version` |
| Node 18+ and npm | `node --version` |
| `zip` and `jq` on PATH | `zip -v`, `jq --version` |
| Credentials configured | `aws configure` → paste keys, region `ap-south-1`, output `json` |
| Right account sanity check | `aws sts get-caller-identity` |

Cost note: everything here is free-tier eligible or pennies for a demo day.

---

## 1. Header & safety (lines 1–10)

```bash
#!/usr/bin/env bash
set -euo pipefail
```
- `set -e` → stop on first failing command (no half-deployed surprises).
- `-u` → error on unset variables (catches typos like `$REGON`).
- `-o pipefail` → a failure inside a pipe fails the whole pipe.

## 2. Region, profile, account (lines 12–21)

```bash
REGION="${AWS_REGION:-ap-south-1}"
PROFILE="${AWS_PROFILE:-}"
PROF=""
[ -n "$PROFILE" ] && PROF="--profile $PROFILE"
```
- Region defaults to Mumbai; override with `AWS_REGION=us-east-1 bash deploy.sh`.
- If you use a named CLI profile (`AWS_PROFILE=hackathon`), every call gets `--profile`.

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
suffix() { aws sts get-caller-identity $PROF --query Account --output text; }
ACCOUNT="$(suffix)"
NAME="eventflow-qr-$ACCOUNT-$REGION"
```
- `SCRIPT_DIR` → where deploy.sh lives (needed to find the IAM policy file).
- `ACCOUNT` → your 12-digit AWS account id, printed by STS.
- `NAME` → globally-unique S3 bucket name built from account+region (bucket names are global, so this avoids collisions).

## 3. Dependency check (lines 23–27)

`need aws; need node; need npm; need jq` — each runs `command -v` and exits with
a clear message if missing. Fails in 1 second instead of 10 minutes.

## 4. Idempotency precheck (lines 29–35)

```bash
if aws dynamodb describe-table --table-name eventflow-queues ... >/dev/null 2>&1; then
  SKIP_INFRA=1
```
- If the queues table already exists we assume the whole infra exists → re-run
  only rebuilds & re-uploads Lambda code. This is what makes the script safe to
  run repeatedly (and during a demo, after a code fix).
- `2>&1 >/dev/null` hides the normal error so the screen stays clean.

## 5. DynamoDB tables (lines 37–60)

For each of the 5 tables (`users uid`, `queues pk`, `booths pk`, `inventory pk`, `volunteers pk`):

```bash
aws dynamodb create-table \
  --attribute-definitions AttributeName=$pk,AttributeType=S AttributeName=gs1pk,AttributeType=S AttributeName=gs1sk,AttributeType=S \
  --key-schema AttributeName=$pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --global-secondary-indexes '[{"IndexName":"GS1",...,"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```
- Composite key `pk`+`sk` on all tables (single-number key only on Users).
- `GS1` GSI (`gs1pk`/`gs1sk`) on every table → reverse lookups ("which queues is
  this user in?"). Declared up-front so Lambdas never hit ValidationException.
- `PAY_PER_REQUEST` → on-demand billing, zero cost while idle.
- Then `aws dynamodb wait table-exists` for each — the loop blocks until AWS
  reports ACTIVE, otherwise later steps (seed) would fail with ResourceNotFound.

## 6. Cognito pool + app client (lines 62–80)

```bash
POOL_ID=$(aws cognito-idp create-user-pool --pool-name eventflow-users \
  --policies 'PasswordPolicy={MinimumLength=8,RequireLowercase=false,...}' \
  --auto-verified-attributes email ...)
```
- Password policy relaxed to 8 chars, no complexity — demo logins like `Demo123!`.
- Email auto-verified so sign-up doesn't need a confirmation code round-trip
  for the pre-created demo user.

```bash
CLIENT_ID=$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL_ID" \
  --client-name eventflow-web \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_PASSWORD_AUTH ...)
```
- `ALLOW_USER_PASSWORD_AUTH` → the frontend's plain-REST login (username+password
  straight to Cognito, no SRP crypto in the browser) works.
- `ALLOW_REFRESH_TOKEN_AUTH` → token refresh flow stays available.
- No app-client secret → correct for browser clients.
- On re-runs the `else` branch recovers both IDs by listing pools by name.

## 7. S3 QR bucket + public read (lines 82–100)

```bash
aws s3api create-bucket --bucket "$NAME" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"
```
- Outside us-east-1 you MUST pass `LocationConstraint` or creation fails.

```json
{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::BUCKET/*"}
```
- Bucket policy grants **anonymous GetObject only** — attendees' `<img>` tags can
  load QR PNGs with no signing. Write access is NOT public; only the Lambda role
  can `PutObject` (via the scoped IAM policy).
- `put-public-access-block` first disables the three account-level guards that
  would reject that policy — scoped to this one bucket.

```bash
TOPIC_ARN=$(aws sns create-topic --name eventflow-notifications ...)
```
- One SNS topic for all notifications. On re-runs the ARN is recovered by listing.

## 8. SSM config (lines 102–115)

```bash
aws ssm put-parameter --name /eventflow/ddb_users --value eventflow-users --overwrite
```
- 8 parameters under one path: 5 table names + topic ARN + bucket + pool id.
- Lambdas read `/eventflow/*` at cold start (`cfg()` in common.mjs) — so renaming
  a resource is a parameter update, not a code change. `--overwrite` makes re-runs safe.

## 9. The scoped Lambda role (lines 117–135)

```bash
cat > /tmp/ef-trust.json <<'EOF'
{"Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}
EOF
aws iam create-role --role-name eventflow-lambda-role --assume-role-policy-document file:///tmp/ef-trust.json
```
- Trust policy: only the Lambda service may assume this role.

```bash
aws iam put-role-policy ... --policy-document \
  "$(sed -e "s/REGION/$REGION/g" -e "s/ACCOUNT/$ACCOUNT/g" policies/eventflow-lambda-minimal.json)"
```
- The template JSON has `REGION`/`ACCOUNT` placeholders; `sed` substitutes your
  real values inline. Result: permissions on exactly 5 tables + their GSIs, one
  SNS topic ARN, `s3:PutObject` on `…/qr/*` only, `ssm:GetParameters` on
  `/eventflow/*` only. No `"*"` anywhere.
- `sleep 12` → IAM propagation delay; without it, the first `create-function`
  can fail with "role cannot be assumed".

## 10. Build & zip the functions (lines 137–152)

```bash
for f in $FUNCS; do
  cp ../functions/$f/index.mjs  .build/$f/
  cp ../functions/_shared/common.mjs .build/$f/common.mjs
```
- Each zip gets its handler + a copy of the shared helper (flattens the import
  path to `./common.mjs`).
- Only `register` gets `npm install` — it alone has a runtime dep (`qrcode`).
  All AWS SDK v3 packages are already built into the Node 20 runtime.
- `zip -qr ../$f.zip .` → the zip root must contain `index.mjs` directly,
  matching `--handler index.handler`.

## 11. Create/update Lambdas (lines 154–172)

```bash
if aws lambda get-function --function-name ef-$f ...; then
  aws lambda update-function-code ...     # code-only re-deploy
else
  aws lambda create-function \
    --runtime nodejs20.x --architectures arm64 \
    --handler index.handler --role "$ROLE_ARN" \
    --timeout 15 --memory-size 256
```
- `ef-` prefix groups them in the console.
- `arm64` (Graviton) = cheaper + fast cold starts for this workload.
- 256 MB / 15 s is plenty: each handler does 1–3 DDB calls.
- ESM works because `.mjs` + Node 20 runtime needs no config.

## 12. HTTP API v2 + CORS + authorizer (lines 174–200)

```bash
aws apigatewayv2 create-api --name eventflow-api --protocol-type HTTP \
  --route-key "DELETE /__never" \
  --cors-config AllowOrigins='["*"]',AllowMethods='["*"]',AllowHeaders='["authorization","content-type"]'
```
- `--route-key "DELETE /__never"` — API needs ≥1 route at creation; this dummy
  is never called. The real routes are added next.
- The CORS object answers **preflight OPTIONS at the API level** — no OPTIONS
  lambdas, and browsers stop blocking the frontend.

```bash
AUTH_ID=$(aws apigatewayv2 create-authorizer \
  --authorizer-type JWT --identity-source '["$request.header.authorization"]' \
  --jwt-configuration "{\"Audience\":[\"$CLIENT_ID\"],\"Issuer\":\"https://cognito-idp.$REGION.amazonaws.com/$POOL_ID\"}")
```
- Machine-to-machine JWT authorizer (no Lambda round-trip): API Gateway itself
  validates the Cognito signature, expiry, and audience before your Lambda runs.
  Audience MUST be the app client id; issuer MUST be the pool endpoint.

## 13. Routes + integrations (lines 202–232)

```bash
route() { # method path function auth
  aws apigatewayv2 create-route ... --authorization-type JWT --authorizer-id $AUTH_ID   # or NONE
  aws apigatewayv2 create-integration --integration-type AWS_PROXY \
    --integration-uri "arn:aws:apigateway:${REGION}::lambda:path/2015-03-31/functions/...:ef-$fn/invocations" \
    --payload-format-version 2.0
  aws apigatewayv2 update-route --target "integrations/$integ"
}
```
- `AWS_PROXY` = Lambda proxy integration: the whole request lands in `event`,
  your `json()` response goes straight back. `payload-format-version 2.0` = the
  v2 event shape every handler is written for.
- `create-route || true` → re-runs don't die because the route exists; the
  `update-route` then (re)binds it to the integration.
- Auth matrix implemented exactly as in `API_CONTRACT.md`: `/register` and
  `/qr/{proxy+}` are `NONE` (public), all 10 others are `JWT`.
- `/qr/{proxy+}` uses the greedy path variable → `GET /qr/u_7f3a2c` lands in
  `event.pathParameters.proxy`.

## 14. Resource-based Lambda permissions (lines 234–241)

```bash
aws lambda add-permission --statement-id apigw-$f \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:$API_ID/*/*"
```
- Two-way link completed: API may invoke these specific Lambdas, but only when
  the request comes from THIS API (`source-arn`). `|| true` keeps re-runs quiet
  (duplicate statement ids are rejected harmlessly).

## 15. The summary block (lines 243–end)

Prints everything the frontend needs (API endpoint, pool id, client id, bucket,
topic), the exact `.env` contents to paste, the `USE_MOCK_API=false` reminder,
and ready-made `sign-up` / `admin-confirm-sign-up` commands for the demo user.

---

## 16. After deploy.sh: seed + connect (not in the script)

```bash
node seed.js
```
- Writes halls/booths/queues(+counters)/inventory/volunteers and the
  `COUNTER#checkins` headcount row. Idempotent — safe to re-run to reset demo state.

```bash
cp ../../frontend/.env.example ../../frontend/.env   # fill with summary values
# then in frontend/src/api/config.js →  USE_MOCK_API = false
npm run dev
```

## 17. Smoke test in 60 seconds

```bash
curl -i $API_ENDPOINT/booths                       # expect 401 (authorizer live)
curl -s -X POST $API_ENDPOINT/register \
  -d '{"name":"Smoke","email":"smoke@test.io"}'    # expect {user_id, qr_code, qr_url}
TOKEN=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH \
  --client-id $CLIENT_ID --auth-parameters USERNAME=demo@eventflow.io,PASSWORD=Demo123! \
  --query AuthenticationResult.IdToken --output text --region $REGION)
curl -s $API_ENDPOINT/booths -H "authorization: Bearer $TOKEN"   # expect booth JSON array
```
