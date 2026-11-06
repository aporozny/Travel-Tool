#!/bin/bash
# Drift watchdog - runs every 5 minutes via cron
LOG="/var/log/drift-watchdog.log"
timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

# Check nginx
if ! curl -s http://localhost/health > /dev/null 2>&1; then
  echo "$(timestamp) nginx down - restarting" >> $LOG
  systemctl restart nginx 2>> $LOG || true
fi

# Check Docker containers
cd /home/travel-tool
for container in traveller-postgres traveller-redis traveller-backend traveller-voice-worker; do
  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "$(timestamp) ${container} down - restarting" >> $LOG
    docker-compose up -d 2>> $LOG || true
    break
  fi
done

# Safety Line voice worker. It once went silent for days: calls connected but
# nothing answered, because a pooled process had died (ERR_IPC_CHANNEL_CLOSED).
# Restart it when those errors show up, at most once per 15 minutes. The log
# window is 10 minutes, so an old error cannot trigger a second restart.
# Optional: put DRIFT_ALERT_WEBHOOK=<n8n webhook url> in /etc/drift-watchdog.env
# to get a message each time it restarts the worker.
[ -f /etc/drift-watchdog.env ] && . /etc/drift-watchdog.env
VW=traveller-voice-worker
STAMP=/var/tmp/drift-voice-restart
if docker ps --format '{{.Names}}' | grep -qx "$VW"; then
  if docker logs --since 10m "$VW" 2>&1 | grep -q -E 'ERR_IPC_CHANNEL_CLOSED|job executor is unresponsive|job process orphaned'; then
    last=$(cat "$STAMP" 2>/dev/null || echo 0)
    now=$(date +%s)
    if [ $((now - last)) -gt 900 ]; then
      echo "$(timestamp) voice worker unhealthy - restarting" >> $LOG
      echo "$now" > "$STAMP"
      docker restart "$VW" >> $LOG 2>&1 || true
      if [ -n "$DRIFT_ALERT_WEBHOOK" ]; then
        curl -s -m 10 -X POST -H 'Content-Type: application/json' \
          -d '{"text":"Drift Safety Line voice worker was unhealthy and has been restarted"}' \
          "$DRIFT_ALERT_WEBHOOK" > /dev/null 2>&1 || true
      fi
    fi
  fi
fi
