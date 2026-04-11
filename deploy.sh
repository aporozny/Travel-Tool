#!/bin/bash
# Travel Tool deploy script
# Run this whenever you want to push a new build live
set -e

echo "=== Travel Tool Deploy ==="

# Pull latest code
cd /home/travel-tool
git pull origin main

# Build web app
echo "Building web app..."
cd /home/travel-tool/web
npm install --silent
npm run build

# Copy to nginx root
echo "Deploying to nginx..."
rm -rf /var/www/travel-tool/*
cp -r /home/travel-tool/web/dist/* /var/www/travel-tool/

# Restart backend
echo "Restarting backend..."
cd /home/travel-tool/backend
npm install --silent
pm2 restart travel-tool-api || pm2 start "npx ts-node src/index.ts" --name "travel-tool-api"

# Reload nginx (no downtime)
nginx -s reload

echo "=== Deploy complete ==="
echo "Web: http://$(hostname -I | tr -d ' ')"
echo "API: http://$(hostname -I | tr -d ' ')/health"
