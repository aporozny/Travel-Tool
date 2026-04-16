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
for container in traveller-postgres traveller-redis traveller-backend; do
  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "$(timestamp) ${container} down - restarting" >> $LOG
    docker-compose up -d 2>> $LOG || true
    break
  fi
done
