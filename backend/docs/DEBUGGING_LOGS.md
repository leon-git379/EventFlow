# EventFlow — Debugging: CloudWatch Logs & the usual suspects

## Finding logs — Console
1. Lambda Console → Functions → `ef-<name>` (e.g. `ef-queue_join`) → **Monitor** tab → **View CloudWatch logs**.
2. Or CloudWatch → Log groups → `/aws/lambda/ef-<name>`.
3. Open the newest stream (ends in the request timestamp). Lambda prints the
   `START…END` per invocation; your `console.error`/`console.log` lines appear inline.

## Finding logs — CLI
```bash
# latest events for one function, live
aws logs tail /aws/lambda/ef-queue_join --follow --region ap-south-1

# scan recent errors across all EventFlow functions
for f in register checkin queue_join queue_next queue_status booths_list \
         booths_update organizer_summary sponsor_stats swag_redeem volunteers_list qr_pass; do
  echo "== $f =="
  aws logs filter-log-events --log-group-name /aws/lambda/ef-$f \
    --filter-pattern "ERROR" --region ap-south-1 \
    --query 'events[].message' --output text | tail -5
done
```
(If a group doesn't exist, that function has never been invoked — fix that first.)

## Reading the HTTP layer from the outside
```bash
# authorizer working? 401 => yes (with no token), 200/400 => token failed or bad input
curl -i https://<api-id>.execute-api.ap-south-1.amazonaws.com/booths

# handler errors? compare with CloudWatch stream of the same second
curl -s -X POST .../queue/join -H "authorization: Bearer $TOKEN" \
  -d '{"user_id":"u_7f3a2c","queue_id":"food_court"}'
```

## Most common failures for this exact setup

| Symptom (what you see) | Likely cause | Fix |
|---|---|---|
| Browser: "has been blocked by CORS policy" | Frontend origin not allowed by API's CORS config | deploy.sh sets `AllowOrigins=["*"]` on the HTTP API. If you recreated the API manually, re-run with the same `--cors-config`. Also confirm the API Gateway response includes `access-control-allow-origin` (our `json()` helper always adds it) |
| `401 Unauthorized` on every call after login | Cognito JWT not reaching API GW, or wrong pool/client | Token must be `Authorization: Bearer <id_token>`; authorizer audience = **app client id**, issuer = pool endpoint. Re-check `.env` values |
| 401 after some minutes only | Expired ID token (1 h default) | Let `refreshSession()` in `api/cognito.js` run — it calls `USER_PASSWORD_AUTH` with the stored password for the demo |
| `403 {"Message":"User is not authorized..."}` from API GW | Route's authorization is JWT but request had no `Authorization` header | Frontend api layer always sends it when a session exists; check devtools → request headers |
| `{"error":"Internal error"}` + stream shows `AccessDeniedException` | Missing IAM permission (table/topic/bucket) | Compare the denied ARN in the log line against `policies/eventflow-lambda-minimal.json`; if you renamed a table, update the policy + SSM |
| `AccessDenied` on SNS publish | Token called but no publish on topic | deploy.sh grants publish on the exact topic ARN; if the topic was recreated, update SSM `/eventflow/sns_topic` + the policy |
| `ResourceNotFoundException ... table` | Wrong/missing SSM value or table not in region | `aws ssm get-parameters-by-path --path /eventflow/` to eyeball config; check region of the table |
| `{"error":"Malformed JSON body"}` | Frontend sent no/invalid JSON | Confirm `Content-Type: application/json` and `JSON.stringify(body)`; raw curl needs quotes |
| Lambda "UNHANDLED" with `ValidationException` on `UpdateExpression` | Reserved words in expressions | We avoid reserved words; if you edit, use ExpressionAttributeNames |
| Function times out (~15 s) | Cognito JWKS fetch blocked (no NAT egress) | Functions run in the service VPC-less default; if you attached a VPC, re-check NAT or make the JWKS fetch cached/failure-tolerant |
| Token numbers repeat for two users | Someone re-implemented token issuance with read-then-write | Keep the `ADD n 1` atomic counter pattern |

## The 30-second triage routine during a demo
1. `curl -i` the failing endpoint from the laptop → status code?
2. 401/403 → auth layer (token present? pool/client ids right?)
3. 404 from API GW ("Not Found" plain text) → route missing/mis-spelled → re-run deploy.sh (idempotent)
4. 500 → CloudWatch stream for that exact second → first `UNHANDLED` line names the failing SDK call
5. CORS error in browser but curl works → CORS config on the API (re-run deploy.sh)