
## Issue 2: Permission Denied (500 Error)
**Date:** May 17, 2026
**Symptom:** 500 Internal Server Error when visiting web app
**Error:** `stat() "/home/andre/projects/drift/web/dist/index.html" failed (13: Permission denied)`

### Root Cause
Nginx (running as www-data) cannot read files in `/web/dist/` due to permission restrictions.

### Solution
```bash
sudo chown -R www-data:www-data /home/andre/projects/drift/web/dist
sudo chmod -R 755 /home/andre/projects/drift/web/dist
sudo systemctl reload nginx
```

### Verification
```bash
curl http://localhost/ | head -5  # Should show HTML
```

### Prevention
Add to start-drift.sh to fix permissions automatically:
```bash
sudo chown -R www-data:www-data /home/andre/projects/drift/web/dist
sudo chmod -R 755 /home/andre/projects/drift/web/dist
```

