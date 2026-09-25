#!/usr/bin/env bash
# ============================================================
# EventFlow — deploy the FRONTEND via AWS Amplify Hosting
# Fallback when CloudFront is blocked ("account must be verified").
# Gives an instant https://main.<id>.amplifyapp.com URL.
# Usage: bash deploy-amplify.sh
# ============================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

REGION="${AWS_REGION:-ap-south-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$SCRIPT_DIR/.tmp"
mkdir -p "$TMP"
if command -v cygpath >/dev/null 2>&1; then wpath() { cygpath -w "$1"; }; else wpath() { echo "$1"; }; fi

step() { echo -e "\n==> $1"; }

APP_NAME="eventflow-web"
BR="main"
FRONTEND_DIR="$SCRIPT_DIR/../../frontend"

command -v aws >/dev/null || { echo "Missing: aws CLI"; exit 1; }

step "Building the site"
cd "$FRONTEND_DIR"
npm run build

step "Packaging dist → zip (index.html at zip root, NO ./ prefix)"
# Zipping "." makes bsdtar store entries as ./index.html — Amplify 404s on
# those. Zip the actual names so entries are index.html, assets/… etc.
rm -f "$TMP/site.zip"
( cd dist && /c/Windows/System32/tar.exe -a -cf "$(wpath "$TMP")\\site.zip" index.html assets )

step "Amplify app + branch (idempotent)"
APP_ID=$(aws amplify list-apps --region "$REGION" --query "apps[?name=='$APP_NAME'].appId | [0]" --output text | tr -d '\r\n ')
if [ -z "$APP_ID" ] || [ "$APP_ID" = "None" ]; then
  APP_ID=$(aws amplify create-app --name "$APP_NAME" --platform WEB --region "$REGION" \
    --query 'app.appId' --output text | tr -d '\r\n ')
  echo "  created app $APP_ID"
else
  echo "  reusing app $APP_ID"
fi
aws amplify create-branch --app-id "$APP_ID" --branch-name "$BR" --region "$REGION" \
  --enable-auto-build --query 'branch.branchName' --output text >/dev/null 2>&1 || true

step "Upload + deploy"
# A previous failed run can leave a non-terminal job that blocks new ones.
STUCK=$(aws amplify list-jobs --app-id "$APP_ID" --branch-name "$BR" --region "$REGION" \
  --query "jobSummaries[?status=='PENDING' || status=='PENDING_UPLOAD' || status=='RUNNING'].jobId | [0]" \
  --output text | tr -d '\r\n ')
if [ -n "$STUCK" ] && [ "$STUCK" != "None" ]; then
  echo "  stopping stuck job $STUCK"
  aws amplify stop-job --app-id "$APP_ID" --branch-name "$BR" --job-id "$STUCK" --region "$REGION" >/dev/null 2>&1 || true
  sleep 2
fi
DEP_JSON="$TMP/amplify-dep.json"
CREATED=0
for i in 1 2 3; do
  if aws amplify create-deployment --app-id "$APP_ID" --branch-name "$BR" --region "$REGION" \
    --output json > "$DEP_JSON" 2>"$TMP/dep-err.txt"; then CREATED=1; break; fi
  echo "  create-deployment retry $i: $(head -c 120 "$TMP/dep-err.txt")"
  sleep 3
done
[ "$CREATED" = "1" ] || { echo "create-deployment kept failing:"; cat "$TMP/dep-err.txt"; exit 1; }
PARSED=$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(d.jobId);console.log(d.zipUploadUrl||d.uploadUrl)" "$(wpath "$DEP_JSON")")
JOB_ID=$(echo "$PARSED" | sed -n 1p | tr -d '\r\n ')
UPLOAD_URL=$(echo "$PARSED" | sed -n 2p | tr -d '\r\n ')
[ -n "$JOB_ID" ] && [ -n "$UPLOAD_URL" ] || { echo "Could not parse create-deployment response"; cat "$DEP_JSON"; exit 1; }
echo "  job $JOB_ID"
echo "  uploading zip ($(wc -c < "$TMP/site.zip") bytes)..."
# Windows' native curl can't read MSYS paths — hand it a Windows path.
curl -sS -X PUT --upload-file "$(wpath "$TMP")\\site.zip" "$UPLOAD_URL"
echo "  upload done"
aws amplify start-deployment --app-id "$APP_ID" --branch-name "$BR" --job-id "$JOB_ID" --region "$REGION" >/dev/null

step "Waiting for deployment to finish"
for i in $(seq 1 24); do
  ST=$(aws amplify get-job --app-id "$APP_ID" --branch-name "$BR" --job-id "$JOB_ID" --region "$REGION" \
    --query 'job.summary.status' --output text | tr -d '\r\n ')
  echo "  status: $ST"
  [ "$ST" = "SUCCEED" ] && break
  [ "$ST" = "FAILED" ] && { echo "Deployment FAILED — run: aws amplify get-job --app-id $APP_ID --branch-name $BR --job-id $JOB_ID --region $REGION"; exit 1; }
  sleep 5
done

DOMAIN=$(aws amplify get-app --app-id "$APP_ID" --region "$REGION" --query 'app.defaultDomain' --output text | tr -d '\r\n ')
HTTPS_URL="https://$BR.$DOMAIN"

cat <<DONE

============================================================
  EventFlow website deployed ✔ (HTTPS via Amplify)
  Share this link:  $HTTPS_URL
  (real padlock 🔒 — works on phones, mobile data, anywhere)
============================================================
DONE
