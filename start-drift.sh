#!/bin/bash
set -e

echo "🚀 Starting Drift Travel Platform..."

cd /home/andre/projects/drift

echo "1. Starting Docker services..."
docker-compose up -d

echo "2. Waiting for services to be ready..."
sleep 10

echo "3. Checking backend health..."
for i in {1..30}; do
  if curl -s http://localhost:5001/health > /dev/null 2>&1; then
    echo "   ✅ Backend is ready"
    break
  fi
  echo "   Waiting... ($i/30)"
  sleep 1
done

echo "4. Checking database..."
PGPASSWORD=traveller psql -U traveller -d traveller_dev -h localhost -c "SELECT 1" > /dev/null 2>&1 && echo "   ✅ Database is ready"

echo "5. Starting nginx..."
sudo systemctl start nginx

echo ""
echo "✅ Drift Platform is running!"
echo ""
echo "Services:"
echo "  • Backend API: http://100.67.86.49:5001/api/v1"
echo "  • Web App: http://100.67.86.49"
echo "  • Database: localhost:5432"
echo "  • Redis: localhost:6379"
