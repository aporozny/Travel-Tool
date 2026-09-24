// One-off provisioning script -- not part of the running app. Creates (or reuses)
// the LiveKit SIP OUTBOUND trunk the Safety Line uses to ring a human reviewer
// live (see voiceWorker/agent.ts, which needs LIVEKIT_SIP_OUTBOUND_TRUNK). The
// inbound counterpart is scripts/setupSip.ts.
//
// The trunk points at the Twilio Elastic SIP trunk's termination URI and
// authenticates with that trunk's credential list. The password comes from the
// environment, never argv, so it stays out of shell history and process lists.
//
// Usage (LIVEKIT_URL/API_KEY/API_SECRET already in the environment):
//   SIP_TRUNK_PASSWORD=... npx ts-node scripts/setupSipOutbound.ts \
//     drift-safety-line.pstn.twilio.com +18205004980 drift-livekit
import { LiveKitAPI } from "livekit-server-sdk";
import { SIPTransport } from "@livekit/protocol";

async function main() {
	const [address, phoneNumber, username] = process.argv.slice(2);
	const password = process.env.SIP_TRUNK_PASSWORD;
	if (!address || !phoneNumber || !username || !password) {
		console.error("Usage: SIP_TRUNK_PASSWORD=... ts-node scripts/setupSipOutbound.ts <twilio-termination-uri> <caller-id-e164> <credential-username>");
		process.exit(1);
	}

	const api = new LiveKitAPI(); // reads LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET from env

	const existing = await api.sip.listSipOutboundTrunk();
	const match = existing.find((t) => t.address === address && t.numbers.includes(phoneNumber));
	if (match) {
		console.log(`Reusing existing outbound trunk ${match.sipTrunkId} for ${address} / ${phoneNumber}`);
		console.log(`LIVEKIT_SIP_OUTBOUND_TRUNK=${match.sipTrunkId}`);
		return;
	}

	const trunk = await api.sip.createSipOutboundTrunk("drift-safety-line-outbound", address, [phoneNumber], {
		transport: SIPTransport.SIP_TRANSPORT_AUTO,
		authUsername: username,
		authPassword: password,
	});
	console.log(`Created outbound trunk ${trunk.sipTrunkId} -> ${address}, caller ID ${phoneNumber}`);
	console.log(`LIVEKIT_SIP_OUTBOUND_TRUNK=${trunk.sipTrunkId}`);
}

main().catch((err) => {
	console.error("SIP outbound setup failed:", err);
	process.exit(1);
});
