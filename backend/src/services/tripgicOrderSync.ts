import { pool } from "../utils/db";
import { tripgicPost, tripgicMemberId } from "../utils/tripgicClient";
import { notifyOrderChanged } from "./tripNotifications";
import { sendReviewerAlert } from "./notifications";
import { interpretBooking, isStillUpcoming, type BookingReading } from "./tripgicStatus";

// Keeps Drift's TripGic bookings in step with TripGic. Before this, a booking was only ever re-read
// from one route that no screen called, so a "Reserved" booking stayed reserved for ever: a moved
// deadline, a ticket issued later, or a cancellation by the supplier were never noticed.
//
// What runs (every 10 minutes, and when a traveller opens their bookings):
//   * held bookings are refreshed from TripGic (deadline, ticketed, cancelled);
//   * a held booking is marked expired only once its deadline has been confirmed recently, because
//     the deadline can move and TripGic never expires a booking itself;
//   * the owner hears ONCE about a booking that is reserved but was never ticketed;
//   * ticketed bookings are checked hourly and the owner is told if TripGic says one was cancelled.
//     Nothing is changed automatically for those: the wording TripGic uses for a ticketed booking has
//     not been seen yet, so a wrong guess must never cancel a real traveller's booking.

interface TripgicResult {
	status?: string;
	reason?: string | null;
	[key: string]: any;
}

const seenUnrecognised = new Set<string>();

// One booking as TripGic sees it. null = unreachable or not a usable answer: leave everything alone.
async function readBooking(order: any): Promise<BookingReading | null> {
	try {
		const d = await tripgicPost<TripgicResult>("/booking-details", { member_id: tripgicMemberId(), tracking_id: order.tripgic_tracking_id });
		if (d.status !== "success" || !d.booking) return null;
		const reading = interpretBooking(d.booking);
		if (!reading.recognised && !seenUnrecognised.has(reading.supplierStatus)) {
			seenUnrecognised.add(reading.supplierStatus);
			console.warn(`TripGic booking status not recognised: "${reading.supplierStatus}" (order ${order.id}). It is stored in supplier_status; tighten services/tripgicStatus.ts.`);
		}
		return reading;
	} catch (err) {
		console.error(`TripGic order read failed for ${order.tripgic_tracking_id}:`, err instanceof Error ? err.message : err);
		return null;
	}
}

// Refresh one held booking. Returns the row as it now stands.
export async function syncHeldOrder(order: any): Promise<any> {
	if (order.status !== "held") return order;
	const reading = await readBooking(order);
	if (!reading) return order;

	const newStatus = reading.status === "ticketed" ? (order.product_type === "flight" ? "ticketed" : "confirmed") : reading.status;
	const { rows } = await pool.query(
		`UPDATE tripgic_orders SET
		   status = COALESCE($2::text, status),
		   hold_expires_at = COALESCE($3::timestamptz, hold_expires_at),
		   supplier_status = $4,
		   last_synced_at = NOW(),
		   fulfilled_at = CASE WHEN $2::text IN ('ticketed', 'confirmed') THEN NOW() ELSE fulfilled_at END,
		   cancelled_at = CASE WHEN $2::text = 'cancelled' THEN NOW() ELSE cancelled_at END,
		   fulfilment_error = CASE WHEN $2::text IN ('ticketed', 'confirmed') THEN NULL ELSE fulfilment_error END,
		   updated_at = NOW()
		 WHERE id = $1 AND status = 'held'
		 RETURNING *`,
		[order.id, newStatus, reading.deadline, reading.supplierStatus]
	);
	if (!rows.length) {
		// It changed while we were reading (ticketed or cancelled elsewhere): return what is there now.
		return (await pool.query("SELECT * FROM tripgic_orders WHERE id = $1", [order.id])).rows[0] ?? order;
	}
	const moved = !!(reading.deadline && order.hold_expires_at && Math.abs(new Date(order.hold_expires_at).getTime() - reading.deadline.getTime()) > 60_000);
	if (newStatus || moved) notifyOrderChanged("tripgic", rows[0].id);
	return rows[0];
}

// Read a booking of any status and just record what TripGic calls it. Used after ticketing to learn
// the wording TripGic really uses.
export async function recordSupplierStatus(orderId: string): Promise<BookingReading | null> {
	const order = (await pool.query("SELECT * FROM tripgic_orders WHERE id = $1", [orderId])).rows[0];
	if (!order) return null;
	const reading = await readBooking(order);
	if (reading) {
		await pool.query("UPDATE tripgic_orders SET supplier_status = $2, last_synced_at = NOW() WHERE id = $1", [orderId, reading.supplierStatus]);
		console.log(`TripGic status for order ${orderId}: ${reading.supplierStatus}`);
	}
	return reading;
}

// A traveller opening their bookings refreshes their held ones in the background (the page does not wait).
export async function refreshUserHeldOrders(userId: string): Promise<void> {
	try {
		const { rows } = await pool.query(
			`SELECT * FROM tripgic_orders WHERE user_id = $1 AND status = 'held' AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '2 minutes')
			 ORDER BY last_synced_at NULLS FIRST LIMIT 10`,
			[userId]
		);
		for (const o of rows) await syncHeldOrder(o);
	} catch (err) {
		console.error("Background refresh of a traveller's held bookings failed:", err);
	}
}

// Bookings already past their deadline are checked with TripGic before the page loads (so the traveller
// sees the truth straight away), but the wait is capped so a slow TripGic never holds the page up.
export async function refreshOverdueForUser(userId: string, maxMs = 3000): Promise<void> {
	try {
		const { rows } = await pool.query(
			"SELECT * FROM tripgic_orders WHERE user_id = $1 AND status = 'held' AND hold_expires_at < NOW() ORDER BY hold_expires_at LIMIT 5",
			[userId]
		);
		if (!rows.length) return;
		await Promise.race([Promise.all(rows.map((o: any) => syncHeldOrder(o))), new Promise((resolve) => setTimeout(resolve, maxMs))]);
	} catch (err) {
		console.error("Refresh of a traveller's overdue bookings failed:", err);
	}
}

// A held booking is expired only when its deadline has passed AND that deadline was confirmed with TripGic
// recently (or is more than two hours old, so nothing stays "held" for ever if TripGic is unreachable).
export async function expireOverdueHeld(userId?: string): Promise<string[]> {
	const { rows } = await pool.query(
		`UPDATE tripgic_orders SET status = 'expired', updated_at = NOW()
		  WHERE status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()
		    AND (last_synced_at > NOW() - INTERVAL '30 minutes' OR hold_expires_at < NOW() - INTERVAL '2 hours')
		    AND ($1::uuid IS NULL OR user_id = $1::uuid)
		  RETURNING id`,
		[userId ?? null]
	);
	for (const r of rows) notifyOrderChanged("tripgic", r.id);
	return rows.map((r: { id: string }) => r.id);
}

// ─── Owner alerts ────────────────────────────────────────────────────────────

async function alertReserved(): Promise<number> {
	const { rows } = await pool.query(
		`SELECT o.*, u.email FROM tripgic_orders o JOIN users u ON u.id = o.user_id
		  WHERE o.status = 'held' AND o.fulfilment_error IS NOT NULL AND o.owner_alerted_at IS NULL
		    AND o.created_at < NOW() - INTERVAL '15 minutes' AND (o.hold_expires_at IS NULL OR o.hold_expires_at > NOW())
		  ORDER BY o.hold_expires_at NULLS LAST LIMIT 20`
	);
	if (!rows.length) return 0;
	const allTest = rows.every((r: any) => r.payment_status === "not_collected_sandbox");
	const soon = rows.some((r: any) => r.hold_expires_at && new Date(r.hold_expires_at).getTime() - Date.now() < 3 * 3600 * 1000);
	const lines = rows.map((r: any) => `- ${r.title} | ${r.email} | ${r.price_charged_currency} ${r.price_charged_amount} | hold until ${r.hold_expires_at ? new Date(r.hold_expires_at).toISOString() : "unknown"} | ${r.fulfilment_error}`);
	await sendReviewerAlert({
		subject: `${allTest ? "[TEST] " : ""}Drift flights: ${rows.length} booking${rows.length === 1 ? " is" : "s are"} reserved but not ticketed`,
		body: [
			"These bookings were reserved with TripGic but the ticket was never issued (the reason is at the end of each line):",
			"",
			...lines,
			"",
			"Travellers see \"reserved but not finalised\". If TripGic's wallet was short, fund it, then issue each ticket with",
			"POST /api/v1/tripgic/orders/<id>/issue-ticket (as an admin). A reservation that passes its deadline expires by itself.",
		].join("\n"),
		urgent: !allTest && soon,
	});
	await pool.query("UPDATE tripgic_orders SET owner_alerted_at = NOW() WHERE id = ANY($1::uuid[])", [rows.map((r: any) => r.id)]);
	return rows.length;
}

// Ticketed bookings: record what TripGic says and warn (never change anything) if it says cancelled.
async function watchFulfilled(now: Date): Promise<{ watched: number; alerted: number }> {
	const { rows } = await pool.query(
		`SELECT o.*, u.email FROM tripgic_orders o JOIN users u ON u.id = o.user_id
		  WHERE o.status IN ('ticketed', 'confirmed') AND (o.last_synced_at IS NULL OR o.last_synced_at < NOW() - INTERVAL '1 hour')
		    AND o.created_at > NOW() - INTERVAL '90 days'
		  ORDER BY o.last_synced_at NULLS FIRST LIMIT 60`
	);
	let watched = 0, alerted = 0;
	const upcoming: any[] = [];
	for (const o of rows) {
		if (isStillUpcoming(o.details, o.product_type, now)) upcoming.push(o);
		else await pool.query("UPDATE tripgic_orders SET last_synced_at = NOW() WHERE id = $1", [o.id]); // trip is over: stop picking it
	}
	for (const o of upcoming.slice(0, 25)) {
		const reading = await readBooking(o);
		if (!reading) continue;
		watched++;
		await pool.query("UPDATE tripgic_orders SET last_synced_at = NOW(), supplier_status = $2 WHERE id = $1", [o.id, reading.supplierStatus]);
		if (reading.status === "cancelled" && !o.owner_alerted_at) {
			await sendReviewerAlert({
				subject: `${o.payment_status === "not_collected_sandbox" ? "[TEST] " : ""}Drift flights: TripGic says a ticketed booking was cancelled`,
				body: `${o.title}\nTraveller: ${o.email}\nTripGic reference: ${o.tripgic_tracking_id}\nTripGic status: ${reading.supplierStatus}\n\nDrift has NOT changed this booking (the wording TripGic uses is not yet confirmed). Check with TripGic and contact the traveller.`,
				urgent: o.payment_status !== "not_collected_sandbox",
			});
			await pool.query("UPDATE tripgic_orders SET owner_alerted_at = NOW() WHERE id = $1", [o.id]);
			alerted++;
		}
	}
	return { watched, alerted };
}

// ─── The job ─────────────────────────────────────────────────────────────────

export async function runTripgicOrderSync(now: Date = new Date()): Promise<{ refreshed: number; expired: number; reserved: number; watched: number; cancelledAlerts: number }> {
	// 1. Refresh held bookings: those near or past their deadline first (so expiry uses TripGic's latest
	//    deadline), then any not checked for half an hour.
	const due = await pool.query(
		`SELECT * FROM tripgic_orders
		  WHERE status = 'held' AND (hold_expires_at IS NULL OR hold_expires_at < NOW() + INTERVAL '30 minutes' OR last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '30 minutes')
		  ORDER BY last_synced_at NULLS FIRST LIMIT 25`
	);
	let refreshed = 0;
	for (const o of due.rows) {
		const after = await syncHeldOrder(o);
		if (after.last_synced_at && (!o.last_synced_at || new Date(after.last_synced_at) > new Date(o.last_synced_at))) refreshed++;
	}
	// 2. Expire what is really over.
	const expired = (await expireOverdueHeld()).length;
	// 3. Tell the owner about anything reserved but never ticketed.
	const reserved = await alertReserved();
	// 4. Look after ticketed bookings.
	const w = await watchFulfilled(now);
	return { refreshed, expired, reserved, watched: w.watched, cancelledAlerts: w.alerted };
}

let running = false;
export function startTripgicOrderSync(): void {
	if (process.env.TRIPGIC_ORDER_SYNC === "off" || !process.env.TRIPGIC_API_KEY) return;
	const run = async () => {
		if (running) return;
		running = true;
		try {
			await runTripgicOrderSync();
		} catch (err) {
			console.error("TripGic order sync failed:", err);
		} finally {
			running = false;
		}
	};
	setTimeout(run, 90_000);
	setInterval(run, 10 * 60_000);
	console.log("TripGic order sync on (every 10 minutes)");
}
