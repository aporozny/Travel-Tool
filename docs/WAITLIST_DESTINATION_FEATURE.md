# Waitlist Destination Field

**Date:** June 24, 2026
**Status:** Shipped and verified live (commit ac0f16c)

## What this is

Captures "where do you want to travel?" at request-access time (the public
waitlist form), rather than asking it later in a welcome email. This was the
original intent: someone requesting access tells Drift their destination
before they're even approved, so the welcome email can say "we've set this
up for you" instead of asking a question that should already be answered.

## What changed

- **Migration 026**: `waitlist.destination TEXT`, nullable.
- **Backend** (`waitlist.ts`): `destination` added to the join schema,
  included in the INSERT, and exposed in the admin list query
  (`GET /api/v1/admin/waitlist`) so it's visible when reviewing requests.
- **Frontend** (`LoginScreen.web.tsx`): new field "Where do you want to
  travel?" added to the public waitlist form, between email and the submit
  button. Included in the `POST /waitlist` body.

## Live verification (June 24, 2026)

```
POST /waitlist   -> 201, entry created with destination: "Bali"
GET /admin/waitlist (as admin) -> 200, destination correctly visible
                                   alongside name/email/status
```

## What this does NOT do yet

The destination is captured and visible to the admin, but nothing yet
*uses* it automatically:

- Approving a waitlist entry still just generates an invite link. It does
  not pre-create a `member_trips` row from the captured destination.
- The actual onboarding flow (once someone registers via their invite) does
  not yet read this destination back and pre-fill anything.

For now, this is "the admin can see where someone wants to go before
approving them" - acting on that (pre-populating a trip, tailoring the
welcome email per person) is manual, or a future enhancement.
