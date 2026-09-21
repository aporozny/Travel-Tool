// API test for the operator-side fixes (21 Sep 2026): the "who am I" route, the operator
// dashboard, and the whole listing-claim flow (submit, list, admin queue, approve, reject).
// Creates throwaway @drifttest.com operators and places, sends no email, and removes
// everything it made. Run inside the backend container:
//   docker cp operator-fixes-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/operator-fixes-api-test.js
const jwt = require("/app/node_modules/jsonwebtoken");
const { pool } = require("/app/dist/utils/db");
const { computeTrust } = require("/app/dist/services/listingClaims");
const B = "http://localhost:5000/api/v1";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };
const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function call(method, p, token, body) {
  const r = await fetch(B + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch {}
  return { s: r.status, d };
}
const short = (r) => JSON.stringify(r).slice(0, 200);
const stamp = Date.now();
const made = { users: [], operators: [], places: [], bookings: [] };

async function makeOperator(label) {
  const u = (await pool.query("INSERT INTO users (email, password_hash, role) VALUES ($1, 'not-a-real-hash', 'operator') RETURNING id, email, role", [`opfix-${label}-${stamp}@drifttest.com`])).rows[0];
  made.users.push(u.id);
  const o = (await pool.query("INSERT INTO operators (user_id, business_name, category, region) VALUES ($1, $2, 'activity', 'Test Region') RETURNING id", [u.id, `OpFix ${label} ${stamp}`])).rows[0];
  made.operators.push(o.id);
  return { ...u, operatorId: o.id, token: tok(u) };
}
async function makePlace(label) {
  const p = (await pool.query("INSERT INTO places_cache (external_id, source, name, category, region) VALUES ($1, 'opfix-test', $2, 'activity', 'Test Region') RETURNING id, name", [`opfix-${label}-${stamp}`, `OpFix Place ${label} ${stamp}`])).rows[0];
  made.places.push(p.id);
  return p;
}

(async () => {
  try {
    const admin = (await pool.query("SELECT id, email, role FROM users WHERE email LIKE '%@drifttest.com' AND role = 'admin' ORDER BY email LIMIT 1")).rows[0];
    const traveler = (await pool.query("SELECT u.id, u.email, u.role, t.id AS traveler_id FROM users u JOIN travelers t ON t.user_id = u.id WHERE u.email LIKE '%@drifttest.com' AND u.role = 'traveler' ORDER BY u.email LIMIT 1")).rows[0];
    if (!admin || !traveler) { console.log("Need a seeded admin and traveller"); process.exit(1); }
    const tAdmin = tok(admin), tTrav = tok(traveler);
    const opA = await makeOperator("a");
    const opB = await makeOperator("b");
    const place1 = await makePlace("one"), place2 = await makePlace("two"), place3 = await makePlace("three");

    // --- Who am I (used to restore the menu after a page reload) -------------------
    let r = await call("GET", "/auth/me", opA.token);
    ok("auth/me returns the signed-in user and role", r.s === 200 && r.d?.id === opA.id && r.d?.role === "operator" && r.d?.email === opA.email, short(r));
    r = await call("GET", "/auth/me", tAdmin);
    ok("auth/me tells an admin they are an admin", r.s === 200 && r.d?.role === "admin", short(r));
    r = await call("GET", "/auth/me", null);
    ok("auth/me without a login is 401", r.s === 401, short(r));
    r = await call("GET", "/auth/me", "not.a.token");
    ok("auth/me with a bad token is 401", r.s === 401, short(r));
    r = await call("GET", "/auth/me", opA.token);
    ok("auth/me does not expose a password hash", r.d && !("password_hash" in r.d), short(r));

    // --- Dashboard (used to be 500 on bookings and reviews) --------------------------
    const bk = (await pool.query("INSERT INTO bookings (traveler_id, operator_id, status, start_date, guests, total_amount) VALUES ($1, $2, 'pending', CURRENT_DATE + 30, 2, 250.00) RETURNING id", [traveler.traveler_id, opA.operatorId])).rows[0];
    made.bookings.push(bk.id);
    r = await call("GET", "/dashboard/overview", opA.token);
    ok("dashboard overview loads", r.s === 200 && r.d?.operator_id === opA.operatorId && Number(r.d?.pending_bookings) === 1, short(r));
    r = await call("GET", "/dashboard/bookings", opA.token);
    ok("dashboard bookings loads with the traveller's details (was 500)", r.s === 200 && r.d?.length === 1 && r.d[0].traveler_email === traveler.email && "budget_range" in r.d[0], short(r));
    r = await call("GET", "/dashboard/bookings?status=pending", opA.token);
    ok("dashboard bookings filters by status", r.s === 200 && r.d?.length === 1, short(r));
    r = await call("GET", "/dashboard/bookings?status=confirmed", opA.token);
    ok("dashboard bookings filter with no match is empty", r.s === 200 && r.d?.length === 0, short(r));
    r = await call("GET", "/dashboard/bookings?status=bogus", opA.token);
    ok("dashboard bookings rejects a bad status filter", r.s === 400, short(r));
    r = await call("GET", "/dashboard/reviews", opA.token);
    ok("dashboard reviews loads (was 500)", r.s === 200 && Array.isArray(r.d), short(r));
    r = await call("GET", "/dashboard/analytics", opA.token);
    ok("dashboard analytics loads", r.s === 200 && Array.isArray(r.d?.daily) && Array.isArray(r.d?.ratings), short(r));
    r = await call("GET", "/dashboard/claims", opA.token);
    ok("dashboard claims loads (was 500)", r.s === 200 && Array.isArray(r.d), short(r));
    r = await call("GET", "/dashboard/overview", tTrav);
    ok("dashboard is closed to travellers", r.s === 403, short(r));
    r = await call("PATCH", `/bookings/${bk.id}/status`, opA.token, { status: "confirmed" });
    ok("operator can confirm their pending booking", r.s === 200 && r.d?.status === "confirmed", short(r));
    r = await call("GET", "/bookings", opA.token);
    ok("operator bookings list carries traveller name fields for the screen", r.s === 200 && r.d?.length === 1 && "traveler_email" in r.d[0], short(r));

    // --- Claims: submit ----------------------------------------------------------------
    const claimBody = { place_cache_id: place1.id, evidence: "I own this business, ABN 12 345 678", contact_email: "owner@example.com" };
    r = await call("GET", `/operators/search-places?q=${encodeURIComponent("OpFix Place one " + stamp)}`, opA.token);
    ok("search-places finds an unclaimed listing (was 500)", r.s === 200 && r.d?.length === 1 && r.d[0].is_claimed === false && r.d[0].has_pending_claim === false, short(r));
    r = await call("POST", "/operators/claims", tTrav, claimBody);
    ok("a traveller cannot claim", r.s === 403, short(r));
    r = await call("POST", "/operators/claims", null, claimBody);
    ok("claiming needs a login", r.s === 401, short(r));
    r = await call("POST", "/operators/claims", opA.token, { ...claimBody, evidence: "too short" });
    ok("claim with 9 characters of evidence is 400", r.s === 400, short(r));
    r = await call("POST", "/operators/claims", opA.token, { ...claimBody, contact_email: "not-an-email" });
    ok("claim with a bad email is 400", r.s === 400, short(r));
    r = await call("POST", "/operators/claims", opA.token, { ...claimBody, place_cache_id: "nope" });
    ok("claim with a non-uuid place is 400", r.s === 400, short(r));
    r = await call("POST", "/operators/claims", opA.token, { ...claimBody, place_cache_id: "00000000-0000-4000-8000-000000000000" });
    ok("claim on a place that does not exist is 404", r.s === 404, short(r));
    r = await call("POST", "/operators/claims", opA.token, claimBody);
    ok("operator can submit a claim (was 500)", r.s === 201 && r.d?.claimId && r.d?.status === "pending", short(r));
    const claimA = r.d?.claimId;
    r = await call("POST", "/operators/claims", opA.token, claimBody);
    ok("a second pending claim for the same listing is 409", r.s === 409, short(r));
    r = await call("GET", `/operators/search-places?q=${encodeURIComponent("OpFix Place one " + stamp)}`, opB.token);
    ok("search-places now shows the pending claim", r.d?.[0]?.has_pending_claim === true && r.d[0].is_claimed === false, short(r));
    r = await call("POST", "/operators/claims", opB.token, { ...claimBody, contact_email: "b@example.com" });
    ok("a different operator can also put in a claim for the same listing", r.s === 201, short(r));
    const claimB = r.d?.claimId;

    // --- Claims: lists -----------------------------------------------------------------
    r = await call("GET", "/operators/claims", opA.token);
    ok("operator sees their own claim (was 500)", r.s === 200 && r.d?.length === 1 && r.d[0].id === claimA && r.d[0].status === "pending", short(r));
    r = await call("GET", "/search/claims", opA.token);
    ok("the search-route list agrees", r.s === 200 && r.d?.length === 1 && r.d[0].id === claimA, short(r));
    r = await call("GET", "/dashboard/claims", opA.token);
    ok("the dashboard claim list agrees", r.s === 200 && r.d?.length === 1, short(r));
    r = await call("GET", "/operators/claims/queue", opA.token);
    ok("the admin queue is closed to operators", r.s === 403, short(r));
    r = await call("GET", "/operators/claims/queue", tAdmin);
    ok("admin queue lists both pending claims with the operator's email (was 500)", r.s === 200 && r.d?.filter((c) => [claimA, claimB].includes(c.id)).length === 2 && r.d.find((c) => c.id === claimA)?.operator_email === opA.email, short(r));

    // --- Claims: review ----------------------------------------------------------------
    r = await call("PATCH", `/operators/claims/${claimA}`, opA.token, { status: "approved" });
    ok("an operator cannot approve their own claim", r.s === 403, short(r));
    r = await call("PATCH", `/operators/claims/${claimA}`, tAdmin, { status: "maybe" });
    ok("review with a bad status is 400", r.s === 400, short(r));
    r = await call("PATCH", "/operators/claims/not-a-uuid", tAdmin, { status: "approved" });
    ok("review of a malformed claim id is 404, not 500", r.s === 404, short(r));
    r = await call("PATCH", `/operators/claims/${claimA}`, tAdmin, { status: "approved" });
    ok("admin can approve (was 500)", r.s === 200 && r.d?.success === true && r.d?.status === "approved", short(r));
    r = await call("PATCH", `/operators/claims/${claimA}`, tAdmin, { status: "approved" });
    ok("approving twice is 409", r.s === 409, short(r));

    const place = (await pool.query("SELECT is_claimed, operator_id, claimed_by FROM places_cache WHERE id = $1", [place1.id])).rows[0];
    ok("approval marks the listing claimed and links the operator", place.is_claimed === true && place.operator_id === opA.operatorId && place.claimed_by === opA.id, JSON.stringify(place));
    const opRow = (await pool.query("SELECT is_verified FROM operators WHERE id = $1", [opA.operatorId])).rows[0];
    ok("approval verifies the operator", opRow.is_verified === true, JSON.stringify(opRow));
    const trust = (await pool.query("SELECT score_identity, composite_score, trust_tier FROM operator_trust_scores WHERE operator_id = $1", [opA.operatorId])).rows[0];
    ok("approval sets a trust score (identity 100, composite 40, verified)", trust?.score_identity === 100 && trust?.composite_score === 40 && trust?.trust_tier === "verified", JSON.stringify(trust));
    r = await call("GET", `/safety/operators/${opA.operatorId}/trust`, null);
    ok("the trust badge endpoint now finds the operator", r.s === 200 && r.d?.badge?.label === "Verified", short(r));
    const cB = (await pool.query("SELECT status, reviewed_by FROM listing_claims WHERE id = $1", [claimB])).rows[0];
    ok("the other operator's pending claim on that listing is rejected", cB.status === "rejected" && cB.reviewed_by === admin.id, JSON.stringify(cB));
    r = await call("GET", `/operators/search-places?q=${encodeURIComponent("OpFix Place one " + stamp)}`, opB.token);
    ok("search-places now shows the listing as claimed", r.d?.[0]?.is_claimed === true, short(r));
    r = await call("POST", "/operators/claims", opB.token, { ...claimBody, contact_email: "b@example.com" });
    ok("a claim on an already-claimed listing is 409", r.s === 409, short(r));
    r = await call("GET", "/operators/claims", opA.token);
    ok("the approved claim shows as approved with a review date", r.d?.[0]?.status === "approved" && r.d[0].reviewed_at, short(r));

    // reject then re-submit
    r = await call("POST", "/operators/claims", opB.token, { ...claimBody, place_cache_id: place2.id, contact_email: "b@example.com" });
    const claimB2 = r.d?.claimId;
    r = await call("PATCH", `/operators/claims/${claimB2}`, tAdmin, { status: "rejected" });
    ok("admin can reject", r.s === 200 && r.d?.status === "rejected", short(r));
    const opBRow = (await pool.query("SELECT is_verified FROM operators WHERE id = $1", [opB.operatorId])).rows[0];
    ok("rejecting does not verify the operator", opBRow.is_verified === false, JSON.stringify(opBRow));
    const place2Row = (await pool.query("SELECT is_claimed, operator_id FROM places_cache WHERE id = $1", [place2.id])).rows[0];
    ok("rejecting leaves the listing unclaimed", place2Row.is_claimed === false && place2Row.operator_id === null, JSON.stringify(place2Row));
    r = await call("PATCH", `/operators/claims/${claimB2}`, tAdmin, { status: "rejected" });
    ok("rejecting twice is 409", r.s === 409, short(r));
    r = await call("POST", "/operators/claims", opB.token, { ...claimBody, place_cache_id: place2.id, contact_email: "b@example.com" });
    ok("after a rejection the operator can try again", r.s === 201, short(r));

    // the second route family (search.ts) uses the same rules
    r = await call("POST", `/search/places/${place3.id}/claim`, opB.token, { evidence: "Family run for 10 years" });
    ok("POST /search/places/:id/claim works (was 500)", r.s === 201 && r.d?.claim_id && r.d?.status === "pending", short(r));
    const claim3 = r.d?.claim_id;
    r = await call("POST", `/search/places/${place3.id}/claim`, opB.token, { evidence: "Family run for 10 years" });
    ok("the search-route duplicate is 409", r.s === 409, short(r));
    r = await call("PATCH", `/search/claims/${claim3}`, tAdmin, { status: "approved" });
    ok("PATCH /search/claims/:id approves (was 500)", r.s === 200 && r.d?.status === "approved", short(r));
    const place3Row = (await pool.query("SELECT is_claimed, operator_id FROM places_cache WHERE id = $1", [place3.id])).rows[0];
    ok("the search-route approval also links the listing", place3Row.is_claimed === true && place3Row.operator_id === opB.operatorId, JSON.stringify(place3Row));
    r = await call("PATCH", `/search/claims/${claim3}`, tAdmin, { status: "approved" });
    ok("the search-route second approval is 409", r.s === 409, short(r));

    // --- Trust score arithmetic ---------------------------------------------------------
    ok("trust: verified only = 40 / verified", JSON.stringify(computeTrust({ identity: 100, reviews: 0, responsiveness: 0, completion: 0, safety: 100, tenure: 0 })) === JSON.stringify({ composite: 40, tier: "verified" }));
    ok("trust: everything 100 = 100 / elite", JSON.stringify(computeTrust({ identity: 100, reviews: 100, responsiveness: 100, completion: 100, safety: 100, tenure: 100 })) === JSON.stringify({ composite: 100, tier: "elite" }));
    ok("trust: no identity = new", computeTrust({ identity: 0, reviews: 0, responsiveness: 0, completion: 0, safety: 100, tenure: 0 }).tier === "new");
    ok("trust: out-of-range values are clamped", computeTrust({ identity: 500, reviews: -20, responsiveness: 0, completion: 0, safety: 100, tenure: 0 }).composite === 40);
  } catch (e) {
    console.error("SCRIPT ERROR", e);
    fail++;
  } finally {
    // --- Cleanup (order matters: foreign keys) ----------------------------------------------
    if (made.places.length) await pool.query("DELETE FROM listing_claims WHERE place_id = ANY($1::uuid[])", [made.places]);
    if (made.bookings.length) await pool.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [made.bookings]);
    if (made.operators.length) {
      await pool.query("DELETE FROM listing_claims WHERE operator_id = ANY($1::uuid[])", [made.operators]);
      await pool.query("DELETE FROM operator_trust_scores WHERE operator_id = ANY($1::uuid[])", [made.operators]);
      await pool.query("UPDATE places_cache SET operator_id = NULL, claimed_by = NULL, is_claimed = false WHERE operator_id = ANY($1::uuid[])", [made.operators]);
    }
    if (made.places.length) await pool.query("DELETE FROM places_cache WHERE id = ANY($1::uuid[])", [made.places]);
    if (made.operators.length) await pool.query("DELETE FROM operators WHERE id = ANY($1::uuid[])", [made.operators]);
    if (made.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [made.users]);
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(2); });
