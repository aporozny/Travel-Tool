import { Router, Request, Response } from "express";
import { verifyDuffelSignature, handleDuffelWebhookEvent, WebhookSignatureError } from "../services/duffelWebhooks";

// Inbound webhooks from third parties. Unlike every other route in this
// codebase these carry no user session -- authenticity comes from a
// provider-specific signature instead of authenticate() (see
// duffelWebhooks.ts). Mounted in index.ts behind a raw-body parser ahead of
// the app's global express.json(), so the exact bytes the provider signed
// are still available here.
export const webhooksRouter = Router();

webhooksRouter.post("/duffel", async (req: Request, res: Response) => {
	const rawBody = req.body;
	if (!Buffer.isBuffer(rawBody)) return res.status(400).json({ message: "Invalid body" });

	try {
		verifyDuffelSignature(rawBody, req.header("X-Duffel-Signature"));
	} catch (err) {
		console.error("Duffel webhook signature check failed:", err instanceof WebhookSignatureError ? err.message : err);
		return res.status(401).json({ message: "Invalid signature" });
	}

	let event: unknown;
	try {
		event = JSON.parse(rawBody.toString("utf8"));
	} catch {
		return res.status(400).json({ message: "Invalid JSON" });
	}

	try {
		await handleDuffelWebhookEvent(event);
		res.status(200).json({ received: true });
	} catch (err) {
		// A non-2xx makes Duffel retry the delivery -- safe, since
		// duffel_event_id dedupes a retried delivery (see migration 033).
		console.error("Duffel webhook processing failed:", err);
		res.status(500).json({ message: "Processing failed" });
	}
});
