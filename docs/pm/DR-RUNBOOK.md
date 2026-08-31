# Disaster Recovery / Recreation Runbook — Drift (drifttravel.app)

Purpose: rebuild the entire production stack from a bare Linux box + this repo + backups. No other context required.

## 1. Architecture map

```
Internet → Cloudflare Tunnel (drifttravel.app) → nginx :80 (host)
   nginx serves:  /            → static SPA from  web/dist
                  /api/*       → proxy http://localhost:5001  (traveller-backend)
Docker (compose in repo root):
   traveller-backend       node/express  host :5001 → container :5000
   traveller-voice-worker  LiveKit Agents worker (Node 24, no exposed port -- registers outbound
                            to LiveKit Cloud). Separate Dockerfile.voiceWorker: Node 24 not the
                            main backend's Node 20, slim/glibc not alpine/musl (@livekit/rtc-node's
                            native FFI bindings require glibc). Shares the backend's package.json/
                            node_modules build context but is a distinct image.
   traveller-postgres      postgis/postgis:15-3.3   host :5432, db=traveller_dev user=traveller
   traveller-redis         redis:7-alpine           host :6379
Uploads volume: /var/www/drift/uploads  →  /app/uploads in backend

External services the stack depends on (Stage 7/10/11): LiveKit Cloud (voice agent transport +
telephony number), Anthropic API (voice agent LLM), ElevenLabs API (voice agent TTS), Duffel API
(flight/hotel search+booking). All degrade to "inactive, not crash-looping" if their API key is
unset -- see each service's own fail-closed guard, not a DR concern on its own, but relevant if a
key needs regenerating after a compromise.
```

## 2. Secrets & config locations (values NOT stored here)
| Item | Where it lives |
|---|---|
| **`docker-compose.yml` env values** (JWT_SECRET, JWT_REFRESH_SECRET, GOOGLE_PLACES_API_KEY, VIATOR_API_KEY, VIATOR_API_BASE, FOURSQUARE_API_KEY, DUFFEL_API_KEY, ANTHROPIC_API_KEY, VOICE_AGENT_LLM_MODEL, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, VOICE_WEBHOOK_SECRET, SAFETY_REVIEWER_EMAIL, SAFETY_REVIEWER_PHONE, SENDGRID_*, MOBILEMESSAGE_*, APP_URL, FRONTEND_URL) | **`.env` at the repo root** (`/home/andre/projects/drift/.env`, gitignored) — this is what `docker-compose.yml`'s `${VAR}` substitution actually reads. Corrected here: this table previously said `backend/.env`, which is wrong for anything Docker-deployed — `backend/.env` only matters for `npm run dev` outside Docker. VIATOR/FOURSQUARE/DUFFEL/ANTHROPIC/ELEVENLABS/LIVEKIT keys are all optional at the infrastructure level — each dependent feature (activities booking, flights/stays booking, voice agent) fails closed (503/idle, not crash-looping) if its key is unset, not a deploy blocker. VIATOR_API_BASE defaults to production `https://api.viator.com/partner`; sandbox is `https://api.sandbox.viator.com/partner`. |
| Cloudflare tunnel credentials | `/root/.cloudflared/b754118f-….json`; config `/etc/cloudflared/config.yml` |
| nginx site | `/etc/nginx/sites-enabled/drift` |
| Google Cloud console (key regen) | Google account of project owner. **GOOGLE_PLACES_API_KEY is currently in the public repo's git history** (Stage 8, I13) even though it's no longer in the current file — rotation still pending as of Stage 8. |
| LiveKit / Duffel / Anthropic / ElevenLabs consoles (key regen) | Project owner's accounts on each platform |

If the root `.env` is lost: regenerate JWT secrets (users must re-login), regenerate every third-party key from its own console. Nothing in `.env` is recoverable from a backup by design (gitignored, not in the Postgres dump).

## 3. Backups
| What | Where | Schedule | Mechanism |
|---|---|---|---|
| Postgres dump (`drift_YYYYMMDD_HHMMSS.dump`) | `~/backups/drift-db/` | daily 02:00 | root cron → `~/backups/drift-db/backup.sh` |
| Whole-repo snapshots | `~/backups/*.tar.gz` (assorted) | manual | tar |
| Code | GitHub `aporozny/Travel-Tool` (private) | on push | git |

**Verify a backup before you need it:** `pg_restore --list ~/backups/drift-db/<latest>.dump | head` — last checked 2026-08-30 against `drift_20260830_020002.dump`: valid CUSTOM-format archive, 343 TOC entries, 52 tables with data, `pg_dump` version matches the live server (15.4). This confirms the archive is structurally sound and restorable; it doesn't by itself prove a full restore-into-scratch-DB-and-boot-the-app cycle succeeds end-to-end — that's a heavier test worth doing before actually needing this in anger, not just before this note was written.

## 4. Full rebuild procedure

```bash
# 0. Prereqs: docker + compose, nginx, cloudflared, node 20+ (for web build)
git clone git@github.com:aporozny/Travel-Tool.git drift && cd drift

# 1. Restore secrets → .env at repo root, NOT backend/.env  (see §2)

# 2. Data layer
docker volume create postgres_data
docker compose up -d postgres redis
# restore latest dump:
docker cp ~/backups/drift-db/<latest>.dump traveller-postgres:/tmp/d.dump
docker exec traveller-postgres pg_restore -U traveller -d traveller_dev --clean --if-exists /tmp/d.dump

# 3. Backend
docker compose up -d --build backend
curl -s localhost:5001/health   # expect {"status":"ok",...}

# 3b. Voice worker (Stage 7) -- only registers with LiveKit if
# LIVEKIT_URL/API_KEY/API_SECRET are set; otherwise idles cleanly, safe to
# always run this step regardless of whether voice is configured yet.
docker compose up -d --build voice-worker
docker logs traveller-voice-worker --tail 5   # expect "registered worker" or the idle message, not a crash loop
# If the Safety Line phone number changes, re-run (idempotent):
#   cd backend && npx ts-node scripts/setupSip.ts '+1XXXXXXXXXX'

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
- `/home/backups/` is **not** a Drift backup path (correcting a previous version of this doc) — it's `dev_pipeline_*.sql`, a completely different project's dump. Drift's only backups are the two rows in §3 above.
- **2026-08-30**: found `/etc/nginx/sites-enabled/drift` had become a real file, not a symlink to `sites-available/drift` as step 5 of the rebuild procedure above assumes — it had silently drifted out of sync (missing the I22 cache-control fix, the `/health/` proxy, and the real `server_name` list). Re-synced and converted back to a proper symlink. If you ever edit the live nginx config directly again, `ls -la /etc/nginx/sites-enabled/drift` first — it must show `-> /etc/nginx/sites-available/drift`, not a regular file, or edits to `sites-available` silently won't take effect.
- Added `/legal/` (2026-08-30): serves `/var/www/drift/legal/*.html` directly (`location ^~ /legal/` in the nginx site config, `^~` needed so it isn't shadowed by the `.html` regex location below it) — deliberately outside `web/dist` so an `npm run build` (which wipes `dist/`) can't take it offline. Currently holds the Privacy Policy/Terms of Service draft (v0.2, DRAFT banner intact, linked from signup).
- Both `Dockerfile` and `Dockerfile.voiceWorker` share one `package.json`, whose `postinstall` (`scripts/patchAnthropicPlugin.js`, Stage 7 — patches `@livekit/agents-plugin-anthropic` to allow disabling Claude's extended thinking) needs `scripts/` copied into the build context *before* any `npm install`/`npm ci` in *every* stage of *both* Dockerfiles. Missing this fails the build outright (`npm ci` exits 1) rather than silently — see I19/L9. If adding a new Docker stage or a new service sharing this `package.json`, copy `scripts/` first.
- `traveller-voice-worker` deliberately uses a different Node major version (24, not the main backend's 20) and a different base distro (`slim`/glibc, not `alpine`/musl) — `@livekit/rtc-node`'s native FFI bindings need glibc. Don't "simplify" these to match the main Dockerfile without re-testing; see STAGE-PLAN-7.md WP7.4 for why each diverges.
- nginx sets explicit `Cache-Control` on `web/dist` (2026-08-23, I22/L11): `index.html` and the SPA fallback are `no-cache, must-revalidate` (must always be revalidated — it's what points at the current bundle hash), hashed `bundle.*.js`/`.css` are `max-age=31536000, immutable` (safe forever — the filename changes every build). Before this, nginx sent no cache header at all and browsers heuristically cached `index.html`, so a real deployed change could stay invisible in a user's own browser indefinitely. If the site config is ever regenerated from scratch, this needs re-adding — verify with `curl -s -D - -o /dev/null https://drifttravel.app/ | grep -i cache-control` after any change to the nginx site file.
