#!/bin/bash
# Deploys the website: pulls main, rebuilds web/dist, fixes permissions, copies the
# legal page, and checks the result. Run it on the VPS as your normal user (not root):
#
#   cd ~/projects/drift && bash deploy/deploy-web.sh
#
# Why the ownership dance: nginx needs web/dist owned by www-data, but the build
# deletes and recreates web/dist, which fails unless your own user owns it. So this
# script hands dist to you, builds, then hands it back to www-data.
#
# The build empties web/dist first. If it fails, the site is missing files until you
# fix the error and run this script again.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LEGAL_DIR="/var/www/drift/legal"
SITE_HOST="drifttravel.app"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as your normal user, not root (npm would leave root-owned files)." >&2
  exit 1
fi

step() { printf '\n== %s\n' "$1"; }
fail() { echo "FAILED: $1" >&2; exit 1; }

on_error() {
  echo >&2
  echo "Deploy stopped part way. If the build had started, the site may be missing files." >&2
  echo "Fix the error above and run this script again." >&2
}
trap on_error ERR

cd "$REPO"

step "Pull latest main"
git pull --ff-only origin main

step "Hand web/dist to $(id -un) so the build can clear it"
if [ -d web/dist ]; then
  sudo chown -R "$(id -un):$(id -gn)" web/dist
fi

step "Build the website"
if [ ! -d web/node_modules ]; then
  (cd web && npm ci)
fi
(cd web && npm run build)

step "Give web/dist back to nginx (www-data)"
sudo chown -R www-data:www-data web/dist
sudo chmod -R 755 web/dist

step "Copy the legal page"
sudo mkdir -p "$LEGAL_DIR"
sudo cp web/public/legal/privacy-terms.html "$LEGAL_DIR/privacy-terms.html"

step "Check the live site"
PAGE="$(curl -s -H "Host: $SITE_HOST" http://localhost/)" || fail "could not reach nginx on localhost"
printf '%s' "$PAGE" | grep -q "drift_consent_v1" || fail "home page is missing the consent banner script"
if printf '%s' "$PAGE" | grep -q "googleapis"; then fail "home page still loads Google Fonts"; fi

FONT="$(ls web/dist/fonts/*.woff2 2>/dev/null | head -n 1 || true)"
[ -n "$FONT" ] || fail "no font files in web/dist/fonts"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SITE_HOST" "http://localhost/fonts/$(basename "$FONT")")"
[ "$CODE" = "200" ] || fail "font file returned HTTP $CODE"

LEGAL="$(curl -s -H "Host: $SITE_HOST" http://localhost/legal/privacy-terms.html)"
printf '%s' "$LEGAL" | grep -q "Privacy Policy and Terms of Service" || fail "legal page did not load"

trap - ERR
printf '\nDone. Website deployed and checked. Open https://%s in a private window to look at it.\n' "$SITE_HOST"
