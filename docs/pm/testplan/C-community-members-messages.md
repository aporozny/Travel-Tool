# Drift test plan C: Community, Members, Messages, Who's-going, Photos

Scope: `web/src/screens/CommunityScreen.web.tsx` (913), `MembersScreen.web.tsx` (518), `MessagesScreen.web.tsx` (300), `WhosGoingPanel.tsx` (318, note: it lives in `screens/`, not `components/`), backend `routes/community.ts` (487), `members.ts` (566), `messages.ts` (205), `photos.ts` (77), services `memberPlaces.ts`, `consent.ts`, `notifications.ts`, plus the wiring in `AppShell.web.tsx` and `index.ts`.

Method: code read on the VPS (`/home/andre/projects/drift`), schema read with `\d` in `traveller-postgres` (db `traveller_dev`), live nginx config read (`/etc/nginx/sites-enabled/drift`), and `EXPLAIN` (plan only, no execution, fake UUIDs, no data read) of the SQL the routes use to prove which columns and constraints exist. No API was called, nothing was clicked, nothing was changed.

Evidence key: **CONFIRMED-CODE** = proven from source and live schema/config; **RUNTIME** = code strongly suggests it but a live or staging run is needed to see the exact behaviour.

Test data used in the cases (create on staging, not production):
- U-A: traveler, onboarding done, `show_in_directory=true`, `community_participation` includes `meet_members`, Trip Mode off.
- U-B: same as U-A, accepted connection with U-A. U-C: same, pending request sent to U-A. U-D: pending request sent BY U-A. U-E: declined connection with U-A. U-F: blocked by U-A.
- U-G: `content_sharing_comfort='private'`. U-H: `show_in_directory=false`. U-I: onboarding incomplete. U-N: brand new user, no connections. U-O: operator account.
- Posts: public, connections-only (API only), `is_hidden=true` (DB), `is_deleted=true`, post by U-F, post with media.

---

## 1) Screen and control inventory

### 1a) Community feed (`CommunityScreen.web.tsx`)

| Control | File:line | Does what | API call |
|---|---|---|---|
| Discover toggle (default) | CommunityScreen:111-116 | sets mode discover, reloads | GET /community/discover (no params sent; server default page=1 limit=20) |
| Following toggle | CommunityScreen:117-122 | sets mode feed, reloads | GET /community/feed (no params) |
| "+ Post" button | CommunityScreen:104 | opens ComposeModal | none |
| WhosGoingPanel embed | CommunityScreen:126-128 | renders the panel (no `region` prop) | see 1d |
| Three empty "Who is going" wrapper divs | CommunityScreen:130-136 | dead markup, no controls | none |
| Loading dot / empty state / post list | CommunityScreen:140-163 | spinner, "Nothing here yet", or PostCard list; on API error the list is left as is and no error is shown | reads `res.data` as array |
| Reaction buttons x4 (like, fire, heart, wave) | CommunityScreen:245-256 | POST react then full list reload | POST /community/posts/:id/react body `{reaction}`; UI reads nothing from the response |
| Reaction total | CommunityScreen:257-259 | shows `reaction_count` | field `reaction_count` |
| Highlight of my reaction | CommunityScreen:249 | uses `post.my_reaction` | field `my_reaction` |
| Comment button | CommunityScreen:262-265 | opens CommentsModal, label = `comment_count` or "Comment" | none |
| Post images (max 3, not clickable) | CommunityScreen:217-231 | `<img src=media[i]>` | field `media` (string[]) |
| Place tag pill | CommunityScreen:234-239 | shows `place_name` | field `place_name` |
| Avatar circle | CommunityScreen:199 | initials only, `avatar_url` never used | none |

### 1b) Compose modal and comments modal (same file)

| Control | File:line | Does what | API call |
|---|---|---|---|
| Backdrop click | CommunityScreen:421 | closes modal, discards draft, no confirm | none |
| Close X | CommunityScreen:425 | closes modal | none |
| Body textarea (maxLength 2000, autofocus) | CommunityScreen:428-435 | text | none |
| Camera button + hidden file input (image/*, multiple) | CommunityScreen:550-564, 310-328 | FileReader base64, uploads each file, max `5 - images.length` per pick | POST /community/upload body `{data: base64, mimeType}`; reads `res.data.url` |
| Thumbnail remove X | CommunityScreen:447-450 | removes URL from local list | none |
| Place search input (350 ms debounce) | CommunityScreen:467-472, 330-350 | live place search | GET /search params `{q, limit:6, region?}`; reads `res.data.results[].id/name/category` |
| Place result row | CommunityScreen:479-486, 352-357 | selects place | none |
| "Can't find it? Add the place" (row and link) | CommunityScreen:491-503 | opens add-place form | none |
| Add place: name input, category select (4 options), address input | CommunityScreen:509-530 | collects new place | none |
| Add place: "Find" button | CommunityScreen:531-537, 359-372 | geocodes address | GET /search/geocode params `{address}`; reads `latitude, longitude, name, country` |
| Selected place chip X | CommunityScreen:463, 374-381 | clears place | none |
| Region select (15 fixed values) | CommunityScreen:567-576 | region | none (sent on submit) |
| Post button | CommunityScreen:579-588, 383-418 | validates, submits, closes, reloads | POST /community/posts body `{body?, region?, mediaUrls[], visibility:'public', placeId? or newPlace{name,lat,lng,category}?}`; UI ignores the response |
| Comments: list on open | CommunityScreen:602-606 | loads comments | GET /community/posts/:id/comments; reads `id, body, display_name` |
| Comments: input (Enter submits) | CommunityScreen:655-661 | text | none |
| Comments: Send button | CommunityScreen:662-668, 608-621 | posts then reloads list | POST /community/posts/:id/comments body `{body}` then GET comments |
| Comments: backdrop / X | CommunityScreen:624, 628 | closes | none |
| NOT PRESENT | n/a | visibility picker, edit post, delete post, delete comment, save/bookmark, share, report post, block from post, load more/pagination, region/category filters, image lightbox | n/a (see D-C-16) |

### 1c) Members (`MembersScreen.web.tsx`) and AppShell badges

| Control | File:line | Does what | API call |
|---|---|---|---|
| Tab Directory / Upcoming trips / Connections | MembersScreen:342-347 | switch tab, Connections click also refetches | tab effect :209-213 calls GET /members, GET /members/trips, or GET /members/my/connections |
| Pending badge on Connections tab | MembersScreen:346, 185 | count of received+pending | GET /members/my/connections on mount :216 |
| Filter: timing select (4 options) | MembersScreen:354-360 | `next_trip` param | GET /members?next_trip= |
| Filter: region select (6 options) | MembersScreen:361-366 | `region` param | GET /members?region= |
| Filter: activity select (7 options) | MembersScreen:367-372 | `activity` param | GET /members?activity= |
| Member card (click) | MembersScreen:53 | opens detail view from list row (no fetch) | none (detail does NOT call GET /members/:userId) |
| Card "Connect" button | MembersScreen:97, 218-234 | sends request with shared `connectMsg` | POST /members/:userId/connect body `{message: connectMsg}` |
| Card state labels (Request sent / Wants to connect / Connected) | MembersScreen:99-107 | display only; nothing for `declined` | none |
| Detail: Back to members | MembersScreen:240 | clears selected | none |
| Detail: intro textarea (max 500) | MembersScreen:309-315 | sets shared `connectMsg` | none |
| Detail: "Send connection request" | MembersScreen:316-321 | same handler as card Connect | POST /members/:userId/connect |
| Detail: state labels | MembersScreen:324-329 | pending / accepted only | none |
| Connections list rows | MembersScreen:408-445 | status label; for received+pending shows buttons | reads `id, status, direction, other_display_name, other_regions` |
| Accept button | MembersScreen:431-435, 192-198 | accept | PATCH /members/connections/:id body `{status:'accepted'}` |
| Decline button | MembersScreen:436-440 | decline | PATCH /members/connections/:id body `{status:'declined'}` |
| Trip cards (not interactive) | MembersScreen:113-143, 457 | show public trips | GET /members/trips; reads `member_name, destination, region, start_date, end_date, looking_for, notes, budget_range, water_activities` |
| AppShell nav badges (Members, Messages), 15 s poll | AppShell:47-63, 80-81 | pending count and unread count | GET /members/my/connections, GET /messages/unread/count |
| NOT PRESENT | n/a | name search, budget/style filters, pagination, message-from-profile, block/report on profile, unblock, cancel request, disconnect, open profile from Connections or Trips tab | n/a (D-C-14, D-C-15, D-C-16) |

### 1d) Messages (`MessagesScreen.web.tsx`) and Who's-going (`WhosGoingPanel.tsx`)

| Control | File:line | Does what | API call |
|---|---|---|---|
| Conversation list (10 s poll) | MessagesScreen:153-173 | lists conversations | GET /messages; reads `partner_id, other_name, other_avatar, created_at, sender_id, body, unread_count` |
| Conversation row click | MessagesScreen:27-28, 175-181 | opens thread, zeroes unread locally | none |
| "+ New" button / "Start a conversation" button | MessagesScreen:236-240, 252-256 | opens connections picker | none |
| New-message back arrow | MessagesScreen:196 | back to list | none |
| New-message connection row | MessagesScreen:207, 183-186 | starts thread with `other_user_id` | GET /members/my/connections (filter accepted) on mount :161-166 |
| Thread back arrow | MessagesScreen:98, 229 | leaves thread, refetches list | GET /messages |
| Thread load + 8 s poll | MessagesScreen:57-70 | loads messages, marks read server side | GET /messages/:userId; reads `messages[], other_user` |
| Message input (Enter sends, maxLength 2000) | MessagesScreen:128-135 | text | none |
| Send button | MessagesScreen:136-139, 76-88 | sends, appends optimistic row | POST /messages body `{recipient_id, body}`; reads `id, body, created_at, sender_id` |
| Empty states (two overlapping blocks) | MessagesScreen:16-23 and 248-258 | duplicate "No messages yet" | none |
| Panel: "I'm going" / Cancel | WhosGoingPanel:132-134 | toggles trip form | none |
| Panel: mode buttons "Planned trips" / "Near you now" | WhosGoingPanel:139-144 | switch mode | GET /members/nearby?radius_km=10 when near mode |
| Panel: destination, region, start, end, notes inputs | WhosGoingPanel:189-202 | trip form | none |
| Panel: "Share trip" | WhosGoingPanel:204-206, 90-111 | saves trip | POST /members/trips body `{destination, region?, start_date?, end_date?, notes?, is_public:true}` |
| Panel: list load | WhosGoingPanel:48-54 | loads trips | GET /members/trips (optional `?region=`, never passed) |
| Panel: "+N more" / Show less | WhosGoingPanel:235-237 | expand list beyond 3 | none |
| Panel: "Be the first" | WhosGoingPanel:245-247 | opens form | none |
| Panel: "Turn on" (Trip Mode) | WhosGoingPanel:152, useTripMode:50-64 | enables Trip Mode then reloads nearby | POST /safety/location/trip-mode `{enabled:true}`, later POST /safety/location; then GET /members/nearby |
| Panel: nearby Report | WhosGoingPanel:169-170, 69-78 | `window.prompt` then report | POST /safety/reports body `{reportedTravelerId: user_id, category:'safety_concern', description}` |
| Panel: nearby Block | WhosGoingPanel:171-172, 80-85 | `window.confirm` then block | POST /members/:userId/block (204) |
| Panel mounted in Trips > Travelers | TripsScreen:160 | same panel | same |

### 1e) Photos proxy

| Control | File:line | Does what | API call |
|---|---|---|---|
| Google place photo `<img>` (Explore) | ExploreScreen:18-21 | builds `/api/v1/photos?ref=` | GET /photos?ref=&w= (no auth) |

Counts: 69 control rows in this inventory (each row is one control or a small group of identical controls), plus 2 rows listing controls that are absent. Test cases: 148.

---

## 2) API contract check

| UI call | Backend route file:line | Match? | Problem |
|---|---|---|---|
| GET /community/discover | community.ts:122 | PARTIAL | Route has no `authenticate`/`optionalAuth` (line 122) so `req.user` is always undefined (line 126) and `my_reaction` is always null: the highlighted reaction never shows in the default tab. UI never sends `page/limit/region`, so only the first 20 posts are ever reachable. Filters `visibility='public'` only. Never filters `is_hidden` or blocked authors. |
| GET /community/feed | community.ts:52 | PARTIAL | Only `visibility='public'` (line 94), so connections-only posts never show even to accepted connections. `OR cp.region ILIKE $4` (line 102) widens instead of narrowing. No block filter. `parseInt(limit)` NaN or negative gives 500 (line 55, 109). |
| POST /community/posts/:id/react `{reaction}` | community.ts:325-355 | **BROKEN** | `INSERT ... ON CONFLICT (post_id, user_id, reaction)` (line 346) but the only unique constraint is `post_reactions_post_id_user_id_key (post_id, user_id)`. Live `EXPLAIN` returned: "there is no unique or exclusion constraint matching the ON CONFLICT specification". Every add returns 500. The delete/toggle branch (lines 337-342) is unreachable because no row can ever be inserted. Even if the target were fixed, one row per user per post means clicking a second emoji would need a switch, not a toggle. |
| POST /community/posts `{body, region, mediaUrls, visibility:'public', placeId or newPlace}` | community.ts:179-263 | PARTIAL | Field names match zod (lines 21-42). `body` is optional in zod (line 22) but `community_posts.body` is NOT NULL with CHECK length 1..2000, so media-only posts 500 (line 228 inserts `null`). `visibility` zod allows `private` (line 40) but DB CHECK allows only `public, members, connections`; `private` gives 500 and `members` gives 400. `operatorId` and `mediaUrls` are trusted (lines 39, 41, 230, 239). New place is created (line 203) before the post insert (line 223), so a failed insert leaves an orphan place that counts against the daily limit of 5. |
| POST /community/upload `{data, mimeType}` | community.ts:423-456 | **BROKEN** | Three independent blockers: (1) `express.json({limit:'10kb'})` at index.ts:49, so any real photo as base64 is rejected with 413 (errorHandler turns it into a 413 with the text "Internal server error"). (2) Container runs as user `node` (Dockerfile:29, `id` = uid 1000) but `/app/uploads` is `root:root 755` (checked with `ls -ld`), and the host dir `/var/www/drift/uploads` is empty, so `fs.writeFileSync` (line 448) would throw EACCES and return 500 even with a small body. (3) Live nginx `sites-enabled/drift` has no `client_max_body_size` (default 1 MB) in `/api/` and no `/uploads/` location: `try_files $uri /index.html` returns the SPA HTML for `/uploads/x.jpg`, so a stored image would render as a broken image. UI swallows the error (CommunityScreen:322-324). |
| GET /community/posts/:id/comments | community.ts:360-382 | **BROKEN** | SQL uses `pc.author_id` (lines 367, 371, 372) but `post_comments` has `user_id`, not `author_id`. Live `EXPLAIN`: "column pc.author_id does not exist". Always 500. UI `.catch(console.error)` (CommunityScreen:605) then shows "No comments yet. Be the first." which is misleading. Also no visibility/hidden/block check and no auth. |
| POST /community/posts/:id/comments `{body}` | community.ts:385-402 | **BROKEN** | `INSERT INTO post_comments (post_id, author_id, body)` (line 390): live `EXPLAIN`: column "author_id" of relation "post_comments" does not exist. Always 500. No post existence/visibility check. |
| DELETE /community/posts/:postId/comments/:commentId (no UI) | community.ts:405-417 | **BROKEN** | Uses `author_id` (line 409): 500. Even when fixed it answers success when nothing matched. Not called by any UI. |
| DELETE /community/posts/:id (no UI) | community.ts:306-320 | OK (unused) | Soft delete, owner only, 404 otherwise. No UI calls it. |
| GET /community/posts/:id (no UI) | community.ts:266-303 | **BROKEN (security)** | No auth, no `visibility`, `is_hidden`, or block check (line 291 only `is_deleted=FALSE`): returns connections-only posts to anyone including anonymous users. |
| GET /community/posts (ProfileScreen:22) | community.ts:459-487 | OK | Own posts (or `memberId` public posts). `memberId` non-UUID gives 500; no block check. |
| GET /search `{q, limit:6, region?}` | search.ts:27-58 | OK | Returns `results[]` (`searchCache.ts` catalog rows include `id`, `name`, `category`, `region`, RUNTIME to confirm exact keys). Region defaults to "Bali" when omitted (search.ts:16). Each call can trigger paid live top-ups; limited to 60/min by `searchRateLimit`. |
| GET /search/geocode `{address}` | search.ts:65-89 | OK | Returns `latitude, longitude, name, country`, 404 when unresolved (UI shows message at CommunityScreen:368). |
| GET /members `{region, activity, next_trip}` | members.ts:50-157 | OK | Response `{members, total}`; UI reads `.members`. Filter keys used by UI match onboarding option keys (OnboardingScreen:260-278, 437). `travel_style`, `budget`, `limit`, `offset` supported but not sent. Not block-aware. Anonymous access allowed (`optionalAuth`). `limit` NaN gives 500. |
| GET /members/my/connections | members.ts:161-186 | OK | UI reads `id, status, direction, other_user_id, other_display_name, other_avatar, other_regions`, all returned. INNER JOIN on `member_preferences` and `travelers` drops rows whose partner lacks those rows. |
| GET /members/trips | members.ts:188-246 | OK | Excludes the caller's own trips (line 232-236). Returns `mt.*` plus `member_name, avatar_url, budget_range, water_activities`. |
| POST /members/:userId/connect `{message}` | members.ts:369-420 | OK | 400 self, 404 not in directory, 409 if any row exists (including `declined`), 201 `{id,status,created_at}`. No block check. |
| PATCH /members/connections/:id `{status}` | members.ts:459-485 (duplicate at 492-518) | OK | Recipient only, pending only. The route is registered twice (dead duplicate). |
| GET /members/:userId (no UI) | members.ts:312-361 | OK but unused | Returns `upcoming_trips`, but the UI never calls it (D-C-15). |
| POST /members/:userId/block | members.ts:426-441 | OK | 204. Unknown user id gives FK 500. Effect is limited to `/nearby` and message sending. |
| DELETE /members/:userId/block (no UI) | members.ts:444-455 | OK but unused | No unblock control exists. |
| GET /members/nearby?radius_km=10 | members.ts:255-310 | OK | Returns `user_id, member_name, avatar_url, member_style, destination, distance_km (rounded km)`. Needs a cached location for the caller (line 259-262), else 400 "Turn on Trip Mode...". |
| POST /members/trips | members.ts:537-563 | OK | `notes` max 500 and `destination` max 100 enforced by zod; UI textarea has no `maxLength`, and any failure shows the generic "Could not save trip." |
| POST /safety/reports `{reportedTravelerId: user_id, category, description}` | safety.ts:594-660 | **BROKEN** | `safety_reports.reported_traveler_id` is a FK to `travelers(id)`. The panel sends `users.id` (`/members/nearby` returns `u.id AS user_id`, members.ts:271; `travelers.id` is a separate `uuidv4()`, auth.ts:88). FK violation gives 500 and the alert "Could not submit report". |
| GET /messages | messages.ts:15-71 | OK | Runs two queries; the first (lines 17-35) is discarded and does an N-squared self join. `EXPLAIN` of both parses. Fields used by UI are returned. Inner joins `travelers`. |
| GET /messages/:userId | messages.ts:75-133 | PARTIAL | Requires accepted connection (403 otherwise). `ORDER BY created_at ASC LIMIT 100` (lines 111-112) returns the OLDEST 100, so after 100 messages new ones never appear. Malformed UUID gives 500. No block check (blocker can still read). |
| POST /messages `{recipient_id, body}` | messages.ts:137-189 | OK | Validates connection and block, inserts `connection_id`. Blocked send returns 403 but UI shows nothing (MessagesScreen:86). `.min(1)` runs before `.trim()`, so whitespace-only body can pass (RUNTIME). |
| GET /messages/unread/count | messages.ts:193-204 | OK | `{count}`; route order is safe because it has two path segments. Counts unread from blocked users. |
| GET /photos?ref=&w= | photos.ts:21-77 | PARTIAL | `decodeURIComponent(ref)` (line 29) is outside `try`; on `ref=%25` it throws URIError inside an async Express 4 handler with no `express-async-errors` and no `unhandledRejection` handler anywhere in `backend/src`, which on Node 20 terminates the process (RUNTIME to confirm, do not test on production). |
| Unused/absent backend | n/a | n/a | No endpoints exist for: edit post, save/bookmark a post (`toggleSave` supports only operator/place, recommendations.ts:764), report a post, share, cancel/withdraw request, disconnect. |

---

## 3) Test cases

Legend for Expected: text in [brackets] describes what the code does today when it differs from intent; "FAILS TODAY" links to a defect. Priority P1/P2/P3.

### 3a) Feed (load, tabs, filters, pagination)

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| C-001 | Feed load | U-A logged in, at least 3 public posts | 1) Open Feed (nav). 2) Click Community/Feed tab. | Default tab is Discover; GET /community/discover fires; cards show name, region pill, time-ago, body, images (max 3), place tag; loading dot clears | P1 | UI | CommunityScreen:55-76, 139-163 |
| C-002 | Feed empty | No public posts in DB | 1) Open Discover. | "Nothing here yet" + "Be the first to post something." | P3 | UI | CommunityScreen:144-152 |
| C-003 | Tabs | U-N (no connections, no posts) | 1) Click Following. | GET /community/feed; empty text "Connect with other members to see their posts here." | P2 | UI | CommunityScreen:117-122, 149-151 |
| C-004 | Following scope | U-A with accepted U-B, pending U-C, stranger post | 1) Click Following. | Shows own posts and U-B's public posts only; not U-C's, not strangers | P1 | Security | community.ts:95-101 |
| C-005 | Visibility | U-B has a `connections` post (insert via API), U-A accepted with U-B | 1) Open Following. | Post should be visible to connection. [FAILS TODAY: query is `visibility='public'` only] | P2 | Edge | community.ts:94; D-C-8 |
| C-006 | Blocked author | U-A blocked U-F; U-F has public post | 1) Open Discover and Following. | U-F posts hidden in both. [FAILS TODAY: no block filter in feed or discover] | P1 | Security | community.ts:57-111, 128-167; D-C-13 |
| C-007 | Hidden/deleted | Posts with `is_hidden=true` and `is_deleted=true` | 1) Open Discover. | Neither shown. [`is_hidden` is not filtered: it shows] | P2 | Security | community.ts:93, 157; D-C-6 |
| C-008 | Tab race | Slow network throttle | 1) Click Discover/Following 10 times quickly. 2) Wait. | Final list matches the active toggle (no stale overwrite) | P3 | Edge | CommunityScreen:61-76 (no abort) |
| C-009 | Error state | Block /api/v1/community/discover (devtools) or force 500 | 1) Reload Community. | User should see an error with retry. [Shows "Nothing here yet" with no error] | P3 | Edge | CommunityScreen:71-73; D-C-17 |
| C-010 | Pagination UI | 25+ public posts | 1) Scroll to bottom of Discover. | A way to load more. [None: only first 20 ever reachable] | P2 | UI | CommunityScreen:68-70; D-C-16 |
| C-011 | Pagination API | 25+ posts, valid token | 1) GET /community/discover?page=2&limit=20. 2) Repeat page=1. | Page 2 returns the next 5, no overlap with page 1, stable order | P2 | API | community.ts:124-125 |
| C-012 | Param validation | Valid token | 1) GET /community/feed?limit=-1. 2) ?limit=abc. 3) ?page=0. 4) ?limit=100000. | 400 or clamped (max ~50). [Today negative/NaN give 500, huge limit is honoured] | P3 | Validation | community.ts:54-55, 124-125; D-C-29 |
| C-013 | Region filter | Posts in Ubud and Canggu | 1) GET /community/discover?region=Ubud. 2) GET /community/feed?region=Ubud. | Discover only Ubud. Following only Ubud from network. [Feed ORs region so it adds all Ubud public posts from strangers] | P3 | API | community.ts:102, 158; D-C-26 |
| C-014 | Ranking | Post X new with 0 reactions, older posts with reactions | 1) Create post X. 2) Look at Discover. | New post visible after posting. [Ranked by engagement first so it can fall below the first 20] | P2 | Edge | community.ts:161; D-C-27 |
| C-015 | Anonymous access | No token | 1) GET /community/discover. 2) GET /community/feed. | Discover 200 with `my_reaction` null; Feed 401 | P2 | Security | community.ts:52, 122 |
| C-016 | Token refresh | Access token expired, refresh valid | 1) Open Community. | 401 then silent refresh then posts load; if refresh fails user is sent to "/" | P2 | Edge | api.web.ts:37-56 |
| C-017 | Card rendering | Post with 1, 2, 4 images; post with no display name; 2000-char body; 2000 chars with no spaces | 1) View each in Discover. | 1 image full width; max 3 thumbs; name shows "Drift Member" and initials "?"; long text wraps, no horizontal scroll | P3 | Edge | CommunityScreen:192-231 |
| C-018 | Time format | Posts 10 s, 5 min, 3 h, 2 d old | 1) View. | "just now", "5m ago", "3h ago", "2d ago" | P3 | UI | CommunityScreen:677-686 |
| C-019 | Refresh mid-flow | On Following tab | 1) Reload browser. | App reopens on Explore (default tab), no error; navigating back to Feed reloads Discover | P3 | Edge | AppShell:40 |

### 3b) Create post, upload, place tagging

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| C-020 | Compose open | U-A | 1) Click "+ Post". | Modal opens, textarea focused, Post disabled and dimmed | P1 | UI | CommunityScreen:104, 428-435, 585 |
| C-021 | Validation empty | Modal open | 1) Type only spaces "   ". | Post stays disabled | P1 | Validation | CommunityScreen:384, 585 |
| C-022 | Text post | Modal open | 1) Type "Great dive today". 2) Click Post. | Button shows "..."; POST /community/posts returns 201; modal closes; list reloads; post visible in Following (Discover per ranking) | P1 | UI | CommunityScreen:383-403 |
| C-023 | Double submit | Modal open with text | 1) Double-click Post quickly. | Exactly one post created (button disabled while submitting) | P1 | Edge | CommunityScreen:585 |
| C-024 | Max length | Modal open | 1) Paste 2001 chars. | Textarea holds 2000. Direct API with 2001 chars returns 400 "Validation error" | P2 | Validation | CommunityScreen:433; community.ts:22 |
| C-025 | API validation | Valid token | 1) POST /community/posts `{}`. 2) `{body:""}`. 3) `{visibility:"x"}`. | 400 each ("Post must have text or media" / "Validation error") | P2 | API | community.ts:183-185, 21-42 |
| C-026 | Region | Modal open | 1) Type text. 2) Pick region "Ubud". 3) Post. | Card shows "Ubud" pill | P2 | UI | CommunityScreen:567-576, 203-205 |
| C-027 | Visibility rules | Valid token | 1) POST posts with `visibility:"connections"`. 2) with `"private"`. 3) with `"members"`. | connections: 201. private: should be accepted or rejected cleanly. [Today 500 (DB check allows only public/members/connections)]. members: [400 from zod]. UI has no picker and always sends `public` | P1 | Validation | community.ts:40; CommunityScreen:391; D-C-5 |
| C-028 | Draft discard | Modal open with text | 1) Click dark backdrop. | Should confirm before discarding. [Closes silently and loses the draft] | P3 | Edge | CommunityScreen:421 |
| C-029 | Keyboard | Modal open | 1) Press Escape. 2) Tab through controls. | Modal should close on Escape and trap focus. [Escape does nothing, no trap] | P3 | UI | CommunityScreen:420-425 |
| C-030 | Server error text | Force 500 (e.g. media-only via API) | 1) Submit. | Friendly error. [alert shows raw "Internal server error"] | P3 | Edge | CommunityScreen:405-414 |
| C-031 | Media-only post | Once upload works, or direct API with `mediaUrls:["/uploads/a.jpg"]` and no body | 1) Attach photo only. 2) Post. | 201 and card with image only. [FAILS TODAY: body NULL violates NOT NULL, 500] | P1 | Validation | community.ts:228; D-C-4 |
| C-032 | Photo add small | U-A, 5 KB jpg | 1) Click camera. 2) Pick file. | Thumbnail appears via POST /community/upload 201. [FAILS TODAY: file write EACCES as user node, image URL not served] | P1 | UI | CommunityScreen:310-328; D-C-3 |
| C-033 | Photo add real | U-A, 2 MB phone photo | 1) Pick file. | Thumbnail appears. [FAILS TODAY: base64 (~2.7 MB) exceeds express 10kb limit (413) and nginx default 1 MB; UI shows nothing] | P1 | UI | index.ts:49; nginx sites-enabled/drift /api/; D-C-3 |
| C-034 | Photo too big | 12 MB file | 1) Pick file. | Clear message "too large (max 10MB)". [nginx 413 or express 400, no UI feedback] | P2 | Validation | community.ts:441-443 |
| C-035 | Photo type | Files: png, webp, heic, gif, svg, pdf renamed .jpg | 1) Pick each. | png/webp/jpg accepted; heic accepted but browsers cannot render; gif/svg/avif get 400 "Invalid image type" and the user should be told. [No feedback] | P2 | Validation | community.ts:428-435; D-C-36 |
| C-036 | Photo count | 7 files | 1) Pick all 7 at once. 2) Pick 3 then 3 more quickly. | First pick caps at 5. Second: total must not exceed 5. [Stale `images.length` allows 6 and the post returns 400] | P2 | Edge | CommunityScreen:312; community.ts:41 |
| C-037 | Thumbnail remove | 2 photos attached | 1) Click X on first. 2) Post. | Only the second URL is sent | P2 | UI | CommunityScreen:447-450 |
| C-038 | Post during upload | Slow network | 1) Pick photo. 2) Type text and click Post before thumbnail shows. | Post waits or warns. [Posts without the photo] | P3 | Edge | CommunityScreen:314-325, 582 |
| C-039 | Photo display | Post with uploaded image | 1) View card in feed. | Image renders from `/uploads/<uuid>.jpg`. [FAILS TODAY: nginx has no /uploads location, SPA fallback returns HTML, broken image] | P1 | UI | nginx sites-enabled/drift; D-C-3 |
| C-040 | Upload API security | Tokens: none, valid | 1) POST /community/upload with no token. 2) With `data` = text, `mimeType:"image/png"`. 3) With missing fields. | 401; content not verified as image (should be rejected); 400 "data and mimeType required" | P2 | Security | community.ts:423-436 |
| C-041 | Media URL trust | Valid token | 1) POST /community/posts `mediaUrls:["https://evil.example/x.gif"]`. 2) 6 urls. | External URL should be rejected. [Accepted and rendered as `<img>`]. 6 urls: 400 | P2 | Security | community.ts:41, 239; D-C-20 |
| C-042 | Operator spoof | U-A (not an operator), an operator UUID | 1) POST /community/posts `operatorId:<other operator>`. | 403/400. [Accepted and stored] | P2 | Security | community.ts:39, 230; D-C-20 |
| C-043 | Operator author | U-O | 1) Post text. | `author_type='operator'` | P3 | API | community.ts:188-192 |
| C-044 | Place search | U-A, catalog has "Warung Made" | 1) Type "warung" in tag input. 2) Wait 350 ms. | GET /search?q=warung&limit=6; rows with name and category; "Can't find it" row shown | P2 | UI | CommunityScreen:337-350, 473-498 |
| C-045 | Place select | Results shown | 1) Click a result. 2) Post. | Chip shows name; payload has `placeId`; card shows place tag | P1 | UI | CommunityScreen:352-357, 393-394 |
| C-046 | Place no match | Query with no match | 1) Type "zzzzqq". | "No matches" and the add-place row | P3 | UI | CommunityScreen:488-490 |
| C-047 | Add new place | Region "Canggu" chosen | 1) Click "Can't find it? Add the place". 2) Name "Test Cafe", category Food. 3) Address "Jl. Pantai Berawa, Canggu", click Find. 4) See "Located". 5) Post. | POST with `newPlace{name,lat,lng,category}`; place created `source='member'`; chip shows "new"; card shows place | P1 | UI | CommunityScreen:359-372, 395-402; community.ts:198-217 |
| C-048 | New place no region | No region selected | 1) Add place and geocode. 2) Post. | alert "Pick a region before adding a new place..." and nothing is posted | P1 | Validation | community.ts:199-201; CommunityScreen:409 |
| C-049 | New place not geocoded | Name typed but Find not pressed | 1) Post. | Should warn. [Post is created with NO place, silently] | P2 | Edge | CommunityScreen:395; D-C-23 |
| C-050 | Geocode failure | Address "asdfghjkl qwerty" | 1) Click Find. | Error "Couldn't find that location..."; Find disabled when address empty or while searching | P2 | Validation | CommunityScreen:365-369, 534 |
| C-051 | Daily place limit | U-A already created 5 member places today | 1) Add a 6th and post. | alert with 429 message; no post created | P2 | Validation | memberPlaces.ts:64-71; community.ts:212-214 |
| C-052 | Dedup | U-A and U-B add the same venue within 150 m | 1) Both post with new place. | Both posts resolve to the same `places_cache.id`; no duplicate place | P2 | API | memberPlaces.ts:39-62 |
| C-053 | Orphan place | Force post insert failure (media-only body null) with a new place | 1) Post. 2) Check places count for the user. | No place should remain. [Place row created before failing insert and counts toward the daily 5] | P3 | Edge | community.ts:203 vs 223; D-C-21 |

### 3c) Reactions, comments, delete, save, report

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| C-054 | React add | U-A viewing a post by U-B | 1) Click thumbs-up. | POST /react 200 `{action:'added'}`, thumb highlighted, count +1. [FAILS TODAY: 500 (ON CONFLICT target invalid); UI silent] | P1 | UI | community.ts:344-347; D-C-2 |
| C-055 | React toggle off | Reaction exists | 1) Click same emoji again. | `{action:'removed'}`, highlight off, count -1 | P1 | UI | community.ts:337-342 |
| C-056 | React switch | Has thumbs-up | 1) Click fire. | Reaction switches to fire (one per user by DB unique) and count stays 1. [500 today; toggle code would attempt to add a second row] | P1 | Edge | community.ts:332-350; DB unique (post_id,user_id); D-C-2 |
| C-057 | React rapid | Working reaction | 1) Click one emoji 10 times fast. | Final state = odd/even parity, count never below 0, no duplicates | P2 | Edge | community.ts:332-350 (no guard) |
| C-058 | React persist Discover | Reaction added, on Discover tab | 1) Click emoji. 2) Wait for reload. | Highlight persists. [`my_reaction` always null in Discover] | P1 | UI | community.ts:122-126; D-C-7 |
| C-059 | React persist Following | On Following tab | 1) Click emoji. 2) Reload page, reopen Following. | Highlight persists (Following passes user id) | P2 | UI | community.ts:52, 91 |
| C-060 | Reaction API | Valid token | 1) POST react `{reaction:"angry"}`. 2) `{}`. 3) no token. | 400 "Invalid reaction"; default `like`; 401 | P2 | API | community.ts:327-329 |
| C-061 | React target | Ids: random UUID, deleted post, non-UUID, connections-only post of stranger | 1) POST react to each. | 404/403 each. [Random uuid: FK 500; deleted and hidden/private posts accept reactions; non-UUID 500] | P2 | Security | community.ts:325-355; D-C-29 |
| C-062 | Comments open | Post with 2 comments | 1) Click "Comment". | Modal lists oldest first with name and text. [FAILS TODAY: GET returns 500 (author_id column), modal says "No comments yet. Be the first."] | P1 | UI | community.ts:360-382; D-C-1 |
| C-063 | Comment add | Modal open | 1) Type "Nice!". 2) Click Send. | POST 201, input cleared, list reloads with the comment. [FAILS TODAY: 500, nothing happens] | P1 | UI | community.ts:385-402; CommentsModal:608-621; D-C-1 |
| C-064 | Comment Enter | Modal open | 1) Type text. 2) Press Enter twice fast. | One comment. [No `submitting` guard on Enter, so two requests] | P2 | Edge | CommunityScreen:660 vs 608-610; D-C-22 |
| C-065 | Comment validation | Modal open | 1) Type spaces only. 2) Type 1001 chars. | Send disabled for spaces. 1001: should be blocked in UI. [No `maxLength` on input; API 400, UI silent] | P2 | Validation | CommunityScreen:655-666; community.ts:44-46 |
| C-066 | Modal isolation | Posts P1 and P2 | 1) Open comments on P1, close. 2) Open on P2. | P2 comments shown, not P1 | P2 | UI | CommunityScreen:602-606 |
| C-067 | Comment delete | Own comment, another user's comment | 1) DELETE /community/posts/:p/comments/:c for each. | Own: soft deleted and count decremented; other's: 403/404. [Route 500 today (author_id); once fixed it returns success even for others' comments and count is not decremented]. No UI control | P2 | Security | community.ts:405-417; D-C-1, D-C-35 |
| C-068 | Comment target | Comment on nonexistent, hidden, connections-only, blocked-author post | 1) POST comments. | 404/403. [FK 500 or accepted] | P2 | Security | community.ts:385-402 |
| C-069 | Comments read privacy | Comments of a connections-only post, no token | 1) GET comments anonymously. | 401/404. [No check] | P2 | Security | community.ts:360-373 |
| C-070 | Comment XSS | Comment `<img src=x onerror=alert(1)>` | 1) Post it (after fix). 2) Reopen. | Shown as literal text | P2 | Security | CommunityScreen:646 |
| C-071 | Delete post | U-A owns post P, U-B does not | 1) DELETE /community/posts/P as A. 2) As B. 3) Reload feeds. | A: `{success:true}` and post gone; B: 404. No UI control exists | P2 | API | community.ts:306-320; D-C-16 |
| C-072 | Post by id privacy | Connections-only post, stranger/anonymous | 1) GET /community/posts/:id. | 403/404. [Returns 200 with full post: visibility, is_hidden, blocks ignored] | P1 | Security | community.ts:266-303; D-C-6 |
| C-073 | Own posts list | U-A, U-B | 1) GET /community/posts. 2) GET /community/posts?memberId=U-B. 3) ?memberId=abc. | Own incl. non-public; B's public only; abc should be 400 [500] | P3 | API | community.ts:459-487 |
| C-074 | Missing features | Any post | 1) Look for edit, delete, save, share, report, block on a post card. | Documented gap: none of these controls exist and no edit/save/report endpoint exists. Log against product scope | P2 | UI | CommunityScreen:187-269; D-C-16 |

### 3d) Member directory, profile, connect, connections

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| C-075 | Directory load | U-A, members U-B..U-G | 1) Open Members. | GET /members; cards with initial, city/country or "Location private", timing badge, chips, activity tags, bucket list | P1 | UI | MembersScreen:160-175, 42-111 |
| C-076 | Self exclusion | U-A logged in | 1) Open directory. | U-A not listed | P1 | Security | members.ts:98-102 |
| C-077 | Directory gating | U-G (private), U-H (hidden), U-I (no onboarding), member with no community_participation | 1) Open directory. | None of them listed | P1 | Security | members.ts:12-46 |
| C-078 | Timing filter | Members with each timing | 1) Choose each of 4 options. 2) Choose "Any timing". | GET /members?next_trip=...; only that timing; reset shows all | P1 | UI | MembersScreen:354-360 |
| C-079 | Region filter | Members with bucket regions | 1) Pick each of 6 regions. | `region` matches `bucket_list_regions` or `bali_areas_interest` | P1 | UI | MembersScreen:361-366; members.ts:67-71 |
| C-080 | Activity filter | Members with activities | 1) Pick each of 7 activities. | Matches water, land, wellness arrays | P1 | UI | MembersScreen:367-372; members.ts:73-77 |
| C-081 | Filter combos and empty | Filters with no match | 1) Combine timing+region+activity. | Empty state "No members found with those filters." with hint | P2 | UI | MembersScreen:377-381 |
| C-082 | Filter race | Slow network | 1) Change filters rapidly. | Final list matches final filters | P3 | Edge | MembersScreen:160-175 |
| C-083 | Missing filters | Directory | 1) Look for name search, budget, style filter. | Gap: backend supports `budget`, `travel_style`; UI has no control and no name search | P3 | UI | members.ts:79-95; D-C-16 |
| C-084 | Directory pagination | 25+ members | 1) Scroll. 2) GET /members?limit=50&offset=20. 3) ?limit=abc. | UI shows only first 20 (no load more). API cap 50; NaN gives 500 | P2 | API | members.ts:58-59, 121; D-C-29 |
| C-085 | Profile detail | Card of U-B | 1) Click card body. | Detail shows name, location, timing, style/budget/pace, activities, bucket list, member since | P1 | UI | MembersScreen:236-331 |
| C-086 | Profile trips | U-B has a public future trip | 1) Open U-B profile. | "Upcoming trips" section lists it. [Never shows: detail uses the list row, GET /members/:userId is never called] | P2 | UI | MembersScreen:151, 288, 389; members.ts:343-356; D-C-15 |
| C-087 | Back behaviour | Filters set, profile open | 1) Click "Back to members". | Returns to directory with filters and tab intact | P2 | UI | MembersScreen:240 |
| C-088 | Directory privacy | No token | 1) GET /members. 2) GET /members/:userId. 3) GET /members/trips. | Should require login (or expose minimal fields). [Returns home_city, home_country, preferences anonymously] | P2 | Security | members.ts:50, 188, 312; D-C-19 |
| C-089 | Profile by id gating | U-G, U-H ids | 1) GET /members/:id. 2) GET /members/notauuid. | 404 for private/hidden; 400 for bad id [500] | P2 | Security | members.ts:312-323 |
| C-090 | Connect from card | U-A, directory member U-N2 with no relation | 1) Click Connect on card. | POST connect `{message:''}` 201; card shows "Request sent"; refresh keeps it | P1 | UI | MembersScreen:97, 218-227 |
| C-091 | Connect with message | Profile open | 1) Type 500-char intro. 2) Click "Send connection request". | Button shows "Sending..."; label "Connection request sent"; textarea limit 500; API with 501 gives 400 | P1 | UI | MembersScreen:309-321; members.ts:366 |
| C-092 | Connect double click | Profile open | 1) Double-click send. | One request; second is blocked by `connecting` guard or returns 409 | P2 | Edge | MembersScreen:219 |
| C-093 | Stale message leak | Typed intro on profile of X, then back, then card-Connect on Y | 1) Type text on X, do not send. 2) Back. 3) Click Connect on Y card. | Y receives no message. [Y receives X's text: shared `connectMsg`, never cleared] | P2 | Edge | MembersScreen:154, 222; D-C-24 |
| C-094 | Connect errors | Existing row, non-directory user, self, blocked user | 1) POST connect for each. | 409 with status, 404, 400, and for blocked: 403. [Blocked accepted; UI shows nothing on 409/500] | P2 | Security | members.ts:369-420; D-C-13, D-C-17 |
| C-095 | Reverse pending | U-C sent request to U-A | 1) View U-C card as U-A. | Label "Wants to connect"; accept is possible only in Connections tab (no Accept on card/profile) | P2 | UI | MembersScreen:102-104, 324-329 |
| C-096 | Declined state | U-E declined by/of U-A | 1) View U-E card and profile. | Should show declined text or allow retry. [Nothing shown; re-connect gives 409 forever] | P2 | Edge | MembersScreen:96-107; members.ts:398-403; D-C-11 |
| C-097 | Connections tab | U-A with B (accepted), C (pending received), D (pending sent) | 1) Click Connections. | Loading text, then rows; statuses "Connected", "Wants to connect with you" + Accept/Decline, "Request sent"; badge shows 1 | P1 | UI | MembersScreen:397-447 |
| C-098 | Connections empty | U-N | 1) Click Connections. | "No connections yet." | P3 | UI | MembersScreen:402-407 |
| C-099 | Accept | Received pending from U-C | 1) Click Accept. | PATCH accepted; label "Connected"; badge decrements; U-C can now message and appears in Messages "+ New" | P1 | UI | MembersScreen:192-198, 431-435 |
| C-100 | Decline | Received pending | 1) Click Decline. | PATCH declined; row shows declined. [UI shows "Connected" because any non-pending status renders that label] | P1 | UI | MembersScreen:421-427; D-C-11 |
| C-101 | Accept double click | Two pending requests | 1) Double-click Accept on one. | Second PATCH returns 404 (status no longer pending); badge should not drop twice. [Badge decrements twice] | P3 | Edge | MembersScreen:196; members.ts:468 |
| C-102 | Connection ownership | Connection id between U-C and U-B | 1) As U-A PATCH /members/connections/:id accepted. 2) As requester PATCH own request. | 404 both (recipient only) | P1 | Security | members.ts:465-475 |
| C-103 | PATCH validation | Valid token | 1) PATCH `{status:"blocked"}`, `{}`. | 400 Validation error | P2 | Validation | members.ts:461-463 |
| C-104 | Withdraw/disconnect | Any connection | 1) Look for cancel request or remove connection. | Gap: no endpoint or UI | P3 | UI | D-C-11, D-C-16 |
| C-105 | Nav badge | U-C sends request while U-A idle | 1) Wait up to 15 s on any tab. | Members nav shows badge 1 | P2 | UI | AppShell:47-63 |
| C-106 | Trips tab | Public trips exist | 1) Click "Upcoming trips". | Cards with name, destination, dates, looking-for, notes; empty state text otherwise. No way to connect or open profile from here | P2 | UI | MembersScreen:449-460; D-C-16 |

### 3e) Block, report, safety

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| C-107 | Block nearby | U-A Trip Mode on, U-F nearby | 1) Near you now. 2) Click Block on U-F. 3) OK the confirm. | POST /members/U-F/block 204; row removed; U-F cannot see U-A nearby either | P1 | UI | WhosGoingPanel:80-85; members.ts:287-291 |
| C-108 | Block cancel | Same | 1) Click Block. 2) Cancel confirm. | No API call | P2 | UI | WhosGoingPanel:81 |
| C-109 | Block effect | U-A blocked accepted connection U-B | 1) U-A sends message to U-B. 2) U-A opens existing thread. 3) Check unread badge for U-B messages. 4) U-B connect request to U-A. 5) U-A views directory. | Send: 403 (and UI must tell the user). Thread, unread, connection request, directory and feed should all respect the block. [Only send and nearby do; UI silent on 403] | P1 | Security | messages.ts:158-167; members.ts:12-157, 369-420; D-C-13 |
| C-110 | Unblock | U-A blocked U-F | 1) Look for Unblock control. 2) DELETE /members/U-F/block. | UI has no unblock (gap); API returns 204 and U-F reappears | P2 | UI | members.ts:444-455; D-C-14 |
| C-111 | Report nearby | U-A Trip Mode, U-F nearby | 1) Click Report. 2) Enter "he followed me" (>=10). | POST /safety/reports 201; alert "Report submitted". [FAILS TODAY: FK to travelers(id) violated with a user id, 500, alert "Could not submit report"] | P1 | UI | WhosGoingPanel:69-78; safety.ts:603-618; D-C-9 |
| C-112 | Report validation | Nearby list | 1) Click Report. 2) Enter 5 chars or Cancel. | No request sent | P2 | Validation | WhosGoingPanel:71 |
| C-113 | Report API | Valid token | 1) POST /safety/reports with `reportedTravelerId` = travelers.id. 2) with users.id. 3) no target. | 201; FK error [500]; 400 | P1 | API | safety.ts:603-625 |

### 3f) Messages

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| C-114 | Inbox load | U-A with threads to B and C | 1) Open Messages. | "Loading messages..." then list ordered by latest; name, date, preview with "You: " prefix, truncated at 50 chars, unread badge | P1 | UI | MessagesScreen:145-188, 26-45; messages.ts:38-64 |
| C-115 | Inbox empty | U-N | 1) Open Messages. | Empty state with "+ New" and "Start a conversation". [Two overlapping "No messages yet" blocks are rendered] | P3 | UI | MessagesScreen:16-23, 248-258; D-C-28 |
| C-116 | New message picker | U-A with accepted B, pending C | 1) Click "+ New". | Only accepted connections listed (B); C absent; empty text when none | P1 | UI | MessagesScreen:161-166, 200-207 |
| C-117 | First message | Picker open | 1) Click B. 2) Type "hi". 3) Click send arrow. | POST /messages 201; bubble appears right-aligned; input cleared | P1 | UI | MessagesScreen:76-88; messages.ts:174-181 |
| C-118 | Send controls | Thread open | 1) Press Enter. 2) Shift+Enter. 3) Spaces only. 4) 2000 chars. | Enter sends; whitespace disabled; input caps at 2000; API 2001 gives 400 | P2 | Validation | MessagesScreen:128-139; messages.ts:8-11 |
| C-119 | Receive | B sends to A | 1) A keeps thread open. | Message appears within 8 s; if on list, within 10 s; nav badge within 15 s | P1 | UI | MessagesScreen:68, 171; AppShell:62 |
| C-120 | Unread | B sends 3 messages | 1) A views list. 2) Open thread. 3) Back. | Bold preview and badge 3; opening clears it; badge gone after refetch and nav | P1 | UI | MessagesScreen:36-41, 175-181; messages.ts:93-97 |
| C-121 | Send guard API | Valid token | 1) POST /messages to non-connected user. 2) to self. 3) bad uuid. 4) missing body. | 403; 400 "Cannot message yourself"; 400; 400 | P1 | Security | messages.ts:139-156 |
| C-122 | Isolation | A, B connected; C unrelated | 1) A GET /messages/C-id. 2) A GET /messages/B-id. 3) C GET /messages/A-id. | 403; own thread only; 403. A can never read B-C thread | P1 | Security | messages.ts:80-90 |
| C-123 | Long thread | 120 messages between A and B | 1) Open thread. 2) Send message 121. | Latest messages visible at the bottom. [Only the oldest 100 are returned so message 121 and the newest 20 never show] | P1 | Edge | messages.ts:111-112; D-C-12 |
| C-124 | Rapid send | Thread open | 1) Type "1", Enter; "2", Enter quickly x5. | All 5 sent in order once each; the `sending` guard may drop keys typed while sending, but no duplicates | P2 | Edge | MessagesScreen:77 |
| C-125 | Send failure | Offline or blocked recipient | 1) Send. | User sees an error and text stays. [Silent: text stays, no message] | P2 | Edge | MessagesScreen:86; D-C-17 |
| C-126 | Whitespace body API | Valid token | 1) POST body `"   "`. | 400. [`min(1)` runs before `trim()`, so stored as empty string, RUNTIME] | P3 | Validation | messages.ts:10; D-C-31 |
| C-127 | Message XSS | Body `<script>alert(1)</script>` | 1) Send and view. | Literal text, no execution | P2 | Security | MessagesScreen:117 |
| C-128 | Refresh in thread | Thread open | 1) Reload page. | Returns to Explore; thread state lost; no error | P3 | Edge | AppShell:40 |
| C-129 | Deactivated partner | Partner `is_active=false` | 1) Open inbox. 2) Send. | Should be hidden/blocked. [Inbox still lists; send not checked] | P3 | Edge | messages.ts:38-64, 137-189 |
| C-130 | Notifications | U-A offline | 1) B sends message or connect request. | Email/push (if intended). [No notification service is called from these routes; only in-app polling] | P3 | Edge | messages.ts (no import); D-C-32 |

### 3g) Who's-going panel

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| C-131 | Panel load | Trips exist | 1) Open Feed (panel on top). 2) Open Trips then Travelers. | "N members planning a trip", rows "Name is heading to X" with dates and notes; also empty text when none | P1 | UI | WhosGoingPanel:48-54, 211-249; TripsScreen:160 |
| C-132 | Share trip open | Panel | 1) Click "I'm going". 2) Click Cancel. | Form toggles; Share trip disabled when destination empty | P1 | UI | WhosGoingPanel:132-134, 204 |
| C-133 | Share trip | Panel | 1) Destination "Ubud", dates, note. 2) Share trip. | POST /members/trips 201; form clears and closes; list reloads; a trip should be visible to the author. [Own trip is excluded so the panel looks unchanged, "Be the first" may re-appear] | P1 | UI | WhosGoingPanel:90-111; members.ts:232-236; D-C-10 |
| C-134 | Trip visible to others | U-A shared trip | 1) Log in as U-B. 2) Open panel. | U-B sees U-A trip; hidden after `end_date` passes, when `is_public=false`, or `show_in_directory=false` | P1 | Security | members.ts:205-209 |
| C-135 | Trip validation | Panel form | 1) Notes 501 chars. 2) Destination 101 chars. 3) End date before start. | 400 shown as "Could not save trip." (no field message; textarea has no maxLength). End<start accepted (no rule) | P2 | Validation | WhosGoingPanel:106-108, 200-202; members.ts:525-535 |
| C-136 | Show more | 5 trips | 1) Click "+2 more". 2) "Show less". | Expands to 5 then back to 3 | P2 | UI | WhosGoingPanel:113, 234-238 |
| C-137 | Near you: off | Trip Mode off, no cached location | 1) Click "Near you now". | Message "Turn on Trip Mode to see who's nearby." with "Turn on" | P1 | UI | WhosGoingPanel:149-155; members.ts:259-262 |
| C-138 | Near you: turn on | Same, browser location prompt | 1) Click Turn on. 2) Allow location. 3) Deny in another run. | Allow: list loads. [First load likely repeats 400 because the first location ping has not been stored yet, RUNTIME]. Deny: error text | P2 | Edge | WhosGoingPanel:152; useTripMode:50-72; D-C-25 |
| C-139 | Near you: list | U-B Trip Mode on within 10 km, U-F blocked | 1) View list. | Shows name and whole-km distance and "Heading to ...", excludes self and blocked; no Connect button (gap) | P1 | UI | WhosGoingPanel:158-176; members.ts:255-303 |
| C-140 | Region prop | Panel used on Feed and Trips | 1) Check title and query. | Title "Who's going?" and `/members/trips` without region on both screens (no `region` is ever passed) | P3 | UI | CommunityScreen:127; TripsScreen:160 |

### 3h) Photos proxy, security, mobile

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| C-141 | Photos happy | Valid ref from catalog | 1) GET /api/v1/photos?ref=places/X/photos/Y&w=800. 2) Repeat. | 200 image, `Cache-Control` 24 h; second served from Redis | P2 | API | photos.ts:21-72 |
| C-142 | Photos validation | none | 1) No ref. 2) ref with spaces or `..`. 3) w=5000. 4) w=abc. | 400; 400; width clamped 1600; 800 | P2 | Validation | photos.ts:24-34 |
| C-143 | Photos crash | Staging only | 1) GET /api/v1/photos?ref=%25 | Expected clean 400. [decodeURIComponent throws outside try, unhandled rejection, possible process exit, RUNTIME] | P1 | Security | photos.ts:29; D-C-18 |
| C-144 | Mobile Community | 375x812 | 1) Open Feed. 2) Scroll. 3) Open compose. | No horizontal scroll; 32 px side padding on header, panel and feed is tight; modal 90% width; Post button visible above keyboard | P2 | Mobile | CommunityScreen:126, 695, 793 |
| C-145 | Mobile panel | 375x667 | 1) Expand "I'm going" form. | Two-column date row fits; feed still reachable (panel is above feed in a non-scrolling container) | P2 | Mobile | WhosGoingPanel:281; CommunityScreen:691, 718 |
| C-146 | Mobile Members | 375x812 | 1) Open Members. 2) Check tab row. 3) Open profile. | Three tabs (Directory, Upcoming trips, Connections) fit without horizontal overflow (they may not: 20 px side padding each); single-column grid; profile readable | P2 | Mobile | MembersScreen:470-473, 478 |
| C-147 | Mobile Messages | 375x812 | 1) Open a thread. 2) Focus input. 3) Long unbroken word. | Input row stays visible above keyboard; bubble wraps at 70 % | P2 | Mobile | MessagesScreen:284-299 |
| C-148 | Cross-user isolation | U-A and U-B | 1) Use U-A token to call POST comments, react, connection PATCH, messages GET on U-B's ids. | Every write and read is scoped to the caller; nothing can be done as another user | P1 | Security | community.ts, members.ts, messages.ts (all use `req.user.id`) |

---

## 4) Suspected defects

Severity: 1 = feature dead or data-exposing, 2 = major flow wrong, 3 = moderate / missing behaviour, 4 = minor.

| ID | Severity | What is wrong | Evidence file:line | Confirmed by code or needs runtime check |
|---|---|---|---|---|
| D-C-1 | 1 | Comments are completely broken: SQL uses `author_id`, the table column is `user_id`. List, add and delete comments all return 500; UI then shows "No comments yet". | community.ts:367,371,372,390,409; `\d post_comments` (user_id); live EXPLAIN "column author_id does not exist"; CommunityScreen:605,617 | Confirmed by code and live schema |
| D-C-2 | 1 | Reactions cannot be added: `ON CONFLICT (post_id, user_id, reaction)` has no matching unique index (only `(post_id, user_id)` exists). Live EXPLAIN returned "no unique or exclusion constraint matching". Toggle and switch are unreachable; UI swallows the error. Design also conflicts: one row per user per post vs four emoji. | community.ts:344-347; `\d post_reactions`; CommunityScreen:80-84 | Confirmed by code and live schema |
| D-C-3 | 1 | Photo upload cannot work: (a) `express.json` limit 10kb; (b) backend runs as user `node` while `/app/uploads` is root-owned 755 and the host dir is empty (no upload ever succeeded); (c) live nginx has no `client_max_body_size` (1 MB default) and no `/uploads/` location, so URLs fall through to `index.html`. UI hides the failure. | index.ts:49; community.ts:12-17,448,450; Dockerfile:29; `ls -ld /app/uploads`; /etc/nginx/sites-enabled/drift (`/api/`, `location /`); CommunityScreen:322-324 | Confirmed by code and server config (exact error code needs runtime check) |
| D-C-4 | 2 | Media-only post returns 500: zod makes `body` optional but `community_posts.body` is NOT NULL (with length CHECK 1..2000). UI enables Post with images only. | community.ts:22,228; CommunityScreen:582-585; `\d community_posts` | Confirmed by code and schema |
| D-C-5 | 2 | Visibility mismatch: zod accepts `public/connections/private`, DB CHECK accepts `public/members/connections`. `private` gives 500, `members` gives 400. UI has no visibility control and hard-codes `public`. | community.ts:40; `community_posts_visibility_check`; CommunityScreen:391 | Confirmed by code and schema |
| D-C-6 | 2 | `GET /community/posts/:id` and `GET /posts/:id/comments` ignore `visibility`, `is_hidden`, blocks and auth, so connections-only posts and their comments are readable by anyone including anonymous users. `is_hidden` is also never filtered in feed, discover or own-posts, so moderation cannot hide a post. | community.ts:266-291,360-373,93,157,474 | Confirmed by code |
| D-C-7 | 2 | Discover route has no `authenticate` or `optionalAuth`, so `req.user` is always undefined and `my_reaction` is always null in the default tab (highlight never shows, even once reactions work). Same for GET post by id. | community.ts:122,126,266-268 | Confirmed by code |
| D-C-8 | 2 | Feed query returns only `visibility='public'`, so posts with `connections` visibility never appear for anyone else (the visibility feature is unreachable). | community.ts:94 | Confirmed by code |
| D-C-9 | 2 | "Report" on nearby members fails: UI sends `users.id` as `reportedTravelerId`, DB FK requires `travelers.id`; travelers.id is a separate uuid. Every report returns 500 and the alert "Could not submit report". | WhosGoingPanel:72-77; members.ts:271; auth.ts:88; safety.ts:603-618; `safety_reports_reported_traveler_id_fkey` | Confirmed by code and schema |
| D-C-10 | 2 | After "Share trip" the author's own trip is excluded from the list, so the panel looks unchanged or shows "Be the first" again and the user thinks saving failed. | members.ts:232-236; WhosGoingPanel:102-105 | Confirmed by code |
| D-C-11 | 2 | Declined connections: the Connections tab labels them "Connected"; the directory card and profile show nothing for `declined`; and a declined pair can never reconnect (409 on any existing row); there is no withdraw or disconnect. | MembersScreen:426,96-107,324-329; members.ts:391-403 | Confirmed by code |
| D-C-12 | 2 | Message thread returns the oldest 100 (`ASC LIMIT 100`), so once a thread passes 100 messages new ones are never displayed; the polling refresh keeps returning the same 100. | messages.ts:111-112; MessagesScreen:57-63 | Confirmed by code |
| D-C-13 | 3 | Block is enforced only in `/members/nearby` and message send. Not in feed, discover, comments, directory, profile, connect requests, thread reading, conversation list or unread count. UI does not show why a send fails. | grep `user_blocks`: members.ts:288,432,447; messages.ts:159 only; community.ts has none | Confirmed by code |
| D-C-14 | 3 | Block/report/unblock UI is available only in the "Near you now" list. No block or report on member profile, posts or messages; no unblock control; no endpoint to report a post (safety report schema accepts traveler/operator/place only). | WhosGoingPanel:169-172; MembersScreen:236-331; safety.ts:594-603; members.ts:444 | Confirmed by code |
| D-C-15 | 3 | Profile detail is built from the directory list row. `GET /members/:userId` (which adds `upcoming_trips`) is never called, so "Upcoming trips" never displays; profiles cannot be opened from Connections or Trips tabs. | MembersScreen:151,288,389,408-445,457; members.ts:312-356 | Confirmed by code |
| D-C-16 | 3 | Missing features or dead backends behind expected controls: edit post (no endpoint), delete post (endpoint, no UI), delete comment (endpoint broken, no UI), save/bookmark (feed returns `is_saved`, no post-save endpoint, no UI), share, report post, pagination or load-more, feed region/category filters, visibility picker, avatar on post cards, member search and budget/style filters, "Message" button on profile. | community.ts:85,306,405; recommendations.ts:764; CommunityScreen:187-269; MembersScreen:353-373 | Confirmed by code |
| D-C-17 | 3 | Errors are swallowed almost everywhere (only `console.error`), so users see nothing when react, upload, comment, connect, accept/decline, message send or feed load fails. Feed failure looks like "Nothing here yet". | CommunityScreen:71,82,322,605,617; MembersScreen:170,197,229; MessagesScreen:62,86 | Confirmed by code |
| D-C-18 | 2 | Unauthenticated crash risk: `decodeURIComponent(ref)` outside `try` in an async Express 4 handler with no async-error wrapper and no `unhandledRejection` handler. `?ref=%25` throws URIError, and on Node 20 an unhandled rejection ends the process. | photos.ts:29; grep found no `unhandledRejection`/`express-async-errors` in backend/src; Node 20 image (Dockerfile:1) | Confirmed by code; crash effect needs runtime check on staging |
| D-C-19 | 3 | Directory, profile and public trips are readable without login (`optionalAuth`), exposing name, home city/country, preferences and member-since; the "Location private" fallback in the UI is never reached because the API always returns the fields. Needs a product decision. | members.ts:50,188,312; MembersScreen:59 | Confirmed by code; product decision needed |
| D-C-20 | 3 | Post creation trusts client data: `operatorId` is stored without checking ownership; `mediaUrls` accepts any string (external tracking URLs) instead of only own `/uploads/` URLs. | community.ts:39,41,230,239 | Confirmed by code |
| D-C-21 | 3 | A new member place is created (and counts toward the 5/day limit) before the post insert; if the insert fails the place is orphaned. | community.ts:203,223; memberPlaces.ts:64-83 | Confirmed by code |
| D-C-22 | 3 | Comment box: Enter key has no `submitting` guard (double Enter posts twice); compose upload cap uses stale `images.length` (can exceed 5 then fail 400); Post can be pressed while uploads are in flight. | CommunityScreen:660,608-610,312,314-325 | Confirmed by code |
| D-C-23 | 3 | New-place tag silently dropped when the address was not geocoded: the place name remains in the form but the post is sent without a place. | CommunityScreen:395-402 | Confirmed by code |
| D-C-24 | 3 | Connection message state (`connectMsg`) is shared across profiles and cards and never cleared; card "Connect" sends text typed for another member. | MembersScreen:154,222,313 | Confirmed by code |
| D-C-25 | 3 | "Turn on" Trip Mode reloads nearby immediately, before the first location ping is stored; `/nearby` needs the cached location and returns the same 400 again. | WhosGoingPanel:152; useTripMode:50-72; members.ts:259-262 | Needs runtime check |
| D-C-26 | 3 | Following feed `?region=` ORs the region match with the network filter, so it adds strangers' posts instead of narrowing. | community.ts:95-103 | Confirmed by code (API only; UI does not send it) |
| D-C-27 | 3 | Discover orders by engagement first with a hard limit of 20 and no paging, so a new post with 0 reactions may not appear after the user posts. | community.ts:161-163; CommunityScreen:87-90 | Confirmed by code; visibility depends on data |
| D-C-28 | 4 | Clutter and dead code: three empty "Who is going" divs; duplicate empty state in Messages; duplicate PATCH connections route and duplicate comments; discarded first query in `GET /messages` with an N-squared self join; `otherUser` and `selectedId` unused. | CommunityScreen:130-136; MessagesScreen:16-23,248-258,52,246; members.ts:459,492; messages.ts:17-35 | Confirmed by code |
| D-C-29 | 3 | No UUID or paging validation: malformed or unknown ids in `/messages/:userId`, `/members/:userId`, react, comments, block, `memberId` give 500 instead of 400/404; `limit` negative/NaN gives 500; unlimited `limit` on feed and discover. | messages.ts:75-86; members.ts:312-316,431; community.ts:54-55,124-125,332,461 | Confirmed by code |
| D-C-30 | 3 | Mobile layout risks: fixed 32 px padding on Community; Members tab row is three no-wrap tabs with 20 px padding each; panel sits above feed in a non-scrolling flex column; date inputs in two columns at 375 px. | CommunityScreen:126,695,691; MembersScreen:470-472; WhosGoingPanel:281 | Needs runtime check |
| D-C-31 | 4 | Whitespace-only message can pass zod because `.min(1)` runs before `.trim()`; stored as empty string. | messages.ts:10 | Needs runtime check |
| D-C-32 | 4 | No email/push for connection requests or messages; `notifications` and `consent` services are not used by community, members or messages routes, so recipients only learn through the 15 s in-app poll. | messages.ts, members.ts, community.ts (no import); AppShell:62 | Confirmed by code; product decision |
| D-C-33 | 3 | Soft-deleted comments and posts do not adjust `comment_count`/`reaction_count` (triggers fire on physical INSERT/DELETE only), so counts drift from visible content. | community.ts:306-311,405-411; `update_comment_count` trigger | Confirmed by code and trigger source |
| D-C-34 | 4 | Uploads accept HEIC (browsers cannot render) and `accept="image/*"` lets gif/avif/svg through to a silent 400; no magic-byte check on content; no per-user quota (disk fill). | community.ts:428-435,438-448; CommunityScreen:560 | Confirmed by code |
| D-C-35 | 4 | Comments modal does not refresh the card's `comment_count`; card avatar ignores `avatar_url`; place search fires paid live top-ups on each debounced keystroke (60/min limit) with default region "Bali". | CommunityScreen:176-179,199; search.ts:16 | Confirmed by code |

Totals: 35 defects. Severity 1: 3 (D-C-1, D-C-2, D-C-3). Severity 2: 10 (D-C-4 to D-C-12, D-C-18). Severity 3: 17. Severity 4: 5 (D-C-28, D-C-31, D-C-32, D-C-34, D-C-35).
