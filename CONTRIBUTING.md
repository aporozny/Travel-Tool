
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
