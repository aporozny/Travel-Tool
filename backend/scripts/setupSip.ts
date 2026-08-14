// One-off provisioning script -- not part of the running app, run manually
// whenever the Safety Line's phone number changes. Creates (or reuses) the
// SIP inbound trunk for the given number, then a dispatch rule that routes
// every call on that trunk to the drift-safety-line agent, one room per
// caller (so concurrent calls never collide).
//
// Usage: LIVEKIT_URL/API_KEY/API_SECRET already in the environment (same
// vars the voice-worker service uses), then:
//   npx ts-node scripts/setupSip.ts +15551234567
import { LiveKitAPI, SipDispatchRuleIndividual, CreateSipDispatchRuleOptions } from "livekit-server-sdk";
import { RoomConfiguration, RoomAgentDispatch } from "@livekit/protocol";

const AGENT_NAME = "drift-safety-line";

async function main() {
	const phoneNumber = process.argv[2];
	if (!phoneNumber) {
		console.error("Usage: ts-node scripts/setupSip.ts <phone-number-in-E164>");
		process.exit(1);
	}

	const api = new LiveKitAPI(); // reads LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET from env

	const existingTrunks = await api.sip.listSipInboundTrunk();
	let trunk = existingTrunks.find((t) => t.numbers.includes(phoneNumber));
	if (trunk) {
		console.log(`Reusing existing inbound trunk ${trunk.sipTrunkId} for ${phoneNumber}`);
	} else {
		trunk = await api.sip.createSipInboundTrunk(`drift-safety-line-${phoneNumber}`, [phoneNumber]);
		console.log(`Created inbound trunk ${trunk.sipTrunkId} for ${phoneNumber}`);
	}

	const existingRules = await api.sip.listSipDispatchRule();
	const alreadyWired = existingRules.find((r) => r.trunkIds.includes(trunk!.sipTrunkId));
	if (alreadyWired) {
		console.log(`Trunk already has a dispatch rule (${alreadyWired.sipDispatchRuleId}) -- nothing to do.`);
		return;
	}

	const rule: SipDispatchRuleIndividual = { type: "individual", roomPrefix: "safety-line-" };
	const options: CreateSipDispatchRuleOptions = {
		name: "Drift Safety Line inbound",
		trunkIds: [trunk.sipTrunkId],
		roomConfig: new RoomConfiguration({
			agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
		}),
	};

	const dispatchRule = await api.sip.createSipDispatchRule(rule, options);
	console.log(`Created dispatch rule ${dispatchRule.sipDispatchRuleId}: ${phoneNumber} -> agent "${AGENT_NAME}"`);
}

main().catch((err) => {
	console.error("SIP setup failed:", err);
	process.exit(1);
});
