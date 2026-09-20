import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import {
	BookingError,
	quoteTripgicFlight,
	createTripgicFlightOrder,
	listTripgicHotelRooms,
	quoteTripgicHotel,
	createTripgicHotelOrder,
	listTripgicOrders,
	getTripgicOrder,
	cancelTripgicOrder,
} from "../services/tripgicBooking";

// Bookings made through TripGic (flights + hotels). See
// services/tripgicBooking.ts for the model: quote -> order, price always
// server-side, and no order at all unless payments are configured.
export const tripgicRouter = Router();

// Each of these can reserve real inventory (or, once payments exist, take
// money) -- far stricter than the general API limiter.
const bookingRateLimit = rateLimit({
	windowMs: 10 * 60 * 1000,
	max: 30,
	standardHeaders: true,
	legacyHeaders: false,
	message: { message: "Too many booking attempts. Try again in a few minutes." },
});

// While TripGic bookings are sandbox-only (no customer payment exists yet)
// they are open to admin accounts only -- the Stays tab is live to every
// signed-in user, and a regular traveller must not be able to place a
// booking that charges nobody. The role comes from the database (see
// authenticate), never from the token.
function bookingAllowedFor(role: string | undefined): boolean {
	return process.env.TRIPGIC_PAYMENT_MODE === "sandbox" && role === "admin";
}

function requireBookingAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
	if (!bookingAllowedFor(req.user?.role)) {
		return res.status(503).json({ message: "Booking with this provider is not available yet", code: "payments_not_configured" });
	}
	next();
}

// GET /api/v1/tripgic/status -- lets the UI decide whether to show Book
// buttons at all, instead of showing one that can only fail.
tripgicRouter.get("/status", authenticate, (req: AuthenticatedRequest, res: Response) => {
	const enabled = bookingAllowedFor(req.user?.role);
	return res.json({ bookingEnabled: enabled, sandbox: enabled });
});

function respondToError(err: unknown, res: Response) {
	if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
	if (err instanceof BookingError) {
		return res.status(err.httpStatus).json({ message: err.message, code: err.code, ...(err.extra ?? {}) });
	}
	if (err instanceof Error && err.message.includes("not configured")) {
		return res.status(503).json({ message: "Booking with this provider is not available yet" });
	}
	if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
		return res.status(504).json({ message: "The booking provider took too long to respond -- please try again" });
	}
	console.error(err);
	return res.status(500).json({ message: "Internal server error" });
}

const contactSchema = z.object({
	email: z.string().email().max(120),
	isdCode: z.string().regex(/^\d{1,4}$/),
	phoneNumber: z.string().regex(/^\d{5,15}$/),
});
const title = z.enum(["mr", "ms", "mrs", "miss"]);
const gender = z.enum(["m", "f"]);
const name = z.string().trim().min(1).max(60);

// ---- flights ----

// POST /api/v1/tripgic/flights/quote  { offerId }
// Validates the fare with TripGic, re-prices it (markup included) and
// parks the result server-side. The quoteId it returns is what the order
// step is keyed on -- the client never sends a price.
tripgicRouter.post("/flights/quote", authenticate, requireBookingAccess, bookingRateLimit, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const { offerId } = z.object({ offerId: z.string().min(3).max(200) }).parse(req.body);
		return res.json(await quoteTripgicFlight(req.user!.id, offerId));
	} catch (err) {
		return respondToError(err, res);
	}
});

const flightOrderSchema = z.object({
	quoteId: z.string().min(8).max(64),
	passengers: z
		.array(
			z.object({
				title,
				gender,
				givenName: name,
				familyName: name,
				bornOn: z.string().date(),
				passportNumber: z.string().regex(/^[A-Za-z0-9]{5,20}$/).optional(),
				passportCountry: z.string().length(2).toUpperCase().optional(),
				passportExpiry: z.string().date().optional(),
			})
		)
		.min(1)
		.max(9),
	contact: contactSchema,
	acceptPriceChange: z.boolean().optional(),
});

// POST /api/v1/tripgic/flights/orders
tripgicRouter.post("/flights/orders", authenticate, requireBookingAccess, bookingRateLimit, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = flightOrderSchema.parse(req.body);
		const order = await createTripgicFlightOrder({ userId: req.user!.id, ...body });
		return res.status(201).json(order);
	} catch (err) {
		return respondToError(err, res);
	}
});

// ---- hotels ----

const roomsSchema = z.object({
	hotelId: z.string().min(3).max(80),
	checkInDate: z.string().date(),
	checkOutDate: z.string().date(),
	rooms: z.number().int().min(1).max(8).default(1),
	adults: z.number().int().min(1).max(16).default(1),
});

// POST /api/v1/tripgic/hotels/rooms  (~5s upstream, so inline is fine here)
tripgicRouter.post("/hotels/rooms", authenticate, requireBookingAccess, async (req: AuthenticatedRequest, res: Response) => {
	try {
		return res.json(await listTripgicHotelRooms(roomsSchema.parse(req.body)));
	} catch (err) {
		return respondToError(err, res);
	}
});

// POST /api/v1/tripgic/hotels/quote  { trackingId, roomTrackingId }
tripgicRouter.post("/hotels/quote", authenticate, requireBookingAccess, bookingRateLimit, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = z
			.object({ trackingId: z.string().regex(/^[A-Za-z0-9]{8,64}$/), roomTrackingId: z.string().regex(/^[A-Za-z0-9#_.-]{8,120}$/) })
			.parse(req.body);
		return res.json(await quoteTripgicHotel(req.user!.id, body));
	} catch (err) {
		return respondToError(err, res);
	}
});

const hotelOrderSchema = z.object({
	quoteId: z.string().min(8).max(64),
	guests: z.array(z.object({ title, gender, givenName: name, familyName: name, age: z.number().int().min(18).max(110).optional() })).min(1).max(16),
	contact: contactSchema,
	specialRequests: z.string().max(200).optional(),
	acceptPriceChange: z.boolean().optional(),
});

// POST /api/v1/tripgic/hotels/orders
tripgicRouter.post("/hotels/orders", authenticate, requireBookingAccess, bookingRateLimit, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = hotelOrderSchema.parse(req.body);
		const order = await createTripgicHotelOrder({ userId: req.user!.id, ...body });
		return res.status(201).json(order);
	} catch (err) {
		return respondToError(err, res);
	}
});

// ---- the traveller's own orders ----

tripgicRouter.get("/orders", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		return res.json({ orders: await listTripgicOrders(req.user!.id) });
	} catch (err) {
		return respondToError(err, res);
	}
});

tripgicRouter.get("/orders/:id", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		return res.json(await getTripgicOrder(req.user!.id, req.params.id));
	} catch (err) {
		return respondToError(err, res);
	}
});

tripgicRouter.post("/orders/:id/cancel", authenticate, requireBookingAccess, bookingRateLimit, async (req: AuthenticatedRequest, res: Response) => {
	try {
		return res.json(await cancelTripgicOrder(req.user!.id, req.params.id));
	} catch (err) {
		return respondToError(err, res);
	}
});
