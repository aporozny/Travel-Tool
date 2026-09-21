// End-to-end test of trip planning and missed check-in detection, through the
// real HTTP routes and the real monitor, using ONLY a seeded @drifttest.com
// account, so nobody real is ever alerted (the monitor deliberately skips
// alerts for that domain). Cleans up the trips it creates.
//
// Run inside the backend container:
//   docker cp backend/scripts/safety-monitor-api-test.js traveller-backend:/app/sm.js
//   docker exec traveller-backend node /app/sm.js
const jwt = require("/app/node_modules/jsonwebtoken");
const { pool } = require("/app/dist/utils/db");
const { runSafetyMonitor } = require("/app/dist/services/safetyMonitor");
const B = "http://localhost:5000/api/v1";
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -- " + extra : ""}`); };

(async () => {
  const u = (await pool.query("SELECT id, email, role FROM users WHERE email = 'emma.jones@drifttest.com' AND is_active = true")).rows[0];
  const T = jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const call = async (method, path, body) => {
    const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T}` }, body: body ? JSON.stringify(body) : undefined });
    let d; try { d = await r.json(); } catch { d = {}; }
    return { s: r.status, d };
  };
  const trip = async (id) => (await pool.query("SELECT safety_status, overdue_since, overdue_alerted_at, escalation_flagged_at, escalated_at, last_checkin_at FROM member_trips WHERE id = $1", [id])).rows[0];
  const made = [];

  console.log("### PLANNING A TRIP (was always failing)");
  const t1 = await call("POST", "/safety/trips", { destination: "Nusa Penida (test)", region: "Bali", start_date: "2026-11-01", end_date: "2026-11-05", is_public: false });
  check("a trip with plain dates from the Safety form is accepted", t1.s === 201, JSON.stringify(t1.d).slice(0, 120));
  if (t1.d.id) made.push(t1.d.id);
  check("the region is stored, not dropped", t1.d.region === "Bali");
  check("the calendar date is stored as written", String(t1.d.start_date).startsWith("2026-11-01") || String(t1.d.start_date).startsWith("2026-10-31"), String(t1.d.start_date));
  const t2 = await call("POST", "/safety/trips", { destination: "ISO dates (test)", start_date: "2026-11-01T00:00:00+10:00", end_date: "2026-11-02T00:00:00+10:00" });
  check("full ISO datetimes still work", t2.s === 201);
  if (t2.d.id) made.push(t2.d.id);
  const t3 = await call("POST", "/safety/trips", { destination: "No dates (test)" });
  check("dates are optional", t3.s === 201);
  if (t3.d.id) made.push(t3.d.id);
  check("an end date before the start is refused (400)", (await call("POST", "/safety/trips", { destination: "x", start_date: "2026-11-05", end_date: "2026-11-01" })).s === 400);
  check("an impossible date is refused (400)", (await call("POST", "/safety/trips", { destination: "x", start_date: "2026-02-31" })).s === 400);
  check("an empty destination is refused (400)", (await call("POST", "/safety/trips", { destination: "  " })).s === 400);

  console.log("\n### MISSED CHECK-IN DETECTION (was never detected)");
  const id = t1.d.id;
  check("checking in before the trip is started is refused (404)", (await call("POST", "/safety/trips/checkin", { tripId: id })).s === 404);
  check("the trip can be started", (await call("POST", `/safety/trips/${id}/start`)).s === 200);
  check("it is active", (await trip(id)).safety_status === "active");

  await pool.query("UPDATE member_trips SET next_checkin_due = NOW() - interval '5 minutes' WHERE id = $1", [id]);
  await runSafetyMonitor();
  check("5 minutes late is inside the grace period: still active", (await trip(id)).safety_status === "active");

  await pool.query("UPDATE member_trips SET next_checkin_due = NOW() - interval '30 minutes' WHERE id = $1", [id]);
  const run1 = await runSafetyMonitor();
  let s = await trip(id);
  check("30 minutes late: the trip becomes overdue", s.safety_status === "overdue" && !!s.overdue_since, JSON.stringify(run1));
  check("the reviewer step ran and was recorded (nobody real alerted for a test account)", !!s.overdue_alerted_at);
  const again = await runSafetyMonitor();
  check("running again does not repeat it", again.overdue === 0 && again.alerted === 0, JSON.stringify(again));

  await pool.query("UPDATE member_trips SET next_checkin_due = NOW() - interval '2 hours' WHERE id = $1", [id]);
  const run2 = await runSafetyMonitor();
  s = await trip(id);
  check("2 hours late: escalation is considered once and flagged", !!s.escalation_flagged_at && run2.flagged === 1, JSON.stringify(run2));
  check("emergency contacts are NOT messaged automatically (switch is off): status stays overdue", s.safety_status === "overdue" && !s.escalated_at);
  const run3 = await runSafetyMonitor();
  check("and it is flagged only once", run3.flagged === 0 && run3.escalated === 0);

  console.log("\n### CHECKING IN AGAIN");
  const ci = await call("POST", "/safety/trips/checkin", { tripId: id });
  s = await trip(id);
  check("a check-in from an overdue trip returns it to active and clears the tracking", ci.s === 201 && s.safety_status === "active" && !s.overdue_since && !s.overdue_alerted_at && !s.escalation_flagged_at && !!s.last_checkin_at, JSON.stringify(s));

  await pool.query("UPDATE member_trips SET safety_status = 'escalated', escalated_at = NOW() WHERE id = $1", [id]);
  const ci2 = await call("POST", "/safety/trips/checkin", { tripId: id });
  s = await trip(id);
  check("an ESCALATED trip can still be checked in (it used to be locked out)", ci2.s === 201 && s.safety_status === "active" && !s.escalated_at);

  await pool.query("UPDATE member_trips SET safety_status = 'overdue' WHERE id = $1", [id]);
  check("an overdue trip can be completed", (await call("POST", `/safety/trips/${id}/complete`)).s === 200 && (await trip(id)).safety_status === "completed");

  await pool.query("DELETE FROM trip_checkins WHERE trip_id = ANY($1::uuid[])", [made]);
  await pool.query("DELETE FROM member_trips WHERE id = ANY($1::uuid[])", [made]);
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH:", e); process.exit(2); });
