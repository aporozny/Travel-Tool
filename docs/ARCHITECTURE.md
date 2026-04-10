# Traveller Platform Architecture

## Overview

Traveller is a travel ecosystem platform. The initial market is Bali. Core pillars:

1. Operator directory (discovery)
2. Traveler profiles and preferences
3. Bookings
4. Reviews
5. Safety tracking

## System Architecture

```
┌─────────────────────────────────────────┐
│           Mobile App (React Native)      │
│           iOS + Android                  │
└─────────────────┬───────────────────────┘
                  │ HTTPS
                  ▼
┌─────────────────────────────────────────┐
│           Backend API (Node.js)          │
│           Express + TypeScript           │
│           Port 5000                      │
│                                          │
│  Routes:                                 │
│  /api/v1/auth        Auth & tokens       │
│  /api/v1/travelers   Traveler profiles   │
│  /api/v1/operators   Operator directory  │
│  /api/v1/bookings    Booking management  │
│  /api/v1/safety      Safety tracking     │
└───────┬─────────────────────┬───────────┘
        │                     │
        ▼                     ▼
┌───────────────┐   ┌─────────────────────┐
│  PostgreSQL   │   │  Redis               │
│  (PostGIS)    │   │  Sessions / cache    │
│               │   │  Rate limiting       │
│  Primary DB   │   │  Location pub/sub    │
└───────────────┘   └─────────────────────┘
```

## Data Model Summary

Users can be travelers or operators.

Travelers have: profile, preferences, bookings, safety contacts, location history.

Operators have: business profile, tier (free/basic/premium), location (geospatial), bookings, reviews.

Bookings connect travelers to operators. Reviews attach to completed bookings.

Safety: location stored with 30-day expiry, emergency contacts, SOS events, consent records.

## Tech Decisions

PostgreSQL over MongoDB:
- Relational data (users, bookings, reviews) fits SQL well
- PostGIS gives proper geospatial queries for operator search by location
- Strong ACID guarantees for bookings and payments

Redis:
- Session storage (JWT refresh tokens)
- Rate limiting
- Real-time location pub/sub for safety tracking

React Native over native:
- Single codebase for iOS and Android
- Faster to ship
- Sufficient for the feature set

## API Conventions

- All routes prefixed with /api/v1/
- Auth via Bearer token (JWT)
- Dates in ISO 8601 (UTC)
- Errors return { status: 'error', message: '...' }
- Success returns the resource or { status: 'ok' }

## Environment Stages

- development: local Docker
- staging: replica of production, used for testing
- production: live

## Monetisation (Operator Tiers)

| Feature              | Free | Basic | Premium |
|----------------------|------|-------|---------|
| Directory listing    | Yes  | Yes   | Yes     |
| Photo gallery        | 3    | 10    | Unlimited |
| Booking requests     | No   | Yes   | Yes     |
| Analytics dashboard  | No   | Basic | Full    |
| Priority placement   | No   | No    | Yes     |
| Review responses     | No   | Yes   | Yes     |
