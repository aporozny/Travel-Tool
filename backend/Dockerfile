FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
# scripts/ has to arrive before npm install/ci in every stage below --
# postinstall (patchAnthropicPlugin.js) runs during the install itself,
# and this one shared package.json (both traveller-backend and the
# voice-worker service build from it) means every stage needs this,
# not just the one that actually uses @livekit/agents-plugin-anthropic
# at runtime. Same fix already applied to Dockerfile.voiceWorker; missed
# here until the backend service's own rebuild caught it.
COPY scripts ./scripts

FROM base AS development
RUN npm install
COPY . .
CMD ["npm", "run", "dev"]

FROM base AS builder
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
