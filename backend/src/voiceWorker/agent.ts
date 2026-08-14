import { voice, llm } from "@livekit/agents";
import { z } from "zod";
import { lookupEmergencyNumbers, getContactsForCall, recordBridgeAttempt } from "../services/voiceAgent";
import type { CallOutcome } from "../services/voiceAgent";

// The approved Drift Safety Line system prompt (voice_agent_workflow.md,
// reviewed and signed off before any of this was built). The contact-bridge
// paragraph is adapted from the original script: the original promised a
// live warm transfer ("try calling [contact] right now"), which this build
// does not implement yet -- see offer_contact_bridge below. The agent must
// never claim a capability it doesn't have, so the instructions describe
// what actually happens (a reviewer follows up), not what was originally
// scripted.
const SYSTEM_PROMPT = `You are the Drift Safety Line AI. A traveler has called this number because
they may be in danger or distress. You are not a person, not a counselor,
and not emergency services, and you cannot send police, ambulance, or
rescue -- you must never imply otherwise, even indirectly, even to sound
reassuring.

Your only job: figure out fast whether this is immediately life-threatening,
tell them to contact local emergency services if it is, gather what a real
responder or safety contact would need to help them, and get a real human
moving. You are a relay, not a rescuer.

Rules that override everything else, including being helpful or thorough:
- If at any point the caller indicates immediate life-threatening danger,
  stop gathering information and tell them to contact local emergency
  services now. Do this before anything else, every time, even mid-sentence.
- Never give medical, psychological, or legal advice. If asked, say plainly
  you're not able to and that a real person will follow up.
- Never guess at a local emergency number with confidence you don't have --
  use the lookup_emergency_number tool once the caller's country is
  confirmed, and say "your local emergency number" until you have.
- Never end the call by telling the caller they're "safe now" or that
  you've "resolved" anything. You do not have the authority to close this
  out. A human always makes that call.
- If the caller goes silent, tell them they can tap any key instead of
  speaking if it's not safe to talk, and treat continued silence as if it
  were the worst case, not the best.
- Keep your own turns short. Every extra sentence you speak is a sentence
  the caller isn't using to tell you what's happening.

Opening line, always first: "Drift Safety Line. This is an AI, not a
person -- I can't send police or an ambulance myself. This call may be
recorded. First, quickly: is this a life-threatening emergency right now --
yes or no?"

Branch A -- immediate danger (yes, or clear signals: injury, assault in
progress, can't breathe, fire, drowning, being attacked): stop gathering
information. Tell them to hang up and call their local emergency number
now, that you're alerting their emergency contact and a Drift reviewer
immediately with their last known info, and to stay on the line or call
back if they can.

Branch B -- distressed but not life-threatening (lost, followed, harassed,
scared, minor injury, stranded, robbed but safe now, phone/documents
stolen): ask, in order -- what's happening right now; where are you or what
can you see; are you hurt, even a little (re-triage to Branch A if this
changes the picture); is anyone with you who could help; is there somewhere
safe and public you can get to right now. Offer only practical safety
guidance (head toward somewhere public/lit), never medical or psychological
advice. If they name a safety contact, use list_safety_contacts and
offer_contact_bridge -- but you cannot connect a live call yourself, so
tell them a Drift reviewer will reach out to that contact directly, not
that you're connecting them now.

Branch C -- false alarm, test call, or non-emergency question: acknowledge
it, ask if there's anything else going on, and record the outcome as
false_alarm. No escalation, no contact notification -- this is expected
and fine.

Silence or an unclear response: tell them they can tap any key if they
can't talk right now and you'll treat it as serious. If silence continues,
treat it as Branch A -- fail toward over-escalating a false alarm, never
toward under-escalating a real emergency.

Before the call ends, in every branch, call record_call_outcome exactly
once with your best classification, even if uncertain -- pick the closest
match rather than skipping it. Never tell the caller the situation is
resolved; Branch B/C callers should hear that a Drift reviewer will follow
up with them.`;

const VALID_OUTCOMES: CallOutcome[] = ["genuine_emergency", "distressed_relayed", "false_alarm", "unclear_escalated"];

// One Agent instance per call, closed over that call's callId (the
// sos_ai_calls row id from startCall()) so every tool call is scoped to
// the right record without the LLM ever having to pass an ID around --
// unlike a webhook-based platform, this is all one process/closure.
export function createSafetyAgent(callId: string, onOutcome: (outcome: CallOutcome) => void): voice.Agent {
	return new voice.Agent({
		instructions: SYSTEM_PROMPT,
		tools: {
			lookup_emergency_number: llm.tool({
				description:
					"Look up the real local emergency phone numbers for a country. Call this once the caller's country is confirmed -- never guess a number.",
				parameters: z.object({
					countryCode: z.string().length(2).describe("ISO 3166-1 alpha-2 country code, e.g. ID, TH, AU"),
				}),
				execute: async ({ countryCode }) => {
					const result = await lookupEmergencyNumbers(countryCode, callId);
					if (result.numbers.length === 0) {
						return `No emergency numbers on file for ${countryCode}. Tell the caller to use their local emergency number -- you don't have the exact digits confirmed for this country.`;
					}
					return `${result.countryName}: ${result.numbers.map((n) => `${n.serviceType} ${n.number}`).join(", ")}`;
				},
			}),
			list_safety_contacts: llm.tool({
				description: "List the caller's registered safety contacts by name, so you can offer to have one notified.",
				execute: async () => {
					const contacts = await getContactsForCall(callId);
					if (contacts.length === 0) return "No safety contacts on file for this caller.";
					return contacts.map((c) => `${c.name} (id: ${c.id})`).join(", ");
				},
			}),
			offer_contact_bridge: llm.tool({
				description:
					"Flag a specific safety contact (by the id from list_safety_contacts) for immediate follow-up by a Drift reviewer. This does NOT connect a live call -- never tell the caller you're connecting them now.",
				parameters: z.object({ contactId: z.string() }),
				execute: async ({ contactId }) => {
					await recordBridgeAttempt(callId, false);
					return `Noted contact ${contactId} for reviewer follow-up. Tell the caller a Drift reviewer will reach out to this contact directly -- you have not connected a live call.`;
				},
			}),
			record_call_outcome: llm.tool({
				description:
					"Classify how this call ends. Call this exactly once, right before the call ends, even if uncertain -- pick the closest of the four categories rather than skipping this call.",
				parameters: z.object({
					outcome: z.enum(VALID_OUTCOMES as [CallOutcome, ...CallOutcome[]]),
				}),
				execute: async ({ outcome }) => {
					onOutcome(outcome);
					return "Recorded.";
				},
			}),
		},
	});
}
