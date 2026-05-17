# Drift Platform - Startup & Recovery

## Automatic Startup
After server reboot, Drift starts automatically via systemd.

### Check Status
```bash
sudo systemctl status drift
```

### Manual Start (if needed)
```bash
/home/andre/projects/drift/start-drift.sh
```

## Services
- Docker: postgres, redis, backend
- Nginx: reverse proxy & static files
- All start in correct order with health checks

## Verify Everything Works
```bash
# Test backend
curl http://localhost:5001/health

# Test web app
curl http://localhost/

# Test login
curl -X POST http://localhost/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jake.morrison@drifttest.com","password":"DriftTest2026!"}'
```

## Logs
```bash
# Docker services
docker-compose logs -f backend

# Nginx
sudo tail -f /var/log/nginx/error.log
```

## Stop All Services
```bash
docker-compose down
sudo systemctl stop nginx
```

