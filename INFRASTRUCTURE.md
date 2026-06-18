# Drift Infrastructure

How drifttravel.app is served to the public. Read this before changing anything network-related.

## Public access: Cloudflare Tunnel (NOT port-forward, NOT Certbot)

The VPS sits behind a gateway (172.16.128.254) we do not control. Its interface (ens18) only holds the private IP 172.16.128.83. The public IP 115.64.73.50 does outbound NAT only — there is NO inbound port-forwarding, so nothing on the public internet can reach the box directly on port 80/443.

Public access is provided by a Cloudflare Tunnel, which connects outbound from the VPS to Cloudflare. No router access or port-forwarding needed. SSL is handled automatically by Cloudflare — Certbot is NOT used and is not needed.

Traffic path:
  user -> https://drifttravel.app -> Cloudflare edge -> tunnel -> localhost:80 (nginx) -> Drift app

## Key facts

- Tunnel name: drift
- Tunnel UUID: b754118f-ba60-4062-befc-7c8802b3ba3d
- Runs as systemd service: cloudflared.service (enabled, survives reboot)
- Config file: /etc/cloudflared/config.yml (routes drifttravel.app -> http://localhost:80, catch-all http_status:404)
- Credentials: /root/.cloudflared/b754118f-...json (secret, do not commit)
- Auth cert: /root/.cloudflared/cert.pem

## DNS (Cloudflare)

- drifttravel.app is a proxied CNAME pointing at the tunnel (created by `cloudflared tunnel route dns drift drifttravel.app`).
- The old A record (drifttravel.app -> 115.64.73.50) was DELETED — it never routed inbound and is not needed.
- Do not re-add an A record for the apex; it conflicts with the tunnel CNAME.

## ICMP / connIndex flapping fix

cloudflared runs as root (GID 0). The default ping_group_range was "1 0" (empty), so the ICMP proxy could not init and one tunnel connection (connIndex=3) flapped continuously with "datagram handler" / "control stream failure" errors.

Fix (applied + persisted):
- /etc/sysctl.d/99-cloudflared-ping.conf sets: net.ipv4.ping_group_range = 0 2147483647
- After applying, restart cloudflared. All four connections then register clean.

## nginx note

nginx serves Drift from /home/andre/projects/drift/web/dist on port 80, matched by server_name drifttravel.app. The superpowers config holds `listen 80 default_server`; Drift is matched by Host header, so the tunnel (which preserves Host: drifttravel.app) lands on Drift correctly. Do not change default_server.

Config file: /etc/nginx/sites-enabled/drift (a copy is kept in the repo at deploy/nginx/drift.conf for reference — the live file is the source of truth).

REQUIRED proxy locations (both proxy_pass http://localhost:5001, URI preserved):
- location /api/    -> backend API
- location /health/ -> backend health/stats endpoint

The /health/ block is REQUIRED for the landing page stats. The frontend (LandingScreen.web.tsx) fetches /health/stats for the "Operators listed" and "Regions covered" counters. Without the /health/ proxy, nginx serves the SPA index.html for that path, the frontend's r.json() throws, the error is silently caught, and the counters fall back to "—". If those dashes reappear, check that the /health/ location block still exists in the nginx config.

WARNING: do NOT leave backup copies of the config (e.g. drift.bak) inside /etc/nginx/sites-enabled/. nginx loads sites-enabled/* (wildcard), so a backup there is parsed as a second server block and causes "conflicting server name" warnings. Keep backups outside that directory (e.g. /root/).

## DO NOT TOUCH — other services on this box

There is a SEPARATE, older cloudflared process (started ~Jun 7) running as user andre with its own --token, tunnel ID 031a2de3-77cf-4db0-82c7-404e3611e39e. This is NOT the Drift tunnel and likely serves another project. Leave it alone.

Other live services that must never be disrupted: superpowers (nginx default_server on :80), quantms.com.au, n8n, openclaw, gold-trader.

## Rollback (if tunnel ever needs removing)

1. sudo systemctl stop cloudflared && sudo systemctl disable cloudflared
2. Remove the proxied CNAME in Cloudflare for drifttravel.app
3. (Public access would then be gone — there is no port-forward fallback.)
## Frontend rebuild — IMPORTANT (photo loss risk)

The web build uses webpack with output.clean=true, which WIPES web/dist/ on every
`npm run build`. Two operator photos (penida_photo.jpg, tapasita_1.jpg) are
manually placed in dist/ and are NOT part of the build — so every rebuild deletes
them. They must be restored after each build.

Backups kept at: /root/drift-photos-backup/
Restore after build:
  cp /root/drift-photos-backup/*.jpg /home/andre/projects/drift/web/dist/

TECH DEBT: this is fragile. Proper fix is to put these images in a source location
webpack copies into the build (e.g. web/static/ via CopyWebpackPlugin), or serve
them from the backend/nginx outside dist/. Until then, always restore after build.

Build sequence that is known-safe:
  1. cp web/dist/*.jpg /root/drift-photos-backup/   (back up current photos)
  2. cd web && npm run build
  3. cp /root/drift-photos-backup/*.jpg web/dist/    (restore)
  4. hard-refresh browser (bundle filename changes each build)O

