import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
	startCall,
	lookupEmergencyNumbers,
	getContactsForCall,
	recordBridgeAttempt,
	endCall,
} from "../services/voiceAgent";

export const voiceAgentRouter = Router();

// The voice AI platform (Retell) calls these mid-call and at call end --
// there's no user session to authenticate against, so this is gated by a
// shared secret instead of the usual JWT `authenticate` middleware. Unset
// VOICE_WEBHOOK_SECRET means the route is closed, not open -- fail closed,
// same as every other credential-gated feature shipped so far (Viator,
// booking): inactive until configured, never silently permissive.
function requireWebhookSecret(req: Request, res: Response, next: NextFunction) {
	const configured = process.env.VOICE_WEBHOOK_SECRET;
	if (!configured) {
		return res.status(503).json({ message: "Voice agent not configured" });
	}
	if (req.header("x-webhook-secret") !== configured) {
		return res.status(401).json({ message: "Unauthorized" });
	}
	return next();
}

voiceAgentRouter.use(requireWebhookSecret);

const callStartedSchema = z.object({
	callerPhone: z.string().min(1),
	platform: z.string().min(1).default("retell"),
	platformCallId: z.string().min(1),
});

// POST /api/v1/voice/call-started
// Fired once when the platform answers an inbound call. Opens (or
// resumes, on retry) the sos_events/sos_ai_calls pair and hands back
// whatever caller context the AI can use to personalize the opening line
// without ever guessing at anything it isn't sure of.
voiceAgentRouter.post("/call-started", async (req: Request, res: Response) => {
	try {
		const body = callStartedSchema.parse(req.body);
		const result = await startCall(body);
		return res.status(201).json({
			callId: result.callId,
			sosEventId: result.sosEventId,
			caller: result.caller,
		});
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		console.error("call-started error:", err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

const lookupNumberSchema = z.object({
	callId: z.string().uuid(),
	countryCode: z.string().min(2).max(2),
});

// POST /api/v1/voice/lookup-emergency-number
// Called by the AI only once the caller's country is confirmed (from
// caller-ID metadata or by asking) -- never used to guess.
voiceAgentRouter.post("/lookup-emergency-number", async (req: Request, res: Response) => {
	try {
		const body = lookupNumberSchema.parse(req.body);
		const result = await lookupEmergencyNumbers(body.countryCode, body.callId);
		if (result.numbers.length === 0) {
			return res.status(404).json({ message: "No emergency numbers on file for this country" });
		}
		return res.json(result);
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		console.error("lookup-emergency-number error:", err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

const listContactsSchema = z.object({ callId: z.string().uuid() });

// POST /api/v1/voice/contacts
// Safety contacts the AI can offer to bridge in (Branch B close: "do you
// want me to try calling [contact] right now?"). Empty for an
// unidentified caller -- that's correct, not an error; the fallback is
// the human reviewer, not a guess at whose contacts to notify.
voiceAgentRouter.post("/contacts", async (req: Request, res: Response) => {
	try {
		const body = listContactsSchema.parse(req.body);
		const contacts = await getContactsForCall(body.callId);
		return res.json({ contacts });
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		console.error("contacts error:", err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

const bridgeSchema = z.object({ callId: z.string().uuid(), connected: z.boolean() });

// POST /api/v1/voice/bridge-attempted
// The platform reports the outcome of its own warm-transfer/dial attempt
// here -- this route only logs it (contact_bridge_attempted/connected),
// it doesn't perform the telephony transfer itself.
voiceAgentRouter.post("/bridge-attempted", async (req: Request, res: Response) => {
	try {
		const body = bridgeSchema.parse(req.body);
		await recordBridgeAttempt(body.callId, body.connected);
		return res.status(204).send();
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		console.error("bridge-attempted error:", err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

const callEndedSchema = z.object({
	callId: z.string().uuid(),
	outcome: z.enum(["genuine_emergency", "distressed_relayed", "false_alarm", "unclear_escalated"]).nullable().optional(),
	transcript: z.string().nullable().optional(),
	rawPayload: z.unknown().optional(),
});

// POST /api/v1/voice/call-ended
// The only route that can move an sos_events row toward "escalated" from
// a voice call -- see endCall() in voiceAgent.ts for why it can never
// move one toward "resolved."
voiceAgentRouter.post("/call-ended", async (req: Request, res: Response) => {
	try {
		const body = callEndedSchema.parse(req.body);
		const result = await endCall({
			callId: body.callId,
			outcome: body.outcome ?? null,
			transcript: body.transcript ?? null,
			rawPayload: body.rawPayload,
		});
		return res.json(result);
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		console.error("call-ended error:", err);
		return res.status(500).json({ message: "Internal server error" });
	}
});
