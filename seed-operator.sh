#!/bin/bash
# Recreate Tapasita operator - run after data loss
cd /home/travel-tool

curl -s -X POST http://localhost/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"operator@tapasita.com","password":"DriftTest2026!","role":"operator"}' > /dev/null

TOKEN=$(curl -s -X POST http://localhost/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"operator@tapasita.com","password":"DriftTest2026!"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')

curl -s -X POST http://localhost/api/v1/operators \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"business_name":"Tapasita Nusa Penida","description":"Authentic tapas restaurant on Nusa Penida island.","category":"food","website":"https://tapasitapenida.com","latitude":-8.7278,"longitude":115.5440,"address":"Jl. Raya Penida, Nusa Penida","region":"Nusa Penida","country":"Indonesia"}' > /dev/null

echo "Tapasita operator created"
