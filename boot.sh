#!/bin/bash
# Drift boot script - runs on container start
LOG="/var/log/drift-boot.log"
echo "$(date) - Boot starting" >> $LOG

# Wait for system
sleep 3

# PostgreSQL - must start first
pg_ctlcluster 16 main start 2>> $LOG || true
sleep 5

# Verify PostgreSQL
if ! PGPASSWORD=traveller psql -U traveller -d traveller_dev -h localhost -c "SELECT 1" > /dev/null 2>&1; then
  echo "$(date) - PostgreSQL failed to start" >> $LOG
else
  echo "$(date) - PostgreSQL running" >> $LOG
fi

# Redis
redis-server --daemonize yes --logfile /var/log/redis/redis-server.log 2>> $LOG || true
sleep 2

# nginx
nginx 2>> $LOG || true

# PM2
export PM2_HOME=/root/.pm2
/usr/lib/node_modules/pm2/bin/pm2 resurrect 2>> $LOG || true

echo "$(date) - Boot complete" >> $LOG
