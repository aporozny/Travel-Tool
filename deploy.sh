#!/bin/bash
# Drift deploy script - run as root from /home/travel-tool
# Usage: bash /home/travel-tool/deploy.sh

set -e
cd /home/travel-tool

echo "Deploying Drift..."

# Pull latest
git pull origin main
echo "✓ Code updated"

# Backend
cd backend && npm install --silent
pm2 restart travel-tool-api
echo "✓ Backend restarted"

# Web
cd ../web && npm run build 2>&1 | grep -E "error|compiled|Done" | tail -3
cp -r dist/* /var/www/travel-tool/
nginx -s reload
echo "✓ Frontend deployed"

# Health check
sleep 5
STATUS=$(curl -s http://localhost/health | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
if [ "$STATUS" = "ok" ]; then
  echo "✓ Health check passed"
  curl -s http://localhost/health/stats | python3 -m json.tool
else
  echo "⚠ Health check failed - check pm2 logs"
fi

echo "Deploy complete."
