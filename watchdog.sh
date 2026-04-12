#!/bin/bash
# Drift watchdog - runs every 5 minutes via cron
# Restarts services that have died

LOG="/var/log/drift-watchdog.log"
timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

# Check nginx
if ! curl -s http://localhost/health > /dev/null 2>&1; then
  echo "$(timestamp) nginx down - restarting" >> $LOG
  nginx 2>> $LOG || true
fi

# Check PM2 / API
if ! pm2 list 2>/dev/null | grep -q "online"; then
  echo "$(timestamp) PM2 down - resurrecting" >> $LOG
  pm2 resurrect 2>> $LOG || true
fi

# Check if API is actually responding
API_STATUS=$(curl -s http://localhost:5000/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
if [ "$API_STATUS" != "ok" ]; then
  echo "$(timestamp) API not responding - restarting" >> $LOG
  pm2 restart travel-tool-api 2>> $LOG || true
fi
