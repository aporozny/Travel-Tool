import { z } from "zod";
import { DuffelError } from "@duffel/api";

// The decisions behind the Duffel checkout, kept free of database and network code so
// they can be tested on their own (tests/flightPaymentRules.test.ts). The ledger and the
// order engine that use them are in flightPayments.ts.

// After this many failed tries we stop offering "try again" and hand it to a person.
export const MAX_ORDER_ATTEMPTS = 3;

// ─── Passengers ──────────────────────────────────────────────────────────────

// International format only ("+61412345678"): Duffel rejects anything else, and that
// used to be discovered only after the card had been charged.
export function normalizePhone(raw: string): string | null {
	const cleaned = raw.replace(/[\s\-().]/g, "");
	return /^\+\d{7,15}$/.test(cleaned) ? cleaned : null;
}

export const passengerInputSchema = z.object({
	id: z.string().min(1),
	title: z.enum(["mr", "ms", "mrs", "miss"]),
	gender: z.enum(["m", "f"]),
	givenName: z.string().trim().min(1).max(60),
	familyName: z.string().trim().min(1).max(60),
	bornOn: z.string().date(),
	email: z.string().email(),
	phoneNumber: z.string().transform((value, ctx) => {
		const normalized = normalizePhone(value);
		if (!normalized) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Phone number must be international, like +61412345678" });
			return z.NEVER;
		}
		return normalized;
	}),
});

export type PassengerInput = z.infer<typeof passengerInputSchema>;

// The people on the order must be exactly the people the offer was priced for:
// every offer passenger once, and nobody else.
export function validatePassengersForOffer(passengers: { id: string }[], offerPassengerIds: string[]): string | null {
	if (passengers.length !== offerPassengerIds.length) {
		return `This fare is for ${offerPassengerIds.length} passenger${offerPassengerIds.length === 1 ? "" : "s"}, but ${passengers.length} ${passengers.length === 1 ? "was" : "were"} given.`;
	}
	const seen = new Set<string>();
	for (const p of passengers) {
		if (!offerPassengerIds.includes(p.id)) return "One of the passengers does not belong to this fare. Please search again.";
		if (seen.has(p.id)) return "The same passenger was entered twice.";
		seen.add(p.id);
	}
	return null;
}

// ─── Price ───────────────────────────────────────────────────────────────────

// Did the card payment cover what the booking now costs? Compared in whole cents so a
// floating point 0.0000001 can never refuse a fair booking.
export function paymentCoversPrice(paid: number, needed: number): boolean {
	return Math.round(paid * 100) >= Math.round(needed * 100);
}

// ─── Why an order failed, and what the traveller is told ────────────────────

export type OrderFailureCode =
	| "fare_expired" // the airline no longer sells this fare
	| "price_changed" // it now costs more than the traveller paid
	| "passenger_details" // the airline did not accept a passenger detail
	| "supplier_balance" // Drift's own supplier balance was too low (our side)
	| "temporary" // a network or supplier hiccup
	| "unrecorded_order" // the airline booked it but we could not record it
	| "stuck"; // the process died part-way through

export class OrderPlacementError extends Error {
	// duffelOrderId is set when the airline DID book it and only our own recording failed,
	// so the ledger can keep the id and a retry finishes recording instead of booking twice.
	constructor(public code: OrderFailureCode, detail?: string, public duffelOrderId?: string) {
		super(detail ?? code);
	}
}

const RETRYABLE: Record<OrderFailureCode, boolean> = {
	fare_expired: false,
	price_changed: false,
	passenger_details: true,
	supplier_balance: true,
	temporary: true,
	unrecorded_order: false,
	stuck: false,
};

// These cannot be fixed by trying again: the traveller's money has to go back.
const NEEDS_REFUND: Record<OrderFailureCode, boolean> = {
	fare_expired: true,
	price_changed: true,
	passenger_details: false,
	supplier_balance: false,
	temporary: false,
	unrecorded_order: false,
	stuck: false,
};

export function classifyOrderError(err: unknown): OrderFailureCode {
	if (err instanceof OrderPlacementError) return err.code;
	if (err instanceof DuffelError) {
		const first = err.errors?.[0];
		const status = err.meta?.status;
		const text = `${first?.code ?? ""} ${first?.type ?? ""} ${first?.message ?? ""}`.toLowerCase();
		// A server-side error says nothing about the fare itself: never read it as "the fare is gone".
		if (typeof status === "number" && status >= 500) return "temporary";
		if (/expired|no_longer_available|not_available|not_found|not found|already_booked|already been booked/.test(text)) return "fare_expired";
		if (/balance/.test(text)) return "supplier_balance";
		// Only a rejected request body points at the passenger details. A refused login (401/403)
		// or a rate limit (429) is our side or a passing problem, and a retry can fix it.
		if (status === 400 || status === 422) return "passenger_details";
		return "temporary";
	}
	return "temporary";
}

// The reason to keep on the payment record and put in the owner's alert. A DuffelError's own
// message is empty; what matters is in its first error entry.
export function describeError(err: unknown): string {
	if (err instanceof DuffelError) {
		const first = err.errors?.[0];
		const parts = [err.meta?.status ? `HTTP ${err.meta.status}` : "", first?.code ?? "", first?.message ?? ""].filter(Boolean);
		return parts.join(": ") || "Duffel rejected the request";
	}
	return err instanceof Error ? err.message : String(err);
}

// Can the traveller press "try again"? Only for problems a retry can fix, and only
// for a few attempts.
export function canRetryAfter(code: OrderFailureCode, attempts: number): boolean {
	return RETRYABLE[code] && attempts < MAX_ORDER_ATTEMPTS;
}

export function needsRefund(code: OrderFailureCode, attempts: number): boolean {
	return NEEDS_REFUND[code] || (RETRYABLE[code] && attempts >= MAX_ORDER_ATTEMPTS);
}

// What the traveller reads. Always says the money is safe and what happens next.
export function travellerMessage(code: OrderFailureCode, attempts: number): string {
	if (!canRetryAfter(code, attempts) && RETRYABLE[code]) {
		return "We could not complete this booking after a few tries. Your payment is safe: we have been alerted and will either finish the booking for you or refund you in full.";
	}
	switch (code) {
		case "fare_expired":
			return "That fare is no longer available, so we could not complete the booking. Your payment is safe and we will refund it in full.";
		case "price_changed":
			return "The airline changed the price while you were paying, so we could not complete the booking. Your payment is safe and we will refund it in full.";
		case "passenger_details":
			return "The airline did not accept one of the passenger details. Please check them and try again. Your payment is safe.";
		case "unrecorded_order":
			return "Your booking was placed with the airline but we could not finish recording it. We have been alerted and will send your confirmation shortly. Please do not pay again.";
		case "stuck":
			return "Your booking did not finish. Your payment is safe: we have been alerted and will either finish the booking for you or refund you in full.";
		case "supplier_balance":
		case "temporary":
		default:
			return "We could not reach the airline just now. Your payment is safe. Please try again in a moment.";
	}
}
