#!/bin/bash
LOG="/var/log/drift-boot.log"
echo "$(date) - Boot starting" >> $LOG
sleep 5
systemctl start nginx 2>> $LOG || true
cd /home/travel-tool
docker-compose up -d 2>> $LOG || true
echo "$(date) - Boot complete" >> $LOG
