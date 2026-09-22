# Drift Traveller Blog — Implementation Plan

22 Sep 2026. This builds on `docs/pm/TRAVELLER-BLOG-AND-VISITS-RECOMMENDATION.md` (the five-agent
research pass, 20 Sep) and the decisions Andre made the same day: self-hosted video, share buttons
first, rewards to be decided, an agent verifies visits and moderates, Andre and Claude review the
edge cases. This turns that into ordered engineering work, against the codebase as it stands today
(migrations to 046), and says plainly which of it is already done.

## 0. A head start nobody planned for

The recommendation's "Phase 0: repair the base" listed defects in the community feed. Most of them
were fixed this week as ordinary defect repair, before this plan existed:

| Phase 0 item | Status |
|---|---|
| Photo upload broken end to end | **Fixed** (commit `c1c2106`): route-specific body limit, nginx size and `/uploads/` route, folder permissions, magic-byte image check |
| Private posts readable by ID | **Fixed**: post detail, comments and reactions now check visibility |
| Comments/reactions 500 (schema drift: `author_id` vs `user_id`, missing `private`) | **Fixed** (migration 043) |
| `mediaUrls` accepts any string | **Fixed**: must be one of our own uploads |
| `is_hidden` ignored on comments | **Fixed** |

What is **still open** from Phase 0, and must be done before any of this goes in front of real users:

- **No EXIF/GPS stripping.** A phone photo is stored and served with its original metadata after
  only a magic-byte check — a traveller's exact home or hotel GPS coordinates would be public.
- **Blocks are not enforced on reads.** `user_blocks` exists and is used elsewhere (members list),
  but the community feed, discover and post reads never filter a blocked user out.
- **No rate limit on posting, commenting or uploading** beyond the generic 300/minute API limit.
- **Postgres and Redis are published on all interfaces** (`0.0.0.0:5432`, `0.0.0.0:6379` in
  `docker-compose.yml`). The recommendation verified they are not reachable from the internet today,
  but a feature that invites public content and public attention is the wrong time to leave that as is.
- **No moderation of any kind exists.** This is the real gate — nothing below should go live before it.

**Phase 0 remainder — size S, about 1 day**, not the 1–2 days originally scoped, since most of it is
already behind us:
1. Re-encode every uploaded image on the server (the `sharp` package) and drop all metadata before
   it is saved — `routes/community.ts`'s upload handler.
2. Add a blocked-user filter to the feed, discover and post-detail queries (`community.ts`) — an
   `EXISTS`/`NOT EXISTS` against `user_blocks` in both directions, same shape as the visibility check
   already added.
3. Add per-route rate limits: post creation (about 10/hour), comments (about 30/hour), upload (about
   20/hour — this will later share a limit with the video caps in Phase 3).
4. `docker-compose.yml`: bind Postgres and Redis to `127.0.0.1` instead of all interfaces; restart
   and confirm nothing on the VPS depends on reaching them from outside the Docker network.

## 1. Moderation (must exist before Phase 1b goes live) — size M, 1–1.5 weeks

Nothing in the recommendation's pipeline exists yet. This is the actual gate on publishing anything.

- **Schema:** `moderation_status` on `community_posts` and `post_comments` (`pending` / `allowed` /
  `held` / `blocked`, default `pending`); a new append-only `moderation_decisions` table (post or
  comment id, stage, verdict, categories, quoted span, reason, reviewer's answer, policy version,
  timestamp). Feed, discover and post reads show only `allowed` content, plus the author's own
  regardless of status.
- **`services/moderation.ts`:** stage 0 rule checks (phone numbers, emails, ID numbers, a spam-link
  list); stage 1 OpenAI's free moderation endpoint on text and each image; stage 2 Claude (Haiku,
  escalating to Sonnet on an unclear case) against a written policy, treating the post's own text as
  untrusted data, returning categories, the quoted span, a plain reason and one specific question for
  a person. **Fail closed:** any stage erroring leaves the post `pending`, never silently `allowed`.
- **Review screen:** a proper admin-only screen in the React app, not an extension of the existing
  `admin.html` (which the recommendation flagged as unsafe — it builds HTML from unescaped text).
  Lists pending items with the agent's question and short-answer buttons; `POST
  /admin/moderation/:id/decide` records the verdict and flips the post or comment's status.
- **Reporting:** `POST /community/posts/:id/report` and the same for comments, reusing the
  `safety_reports` table already used for member reports; three unique reporters holds a post pending
  review automatically.
- **Author experience:** a blocked author sees the category, the quoted part and the reason; the
  draft is kept; an appeal goes to a person, never back to the same model automatically.

## 2. The blog itself — size M, 1–1.5 weeks

Mostly an extension of the community feed that already works, plus one genuinely new piece: a public
page real enough for a crawler or a link preview to read, since the app is a single-page app today
with nothing server-rendered.

- **Schema:** `title` (nullable — an ordinary Feed post has none, a blog post does) and a unique
  `slug` on `community_posts`; a new `post_consents` table (post id, scope, wording version, a hash of
  the consent text, granted/withdrawn timestamps) for the separate, unticked, per-post "feature this
  on Drift's channels" consent the recommendation calls for.
- **Public page:** a small server-rendered route (`GET /blog/:slug` on the backend) that returns real
  HTML with Open Graph tags — title, image, description — for link previews and search, then hands
  off into the normal app for an actual visit. This is the one piece of infrastructure that doesn't
  exist in any form today and needs building from scratch.
- **Share buttons:** the Web Share API where available, plus direct links for Facebook, X, WhatsApp,
  LinkedIn and Pinterest — a single `ShareButtons.web.tsx` component used on both the blog page and
  ordinary Feed posts.
- **Composer:** extend `CommunityScreen`'s existing post composer with an optional "write a longer
  post" mode (title plus a longer body) and the consent toggle at publish time.

## 3. Confirmed visits and rewards — size M, 1–2 weeks, gated on two of Andre's decisions

- **Auto-confirmation** hooks into `flight_orders` and `tripgic_orders` reaching a real ticketed or
  confirmed state (not sandbox, not cancelled) — both now have working status sync as of this week,
  which this leans on directly. A later post naming that destination auto-confirms.
- **Manual path** reuses the Phase 1 review screen, with the recommendation's sample questions
  ("Receipt says X, place is Y 400 m away — same business?").
- **Reward ledger:** a table recording points per approved, confirmed post, a weekly cap, and the
  disclosed label "Contributor reward" everywhere it appears.
- **Still open, needs Andre:** the badge's exact wording ("Visit confirmed" recommended, distinct
  from the operator tick), and the reward's actual shape — points redeemable for what, since "rewards
  TBD" is still the decision on record. Both can be built as configuration, not hard-coded, so the
  answer doesn't block starting the engineering.

## 4. Video — size L, 2–3 weeks, deliberately last

Matches Andre's own call to treat this as its own later phase, and the recommendation's server
numbers (4 cores, no AVX; 0.66x realtime transcode). Resumable upload (chunked, tus), a separate
media-worker container capped at 2 CPU/2 GB, one Redis queue at concurrency 1, ffmpeg to one H.264
rendition plus a poster frame, metadata stripped, moderation extended to sample frames and transcribe
audio through the same pipeline as text. Caps per the recommendation: 500 MB/60 s source, 3 per post,
5 a day, 2 GB per user, uploads stop at 80% disk. Move public files to object storage (Cloudflare R2)
once nearing about 300 active posters or under 50 GB free disk, whichever comes first.

## Sequencing

```
Phase 0 remainder (1 day) ──► Phase 1: moderation (1–1.5 wk) ──► Phase 1b: the blog (1–1.5 wk)
                                                              └─► Phase 2: visits & rewards (1–2 wk)
                                                                          │
                                                                          ▼
                                                              Phase 3: video (2–3 wk, later)
```
Phase 1b and Phase 2 can run in parallel once moderation exists, since they touch different parts of
the schema. Total to a live, moderated text-and-photo blog with confirmed visits: **roughly 4–5
weeks** of engineering, not counting review or legal turnaround.

## Decisions still needed (trimmed from the recommendation's list — these are the ones actually
## blocking Phase 1b/2, not the ones already answered)

1. Reward shape: what do points convert to (credit, cash, nothing yet)?
2. Badge wording: "Visit confirmed", or Andre's own preference.
3. Minimum age 16 and no follows/DMs on the blog at launch (the recommendation's eSafety read)?
4. Engage a lawyer (Australian, plus Indonesian counsel) before anything with named businesses goes
   out on Drift's own channels?
5. Who answers the reviewer's questions in Indonesian, when a case needs it?

Everything else in the original nine questions (start Phase 0, hold until checked, video self-hosted
and phased) is already decided and reflected in the plan above.
