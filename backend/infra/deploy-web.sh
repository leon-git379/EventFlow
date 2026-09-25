#!/usr/bin/env bash
# ============================================================
# EventFlow — deploy the FRONTEND (website) to S3 public hosting
# Usage:  bash deploy-web.sh
# Prereq: backend already deployed (deploy.sh) and .env filled.
# Result: a public URL like
#   http://eventflow-web-123456789-ap-south-1.s3-website.ap-south-1.amazonaws.com
# ============================================================
set -euo pipefail
# Git Bash/MSYS silently rewrites arguments that start with "/" into Windows
# paths — disable that so SSM-style names and file:// paths survive.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

REGION="${AWS_REGION:-ap-south-1}"
PROFILE="${AWS_PROFILE:-}"
PROF=""
[ -n "$PROFILE" ] && PROF="--profile $PROFILE"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCOUNT="$(aws sts get-caller-identity $PROF --query Account --output text)"
BUCKET="eventflow-web-$ACCOUNT-$REGION"
FRONTEND_DIR="$SCRIPT_DIR/../../frontend"

step() { echo -e "\n==> $1"; }
TMP="$SCRIPT_DIR/.tmp"   # Windows-safe temp dir (Git Bash has no writable /tmp)
mkdir -p "$TMP"
# AWS CLI on Windows can't open Git Bash paths like /c/Users/... — convert.
if command -v cygpath >/dev/null 2>&1; then
  wpath() { cygpath -w "$1"; }
else
  wpath() { echo "$1"; }
fi

command -v aws >/dev/null || { echo "Missing: aws CLI"; exit 1; }
[ -f "$FRONTEND_DIR/.env" ] || { echo "Missing $FRONTEND_DIR/.env — fill it first (see .env.example)"; exit 1; }

step "Building the site (USE_MOCK_API must be false for live mode)"
grep -q "USE_MOCK_API = false" "$FRONTEND_DIR/src/api/config.js" \
  && echo "  live mode ✓" || echo "  NOTE: still in MOCK mode — site will show demo data only"

cd "$FRONTEND_DIR"
npm run build

step "Creating website bucket: $BUCKET"
aws s3api head-bucket --bucket "$BUCKET" $PROF 2>/dev/null || \
aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" $PROF

aws s3api put-public-access-block --bucket "$BUCKET" $PROF \
  --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false

cat > "$TMP/ef-web-policy.json" <<EOF
{"Version":"2012-10-17","Statement":[{"Sid":"PublicReadWeb","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::$BUCKET/*"}]}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "file://$(wpath "$TMP/ef-web-policy.json")" $PROF

step "Enabling static website hosting"
aws s3 website s3://"$BUCKET" --index-document index.html --error-document index.html $PROF

step "Uploading the build"
aws s3 sync dist/ s3://"$BUCKET" --delete --cache-control "public,max-age=300" $PROF

step "HTTPS via CloudFront (fixes 'Not secure' + mobile networks that block plain HTTP)"
WEB_HOST="$BUCKET.s3-website.$REGION.amazonaws.com"
DIST_ID=$(aws cloudfront list-distributions $PROF --query "DistributionList.Items[?Origins.Items[0].DomainName=='$WEB_HOST'].Id | [0]" --output text | tr -d '\r\n')
if [ -z "$DIST_ID" ] || [ "$DIST_ID" = "None" ]; then
  cat > "$TMP/ef-cdn.json" <<EOF
{
  "CallerReference": "eventflow-web-$ACCOUNT-$REGION",
  "Comment": "EventFlow web (HTTPS)",
  "Enabled": true,
  "Origins": {"Quantity": 1, "Items": [{
      "Id": "eventflow-web-s3",
      "DomainName": "$WEB_HOST",
      "CustomOriginConfig": {"HTTPPort": 80, "HTTPSPort": 443, "OriginProtocolPolicy": "http-only"}
  }]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "eventflow-web-s3",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}},
    "ForwardedValues": {"QueryString": false, "Cookies": {"Forward": "none"}},
    "MinTTL": 0, "DefaultTTL": 300, "MaxTTL": 300,
    "Compress": true
  },
  "CustomErrorResponses": {"Quantity": 1, "Items": [
      {"ErrorCode": 404, "ResponseCode": "200", "ResponsePagePath": "/index.html", "ErrorCachingMinTTL": 60}
  ]},
  "Aliases": {"Quantity": 0},
  "PriceClass": "PriceClass_200",
  "HttpVersion": "http2",
  "ViewerCertificate": {"CloudFrontDefaultCertificate": true},
  "Restrictions": {"GeoRestriction": {"RestrictionType": "none", "Quantity": 0}}
}
EOF
  DIST_ID=$(aws cloudfront create-distribution --distribution-config "file://$(wpath "$TMP/ef-cdn.json")" $PROF --query 'Distribution.Id' --output text | tr -d '\r\n')
  echo "  creating distribution $DIST_ID — live in ~5 min"
else
  echo "  reusing distribution $DIST_ID — refreshing cache"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" $PROF >/dev/null
fi
DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" $PROF --query 'Distribution.DomainName' --output text | tr -d '\r\n')
HTTPS_URL="https://$DIST_DOMAIN"

cat <<DONE

============================================================
  EventFlow website deployed ✔ (HTTPS)
  Share this link:  $HTTPS_URL
  (padlock 🔒 included; old http link $URL still works on
   some networks — use the https one for phones/judges)
============================================================
DONE
