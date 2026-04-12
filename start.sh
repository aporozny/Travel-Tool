#!/bin/bash
# Drift startup script - run as root
# Usage: bash /home/travel-tool/start.sh

set -e

echo "Starting Drift platform..."

# Start nginx
if ! pgrep -x nginx > /dev/null; then
  nginx
  echo "✓ nginx started"
else
  echo "✓ nginx already running"
fi

# Start Redis if not running
if ! pgrep -x redis-server > /dev/null; then
  redis-server --daemonize yes
  echo "✓ Redis started"
else
  echo "✓ Redis already running"
fi

# Start PostgreSQL if not running
if ! pg_isready -h localhost -U traveller -q 2>/dev/null; then
  pg_ctlcluster 16 main start
  echo "✓ PostgreSQL started"
else
  echo "✓ PostgreSQL already running"
fi

# Start PM2 and resurrect saved processes
if pm2 list | grep -q "online"; then
  echo "✓ PM2 processes running"
else
  pm2 resurrect
  echo "✓ PM2 processes resurrected"
fi

# Verify
sleep 3
curl -s http://localhost/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✓ API healthy: {d[\"status\"]}')" 2>/dev/null || echo "⚠ API not responding"

echo "Done."
