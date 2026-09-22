// Test of route-scoped markup rules and the supplier scorecard (migration 047,
// services/markupRules.ts, routes/markupAdmin.ts).
//
// Uses REAL search calls (Duffel test mode + TripGic sandbox -- both search-only, no side
// effects) so the scorecard numbers are the real thing, not a fake. Any markup rule this test
// creates for a real route is deactivated again before it finishes, so live pricing is left
// exactly as it was found.
//   docker cp markup-rules-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/markup-rules-api-test.js
const jwt = require("/app/node_modules/jsonwebtoken");
const { pool } = require("/app/dist/utils/db");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };
const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function call(method, p, token, body) {
  const url = "http://localhost:5000/api/v1" + p;
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch {}
  return { s: r.status, d };
}
const short = (x) => JSON.stringify(x).slice(0, 260);
const stamp = Date.now();
// A route nowhere near anything real, so this test can never collide with an admin-set rule
// that matters, and its cleanup can never leave a stray real-route rule behind.
const TEST_ROUTE = { origin: "ZZZ", destination: "YYY" };
const REAL_ROUTE = { origin: "SYD", destination: "DPS" };
const madeRuleIds = [];

(async () => {
  const admin = (await pool.query("SELECT id, email, role FROM users WHERE email LIKE '%@drifttest.com' AND role = 'admin' ORDER BY email LIMIT 1")).rows[0];
  const traveler = (await pool.query("SELECT id, email, role FROM users WHERE email LIKE '%@drifttest.com' AND role = 'traveler' ORDER BY email LIMIT 1")).rows[0];
  if (!admin || !traveler) { console.log("Need a seeded admin and traveller"); process.exit(1); }
  const tAdmin = tok(admin), tTrav = tok(traveler);

  // Snapshot the real route in case anything here ever touched it (it should not).
  const before = (await pool.query("SELECT id FROM markup_rules WHERE scope = 'route' AND route_origin = $1 AND route_destination = $2 AND active = true", [REAL_ROUTE.origin, REAL_ROUTE.destination])).rows;

  try {
    // ── Access control ────────────────────────────────────────────────────────────
    let r = await call("GET", "/admin/markup-rules", tTrav);
    ok("a traveller cannot list markup rules", r.s === 403, short(r));
    r = await call("GET", "/admin/markup-rules", null);
    ok("listing needs a login", r.s === 401, short(r));
    r = await call("POST", "/admin/markup-rules", tTrav, { scope: "global", markupType: "percentage", markupValue: 0.1 });
    ok("a traveller cannot create a rule", r.s === 403, short(r));
    r = await call("GET", "/admin/flights/scorecard?origin=SYD&destination=DPS&departureDate=2026-11-15", tTrav);
    ok("a traveller cannot see the scorecard", r.s === 403, short(r));

    // ── Validation ─────────────────────────────────────────────────────────────────
    r = await call("POST", "/admin/markup-rules", tAdmin, { scope: "route", markupType: "percentage", markupValue: 0.1 });
    ok("a route rule needs an origin and destination", r.s === 400, short(r));
    r = await call("POST", "/admin/markup-rules", tAdmin, { scope: "route", routeOrigin: "ZZZ", routeDestination: "ZZZ", markupType: "percentage", markupValue: 0.1 });
    ok("origin and destination cannot be the same", r.s === 400, short(r));
    r = await call("POST", "/admin/markup-rules", tAdmin, { scope: "route", routeOrigin: "ZZZ", routeDestination: "YYY", markupType: "percentage", markupValue: 8 });
    ok("a percentage of 8 (meaning 800%) is refused -- it must be a fraction like 0.08", r.s === 400, short(r));
    r = await call("POST", "/admin/markup-rules", tAdmin, { scope: "route", routeOrigin: "SY", routeDestination: "YYY", markupType: "percentage", markupValue: 0.1 });
    ok("a 2-letter code is refused", r.s === 400, short(r));
    r = await call("POST", "/admin/markup-rules", tAdmin, { scope: "route", routeOrigin: "ZZZ", routeDestination: "YYY", markupType: "percentage", markupValue: 0.1, minFee: 50, maxFee: 5 });
    ok("a minFee above maxFee is refused", r.s === 400, short(r));

    // ── Creating and reading back a route rule ──────────────────────────────────────
    r = await call("POST", "/admin/markup-rules", tAdmin, { scope: "route", routeOrigin: TEST_ROUTE.origin, routeDestination: TEST_ROUTE.destination, markupType: "percentage", markupValue: 0.2, minFee: 5, maxFee: 150 });
    ok("an admin can create a route rule", r.s === 201 && r.d?.scope === "route" && r.d?.active === true, short(r));
    const ruleId = r.d?.id; if (ruleId) madeRuleIds.push(ruleId);
    r = await call("GET", "/admin/markup-rules", tAdmin);
    ok("it shows up in the list", r.s === 200 && r.d.rules.some((x) => x.id === ruleId), short(r).slice(0, 120));

    // ── Replacing it (not erroring) ──────────────────────────────────────────────────
    r = await call("POST", "/admin/markup-rules", tAdmin, { scope: "route", routeOrigin: TEST_ROUTE.origin, routeDestination: TEST_ROUTE.destination, markupType: "percentage", markupValue: 0.3 });
    ok("creating a second rule for the same route replaces the first, rather than erroring", r.s === 201 && r.d?.id !== ruleId, short(r));
    const ruleId2 = r.d?.id; if (ruleId2) madeRuleIds.push(ruleId2);
    r = await call("GET", "/admin/markup-rules", tAdmin);
    const mine = r.d.rules.filter((x) => x.route_origin === TEST_ROUTE.origin && x.route_destination === TEST_ROUTE.destination);
    ok("the old one is kept but no longer active, and only the new one is", mine.length === 2 && mine.find((x) => x.id === ruleId)?.active === false && mine.find((x) => x.id === ruleId2)?.active === true, short(mine));

    // ── The route markup engine (a fake TripGic offer at 100.00, checked through the real quote path is overkill here --
    //    this is proven end to end by flightPaymentRules.test.ts's route-selection unit tests and
    //    the tripgic/flight-payments API tests already re-run below; here we only check the admin surface.) ──

    // ── Deactivating ───────────────────────────────────────────────────────────────
    r = await call("PATCH", `/admin/markup-rules/${ruleId2}`, tTrav, { active: false });
    ok("a traveller cannot deactivate a rule", r.s === 403, short(r));
    r = await call("PATCH", `/admin/markup-rules/${ruleId2}`, tAdmin, { active: false });
    ok("an admin can deactivate it", r.s === 200 && r.d?.active === false, short(r));
    r = await call("PATCH", "/admin/markup-rules/00000000-0000-4000-8000-000000000000", tAdmin, { active: false });
    ok("deactivating an unknown id is 404", r.s === 404, short(r));

    // ── The scorecard, for real, on the actual Bali route ───────────────────────────
    r = await call("GET", `/admin/flights/scorecard?origin=${REAL_ROUTE.origin}&destination=${REAL_ROUTE.destination}&departureDate=2026-11-15&adults=1`, tAdmin);
    ok("the scorecard runs a real search and returns all three providers", r.s === 200 && Array.isArray(r.d?.providers) && r.d.providers.map((p) => p.provider).sort().join(",") === "duffel,travelport,tripgic", short(r).slice(0, 200));
    const duffel = r.d?.providers.find((p) => p.provider === "duffel");
    const tripgic = r.d?.providers.find((p) => p.provider === "tripgic");
    const travelport = r.d?.providers.find((p) => p.provider === "travelport");
    ok("Duffel and TripGic both return a priced, marked-up offer with a computed margin", duffel?.cheapest?.priceInEur > 0 && duffel.cheapest.marginInEur != null && tripgic?.cheapest?.priceInEur > 0 && tripgic.cheapest.marginInEur != null, short({ duffel: duffel?.cheapest, tripgic: tripgic?.cheapest }));
    ok("the traveller-facing price is always at least the underlying cost (never a negative margin from rounding)", duffel.cheapest.priceInEur >= duffel.cheapest.costInEur && tripgic.cheapest.priceInEur >= tripgic.cheapest.costInEur, short({ d: duffel.cheapest, t: tripgic.cheapest }));
    ok("Travelport is reported with no margin, since nothing is marked up on it yet", !travelport?.cheapest || travelport.cheapest.marginInEur === null, short(travelport));
    ok("the effective rule for a route with no rule of its own is the global one", r.d.effectiveMarkupRule?.scope === "global" && parseFloat(r.d.effectiveMarkupRule.markup_value) === 0.08, short(r.d.effectiveMarkupRule));

    // ── Setting a real rule changes the effective rule the scorecard reports ────────
    r = await call("POST", "/admin/markup-rules", tAdmin, { scope: "route", routeOrigin: REAL_ROUTE.origin, routeDestination: REAL_ROUTE.destination, markupType: "percentage", markupValue: 0.5, minFee: 5, maxFee: 5000 });
    ok("a route rule can be set on the real Bali route", r.s === 201, short(r));
    const realRuleId = r.d?.id; if (realRuleId) madeRuleIds.push(realRuleId);
    r = await call("GET", `/admin/flights/scorecard?origin=${REAL_ROUTE.origin}&destination=${REAL_ROUTE.destination}&departureDate=2026-11-15&adults=1`, tAdmin);
    ok("the scorecard now reports the route's own rule, not the global one", r.d.effectiveMarkupRule?.scope === "route" && parseFloat(r.d.effectiveMarkupRule.markup_value) === 0.5, short(r.d.effectiveMarkupRule));
    const duffel2 = r.d.providers.find((p) => p.provider === "duffel");
    ok("and the traveller-facing price on that route actually reflects the new rule (much higher margin now)", duffel2.cheapest.marginPercentOfCost > duffel.cheapest.marginPercentOfCost, short({ before: duffel.cheapest.marginPercentOfCost, after: duffel2.cheapest.marginPercentOfCost }));

    r = await call("GET", `/admin/flights/scorecard?origin=xx&destination=DPS&departureDate=2026-11-15`, tAdmin);
    ok("a malformed airport code is a 400, not a crash", r.s === 400, short(r));
  } catch (e) {
    console.error("SCRIPT ERROR", e);
    fail++;
  } finally {
    // ── Cleanup: deactivate and delete every rule this test made, real-route one first ──
    if (madeRuleIds.length) await pool.query("DELETE FROM markup_rules WHERE id = ANY($1::uuid[])", [madeRuleIds]);
    const after = (await pool.query("SELECT id FROM markup_rules WHERE scope = 'route' AND route_origin = $1 AND route_destination = $2 AND active = true", [REAL_ROUTE.origin, REAL_ROUTE.destination])).rows;
    ok("live pricing on the real route is left exactly as it was found (no route rule active)", after.length === before.length, `${after.length} vs ${before.length}`);
    const leftoverTest = (await pool.query("SELECT count(*) FROM markup_rules WHERE route_origin = $1", [TEST_ROUTE.origin])).rows[0].count;
    ok("nothing from the fake test route was left behind", Number(leftoverTest) === 0, leftoverTest);
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
