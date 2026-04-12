#!/bin/bash
# Run this on container boot
# Add to /etc/rc.local or Proxmox container startup hooks

sleep 5  # Wait for network

# PostgreSQL
pg_ctlcluster 16 main start 2>/dev/null || true
sleep 3

# Redis
redis-server --daemonize yes --logfile /var/log/redis/redis-server.log 2>/dev/null || true

# nginx
nginx 2>/dev/null || true

# PM2
export PM2_HOME=/root/.pm2
/usr/lib/node_modules/pm2/bin/pm2 resurrect 2>/dev/null || true

echo "Drift boot complete" >> /var/log/drift-boot.log
