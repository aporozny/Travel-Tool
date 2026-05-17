# Web App Deployment Specification

## Current Issue
- Backend: Working ✅ (port 5001)
- Web App: Built ✅ (port 3000)
- Login: Failing ❌ (CORS or configuration)

## Root Cause
We built without a deployment plan. The web app needs to communicate with the API securely.

## Architecture Options

### Option A: CORS Direct (Current, broken)
- Web app: localhost:3000
- API: localhost:5001
- Problem: CORS headers not configured correctly

### Option B: Nginx Proxy (Recommended)
- Web app served via nginx
- API requests proxied through nginx
- Single origin, no CORS issues
- More secure

### Option C: Environment-based URL
- Web app knows API location from .env
- Works for dev and prod
- Still needs CORS or proxy

## Solution: Use Nginx Proxy

### Step 1: Stop web server
Kill the Python HTTP server on port 3000

### Step 2: Configure Nginx
Update /etc/nginx/sites-available/travel-tool to serve web app on /

### Step 3: Proxy API requests
nginx /api → localhost:5001

### Step 4: Test
- Visit http://100.67.86.49
- Login should work
- All API calls proxied through nginx

## Implementation Plan
1. Kill Python server
2. Update nginx config
3. Reload nginx
4. Test login

