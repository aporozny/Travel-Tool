import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { searchFlights, createCheckoutPaymentIntent, confirmCheckoutPaymentIntent, createFlightOrder } from "../services/flights";

export const flightsRouter = Router();

const searchSchema = z.object({
	origin: z.string().length(3).toUpperCase(),
	destination: z.string().length(3).toUpperCase(),
	departureDate: z.string().date(),
	returnDate: z.string().date().optional(),
	adults: z.number().int().min(1).max(9).default(1),
	cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
});

// POST /api/v1/flights/search
// Ships inactive: searchFlights() throws a clear "not configured" error
// (surfaced here as 503) until DUFFEL_API_KEY is set, same fail-closed
// default as every other credential-gated route in this codebase.
flightsRouter.post("/search", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = searchSchema.parse(req.body);
		const offers = await searchFlights(body);
		return res.json({ offers });
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		if (err instanceof Error && err.message.includes("not configured")) {
			return res.status(503).json({ message: "Flight search is not yet available" });
		}
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

const paymentIntentSchema = z.object({
	offerId: z.string().min(1),
});

// POST /api/v1/flights/payment-intents
// First step of checkout: creates a Duffel Payment Intent for the
// marked-up total. Returns the client_token the frontend needs to render
// DuffelCardForm -- no card data ever reaches this server.
flightsRouter.post("/payment-intents", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const { offerId } = paymentIntentSchema.parse(req.body);
		const intent = await createCheckoutPaymentIntent(offerId);
		return res.json(intent);
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		if (err instanceof Error && err.message.includes("not configured")) {
			return res.status(503).json({ message: "Flight booking is not yet available" });
		}
		if (err instanceof Error && err.message.includes("expired")) {
			return res.status(409).json({ message: err.message });
		}
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

const confirmPaymentIntentSchema = z.object({
	paymentIntentId: z.string().min(1),
});

// POST /api/v1/flights/payment-intents/confirm
// Second step: called once the traveler has submitted their card via
// DuffelCardForm client-side. Confirms the charge and credits Drift's
// Balance.
flightsRouter.post("/payment-intents/confirm", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const { paymentIntentId } = confirmPaymentIntentSchema.parse(req.body);
		const result = await confirmCheckoutPaymentIntent(paymentIntentId);
		return res.json(result);
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		if (err instanceof Error && err.message.includes("not configured")) {
			return res.status(503).json({ message: "Flight booking is not yet available" });
		}
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

const passengerSchema = z.object({
	id: z.string().min(1),
	title: z.enum(["mr", "ms", "mrs", "miss"]),
	gender: z.enum(["m", "f"]),
	givenName: z.string().min(1),
	familyName: z.string().min(1),
	bornOn: z.string().date(),
	email: z.string().email(),
	phoneNumber: z.string().min(6),
});

const createOrderSchema = z.object({
	offerId: z.string().min(1),
	paymentIntentId: z.string().min(1),
	passengers: z.array(passengerSchema).min(1),
});

// POST /api/v1/flights/orders
// Final step: places the actual booking with the supplier, paid from
// Drift's Balance (funded by the confirmed Payment Intent above).
flightsRouter.post("/orders", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = createOrderSchema.parse(req.body);
		const order = await createFlightOrder({
			userId: req.user!.id,
			duffelOfferId: body.offerId,
			paymentIntentId: body.paymentIntentId,
			passengers: body.passengers,
		});
		return res.status(201).json(order);
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		if (err instanceof Error && err.message.includes("not configured")) {
			return res.status(503).json({ message: "Flight booking is not yet available" });
		}
		if (err instanceof Error && err.message.includes("expired")) {
			return res.status(409).json({ message: err.message });
		}
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});
