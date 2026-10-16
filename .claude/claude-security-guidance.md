# Travel-Tool security rules

Project-specific rules for the security-guidance plugin's reviews. Built-in rules already cover generic injection, XSS and SSRF.

## Data this app holds
- Traveler PII, live location history, SOS/safety events, and identity-verification records. Never log these in full, return them to users other than their owner, or include them in error messages.
- `location_history` has a retention policy (migration 035). Code that reads it must not widen the retention window or skip the cleanup job.

## Auth and authorization
- Every non-public Express route must sit behind `authenticate` (`backend/src/middleware/authenticate.ts`). Roles are `traveler`, `operator` and `admin`.
- Authorization lives in the Express layer, not in Postgres (no RLS). A query that loads a booking, trip, SOS event or profile by id must also scope by the caller's user id or role. Treat a missing ownership check as IDOR.
- Operators may only modify their own listing (`operators.user_id` is UNIQUE). Admin-only endpoints must check `role === 'admin'`.

## Webhooks and payments
- Webhook routes (Duffel, Tripgic and others in `routes/webhooks.ts`) must use `requireWebhookSecret` or verify the provider signature over the **raw body** before parsing or acting.
- Flight payments (`services/flightPayments.ts`) and Stripe flows: amounts, currency and markup come from the server (`markupRules`), never from the client. Treat a client-supplied price used for charging as critical.
- Never retry order or payment creation blindly. Retries must be idempotent (idempotency key or a prior-state check).

## SQL
- All queries go through `pool.query` with `$n` parameters. String-built SQL using any request-derived value is critical, including `ORDER BY` and column names, which must come from an allowlist.

## Secrets and voice
- Secrets come only from environment variables: Duffel, Stripe, SendGrid, Twilio/SIP trunk, LiveKit, ElevenLabs, Anthropic, JWT and ENCRYPTION_KEY. Flag any literal key, or any secret written to logs or returned in a response.
- The SOS voice line (LiveKit plus a Twilio Elastic SIP trunk, `src/voiceWorker/`, `scripts/setupSip*.ts`): outbound dialing must only target numbers derived from the user's own emergency contacts or configured responders, never an arbitrary number from request input (toll-fraud risk).

## Web client
- `web/` keeps the JWT in `localStorage` (known, pre-existing). Flag any new XSS sink (`dangerouslySetInnerHTML`, unescaped HTML from API data), because XSS there means token theft.
