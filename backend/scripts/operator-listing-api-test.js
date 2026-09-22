// Test of the operator business-listing flow (GET/POST/PATCH /operators/me and /operators),
// which fixes: a brand-new operator registration creates no operators row, so the Dashboard
// and Profile tabs had nothing to show and no way to fix that (D-A-3, D-DSH-08).
//
// Uses only throwaway @drifttest.com users it creates itself -- one with NO operators row,
// matching exactly what real registration produces today -- and removes them afterwards.
//   docker cp operator-listing-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/operator-listing-api-test.js
const jwt = require("/app/node_modules/jsonwebtoken");
const { pool } = require("/app/dist/utils/db");
const B = "http://localhost:5000/api/v1";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };
const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function call(method, p, token, body) {
  const r = await fetch(B + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch {}
  return { s: r.status, d };
}
const short = (x) => JSON.stringify(x).slice(0, 220);
const stamp = Date.now();
const madeUsers = [];
const madeOperators = [];

async function makeBareOperator(label) {
  // No operators row -- exactly what POST /auth/register produces for role 'operator' today.
  const u = (await pool.query("INSERT INTO users (email, password_hash, role) VALUES ($1, 'not-a-real-hash', 'operator') RETURNING id, email, role", [`oplisting-${label}-${stamp}@drifttest.com`])).rows[0];
  madeUsers.push(u.id);
  return { ...u, token: tok(u) };
}

(async () => {
  try {
    const traveler = (await pool.query("SELECT id, email, role FROM users WHERE email LIKE '%@drifttest.com' AND role = 'traveler' ORDER BY email LIMIT 1")).rows[0];
    const opA = await makeBareOperator("a");
    const opB = await makeBareOperator("b");

    // --- Before any listing exists (the real state of a fresh registration) ---------
    let r = await call("GET", "/operators/me", opA.token);
    ok("a brand-new operator has no listing (404, not a crash)", r.s === 404, short(r));
    r = await call("GET", "/operators/me", tok(traveler));
    ok("a traveller cannot ask for an operator listing", r.s === 403, short(r));
    r = await call("GET", "/operators/me", null);
    ok("asking needs a login", r.s === 401, short(r));

    // --- Creating it -----------------------------------------------------------------
    r = await call("POST", "/operators", tok(traveler), { business_name: "x", category: "activity" });
    ok("a traveller cannot create a listing", r.s === 403, short(r));
    r = await call("POST", "/operators", opA.token, { business_name: "", category: "activity" });
    ok("an empty business name is refused", r.s === 400, short(r));
    r = await call("POST", "/operators", opA.token, { business_name: "x", category: "not-a-real-category" });
    ok("an invalid category is refused", r.s === 400, short(r));
    r = await call("POST", "/operators", opA.token, { business_name: "x", category: "activity", website: "example.com" });
    ok("a website with no scheme is refused (the screen must add https://)", r.s === 400, short(r));

    const create = { business_name: `Sunset Dive Co ${stamp}`, category: "activity", description: "Small dive shop.", address: "Jl. Test 1", region: "Nusa Penida", country: "Indonesia", phone: "+62 812 0000 0000", website: "https://example.com" };
    r = await call("POST", "/operators", opA.token, create);
    ok("an operator can create their listing", r.s === 201 && r.d?.business_name === create.business_name && r.d?.tier === "free" && r.d?.is_verified === false, short(r));
    const opAId = r.d.id;
    madeOperators.push(opAId);

    r = await call("POST", "/operators", opA.token, create);
    ok("a second listing for the same operator is refused", r.s === 409, short(r));

    // --- Reading it back ----------------------------------------------------------------
    r = await call("GET", "/operators/me", opA.token);
    ok("GET /operators/me now returns the new listing with every field", r.s === 200 && r.d.id === opAId && r.d.description === create.description && r.d.address === create.address && r.d.region === create.region && r.d.country === create.country && r.d.phone === create.phone && r.d.website === create.website, short(r));
    r = await call("GET", "/operators/me", opB.token);
    ok("a different operator with no listing still gets 404", r.s === 404, short(r));
    r = await call("GET", `/operators/${opAId}`, null);
    ok("the public single-operator route shows the same listing", r.s === 200 && r.d.business_name === create.business_name, short(r));

    // --- Editing it -----------------------------------------------------------------------
    r = await call("PATCH", `/operators/${opAId}`, opB.token, { business_name: "Hijacked" });
    ok("a different operator cannot edit someone else's listing", r.s === 404, short(r));
    r = await call("PATCH", `/operators/${opAId}`, opA.token, { description: "Updated description.", phone: "+62 812 1111 1111" });
    ok("the owner can edit their listing", r.s === 200 && r.d.business_name === create.business_name, short(r));
    r = await call("GET", "/operators/me", opA.token);
    ok("the edit shows up on GET /operators/me", r.d.description === "Updated description." && r.d.phone === "+62 812 1111 1111" && r.d.address === create.address, short(r));
    r = await call("PATCH", `/operators/${opAId}`, opA.token, {});
    ok("an edit with nothing to change is refused rather than silently doing nothing", r.s === 400, short(r));

    // --- A second operator creating their own, separate listing ----------------------------
    r = await call("POST", "/operators", opB.token, { business_name: `Other Business ${stamp}`, category: "food" });
    ok("a different operator can create their own listing", r.s === 201, short(r));
    madeOperators.push(r.d.id);
    r = await call("GET", "/operators/me", opB.token);
    ok("each operator sees only their own listing", r.d.business_name === `Other Business ${stamp}` && r.d.id !== opAId, short(r));
  } catch (e) {
    console.error("SCRIPT ERROR", e);
    fail++;
  } finally {
    if (madeOperators.length) {
      await pool.query("DELETE FROM operator_trust_scores WHERE operator_id = ANY($1::uuid[])", [madeOperators]);
      await pool.query("DELETE FROM listing_claims WHERE operator_id = ANY($1::uuid[])", [madeOperators]);
      await pool.query("DELETE FROM operators WHERE id = ANY($1::uuid[])", [madeOperators]);
    }
    if (madeUsers.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [madeUsers]);
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
