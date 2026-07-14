# Disaster Recovery / Recreation Runbook — Drift (drifttravel.app)

Purpose: rebuild the entire production stack from a bare Linux box + this repo + backups. No other context required.

## 1. Architecture map

```
Internet → Cloudflare Tunnel (drifttravel.app) → nginx :80 (host)
   nginx serves:  /            → static SPA from  web/dist
                  /api/*       → proxy http://localhost:5001  (traveller-backend)
Docker (compose in repo root):
   traveller-backend   node/express  host :5001 → container :5000
   traveller-postgres  postgis/postgis:15-3.3   host :5432, db=traveller_dev user=traveller
   traveller-redis     redis:7-alpine           host :6379
Uploads volume: /var/www/drift/uploads  →  /app/uploads in backend
```

## 2. Secrets & config locations (values NOT stored here)
| Item | Where it lives |
|---|---|
| Backend env (JWT_SECRET, JWT_REFRESH_SECRET, GOOGLE_PLACES_API_KEY, VIATOR_API_KEY, VIATOR_API_BASE, FOURSQUARE_API_KEY, FETCH_DAILY_BUDGET, SENDGRID_*, MOBILEMESSAGE_*, DATABASE_URL, REDIS_URL, APP_URL, FRONTEND_URL, UPLOAD_DIR) | `backend/.env` on host (gitignored) + `docker-compose.yml` environment block. VIATOR/FOURSQUARE keys are optional — discovery degrades to Google-only without them. VIATOR_API_BASE defaults to production `https://api.viator.com/partner`; set to `https://api.sandbox.viator.com/partner` for a sandbox key. |
| Cloudflare tunnel credentials | `/root/.cloudflared/b754118f-….json`; config `/etc/cloudflared/config.yml` |
| nginx site | `/etc/nginx/sites-enabled/drift` |
| Google Cloud console (key regen) | Google account of project owner |

If `backend/.env` is lost: regenerate JWT secrets (users must re-login), regenerate Google/SendGrid/MobileMessage keys from their consoles.

## 3. Backups
| What | Where | Schedule | Mechanism |
|---|---|---|---|
| Postgres dump (`drift_YYYYMMDD_HHMMSS.dump`) | `~/backups/drift-db/` | daily 02:00 | root cron → `~/backups/drift-db/backup.sh` |
| Whole-repo snapshots | `~/backups/*.tar.gz` (assorted) | manual | tar |
| Code | GitHub `aporozny/Travel-Tool` (private) | on push | git |

**Verify a backup before you need it:** `pg_restore --list ~/backups/drift-db/<latest>.dump | head`

## 4. Full rebuild procedure

```bash
# 0. Prereqs: docker + compose, nginx, cloudflared, node 20+ (for web build)
git clone git@github.com:aporozny/Travel-Tool.git drift && cd drift

# 1. Restore secrets → backend/.env  (see §2)

# 2. Data layer
docker volume create postgres_data
docker compose up -d postgres redis
# restore latest dump:
docker cp ~/backups/drift-db/<latest>.dump traveller-postgres:/tmp/d.dump
docker exec traveller-postgres pg_restore -U traveller -d traveller_dev --clean --if-exists /tmp/d.dump

# 3. Backend
docker compose up -d --build backend
curl -s localhost:5001/api/health   # expect OK

# 4. Frontend
cd web && npm ci && npm run build && cd ..   # outputs web/dist (nginx serves in place)

# 5. nginx  (copy site config if missing, then)
sudo ln -sf /etc/nginx/sites-available/drift /etc/nginx/sites-enabled/drift
sudo nginx -t && sudo systemctl reload nginx

# 6. Cloudflare tunnel (config §2; DNS already points at tunnel)
sudo systemctl enable --now cloudflared
curl -sI https://drifttravel.app | head -1   # expect 200
```

## 5. Routine operations
| Task | Command |
|---|---|
| Deploy backend change | `cd ~/projects/drift && docker compose up -d --build backend` |
| Tail backend logs | `docker logs -f traveller-backend` |
| Rollback | `git revert <sha> && docker compose up -d --build backend` |
| Manual DB dump | `docker exec traveller-postgres pg_dump -U traveller -Fc traveller_dev > dump.dump` |
| Watchdog / boot | root cron: `@reboot /home/travel-tool/boot.sh`, `watchdog.sh` every 5 min |

## 6. Known coupling / gotchas
- `postgres_data` volume is `external: true` — compose will not create it; step 2 does.
- Backend container mounts `./backend/src` (dev-style live mount); a *code* change needs container restart, a *dependency* change needs `--build`.
- Host port 5001 maps to container 5000; nginx proxies to 5001.
- Uploads live outside the repo at `/var/www/drift/uploads` — include in any full backup.
- Root cron also runs a second backup at `/home/backups/backup.sh` (separate legacy path).
