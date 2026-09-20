import { pool } from "../utils/db";
import { sendEmail } from "./notifications";
import { presentRequirement, type PresentedRequirement } from "./tripSchedule";
import { renderMessage, type SegmentRow, type MessageType, type RenderInput } from "./tripContent";
import { signUnsubscribeToken } from "./notificationTokens";

// Sends due trip notifications. Polls the scheduled_notifications table every
// 30 seconds. A row is claimed with FOR UPDATE SKIP LOCKED, so two workers (or
// a restart mid-send) can never send the same reminder twice; rows stuck in
// "sending" (the process died) are put back after 5 minutes.
//
// Every row ends in exactly one state, with a reason when it is not "sent":
//   skipped:expired          its window closed before we got to it (never sent late)
//   skipped:segment_cancelled the trip was cancelled
//   skipped:opted_out         the traveller turned this channel off
//   skipped:suppressed_recipient  a test or reserved address
//   skipped:email_not_configured  no email provider set up
//   failed                    four attempts (now, +1, +5, +15 minutes) all failed

const POLL_MS = 30_000;
const BATCH = 20;
const RETRY_MINUTES = [1, 5, 15];
const MAX_ATTEMPTS = 4;
const STUCK_AFTER_MINUTES = 5;

// Addresses that must never be emailed: reserved test domains and the
// sandbox test contact. A bounce on a made-up address damages the sender
// reputation that real travellers' emails depend on.
export function isSuppressedRecipient(email: string): boolean {
	const e = email.trim();
	// drifttest.com is the domain of the seeded test accounts used by the automated API tests.
	return /@(example\.(com|org|net)|drifttest\.com|[^@]*\.invalid|invalid)$/i.test(e) || /^sandbox-test@/i.test(e);
}

function appUrl(): string {
	return (process.env.APP_URL || "https://drifttravel.app").replace(/\/+$/, "");
}

function supportEmail(): string {
	return process.env.TRIP_SUPPORT_EMAIL || process.env.SENDGRID_FROM_EMAIL || "safety@drifttravel.app";
}

export function unsubscribeUrl(userId: string): string {
	return `${appUrl()}/api/v1/notifications/unsubscribe?token=${signUnsubscribeToken(userId)}`;
}

// Everything a message needs, loaded fresh at send time so it reflects the
// booking as it is now (not as it was when the reminder was scheduled).
export async function buildRenderInput(segmentId: string, type: MessageType, userId: string, now: Date): Promise<RenderInput | null> {
	const { rows: segs } = await pool.query("SELECT * FROM trip_segments WHERE id = $1", [segmentId]);
	const segment = segs[0];
	if (!segment) return null;
	const { rows: legs } = await pool.query(
		"SELECT * FROM trip_segments WHERE source = $1 AND order_id = $2 AND status = 'active' ORDER BY leg_index",
		[segment.source, segment.order_id]
	);
	const { rows: reqRows } = await pool.query(
		`SELECT rule_key, title, body, source_url, verified_at FROM travel_requirements
		 WHERE active AND country_code = $1 AND (airport_iata IS NULL OR airport_iata = $2) AND $3 = ANY(remind_at)
		 ORDER BY sort_order`,
		[segment.dest_country ?? "", segment.dest_iata ?? "", type]
	);
	const requirements: PresentedRequirement[] = reqRows.map((r) => presentRequirement(r, now));
	return {
		type,
		segment: segment as SegmentRow,
		legs: legs as SegmentRow[],
		orderStatus: segment.order_status ?? "held",
		supplierReference: segment.supplier_reference ?? null,
		requirements,
		manageUrl: `${appUrl()}/`,
		unsubscribeUrl: unsubscribeUrl(userId),
		supportEmail: supportEmail(),
	};
}

async function getPreferences(userId: string): Promise<{ email_enabled: boolean; in_app_enabled: boolean }> {
	const { rows } = await pool.query("SELECT email_enabled, in_app_enabled FROM notification_preferences WHERE user_id = $1", [userId]);
	return rows[0] ?? { email_enabled: true, in_app_enabled: true };
}

async function finish(id: string, status: "sent" | "skipped" | "failed", detail?: { reason?: string; error?: string }): Promise<void> {
	await pool.query(
		`UPDATE scheduled_notifications SET status = $2, skip_reason = $3, last_error = $4, locked_at = NULL, sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END WHERE id = $1`,
		[id, status, detail?.reason ?? null, detail?.error ?? null]
	);
}

async function retryOrFail(row: any, error: string, now: Date): Promise<"retried" | "failed"> {
	if (row.attempts >= MAX_ATTEMPTS) {
		await finish(row.id, "failed", { error });
		return "failed";
	}
	const wait = RETRY_MINUTES[Math.min(row.attempts - 1, RETRY_MINUTES.length - 1)];
	await pool.query(
		"UPDATE scheduled_notifications SET status = 'pending', send_at = $2, last_error = $3, locked_at = NULL WHERE id = $1",
		[row.id, new Date(now.getTime() + wait * 60 * 1000), error.slice(0, 300)]
	);
	return "retried";
}

type Outcome = "sent" | "skipped" | "failed" | "retried";

async function orderStillActive(source: string, orderId: string, now: Date): Promise<boolean> {
	if (source === "tripgic") {
		const { rows } = await pool.query("SELECT status, hold_expires_at FROM tripgic_orders WHERE id = $1", [orderId]);
		const o = rows[0];
		if (!o || ["cancelled", "expired", "failed"].includes(o.status)) return false;
		return !(o.status === "held" && o.hold_expires_at && new Date(o.hold_expires_at).getTime() < now.getTime());
	}
	const { rows } = await pool.query("SELECT status FROM flight_orders WHERE id = $1", [orderId]);
	return !!rows[0] && !["cancelled", "refunded"].includes(rows[0].status);
}

async function deliver(row: any, now: Date, dryRun: boolean): Promise<Outcome> {
	if (new Date(row.expires_at).getTime() <= now.getTime()) {
		await finish(row.id, "skipped", { reason: "expired" });
		return "skipped";
	}
	const { rows: segs } = await pool.query("SELECT status, source, order_id FROM trip_segments WHERE id = $1", [row.segment_id]);
	if (!segs[0] || segs[0].status !== "active") {
		await finish(row.id, "skipped", { reason: "segment_cancelled" });
		return "skipped";
	}
	// Belt and braces: the booking itself must still be alive right now. A held
	// reservation can lapse without anyone reading the order list, so check the
	// order, not just the copy of its status on the trip leg.
	if (row.type !== "confirmation" && row.type !== "ticketed" && !(await orderStillActive(segs[0].source, segs[0].order_id, now))) {
		await finish(row.id, "skipped", { reason: "order_not_active" });
		return "skipped";
	}
	const { rows: users } = await pool.query("SELECT email FROM users WHERE id = $1 AND is_active = true", [row.user_id]);
	if (!users[0]) {
		await finish(row.id, "skipped", { reason: "no_active_user" });
		return "skipped";
	}
	const prefs = await getPreferences(row.user_id);
	const enabled = row.channel === "email" ? prefs.email_enabled : prefs.in_app_enabled;
	if (!enabled) {
		await finish(row.id, "skipped", { reason: "opted_out" });
		return "skipped";
	}

	const input = await buildRenderInput(row.segment_id, row.type, row.user_id, now);
	if (!input) {
		await finish(row.id, "skipped", { reason: "segment_missing" });
		return "skipped";
	}
	const message = renderMessage(input);

	if (row.channel === "in_app") {
		await pool.query(
			`INSERT INTO in_app_notifications (user_id, segment_id, type, title, body, link, dedupe_key)
			 VALUES ($1,$2,$3,$4,$5,'bookings',$6) ON CONFLICT (dedupe_key) DO NOTHING`,
			[row.user_id, row.segment_id, row.type, message.inApp.title, message.inApp.body, row.dedupe_key]
		);
		await finish(row.id, "sent");
		return "sent";
	}

	const to: string = users[0].email;
	if (isSuppressedRecipient(to)) {
		await finish(row.id, "skipped", { reason: "suppressed_recipient" });
		return "skipped";
	}
	if (!process.env.SENDGRID_API_KEY) {
		await finish(row.id, "skipped", { reason: "email_not_configured" });
		return "skipped";
	}
	const url = unsubscribeUrl(row.user_id);
	const ok = await sendEmail(to, message.subject, message.text, {
		html: message.html,
		headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
		dryRun,
	});
	if (ok) {
		await finish(row.id, "sent");
		return "sent";
	}
	return retryOrFail(row, "email provider did not accept the message", now);
}

export async function recoverStuck(): Promise<number> {
	const { rowCount } = await pool.query(
		`UPDATE scheduled_notifications SET status = 'pending', locked_at = NULL
		 WHERE status = 'sending' AND locked_at < NOW() - ($1 || ' minutes')::interval`,
		[String(STUCK_AFTER_MINUTES)]
	);
	return rowCount ?? 0;
}

export async function processDue(now: Date = new Date(), options: { dryRun?: boolean; limit?: number } = {}): Promise<Record<Outcome, number>> {
	const totals: Record<Outcome, number> = { sent: 0, skipped: 0, failed: 0, retried: 0 };
	const { rows } = await pool.query(
		`UPDATE scheduled_notifications SET status = 'sending', locked_at = NOW(), attempts = attempts + 1
		 WHERE id IN (
		   SELECT id FROM scheduled_notifications WHERE status = 'pending' AND send_at <= $1
		   ORDER BY send_at LIMIT $2 FOR UPDATE SKIP LOCKED
		 ) RETURNING *`,
		[now, options.limit ?? BATCH]
	);
	for (const row of rows) {
		try {
			totals[await deliver(row, now, options.dryRun ?? false)]++;
		} catch (err) {
			console.error(`Trip notification ${row.id} (${row.type}/${row.channel}) errored:`, err);
			try {
				totals[await retryOrFail(row, String((err as Error)?.message ?? err), now)]++;
			} catch (inner) {
				console.error(`Could not record the failure of notification ${row.id}:`, inner);
			}
		}
	}
	return totals;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

// Off unless NOTIFICATIONS_WORKER=on, and never in tests.
export function startNotificationWorker(): void {
	if (process.env.NOTIFICATIONS_WORKER !== "on" || process.env.NODE_ENV === "test" || timer) return;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			await recoverStuck();
			const t = await processDue(new Date(), { dryRun: process.env.NOTIFICATIONS_DRY_RUN === "true" });
			if (t.sent || t.failed || t.retried) console.log("Trip notifications:", JSON.stringify(t));
		} catch (err) {
			console.error("Trip notification worker tick failed:", err);
		} finally {
			running = false;
		}
	};
	timer = setInterval(tick, POLL_MS);
	console.log(`Trip notification worker on (every ${POLL_MS / 1000}s${process.env.NOTIFICATIONS_DRY_RUN === "true" ? ", DRY RUN: nothing is delivered" : ""})`);
	void tick();
}
