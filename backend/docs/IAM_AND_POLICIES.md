# EventFlow — IAM for the Lambdas (least-privilege, no `"*"`)

## Model
One execution role for all 12 `ef-*` functions: `eventflow-lambda-role`.
Scoping is per-resource, not per-function — each Lambda only *invokes* actions
on the tables/topic/bucket it uses, and the policy allows nothing else. For a
hackathon this is the right granularity; per-function roles would be 12 more
moving parts. (If judges ask: per-function role split is the production step.)

## The policy
Canonical file: `backend/infra/policies/eventflow-lambda-minimal.json`
(`REGION`/`ACCOUNT` are sed-substituted by deploy.sh). It allows exactly:

| Sid | Actions | Resources |
|---|---|---|
| DynamoTablesExact | GetItem, PutItem, UpdateItem, Query, Scan | the 5 `eventflow-*` tables + their `index/*` GSIs |
| SnsPublishExact | sns:Publish | only `eventflow-notifications` |
| S3QrPutOnly | s3:PutObject | only `eventflow-qr-<acct>-<region>/qr/*` |
| SsmReadConfig | ssm:GetParameters | only `/eventflow/*` |
| — | CloudWatch Logs (basic) | managed policy `AWSLambdaBasicExecutionRole` attached to the role |

Notably **absent**: DeleteItem, DeleteTable, dynamodb:*, s3:*, sns:*, ssm:*,
iam:*, lambda:InvokeFunction. The role can't drop a table or republish a topic.

## Deployed automatically
deploy.sh creates the role, attaches the scoped inline policy and the Logs
managed policy, and attaches `lambda.amazonaws.com` trust.

## If you're doing it in the Console instead
1. IAM → Roles → Create role → AWS service → Lambda → create `eventflow-lambda-role`.
2. Create policy → JSON tab → paste the file above with REGION/ACCOUNT replaced →
   name it `eventflow-minimal` → attach to the role.
3. Attach AWS managed policy `AWSLambdaBasicExecutionRole` (CloudWatch Logs).
4. Trust relationship: principal `lambda.amazonaws.com`, action `sts:AssumeRole`.

## Route-side auth (API Gateway)
- `POST /register` and `GET /qr/{proxy+}` → authorization type NONE.
- All others → JWT authorizer `eventflow-cognito` bound to the Cognito pool
  (issuer `cognito-idp.<region>.amazonaws.com/<pool-id>`, audience = app client id).

## Before you demo
```bash
# sanity-check the role can do what it needs (should print 0 missing)
aws iam simulate-principal-policy --policy-source-arn <role-arn> \
  --action-names dynamodb:PutItem sns:Publish s3:PutObject ssm:GetParameters \
  --resource-arns arn:aws:dynamodb:ap-south-1:<acct>:table/eventflow-users
```
