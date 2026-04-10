# Traveller

A travel ecosystem platform. Core features: operator directory, traveler profiles, bookings, reviews, and safety tracking.

## Structure

```
traveller/
├── backend/          Node.js API server
├── mobile/           iOS and Android apps
├── infrastructure/   Docker, CI/CD, deployment
└── docs/             Architecture, API specs, decisions
```

## Quick Start

```bash
# Clone and setup
git clone <your-repo-url>
cd traveller

# Start all services
docker-compose up -d

# Install backend dependencies
cd backend && npm install

# Start backend in dev mode
npm run dev
```

## Tech Stack

- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL (primary), Redis (cache/sessions)
- Mobile: React Native (iOS + Android from one codebase)
- Infrastructure: Docker, GitHub Actions
- Auth: JWT + refresh tokens
