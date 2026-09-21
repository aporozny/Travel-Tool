import { pool } from "../utils/db";
import { getDuffelClient, isDuffelTestMode } from "../utils/duffelClient";
import { reverifyOffer, applyMarkup } from "./flights";
import { notifyOrderChanged } from "./tripNotifications";
import { sendReviewerAlert } from "./notifications";
import {
	OrderPlacementError, classifyOrderError, describeError, canRetryAfter, needsRefund, travellerMessage, paymentCoversPrice,
	validatePassengersForOffer, type OrderFailureCode, type PassengerInput,
} from "./flightPaymentRules";

// The Duffel checkout, with a record of every payment.
//
//   create payment intent  ->  traveller's card is authorised in the browser
//   confirm                ->  Duffel captures the card and credits Drift's Balance
//   place order            ->  the booking, paid from that Balance
//
// Every step is recorded in flight_payments (migration 045). The order is only ever placed
// for a payment that is recorded, belongs to that user, is for that fare, is confirmed
// paid, and has not already been used. If the order step fails after the card was charged
// the row says so, the traveller can retry without paying again, and the owner is told.

export class PaymentError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

// Thrown after an order attempt failed and the ledger already says so. The route turns it
// into the "your payment is safe" answer.
export class OrderFailedAfterPayment extends Error {
	constructor(
		public paymentIntentId: string,
		public reason: OrderFailureCode,
		public canRetry: boolean,
		public refundNeeded: boolean,
		message: string
	) {
		super(message);
	}
}

interface PaymentRow {
	id: string;
	duffel_payment_intent_id: string;
	user_id: string;
	duffel_offer_id: string;
	summary: string | null;
	amount: string;
	currency: string;
	status: string;
	passengers: PassengerInput[] | null;
	flight_order_id: string | null;
	duffel_order_id: string | null;
	attempts: number;
	last_error: string | null;
	error_code: string | null;
	retryable: boolean | null;
	is_test: boolean;
	alerted_at: string | null;
	paid_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface PaymentIntentView {
	id: string;
	clientToken: string;
	amount: string;
	currency: string;
	status: string | null;
}

export interface PlacedOrder {
	id: string;
	bookingReference: string;
	status: string;
}

// "SYD to DPS, 15 Nov" (or both directions for a return trip), for messages.
function describeOffer(offer: any): string {
	const slices: any[] = offer.slices ?? [];
	const leg = (s: any) => `${s.origin?.iata_code ?? "?"} to ${s.destination?.iata_code ?? "?"}`;
	const first = slices[0]?.segments?.[0]?.departing_at;
	const date = first ? new Date(first).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "";
	return `${slices.map(leg).join(", ")}${date ? `, ${date}` : ""}`;
}

async function loadPayment(paymentIntentId: string, userId: string): Promise<PaymentRow> {
	const { rows } = await pool.query("SELECT * FROM flight_payments WHERE duffel_payment_intent_id = $1 AND user_id = $2", [paymentIntentId, userId]);
	// Someone else's payment and a payment that does not exist look the same on purpose.
	if (!rows.length) throw new PaymentError(404, "Payment not found");
	return rows[0];
}

// ─── Step 1: create the payment intent ───────────────────────────────────────

export async function createCheckoutPaymentIntent(params: { userId: string; offerId: string; passengers?: PassengerInput[] }): Promise<PaymentIntentView> {
	const duffel = getDuffelClient();
	const offer = await reverifyOffer(params.offerId);
	if (new Date(offer.expires_at) < new Date()) throw new PaymentError(409, "This fare has expired -- please search again");

	// Bad passenger details are caught here, before any money moves.
	if (params.passengers) {
		const problem = validatePassengersForOffer(params.passengers, (offer.passengers ?? []).map((p) => p.id));
		if (problem) throw new PaymentError(400, problem);
	}

	const baseAmount = parseFloat(offer.base_amount) + (offer.tax_amount ? parseFloat(offer.tax_amount) : 0);
	const { totalAmount } = await applyMarkup(baseAmount);

	const response = await duffel.paymentIntents.create({ amount: totalAmount.toFixed(2), currency: offer.total_currency });
	await pool.query(
		`INSERT INTO flight_payments (duffel_payment_intent_id, user_id, duffel_offer_id, summary, amount, currency, passengers, is_test)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[response.data.id, params.userId, offer.id, describeOffer(offer), response.data.amount, response.data.currency,
			params.passengers ? JSON.stringify(params.passengers) : null, isDuffelTestMode()]
	);
	return {
		id: response.data.id,
		clientToken: response.data.client_token,
		amount: response.data.amount,
		currency: response.data.currency,
		status: response.data.status,
	};
}

// ─── Step 2: confirm (Duffel captures the card and credits the Balance) ─────

export async function confirmCheckoutPaymentIntent(params: { userId: string; paymentIntentId: string }): Promise<{ status: string | null; netAmount: string | null }> {
	const pay = await loadPayment(params.paymentIntentId, params.userId);
	// Confirming twice (a double click, a retry after a dropped connection) is harmless.
	if (["paid", "ordering", "ordered", "order_failed"].includes(pay.status)) return { status: "succeeded", netAmount: null };
	if (pay.status !== "created") throw new PaymentError(409, "This payment can no longer be confirmed");

	const duffel = getDuffelClient();
	const response = await duffel.paymentIntents.confirm(params.paymentIntentId);
	if (response.data.status !== "succeeded") {
		throw new PaymentError(409, "Your payment was not completed. Please try again, or use a different card.");
	}
	await pool.query("UPDATE flight_payments SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'created'", [pay.id]);
	return { status: response.data.status, netAmount: response.data.net_amount };
}

// ─── Step 3: place the order ─────────────────────────────────────────────────

async function existingOrder(flightOrderId: string): Promise<PlacedOrder> {
	const { rows } = await pool.query("SELECT id, booking_reference, status FROM flight_orders WHERE id = $1", [flightOrderId]);
	return { id: rows[0].id, bookingReference: rows[0].booking_reference, status: rows[0].status };
}

export function canRetryOrder(pay: Pick<PaymentRow, "error_code" | "attempts" | "duffel_order_id">): boolean {
	// If the airline already booked it, a retry only finishes recording: always safe.
	return !!pay.duffel_order_id || canRetryAfter((pay.error_code ?? "temporary") as OrderFailureCode, pay.attempts);
}

export async function placeOrder(params: { userId: string; paymentIntentId: string; offerId?: string; passengers?: PassengerInput[] }): Promise<PlacedOrder> {
	const pay = await loadPayment(params.paymentIntentId, params.userId);
	if (params.offerId && params.offerId !== pay.duffel_offer_id) throw new PaymentError(400, "This payment is for a different fare.");

	if (pay.status === "ordered" && pay.flight_order_id) return existingOrder(pay.flight_order_id); // a repeat call returns the same booking
	if (pay.status === "created") throw new PaymentError(409, "This payment has not been completed yet.");
	if (pay.status === "refund_requested" || pay.status === "refunded") throw new PaymentError(409, "This payment is being refunded.");
	if (pay.status === "ordering") throw new PaymentError(409, "This booking is already being completed. Please wait a moment.");
	if (pay.status === "order_failed" && !canRetryOrder(pay)) {
		throw new PaymentError(409, travellerMessage((pay.error_code ?? "temporary") as OrderFailureCode, pay.attempts));
	}

	// Claim the payment: only one request can move it to 'ordering'.
	const claimed = await pool.query(
		`UPDATE flight_payments
		    SET status = 'ordering', attempts = attempts + 1, updated_at = NOW(), passengers = COALESCE($2::jsonb, passengers)
		  WHERE id = $1 AND status IN ('paid', 'order_failed')
		  RETURNING *`,
		[pay.id, params.passengers ? JSON.stringify(params.passengers) : null]
	);
	if (!claimed.rows.length) {
		const again = await loadPayment(params.paymentIntentId, params.userId);
		if (again.status === "ordered" && again.flight_order_id) return existingOrder(again.flight_order_id);
		throw new PaymentError(409, "This booking is already being completed. Please wait a moment.");
	}
	const row: PaymentRow = claimed.rows[0];

	try {
		return await performOrder(row);
	} catch (err) {
		throw await recordFailure(row, err);
	}
}

async function performOrder(row: PaymentRow): Promise<PlacedOrder> {
	const duffel = getDuffelClient();

	// The airline already booked this on an earlier try and only our recording failed:
	// finish recording, never book twice.
	if (row.duffel_order_id) {
		const order = (await duffel.orders.get(row.duffel_order_id)).data;
		const cost = parseFloat(order.total_amount);
		const charged = parseFloat(row.amount);
		return recordOrder(row, { order, sourceOfferId: row.duffel_offer_id, cost, currency: order.total_currency, charged, markup: charged - cost, ruleId: null });
	}

	const offer = await reverifyOffer(row.duffel_offer_id);
	if (new Date(offer.expires_at) < new Date()) throw new OrderPlacementError("fare_expired");

	const baseAmount = parseFloat(offer.base_amount) + (offer.tax_amount ? parseFloat(offer.tax_amount) : 0);
	const { totalAmount, markupAmount, ruleId } = await applyMarkup(baseAmount);
	// The card was charged the price shown at checkout. If the fare has moved above that, do
	// not book at a loss: refund instead.
	if (!paymentCoversPrice(parseFloat(row.amount), totalAmount)) throw new OrderPlacementError("price_changed");

	const passengers = row.passengers;
	if (!passengers?.length) throw new OrderPlacementError("passenger_details", "No passenger details on file for this payment");
	const problem = validatePassengersForOffer(passengers, (offer.passengers ?? []).map((p) => p.id));
	if (problem) throw new OrderPlacementError("passenger_details", problem);

	const orderPassengers = passengers.map((p) => ({
		id: p.id,
		title: p.title,
		gender: p.gender,
		given_name: p.givenName,
		family_name: p.familyName,
		born_on: p.bornOn,
		email: p.email,
		phone_number: p.phoneNumber,
		type: offer.passengers.find((op) => op.id === p.id)?.type ?? "adult",
	}));

	const orderResponse = await duffel.orders.create({
		selected_offers: [offer.id],
		passengers: orderPassengers as any,
		payments: [{ type: "balance", amount: offer.total_amount, currency: offer.total_currency }],
		type: "instant",
		metadata: { payment_intent_id: row.duffel_payment_intent_id },
	});
	const order = orderResponse.data;

	// From here the airline HAS booked. Anything that goes wrong is our own recording, and
	// must keep the order id so it is never booked twice.
	try {
		await pool.query("UPDATE flight_payments SET duffel_order_id = $2, updated_at = NOW() WHERE id = $1", [row.id, order.id]);
		return await recordOrder(row, { order, sourceOfferId: offer.id, cost: baseAmount, currency: offer.total_currency, charged: totalAmount, markup: markupAmount, ruleId, orderPassengers });
	} catch (err) {
		throw new OrderPlacementError("unrecorded_order", describeError(err), order.id);
	}
}

async function recordOrder(
	row: PaymentRow,
	d: { order: any; sourceOfferId: string; cost: number; currency: string; charged: number; markup: number; ruleId: string | null; orderPassengers?: any[] }
): Promise<PlacedOrder> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		let orderRow = (await client.query("SELECT id, booking_reference, status FROM flight_orders WHERE payment_intent_id = $1", [row.duffel_payment_intent_id])).rows[0];
		if (!orderRow) {
			orderRow = (await client.query(
				`INSERT INTO flight_orders
				   (user_id, duffel_order_id, source_offer_id, booking_reference, status, slices,
				    duffel_cost_amount, duffel_cost_currency, price_charged_amount, price_charged_currency,
				    markup_amount, markup_rule_id, payment_intent_id)
				 VALUES ($1,$2,$3,$4,'confirmed',$5,$6,$7,$8,$9,$10,$11,$12)
				 RETURNING id, booking_reference, status`,
				[row.user_id, d.order.id, d.sourceOfferId, d.order.booking_reference, JSON.stringify(d.order.slices ?? []),
					d.cost, d.currency, d.charged, d.currency, d.markup, d.ruleId, row.duffel_payment_intent_id]
			)).rows[0];
			const people = d.orderPassengers ?? (d.order.passengers ?? []).map((p: any) => ({ id: p.id, title: p.title, given_name: p.given_name, family_name: p.family_name, born_on: p.born_on, gender: p.gender }));
			for (const p of people) {
				await client.query(
					`INSERT INTO flight_order_passengers (flight_order_id, duffel_passenger_id, title, given_name, family_name, date_of_birth, gender)
					 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
					[orderRow.id, p.id, p.title, p.given_name, p.family_name, p.born_on, p.gender]
				);
			}
		}
		// The order exists now, so the passenger details are no longer needed here.
		await client.query(
			`UPDATE flight_payments
			    SET status = 'ordered', flight_order_id = $2, duffel_order_id = $3, passengers = NULL,
			        last_error = NULL, error_code = NULL, retryable = NULL, updated_at = NOW()
			  WHERE id = $1`,
			[row.id, orderRow.id, d.order.id]
		);
		await client.query("COMMIT");
		notifyOrderChanged("duffel", orderRow.id);
		return { id: orderRow.id, bookingReference: orderRow.booking_reference, status: orderRow.status };
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}

async function recordFailure(row: PaymentRow, err: unknown): Promise<OrderFailedAfterPayment> {
	const code = classifyOrderError(err);
	const duffelOrderId = err instanceof OrderPlacementError ? err.duffelOrderId : undefined;
	const detail = describeError(err).slice(0, 300);
	const attempts = row.attempts;
	const canRetry = canRetryAfter(code, attempts) || !!(duffelOrderId ?? row.duffel_order_id);
	const refundNeeded = needsRefund(code, attempts);

	await pool.query(
		`UPDATE flight_payments
		    SET status = 'order_failed', last_error = $2, error_code = $3, retryable = $4,
		        duffel_order_id = COALESCE($5, duffel_order_id), updated_at = NOW()
		  WHERE id = $1`,
		[row.id, detail, code, canRetry, duffelOrderId ?? null]
	);
	console.error(`Flight payment ${row.duffel_payment_intent_id}: order failed after payment (${code}, attempt ${attempts}): ${detail}`);

	// A retry that can still work is an email; anything a person must handle is urgent (SMS too).
	const urgent = refundNeeded || !canRetry || code === "unrecorded_order" || code === "supplier_balance";
	// (the row in hand predates this failure, so it is refreshed with what is now known)
	await alertOwner({ ...row, error_code: code, last_error: detail, duffel_order_id: duffelOrderId ?? row.duffel_order_id, status: "order_failed" }, "a traveller paid but the booking did not complete", `Reason: ${code}. ${refundNeeded ? "This needs a refund or a manual booking." : canRetry ? "The traveller can try again." : "It needs a person."}`, urgent);

	return new OrderFailedAfterPayment(row.duffel_payment_intent_id, code, canRetry, refundNeeded, travellerMessage(code, attempts));
}

// ─── Owner alerts ────────────────────────────────────────────────────────────

async function alertOwner(row: PaymentRow, headline: string, note: string, urgent: boolean): Promise<void> {
	try {
		const email = (await pool.query("SELECT email FROM users WHERE id = $1", [row.user_id])).rows[0]?.email ?? "unknown";
		const body = [
			note,
			"",
			`Traveller: ${email}`,
			`Trip: ${row.summary ?? row.duffel_offer_id}`,
			`Charged: ${row.currency} ${row.amount}`,
			`Duffel payment intent: ${row.duffel_payment_intent_id}`,
			row.duffel_order_id ? `Duffel order (already booked): ${row.duffel_order_id}` : "Duffel order: none",
			`Status: ${row.status}, attempts: ${row.attempts}`,
			row.last_error ? `Last error: ${row.last_error}` : "",
			"",
			"What to do: in the Duffel dashboard either place the booking or refund this payment, then mark it refunded in Drift",
			`(POST /api/v1/flights/payments/${row.duffel_payment_intent_id}/mark-refunded as an admin).`,
		].filter((l) => l !== "").join("\n");
		await sendReviewerAlert({ subject: `${row.is_test ? "[TEST] " : ""}Drift flights: ${headline}`, body, urgent });
		await pool.query("UPDATE flight_payments SET alerted_at = NOW() WHERE id = $1", [row.id]);
	} catch (err) {
		console.error("Could not send the flight payment alert:", err);
	}
}

// ─── The traveller's open payments, refunds ─────────────────────────────────

export interface OpenPaymentView {
	paymentIntentId: string;
	status: string;
	summary: string | null;
	amount: number;
	currency: string;
	message: string;
	canRetry: boolean;
	canRequestRefund: boolean;
	createdAt: string;
}

export async function listOpenPayments(userId: string): Promise<OpenPaymentView[]> {
	const { rows } = await pool.query(
		`SELECT * FROM flight_payments WHERE user_id = $1 AND status IN ('paid', 'ordering', 'order_failed', 'refund_requested') ORDER BY created_at DESC`,
		[userId]
	);
	return rows.map((r: PaymentRow) => {
		const hasPeople = !!r.passengers?.length;
		const failed = r.status === "order_failed";
		return {
			paymentIntentId: r.duffel_payment_intent_id,
			status: r.status,
			summary: r.summary,
			amount: parseFloat(r.amount),
			currency: r.currency,
			message:
				r.status === "refund_requested" ? "Refund requested. We will refund your payment in full."
				: r.status === "ordering" ? "Your booking is being completed."
				: failed ? travellerMessage((r.error_code ?? "temporary") as OrderFailureCode, r.attempts)
				: "Your payment went through but the booking has not been completed yet.",
			canRetry: (r.status === "paid" && hasPeople) || (failed && canRetryOrder(r) && (hasPeople || !!r.duffel_order_id)),
			canRequestRefund: r.status === "paid" || failed,
			createdAt: r.created_at,
		};
	});
}

export async function requestRefund(userId: string, paymentIntentId: string): Promise<void> {
	const pay = await loadPayment(paymentIntentId, userId);
	if (pay.status === "refund_requested") return; // already asked
	if (pay.status === "ordered") throw new PaymentError(409, "This flight is already booked. To cancel it, contact support.");
	if (!["paid", "order_failed"].includes(pay.status)) throw new PaymentError(409, "There is no completed payment to refund.");
	const { rows } = await pool.query(
		"UPDATE flight_payments SET status = 'refund_requested', updated_at = NOW() WHERE id = $1 AND status IN ('paid', 'order_failed') RETURNING *",
		[pay.id]
	);
	if (rows.length) await alertOwner(rows[0], "a traveller asked for a refund", "The traveller asked for their payment back. Refund it in the Duffel dashboard.", true);
}

export async function markRefunded(paymentIntentId: string): Promise<void> {
	const { rows } = await pool.query(
		"UPDATE flight_payments SET status = 'refunded', passengers = NULL, updated_at = NOW() WHERE duffel_payment_intent_id = $1 AND status IN ('paid', 'order_failed', 'refund_requested') RETURNING id",
		[paymentIntentId]
	);
	if (!rows.length) throw new PaymentError(404, "No open payment with that id");
}

// ─── The safety net ──────────────────────────────────────────────────────────

// Runs every few minutes. Nothing here books or refunds anything: it makes sure a human
// KNOWS about every payment that has not become a booking, even if the traveller closed
// the browser part-way through.
export async function reconcilePayments(): Promise<{ stuck: number; unattended: number; checked: number }> {
	// An order attempt that never finished (the server died mid-way).
	const stuck = await pool.query(
		`UPDATE flight_payments
		    SET status = 'order_failed', error_code = 'stuck', retryable = FALSE, last_error = 'The order step did not finish', updated_at = NOW()
		  WHERE status = 'ordering' AND updated_at < NOW() - INTERVAL '10 minutes'
		  RETURNING *`
	);
	for (const r of stuck.rows) await alertOwner(r, "an order stopped part-way through", "The server stopped while placing this order. Check the Duffel dashboard for an order with this payment id before doing anything else: it may already be booked.", true);

	// Paid, no booking after ten minutes, nobody has been told.
	const unattended = await pool.query(
		`SELECT * FROM flight_payments WHERE status IN ('paid', 'order_failed') AND alerted_at IS NULL AND updated_at < NOW() - INTERVAL '10 minutes'`
	);
	for (const r of unattended.rows) await alertOwner(r, "a paid flight has no booking", "A traveller's payment went through but the booking was never completed (for example they closed the browser).", true);

	// A payment left at 'created' might still have been captured (the browser died between the card step
	// and our confirm). Ask Duffel once, about twenty minutes later.
	let checked = 0;
	const stale = await pool.query(
		`SELECT * FROM flight_payments
		  WHERE status = 'created' AND reconciled_at IS NULL
		    AND created_at < NOW() - INTERVAL '20 minutes' AND created_at > NOW() - INTERVAL '24 hours'
		  ORDER BY created_at LIMIT 20`
	);
	for (const r of stale.rows) {
		try {
			const pi = (await getDuffelClient().paymentIntents.get(r.duffel_payment_intent_id)).data;
			checked++;
			if (pi.status === "succeeded") {
				const updated = await pool.query("UPDATE flight_payments SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'created' RETURNING *", [r.id]);
				if (updated.rows.length) await alertOwner(updated.rows[0], "a paid flight has no booking", "The payment was captured by Duffel but the traveller's browser never asked for the booking.", true);
			}
		} catch (err) {
			console.error(`Payment reconcile: could not check ${r.duffel_payment_intent_id}:`, err);
		} finally {
			await pool.query("UPDATE flight_payments SET reconciled_at = NOW() WHERE id = $1", [r.id]);
		}
	}
	return { stuck: stuck.rows.length, unattended: unattended.rows.length, checked };
}

export function startPaymentReconciler(): void {
	if (process.env.PAYMENT_RECONCILER === "off") return;
	const run = () => reconcilePayments().catch((err) => console.error("Payment reconciler failed:", err));
	setTimeout(run, 60_000);
	setInterval(run, 5 * 60_000);
	console.log("Flight payment reconciler on (every 5 minutes)");
}
