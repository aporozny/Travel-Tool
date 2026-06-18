
## Database schema notes

### operators table
- `user_id` has a UNIQUE constraint — one user per operator listing
- To add operator listings programmatically, create a dedicated system user first
- System users use `password_hash = 'system'` and role = 'operator'
- Pre-created system users: tapasita@drifttravel.app, penidaproject@drifttravel.app, operators@drifttravel.app

### places_cache table
- Primary key is `id` (UUID), unique constraint is on `(external_id, source)`
- `source = 'google_places_v2'` = new Places API (has working photos)
- `source = 'google'` or `'google_places'` = old format (photos broken, filtered out of recommendations)
- Recommendations query filters to `source = 'google_places_v2'` only
- `expires_at` must be > NOW() or places won't appear — run UPDATE if all expired
- `country` defaults to 'Indonesia' — Albania places set to 'Albania'

### users table  
- Roles: traveler, operator, admin
- sarah.chen@drifttest.com is the admin test account
- operators@drifttravel.app is a system operator account (user_id: 2f08328d-8f50-4615-8224-1d6c8d1b5950)

### Docker postgres volumes — CRITICAL (recurring incident)

There are THREE postgres volumes on the VPS and they have caused data-loss scares twice:
- `postgres_data` — the volume the LIVE `traveller-postgres` container currently mounts (has users/travelers/operators)
- `drift_postgres_data` — has the seeded places (1705 rows) and a NEWER places_cache schema
- `travel-tool_postgres_data` — legacy from the original /home/travel-tool project

**The danger:** which volume the container mounts depends on the docker-compose project name / working directory at `up` time. A restart from the wrong directory, or an unpinned volume, can silently mount a DIFFERENT volume — making the database look "wiped" when the data is actually safe in another volume.

**Before assuming data loss, ALWAYS check which volume is mounted and what's in the others:**
```bash
# what is the live container actually mounted on?
docker inspect traveller-postgres --format '{{ range .Mounts }}{{ .Name }} -> {{ .Destination }}{{ "\n" }}{{ end }}'

# list all postgres volumes
docker volume ls | grep -i post

# probe another volume READ-ONLY without touching the live stack:
docker run --rm -d --name probe -v <VOLUME>:/var/lib/postgresql/data -e POSTGRES_PASSWORD=probe postgis/postgis:15-3.3
sleep 8
docker exec probe psql -U traveller -d traveller_dev -c "SELECT source, count(*) FROM places_cache GROUP BY source;"
docker stop probe
```

**Cross-volume schema differs:** `drift_postgres_data`'s places_cache has `claimed_at` + `last_fetched_at`; the live `postgres_data` table has `updated_at`. Never restore a dump directly across them — load into a staging table matching the dump, then `INSERT … SELECT` only the shared columns.

**TODO (root fix, not yet done):** pin docker-compose.yml to ONE named external volume so the container can never land on the wrong one. Do NOT delete any volume until the canonical one is confirmed and backed up.

### Redis recommendation cache gotcha
Recommendations are cached per user under `rec:<userId>:<category>:<region>` with a 1-hour TTL (see services/recommendations.ts). If places_cache is empty when a user first requests recommendations, an EMPTY result gets cached for an hour. After fixing/seeding places, clear the cache or results stay empty:
```bash
docker exec traveller-redis redis-cli --scan --pattern "rec:*" | xargs -r -I{} docker exec traveller-redis redis-cli DEL "{}"
```

### Postgres MUST stay compose-managed (root cause of repeated data scares)

**Never start postgres with a plain `docker run`.** Always bring it up via docker-compose:
```bash
cd /home/andre/projects/drift && docker-compose up -d
```

Why: a hand-run container has no `com.docker.compose.*` labels, so docker-compose can't manage it.
It then refuses to replace it (name conflict), and worse, the running container can end up on a
DIFFERENT volume than docker-compose.yml declares — so the next clean `docker-compose up` mounts
the wrong (stale) volume and the database appears wiped. This caused multiple "data loss" incidents
that were actually wrong-volume mounts.

**Verify postgres is compose-managed:**
```bash
docker inspect traveller-postgres --format '{{ json .Config.Labels }}' | grep compose
```
Must show `com.docker.compose.project: drift`. If it shows ONLY postgis image labels, the container
is hand-run and must be recreated via compose (stop+rm the container — the external volume keeps the
data — then `docker-compose up -d --no-deps postgres`).

**Canonical volume:** `postgres_data` (declared `external: true` in docker-compose.yml). This is the
volume with live data. Two orphan volumes exist (`drift_postgres_data`, `travel-tool_postgres_data`) —
do NOT mount or delete them without checking contents first (see volume-probe procedure above).

### Backups
- Daily automated: cron `0 2 * * *` runs /home/andre/backups/drift-db/backup.sh (2am AEST), keeps 7 days.
- Manual backup any time: `/home/andre/backups/drift-db/backup.sh`
- Restore (custom format): `docker exec -i traveller-postgres pg_restore -U traveller -d traveller_dev --clean --if-exists --no-owner < /path/to/dump`
- To VERIFY a backup without touching live: restore into a throwaway `postgres:15` container
  (NOT postgis — it crashes on restore) and count rows. Operators table needs postgis so it will
  error on plain postgres; judge by users/places_cache/travelers counts.
