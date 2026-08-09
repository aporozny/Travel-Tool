/**
 * Safety Line voice agent (inbound distress calls). decideEscalation and
 * endCall are the two places that enforce the one hard rule the whole
 * feature exists for: the AI can move a case toward "escalated," never
 * toward "resolved" -- and an outcome it doesn't recognize must escalate,
 * not silently do nothing. A false "don't escalate" here means a real
 * emergency call ends with nobody paged.
 */
import { decideEscalation, endCall } from "../src/services/voiceAgent";
import { pool } from "../src/utils/db";
import { sendSOSAlert, sendReviewerAlert } from "../src/services/notifications";
import { safetyEmitter } from "../src/routes/safety";

jest.mock("../src/utils/db", () => ({ pool: { query: jest.fn() } }));
jest.mock("../src/utils/redis", () => ({
	redis: { get: jest.fn(), setex: jest.fn() },
}));
jest.mock("../src/services/notifications", () => ({
	sendSOSAlert: jest.fn().mockResolvedValue(undefined),
	sendReviewerAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../src/routes/safety", () => ({ safetyEmitter: { emit: jest.fn() } }));

const mockedQuery = pool.query as jest.Mock;

function callRow(overrides: Partial<Record<string, any>> = {}) {
	return {
		sos_event_id: "sos-1",
		user_id: "user-1",
		caller_phone: "+61400000000",
		first_name: "Jamie",
		last_name: "Traveler",
		email: "jamie@example.com",
		...overrides,
	};
}

describe("decideEscalation", () => {
	it("false_alarm does not escalate", () => {
		expect(decideEscalation("false_alarm")).toBe(false);
	});

	it("genuine_emergency escalates", () => {
		expect(decideEscalation("genuine_emergency")).toBe(true);
	});

	it("distressed_relayed escalates", () => {
		expect(decideEscalation("distressed_relayed")).toBe(true);
	});

	it("unclear_escalated escalates", () => {
		expect(decideEscalation("unclear_escalated")).toBe(true);
	});

	it("null/undefined outcome escalates -- fail toward paging a human, not toward silence", () => {
		expect(decideEscalation(null)).toBe(true);
		expect(decideEscalation(undefined)).toBe(true);
	});

	it("an unrecognized outcome string still escalates -- new/typo'd values from the platform must not silently no-op", () => {
		expect(decideEscalation("some_new_value_nobody_wired_up")).toBe(true);
	});
});

describe("endCall", () => {
	beforeEach(() => {
		mockedQuery.mockReset();
		(sendSOSAlert as jest.Mock).mockClear();
		(sendReviewerAlert as jest.Mock).mockClear();
	});

	it("false_alarm: updates the call row but never touches sos_events, never pages anyone", async () => {
		mockedQuery
			.mockResolvedValueOnce({ rows: [callRow()] }) // SELECT call
			.mockResolvedValueOnce({ rows: [] }); // UPDATE sos_ai_calls (ended_at/outcome)

		const result = await endCall({ callId: "call-1", outcome: "false_alarm", transcript: "test call" });

		expect(result).toEqual({ sosEventId: "sos-1", escalated: false });
		expect(sendSOSAlert).not.toHaveBeenCalled();
		expect(sendReviewerAlert).not.toHaveBeenCalled();
		// Only the SELECT and the ended_at/outcome UPDATE -- no escalated_at
		// UPDATE, no human_notified_at UPDATE, no safety_contacts SELECT.
		expect(mockedQuery).toHaveBeenCalledTimes(2);
	});

	it("genuine_emergency: escalates sos_events, notifies safety contacts, pages the reviewer as urgent", async () => {
		mockedQuery
			.mockResolvedValueOnce({ rows: [callRow()] }) // SELECT call
			.mockResolvedValueOnce({ rows: [] }) // UPDATE sos_ai_calls outcome
			.mockResolvedValueOnce({ rows: [] }) // UPDATE sos_events escalated_at
			.mockResolvedValueOnce({ rows: [] }) // UPDATE sos_ai_calls human_notified_at
			.mockResolvedValueOnce({
				rows: [{ id: "contact-1", name: "Alex", email: "alex@example.com", phone: "+61400000001" }],
			}); // SELECT safety_contacts

		const result = await endCall({ callId: "call-1", outcome: "genuine_emergency", transcript: "help" });

		expect(result).toEqual({ sosEventId: "sos-1", escalated: true });
		expect(sendSOSAlert).toHaveBeenCalledTimes(1);
		expect(sendSOSAlert).toHaveBeenCalledWith(
			expect.objectContaining({ sosId: "sos-1", contacts: [expect.objectContaining({ id: "contact-1" })] }),
		);
		expect(sendReviewerAlert).toHaveBeenCalledTimes(1);
		expect(sendReviewerAlert).toHaveBeenCalledWith(expect.objectContaining({ urgent: true }));
		expect(safetyEmitter.emit).toHaveBeenCalledWith("sos:sos-1", expect.objectContaining({ type: "voice_call_escalated" }));
	});

	it("distressed_relayed: still escalates and pages the reviewer, but not flagged urgent", async () => {
		mockedQuery
			.mockResolvedValueOnce({ rows: [callRow()] })
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [] }); // no safety contacts on file

		const result = await endCall({ callId: "call-1", outcome: "distressed_relayed", transcript: "lost" });

		expect(result.escalated).toBe(true);
		expect(sendSOSAlert).not.toHaveBeenCalled(); // no contacts on file -- nothing to notify
		expect(sendReviewerAlert).toHaveBeenCalledWith(expect.objectContaining({ urgent: false }));
	});

	it("null outcome (platform never reported one): still escalates and pages the reviewer as urgent -- fail closed, not open", async () => {
		mockedQuery
			.mockResolvedValueOnce({ rows: [callRow({ user_id: null, first_name: null, last_name: null, email: null })] })
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [] });
		// No safety_contacts SELECT expected -- call.user_id is null.

		const result = await endCall({ callId: "call-1", outcome: null, transcript: null });

		expect(result.escalated).toBe(true);
		expect(sendSOSAlert).not.toHaveBeenCalled();
		expect(sendReviewerAlert).toHaveBeenCalledWith(
			expect.objectContaining({ urgent: true, body: expect.stringContaining("unregistered number") }),
		);
	});

	it("throws if the call row doesn't exist -- never silently no-ops on a bad callId", async () => {
		mockedQuery.mockResolvedValueOnce({ rows: [] });
		await expect(endCall({ callId: "missing", outcome: "genuine_emergency", transcript: null })).rejects.toThrow();
	});
});
