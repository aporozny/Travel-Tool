import { pool } from "../utils/db";
import { isDuffelTestMode } from "../utils/duffelClient";
import { getAirport, localToUtc, hotelZone, planReminders } from "./tripSchedule";

// Turns bookings into trip legs (with exact times) and schedules the
// reminders for them. Called whenever a booking is created or changes state;
// safe to call repeatedly: legs are upserted and each reminder has a unique
// key, so running it twice never creates a second reminder.
//
// Rules:
// - Reminders are only scheduled for bookings that are actually happening:
//   ticketed or confirmed. A reservation that is only held gets the booking
//   confirmation ("seats reserved") and nothing more until it is ticketed.
//   The exception is a sandbox TEST booking when NOTIFICATIONS_TEST_TRIPS is
//   "true", so the whole flow can be exercised before real ticketing exists;
//   every message for those says TEST.
// - A cancelled, expired or failed booking cancels everything still pending.
// - An airport whose timezone is unknown gives no exact time, and so no
//   reminders. Nothing is guessed.

export type Source = "tripgic" | "duffel";

export interface SegmentInput {
	source: Source;
	orderId: string;
	userId: string;
	legIndex: number;
	kind: "flight" | "hotel";
	carrier: string | null;
	flightNumbers: string[];
	originIata: string | null;
	destIata: string | null;
	originCity: string | null;
	destCity: string | null;
	destCountry: string | null;
	depLocal: string;
	arrLocal: string | null;
	depTz: string | null;
	arrTz: string | null;
	depUtc: Date | null;
	arrUtc: Date | null;
	placeName: string | null;
	address: string | null;
	reference: string | null;
	supplierReference: string | null;
	isTest: boolean;
	orderStatus: string;
}

const CANCELLED_STATES = ["cancelled", "expired", "failed"];

// ---- building legs from each provider's stored order ----------------------------

// tripgic_orders.details.slices are Drift's own flight view: local times with
// no offset and IATA codes only (no timezone), so the timezone comes from the
// airport table.
export function segmentsFromTripgicOrder(row: any): SegmentInput[] {
	const d = row.details ?? {};
	const base = {
		source: "tripgic" as const,
		orderId: String(row.id),
		userId: row.user_id,
		reference: row.tripgic_booking_id ?? null,
		supplierReference: row.supplier_reference ?? null,
		isTest: row.payment_status === "not_collected_sandbox",
		// A reservation whose hold has lapsed is expired, whether or not anyone has
		// opened the order list since (that is what normally marks it).
		orderStatus: row.status === "held" && row.hold_expires_at && new Date(row.hold_expires_at).getTime() < Date.now() ? "expired" : row.status,
	};

	if (row.product_type === "hotel") {
		const cc = typeof d.address === "string" ? (d.address.split(",").map((p: string) => p.trim()).pop() ?? "") : "";
		const country = /^[A-Z]{2}$/.test(cc) ? cc : null;
		const zone = hotelZone(country, typeof d.longitude === "number" ? d.longitude : null);
		// A stay's reference moment is noon on check-in day (a common check-in time).
		const depLocal = d.checkInDate ? `${d.checkInDate}T12:00:00` : "";
		return depLocal
			? [{
				...base, legIndex: 0, kind: "hotel", carrier: null, flightNumbers: [], originIata: null, destIata: null, originCity: null,
				destCity: null, destCountry: country, depLocal, arrLocal: d.checkOutDate ? `${d.checkOutDate}T11:00:00` : null, depTz: zone, arrTz: zone,
				depUtc: localToUtc(depLocal, zone), arrUtc: d.checkOutDate ? localToUtc(`${d.checkOutDate}T11:00:00`, zone) : null,
				placeName: d.hotelName ?? null, address: d.address ?? null,
			}]
			: [];
	}

	return ((d.slices as any[]) ?? []).map((s, i): SegmentInput => {
		const from = getAirport(s.originAirport);
		const to = getAirport(s.destinationAirport);
		return {
			...base,
			legIndex: i,
			kind: "flight",
			carrier: s.segments?.[0]?.marketingCarrier ?? null,
			flightNumbers: (s.segments ?? []).map((g: any) => g.flightNumber).filter(Boolean),
			originIata: s.originAirport ?? null,
			destIata: s.destinationAirport ?? null,
			originCity: s.originCity ?? from?.city ?? null,
			destCity: s.destinationCity ?? to?.city ?? null,
			destCountry: to?.cc ?? null,
			depLocal: s.departingAt,
			arrLocal: s.arrivingAt ?? null,
			depTz: from?.tz ?? null,
			arrTz: to?.tz ?? null,
			depUtc: localToUtc(s.departingAt, from?.tz),
			arrUtc: localToUtc(s.arrivingAt, to?.tz),
			placeName: null,
			address: null,
		};
	});
}

// flight_orders.slices are Duffel's raw order slices: they carry the airport's
// own IANA zone, which is preferred over the airport table.
export function segmentsFromDuffelOrder(row: any): SegmentInput[] {
	return ((row.slices as any[]) ?? []).map((s, i): SegmentInput => {
		const segs: any[] = s.segments ?? [];
		const first = segs[0];
		const last = segs[segs.length - 1];
		const originIata = s.origin?.iata_code ?? null;
		const destIata = s.destination?.iata_code ?? null;
		const from = getAirport(originIata);
		const to = getAirport(destIata);
		const depTz = s.origin?.time_zone ?? from?.tz ?? null;
		const arrTz = s.destination?.time_zone ?? to?.tz ?? null;
		const depLocal = first?.departing_at ?? "";
		const arrLocal = last?.arriving_at ?? null;
		return {
			source: "duffel",
			orderId: String(row.id),
			userId: row.user_id,
			legIndex: i,
			kind: "flight",
			carrier: first?.marketing_carrier?.name ?? null,
			flightNumbers: segs.map((g) => `${g.marketing_carrier?.iata_code ?? ""}${g.marketing_carrier_flight_number ?? ""}`.trim()).filter(Boolean),
			originIata,
			destIata,
			originCity: s.origin?.city_name ?? from?.city ?? null,
			destCity: s.destination?.city_name ?? to?.city ?? null,
			destCountry: s.destination?.iata_country_code ?? to?.cc ?? null,
			depLocal,
			arrLocal,
			depTz,
			arrTz,
			depUtc: localToUtc(depLocal, depTz),
			arrUtc: localToUtc(arrLocal, arrTz),
			placeName: null,
			address: null,
			reference: row.booking_reference ?? null,
			supplierReference: null,
			isTest: isDuffelTestMode(),
			orderStatus: row.status === "confirmed" ? "ticketed" : row.status,
		};
	}).filter((s) => s.depLocal);
}

// ---- persisting -------------------------------------------------------------------

async function upsertSegment(s: SegmentInput): Promise<{ id: string; previousStatus: string | null }> {
	const { rows: prev } = await pool.query("SELECT order_status FROM trip_segments WHERE source = $1 AND order_id = $2 AND leg_index = $3", [s.source, s.orderId, s.legIndex]);
	const { rows } = await pool.query(
		`INSERT INTO trip_segments
		   (user_id, source, order_id, leg_index, kind, carrier, flight_numbers, origin_iata, dest_iata, origin_city, dest_city, dest_country,
		    dep_local, arr_local, dep_tz, arr_tz, dep_utc, arr_utc, place_name, address, reference, supplier_reference, order_status, is_test, status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
		 ON CONFLICT (source, order_id, leg_index) DO UPDATE SET
		   carrier = EXCLUDED.carrier, flight_numbers = EXCLUDED.flight_numbers, origin_iata = EXCLUDED.origin_iata, dest_iata = EXCLUDED.dest_iata,
		   origin_city = EXCLUDED.origin_city, dest_city = EXCLUDED.dest_city, dest_country = EXCLUDED.dest_country,
		   dep_local = EXCLUDED.dep_local, arr_local = EXCLUDED.arr_local, dep_tz = EXCLUDED.dep_tz, arr_tz = EXCLUDED.arr_tz,
		   dep_utc = EXCLUDED.dep_utc, arr_utc = EXCLUDED.arr_utc, place_name = EXCLUDED.place_name, address = EXCLUDED.address,
		   reference = EXCLUDED.reference, supplier_reference = EXCLUDED.supplier_reference, order_status = EXCLUDED.order_status,
		   is_test = EXCLUDED.is_test, status = EXCLUDED.status, updated_at = NOW()
		 RETURNING id`,
		[
			s.userId, s.source, s.orderId, s.legIndex, s.kind, s.carrier, s.flightNumbers, s.originIata, s.destIata, s.originCity, s.destCity, s.destCountry,
			s.depLocal, s.arrLocal, s.depTz, s.arrTz, s.depUtc, s.arrUtc, s.placeName, s.address, s.reference, s.supplierReference, s.orderStatus, s.isTest,
			CANCELLED_STATES.includes(s.orderStatus) ? "cancelled" : "active",
		]
	);
	return { id: rows[0].id, previousStatus: prev[0]?.order_status ?? null };
}

async function schedule(userId: string, segmentId: string, type: string, key: string, sendAt: Date, expiresAt: Date): Promise<void> {
	for (const channel of ["email", "in_app"] as const) {
		await pool.query(
			`INSERT INTO scheduled_notifications (user_id, segment_id, type, channel, send_at, expires_at, dedupe_key)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)
			 ON CONFLICT (dedupe_key) DO UPDATE SET send_at = EXCLUDED.send_at, expires_at = EXCLUDED.expires_at
			 WHERE scheduled_notifications.status = 'pending'`,
			[userId, segmentId, type, channel, sendAt, expiresAt, `${key}:${channel}`]
		);
	}
}

// Sandbox TEST bookings only ever notify admin accounts, and only while
// NOTIFICATIONS_TEST_TRIPS is "true". Old test bookings (Duffel test mode) belong
// to ordinary accounts, including a business owner's, and must never email them.
function testTripsNotify(isAdmin: boolean): boolean {
	return isAdmin && process.env.NOTIFICATIONS_TEST_TRIPS === "true";
}

function remindersAllowed(s: SegmentInput, isAdmin: boolean): boolean {
	if (s.isTest) return testTripsNotify(isAdmin) && ["held", "ticketed", "confirmed"].includes(s.orderStatus);
	return s.orderStatus === "ticketed" || s.orderStatus === "confirmed";
}

async function loadOrderSegments(source: Source, orderId: string): Promise<SegmentInput[]> {
	if (source === "tripgic") {
		const { rows } = await pool.query("SELECT * FROM tripgic_orders WHERE id = $1", [orderId]);
		return rows[0] ? segmentsFromTripgicOrder(rows[0]) : [];
	}
	const { rows } = await pool.query("SELECT * FROM flight_orders WHERE id = $1", [orderId]);
	return rows[0] ? segmentsFromDuffelOrder(rows[0]) : [];
}

export async function syncOrderNotifications(source: Source, orderId: string, now: Date = new Date(), options: { confirmations?: boolean } = {}): Promise<void> {
	const inputs = await loadOrderSegments(source, orderId);
	if (inputs.length === 0) return;

	const saved: { input: SegmentInput; id: string; previousStatus: string | null }[] = [];
	for (const input of inputs) saved.push({ input, ...(await upsertSegment(input)) });

	const status = inputs[0].orderStatus;
	const { rows: who } = await pool.query("SELECT role FROM users WHERE id = $1", [inputs[0].userId]);
	const isAdmin = who[0]?.role === "admin";
	// A test booking that must not notify this user gets nothing at all, not even
	// a confirmation, and anything already scheduled for it is withdrawn.
	if (CANCELLED_STATES.includes(status) || (inputs[0].isTest && !testTripsNotify(isAdmin))) {
		await pool.query(
			"UPDATE scheduled_notifications SET status = 'cancelled' WHERE segment_id = ANY($1::uuid[]) AND status = 'pending'",
			[saved.map((s) => s.id)]
		);
		return;
	}

	const first = saved[0];
	const orderKey = `${source}:${orderId}`;
	// Booking confirmation: once, straight away. A later held -> ticketed change
	// gets its own "your tickets are issued" message, because the first one
	// promised exactly that.
	const confirmations = options.confirmations !== false;
	if (confirmations) await schedule(first.input.userId, first.id, "confirmation", `${orderKey}:confirmation`, now, new Date(now.getTime() + 7 * 24 * 3600 * 1000));
	if (confirmations && first.previousStatus === "held" && (status === "ticketed" || status === "confirmed")) {
		await schedule(first.input.userId, first.id, "ticketed", `${orderKey}:ticketed`, now, new Date(now.getTime() + 7 * 24 * 3600 * 1000));
	}

	for (const s of saved) {
		if (!remindersAllowed(s.input, isAdmin)) continue;
		for (const r of planReminders(s.input.kind, s.input.depUtc, now)) {
			await schedule(s.input.userId, s.id, r.type, `${orderKey}:${s.input.legIndex}:${r.type}`, r.sendAt, r.expiresAt);
		}
	}
}

// Fire-and-forget hook for the booking code: a notification problem must never
// fail or slow a booking.
export function notifyOrderChanged(source: Source, orderId: string): void {
	syncOrderNotifications(source, orderId).catch((err) => console.error(`Trip notification sync failed for ${source} order ${orderId}:`, err));
}

// One-off: create legs and schedule reminders for bookings made before this
// existed. No confirmation messages: those bookings were made long ago and a
// "thanks for booking" email now would be wrong.
export async function backfillAll(): Promise<{ orders: number }> {
	let orders = 0;
	for (const [source, table] of [["tripgic", "tripgic_orders"], ["duffel", "flight_orders"]] as const) {
		const { rows } = await pool.query(`SELECT id FROM ${table}`);
		for (const r of rows) {
			await syncOrderNotifications(source, String(r.id), new Date(), { confirmations: false });
			orders++;
		}
	}
	return { orders };
}
