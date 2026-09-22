// Test of the Duffel webhook receiver (routes/webhooks.ts, services/duffelWebhooks.ts).
//
// Uses the REAL database and REAL service code for handleDuffelWebhookEvent, but a FAKE
// sendReviewerAlert, so nothing is actually emailed/texted for a fake test event. Also fires
// a few real HTTP requests at the running server for the paths that can't trigger an alert
// (order-not-found, bad signature), to prove the raw-body middleware in index.ts is actually
// wired the way services/duffelWebhooks.ts expects. Uses only a seeded @drifttest.com account
// and removes everything it creates. Run inside the backend container:
//   docker cp duffel-webhook-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/duffel-webhook-api-test.js
const crypto = require("crypto");
const http = require("http");
const { pool } = require("/app/dist/utils/db");
const notifications = require("/app/dist/services/notifications");
const webhooks = require("/app/dist/services/duffelWebhooks");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };

const alerts = [];
notifications.sendReviewerAlert = async (a) => { alerts.push(a); };

const stamp = Date.now();
const sign = (secret, timestamp, bodyStr) => `t=${timestamp},v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(bodyStr).digest("hex")}`;

function post(path, bodyStr, headers) {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: "localhost", port: 5000, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr), ...headers } }, (res) => {
			let data = "";
			res.on("data", (c) => (data += c));
			res.on("end", () => resolve({ status: res.statusCode, body: data }));
		});
		req.on("error", reject);
		req.end(bodyStr);
	});
}

(async () => {
	const A = (await pool.query("SELECT id, email FROM users WHERE email LIKE '%@drifttest.com' AND role = 'traveler' ORDER BY email LIMIT 1")).rows[0];
	if (!A) { console.log("No seeded @drifttest.com traveler found -- aborting"); process.exit(1); }

	const orderId = `ord_faketest_webhook_${stamp}`;
	await pool.query(
		`INSERT INTO flight_orders (user_id, duffel_order_id, source_offer_id, booking_reference, status, slices, duffel_cost_amount, duffel_cost_currency, price_charged_amount, price_charged_currency, markup_amount)
		 VALUES ($1, $2, 'src-offer', 'WEBHK1', 'confirmed', '[]', 100, 'AUD', 108, 'AUD', 8)`,
		[A.id, orderId]
	);

	try {
		// ── 1. In-process: a cancellation (no replacement slices) is recorded and alerts ──
		alerts.length = 0;
		const cancelEvent = { id: `wev_cancel_${stamp}`, type: "order.airline_initiated_change_detected", data: { object: { order_id: orderId, added: [], removed: [{ id: "old-slice" }] } } };
		await webhooks.handleDuffelWebhookEvent(cancelEvent);
		let rows = (await pool.query("SELECT * FROM flight_order_events WHERE duffel_event_id = $1", [cancelEvent.id])).rows;
		ok("a full cancellation (added=[]) is recorded as event_type='cancellation'", rows.length === 1 && rows[0].event_type === "cancellation", JSON.stringify(rows[0]));
		ok("the owner is alerted, marked urgent, naming the booking reference", alerts.length === 1 && alerts[0].urgent && alerts[0].body.includes("WEBHK1"), JSON.stringify(alerts));

		// ── 2. A retried delivery of the same event id does not double-record or double-alert ──
		alerts.length = 0;
		await webhooks.handleDuffelWebhookEvent(cancelEvent);
		rows = (await pool.query("SELECT * FROM flight_order_events WHERE duffel_event_id = $1", [cancelEvent.id])).rows;
		ok("a retried delivery inserts no second row", rows.length === 1);
		ok("a retried delivery sends no second alert", alerts.length === 0);

		// ── 3. A schedule change (replacement slices offered) is recorded differently ──
		alerts.length = 0;
		const changeEvent = { id: `wev_change_${stamp}`, type: "order.airline_initiated_change_detected", data: { object: { order_id: orderId, added: [{ id: "new-slice" }], removed: [{ id: "old-slice" }] } } };
		await webhooks.handleDuffelWebhookEvent(changeEvent);
		rows = (await pool.query("SELECT * FROM flight_order_events WHERE duffel_event_id = $1", [changeEvent.id])).rows;
		ok("a change with replacement slices is recorded as event_type='schedule_change'", rows.length === 1 && rows[0].event_type === "schedule_change", JSON.stringify(rows[0]));
		ok("old_slices/new_slices are stored as given", JSON.stringify(rows[0].old_slices) === JSON.stringify([{ id: "old-slice" }]) && JSON.stringify(rows[0].new_slices) === JSON.stringify([{ id: "new-slice" }]));

		// ── 4. An event for an order Drift has no record of does not crash or alert ──
		alerts.length = 0;
		const unknownEvent = { id: `wev_unknown_${stamp}`, type: "order.airline_initiated_change_detected", data: { object: { order_id: "ord_does_not_exist", added: [], removed: [] } } };
		await webhooks.handleDuffelWebhookEvent(unknownEvent);
		ok("an unrecognised order id inserts nothing and alerts nobody", alerts.length === 0 && (await pool.query("SELECT 1 FROM flight_order_events WHERE duffel_event_id = $1", [unknownEvent.id])).rows.length === 0);

		// ── 5. Event types Drift doesn't act on are no-ops, not errors ──
		await webhooks.handleDuffelWebhookEvent({ id: "wev_ping", type: "ping.triggered" });
		await webhooks.handleDuffelWebhookEvent({ id: "wev_created", type: "order.created", data: { object: {} } });
		ok("ping.triggered and order.created are ignored without throwing", true);

		// ── 6. A malformed data.object is logged and skipped, not thrown ──
		alerts.length = 0;
		await webhooks.handleDuffelWebhookEvent({ id: "wev_bad", type: "order.airline_initiated_change_detected", data: { object: { order_id: orderId } } });
		ok("a payload missing added/removed is skipped rather than crashing", alerts.length === 0);

		// ── 7. Real HTTP: the raw-body route actually verifies signatures end to end ──
		const secret = process.env.DUFFEL_WEBHOOK_SECRET;
		if (!secret) {
			console.log("SKIP  HTTP-layer checks -- DUFFEL_WEBHOOK_SECRET not set in this container's env");
		} else {
			const unknownBody = JSON.stringify({ id: `wev_http_unknown_${stamp}`, type: "order.airline_initiated_change_detected", data: { object: { order_id: "ord_does_not_exist_http", added: [], removed: [] } } });
			const ts = Math.floor(Date.now() / 1000);
			const good = await post("/api/v1/webhooks/duffel", unknownBody, { "X-Duffel-Signature": sign(secret, ts, unknownBody) });
			ok("a correctly signed request for an unknown order still gets a 200 ack over real HTTP", good.status === 200, JSON.stringify(good));

			const bad = await post("/api/v1/webhooks/duffel", unknownBody, { "X-Duffel-Signature": sign("wrong-secret", ts, unknownBody) });
			ok("a wrongly signed request is rejected 401 over real HTTP", bad.status === 401, JSON.stringify(bad));

			const missing = await post("/api/v1/webhooks/duffel", unknownBody, {});
			ok("a request with no signature header is rejected 401 over real HTTP", missing.status === 401, JSON.stringify(missing));
		}
	} finally {
		await pool.query("DELETE FROM flight_order_events WHERE flight_order_id = (SELECT id FROM flight_orders WHERE duffel_order_id = $1)", [orderId]);
		await pool.query("DELETE FROM flight_orders WHERE duffel_order_id = $1", [orderId]);
	}

	console.log(`\n${pass} passed, ${fail} failed`);
	await pool.end();
	process.exit(fail > 0 ? 1 : 0);
})().catch(async (err) => {
	console.error("Test crashed:", err);
	try { await pool.query("DELETE FROM flight_order_events WHERE flight_order_id = (SELECT id FROM flight_orders WHERE duffel_order_id LIKE 'ord_faketest_webhook_%')"); await pool.query("DELETE FROM flight_orders WHERE duffel_order_id LIKE 'ord_faketest_webhook_%'"); } catch {}
	process.exit(1);
});
