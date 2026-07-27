# Stage Plan — Stage 5: Surface the Discovery Engine in the UI

**Approved by Executive:** 2026-07-15 (option 1 + "/loop fix it until it works perfectly").

## Why this stage

Audit finding: Stages 1–4 made the backend worldwide, multi-source and personalized, but none of it
is reachable from the product. `ExploreScreen.web.tsx` hardcodes Bali + Albania destination pills and
client-side filters out any result whose region is not in that list; the search box never calls the
backend. Separately, the deployed bundle hardcodes `http://100.67.86.49:5001` (Tailscale IP) as the
API base — on https://drifttravel.app every API call is mixed-content blocked, so the public site
only works on the owner's tailnet.

## Work packages

| WP | Description |
|---|---|
| WP5.1 | Zero-result telemetry: record the final served count for every search (previously only live fetches were recorded), so we can see what users ask for and don't get. Report = SQL over `search_queries` (see below). |
| WP5.2 | Free destination search: `q` becomes optional on `/api/v1/search` (browse mode), the backend upserts/records under the geocoded canonical region name and returns `geo {name, country}`; Explore screen replaces hardcoded country/region pills with a destination input (type anything on earth), quick-pick pills from active trips + recent destinations, no client-side country filter. |
| WP5.3 | Social proof: render the `community` field on result cards — "♥ N saved · N booked". |
| WP5.4 | Fix API base URL: relative `/api/v1` (nginx proxies it in prod) + webpack devServer proxy for local dev. Unblocks the public site. |
| WP5.5 | Deploy backend + web build, verify live on drifttravel.app. |

## Zero-result report (WP5.1)

```sql
SELECT query, region, category, results, created_at
FROM search_queries WHERE results = 0
ORDER BY created_at DESC LIMIT 50;
```

## Quality gate
- [ ] Backend: full `npm test` green; `q`-less search returns region results
- [ ] Web: lint + production build clean
- [ ] Live: searching a never-hardcoded destination (Lisbon) in the browser returns results
- [ ] Live: social proof badge visible on a card with saves
- [ ] Live: existing Bali flows still work (Canggu results non-empty)
- [ ] Public site loads and API calls succeed over https (no mixed content)
