import crypto from "crypto";
import { pool } from "../utils/db";
import { sendReviewerAlert } from "./notifications";

// Records Duffel's "order.airline_initiated_change_detected" webhook --
// the only event Duffel sends for a schedule change or an airline-initiated
// cancellation on a booked order (there is no separate "cancelled" event
// type; a change with no replacement slices IS the cancellation). See
// https://duffel.com/docs/guides/receiving-webhooks and the
// AirlineInitiatedChange type in @duffel/api.
//
// Ships inactive: fails closed until DUFFEL_WEBHOOK_SECRET is set, same as
// every other credential-gated feature in this codebase (DUFFEL_API_KEY,
// SAFETY_REVIEWER_EMAIL, UNSUBSCRIBE_SECRET). Nothing here auto-applies a
// change to the order -- accepting, rebooking or cancelling is a Duffel
// dashboard action a person takes deliberately, matching how a TripGic
// supplier cancellation is handled today ("alerts, changes nothing").

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export class WebhookSignatureError extends Error {}

function secret(): string {
	const value = process.env.DUFFEL_WEBHOOK_SECRET;
	if (!value) throw new WebhookSignatureError("DUFFEL_WEBHOOK_SECRET not configured -- Duffel webhooks are inactive");
	return value;
}

// Header looks like "t=1616202842,v1=8aebaa7e..." -- HMAC-SHA256 of
// "<timestamp>.<raw body>" using the secret returned once when the webhook
// was created in the Duffel dashboard/API.
export function verifyDuffelSignature(rawBody: Buffer, header: string | undefined): void {
	if (!header) throw new WebhookSignatureError("Missing X-Duffel-Signature header");
	const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
	const timestamp = parts.t;
	const given = parts.v1;
	if (!timestamp || !given) throw new WebhookSignatureError("Malformed X-Duffel-Signature header");
	if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
		throw new WebhookSignatureError("Webhook timestamp missing or outside tolerance -- possible replay");
	}

	const expected = crypto.createHmac("sha256", secret()).update(`${timestamp}.`).update(rawBody).digest("hex");
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
		throw new WebhookSignatureError("Signature mismatch");
	}
}

// The webhook body, trusted only as far as `unknown` -- validated field by
// field below rather than cast, the same lesson as the Travelport null-safety
// fix: an external API's response shape is never a given.
export async function handleDuffelWebhookEvent(raw: unknown): Promise<void> {
	if (typeof raw !== "object" || raw === null) return;
	const event = raw as { id?: unknown; type?: unknown; data?: { object?: unknown } };
	if (typeof event.id !== "string" || typeof event.type !== "string") return;

	if (event.type === "ping.triggered") return;
	if (event.type !== "order.airline_initiated_change_detected") return; // order.created / order.updated -- nothing to do

	const change = event.data?.object as { order_id?: unknown; added?: unknown; removed?: unknown } | undefined;
	if (!change || typeof change.order_id !== "string" || !Array.isArray(change.added) || !Array.isArray(change.removed)) {
		console.error(`Duffel webhook event ${event.id}: data.object missing expected fields`);
		return;
	}

	const { rows } = await pool.query(
		"SELECT id, user_id, booking_reference FROM flight_orders WHERE duffel_order_id = $1",
		[change.order_id]
	);
	const order = rows[0];
	if (!order) {
		console.error(`Duffel webhook event ${event.id}: no flight_orders row for Duffel order ${change.order_id}`);
		return;
	}

	const eventType = change.added.length === 0 ? "cancellation" : "schedule_change";
	const { rows: inserted } = await pool.query(
		`INSERT INTO flight_order_events (flight_order_id, duffel_event_id, event_type, old_slices, new_slices, payload)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (duffel_event_id) WHERE duffel_event_id IS NOT NULL DO NOTHING
		 RETURNING id`,
		[order.id, event.id, eventType, JSON.stringify(change.removed), JSON.stringify(change.added), JSON.stringify(event)]
	);
	if (inserted.length === 0) return; // a retried delivery of an event already recorded

	const email = (await pool.query("SELECT email FROM users WHERE id = $1", [order.user_id])).rows[0]?.email ?? "unknown";
	await sendReviewerAlert({
		subject: `Drift flights: airline ${eventType === "cancellation" ? "cancelled" : "changed"} a booked flight`,
		body: [
			eventType === "cancellation"
				? "The airline cancelled this booking outright (no replacement slices offered)."
				: "The airline changed the schedule for this booking.",
			"",
			`Traveller: ${email}`,
			`Booking reference: ${order.booking_reference}`,
			`Duffel order: ${change.order_id}`,
			"",
			"What to do: review the change in the Duffel dashboard and accept, rebook or cancel as appropriate.",
		].join("\n"),
		urgent: true,
	});
}
