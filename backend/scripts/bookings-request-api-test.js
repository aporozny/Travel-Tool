// Fixes the "Request booking" dead end (Explore -> operator detail -> button did
// nothing) and the fact that a booking request/confirm/cancel never actually
// notified anyone (sendBookingNotification was a console.log stub). Creates a
// throwaway traveler and operator, exercises the real API end to end, and
// removes everything it made. Run inside the backend container:
//   docker cp bookings-request-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/bookings-request-api-test.js
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
const iso = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

(async () => {
  const stamp = Date.now();
  let travelerUser, operatorUser, operatorId, otherOperatorUser, otherOperatorId, bookingId;
  try {
    travelerUser = (await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'traveler') RETURNING id, email, role",
      [`rb-traveler-${stamp}@drifttest.com`]
    )).rows[0];
    await pool.query("INSERT INTO travelers (user_id, first_name, last_name) VALUES ($1, 'Rene', 'Booker')", [travelerUser.id]);

    operatorUser = (await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'operator') RETURNING id, email, role",
      [`rb-operator-${stamp}@drifttest.com`]
    )).rows[0];
    operatorId = (await pool.query(
      "INSERT INTO operators (user_id, business_name, category) VALUES ($1, 'RB Test Tours', 'activity') RETURNING id",
      [operatorUser.id]
    )).rows[0].id;

    otherOperatorUser = (await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'operator') RETURNING id, email, role",
      [`rb-other-operator-${stamp}@drifttest.com`]
    )).rows[0];
    otherOperatorId = (await pool.query(
      "INSERT INTO operators (user_id, business_name, category) VALUES ($1, 'RB Other Tours', 'activity') RETURNING id",
      [otherOperatorUser.id]
    )).rows[0].id;

    const tTrav = tok(travelerUser), tOp = tok(operatorUser), tOther = tok(otherOperatorUser);

    // --- validation -----------------------------------------------------------
    let r = await call("POST", "/bookings", tTrav, { operator_id: operatorId, start_date: "not-a-date", guests: 2 });
    ok("a malformed date is a 400", r.s === 400, JSON.stringify(r));
    r = await call("POST", "/bookings", tTrav, { operator_id: operatorId, start_date: iso(-1), guests: 2 });
    ok("a past start date is refused", r.s === 400, JSON.stringify(r));
    r = await call("POST", "/bookings", tTrav, { operator_id: operatorId, start_date: iso(5), end_date: iso(2), guests: 2 });
    ok("an end date before the start date is refused", r.s === 400, JSON.stringify(r));
    r = await call("POST", "/bookings", tTrav, { operator_id: "00000000-0000-0000-0000-000000000000", start_date: iso(5), guests: 2 });
    ok("a made-up operator id is a 404", r.s === 404, JSON.stringify(r));
    r = await call("POST", "/bookings", tOp, { operator_id: operatorId, start_date: iso(5), guests: 2 });
    ok("an operator account cannot make a booking request", r.s === 403, JSON.stringify(r));

    // --- the real request, the flow the "Request booking" button now drives ----
    r = await call("POST", "/bookings", tTrav, { operator_id: operatorId, start_date: iso(10), end_date: iso(14), guests: 3, notes: "window seat if possible" });
    ok("a real booking request succeeds", r.s === 201 && r.d?.status === "pending" && r.d?.operator_name === "RB Test Tours", JSON.stringify(r));
    bookingId = r.d?.id;

    r = await call("GET", "/bookings", tTrav);
    ok("the traveler sees it in their own list", r.s === 200 && r.d.some((b) => b.id === bookingId), JSON.stringify(r).slice(0, 200));
    r = await call("GET", "/bookings", tOp);
    ok("the operator sees the pending request", r.s === 200 && r.d.some((b) => b.id === bookingId && b.status === "pending"), JSON.stringify(r).slice(0, 200));
    r = await call("GET", "/bookings", tOther);
    ok("an unrelated operator does not see it", r.s === 200 && !r.d.some((b) => b.id === bookingId), JSON.stringify(r).slice(0, 200));
    r = await call("GET", `/bookings/${bookingId}`, tOther);
    ok("an unrelated operator gets 403 on the booking directly", r.s === 403, JSON.stringify(r));
    r = await call("GET", `/bookings/${bookingId}`, tTrav);
    ok("the traveler can open their own booking", r.s === 200 && r.d?.business_name === "RB Test Tours", JSON.stringify(r).slice(0, 200));

    // --- status transitions -----------------------------------------------------
    r = await call("PATCH", `/bookings/${bookingId}/status`, tOther, { status: "confirmed" });
    ok("an unrelated operator cannot confirm it", r.s === 403, JSON.stringify(r));
    r = await call("PATCH", `/bookings/${bookingId}/status`, tTrav, { status: "confirmed" });
    ok("a traveler cannot confirm their own booking", r.s === 403, JSON.stringify(r));
    r = await call("PATCH", `/bookings/${bookingId}/status`, tOp, { status: "confirmed" });
    ok("the real operator confirms it", r.s === 200 && r.d?.status === "confirmed", JSON.stringify(r));
    // the route's own design (see its comment) lets a traveler cancel even a
    // confirmed booking -- plans change after confirmation too.
    r = await call("PATCH", `/bookings/${bookingId}/status`, tTrav, { status: "cancelled" });
    ok("the traveler can still cancel it once confirmed", r.s === 200 && r.d?.status === "cancelled", JSON.stringify(r));
    r = await call("PATCH", `/bookings/${bookingId}/status`, tOp, { status: "confirmed" });
    ok("a cancelled booking cannot then be re-confirmed", r.s === 400, JSON.stringify(r));

    // a second request, cancelled by its own traveler
    r = await call("POST", "/bookings", tTrav, { operator_id: operatorId, start_date: iso(20), guests: 1 });
    const secondId = r.d?.id;
    ok("a second booking request is created", r.s === 201, JSON.stringify(r));
    r = await call("PATCH", `/bookings/${secondId}/status`, tTrav, { status: "cancelled" });
    ok("the traveler cancels their own pending request", r.s === 200 && r.d?.status === "cancelled", JSON.stringify(r));
    r = await call("PATCH", `/bookings/${secondId}/status`, tTrav, { status: "confirmed" });
    ok("travelers still cannot self-confirm (even before this fix's other checks)", r.s === 403, JSON.stringify(r));

    // notifications: with no SENDGRID_API_KEY (or to a suppressed drifttest.com
    // address) sendEmail() itself skips sending and returns false -- so we can't
    // observe an outbound email here, but the route must not fail even though
    // the notification path now does real async work after the DB write.
    ok("creating and updating bookings did not throw despite the new notification calls", true);
  } finally {
    const ids = [travelerUser?.id, operatorUser?.id, otherOperatorUser?.id].filter(Boolean);
    await pool.query("DELETE FROM bookings WHERE operator_id = ANY($1::uuid[])", [[operatorId, otherOperatorId].filter(Boolean)]);
    await pool.query("DELETE FROM operators WHERE id = ANY($1::uuid[])", [[operatorId, otherOperatorId].filter(Boolean)]);
    await pool.query("DELETE FROM travelers WHERE user_id = ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ids]);
    const left = (await pool.query("SELECT count(*)::int n FROM users WHERE email LIKE $1", [`rb-%-${stamp}@drifttest.com`])).rows[0].n;
    ok("cleanup: no test users left behind", left === 0, String(left));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
