#!/usr/bin/env bash
# EventFlow one-shot deploy — Group A
# Usage: bash deploy.sh
# Creates: 5 DynamoDB tables, Cognito pool+client, S3 QR bucket, SNS topic,
#          SSM config, Lambda layers, 10 functions, HTTP API v2 with CORS +
#          Cognito authorizer, all routes. Prints the URLs the frontend needs.
set -euo pipefail

# Git Bash/MSYS silently rewrites arguments that start with "/" (e.g. SSM
# parameter names like /eventflow/ddb_users) into Windows paths. Disable that.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

REGION="${AWS_REGION:-ap-south-1}"
PROFILE="${AWS_PROFILE:-}"
PROF=""
[ -n "$PROFILE" ] && PROF="--profile $PROFILE"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
suffix() { aws sts get-caller-identity $PROF --query Account --output text; }
ACCOUNT="$(suffix)"
NAME="eventflow-qr-$ACCOUNT-$REGION"
API_NAME="eventflow-api"
POOL_NAME="eventflow-users"
TS="$(date +%s)"

step() { echo -e "\n==> $1"; }
have() { command -v "$1" >/dev/null 2>&1; }
need() { have "$1" || { echo "Missing dependency: $1"; exit 1; }; }
need aws; need node; need npm

# Windows-safe temp dir (Git Bash has no writable /tmp)
TMP="$SCRIPT_DIR/.tmp"
mkdir -p "$TMP"

# AWS CLI on Windows can't open Git Bash paths like /c/Users/... — convert.
if command -v cygpath >/dev/null 2>&1; then
  wpath() { cygpath -w "$1"; }
else
  wpath() { echo "$1"; }
fi

# Packaging: prefer zip, fall back to Windows' built-in bsdtar
# (C:\Windows\System32\tar.exe), which CAN emit zip via -a. Git Bash's own
# GNU tar cannot write zip at all, so never use it for packaging.
if have zip; then
  pack() { (cd "$1" && zip -qr "../$2.zip" .); }
else
  WTAR="/c/Windows/System32/tar.exe"
  [ -x "$WTAR" ] || { echo "Missing both zip and Windows tar.exe — cannot package Lambdas"; exit 1; }
  pack() { (cd "$1" && "$WTAR" -a -cf "../$2.zip" .); }
fi

step "Precheck: existing resources"
if aws dynamodb describe-table --table-name eventflow-queues --region "$REGION" $PROF >/dev/null 2>&1; then
  echo "EventFlow already deployed in $REGION — re-run deploys only the Lambda code."
  SKIP_INFRA=1
else
  SKIP_INFRA=0
fi
if [ "$SKIP_INFRA" -eq 0 ]; then
  step "DynamoDB tables"
  for spec in \
    "eventflow-users uid S nosk" \
    "eventflow-queues pk S sk" \
    "eventflow-booths pk S sk" \
    "eventflow-inventory pk S sk" \
    "eventflow-volunteers pk S sk"
  do
    set -- $spec; tn=$1; pk=$2; pt=$3; skmode=$4
    attrs="AttributeName=$pk,AttributeType=$pt AttributeName=gs1pk,AttributeType=S AttributeName=gs1sk,AttributeType=S"
    ks="AttributeName=$pk,KeyType=HASH"
    [ "$skmode" = "sk" ] && { attrs="$attrs AttributeName=sk,AttributeType=S"; ks="$ks AttributeName=sk,KeyType=RANGE"; }
    echo "  creating $tn (pk: $pk, sk: ${skmode})"
    aws dynamodb create-table \
      --table-name "$tn" \
      --attribute-definitions $attrs \
      --key-schema $ks \
      --global-secondary-indexes '[{"IndexName":"GS1","KeySchema":[{"AttributeName":"gs1pk","KeyType":"HASH"},{"AttributeName":"gs1sk","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
      --billing-mode PAY_PER_REQUEST \
      --region "$REGION" $PROF >/dev/null
  done
  step "Waiting for tables to become ACTIVE"
  for tn in eventflow-users eventflow-queues eventflow-booths eventflow-inventory eventflow-volunteers; do
    aws dynamodb wait table-exists --table-name "$tn" --region "$REGION" $PROF
  done
else
  step "Skipping DDB (exists)"
fi
POOL_ID=""
CLIENT_ID=""
if [ "$SKIP_INFRA" -eq 0 ]; then
  step "Cognito User Pool + App Client"
  POOL_ID=$(aws cognito-idp create-user-pool --pool-name "$POOL_NAME" --region "$REGION" $PROF \
    --policies 'PasswordPolicy={MinimumLength=8,RequireLowercase=false,RequireUppercase=false,RequireNumbers=false,RequireSymbols=false}' \
    --auto-verified-attributes email \
    --query UserPool.Id --output text)
  CLIENT_ID=$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL_ID" \
    --client-name eventflow-web --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_PASSWORD_AUTH \
    --prevent-user-existence-errors ENABLED --region "$REGION" $PROF --query UserPoolClient.ClientId --output text)
  echo "  Pool $POOL_ID / Client $CLIENT_ID"
  step "Cognito groups (RBAC: organizer / sponsor / attendee)"
  for g in organizer sponsor attendee; do
    aws cognito-idp create-group --user-pool-id "$POOL_ID" --group-name "$g" \
      --description "EventFlow $g role" --region "$REGION" $PROF >/dev/null 2>&1 || true
    echo "  group: $g"
  done
else
  step "Cognito: reusing existing pool"
  POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --query "UserPools[?Name=='$POOL_NAME'].Id | [0]" --output text --region "$REGION" $PROF)
  CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --max-results 10 --query "UserPoolClients[?ClientName=='eventflow-web'].ClientId | [0]" --output text --region "$REGION" $PROF)
fi
if [ "$SKIP_INFRA" -eq 0 ]; then
  step "S3 QR bucket (public-read for QR images)"
  aws s3api head-bucket --bucket "$NAME" --region "$REGION" $PROF 2>/dev/null || \
  aws s3api create-bucket --bucket "$NAME" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" $PROF

  step "SNS topic"
  TOPIC_ARN=$(aws sns create-topic --name eventflow-notifications --region "$REGION" $PROF --query TopicArn --output text)
  echo "  Topic: $TOPIC_ARN"
else
  step "S3/SNS: reusing existing"
  TOPIC_ARN=$(aws sns list-topics --region "$REGION" $PROF --query 'Topics[?ends_with(TopicArn, `:eventflow-notifications`)].TopicArn | [0]' --output text)
  if [ -z "$TOPIC_ARN" ] || [ "$TOPIC_ARN" = "None" ]; then
    TOPIC_ARN=$(aws sns create-topic --name eventflow-notifications --region "$REGION" $PROF --query TopicArn --output text)
    echo "  topic was missing — created"
  fi
fi
# Always ensure the QR bucket is publicly readable (idempotent, also fixes
# re-runs where the bucket exists but its policy was never applied).
if aws s3api head-bucket --bucket "$NAME" --region "$REGION" $PROF 2>/dev/null; then
  step "Ensuring QR bucket public-read policy"
  aws s3api put-public-access-block --bucket "$NAME" \
    --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false $PROF
  cat > "$TMP/ef-public.json" <<EOF
{"Version":"2012-10-17","Statement":[{"Sid":"PublicReadQR","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::$NAME/*"}]}
EOF
  aws s3api put-bucket-policy --bucket "$NAME" --policy "file://$(wpath "$TMP/ef-public.json")" $PROF
fi
step "Cognito groups: ensure they exist (re-runs & pre-existing pools)"
for g in organizer sponsor attendee; do
  aws cognito-idp create-group --user-pool-id "$POOL_ID" --group-name "$g" \
    --description "EventFlow $g role" --region "$REGION" $PROF >/dev/null 2>&1 || true
done

demo_group_add() { # username group — idempotent, non-fatal
  aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID" \
    --username "$1" --group-name "$2" --region "$REGION" $PROF >/dev/null 2>&1 || true
}
# Demo accounts are confirmed via the summary instructions; group them here on
# every run so re-deploys heal role assignments automatically.
demo_group_add demo@eventflow.io organizer
demo_group_add demo@eventflow.io sponsor
demo_group_add demo@eventflow.io attendee

step "SSM config parameters"
for nv in \
  "/eventflow/ddb_users eventflow-users" \
  "/eventflow/ddb_queues eventflow-queues" \
  "/eventflow/ddb_booths eventflow-booths" \
  "/eventflow/ddb_inventory eventflow-inventory" \
  "/eventflow/ddb_volunteers eventflow-volunteers" \
  "/eventflow/sns_topic $TOPIC_ARN" \
  "/eventflow/s3_bucket $NAME" \
  "/eventflow/cognito_pool_id $POOL_ID"
do
  set -- $nv; n=$1; v=$2
  aws ssm put-parameter --name "$n" --type String --value "$v" --overwrite --region "$REGION" $PROF >/dev/null
done
step "SSM QR signing secret (SecureString) + TTL"
# Create once, never overwrite on re-runs (rotating would invalidate all
# outstanding passes mid-demo). Set QR_SECRET to force a specific value.
if ! aws ssm get-parameter --name /eventflow/qr_secret --region "$REGION" $PROF >/dev/null 2>&1; then
  QR_SECRET_VAL="${QR_SECRET:-$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')}"
  aws ssm put-parameter --name /eventflow/qr_secret --type SecureString \
    --value "$QR_SECRET_VAL" --region "$REGION" $PROF >/dev/null
  echo "  qr_secret created"
else
  echo "  qr_secret exists — kept"
fi
aws ssm put-parameter --name /eventflow/qr_ttl_hours --type String \
  --value "${QR_TTL_HOURS:-12}" --overwrite --region "$REGION" $PROF >/dev/null
echo "  qr_ttl_hours = ${QR_TTL_HOURS:-12}"
step "Lambda execution role (scoped, no '*')"
ROLE_NAME=eventflow-lambda-role
ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query Role.Arn --output text 2>/dev/null || true)
if [ -z "$ROLE_ARN" ]; then
  cat > "$TMP/ef-trust.json" <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
  ROLE_ARN=$(aws iam create-role --role-name $ROLE_NAME --assume-role-policy-document "file://$(wpath "$TMP/ef-trust.json")" --query Role.Arn --output text $PROF)
  echo "  Waiting for IAM propagation"
  sleep 12
fi
# Always (re)apply the inline policy — keeps permissions in sync on re-runs.
# KEYARN = the aws/ssm managed key, needed for kms:Decrypt when Lambdas read
# the /eventflow/qr_secret SecureString (GetParameters WithDecryption).
KMS_KEYARN=$(aws kms describe-key --key-id alias/aws/ssm --region "$REGION" $PROF --query KeyMetadata.Arn --output text)
aws iam put-role-policy --role-name $ROLE_NAME --policy-name eventflow-minimal \
  --policy-document "$(sed -e "s/REGION/$REGION/g" -e "s/ACCOUNT/$ACCOUNT/g" -e "s|KEYARN|$KMS_KEYARN|g" "$SCRIPT_DIR/policies/eventflow-lambda-minimal.json")" $PROF
step "Building function packages"
FUNCS="register checkin queue_join queue_next queue_status booths_list booths_update organizer_summary sponsor_stats swag_redeem volunteers_list qr_pass"
BUILD="$SCRIPT_DIR/.build"
rm -rf "$BUILD"; mkdir -p "$BUILD"
for f in $FUNCS; do
  mkdir -p "$BUILD/$f"
  cp "$SCRIPT_DIR/../functions/$f/index.mjs" "$BUILD/$f/"
  cp "$SCRIPT_DIR/../functions/_shared/common.mjs" "$BUILD/$f/common.mjs"
  if [ "$f" = "register" ]; then
    cp "$SCRIPT_DIR/../functions/register/package.json" "$BUILD/$f/"
    (cd "$BUILD/$f" && npm install --omit=dev --silent >/dev/null 2>&1)
  fi
  (cd "$BUILD/$f" && pack "$BUILD/$f" "$f")
  echo "  packaged $f"
done
step "Creating/updating Lambda functions"
for f in $FUNCS; do
  if aws lambda get-function --function-name "ef-$f" --region "$REGION" $PROF >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "ef-$f" --zip-file "fileb://$(wpath "$BUILD/$f.zip")" --region "$REGION" $PROF >/dev/null
    echo "  updated ef-$f"
  else
    aws lambda create-function \
      --function-name "ef-$f" \
      --runtime nodejs20.x \
      --architectures arm64 \
      --handler index.handler \
      --role "$ROLE_ARN" \
      --zip-file "fileb://$(wpath "$BUILD/$f.zip")" \
      --timeout 15 \
      --memory-size 256 \
      --region "$REGION" $PROF \
      --description "EventFlow $f" >/dev/null
    echo "  created ef-$f"
  fi
done
step "HTTP API v2 (CORS + Cognito authorizer)"
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" $PROF --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)
if [ "$API_ID" = "None" ] || [ -z "$API_ID" ]; then
  API_ID=$(aws apigatewayv2 create-api --name "$API_NAME" --protocol-type HTTP \
    --cors-config AllowOrigins='["*"]',AllowMethods='["*"]',AllowHeaders='["authorization","content-type"]',AllowCredentials=false \
    --region "$REGION" $PROF --query ApiId --output text)
  echo "  created API $API_ID"
else
  echo "  reusing API $API_ID"
fi

step "Default stage (auto-deploy)"
# Without a stage no URL serves the routes (create-api makes $default only
# when routes exist at birth — ours don't). Idempotent.
aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy --region "$REGION" $PROF >/dev/null 2>&1 \
  || aws apigatewayv2 update-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy --region "$REGION" $PROF >/dev/null 2>&1 || true

echo '  stage $default (auto-deploy) on' "$API_ID"

step "Cognito JWT authorizer"
AUTH_ID=$(aws apigatewayv2 get-authorizers --api-id "$API_ID" --region "$REGION" $PROF --query "Items[?Name=='eventflow-cognito'].AuthorizerId | [0]" --output text)
if [ "$AUTH_ID" = "None" ] || [ -z "$AUTH_ID" ]; then
  AUTH_ID=$(aws apigatewayv2 create-authorizer --api-id "$API_ID" --name eventflow-cognito \
    --authorizer-type JWT --identity-source '["$request.header.authorization"]' \
    --jwt-configuration "{\"Audience\":[\"$CLIENT_ID\"],\"Issuer\":\"https://cognito-idp.$REGION.amazonaws.com/$POOL_ID\"}" \
    --region "$REGION" $PROF --query AuthorizerId --output text)
fi
step "Routes"
route() { # method path function auth?
  local m=$1 p=$2 fn=$3 auth=$4
  local extra=()
  [ "$auth" = "auth" ] && extra+=(--authorization-type JWT --authorizer-id "$AUTH_ID") || extra+=(--authorization-type NONE)
  aws apigatewayv2 create-route --api-id "$API_ID" --route-key "$m $p" "${extra[@]}" --region "$REGION" $PROF >/dev/null 2>&1 || true
  aws apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY \
    --integration-uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/arn:aws:lambda:${REGION}:${ACCOUNT}:function:ef-$fn/invocations" \
    --payload-format-version 2.0 --region "$REGION" $PROF >/dev/null
  # AWS CLI on Windows emits CRLF and multi-match lists can join ids with
  # tabs/newlines — split into tokens and take the first well-formed one.
  # Integration creation is eventually consistent — retry until it appears.
  local integ="" rid="" i
  for i in 1 2 3 4 5; do
    integ=$(aws apigatewayv2 get-integrations --api-id "$API_ID" --region "$REGION" $PROF \
      --query "Items[?IntegrationUri!=null && contains(IntegrationUri, 'function:ef-$fn/')].IntegrationId" --output text \
      | tr '\t' '\n' | tr -d '\r' | grep -E '^[a-z0-9]+$' | head -1)
    rid=$(aws apigatewayv2 get-routes --api-id "$API_ID" --region "$REGION" $PROF \
      --query "Items[?RouteKey=='$m $p'].RouteId" --output text \
      | tr '\t' '\n' | tr -d '\r' | grep -E '^[a-z0-9]+$' | head -1)
    if [[ -n "$integ" ]] && [[ -n "$rid" ]]; then
      aws apigatewayv2 update-route --api-id "$API_ID" --route-id "$rid" --target "integrations/$integ" --region "$REGION" $PROF >/dev/null
      echo "  $m $p -> ef-$fn ($auth)"
      return 0
    fi
    sleep 2
  done
  echo "  FAILED to wire $m $p -> ef-$fn (integ='$integ' rid='$rid')"
  return 1
}
route POST /register register none
route POST /checkin checkin auth
route POST /queue/join queue_join auth
route POST /queue/next queue_next auth
route GET /queue/status queue_status auth
route GET /booths booths_list auth
route POST /booths/update booths_update auth
route GET /organizer/summary organizer_summary auth
route GET /sponsor/stats sponsor_stats auth
route POST /swag/redeem swag_redeem auth
route GET /volunteers volunteers_list auth
route GET /qr/{proxy+} qr_pass none
step "Lambda permissions for API Gateway"
for f in $FUNCS; do
  aws lambda add-permission --function-name "ef-$f" --statement-id "apigw-$f" \
    --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:$API_ID/*/*" \
    --region "$REGION" $PROF >/dev/null 2>&1 || true
done
step "Deployment summary"
API_ENDPOINT=$(aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION" $PROF --query ApiEndpoint --output text)
REGION_HOSTED="https://$POOL_ID.auth.$REGION.amazoncognito.com"

cat <<SUMMARY

============================================================
  EventFlow deployed ✔  ($REGION)
============================================================
API endpoint      : $API_ENDPOINT
Cognito Pool ID   : $POOL_ID
Cognito Client ID : $CLIENT_ID
S3 bucket (QR)    : $NAME
SNS topic         : $TOPIC_ARN
Hosted UI (opt.)  : $REGION_HOSTED

Next steps:
  1) cd $SCRIPT_DIR && node seed.js
  2) Frontend: copy .env.example → .env and fill:
       VITE_API_BASE_URL=$API_ENDPOINT
       VITE_COGNITO_USER_POOL_ID=$POOL_ID
       VITE_COGNITO_CLIENT_ID=$CLIENT_ID
     then set USE_MOCK_API=false in frontend/src/api/config.js

Demo login (one-time):
  aws cognito-idp sign-up --region $REGION --client-id $CLIENT_ID \\
    --username demo@eventflow.io --password Demo123! \\
    --user-attributes '[{"Name":"email","Value":"demo@eventflow.io"},{"Name":"name","Value":"Demo User"}]'
  aws cognito-idp admin-confirm-sign-up --region $REGION \\
    --user-pool-id $POOL_ID --username demo@eventflow.io
  # the deploy script adds this user to organizer/sponsor/attendee groups on
  # every run — log in via the frontend with demo@eventflow.io / Demo123!
============================================================
SUMMARY
