import { Request, Response, NextFunction } from "express";

// Shared by every Safety Line voice webhook that isn't HMAC-signed (the
// platform's own tool-call/personalization requests, authenticated via a
// custom header + secret configured in that platform's dashboard, not a
// user session). Unset VOICE_WEBHOOK_SECRET means closed, not open -- same
// fail-closed default as every other credential-gated feature shipped so
// far (Viator, booking): inactive until configured, never silently
// permissive. The HMAC-signed post-call webhook (routes/elevenlabsVoice.ts)
// does not use this -- it has its own signature-based verification.
export function requireWebhookSecret(req: Request, res: Response, next: NextFunction) {
	const configured = process.env.VOICE_WEBHOOK_SECRET;
	if (!configured) {
		return res.status(503).json({ message: "Voice agent not configured" });
	}
	if (req.header("x-webhook-secret") !== configured) {
		return res.status(401).json({ message: "Unauthorized" });
	}
	return next();
}
