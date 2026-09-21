// Reading TripGic's /booking-details answer, kept free of database and network code so it can be
// tested on its own (tests/tripgicStatus.test.ts).
//
// What TripGic's sandbox has actually been seen to say (2026-09-21, nine held test bookings, fresh
// and long past their deadline alike):
//     booking_status: "hold"   ticket_status: "inQues"   payment_status: "pending"
//     auto_cancel_timestamp: "1790049599" (seconds since 1970, UTC)
// TripGic does NOT flip a booking to cancelled or expired when its deadline passes, so Drift has to
// expire it. No booking has ever got past issue-ticket (the wallet was never funded), so the words
// for "ticketed" and "cancelled" are still matched loosely, and every status seen is stored on the
// order (supplier_status) so the real vocabulary can be learned and tightened.

export interface BookingReading {
	// What the booking has become at TripGic, or null when it is unchanged (still held).
	status: "ticketed" | "cancelled" | null;
	// The hold deadline TripGic currently has, or null when it gave none we can trust.
	deadline: Date | null;
	// "booking_status/ticket_status" exactly as reported, for the record.
	supplierStatus: string;
	// False when the wording is not one we have seen or expect: worth a log line.
	recognised: boolean;
}

const MIN_PLAUSIBLE_DEADLINE = Date.UTC(2020, 0, 1);

export function interpretBooking(booking: any): BookingReading {
	const bookingStatus = String(booking?.booking_status ?? "").trim();
	const ticketStatus = String(booking?.ticket_status ?? "").trim();
	const supplierStatus = `${bookingStatus}/${ticketStatus}`;

	let status: BookingReading["status"] = null;
	// Cancelled is checked first: a cancelled booking may still carry an old ticket status.
	if (/cancel|void/i.test(bookingStatus)) status = "cancelled";
	else if (/^(ticketed|issued)$/i.test(ticketStatus) || /^(ticketed|confirmed|voucher)/i.test(bookingStatus)) status = "ticketed";

	// Wording seen so far for a booking that is simply waiting.
	const knownWaiting = /^hold/i.test(bookingStatus) && /^(inques|pending|)$/i.test(ticketStatus);

	const seconds = Number(booking?.auto_cancel_timestamp);
	const ms = Number.isFinite(seconds) ? seconds * 1000 : NaN;
	const deadline = Number.isFinite(ms) && ms > MIN_PLAUSIBLE_DEADLINE ? new Date(ms) : null;

	return { status, deadline, supplierStatus, recognised: status !== null || knownWaiting };
}

// The bookings we have local dates for, so the hourly check can skip trips that are over.
export function isStillUpcoming(details: any, productType: string, now: Date): boolean {
	const yesterday = now.getTime() - 24 * 60 * 60 * 1000;
	const raw = productType === "flight" ? details?.slices?.[0]?.departingAt : details?.checkOutDate ?? details?.checkInDate;
	if (!raw) return true; // no date on record: keep watching
	const t = new Date(raw).getTime();
	return Number.isNaN(t) ? true : t > yesterday;
}
