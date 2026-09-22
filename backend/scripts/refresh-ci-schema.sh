#!/bin/bash
# Regenerate backend/src/utils/schema.sql from the live database, for CI to build its test
# database from. Run this after applying a new migration to production, and commit the result.
#
# Why a dump instead of hand-maintaining schema.sql, or replaying migrations/*.sql: this schema
# file went stale for months (last touched April) while 39 migrations were applied by hand to
# production, and migrations 008-020 were never saved as files at all -- so schema.sql plus
# every migration file in this repo still cannot reconstruct the real production schema. A dump
# of the live database is correct by construction; it does not depend on every migration ever
# applied having been saved.
#
# Usage (from the VPS, where the live database is reachable):
#   backend/scripts/refresh-ci-schema.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

CONTAINER=${TRAVELLER_POSTGRES_CONTAINER:-traveller-postgres}
DB=${TRAVELLER_DB:-traveller_dev}
OUT=backend/src/utils/schema.sql

echo "Dumping $DB from $CONTAINER..."
docker exec "$CONTAINER" pg_dump -U traveller -d "$DB" --schema-only --no-owner --no-privileges > "$OUT"

echo "Verifying it builds cleanly in a scratch database..."
docker exec "$CONTAINER" psql -U traveller -d traveller_dev -c 'DROP DATABASE IF EXISTS schema_refresh_check;' -c 'CREATE DATABASE schema_refresh_check;' >/dev/null
docker cp "$OUT" "$CONTAINER:/tmp/schema_refresh_check.sql"
docker exec "$CONTAINER" psql -U traveller -d schema_refresh_check -v ON_ERROR_STOP=1 -f /tmp/schema_refresh_check.sql >/tmp/schema_refresh_check.log 2>&1
docker exec "$CONTAINER" psql -U traveller -d traveller_dev -c 'DROP DATABASE schema_refresh_check;' >/dev/null

echo "OK: $OUT refreshed and verified ($(wc -l < "$OUT") lines). Review the diff, then commit it."
