import { pool } from "../utils/db";
import { redis } from "../utils/redis";
import { tripgicPost } from "../utils/tripgicClient";
import { getActiveMarkupRule, computeMarkup, type FlightSliceView } from "./flights";
import { mapTripgicSlices } from "./tripgicFlights";
import { buildOccupancies } from "./tripgicStays";

// Booking through TripGic: flights and hotels.
//
// TripGic is a prepaid-wallet model. Ticketing / voucher issue debits the
// FULL net price from Drift's TripGic wallet, and TripGic takes no
// customer payment at all -- the traveller pays Drift separately. Two
// consequences shape everything in this file:
//
//  1. Customer payment is a gate, not a detail. Until Drift has its own
//     card processor, an order can only be placed in TRIPGIC_PAYMENT_MODE=
//     sandbox (a test booking; nobody is charged, and the order row says
//     so). With the variable unset every booking entry point refuses,
//     before anything is reserved with the supplier.
//  2. The order of operations must never leave the traveller charged for
//     something that wasn't booked. Once real payment exists it has to
//     clear BEFORE create-booking, and an unfulfilled order must be
//     refundable -- cancelTripgicOrder() refuses 'collected' orders for
//     exactly that reason until the refund path is built.
//
// Flow (both products): quote (validate against TripGic, re-price, apply
// markup, park the result server-side) -> order (send travellers, create
// the booking, then issue the ticket / voucher). The quote is stored in
// Redis and is the ONLY source of price for the order: nothing about
// money is ever taken from the client.
//
// Confirmed live against the sandbox, 2026-09-19/20:
// - Flights: create-booking succeeds as a hold (hold_possible "yes"); the
//   wallet is only debited at issue-ticket. Holds auto-cancel the same day.
// - Hotels: the spec's POST /hotel/create is wrong (404) -- the real path
//   is /hotel/create-booking. Hotel rates come back hold_possible "no", so
//   the wallet is debited at create-booking itself.
// - The wallet is empty until TripGic Finance approves the deposit, so the
//   final ticket/voucher step is exercised only up to the insufficient-
//   balance rejection so far. That rejection is handled, not thrown: the
//   flight stays a hold with fulfilment_error set.

export class BookingError extends Error {
	constructor(
		message: string,
		public readonly httpStatus: number,
		public readonly code: string,
		public readonly extra?: Record<string, unknown>
	) {
		super(message);
	}
}

const QUOTE_TTL_MAX_SECONDS = 25 * 60;
const ORDER_LOCK_SECONDS = 120;
const DEFAULT_GUEST_NATIONALITY = "AU";

function memberId(): string {
	return process.env.TRIPGIC_MEMBER_ID || "1";
}

type PaymentStatus = "not_collected_sandbox" | "collected";

function resolvePaymentStatus(): PaymentStatus {
	if (process.env.TRIPGIC_PAYMENT_MODE === "sandbox") return "not_collected_sandbox";
	throw new BookingError("Booking with this provider is not available yet", 503, "payments_not_configured");
}

interface TripgicResult {
	status?: string;
	reason?: string | null;
	[key: string]: any;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function price(cost: number): Promise<{ charged: number; markup: number; ruleId: string }> {
	const rule = await getActiveMarkupRule();
	const { totalAmount, markupAmount, ruleId } = computeMarkup(cost, rule);
	return { charged: round2(totalAmount), markup: round2(markupAmount), ruleId };
}

// ---- quotes ---------------------------------------------------------------

interface StoredQuote {
	userId: string;
	product: "flight" | "hotel";
	title: string;
	details: Record<string, unknown>;
	costAmount: number;
	costCurrency: string;
	chargedAmount: number;
	markupAmount: number;
	markupRuleId: string;
	priceChanged: boolean;
	previousChargedAmount: number | null;
	adultCount: number;
	roomOccupancies: number[]; // hotels: adults per room
	holdPossible: boolean;
	docRequired: boolean;
	expiresAt: string;
}

export interface QuoteView {
	quoteId: string;
	product: "flight" | "hotel";
	title: string;
	details: Record<string, unknown>;
	totalAmount: number;
	currency: string;
	priceChanged: boolean;
	previousAmount: number | null;
	adultCount: number;
	roomOccupancies: number[];
	holdPossible: boolean;
	docRequired: boolean;
	expiresAt: string;
	paymentMode: PaymentStatus;
}

const quoteKey = (id: string) => `tripgic:quote:${id}`;
const isQuoteId = (v: string) => /^[A-Za-z0-9]{8,64}$/.test(v);

async function storeQuote(quoteId: string, quote: StoredQuote, sessionExpireTimestamp: number | undefined): Promise<void> {
	let ttl = QUOTE_TTL_MAX_SECONDS;
	if (sessionExpireTimestamp) {
		ttl = Math.min(ttl, Math.floor(sessionExpireTimestamp - Date.now() / 1000) - 10);
	}
	if (ttl < 30) throw new BookingError("This price has expired -- please search again", 409, "quote_expired");
	quote.expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
	await redis.set(quoteKey(quoteId), JSON.stringify(quote), "EX", ttl);
}

function toQuoteView(quoteId: string, q: StoredQuote): QuoteView {
	return {
		quoteId,
		product: q.product,
		title: q.title,
		details: q.details,
		totalAmount: q.chargedAmount,
		currency: q.costCurrency,
		priceChanged: q.priceChanged,
		previousAmount: q.previousChargedAmount,
		adultCount: q.adultCount,
		roomOccupancies: q.roomOccupancies,
		holdPossible: q.holdPossible,
		docRequired: q.docRequired,
		expiresAt: q.expiresAt,
		paymentMode: resolvePaymentStatus(),
	};
}

async function loadQuote(quoteId: string, userId: string, product: "flight" | "hotel"): Promise<StoredQuote> {
	if (!isQuoteId(quoteId)) throw new BookingError("Invalid quote", 400, "invalid_quote");
	const raw = await redis.get(quoteKey(quoteId));
	if (!raw) throw new BookingError("This price has expired -- please start the booking again", 410, "quote_expired");
	const quote = JSON.parse(raw) as StoredQuote;
	// Same answer for "not yours" and "doesn't exist", so quote ids can't be probed.
	if (quote.userId !== userId || quote.product !== product) throw new BookingError("This price has expired -- please start the booking again", 410, "quote_expired");
	return quote;
}

// ---- flights: quote -------------------------------------------------------

function dateOnly(iso: string): string {
	return iso.slice(0, 10);
}

export async function quoteTripgicFlight(userId: string, offerId: string): Promise<QuoteView> {
	resolvePaymentStatus();
	const sep = offerId.indexOf(":");
	if (sep < 1 || sep === offerId.length - 1) throw new BookingError("Invalid offer", 400, "invalid_offer");
	const trackingId = offerId.slice(0, sep);
	const flightKey = offerId.slice(sep + 1);

	const v = await tripgicPost<TripgicResult>("/flight/validate", {
		member_id: memberId(),
		result_type: "general",
		data: [{ tracking_id: trackingId, flight_key: flightKey }],
	});
	if (v.status !== "success" || !v.booking_tracking_id || !v.validation_price) {
		console.error("TripGic flight validate failed:", v.reason);
		throw new BookingError("This fare is no longer available -- please search again", 409, "fare_unavailable");
	}

	const offer = v.data ?? {};
	const slices: FlightSliceView[] = mapTripgicSlices(offer.flight_group ?? []);
	if (!slices.length) throw new BookingError("This fare is no longer available -- please search again", 409, "fare_unavailable");

	const cost = Number(v.validation_price.amount);
	const searched = Number(v.search_price?.amount ?? cost);
	const now = await price(cost);
	const before = round2((await price(searched)).charged);
	const priceChanged = round2(cost) !== round2(searched);

	const first = slices[0];
	const last = slices[slices.length - 1];
	const route = slices.length > 1 ? `${first.originAirport} to ${first.destinationAirport} and back` : `${first.originAirport} to ${last.destinationAirport}`;
	const dates = slices.length > 1 ? `${dateOnly(first.departingAt)} / ${dateOnly(last.departingAt)}` : dateOnly(first.departingAt);

	const paxOptions = offer.pax_options ?? {};
	const quote: StoredQuote = {
		userId,
		product: "flight",
		title: `${route}, ${dates}`,
		details: {
			airline: offer.flight_group?.[0]?.routes?.[0]?.marketing?.carrier_name ?? null,
			slices,
			refundable: offer.fare_rules?.refundable ?? null,
		},
		costAmount: round2(cost),
		costCurrency: v.validation_price.currency,
		chargedAmount: now.charged,
		markupAmount: now.markup,
		markupRuleId: now.ruleId,
		priceChanged,
		previousChargedAmount: priceChanged ? before : null,
		adultCount: Number(offer.search_parameter?.travelers_adult ?? 1),
		roomOccupancies: [],
		holdPossible: offer.hold_possible === "yes",
		docRequired: !/^(no|0|false)$/i.test(String(paxOptions.doc_required ?? "yes")),
		expiresAt: "",
	};
	await storeQuote(v.booking_tracking_id, quote, v.session_expire?.timestamp);
	return toQuoteView(v.booking_tracking_id, quote);
}

// ---- hotels: rooms + quote ------------------------------------------------

export interface HotelRoomsParams {
	hotelId: string;
	checkInDate: string;
	checkOutDate: string;
	rooms: number;
	adults: number;
}

export interface HotelRoomView {
	roomTrackingId: string;
	title: string;
	totalAmount: number;
	currency: string;
	refundable: boolean;
	freeCancellationUntil: string | null;
	holdPossible: boolean;
	meals: string[];
	beds: string[];
	amenities: string[];
}

export async function listTripgicHotelRooms(params: HotelRoomsParams): Promise<{ trackingId: string; rooms: HotelRoomView[] }> {
	const res = await tripgicPost<TripgicResult>(
		"/hotel/rooms",
		{
			hotel_id: params.hotelId,
			checkIn: params.checkInDate,
			checkOut: params.checkOutDate,
			occupancies: buildOccupancies(params.rooms, params.adults),
			guest_nationality: DEFAULT_GUEST_NATIONALITY,
		},
		{ timeoutMs: 60000 }
	);
	if (res.status !== "success" || !res.tracking_id) {
		if (/no room|not available|no result/i.test(res.reason ?? "")) return { trackingId: "", rooms: [] };
		console.error("TripGic hotel rooms failed:", res.reason);
		throw new BookingError("Rooms could not be loaded for this property", 502, "rooms_unavailable");
	}
	const rule = await getActiveMarkupRule();
	const rooms: HotelRoomView[] = (res.data?.rooms ?? []).map((r: any) => {
		const summary = r.summery ?? {};
		const first = r.data?.[0] ?? {};
		const cancellation = first.cancellation_policy ?? {};
		const refundable = cancellation.summery === "refundable";
		const { totalAmount } = computeMarkup(Number(summary.total_amount), rule);
		return {
			roomTrackingId: summary.room_tracking_id,
			title: summary.title ?? first.name ?? "Room",
			totalAmount: round2(totalAmount),
			currency: summary.currency,
			refundable,
			freeCancellationUntil: refundable ? cancellation.auto_cancel ?? null : null,
			holdPossible: summary.hold_possible === "yes",
			meals: (first.meal_option ?? []).filter((m: any) => m.included === "yes").map((m: any) => m.title),
			beds: (first.bed_option ?? []).map((b: any) => b.title),
			amenities: (first.amenities ?? []).map((a: any) => a.title).slice(0, 8),
		};
	});
	rooms.sort((a, b) => a.totalAmount - b.totalAmount);
	return { trackingId: res.tracking_id, rooms };
}

export async function quoteTripgicHotel(userId: string, input: { trackingId: string; roomTrackingId: string }): Promise<QuoteView> {
	resolvePaymentStatus();
	const v = await tripgicPost<TripgicResult>("/hotel/validate", { tracking_id: input.trackingId, room_tracking_id: input.roomTrackingId });
	if (v.status !== "success" || !v.booking_tracking_id || !v.validation_price) {
		console.error("TripGic hotel validate failed:", v.reason);
		throw new BookingError("This room is no longer available -- please choose another", 409, "room_unavailable");
	}

	// Hotel name/photo/address only come back from the price-detail call.
	const detail = await tripgicPost<TripgicResult>("/hotel/validation-price-get-detail", {
		booking_tracking_id: v.booking_tracking_id,
		member_id: memberId(),
	});
	const content = detail.hotel_contents?.data ?? {};
	const sp = v.search_parameter ?? {};
	const roomSummary = v.data?.summery ?? {};
	const roomData = v.data?.data?.[0] ?? {};
	const cancellation = roomData.cancellation_policy ?? {};

	const cost = Number(v.validation_price.amount);
	const searched = Number(v.search_price?.amount ?? cost);
	const now = await price(cost);
	const before = (await price(searched)).charged;
	const priceChanged = round2(cost) !== round2(searched);

	const occupancies: number[] = (sp.occupancies ?? []).map((o: any) => Number(o.adult) || 1);
	const hotelName = content.name ?? "Hotel";
	const quote: StoredQuote = {
		userId,
		product: "hotel",
		title: `${hotelName}, ${sp.checkIn} to ${sp.checkOut}`,
		details: {
			hotelId: sp.hotel_id ?? roomSummary.hotel_id,
			hotelName,
			photoUrl: content.primary_photo ?? null,
			address: [content.address?.address_line_1, content.address?.city, content.address?.state, content.address?.country_code].filter(Boolean).join(", ") || null,
			latitude: content.address?.latitude ?? null,
			longitude: content.address?.longitude ?? null,
			roomTitle: roomSummary.title ?? roomData.name ?? null,
			checkInDate: sp.checkIn,
			checkOutDate: sp.checkOut,
			nights: Number(sp.total_night) || null,
			roomOccupancies: occupancies,
			refundable: cancellation.summery === "refundable",
			freeCancellationUntil: cancellation.summery === "refundable" ? cancellation.auto_cancel ?? null : null,
		},
		costAmount: round2(cost),
		costCurrency: v.validation_price.currency,
		chargedAmount: now.charged,
		markupAmount: now.markup,
		markupRuleId: now.ruleId,
		priceChanged,
		previousChargedAmount: priceChanged ? before : null,
		adultCount: occupancies.reduce((a, b) => a + b, 0) || 1,
		roomOccupancies: occupancies.length ? occupancies : [1],
		holdPossible: roomSummary.hold_possible === "yes",
		docRequired: false,
		expiresAt: "",
	};
	await storeQuote(v.booking_tracking_id, quote, v.session_expire?.timestamp);
	return toQuoteView(v.booking_tracking_id, quote);
}

// ---- orders ---------------------------------------------------------------

export interface ContactInput {
	email: string;
	isdCode: string; // "61"
	phoneNumber: string; // national number, e.g. "0412345678"
}

export interface FlightPassengerInput {
	title: "mr" | "ms" | "mrs" | "miss";
	gender: "m" | "f";
	givenName: string;
	familyName: string;
	bornOn: string;
	passportNumber?: string;
	passportCountry?: string; // ISO-2
	passportExpiry?: string;
}

export interface HotelGuestInput {
	title: "mr" | "ms" | "mrs" | "miss";
	gender: "m" | "f";
	givenName: string;
	familyName: string;
	age?: number;
}

// TripGic rejects a hotel guest with no age ("Passenger Age is missing",
// confirmed live). Age only affects pricing for children, and Drift's
// search is adults-only, so an unspecified adult is sent as 30 rather than
// making every traveller type in a number nothing uses.
const DEFAULT_ADULT_AGE = 30;

export interface OrderView {
	id: string;
	product: "flight" | "hotel";
	status: string;
	title: string;
	details: any;
	priceChargedAmount: number;
	currency: string;
	bookingId: string | null;
	supplierReference: string | null;
	paymentStatus: string;
	fulfilled: boolean;
	message: string | null;
	voucherUrl: string | null;
	holdExpiresAt: string | null;
	canCancel: boolean;
	createdAt: string;
}

const STATUS_MESSAGES: Record<string, string> = {
	held: "Your booking is reserved but not finalised yet. We'll complete it as soon as possible.",
	ticketed: "Your tickets are issued.",
	confirmed: "Your stay is confirmed.",
	cancelled: "This booking was cancelled.",
	expired: "This reservation expired before it was finalised.",
	failed: "This booking could not be completed.",
};

function rowToView(row: any): OrderView {
	const fulfilled = row.status === "ticketed" || row.status === "confirmed";
	return {
		id: row.id,
		product: row.product_type,
		status: row.status,
		title: row.title,
		details: row.details,
		priceChargedAmount: Number(row.price_charged_amount),
		currency: row.price_charged_currency,
		bookingId: row.tripgic_booking_id,
		supplierReference: row.supplier_reference,
		paymentStatus: row.payment_status,
		fulfilled,
		message: STATUS_MESSAGES[row.status] ?? null,
		voucherUrl: row.voucher_url,
		holdExpiresAt: row.hold_expires_at ? new Date(row.hold_expires_at).toISOString() : null,
		canCancel: row.status === "held" && row.payment_status !== "collected",
		createdAt: new Date(row.created_at).toISOString(),
	};
}

async function findOrderByQuote(quoteId: string, userId: string): Promise<OrderView | null> {
	const { rows } = await pool.query("SELECT * FROM tripgic_orders WHERE quote_id = $1", [quoteId]);
	if (!rows.length) return null;
	if (rows[0].user_id !== userId) throw new BookingError("This price has expired -- please start the booking again", 410, "quote_expired");
	return rowToView(rows[0]);
}

// Machine code only. TripGic's own wording can include our wallet balance,
// so it is logged and never stored or returned.
function classifyFailure(reason: string | null | undefined): "supplier_funding" | "supplier_rejected" {
	return /balance|insufficient|wallet|fund/i.test(reason ?? "") ? "supplier_funding" : "supplier_rejected";
}

async function withOrderLock<T>(quoteId: string, fn: () => Promise<T>): Promise<T> {
	const key = `tripgic:order-lock:${quoteId}`;
	const got = await redis.set(key, "1", "EX", ORDER_LOCK_SECONDS, "NX");
	if (!got) throw new BookingError("This booking is already being processed", 409, "in_progress");
	try {
		return await fn();
	} finally {
		await redis.del(key);
	}
}

async function insertOrder(params: {
	userId: string;
	quoteId: string;
	quote: StoredQuote;
	general: any;
	status: "held" | "confirmed";
	paymentStatus: PaymentStatus;
	holdExpiresAt: Date | null;
	voucherUrl: string | null;
	details: Record<string, unknown>;
}): Promise<any> {
	const { general, quote } = params;
	try {
		const { rows } = await pool.query(
			`INSERT INTO tripgic_orders
			   (user_id, product_type, quote_id, tripgic_tracking_id, tripgic_booking_id, supplier_reference, status, title, details,
			    cost_amount, cost_currency, price_charged_amount, price_charged_currency, markup_amount, markup_rule_id,
			    payment_status, voucher_url, hold_expires_at, fulfilled_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, CASE WHEN $7 = 'confirmed' THEN NOW() END)
			 RETURNING *`,
			[
				params.userId,
				quote.product,
				params.quoteId,
				general.tracking_id,
				general.booking_id ?? null,
				general.airlines_pnr ?? general.supplier_confirmation_id ?? null,
				params.status,
				quote.title,
				JSON.stringify(params.details),
				quote.costAmount,
				quote.costCurrency,
				quote.chargedAmount,
				quote.costCurrency,
				quote.markupAmount,
				quote.markupRuleId,
				params.paymentStatus,
				params.voucherUrl,
				params.holdExpiresAt,
			]
		);
		return rows[0];
	} catch (err) {
		// The supplier booking exists but we couldn't record it. Cancel it
		// rather than leave an orphan that holds inventory (and, for hotels,
		// may already have debited the wallet -- flagged in the log).
		console.error(`TripGic order insert failed AFTER booking ${general.tracking_id} was created -- attempting cancel:`, err);
		const path = quote.product === "flight" ? "/flight/cancel-booking" : "/hotel/cancel-booking";
		await tripgicPost(path, { member_id: memberId(), tracking_id: general.tracking_id, reason: "internal error" }).catch((e) =>
			console.error(`Cancel of orphaned TripGic booking ${general.tracking_id} also failed -- needs manual cleanup:`, e)
		);
		throw new BookingError("We couldn't save your booking -- please try again", 500, "persist_failed");
	}
}

async function markOrder(id: string, fields: { status?: string; fulfilmentError?: string | null; fulfilled?: boolean; voucherUrl?: string | null }): Promise<any> {
	const { rows } = await pool.query(
		`UPDATE tripgic_orders SET
		   status = COALESCE($2, status),
		   fulfilment_error = $3,
		   fulfilled_at = CASE WHEN $4 THEN NOW() ELSE fulfilled_at END,
		   voucher_url = COALESCE($5, voucher_url),
		   updated_at = NOW()
		 WHERE id = $1 RETURNING *`,
		[id, fields.status ?? null, fields.fulfilmentError ?? null, fields.fulfilled ?? false, fields.voucherUrl ?? null]
	);
	return rows[0];
}

function assertContact(c: ContactInput) {
	if (!/^\d{1,4}$/.test(c.isdCode) || !/^\d{5,15}$/.test(c.phoneNumber)) {
		throw new BookingError("Enter a valid phone number", 400, "invalid_contact");
	}
}

function guardPriceChange(quote: StoredQuote, accepted: boolean | undefined) {
	if (quote.priceChanged && !accepted) {
		throw new BookingError("The price changed -- please review the new total", 409, "price_changed", {
			totalAmount: quote.chargedAmount,
			previousAmount: quote.previousChargedAmount,
		});
	}
}

export async function createTripgicFlightOrder(params: {
	userId: string;
	quoteId: string;
	passengers: FlightPassengerInput[];
	contact: ContactInput;
	acceptPriceChange?: boolean;
}): Promise<OrderView> {
	const paymentStatus = resolvePaymentStatus();
	const existing = await findOrderByQuote(params.quoteId, params.userId);
	if (existing) return existing;
	const quote = await loadQuote(params.quoteId, params.userId, "flight");
	if (params.passengers.length !== quote.adultCount) {
		throw new BookingError(`This fare is for ${quote.adultCount} traveller(s)`, 400, "passenger_count");
	}
	if (quote.docRequired && params.passengers.some((p) => !p.passportNumber || !p.passportCountry || !p.passportExpiry)) {
		throw new BookingError("Passport details are required for this flight", 400, "passport_required");
	}
	assertContact(params.contact);
	guardPriceChange(quote, params.acceptPriceChange);

	return withOrderLock(params.quoteId, async () => {
		const raced = await findOrderByQuote(params.quoteId, params.userId);
		if (raced) return raced;

		const travellers = await tripgicPost<TripgicResult>("/flight/update-travellers", {
			booking_tracking_id: params.quoteId,
			member_id: memberId(),
			save_pax: "no",
			passenger: params.passengers.map((p, i) => ({
				pax_id: String(i + 1),
				pax_type: "ADT",
				gender: p.gender.toUpperCase(),
				title: p.title.toUpperCase(),
				first_name: p.givenName,
				last_name: p.familyName,
				dob: p.bornOn,
				...(p.passportNumber
					? { doc_country: p.passportCountry, doc_no: p.passportNumber, doc_dateofexpiry: p.passportExpiry }
					: {}),
				isd_code: params.contact.isdCode,
				contact_no: params.contact.phoneNumber,
				email_address: params.contact.email,
				wheelchair_required: "no",
			})),
		});
		if (travellers.status !== "success") {
			console.error("TripGic update-travellers failed:", travellers.reason);
			throw new BookingError(`The passenger details were not accepted: ${String(travellers.reason ?? "please check them").slice(0, 160)}`, 422, "travellers_rejected");
		}

		const created = await tripgicPost<TripgicResult>("/flight/create-booking", {
			booking_tracking_id: params.quoteId,
			member_id: memberId(),
			isd_code: params.contact.isdCode,
			contact_no: params.contact.phoneNumber,
			email_address: params.contact.email,
			payment_type: 1, // undocumented but required -- see the flight probe notes
		});
		if (created.status !== "success" || !created.general?.tracking_id) {
			console.error("TripGic flight create-booking failed:", created.reason);
			const code = classifyFailure(created.reason);
			throw new BookingError(
				code === "supplier_funding" ? "We can't complete this booking right now -- please try again later" : "The airline rejected this booking -- please search again",
				code === "supplier_funding" ? 503 : 409,
				code
			);
		}

		const autoCancel = Number(created.booking?.auto_cancel_timestamp);
		const row = await insertOrder({
			userId: params.userId,
			quoteId: params.quoteId,
			quote,
			general: created.general,
			status: "held",
			paymentStatus,
			holdExpiresAt: autoCancel ? new Date(autoCancel * 1000) : null,
			voucherUrl: created.voucher?.pdf ?? null,
			details: {
				...quote.details,
				passengers: params.passengers.map((p) => ({ title: p.title, givenName: p.givenName, familyName: p.familyName, bornOn: p.bornOn })),
				contactEmail: params.contact.email,
			},
		});

		const issued = await tripgicPost<TripgicResult>("/flight/issue-ticket", {
			member_id: memberId(),
			tracking_id: created.general.tracking_id,
			price_change_accepted: quote.priceChanged ? "yes" : "no",
			notes: paymentStatus === "not_collected_sandbox" ? "Drift sandbox booking" : "",
		});
		if (issued.status !== "success") {
			console.error(`TripGic issue-ticket failed for ${created.general.tracking_id}:`, issued.reason);
			return rowToView(await markOrder(row.id, { fulfilmentError: classifyFailure(issued.reason) }));
		}
		return rowToView(await markOrder(row.id, { status: "ticketed", fulfilled: true }));
	});
}

export async function createTripgicHotelOrder(params: {
	userId: string;
	quoteId: string;
	guests: HotelGuestInput[];
	contact: ContactInput;
	specialRequests?: string;
	acceptPriceChange?: boolean;
}): Promise<OrderView> {
	const paymentStatus = resolvePaymentStatus();
	const existing = await findOrderByQuote(params.quoteId, params.userId);
	if (existing) return existing;
	const quote = await loadQuote(params.quoteId, params.userId, "hotel");
	if (params.guests.length !== quote.adultCount) {
		throw new BookingError(`This booking is for ${quote.adultCount} guest(s)`, 400, "guest_count");
	}
	assertContact(params.contact);
	guardPriceChange(quote, params.acceptPriceChange);

	// Guests are listed room by room, in the order the rooms were searched.
	const roomFor: number[] = [];
	quote.roomOccupancies.forEach((adults, roomIndex) => {
		for (let i = 0; i < adults; i++) roomFor.push(roomIndex + 1);
	});

	return withOrderLock(params.quoteId, async () => {
		const raced = await findOrderByQuote(params.quoteId, params.userId);
		if (raced) return raced;

		const travellers = await tripgicPost<TripgicResult>("/hotel/update-travellers", {
			tracking_id: params.quoteId,
			member_id: memberId(),
			save_pax: "no",
			passenger: params.guests.map((g, i) => ({
				pax_id: String(i + 1),
				room_number: String(roomFor[i] ?? 1),
				pax_type: "ADT",
				gender: g.gender.toUpperCase(),
				title: g.title.charAt(0).toUpperCase() + g.title.slice(1),
				first_name: g.givenName,
				last_name: g.familyName,
				age: String(g.age ?? DEFAULT_ADULT_AGE),
			})),
		});
		if (travellers.status !== "success") {
			console.error("TripGic hotel update-travellers failed:", travellers.reason);
			throw new BookingError(`The guest details were not accepted: ${String(travellers.reason ?? "please check them").slice(0, 160)}`, 422, "travellers_rejected");
		}

		// NOT /hotel/create -- that path in TripGic's spec 404s.
		const created = await tripgicPost<TripgicResult>("/hotel/create-booking", {
			tracking_id: params.quoteId,
			member_id: memberId(),
			isd_code: params.contact.isdCode,
			contact_no: params.contact.phoneNumber,
			email_address: params.contact.email,
			payment_type: 1,
			special_requests_notes: params.specialRequests?.slice(0, 200) || "n/a",
		});
		if (created.status !== "success" || !created.general?.tracking_id) {
			console.error("TripGic hotel create-booking failed:", created.reason);
			const code = classifyFailure(created.reason);
			throw new BookingError(
				code === "supplier_funding" ? "We can't complete this booking right now -- please try again later" : "The hotel rejected this booking -- please choose another room",
				code === "supplier_funding" ? 503 : 409,
				code
			);
		}

		const held = /hold/i.test(String(created.booking?.booking_status ?? ""));
		const row = await insertOrder({
			userId: params.userId,
			quoteId: params.quoteId,
			quote,
			general: created.general,
			status: held ? "held" : "confirmed",
			paymentStatus,
			holdExpiresAt: null,
			voucherUrl: created.voucher?.pdf ?? created.voucher?.link ?? null,
			details: {
				...quote.details,
				guests: params.guests.map((g) => ({ title: g.title, givenName: g.givenName, familyName: g.familyName })),
				contactEmail: params.contact.email,
			},
		});
		if (!held) return rowToView(row);

		const issued = await tripgicPost<TripgicResult>("/hotel/issue-voucher", {
			member_id: memberId(),
			tracking_id: created.general.tracking_id,
			price_change_accepted: quote.priceChanged ? "yes" : "no",
			notes: paymentStatus === "not_collected_sandbox" ? "Drift sandbox booking" : "not required",
		});
		if (issued.status !== "success") {
			console.error(`TripGic issue-voucher failed for ${created.general.tracking_id}:`, issued.reason);
			return rowToView(await markOrder(row.id, { fulfilmentError: classifyFailure(issued.reason) }));
		}
		return rowToView(await markOrder(row.id, { status: "confirmed", fulfilled: true }));
	});
}

// ---- reading / cancelling -------------------------------------------------

export async function listTripgicOrders(userId: string): Promise<OrderView[]> {
	// Flight holds auto-cancel at the supplier; reflect that instead of
	// showing a reservation that no longer exists.
	await pool.query(
		`UPDATE tripgic_orders SET status = 'expired', updated_at = NOW()
		 WHERE user_id = $1 AND status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()`,
		[userId]
	);
	const { rows } = await pool.query("SELECT * FROM tripgic_orders WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
	return rows.map(rowToView);
}

// Opening a single booking re-reads it from TripGic, because things happen
// to a booking outside Drift: the hold deadline moves, the supplier or
// TripGic operations cancels or ticket it after the fact. Best-effort --
// if TripGic is unreachable the stored row is returned as-is.
//
// Status vocabulary here is only partly confirmed: "hold" and "cancel..."
// have been seen; the "ticketed"/"confirmed" spellings are matched loosely
// because no booking has got past issue-ticket yet (wallet empty).
async function syncOrderFromTripgic(order: any): Promise<any> {
	if (order.status !== "held") return order;
	try {
		const d = await tripgicPost<TripgicResult>("/booking-details", { member_id: memberId(), tracking_id: order.tripgic_tracking_id });
		if (d.status !== "success" || !d.booking) return order;
		const b = d.booking;
		const bookingStatus = String(b.booking_status ?? "");
		const ticketStatus = String(b.ticket_status ?? "");
		let status: string | null = null;
		if (/cancel|void/i.test(bookingStatus)) status = "cancelled";
		else if (/^(ticketed|issued)$/i.test(ticketStatus) || /^(ticketed|confirmed|voucher)/i.test(bookingStatus)) status = order.product_type === "flight" ? "ticketed" : "confirmed";
		const autoCancel = Number(b.auto_cancel_timestamp);
		const { rows } = await pool.query(
			`UPDATE tripgic_orders SET
			   status = COALESCE($2, status),
			   hold_expires_at = COALESCE($3, hold_expires_at),
			   fulfilled_at = CASE WHEN $2 IN ('ticketed','confirmed') THEN NOW() ELSE fulfilled_at END,
			   cancelled_at = CASE WHEN $2 = 'cancelled' THEN NOW() ELSE cancelled_at END,
			   updated_at = NOW()
			 WHERE id = $1 RETURNING *`,
			[order.id, status, autoCancel && order.hold_expires_at ? new Date(autoCancel * 1000) : null]
		);
		return rows[0];
	} catch (err) {
		console.error(`TripGic order sync failed for ${order.tripgic_tracking_id}:`, err);
		return order;
	}
}

export async function getTripgicOrder(userId: string, orderId: string): Promise<OrderView> {
	if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new BookingError("Booking not found", 404, "not_found");
	const { rows } = await pool.query("SELECT * FROM tripgic_orders WHERE id = $1 AND user_id = $2", [orderId, userId]);
	if (!rows.length) throw new BookingError("Booking not found", 404, "not_found");
	return rowToView(await syncOrderFromTripgic(rows[0]));
}

export async function cancelTripgicOrder(userId: string, orderId: string): Promise<OrderView> {
	if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new BookingError("Booking not found", 404, "not_found");
	const { rows } = await pool.query("SELECT * FROM tripgic_orders WHERE id = $1 AND user_id = $2", [orderId, userId]);
	if (!rows.length) throw new BookingError("Booking not found", 404, "not_found");
	const order = rows[0];
	// Cancelling anything that was paid for is a refund, and there is no
	// refund path yet -- so only an unpaid reservation can be cancelled here.
	if (order.status !== "held" || order.payment_status === "collected") {
		throw new BookingError("This booking can't be cancelled online -- please contact support", 409, "not_cancellable");
	}
	const path = order.product_type === "flight" ? "/flight/cancel-booking" : "/hotel/cancel-booking";
	const res = await tripgicPost<TripgicResult>(path, { member_id: memberId(), tracking_id: order.tripgic_tracking_id, reason: "cancelled by traveller" });
	if (res.status !== "success") {
		console.error(`TripGic cancel failed for ${order.tripgic_tracking_id}:`, res.reason);
		// Confirmed live: TripGic's sandbox refuses API cancels even on a fresh,
		// never-ticketed hold ("contact the operations team"). Nothing is marked
		// cancelled here, so the order can't claim something that isn't true.
		throw new BookingError("We couldn't cancel this booking online -- please contact support", 502, "cancel_failed");
	}
	const { rows: updated } = await pool.query(
		`UPDATE tripgic_orders SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
		[orderId]
	);
	return rowToView(updated[0]);
}
