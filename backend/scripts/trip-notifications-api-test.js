// End-to-end test for trip reminders, through the real HTTP routes and the
// running sender, against the live TripGic SANDBOX.
//
// Run inside the backend container (it has the env, the database and the worker):
//   docker cp backend/scripts/trip-notifications-api-test.js traveller-backend:/app/tn.js
//   docker exec traveller-backend node /app/tn.js
//
// It uses the seeded test admin (an @drifttest.com address), so trip emails are
// suppressed by design and it never emails a real person. It books one sandbox
// flight (a hold at TripGic, auto-cancelled the same day) and follows the
// notifications from booking to expiry. Takes about 45 seconds because it
// waits for the sender's 30 second cycle. Needs NOTIFICATIONS_WORKER=on.
const jwt = require("/app/node_modules/jsonwebtoken");
const { pool } = require("/app/dist/utils/db");
const { signUnsubscribeToken } = require("/app/dist/services/notificationTokens");
const B = "http://localhost:5000/api/v1";
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -- " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const admin = (await pool.query("SELECT id, email, role FROM users WHERE is_active = true AND role = 'admin' AND email LIKE '%@drifttest.com' LIMIT 1")).rows[0];
  const traveler = (await pool.query("SELECT id, email, role FROM users WHERE is_active = true AND role = 'traveler' LIMIT 1")).rows[0];
  const mk = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "15m" });
  const call = async (method, path, body, tok) => {
    const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let d; try { d = JSON.parse(text); } catch { d = { _text: text }; }
    return { s: r.status, d };
  };
  const A = mk(admin), T = mk(traveler);

  console.log("### ACCESS");
  check("admin tools refuse a regular traveller (403)", (await call("POST", "/notifications/admin/backfill", {}, T)).s === 403 && (await call("POST", "/notifications/admin/process", {}, T)).s === 403 && (await call("POST", "/notifications/admin/test-send", { segmentId: "00000000-0000-4000-8000-000000000000", type: "pre_7d" }, T)).s === 403);
  check("notification lists need a login (401)", (await call("GET", "/notifications", null, null)).s === 401 && (await call("GET", "/notifications/schedule", null, null)).s === 401);
  check("preferences reject a wrong type (400)", (await call("PUT", "/notifications/preferences", { emailEnabled: "yes" }, A)).s === 400);

  console.log("\n### UNSUBSCRIBE");
  const before = (await call("GET", "/notifications/preferences", null, A)).d;
  const tok = signUnsubscribeToken(admin.id);
  const page = await fetch(`${B}/notifications/unsubscribe?token=${encodeURIComponent(tok)}`);
  const html = await page.text();
  const afterGet = (await call("GET", "/notifications/preferences", null, A)).d;
  check("opening the link shows a confirm button and changes nothing", page.status === 200 && /<form method="POST"/.test(html) && afterGet.emailEnabled === before.emailEnabled);
  check("a forged link is refused (400)", (await fetch(`${B}/notifications/unsubscribe?token=${encodeURIComponent(tok.split(".")[0] + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")}`)).status === 400);
  check("no token is refused (400)", (await fetch(`${B}/notifications/unsubscribe`)).status === 400);
  const post = await fetch(`${B}/notifications/unsubscribe?token=${encodeURIComponent(tok)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  const afterPost = (await call("GET", "/notifications/preferences", null, A)).d;
  check("the one-click POST unsubscribes", post.status === 200 && afterPost.emailEnabled === false);
  const consent = (await pool.query("SELECT granted FROM consent_records WHERE user_id = $1 AND type = 'trip_reminders_email' ORDER BY created_at DESC LIMIT 1", [admin.id])).rows[0];
  check("the choice is recorded as a consent change", consent && consent.granted === false);
  const restored = await call("PUT", "/notifications/preferences", { emailEnabled: true, inAppEnabled: true }, A);
  check("turning email back on works", restored.s === 200 && restored.d.emailEnabled === true);

  console.log("\n### BOOKING -> LEGS -> REMINDERS");
  const search = await call("POST", "/flights/search", { origin: "SYD", destination: "DPS", departureDate: "2026-11-15", adults: 1 }, A);
  const offer = (search.d.offers || []).find((o) => o.provider === "tripgic");
  const quote = await call("POST", "/tripgic/flights/quote", { offerId: offer.id }, A);
  const pax = { title: "mr", gender: "m", givenName: "Notify", familyName: "Tester", bornOn: "1990-01-01", passportNumber: "PA1234567", passportCountry: "AU", passportExpiry: "2031-01-01" };
  const order = await call("POST", "/tripgic/flights/orders", { quoteId: quote.d.quoteId, passengers: [pax], contact: { email: "sandbox-test@drifttravel.app", isdCode: "61", phoneNumber: "0400000000" } }, A);
  check("test flight booked", order.s === 201, `${order.d.bookingId} ${order.d.status}`);
  const orderId = order.d.id;

  await sleep(1500);
  const legs = (await pool.query("SELECT * FROM trip_segments WHERE order_id = $1", [orderId])).rows;
  check("one trip leg was created for the booking", legs.length === 1 && legs[0].origin_iata === "SYD" && legs[0].dest_iata === "DPS" && legs[0].status === "active");
  const leg = legs[0];
  check("its departure is an exact moment, in Sydney time (AEDT +11 in November)", leg && new Date(leg.dep_utc).toISOString() === new Date(Date.UTC(+leg.dep_local.slice(0, 4), +leg.dep_local.slice(5, 7) - 1, +leg.dep_local.slice(8, 10), +leg.dep_local.slice(11, 13) - 11, +leg.dep_local.slice(14, 16))).toISOString(), `${leg.dep_local} -> ${new Date(leg.dep_utc).toISOString()}`);
  check("the destination country is known (Indonesia)", leg.dest_country === "ID");
  check("it is marked as a test booking", leg.is_test === true);

  const rows = async () => (await pool.query("SELECT type, channel, status, skip_reason, send_at, expires_at FROM scheduled_notifications WHERE segment_id = $1 ORDER BY send_at, channel", [leg.id])).rows;
  let sched = await rows();
  const types = [...new Set(sched.map((r) => r.type))].sort();
  check("a confirmation and all four reminders are scheduled, each by email and in-app", JSON.stringify(types) === JSON.stringify(["confirmation", "pre_24h", "pre_3h", "pre_72h", "pre_7d"]) && sched.length === 10, `${sched.length} rows: ${types.join(",")}`);
  check("no reminder expires after the flight leaves", sched.every((r) => new Date(r.expires_at) <= new Date(leg.dep_utc) || r.type === "confirmation"));

  // Running the sync again must not create anything new.
  await call("POST", "/notifications/admin/backfill", {}, A);
  check("syncing again creates no duplicates", (await rows()).length === sched.length);

  console.log("   (waiting for the sender's next 30 second cycle...)");
  for (let i = 0; i < 16; i++) { await sleep(5000); sched = await rows(); if (sched.filter((r) => r.type === "confirmation").every((r) => r.status !== "pending" && r.status !== "sending")) break; }
  const conf = sched.filter((r) => r.type === "confirmation");
  const confEmail = conf.find((r) => r.channel === "email"), confApp = conf.find((r) => r.channel === "in_app");
  check("the confirmation email was NOT sent to a test address (suppressed)", confEmail.status === "skipped" && confEmail.skip_reason === "suppressed_recipient", `${confEmail.status}/${confEmail.skip_reason}`);
  check("the in-app confirmation was delivered", confApp.status === "sent");
  const inApp = (await call("GET", "/notifications", null, A)).d;
  const mine = (inApp.notifications || []).find((n) => /reserved/i.test(n.title));
  check("it shows in the traveller's updates, labelled TEST and reserved", !!mine && /^\[TEST\]/.test(mine.title), mine && mine.title);
  const later = sched.filter((r) => r.type !== "confirmation");
  check("the later reminders are still waiting for their moment", later.every((r) => r.status === "pending"));
  const scheduleApi = (await call("GET", "/notifications/schedule", null, A)).d;
  check("the schedule endpoint lists them for the traveller", (scheduleApi.items || []).filter((i) => i.orderId === orderId && i.status === "pending").length === 4);
  check("the traveller can mark updates read", (await call("POST", "/notifications/read-all", {}, A)).s === 200 && ((await call("GET", "/notifications", null, A)).d.unread === 0));

  console.log("\n### THE HOLD LAPSES");
  await pool.query("UPDATE tripgic_orders SET hold_expires_at = NOW() - interval '1 minute' WHERE id = $1", [orderId]);
  const listed = await call("GET", "/tripgic/orders", null, A);
  check("the order now reads as expired", (listed.d.orders || []).find((o) => o.id === orderId)?.status === "expired");
  await sleep(2500);
  const legAfter = (await pool.query("SELECT status FROM trip_segments WHERE id = $1", [leg.id])).rows[0];
  const pendingLeft = (await rows()).filter((r) => r.status === "pending").length;
  check("the trip leg is cancelled and every pending reminder withdrawn", legAfter.status === "cancelled" && pendingLeft === 0, `leg ${legAfter.status}, ${pendingLeft} pending`);

  console.log("\n### HISTORICAL TEST BOOKINGS OF ORDINARY ACCOUNTS NEVER NOTIFY");
  const strays = (await pool.query(
    `SELECT count(*)::int AS n FROM scheduled_notifications n JOIN users u ON u.id = n.user_id JOIN trip_segments s ON s.id = n.segment_id
     WHERE s.is_test AND u.role <> 'admin' AND n.status IN ('pending','sending')`)).rows[0].n;
  check("no pending notification for a test booking belonging to a non-admin", strays === 0, `${strays} found`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH:", e); process.exit(2); });
