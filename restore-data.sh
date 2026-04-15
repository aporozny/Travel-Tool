#!/bin/bash
# Full data restore after data loss - run as root
set -e
cd /home/travel-tool/backend

echo "Restoring Drift data..."

PGPASSWORD=traveller psql -U traveller -d traveller_dev -h localhost -f src/utils/schema.sql
PGPASSWORD=traveller psql -U traveller -d traveller_dev -h localhost -f src/utils/migrations/001_audit_fixes.sql
PGPASSWORD=traveller psql -U traveller -d traveller_dev -h localhost -f src/utils/migrations/002_member_preferences.sql
PGPASSWORD=traveller psql -U traveller -d traveller_dev -h localhost -f src/utils/migrations/003_recommendation_engine.sql
PGPASSWORD=traveller psql -U traveller -d traveller_dev -h localhost -f src/utils/migrations/004_member_directory.sql

npx ts-node scripts/seed-members.ts
npx ts-node scripts/seed-places.ts

bash /home/travel-tool/seed-operator.sh

pm2 restart travel-tool-api

curl -s http://localhost/health/stats | python3 -m json.tool
echo "Restore complete"
