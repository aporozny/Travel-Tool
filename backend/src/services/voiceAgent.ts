import { pool } from "../utils/db";
import { sendSOSAlert, sendReviewerAlert } from "./notifications";
import { safetyEmitter } from "../routes/safety";

// Backend for the Drift Safety Line (inbound voice AI, see
// docs/pm/STAGE-PLAN-7.md for the approved workflow/script). Every call
// reaches a real human as fast as possible; nothing in this file is ever
// allowed to mark an sos_events row resolved or false_alarm -- see the
// same rule already enforced for button-triggered SOS in routes/safety.ts.
// A call can move a case toward "escalated" (needs review), never toward
// "closed."

export type CallOutcome =
	| "genuine_emergency"
	| "distressed_relayed"
	| "false_alarm"
	| "unclear_escalated";

export interface CallerIdentity {
	userId: string | null;
	travelerName: string | null;
	travelerEmail: string | null;
}

// Match an inbound caller's phone number to a registered traveler. No
// match is a real, expected outcome, not a failure -- calling from an
// unregistered or borrowed phone is exactly the scenario the workflow
// calls out for someone in distress (see 031_sos_events_nullable_caller.sql,
// which exists specifically so this case can still open a case).
export async function identifyCaller(callerPhone: string): Promise<CallerIdentity> {
	const { rows } = await pool.query(
		`SELECT u.id AS user_id, t.first_name, t.last_name, u.email
		 FROM travelers t JOIN users u ON u.id = t.user_id
		 WHERE t.phone = $1
		 LIMIT 1`,
		[callerPhone],
	);
	const row = rows[0];
	if (!row) return { userId: null, travelerName: null, travelerEmail: null };
	return {
		userId: row.user_id,
		travelerName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
		travelerEmail: row.email,
	};
}

export interface StartCallResult {
	callId: string;
	sosEventId: string;
	caller: CallerIdentity;
}

// Called once at the start of every inbound call. Idempotent against a
// webhook retry for the same platform_call_id -- reuses the existing
// sos_events/sos_ai_calls rows instead of opening a second case for one
// phone call, same "check existing, else insert" shape as
// syncOfferFromPlace in booking.ts.
export async function startCall(params: {
	callerPhone: string;
	platform: string;
	platformCallId: string;
}): Promise<StartCallResult> {
	const existing = await pool.query(
		`SELECT id, sos_event_id, user_id FROM sos_ai_calls WHERE platform = $1 AND platform_call_id = $2`,
		[params.platform, params.platformCallId],
	);
	if (existing.rows.length > 0) {
		const row = existing.rows[0];
		const caller = row.user_id ? await identifyCaller(params.callerPhone) : { userId: null, travelerName: null, travelerEmail: null };
		return { callId: row.id, sosEventId: row.sos_event_id, caller };
	}

	const caller = await identifyCaller(params.callerPhone);

	const sosResult = await pool.query(
		`INSERT INTO sos_events (id, user_id, trigger_type, contacts_notified)
		 VALUES (gen_random_uuid(), $1, 'voice_call', 0)
		 RETURNING id`,
		[caller.userId],
	);
	const sosEventId = sosResult.rows[0].id;

	const callResult = await pool.query(
		`INSERT INTO sos_ai_calls (sos_event_id, caller_phone, user_id, platform, platform_call_id)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		[sosEventId, params.callerPhone, caller.userId, params.platform, params.platformCallId],
	);

	safetyEmitter.emit(`sos:${sosEventId}`, {
		type: "voice_call_started",
		sosId: sosEventId,
		timestamp: new Date().toISOString(),
		data: { callId: callResult.rows[0].id },
	});

	return { callId: callResult.rows[0].id, sosEventId, caller };
}

export interface EmergencyNumberEntry {
	serviceType: string;
	number: string;
	description: string | null;
}

// Looked up only once the AI has confirmed the caller's country -- never
// guessed. Records what was actually given so it's auditable afterward,
// per the system prompt's own rule against confident-sounding guesses.
export async function lookupEmergencyNumbers(
	countryCode: string,
	callId: string,
): Promise<{ countryName: string | null; numbers: EmergencyNumberEntry[] }> {
	const { rows } = await pool.query(
		`SELECT country_name, service_type, number, description
		 FROM emergency_numbers WHERE UPPER(country_code) = UPPER($1) ORDER BY service_type`,
		[countryCode],
	);

	if (rows.length > 0) {
		const primary = rows.find((r: any) => r.service_type === "police") ?? rows[0];
		await pool.query(
			`UPDATE sos_ai_calls SET country_code_used = $1, emergency_number_given = $2 WHERE id = $3`,
			[countryCode.toUpperCase(), primary.number, callId],
		);
	}

	return {
		countryName: rows[0]?.country_name ?? null,
		numbers: rows.map((r: any) => ({ serviceType: r.service_type, number: r.number, description: r.description })),
	};
}

// The one function every escalation decision in this file depends on.
// The system must fail toward over-escalating a false alarm (costs a
// safety contact one unnecessary text) never toward under-escalating a
// real emergency (costs much more) -- so an outcome this function
// doesn't recognize (null, a typo from the platform, a new value nobody
// wired up yet) escalates by default. It does not silently do nothing.
export function decideEscalation(outcome: string | null | undefined): boolean {
	return outcome !== "false_alarm";
}

export interface ContactSummary {
	id: string;
	name: string;
	phone: string | null;
}

// Contacts the AI can offer to bridge in, scoped to the identified
// caller's own account -- an unidentified caller has none to offer,
// which is a correct outcome (human reviewer follow-up is the fallback,
// not a guess at whose contacts to notify).
export async function getContactsForCall(callId: string): Promise<ContactSummary[]> {
	const { rows } = await pool.query(
		`SELECT sc.id, sc.name, sc.phone
		 FROM sos_ai_calls sac
		 JOIN safety_contacts sc ON sc.user_id = sac.user_id
		 WHERE sac.id = $1 AND sc.receives_sos = true`,
		[callId],
	);
	return rows;
}

export async function recordBridgeAttempt(callId: string, connected: boolean): Promise<void> {
	await pool.query(
		`UPDATE sos_ai_calls SET contact_bridge_attempted = true, contact_bridge_connected = $1 WHERE id = $2`,
		[connected, callId],
	);
}

// Fired the instant a live warm-transfer attempt starts (see agent.ts's
// connect_to_reviewer tool), not just at endCall() -- the reviewer needs
// to know their phone is about to ring *before* it rings, not get an
// email after the call has already ended. Best-effort: the transfer
// attempt itself is the real signal; this is a redundant heads-up in
// case they don't immediately place an unknown incoming call as urgent.
export async function pageReviewerForLiveTransfer(callId: string): Promise<void> {
	const { rows } = await pool.query(
		`SELECT sac.caller_phone, t.first_name, t.last_name
		 FROM sos_ai_calls sac
		 LEFT JOIN users u ON u.id = sac.user_id
		 LEFT JOIN travelers t ON t.user_id = u.id
		 WHERE sac.id = $1`,
		[callId],
	);
	const call = rows[0];
	const travelerName = call ? [call.first_name, call.last_name].filter(Boolean).join(" ") || call.caller_phone : "Unknown caller";
	await sendReviewerAlert({
		subject: "Drift Safety Line: live transfer incoming",
		body: `A caller (${travelerName}) is being connected to you live right now via the Safety Line. Answer the incoming call immediately.`,
		urgent: true,
	});
}

export interface EndCallParams {
	callId: string;
	outcome: CallOutcome | null;
	transcript: string | null;
	rawPayload?: unknown;
}

export interface EndCallResult {
	sosEventId: string;
	escalated: boolean;
}

// Called once when the platform reports the call ended. This is the only
// place a call's outcome can move an sos_events row -- and it can only
// ever set escalated_at, never resolved_at/false_alarm_at. Those two stay
// exclusively human-controlled, same as the existing button-SOS flow in
// routes/safety.ts's /sos/:id/resolve.
export async function endCall(params: EndCallParams): Promise<EndCallResult> {
	const { rows } = await pool.query(
		`SELECT sac.sos_event_id, sac.user_id, sac.caller_phone,
		        t.first_name, t.last_name, u.email
		 FROM sos_ai_calls sac
		 LEFT JOIN users u ON u.id = sac.user_id
		 LEFT JOIN travelers t ON t.user_id = u.id
		 WHERE sac.id = $1`,
		[params.callId],
	);
	const call = rows[0];
	if (!call) throw new Error(`sos_ai_calls row not found: ${params.callId}`);

	await pool.query(
		`UPDATE sos_ai_calls SET ended_at = NOW(), ai_outcome = $1, transcript = $2, raw_webhook_payload = $3 WHERE id = $4`,
		[params.outcome, params.transcript, params.rawPayload ? JSON.stringify(params.rawPayload) : null, params.callId],
	);

	if (!decideEscalation(params.outcome)) {
		return { sosEventId: call.sos_event_id, escalated: false };
	}

	const travelerName = [call.first_name, call.last_name].filter(Boolean).join(" ") || call.caller_phone;

	await pool.query(
		`UPDATE sos_events SET escalated_at = NOW() WHERE id = $1 AND escalated_at IS NULL`,
		[call.sos_event_id],
	);
	await pool.query(`UPDATE sos_ai_calls SET human_notified_at = NOW() WHERE id = $1`, [params.callId]);

	// Notify the caller's own safety contacts through the same channel
	// (and the same sos_responders audit log) as a button-triggered SOS --
	// an AI-relayed call is not a lesser-grade alert.
	if (call.user_id) {
		const contactsResult = await pool.query(
			`SELECT id, name, email, phone FROM safety_contacts WHERE user_id = $1 AND receives_sos = true`,
			[call.user_id],
		);
		if (contactsResult.rows.length > 0) {
			sendSOSAlert({
				sosId: call.sos_event_id,
				travelerName,
				travelerEmail: call.email,
				latitude: null,
				longitude: null,
				message: `Drift Safety Line AI call. Outcome: ${params.outcome ?? "unclear"}.`,
				contacts: contactsResult.rows,
			}).catch((err) => console.error("Voice agent SOS notification failed:", err));
		}
	}

	sendReviewerAlert({
		subject: `Safety Line call needs review (${params.outcome ?? "unclear"})`,
		body: [
			`Caller: ${travelerName}${call.user_id ? "" : " (unregistered number)"}`,
			`Phone: ${call.caller_phone}`,
			`Outcome: ${params.outcome ?? "unclear — treat as urgent"}`,
			`sos_events: ${call.sos_event_id}`,
		].join("\n"),
		urgent: params.outcome === "genuine_emergency" || params.outcome === "unclear_escalated" || !params.outcome,
	}).catch((err) => console.error("Voice agent reviewer alert failed:", err));

	safetyEmitter.emit(`sos:${call.sos_event_id}`, {
		type: "voice_call_escalated",
		sosId: call.sos_event_id,
		timestamp: new Date().toISOString(),
		data: { outcome: params.outcome, callId: params.callId },
	});

	return { sosEventId: call.sos_event_id, escalated: true };
}
