import { Router, Request, Response } from "express";
import { getOffersForPlace } from "../services/booking";

export const offersRouter = Router();

// GET /api/v1/offers/place/:placeId
// Bookable offers for a place, if any -- reads through booking.ts's
// toOfferView, which is the single place enforcing "an operator-matched
// offer never carries Drift's checkout link, only the operator's own
// contact." Not named /bookings/* to avoid colliding with the existing
// traveler-to-operator booking-request system at /api/v1/bookings.
offersRouter.get("/place/:placeId", async (req: Request, res: Response) => {
	try {
		const offers = await getOffersForPlace(req.params.placeId);
		return res.json({ offers });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});
