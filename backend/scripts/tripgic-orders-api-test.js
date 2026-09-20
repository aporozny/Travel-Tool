// End-to-end API test for TripGic booking (flights + hotels) against the
// live TripGic SANDBOX, through the real HTTP routes. Not part of `npm test`
// (that is jest with no network): this places real sandbox holds, which
// TripGic auto-cancels the same day.
//
// Run inside the backend container, which has the env and DB access:
//   docker cp backend/scripts/tripgic-orders-api-test.js traveller-backend:/app/
//   docker exec traveller-backend node /app/tripgic-orders-api-test.js
//
// Needs TRIPGIC_PAYMENT_MODE=sandbox, two admin users and one traveler user.
// Covers: access gate, quote/price consistency, validation, quote ownership,
// idempotent orders, no supplier-text leakage, cancel outcome, hotel rooms ->
// quote -> order. Ticket/voucher issue succeeds only once the TripGic wallet
// is funded; until then the "held" / "503 supplier_funding" outcomes are the
// expected, asserted behaviour.
const jwt = require("/app/node_modules/jsonwebtoken");
const { pool } = require("/app/dist/utils/db");
const B = "http://localhost:5000/api/v1";
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -- " + extra : ""}`); };

(async () => {
  const { rows } = await pool.query("SELECT id, email, role FROM users WHERE is_active = true AND role = 'admin' ORDER BY created_at LIMIT 1");
  const u = rows[0];
  const second = (await pool.query("SELECT id FROM users WHERE is_active = true AND role = 'admin' AND id <> $1 LIMIT 1", [u.id])).rows[0];
  const plain = (await pool.query("SELECT id FROM users WHERE is_active = true AND role = 'traveler' LIMIT 1")).rows[0];
  if (!second || second.id === u.id) throw new Error("need a second active user for the isolation checks");
  const mk = (id) => jwt.sign({ id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "15m" });
  const H = (t) => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  const T = mk(u.id);
  const call = async (method, path, body, tok = T) => {
    const r = await fetch(B + path, { method, headers: H(tok), body: body ? JSON.stringify(body) : undefined });
    let d; try { d = await r.json(); } catch { d = {}; }
    return { s: r.status, d };
  };

  // ---------- ACCESS GATE ----------
  console.log("\n### ACCESS");
  const asTraveler = mk(plain.id);
  const st1 = await call("GET", "/tripgic/status", null, asTraveler);
  check("status: regular traveller sees booking disabled", st1.s === 200 && st1.d.bookingEnabled === false);
  const st2 = await call("GET", "/tripgic/status");
  check("status: admin sees booking enabled (sandbox)", st2.s === 200 && st2.d.bookingEnabled === true && st2.d.sandbox === true);
  const gq = await call("POST", "/tripgic/flights/quote", { offerId: "abc:def" }, asTraveler);
  check("regular traveller cannot quote (503)", gq.s === 503);
  const gr = await call("POST", "/tripgic/hotels/rooms", { hotelId: "H1EA00004#8375388", checkInDate: "2026-11-15", checkOutDate: "2026-11-18" }, asTraveler);
  check("regular traveller cannot list rooms (503)", gr.s === 503);
  const gl = await call("GET", "/tripgic/orders", null, asTraveler);
  check("regular traveller can still list own (empty) orders", gl.s === 200 && Array.isArray(gl.d.orders));

  // Duffel is on a test key: booking must be closed to regular travellers at the API, not just hidden in the UI.
  const dq = await call("POST", "/flights/payment-intents", { offerId: "off_does_not_exist" }, asTraveler);
  check("Duffel test mode: regular traveller cannot start checkout (503)", dq.s === 503 && /not yet available/i.test(dq.d.message || ""), `${dq.s} ${JSON.stringify(dq.d).slice(0, 100)}`);
  const dc = await call("POST", "/flights/payment-intents/confirm", { paymentIntentId: "pit_x" }, asTraveler);
  check("Duffel test mode: regular traveller cannot confirm payment (503)", dc.s === 503);
  const dorder = await call("POST", "/flights/orders", { offerId: "off_x", paymentIntentId: "pit_x", passengers: [{ id: "p", title: "mr", gender: "m", givenName: "A", familyName: "B", bornOn: "1990-01-01", email: "a@b.co", phoneNumber: "+61400000000" }] }, asTraveler);
  check("Duffel test mode: regular traveller cannot place an order (503)", dorder.s === 503);
  const dadmin = await call("POST", "/flights/payment-intents", { offerId: "off_does_not_exist" });
  check("Duffel test mode: admin is NOT blocked by the gate (fails later, on the fake offer)", !(dadmin.s === 503 && /not yet available/i.test(dadmin.d.message || "")), `${dadmin.s} ${JSON.stringify(dadmin.d).slice(0, 100)}`);
  const dsearch = await call("POST", "/flights/search", { origin: "SYD", destination: "DPS", departureDate: "2026-11-15", adults: 1 }, asTraveler);
  check("regular traveller can still search flights", dsearch.s === 200 && dsearch.d.offers?.length > 0);

  // ---------- FLIGHTS ----------
  console.log("\n### FLIGHTS");
  const search = await call("POST", "/flights/search", { origin: "SYD", destination: "DPS", departureDate: "2026-11-15", adults: 1 });
  const offer = search.d.offers.filter((o) => o.provider === "tripgic")[0];
  check("search returns tripgic offers", !!offer, offer && `${offer.airline} ${offer.totalAmount} ${offer.currency}`);

  const q = await call("POST", "/tripgic/flights/quote", { offerId: offer.id });
  check("quote 200", q.s === 200, JSON.stringify(q.d).slice(0, 200));
  check("quote price equals search price (markup consistent)", Math.abs(q.d.totalAmount - offer.totalAmount) < 0.011, `${q.d.totalAmount} vs ${offer.totalAmount}`);
  check("quote not price-changed", q.d.priceChanged === false);
  console.log("   quote:", q.d.quoteId, q.d.title, "| doc:", q.d.docRequired, "| hold:", q.d.holdPossible, "| pax:", q.d.adultCount);

  const pax = { title: "mr", gender: "m", givenName: "Sandbox", familyName: "Tester", bornOn: "1990-01-01", passportNumber: "PA1234567", passportCountry: "AU", passportExpiry: "2031-01-01" };
  const contact = { email: "sandbox-test@drifttravel.app", isdCode: "61", phoneNumber: "0400000000" };

  const bad1 = await call("POST", "/tripgic/flights/orders", { quoteId: q.d.quoteId, passengers: [pax, pax], contact });
  check("wrong passenger count -> 400", bad1.s === 400 && bad1.d.code === "passenger_count", JSON.stringify(bad1.d).slice(0, 120));
  const { passportNumber, ...noPassport } = pax;
  const bad2 = await call("POST", "/tripgic/flights/orders", { quoteId: q.d.quoteId, passengers: [noPassport], contact });
  check("missing passport -> 400", bad2.s === 400 && bad2.d.code === "passport_required", JSON.stringify(bad2.d).slice(0, 120));
  const bad3 = await call("POST", "/tripgic/flights/orders", { quoteId: "NOSUCHQUOTE123", passengers: [pax], contact });
  check("unknown quote -> 410", bad3.s === 410, JSON.stringify(bad3.d).slice(0, 120));
  const otherUser = mk(second.id);
  const bad4 = await call("POST", "/tripgic/flights/orders", { quoteId: q.d.quoteId, passengers: [pax], contact }, otherUser);
  check("another user quote -> 410 (indistinguishable from unknown)", bad4.s === 410, JSON.stringify(bad4.d).slice(0, 120));
  const bad5 = await call("POST", "/tripgic/flights/orders", { quoteId: q.d.quoteId, passengers: [pax], contact: { ...contact, phoneNumber: "abc" } });
  check("bad phone -> 400 validation", bad5.s === 400);

  const o1 = await call("POST", "/tripgic/flights/orders", { quoteId: q.d.quoteId, passengers: [pax], contact });
  console.log("   order:", o1.s, JSON.stringify(o1.d).slice(0, 700));
  check("order created (201)", o1.s === 201);
  check("order is held or ticketed", ["held", "ticketed"].includes(o1.d.status), o1.d.status);
  check("order flagged as sandbox / not collected", o1.d.paymentStatus === "not_collected_sandbox");
  check("no raw supplier text leaked", !JSON.stringify(o1.d).match(/balance|available/i));

  const o2 = await call("POST", "/tripgic/flights/orders", { quoteId: q.d.quoteId, passengers: [pax], contact });
  check("repeat submit is idempotent (same order id)", o2.s === 201 && o2.d.id === o1.d.id);
  const cnt = await pool.query("SELECT count(*)::int AS n, max(cost_amount) AS cost, max(markup_amount) AS markup, max(price_charged_amount) AS charged, max(fulfilment_error) AS err FROM tripgic_orders WHERE quote_id = $1", [q.d.quoteId]);
  check("exactly one DB row for the quote", cnt.rows[0].n === 1, JSON.stringify(cnt.rows[0]));
  check("charged equals cost plus markup", Math.abs(+cnt.rows[0].charged - (+cnt.rows[0].cost + +cnt.rows[0].markup)) < 0.011);

  const list = await call("GET", "/tripgic/orders");
  check("order appears in my orders", list.d.orders?.some((x) => x.id === o1.d.id));
  const other = await call("GET", `/tripgic/orders/${o1.d.id}`, null, otherUser);
  check("another user cannot read the order (404)", other.s === 404);

  if (o1.d.status === "held") {
    const one = await call("GET", `/tripgic/orders/${o1.d.id}`);
    check("single-order read (with TripGic sync) works, still held", one.s === 200 && one.d.status === "held", `${one.s} ${one.d.status} hold_expires=${one.d.holdExpiresAt}`);
    const cx = await call("POST", `/tripgic/orders/${o1.d.id}/cancel`);
    // TripGic sandbox refuses API cancels (confirmed with a fresh, never-ticketed hold) -- the honest outcome is a clean 502, order untouched.
    check("cancel: succeeds, or fails cleanly without marking cancelled", (cx.s === 200 && cx.d.status === "cancelled") || (cx.s === 502 && cx.d.code === "cancel_failed"), `${cx.s} ${JSON.stringify(cx.d).slice(0, 160)}`);
    const after = await call("GET", `/tripgic/orders/${o1.d.id}`);
    check("order status matches cancel outcome", cx.s === 200 ? after.d.status === "cancelled" : after.d.status === "held");
  }

  // ---------- HOTELS ----------
  console.log("\n### HOTELS");
  const rooms = await call("POST", "/tripgic/hotels/rooms", { hotelId: "H1EA00004#8375388", checkInDate: "2026-11-15", checkOutDate: "2026-11-18", rooms: 1, adults: 2 });
  check("rooms 200", rooms.s === 200 && rooms.d.rooms?.length > 0, `${rooms.d.rooms?.length} rooms`);
  console.log("   cheapest room:", JSON.stringify(rooms.d.rooms?.[0]).slice(0, 400));
  const hq = await call("POST", "/tripgic/hotels/quote", { trackingId: rooms.d.trackingId, roomTrackingId: rooms.d.rooms[0].roomTrackingId });
  check("hotel quote 200", hq.s === 200, JSON.stringify(hq.d).slice(0, 300));
  check("hotel quote price equals room price", Math.abs(hq.d.totalAmount - rooms.d.rooms[0].totalAmount) < 0.011, `${hq.d.totalAmount} vs ${rooms.d.rooms[0].totalAmount}`);
  const guests = [{ title: "mr", gender: "m", givenName: "Sandbox", familyName: "Tester" }, { title: "ms", gender: "f", givenName: "Sandy", familyName: "Tester" }];
  const bh = await call("POST", "/tripgic/hotels/orders", { quoteId: hq.d.quoteId, guests: [guests[0]], contact });
  check("hotel wrong guest count -> 400", bh.s === 400 && bh.d.code === "guest_count");
  const ho = await call("POST", "/tripgic/hotels/orders", { quoteId: hq.d.quoteId, guests, contact });
  console.log("   hotel order:", ho.s, JSON.stringify(ho.d).slice(0, 400));
  check("hotel order: 201 (funded) or clean 503 (wallet empty)", ho.s === 201 || (ho.s === 503 && ho.d.code === "supplier_funding"));
  check("hotel 503 leaks no wallet detail", !JSON.stringify(ho.d).match(/balance|0\.00/i));
  const hn = await pool.query("SELECT count(*)::int AS n FROM tripgic_orders WHERE quote_id = $1", [hq.d.quoteId]);
  check("failed hotel booking left no order row (or one if it succeeded)", ho.s === 201 ? hn.rows[0].n === 1 : hn.rows[0].n === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH:", e); process.exit(2); });
