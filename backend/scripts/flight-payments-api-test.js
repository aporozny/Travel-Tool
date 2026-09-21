// Test of the Duffel payment ledger and order engine (migration 045, services/flightPayments.ts).
//
// Uses the REAL database and the REAL service code, but a FAKE Duffel and a FAKE alert channel,
// so nothing is charged, booked, emailed or texted. Uses only seeded @drifttest.com accounts and
// removes everything it creates. Run inside the backend container:
//   docker cp flight-payments-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/flight-payments-api-test.js
const jwt = require("/app/node_modules/jsonwebtoken");
const { DuffelError } = require("/app/node_modules/@duffel/api");
const { pool } = require("/app/dist/utils/db");
const duffelClient = require("/app/dist/utils/duffelClient");
const notifications = require("/app/dist/services/notifications");
const tripNotifications = require("/app/dist/services/tripNotifications");
const flights = require("/app/dist/services/flights");
const fp = require("/app/dist/services/flightPayments");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };
const short = (x) => JSON.stringify(x, (k, v) => (v instanceof Error ? { name: v.constructor.name, message: v.message, ...v } : v)).slice(0, 260);
const attempt = async (fn) => { try { return { value: await fn() }; } catch (err) { return { err }; } };

// ─── The fakes ─────────────────────────────────────────────────────────────────
const alerts = [];
notifications.sendReviewerAlert = async (a) => { alerts.push(a); };
tripNotifications.notifyOrderChanged = () => {}; // no reminders for test bookings

const state = { offers: {}, pis: {}, orders: {}, orderError: null, confirmStatus: "succeeded", piGetStatus: {}, calls: { piCreate: 0, piConfirm: 0, piGet: 0, orderCreate: 0, orderGet: 0 } };
let piN = 0, ordN = 0, orderIdOverride = null;
const fake = {
  offers: { get: async (id) => { if (!state.offers[id]) throw duffelErr(404, "not_found", "offer missing"); return { data: state.offers[id] }; } },
  paymentIntents: {
    create: async ({ amount, currency }) => { state.calls.piCreate++; const id = `pit_faketest_${Date.now()}_${++piN}`; state.pis[id] = { id, amount, currency, status: "requires_payment_method", client_token: "tok_" + id, net_amount: null }; return { data: state.pis[id] }; },
    confirm: async (id) => { state.calls.piConfirm++; state.pis[id].status = state.confirmStatus; state.pis[id].net_amount = "230.00"; return { data: state.pis[id] }; },
    get: async (id) => { state.calls.piGet++; return { data: { ...state.pis[id], status: state.piGetStatus[id] ?? state.pis[id].status } }; },
  },
  orders: {
    create: async (params) => {
      state.calls.orderCreate++;
      if (state.orderError) throw state.orderError;
      const offer = state.offers[params.selected_offers[0]];
      const id = orderIdOverride ?? `ord_faketest_${Date.now()}_${++ordN}`;
      const o = { id, booking_reference: "TST" + ordN, slices: offer.slices, passengers: params.passengers.map((p) => ({ id: p.id, title: p.title, given_name: p.given_name, family_name: p.family_name, born_on: p.born_on, gender: p.gender })), total_amount: params.payments[0].amount, total_currency: params.payments[0].currency, metadata: params.metadata };
      state.orders[id] = o;
      return { data: o };
    },
    get: async (id) => { state.calls.orderGet++; return { data: state.orders[id] }; },
  },
};
duffelClient.getDuffelClient = () => fake;

function duffelErr(status, code, message = "x") {
  return new DuffelError({ meta: { status, request_id: "req_1" }, errors: [{ code, type: "invalid_request_error", message, title: message, documentation_url: "" }], headers: new Headers() });
}
const stamp = Date.now();
let offerN = 0;
function newOffer(over = {}) {
  const id = `off_faketest_${stamp}_${++offerN}`;
  state.offers[id] = {
    id, expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), base_amount: "200.00", tax_amount: "40.00", base_currency: "AUD",
    total_amount: "240.00", total_currency: "AUD", passengers: [{ id: "pas_1", type: "adult" }], owner: { name: "Test Air" },
    slices: [{ origin: { iata_code: "SYD" }, destination: { iata_code: "DPS" }, duration: "PT7H", segments: [{ departing_at: "2026-11-15T07:55:00", arriving_at: "2026-11-15T14:00:00", marketing_carrier: { name: "Test Air" }, marketing_carrier_flight_number: "1" }] }],
    ...over,
  };
  return id;
}
const person = { id: "pas_1", title: "mr", gender: "m", givenName: "Sam", familyName: "Lee", bornOn: "1990-02-03", email: "sam@example.com", phoneNumber: "+61412345678" };
const dbPay = async (piId) => (await pool.query("SELECT * FROM flight_payments WHERE duffel_payment_intent_id = $1", [piId])).rows[0];
const orderRows = async (piId) => (await pool.query("SELECT * FROM flight_orders WHERE payment_intent_id = $1", [piId])).rows;
async function paidPayment(userId, offerId, passengers = [person]) {
  const pi = await fp.createCheckoutPaymentIntent({ userId, offerId, passengers });
  await fp.confirmCheckoutPaymentIntent({ userId, paymentIntentId: pi.id });
  return pi;
}

(async () => {
  const users = (await pool.query("SELECT id, email, role FROM users WHERE email LIKE '%@drifttest.com' AND role = 'traveler' ORDER BY email LIMIT 2")).rows;
  const admin = (await pool.query("SELECT id, email, role FROM users WHERE email LIKE '%@drifttest.com' AND role = 'admin' ORDER BY email LIMIT 1")).rows[0];
  if (users.length < 2 || !admin) { console.log("Need two seeded travellers and an admin"); process.exit(1); }
  const [A, B] = users;
  const createdPis = [], blockerOrderIds = [];
  const expectedTotal = flights.computeMarkup(240, await flights.getActiveMarkupRule()).totalAmount.toFixed(2);

  try {
    // ── 1. Creating the payment ─────────────────────────────────────────────────
    const offer1 = newOffer();
    const pi1 = await fp.createCheckoutPaymentIntent({ userId: A.id, offerId: offer1, passengers: [person] });
    createdPis.push(pi1.id);
    let row = await dbPay(pi1.id);
    ok("creating a payment records it in the ledger", row && row.status === "created" && row.user_id === A.id && row.duffel_offer_id === offer1, short(row));
    ok("the ledger holds the marked-up amount the card is charged", row.amount === expectedTotal && row.currency === "AUD" && pi1.amount === expectedTotal, `${row?.amount} vs ${expectedTotal}`);
    ok("the ledger has a readable trip summary and is flagged as a test payment", /^SYD to DPS, \d+ Nov/.test(row.summary) && row.is_test === (process.env.DUFFEL_API_KEY || "").startsWith("duffel_test_"), short(row));
    ok("the passengers are stored with the payment", row.passengers?.[0]?.givenName === "Sam" && row.passengers[0].phoneNumber === "+61412345678", short(row.passengers));

    const before = state.calls.piCreate;
    let r = await attempt(() => fp.createCheckoutPaymentIntent({ userId: A.id, offerId: newOffer({ passengers: [{ id: "pas_1" }, { id: "pas_2" }] }), passengers: [person] }));
    ok("wrong number of passengers is refused before any payment is made", r.err instanceof fp.PaymentError && r.err.status === 400 && state.calls.piCreate === before, short(r.err));
    r = await attempt(() => fp.createCheckoutPaymentIntent({ userId: A.id, offerId: newOffer(), passengers: [{ ...person, id: "someone_else" }] }));
    ok("a passenger who is not on the fare is refused before payment", r.err instanceof fp.PaymentError && r.err.status === 400 && state.calls.piCreate === before, short(r.err));
    r = await attempt(() => fp.createCheckoutPaymentIntent({ userId: A.id, offerId: newOffer({ expires_at: new Date(Date.now() - 60_000).toISOString() }), passengers: [person] }));
    ok("an expired fare is refused before payment", r.err instanceof fp.PaymentError && r.err.status === 409 && state.calls.piCreate === before, short(r.err));

    // ── 2. An order needs a confirmed payment that is the caller's own ───────────
    const ordersBefore = state.calls.orderCreate;
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi1.id }));
    ok("no order for a payment that has not been confirmed", r.err instanceof fp.PaymentError && r.err.status === 409 && state.calls.orderCreate === ordersBefore, short(r.err));
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: "pit_made_up_by_a_caller", passengers: [person] }));
    ok("no order for a payment id that was made up", r.err instanceof fp.PaymentError && r.err.status === 404 && state.calls.orderCreate === ordersBefore, short(r.err));
    r = await attempt(() => fp.placeOrder({ userId: B.id, paymentIntentId: pi1.id }));
    ok("no order (and no confirmation) using someone else's payment", r.err instanceof fp.PaymentError && r.err.status === 404, short(r.err));
    r = await attempt(() => fp.confirmCheckoutPaymentIntent({ userId: B.id, paymentIntentId: pi1.id }));
    ok("someone else cannot confirm your payment either", r.err instanceof fp.PaymentError && r.err.status === 404 && state.calls.piConfirm === 0, short(r.err));

    state.confirmStatus = "requires_action";
    r = await attempt(() => fp.confirmCheckoutPaymentIntent({ userId: A.id, paymentIntentId: pi1.id }));
    ok("a confirm that Duffel does not finish is not treated as paid", r.err instanceof fp.PaymentError && r.err.status === 409 && (await dbPay(pi1.id)).status === "created", short(r.err));
    state.confirmStatus = "succeeded";
    r = await attempt(() => fp.confirmCheckoutPaymentIntent({ userId: A.id, paymentIntentId: pi1.id }));
    row = await dbPay(pi1.id);
    ok("confirming marks the payment paid", r.value?.status === "succeeded" && row.status === "paid" && row.paid_at, short({ r, row }));
    const confirmCalls = state.calls.piConfirm;
    r = await attempt(() => fp.confirmCheckoutPaymentIntent({ userId: A.id, paymentIntentId: pi1.id }));
    ok("confirming twice is harmless and does not call Duffel again", r.value?.status === "succeeded" && state.calls.piConfirm === confirmCalls, short(r));
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi1.id, offerId: "off_some_other_fare" }));
    ok("an order for a different fare than was paid for is refused", r.err instanceof fp.PaymentError && r.err.status === 400 && state.calls.orderCreate === ordersBefore, short(r.err));

    // ── 3. The happy path ─────────────────────────────────────────────────────────
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi1.id, offerId: offer1 }));
    row = await dbPay(pi1.id);
    const orders1 = await orderRows(pi1.id);
    ok("a paid, recorded payment becomes a booking", r.value?.bookingReference && r.value.status === "confirmed" && orders1.length === 1 && orders1[0].user_id === A.id, short({ r, orders1: orders1.length }));
    ok("the supplier was paid from the Balance for exactly the fare, with the payment id in its metadata", state.calls.orderCreate === ordersBefore + 1 && Object.values(state.orders).some((o) => o.metadata?.payment_intent_id === pi1.id && o.total_amount === "240.00"), short(state.calls));
    ok("the booking records what the traveller paid and Drift's markup", Number(orders1[0].price_charged_amount) === Number(expectedTotal) && Number(orders1[0].markup_amount) === Number((Number(expectedTotal) - 240).toFixed(2)) && Number(orders1[0].duffel_cost_amount) === 240, short(orders1[0]));
    const passengerRows = (await pool.query("SELECT * FROM flight_order_passengers WHERE flight_order_id = $1", [orders1[0].id])).rows;
    ok("the passengers are recorded on the booking", passengerRows.length === 1 && passengerRows[0].given_name === "Sam", short(passengerRows));
    ok("the ledger says ordered, links the booking and drops the stored passenger details", row.status === "ordered" && row.flight_order_id === orders1[0].id && row.passengers === null && row.duffel_order_id, short(row));
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi1.id }));
    ok("asking again returns the same booking and books nothing new", r.value?.id === orders1[0].id && state.calls.orderCreate === ordersBefore + 1 && (await orderRows(pi1.id)).length === 1, short(r));

    // ── 4. Two requests at once ───────────────────────────────────────────────────
    const offer2 = newOffer();
    const pi2 = await paidPayment(A.id, offer2); createdPis.push(pi2.id);
    const callsBefore = state.calls.orderCreate;
    const both = await Promise.allSettled([fp.placeOrder({ userId: A.id, paymentIntentId: pi2.id }), fp.placeOrder({ userId: A.id, paymentIntentId: pi2.id })]);
    ok("a double submit books exactly once", state.calls.orderCreate === callsBefore + 1 && (await orderRows(pi2.id)).length === 1, short({ calls: state.calls.orderCreate - callsBefore, rows: (await orderRows(pi2.id)).length }));
    ok("and the caller never sees a raw error from the collision", both.every((x) => x.status === "fulfilled" || x.reason instanceof fp.PaymentError), short(both.map((x) => x.status === "fulfilled" ? "ok" : x.reason?.message)));

    // ── 5. Fare gone after payment: refund needed ─────────────────────────────────
    alerts.length = 0;
    const offer3 = newOffer();
    const pi3 = await paidPayment(A.id, offer3); createdPis.push(pi3.id);
    state.orderError = duffelErr(422, "offer_no_longer_available", "The offer is no longer available");
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi3.id }));
    row = await dbPay(pi3.id);
    ok("an order that fails after payment says so, with a refund needed and no retry", r.err instanceof fp.OrderFailedAfterPayment && r.err.reason === "fare_expired" && r.err.canRetry === false && r.err.refundNeeded === true, short(r.err));
    ok("the traveller is told their payment is safe and will be refunded", /payment is safe/.test(r.err?.message) && /refund it in full/.test(r.err?.message), r.err?.message);
    ok("the ledger records the failure and there is no booking", row.status === "order_failed" && row.error_code === "fare_expired" && row.attempts === 1 && row.retryable === false && (await orderRows(pi3.id)).length === 0, short(row));
    ok("the owner is alerted at once, urgently, and it is labelled a test", alerts.length === 1 && alerts[0].urgent === true && /^\[TEST\] Drift flights: a traveller paid/.test(alerts[0].subject) && alerts[0].body.includes(pi3.id) && alerts[0].body.includes(A.email), short(alerts));
    ok("the alert and the ledger carry Duffel's actual reason, not a blank", /offer_no_longer_available/.test(row.last_error) && /offer_no_longer_available/.test(alerts[0].body), short({ last: row.last_error }));
    state.orderError = null;
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi3.id }));
    ok("retrying something a retry cannot fix is refused with the same calm message", r.err instanceof fp.PaymentError && r.err.status === 409 && /refund/.test(r.err.message), short(r.err));
    let open = await fp.listOpenPayments(A.id);
    let mine = open.find((p) => p.paymentIntentId === pi3.id);
    ok("the traveller can see the payment that needs attention, with a refund option and no retry", mine && mine.canRetry === false && mine.canRequestRefund === true && /refund/.test(mine.message) && mine.amount === Number(expectedTotal) && /SYD to DPS/.test(mine.summary), short(mine));
    ok("other travellers cannot see it", !(await fp.listOpenPayments(B.id)).some((p) => p.paymentIntentId === pi3.id));
    ok("a finished booking is not listed as open", !open.some((p) => p.paymentIntentId === pi1.id));

    alerts.length = 0;
    r = await attempt(() => fp.requestRefund(B.id, pi3.id));
    ok("someone else cannot ask for a refund on your payment", r.err instanceof fp.PaymentError && r.err.status === 404, short(r.err));
    await fp.requestRefund(A.id, pi3.id);
    ok("asking for a refund marks it and alerts the owner", (await dbPay(pi3.id)).status === "refund_requested" && alerts.length === 1 && alerts[0].urgent, short(alerts));
    await fp.requestRefund(A.id, pi3.id);
    ok("asking twice does not alert twice", alerts.length === 1);
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi3.id }));
    ok("no booking once a refund is requested", r.err instanceof fp.PaymentError && /refunded/.test(r.err.message), short(r.err));
    await fp.markRefunded(pi3.id);
    row = await dbPay(pi3.id);
    ok("marking it refunded closes it and clears the stored passenger details", row.status === "refunded" && row.passengers === null, short(row));
    r = await attempt(() => fp.markRefunded(pi3.id));
    ok("a refunded payment cannot be marked again", r.err instanceof fp.PaymentError && r.err.status === 404, short(r.err));
    r = await attempt(() => fp.requestRefund(A.id, pi1.id));
    ok("a flight that is already booked cannot be 'refunded' this way", r.err instanceof fp.PaymentError && r.err.status === 409, short(r.err));

    // ── 6. A hiccup: retry without paying again ───────────────────────────────────
    alerts.length = 0;
    const offer4 = newOffer();
    const pi4 = await paidPayment(A.id, offer4); createdPis.push(pi4.id);
    state.orderError = new Error("socket hang up");
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi4.id }));
    ok("a temporary failure offers a retry and does not promise a refund", r.err instanceof fp.OrderFailedAfterPayment && r.err.reason === "temporary" && r.err.canRetry === true && r.err.refundNeeded === false && !/refund/.test(r.err.message), short(r.err));
    ok("a retryable first failure emails the owner but is not urgent", alerts.length === 1 && alerts[0].urgent === false, short(alerts));
    open = await fp.listOpenPayments(A.id);
    ok("the open payment offers a retry (the passenger details were kept)", open.find((p) => p.paymentIntentId === pi4.id)?.canRetry === true);
    state.orderError = null;
    const calls4 = state.calls.piConfirm, create4 = state.calls.piCreate;
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi4.id }));
    row = await dbPay(pi4.id);
    ok("the retry books it, with no new payment", r.value?.bookingReference && row.status === "ordered" && row.attempts === 2 && state.calls.piConfirm === calls4 && state.calls.piCreate === create4, short({ r, row }));

    // ── 7. Running out of tries ─────────────────────────────────────────────────────
    alerts.length = 0;
    const pi5 = await paidPayment(A.id, newOffer()); createdPis.push(pi5.id);
    state.orderError = new Error("connect ETIMEDOUT");
    const outcomes = [];
    for (let i = 0; i < 3; i++) outcomes.push((await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi5.id }))).err);
    ok("three failures in a row stop offering a retry and ask for a refund", outcomes[0].canRetry && outcomes[1].canRetry && !outcomes[2].canRetry && outcomes[2].refundNeeded, short(outcomes.map((o) => [o.canRetry, o.refundNeeded])));
    ok("the last failure is urgent and the message says a person will handle it", alerts[alerts.length - 1].urgent === true && /a few tries/.test(outcomes[2].message), short(alerts.map((a) => a.urgent)));
    state.orderError = null;
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi5.id }));
    ok("a fourth try is refused", r.err instanceof fp.PaymentError && r.err.status === 409 && (await orderRows(pi5.id)).length === 0, short(r.err));

    // ── 8. The price moved, or the fare expired, between paying and booking ─────────
    const offer6 = newOffer();
    const pi6 = await paidPayment(A.id, offer6); createdPis.push(pi6.id);
    state.offers[offer6].base_amount = "400.00"; state.offers[offer6].total_amount = "440.00";
    const cBefore = state.calls.orderCreate;
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi6.id }));
    ok("if the fare rose above what the card paid, nothing is booked and a refund is needed", r.err?.reason === "price_changed" && r.err.refundNeeded && state.calls.orderCreate === cBefore, short(r.err));
    const offer7 = newOffer();
    const pi7 = await paidPayment(A.id, offer7); createdPis.push(pi7.id);
    state.offers[offer7].expires_at = new Date(Date.now() - 1000).toISOString();
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi7.id }));
    ok("if the fare expired after payment, nothing is booked and a refund is needed", r.err?.reason === "fare_expired" && r.err.refundNeeded && state.calls.orderCreate === cBefore, short(r.err));

    // ── 9. The airline booked it but we could not record it ─────────────────────────
    alerts.length = 0;
    const pi8 = await paidPayment(A.id, newOffer()); createdPis.push(pi8.id);
    orderIdOverride = `ord_faketest_blocker_${stamp}`;
    await pool.query(
      `INSERT INTO flight_orders (user_id, duffel_order_id, source_offer_id, booking_reference, status, slices, duffel_cost_amount, duffel_cost_currency, price_charged_amount, price_charged_currency, markup_amount)
       VALUES ($1, $2, 'blocker', 'BLOCK1', 'confirmed', '[]', 1, 'AUD', 1, 'AUD', 0)`, [A.id, orderIdOverride]);
    blockerOrderIds.push(orderIdOverride);
    const c8 = state.calls.orderCreate;
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi8.id }));
    row = await dbPay(pi8.id);
    ok("if recording fails after the airline booked, the order id is kept and the traveller is told not to pay again", r.err?.reason === "unrecorded_order" && row.duffel_order_id === orderIdOverride && /do not pay again/i.test(r.err.message), short({ err: r.err?.reason, row: row?.duffel_order_id }));
    ok("that is urgent for the owner", alerts.length === 1 && alerts[0].urgent && alerts[0].body.includes(orderIdOverride), short(alerts));
    await pool.query("DELETE FROM flight_orders WHERE duffel_order_id = $1", [orderIdOverride]); // the obstruction goes away
    orderIdOverride = null;
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi8.id }));
    row = await dbPay(pi8.id);
    ok("a retry finishes the recording and never books a second time", r.value?.bookingReference && row.status === "ordered" && state.calls.orderCreate === c8 + 1 && (await orderRows(pi8.id)).length === 1, short({ r, calls: state.calls.orderCreate - c8 }));

    // ── 10. The safety net ────────────────────────────────────────────────────────────
    alerts.length = 0;
    const pi9 = await paidPayment(A.id, newOffer()); createdPis.push(pi9.id);
    await pool.query("UPDATE flight_payments SET status = 'ordering', updated_at = NOW() - INTERVAL '15 minutes' WHERE duffel_payment_intent_id = $1", [pi9.id]);
    let rec = await fp.reconcilePayments();
    row = await dbPay(pi9.id);
    ok("an order that died part-way is marked stuck, not retried blindly, and the owner is told to check Duffel first", rec.stuck >= 1 && row.status === "order_failed" && row.error_code === "stuck" && alerts.some((a) => a.urgent && a.body.includes(pi9.id) && /may already be booked/.test(a.body)), short({ rec, row: row.error_code, alerts: alerts.length }));
    r = await attempt(() => fp.placeOrder({ userId: A.id, paymentIntentId: pi9.id }));
    ok("and it cannot be retried automatically", r.err instanceof fp.PaymentError && r.err.status === 409, short(r.err));

    alerts.length = 0;
    const pi10 = await paidPayment(A.id, newOffer()); createdPis.push(pi10.id);
    await pool.query("UPDATE flight_payments SET updated_at = NOW() - INTERVAL '15 minutes' WHERE duffel_payment_intent_id = $1", [pi10.id]);
    await fp.reconcilePayments();
    ok("a payment that sat paid with no booking (browser closed) is reported to the owner", alerts.some((a) => a.body.includes(pi10.id) && /closed the browser/.test(a.body)), short(alerts.map((a) => a.subject)));
    const n = alerts.length;
    await fp.reconcilePayments();
    ok("and only once", alerts.length === n, `${alerts.length} vs ${n}`);
    const fresh = await paidPayment(A.id, newOffer()); createdPis.push(fresh.id);
    alerts.length = 0;
    await fp.reconcilePayments();
    ok("a payment that is only a minute old is left alone", !alerts.some((a) => a.body.includes(fresh.id)));

    const pi11 = await fp.createCheckoutPaymentIntent({ userId: A.id, offerId: newOffer(), passengers: [person] }); createdPis.push(pi11.id);
    const pi12 = await fp.createCheckoutPaymentIntent({ userId: A.id, offerId: newOffer(), passengers: [person] }); createdPis.push(pi12.id);
    await pool.query("UPDATE flight_payments SET created_at = NOW() - INTERVAL '30 minutes' WHERE duffel_payment_intent_id = ANY($1)", [[pi11.id, pi12.id]]);
    state.piGetStatus[pi11.id] = "succeeded"; // the card WAS captured although our confirm never ran
    alerts.length = 0;
    const gets = state.calls.piGet;
    rec = await fp.reconcilePayments();
    ok("a payment left half-finished is checked with Duffel once", state.calls.piGet - gets === 2 && rec.checked >= 2, short({ gets: state.calls.piGet - gets, rec }));
    ok("if Duffel says it was captured it becomes 'paid' and the owner is told", (await dbPay(pi11.id)).status === "paid" && alerts.some((a) => a.body.includes(pi11.id) && /captured/.test(a.body)), short(alerts.map((a) => a.body.slice(0, 80))));
    ok("if it was never captured it stays as it was and nobody is bothered", (await dbPay(pi12.id)).status === "created" && !alerts.some((a) => a.body.includes(pi12.id)));
    const gets2 = state.calls.piGet;
    await fp.reconcilePayments();
    ok("and it is not checked again", state.calls.piGet === gets2);

    // ── 11. Over HTTP: the routes stay closed to travellers and ask for the right things ─
    const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const http = async (method, p, u, body) => {
      const res = await fetch("http://localhost:5000/api/v1" + p, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: "Bearer " + tok(u) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      let d = null; try { d = await res.json(); } catch {}
      return { s: res.status, d };
    };
    const testKey = (process.env.DUFFEL_API_KEY || "").startsWith("duffel_test_");
    r = await http("POST", "/flights/orders", null, { paymentIntentId: "x" });
    ok("HTTP: placing an order needs a login", r.s === 401, short(r));
    r = await http("POST", "/flights/orders", A, { paymentIntentId: "x" });
    ok("HTTP: while Duffel is on a test key a traveller cannot place an order", !testKey || r.s === 503, short(r));
    r = await http("POST", "/flights/orders", admin, { paymentIntentId: "pit_made_up" });
    ok("HTTP: an order for a made-up payment id is 404 (was: it would have been placed)", r.s === 404, short(r));
    r = await http("POST", "/flights/orders", admin, { offerId: "x" });
    ok("HTTP: an order with no payment id is a 400", r.s === 400, short(r));
    r = await http("POST", "/flights/payment-intents", admin, { offerId: "off_x", passengers: [{ ...person, phoneNumber: "12345" }] });
    ok("HTTP: a bad phone number is refused before any payment starts, in plain words", r.s === 400 && /international/.test(r.d?.message || ""), short(r));
    r = await http("GET", "/flights/payments/pending", A);
    ok("HTTP: the pending list loads for a traveller", r.s === 200 && Array.isArray(r.d?.payments), short(r));
    r = await http("GET", "/flights/payments/pending", null);
    ok("HTTP: the pending list needs a login", r.s === 401, short(r));
    r = await http("POST", "/flights/payments/pit_made_up/mark-refunded", A);
    ok("HTTP: only an admin can mark a refund done", r.s === 403, short(r));
    r = await http("POST", "/flights/payments/pit_made_up/mark-refunded", admin);
    ok("HTTP: marking an unknown payment refunded is 404", r.s === 404, short(r));
    r = await http("POST", "/flights/payments/pit_made_up/refund-request", admin);
    ok("HTTP: a refund request for an unknown payment is 404", r.s === 404, short(r));
    r = await http("POST", "/flights/payments/pit_made_up/retry", admin, {});
    ok("HTTP: a retry for an unknown payment is 404", r.s === 404, short(r));
  } catch (e) {
    console.error("SCRIPT ERROR", e);
    fail++;
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────────────────
    await pool.query("DELETE FROM flight_order_passengers WHERE flight_order_id IN (SELECT id FROM flight_orders WHERE payment_intent_id LIKE 'pit_faketest_%')");
    await pool.query("UPDATE flight_payments SET flight_order_id = NULL WHERE duffel_payment_intent_id LIKE 'pit_faketest_%'");
    await pool.query("DELETE FROM flight_orders WHERE payment_intent_id LIKE 'pit_faketest_%' OR duffel_order_id LIKE 'ord_faketest_%'");
    await pool.query("DELETE FROM flight_payments WHERE duffel_payment_intent_id LIKE 'pit_faketest_%'");
    const left = (await pool.query("SELECT (SELECT count(*) FROM flight_payments WHERE duffel_payment_intent_id LIKE 'pit_faketest_%') AS p, (SELECT count(*) FROM flight_orders WHERE duffel_order_id LIKE 'ord_faketest_%') AS o")).rows[0];
    ok("cleanup left nothing behind", Number(left.p) === 0 && Number(left.o) === 0, short(left));
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
