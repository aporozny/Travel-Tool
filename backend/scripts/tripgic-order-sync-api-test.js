// Test of the TripGic order sync (migration 046, services/tripgicOrderSync.ts) and the admin
// "issue the ticket" action.
//
// REAL database and REAL service code, but a FAKE TripGic, a FAKE alert channel and a silent
// "order changed" hook, so nothing is sent to TripGic, emailed, texted or scheduled. The bookings
// that already exist in the database are snapshotted first and put back exactly afterwards.
//   docker cp tripgic-order-sync-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/tripgic-order-sync-api-test.js
const jwt = require("/app/node_modules/jsonwebtoken");
const { pool } = require("/app/dist/utils/db");
const tripgicClient = require("/app/dist/utils/tripgicClient");
const notifications = require("/app/dist/services/notifications");
const tripNotifications = require("/app/dist/services/tripNotifications");
const sync = require("/app/dist/services/tripgicOrderSync");
const booking = require("/app/dist/services/tripgicBooking");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };
const short = (x) => JSON.stringify(x, (k, v) => (v instanceof Error ? { name: v.constructor.name, message: v.message, code: v.code } : v)).slice(0, 260);
const attempt = async (fn) => { try { return { value: await fn() }; } catch (err) { return { err }; } };

// ─── The fakes ──────────────────────────────────────────────────────────────────
const alerts = [];
const changed = [];
notifications.sendReviewerAlert = async (a) => { alerts.push(a); };
tripNotifications.notifyOrderChanged = (source, id) => { changed.push(id); };

const remote = {};              // tracking id -> what the fake TripGic says about it
const calls = { details: 0, issue: 0 };
let unreachable = new Set();    // tracking ids that fail to answer
let issueResult = { status: "success" };
tripgicClient.tripgicPost = async (path, body) => {
  if (path === "/booking-details") {
    calls.details++;
    if (unreachable.has(body.tracking_id)) throw new Error("connect ETIMEDOUT");
    const r = remote[body.tracking_id];
    if (!r) return { status: "failed", reason: "Missing Required Parameters" };
    return { status: "success", booking: { ...r } };
  }
  if (path === "/flight/issue-ticket") {
    calls.issue++;
    if (issueResult.status === "success") remote[body.tracking_id] = { ...remote[body.tracking_id], booking_status: "ticketed", ticket_status: "ticketed" };
    return issueResult;
  }
  throw new Error("unexpected TripGic call " + path);
};

const stamp = Date.now();
let n = 0;
const ts = (d) => String(Math.floor(d.getTime() / 1000));
const hours = (h) => new Date(Date.now() + h * 3600_000);
const holdRemote = (deadline) => ({ booking_status: "hold", ticket_status: "inQues", payment_status: "pending", auto_cancel_timestamp: ts(deadline) });

async function mk(userId, o = {}) {
  const track = `TESTSYNC${stamp}X${++n}`;
  const dl = "deadline" in o ? o.deadline : hours(5);
  const row = (await pool.query(
    `INSERT INTO tripgic_orders (user_id, product_type, quote_id, tripgic_tracking_id, status, title, details, cost_amount, cost_currency, price_charged_amount, price_charged_currency,
       markup_amount, payment_status, fulfilment_error, hold_expires_at, created_at, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,100,'USD',110,'USD',10,'not_collected_sandbox',$8,$9,$10,$11) RETURNING *`,
    [userId, o.product ?? "flight", `TQ${stamp}${n}`, track, o.status ?? "held", o.title ?? `Sync test flight ${n}`,
      JSON.stringify(o.details ?? { slices: [{ departingAt: "2027-06-01T08:00:00" }] }),
      "error" in o ? o.error : "supplier_funding", dl, o.createdAt ?? new Date(Date.now() - 60 * 60_000), o.lastSynced ?? null]
  )).rows[0];
  if (o.remote !== null) remote[track] = o.remote ?? holdRemote(dl ?? hours(5));
  return row;
}
const get = async (id) => (await pool.query("SELECT * FROM tripgic_orders WHERE id = $1", [id])).rows[0];
const ageOwnerAlert = (id) => pool.query("UPDATE tripgic_orders SET owner_alerted_at = NULL WHERE id = $1", [id]);

(async () => {
  // Snapshot every existing booking so it can be restored exactly.
  const snapshot = (await pool.query("SELECT id, status, hold_expires_at, last_synced_at, supplier_status, owner_alerted_at, fulfilment_error, fulfilled_at, cancelled_at, updated_at FROM tripgic_orders")).rows;
  const users = (await pool.query("SELECT id, email, role FROM users WHERE email LIKE '%@drifttest.com' AND role = 'traveler' ORDER BY email LIMIT 2")).rows;
  const admin = (await pool.query("SELECT id, email, role FROM users WHERE email LIKE '%@drifttest.com' AND role = 'admin' ORDER BY email LIMIT 1")).rows[0];
  if (users.length < 2 || !admin) { console.log("Need two seeded travellers and an admin"); process.exit(1); }
  const [A, B] = users;
  const mine = [];
  const make = async (o) => { const r = await mk(A.id, o); mine.push(r.id); return r; };

  try {
    // ── 1. Refreshing one held booking ───────────────────────────────────────────────
    let o = await make({});
    let after = await sync.syncHeldOrder(o);
    ok("a booking that is still on hold stays held and records what TripGic calls it", after.status === "held" && after.supplier_status === "hold/inQues" && after.last_synced_at, short(after));
    ok("an unchanged booking sends no change notice", !changed.includes(o.id));

    o = await make({ deadline: hours(2) });
    remote[o.tripgic_tracking_id] = holdRemote(hours(30)); // TripGic has moved the deadline later
    after = await sync.syncHeldOrder(o);
    ok("a deadline TripGic has moved is followed", Math.abs(new Date(after.hold_expires_at).getTime() - hours(30).getTime()) < 5000 && after.status === "held", short(after.hold_expires_at));
    ok("and the traveller's reminders are told", changed.includes(o.id));

    o = await make({});
    remote[o.tripgic_tracking_id] = { booking_status: "Ticketed", ticket_status: "ticketed", auto_cancel_timestamp: "" };
    after = await sync.syncHeldOrder(o);
    ok("a booking TripGic has ticketed becomes ticketed, with the ticketing error cleared", after.status === "ticketed" && after.fulfilled_at && after.fulfilment_error === null, short(after));
    ok("and the traveller is told", changed.includes(o.id));

    o = await make({});
    remote[o.tripgic_tracking_id] = { booking_status: "Cancelled", ticket_status: "", auto_cancel_timestamp: "" };
    after = await sync.syncHeldOrder(o);
    ok("a booking TripGic has cancelled becomes cancelled", after.status === "cancelled" && after.cancelled_at, short(after));

    o = await make({ product: "hotel", details: { checkInDate: "2027-06-01", checkOutDate: "2027-06-04" } });
    remote[o.tripgic_tracking_id] = { booking_status: "Confirmed", ticket_status: "" };
    after = await sync.syncHeldOrder(o);
    ok("a confirmed stay is 'confirmed', not 'ticketed'", after.status === "confirmed", short(after.status));

    o = await make({});
    unreachable.add(o.tripgic_tracking_id);
    const stamped = (await get(o.id)).updated_at;
    after = await sync.syncHeldOrder(o);
    ok("if TripGic cannot be reached nothing changes and it is not marked as checked", after.status === "held" && (await get(o.id)).last_synced_at === null && (await get(o.id)).updated_at.getTime() === stamped.getTime(), short(after));
    o = await make({ remote: null }); // TripGic answers "failed"
    after = await sync.syncHeldOrder(o);
    ok("an answer that is not a success changes nothing either", after.status === "held" && (await get(o.id)).last_synced_at === null);
    o = await make({ status: "ticketed" });
    const dcalls = calls.details;
    after = await sync.syncHeldOrder(o);
    ok("a booking that is not held is not re-read", after.status === "ticketed" && calls.details === dcalls);

    // ── 2. Expiry uses TripGic's current deadline ─────────────────────────────────────────
    o = await make({ deadline: hours(-1) });
    remote[o.tripgic_tracking_id] = holdRemote(hours(-1));
    let res = await sync.runTripgicOrderSync();
    ok("a booking really past its deadline is confirmed with TripGic and then expired", (await get(o.id)).status === "expired" && changed.includes(o.id) && res.expired >= 1, short(await get(o.id)));

    o = await make({ deadline: hours(-1) });
    remote[o.tripgic_tracking_id] = holdRemote(hours(3)); // our stored deadline was out of date
    await sync.runTripgicOrderSync();
    after = await get(o.id);
    ok("a booking whose deadline TripGic has moved later is NOT expired (the old code would have expired it)", after.status === "held" && new Date(after.hold_expires_at).getTime() > Date.now(), short(after));

    o = await make({ deadline: hours(-1) });
    unreachable.add(o.tripgic_tracking_id);
    await sync.runTripgicOrderSync();
    ok("if TripGic is unreachable, a deadline passed an hour ago is not trusted yet", (await get(o.id)).status === "held");
    o = await make({ deadline: hours(-3) });
    unreachable.add(o.tripgic_tracking_id);
    await sync.runTripgicOrderSync();
    ok("but nothing stays 'held' for ever: three hours past, it expires even unconfirmed", (await get(o.id)).status === "expired");

    o = await make({ deadline: hours(-1) });
    remote[o.tripgic_tracking_id] = { booking_status: "Ticketed", ticket_status: "ticketed" };
    await sync.runTripgicOrderSync();
    ok("a booking TripGic ticketed just before its deadline is ticketed, not expired", (await get(o.id)).status === "ticketed");

    // ── 3. The traveller opening their bookings ─────────────────────────────────────────────
    o = await make({ deadline: hours(-1) });
    remote[o.tripgic_tracking_id] = holdRemote(hours(-1));
    let list = await booking.listTripgicOrders(A.id);
    ok("opening bookings shows an overdue reservation as expired straight away", list.find((x) => x.id === o.id)?.status === "expired", short(list.find((x) => x.id === o.id)));
    o = await make({ deadline: hours(-1) });
    remote[o.tripgic_tracking_id] = holdRemote(hours(4));
    list = await booking.listTripgicOrders(A.id);
    ok("and a reservation whose deadline moved is shown as still reserved", list.find((x) => x.id === o.id)?.status === "held");
    o = await make({});
    remote[o.tripgic_tracking_id] = { booking_status: "Ticketed", ticket_status: "ticketed" };
    await booking.listTripgicOrders(A.id);
    await new Promise((r) => setTimeout(r, 400)); // the background refresh
    ok("opening bookings refreshes the others in the background", (await get(o.id)).status === "ticketed");
    const single = await attempt(() => booking.getTripgicOrder(A.id, o.id));
    ok("opening one booking works as before", single.value?.status === "ticketed", short(single));
    const other = await attempt(() => booking.getTripgicOrder(B.id, o.id));
    ok("and someone else cannot open it", other.err?.code === "not_found", short(other.err));

    // ── 4. Telling the owner ─────────────────────────────────────────────────────────────────
    alerts.length = 0;
    const stuck = await make({ createdAt: new Date(Date.now() - 30 * 60_000), title: `Stuck flight ${stamp}` });
    const fresh = await make({ createdAt: new Date(Date.now() - 3 * 60_000), title: `Brand new flight ${stamp}` });
    const noErr = await make({ error: null, title: `No error flight ${stamp}` });
    const gone = await make({ createdAt: new Date(Date.now() - 30 * 60_000), deadline: hours(-6), title: `Past deadline flight ${stamp}` });
    remote[gone.tripgic_tracking_id] = holdRemote(hours(-6));
    await sync.runTripgicOrderSync();
    const digest = alerts.filter((a) => /reserved but not ticketed/.test(a.subject));
    ok("the owner gets one alert naming a reserved-but-never-ticketed booking", digest.length === 1 && digest[0].body.includes(`Stuck flight ${stamp}`) && digest[0].body.includes("supplier_funding"), short(alerts.map((a) => a.subject)));
    ok("it is labelled a test (sandbox bookings) and says how to fix it", /^\[TEST\]/.test(digest[0].subject) && /issue-ticket/.test(digest[0].body) && digest[0].urgent === false);
    ok("a booking created minutes ago, one with no error, and one already past its deadline are left out", !digest[0].body.includes(`Brand new flight ${stamp}`) && !digest[0].body.includes(`No error flight ${stamp}`) && !digest[0].body.includes(`Past deadline flight ${stamp}`));
    ok("the booking is marked as reported", (await get(stuck.id)).owner_alerted_at !== null);
    alerts.length = 0;
    await sync.runTripgicOrderSync();
    ok("and it is never reported twice", !alerts.some((a) => a.body.includes(`Stuck flight ${stamp}`)));

    // ── 5. Ticketed bookings: watch, warn, never change ───────────────────────────────────────
    alerts.length = 0;
    const t1 = await make({ status: "ticketed", error: null, title: `Ticketed A ${stamp}`, remote: { booking_status: "ticketed", ticket_status: "ticketed" } });
    let r5 = await sync.runTripgicOrderSync();
    let t1After = await get(t1.id);
    ok("a ticketed booking is checked and TripGic's wording is stored", t1After.supplier_status === "ticketed/ticketed" && t1After.last_synced_at && r5.watched >= 1, short(t1After));
    ok("a healthy ticketed booking raises no alert", !alerts.some((a) => a.body.includes(`Ticketed A ${stamp}`)));

    remote[t1.tripgic_tracking_id] = { booking_status: "Cancelled", ticket_status: "ticketed" };
    await pool.query("UPDATE tripgic_orders SET last_synced_at = NOW() - INTERVAL '2 hours' WHERE id = $1", [t1.id]);
    await sync.runTripgicOrderSync();
    t1After = await get(t1.id);
    const cancelAlert = alerts.filter((a) => /cancelled/.test(a.subject) && a.body.includes(`Ticketed A ${stamp}`));
    ok("if TripGic says a ticketed booking is cancelled the owner is told", cancelAlert.length === 1 && cancelAlert[0].body.includes("NOT changed"), short(alerts.map((a) => a.subject)));
    ok("but the booking is left as it was", t1After.status === "ticketed" && t1After.cancelled_at === null);
    await pool.query("UPDATE tripgic_orders SET last_synced_at = NOW() - INTERVAL '2 hours' WHERE id = $1", [t1.id]);
    alerts.length = 0;
    await sync.runTripgicOrderSync();
    ok("and the owner is told once", !alerts.some((a) => a.body.includes(`Ticketed A ${stamp}`)));

    const over = await make({ status: "ticketed", error: null, details: { slices: [{ departingAt: "2020-01-01T08:00:00" }] }, remote: { booking_status: "ticketed", ticket_status: "ticketed" } });
    const dcalls5 = calls.details;
    await sync.runTripgicOrderSync();
    ok("a trip that is over is not re-read, and is not picked again", (await get(over.id)).last_synced_at !== null && (await get(over.id)).supplier_status === null);

    // ── 6. Admin: issue the ticket ───────────────────────────────────────────────────────────
    const h = await make({ deadline: hours(6), title: `Admin ticket ${stamp}` });
    issueResult = { status: "failed", reason: "Insufficient wallet balance" };
    let r6 = await attempt(() => booking.issueTicketForHeldOrder(h.id));
    ok("if TripGic will not issue it (wallet short) the booking stays reserved with the reason recorded", r6.err?.code === "supplier_funding" && r6.err.httpStatus === 502 && (await get(h.id)).status === "held" && (await get(h.id)).fulfilment_error === "supplier_funding", short(r6.err));
    issueResult = { status: "success" };
    const issueBefore = calls.issue;
    r6 = await attempt(() => booking.issueTicketForHeldOrder(h.id));
    after = await get(h.id);
    ok("once it works, the ticket is issued and the booking becomes ticketed", r6.value?.status === "ticketed" && after.status === "ticketed" && after.fulfilled_at && after.fulfilment_error === null && calls.issue === issueBefore + 1, short(r6));
    ok("and the traveller is told", changed.includes(h.id));
    await new Promise((r) => setTimeout(r, 400));
    ok("and what TripGic calls a ticketed booking is recorded, to learn its wording", (await get(h.id)).supplier_status === "ticketed/ticketed", short((await get(h.id)).supplier_status));
    const again = await attempt(() => booking.issueTicketForHeldOrder(h.id));
    ok("asking again does not issue a second ticket", again.err?.code === "not_held" && calls.issue === issueBefore + 1, short(again.err));

    const raced = await make({ deadline: hours(6) });
    remote[raced.tripgic_tracking_id] = { booking_status: "Ticketed", ticket_status: "ticketed" }; // ticketed at TripGic meanwhile
    const issueBefore2 = calls.issue;
    const r7 = await attempt(() => booking.issueTicketForHeldOrder(raced.id));
    ok("a booking already ticketed at TripGic is picked up, never ticketed twice", r7.err?.code === "not_held" && calls.issue === issueBefore2 && (await get(raced.id)).status === "ticketed", short(r7.err));
    const late = await make({ deadline: hours(-0.5) });
    remote[late.tripgic_tracking_id] = holdRemote(hours(-0.5));
    const r8 = await attempt(() => booking.issueTicketForHeldOrder(late.id));
    ok("a reservation past its deadline cannot be ticketed", r8.err?.code === "hold_expired" && calls.issue === issueBefore2, short(r8.err));
    const hotel = await make({ product: "hotel", deadline: null, details: { checkInDate: "2027-06-01" } });
    const r9 = await attempt(() => booking.issueTicketForHeldOrder(hotel.id));
    ok("a stay is not ticketed", r9.err?.code === "not_ticketable", short(r9.err));
    const r10 = await attempt(() => booking.issueTicketForHeldOrder("00000000-0000-4000-8000-000000000000"));
    const r11 = await attempt(() => booking.issueTicketForHeldOrder("not-a-uuid"));
    ok("unknown and malformed ids are 404", r10.err?.httpStatus === 404 && r11.err?.httpStatus === 404, short([r10.err, r11.err]));

    // ── 7. Over HTTP ─────────────────────────────────────────────────────────────────────────────
    const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const http = async (method, p, u) => {
      const r = await fetch("http://localhost:5000/api/v1" + p, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: "Bearer " + tok(u) } : {}) } });
      let d = null; try { d = await r.json(); } catch {}
      return { s: r.status, d };
    };
    let hr = await http("POST", `/tripgic/orders/${h.id}/issue-ticket`, null);
    ok("HTTP: issuing a ticket needs a login", hr.s === 401, short(hr));
    hr = await http("POST", `/tripgic/orders/${h.id}/issue-ticket`, A);
    ok("HTTP: a traveller cannot issue tickets", hr.s === 403, short(hr));
    hr = await http("POST", "/tripgic/orders/00000000-0000-4000-8000-000000000000/issue-ticket", admin);
    ok("HTTP: an admin asking for an unknown booking gets 404", hr.s === 404, short(hr));
    hr = await http("GET", "/tripgic/orders", A);
    ok("HTTP: the traveller's booking list still loads", hr.s === 200 && Array.isArray(hr.d?.orders), short(hr));
  } catch (e) {
    console.error("SCRIPT ERROR", e);
    fail++;
  } finally {
    // ── Cleanup: delete what the test made, restore what it touched ─────────────────────────────
    await pool.query("DELETE FROM tripgic_orders WHERE tripgic_tracking_id LIKE 'TESTSYNC%'");
    for (const s of snapshot) {
      await pool.query(
        `UPDATE tripgic_orders SET status = $2, hold_expires_at = $3, last_synced_at = $4, supplier_status = $5, owner_alerted_at = $6,
           fulfilment_error = $7, fulfilled_at = $8, cancelled_at = $9, updated_at = $10 WHERE id = $1`,
        [s.id, s.status, s.hold_expires_at, s.last_synced_at, s.supplier_status, s.owner_alerted_at, s.fulfilment_error, s.fulfilled_at, s.cancelled_at, s.updated_at]
      );
    }
    const now = (await pool.query("SELECT id, status, hold_expires_at, last_synced_at, supplier_status, owner_alerted_at FROM tripgic_orders WHERE tripgic_tracking_id NOT LIKE 'TESTSYNC%'")).rows;
    const same = now.length === snapshot.length && snapshot.every((s) => { const c = now.find((r) => r.id === s.id); return c && c.status === s.status && String(c.hold_expires_at) === String(s.hold_expires_at) && String(c.last_synced_at) === String(s.last_synced_at) && c.supplier_status === s.supplier_status && String(c.owner_alerted_at) === String(s.owner_alerted_at); });
    ok("cleanup removed the test bookings and put every existing booking back exactly as it was", same, `${now.length} vs ${snapshot.length}`);
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
