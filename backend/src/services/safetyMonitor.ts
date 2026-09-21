import { pool } from "../utils/db";
import { sendEmail, sendSms, sendReviewerAlert } from "./notifications";
import { reviewerOverdueMessage, contactOverdueMessage, contactAllClearMessage, type OverdueContext } from "./safetyAlerts";

// Detects missed safety check-ins. Before this, nothing in the backend ever
// set a trip's status to 'overdue' or 'escalated', so a traveller who stopped
// checking in was never noticed, although the app tells them and their
// contacts that it would be.
//
// Every minute:
//   1. An active trip whose next check-in is more than the grace period late
//      becomes 'overdue'.
//   2. A newly overdue trip pages the Drift safety reviewer (email and, as it
//      is urgent, SMS) with what is known: who, where, how late, last check-in
//      and last shared location.
//   3. If it is still overdue after the escalation delay, the trip's emergency
//      contacts are messaged, ONLY when SAFETY_NOTIFY_CONTACTS=on. That switch
//      is off by default because it messages real people; with it off the
//      reviewer is told a second time that contacts were not messaged so a
//      person can decide. The trip becomes 'escalated' once contacts are sent.
//   4. A check-in (see routes/safety.ts) puts the trip back to 'active', and
//      contacts who were alerted are sent an all-clear.
//
// Seeded test accounts (@drifttest.com) go through the same state changes but
// nobody real is ever alerted about them.

const POLL_MS = 60_000;

const graceMinutes = () => Number(process.env.SAFETY_OVERDUE_GRACE_MINUTES) || 15;
const escalateAfterMinutes = () => Number(process.env.SAFETY_ESCALATE_AFTER_MINUTES) || 60;
export const contactsEnabled = () => process.env.SAFETY_NOTIFY_CONTACTS === "on";

export const isTestAccount = (email: string) => /@drifttest\.com$/i.test(email.trim());

async function loadContext(trip: any, now: Date, forContact: boolean): Promise<OverdueContext> {
	const { rows: who } = await pool.query(
		`SELECT u.email, COALESCE(NULLIF(t.display_name, ''), NULLIF(trim(concat_ws(' ', t.first_name, t.last_name)), ''), split_part(u.email, '@', 1)) AS name
		 FROM users u LEFT JOIN travelers t ON t.user_id = u.id WHERE u.id = $1`,
		[trip.user_id]
	);
	const { rows: loc } = forContact
		? { rows: [] as any[] }
		: await pool.query("SELECT lat, lng, created_at FROM location_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [trip.user_id]);
	return {
		travellerName: who[0]?.name ?? "A Drift traveller",
		destination: trip.destination,
		dueAt: new Date(trip.next_checkin_due),
		overdueMinutes: Math.max(0, Math.round((now.getTime() - new Date(trip.next_checkin_due).getTime()) / 60000)),
		lastCheckinAt: trip.last_checkin_at ? new Date(trip.last_checkin_at) : null,
		lastLocation: loc[0] ? { lat: loc[0].lat, lng: loc[0].lng, at: new Date(loc[0].created_at) } : null,
	};
}

async function contactsFor(trip: any): Promise<any[]> {
	const { rows } = await pool.query(
		`SELECT id, name, email, phone, can_see_location FROM safety_contacts
		 WHERE user_id = $1 AND notify_on_overdue = true AND (trip_id IS NULL OR trip_id = $2)`,
		[trip.user_id, trip.id]
	);
	return rows;
}

async function accountEmail(userId: string): Promise<string> {
	const { rows } = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
	return rows[0]?.email ?? "";
}

// Step 1
export async function markOverdueTrips(now: Date): Promise<any[]> {
	const { rows } = await pool.query(
		`UPDATE member_trips SET safety_status = 'overdue', overdue_since = COALESCE(overdue_since, $1), updated_at = NOW()
		 WHERE safety_status = 'active' AND next_checkin_due IS NOT NULL
		   AND next_checkin_due < $1::timestamptz - ($2 || ' minutes')::interval
		 RETURNING *`,
		[now, String(graceMinutes())]
	);
	return rows;
}

// Step 2: page the reviewer for every overdue trip not yet reported. A failure
// to page leaves overdue_alerted_at empty, so it is tried again next minute.
export async function alertReviewerForOverdue(now: Date): Promise<number> {
	const { rows } = await pool.query("SELECT * FROM member_trips WHERE safety_status = 'overdue' AND overdue_alerted_at IS NULL");
	let alerted = 0;
	for (const trip of rows) {
		try {
			const test = isTestAccount(await accountEmail(trip.user_id));
			if (!test) {
				const ctx = await loadContext(trip, now, false);
				const contacts = await contactsFor(trip);
				const msg = reviewerOverdueMessage(ctx, contacts.length, contactsEnabled());
				await sendReviewerAlert({ subject: msg.subject, body: msg.body, urgent: true });
			} else {
				console.log(`Safety monitor: test account trip ${trip.id} is overdue (nobody alerted)`);
			}
			await pool.query("UPDATE member_trips SET overdue_alerted_at = NOW() WHERE id = $1", [trip.id]);
			alerted++;
		} catch (err) {
			console.error(`Safety monitor: could not alert about overdue trip ${trip.id}, will retry:`, err);
		}
	}
	return alerted;
}

// Step 3
export async function escalateOverdueTrips(now: Date): Promise<{ escalated: number; flagged: number }> {
	const { rows } = await pool.query(
		`SELECT * FROM member_trips
		 WHERE safety_status = 'overdue' AND overdue_alerted_at IS NOT NULL AND escalated_at IS NULL
		   AND next_checkin_due < $1::timestamptz - ($2 || ' minutes')::interval`,
		[now, String(escalateAfterMinutes())]
	);
	let escalated = 0;
	let flagged = 0;
	for (const trip of rows) {
		try {
			const email = await accountEmail(trip.user_id);
			const test = isTestAccount(email);
			const contacts = await contactsFor(trip);

			if (!contactsEnabled() || test) {
				// Tell the reviewer, once, that contacts have not been messaged.
				if (!trip.escalation_flagged_at) {
					if (!test) {
						const ctx = await loadContext(trip, now, false);
						const msg = reviewerOverdueMessage(ctx, contacts.length, false);
						await sendReviewerAlert({ subject: `STILL OVERDUE: ${msg.subject}`, body: msg.body, urgent: true });
					}
					await pool.query("UPDATE member_trips SET escalation_flagged_at = NOW() WHERE id = $1", [trip.id]);
					flagged++;
				}
				continue;
			}

			const ctx = await loadContext(trip, now, true);
			for (const c of contacts) {
				const withLoc = c.can_see_location
					? { ...ctx, lastLocation: (await loadContext(trip, now, false)).lastLocation }
					: ctx;
				const m = contactOverdueMessage(withLoc);
				if (c.email) await sendEmail(c.email, m.subject, m.text);
				if (c.phone) await sendSms(c.phone, m.sms);
			}
			await pool.query("UPDATE safety_contacts SET notified_at = NOW() WHERE id = ANY($1::uuid[])", [contacts.map((c) => c.id)]);
			await pool.query("UPDATE member_trips SET safety_status = 'escalated', escalated_at = NOW() WHERE id = $1", [trip.id]);
			await sendReviewerAlert({ subject: `Drift safety: emergency contacts messaged (${ctx.travellerName})`, body: `${contacts.length} contact(s) were messaged about the missed check-in on the trip to ${ctx.destination}.`, urgent: false });
			escalated++;
		} catch (err) {
			console.error(`Safety monitor: escalation failed for trip ${trip.id}:`, err);
		}
	}
	return { escalated, flagged };
}

// Called from the check-in route when a trip that had escalated is checked in.
export async function sendAllClear(trip: { id: string; user_id: string; destination: string }): Promise<void> {
	if (!contactsEnabled() || isTestAccount(await accountEmail(trip.user_id))) return;
	const ctx = await loadContext({ ...trip, next_checkin_due: new Date() }, new Date(), true);
	const m = contactAllClearMessage(ctx.travellerName, trip.destination);
	const { rows } = await pool.query("SELECT email, phone FROM safety_contacts WHERE user_id = $1 AND notified_at IS NOT NULL AND notify_on_overdue = true AND (trip_id IS NULL OR trip_id = $2)", [trip.user_id, trip.id]);
	for (const c of rows) {
		if (c.email) await sendEmail(c.email, m.subject, m.text);
		if (c.phone) await sendSms(c.phone, m.sms);
	}
}

export async function runSafetyMonitor(now: Date = new Date()): Promise<{ overdue: number; alerted: number; escalated: number; flagged: number }> {
	const overdue = (await markOverdueTrips(now)).length;
	const alerted = await alertReviewerForOverdue(now);
	const { escalated, flagged } = await escalateOverdueTrips(now);
	return { overdue, alerted, escalated, flagged };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

// Off unless SAFETY_MONITOR=on, and never in tests.
export function startSafetyMonitor(): void {
	if (process.env.SAFETY_MONITOR !== "on" || process.env.NODE_ENV === "test" || timer) return;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			const r = await runSafetyMonitor();
			if (r.overdue || r.alerted || r.escalated || r.flagged) console.log("Safety monitor:", JSON.stringify(r));
		} catch (err) {
			console.error("Safety monitor tick failed:", err);
		} finally {
			running = false;
		}
	};
	timer = setInterval(tick, POLL_MS);
	console.log(`Safety monitor on (every ${POLL_MS / 1000}s, grace ${graceMinutes()} min, escalate after ${escalateAfterMinutes()} min, contacts ${contactsEnabled() ? "ON" : "off"})`);
	void tick();
}
