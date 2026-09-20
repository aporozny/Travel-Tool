import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { pool } from "../utils/db";
import { recordConsent } from "../services/consent";
import { sendEmail } from "../services/notifications";
import { verifyUnsubscribeToken } from "../services/notificationTokens";
import { buildRenderInput, processDue, unsubscribeUrl } from "../services/tripNotificationWorker";
import { renderMessage, type MessageType } from "../services/tripContent";
import { backfillAll } from "../services/tripNotifications";

// Trip reminders and updates: the traveller's in-app notifications, their
// preferences, a view of what is scheduled, the public unsubscribe link, and a
// few admin tools for testing the flow without waiting days for a real reminder.
export const notificationsRouter = Router();

const UUID = /^[0-9a-f-]{36}$/i;

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
	if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin only" });
	next();
}

// ---- unsubscribe (public) -----------------------------------------------------------

// GET shows a confirmation button and changes nothing: mail scanners open every
// link in a message, and that must not unsubscribe anyone. The POST does the
// work, and is also what mail apps call for one-click List-Unsubscribe.
const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f8f7f4;font-family:Arial,Helvetica,sans-serif;color:#1A1A1A"><div style="max-width:480px;margin:60px auto;background:#fff;border-radius:14px;padding:32px;text-align:center">
<div style="color:#C9A84C;font-size:20px;font-weight:bold;margin-bottom:16px">&#9672; Drift</div>${body}</div></body></html>`;

notificationsRouter.get("/unsubscribe", (req: Request, res: Response) => {
	const userId = verifyUnsubscribeToken(req.query.token);
	if (!userId) return res.status(400).send(page("Invalid link", "<h2>This link isn't valid</h2><p>It may have been copied incorrectly. You can manage reminders in the Drift app.</p>"));
	const token = encodeURIComponent(String(req.query.token));
	return res.send(page("Stop trip reminders", `<h2>Stop trip reminder emails?</h2><p>You won't get reminders about your upcoming trips by email. You can turn them back on any time in Drift.</p>
<form method="POST" action="/api/v1/notifications/unsubscribe?token=${token}"><button style="background:#C9A84C;color:#fff;border:0;border-radius:8px;padding:12px 22px;font-size:15px;font-weight:bold;cursor:pointer">Stop trip emails</button></form>`));
});

notificationsRouter.post("/unsubscribe", async (req: Request, res: Response) => {
	const userId = verifyUnsubscribeToken(req.query.token);
	if (!userId) return res.status(400).send(page("Invalid link", "<h2>This link isn't valid</h2>"));
	try {
		await pool.query(
			`INSERT INTO notification_preferences (user_id, email_enabled) VALUES ($1, false)
			 ON CONFLICT (user_id) DO UPDATE SET email_enabled = false, updated_at = NOW()`,
			[userId]
		);
		await pool.query(
			"UPDATE scheduled_notifications SET status = 'skipped', skip_reason = 'opted_out' WHERE user_id = $1 AND channel = 'email' AND status = 'pending'",
			[userId]
		);
		await recordConsent(userId, "trip_reminders_email", false);
		return res.send(page("Unsubscribed", "<h2>You're unsubscribed</h2><p>We won't email you trip reminders any more. Your bookings are unaffected and still appear in the Drift app.</p>"));
	} catch (err) {
		console.error("Unsubscribe failed:", err);
		return res.status(500).send(page("Something went wrong", "<h2>Something went wrong</h2><p>Please try again, or manage reminders in the Drift app.</p>"));
	}
});

// ---- the traveller's own notifications -----------------------------------------------

notificationsRouter.get("/", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const { rows } = await pool.query(
			"SELECT id, type, title, body, link, read_at, created_at FROM in_app_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30",
			[req.user!.id]
		);
		return res.json({ notifications: rows, unread: rows.filter((r) => !r.read_at).length });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

notificationsRouter.post("/read-all", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		await pool.query("UPDATE in_app_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL", [req.user!.id]);
		return res.json({ ok: true });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

notificationsRouter.post("/:id/read", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		if (!UUID.test(req.params.id)) return res.status(404).json({ message: "Not found" });
		await pool.query("UPDATE in_app_notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL", [req.params.id, req.user!.id]);
		return res.json({ ok: true });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// ---- preferences ---------------------------------------------------------------------------

notificationsRouter.get("/preferences", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const { rows } = await pool.query("SELECT email_enabled, in_app_enabled FROM notification_preferences WHERE user_id = $1", [req.user!.id]);
		const p = rows[0] ?? { email_enabled: true, in_app_enabled: true };
		return res.json({ emailEnabled: p.email_enabled, inAppEnabled: p.in_app_enabled });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

const prefsSchema = z.object({ emailEnabled: z.boolean().optional(), inAppEnabled: z.boolean().optional() });

notificationsRouter.put("/preferences", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = prefsSchema.parse(req.body);
		const userId = req.user!.id;
		await pool.query(
			`INSERT INTO notification_preferences (user_id, email_enabled, in_app_enabled)
			 VALUES ($1, COALESCE($2, true), COALESCE($3, true))
			 ON CONFLICT (user_id) DO UPDATE SET
			   email_enabled = COALESCE($2, notification_preferences.email_enabled),
			   in_app_enabled = COALESCE($3, notification_preferences.in_app_enabled),
			   updated_at = NOW()`,
			[userId, body.emailEnabled ?? null, body.inAppEnabled ?? null]
		);
		if (body.emailEnabled !== undefined) await recordConsent(userId, "trip_reminders_email", body.emailEnabled);
		const { rows } = await pool.query("SELECT email_enabled, in_app_enabled FROM notification_preferences WHERE user_id = $1", [userId]);
		return res.json({ emailEnabled: rows[0].email_enabled, inAppEnabled: rows[0].in_app_enabled });
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// What is scheduled for this traveller, so a trip can show "you'll get a
// reminder on ...". Email rows only: every reminder also has an in-app twin
// at the same time.
notificationsRouter.get("/schedule", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const { rows } = await pool.query(
			`SELECT n.type, n.send_at, n.status, n.skip_reason, s.source, s.order_id, s.leg_index, s.origin_iata, s.dest_iata, s.kind
			 FROM scheduled_notifications n JOIN trip_segments s ON s.id = n.segment_id
			 WHERE n.user_id = $1 AND n.channel = 'email' AND s.status = 'active'
			 ORDER BY n.send_at`,
			[req.user!.id]
		);
		return res.json({
			items: rows.map((r) => ({
				type: r.type, sendAt: r.send_at, status: r.status, skipReason: r.skip_reason,
				source: r.source, orderId: r.order_id, legIndex: r.leg_index, from: r.origin_iata, to: r.dest_iata, kind: r.kind,
			})),
		});
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// ---- admin tools -------------------------------------------------------------------------------

const TYPES = ["confirmation", "ticketed", "pre_7d", "pre_72h", "pre_24h", "pre_3h", "hotel_checkin"] as const;
const testSendSchema = z.object({ segmentId: z.string().regex(UUID), type: z.enum(TYPES), dryRun: z.boolean().optional() });

// Render one message for a real booking and send it NOW to the admin's own
// account email (never to the traveller), so every template can be seen without
// waiting for its moment. dryRun uses SendGrid's sandbox mode: the request is
// validated by SendGrid but nothing is delivered.
notificationsRouter.post("/admin/test-send", authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = testSendSchema.parse(req.body);
		const input = await buildRenderInput(body.segmentId, body.type as MessageType, req.user!.id, new Date());
		if (!input) return res.status(404).json({ message: "Segment not found" });
		const message = renderMessage(input);
		const ok = await sendEmail(req.user!.email, `[TEST SEND] ${message.subject}`, message.text, {
			html: message.html,
			headers: { "List-Unsubscribe": `<${unsubscribeUrl(req.user!.id)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
			dryRun: body.dryRun ?? false,
		});
		return res.json({ ok, sentTo: req.user!.email, dryRun: body.dryRun ?? false, subject: message.subject });
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// Create legs and schedule reminders for bookings made before this existed.
notificationsRouter.post("/admin/backfill", authenticate, requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
	try {
		return res.json(await backfillAll());
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// Run the sender once right now (normally it runs every 30 seconds).
notificationsRouter.post("/admin/process", authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(req.body ?? {});
		return res.json(await processDue(new Date(), { dryRun: dryRun ?? true }));
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});
