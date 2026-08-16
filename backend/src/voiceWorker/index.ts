import { defineAgent, cli, WorkerOptions, voice, inference, type JobContext } from "@livekit/agents";
import { ParticipantKind } from "@livekit/rtc-node";
import { LLM as AnthropicLLM } from "@livekit/agents-plugin-anthropic";
import { TTS as ElevenLabsTTS } from "@livekit/agents-plugin-elevenlabs";
import { startCall, endCall } from "../services/voiceAgent";
import type { CallOutcome } from "../services/voiceAgent";
import { createSafetyAgent } from "./agent";

const DEFAULT_ELEVENLABS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // ElevenLabs "Sarah" -- Mature, Reassuring, Confident. Verified against the real account (the old default, Rachel, was from ElevenLabs' deprecated premade-voice library and 404'd on this account).

function flattenHistory(history: { items: unknown[] } | undefined): string | null {
	if (!history || !Array.isArray(history.items) || history.items.length === 0) return null;
	return history.items
		.map((item: any) => {
			const text = Array.isArray(item?.content)
				? item.content.map((c: any) => (typeof c === "string" ? c : (c?.text ?? ""))).join(" ")
				: (item?.content ?? "");
			return `${item?.role ?? "unknown"}: ${text}`;
		})
		.filter((line) => line.trim().length > 0)
		.join("\n");
}

// The Drift Safety Line voice agent worker. Unlike the ElevenLabs/Retell
// webhook approach this replaces, there is no HTTP hop at all: this
// process IS the agent, running in the same repo as the rest of the
// backend, calling voiceAgent.ts's already-tested functions directly.
// sos_events/sos_ai_calls open the moment a real SIP caller joins (not on
// a tool call the LLM might skip), and endCall() always runs in the
// `finally` block below -- however the call ends (hangup, error, agent
// crash) it still gets recorded, and per endCall()'s own design, a
// missing/null outcome still escalates rather than silently closing out.
export default defineAgent({
	entry: async (ctx: JobContext) => {
		await ctx.connect();

		const participant = await ctx.waitForParticipant();
		if (participant.kind !== ParticipantKind.SIP) {
			console.error("drift-safety-line: non-SIP participant joined, ignoring", participant.identity);
			return;
		}

		const callerPhone = participant.attributes["sip.phoneNumber"];
		const platformCallId = participant.attributes["sip.callID"];
		if (!callerPhone || !platformCallId) {
			console.error("drift-safety-line: SIP participant missing phone/callID attributes", participant.attributes);
			return;
		}

		const { callId } = await startCall({ callerPhone, platform: "livekit", platformCallId });

		let outcome: CallOutcome | null = null;
		const session = new voice.AgentSession({
			stt: new inference.STT({ model: "deepgram/nova-3" }),
			llm: new AnthropicLLM({
				model: process.env.VOICE_AGENT_LLM_MODEL || "claude-sonnet-5",
				apiKey: process.env.ANTHROPIC_API_KEY,
			}),
			tts: new ElevenLabsTTS({
				apiKey: process.env.ELEVENLABS_API_KEY,
				voiceId: process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID,
			}),
			// Verified live against a real call: the default 500ms endpointing
			// minDelay was too tight for this pipeline (cloud STT + cloud turn
			// detector, no local VAD assist -- see the Dockerfile's note on why
			// @livekit/local-inference is removed). The framework's own log
			// line named the problem exactly: "transcript arrives after turn
			// has been committed" -- it kept declaring the caller's turn over
			// before STT had actually finished transcribing, generating a
			// reply, getting invalidated when the real transcript landed, and
			// restarting -- audible as a stutter of half-words cut short.
			// preemptiveGeneration made this worse, not better: this agent's
			// four tools change tool choice/context turn to turn, which
			// invalidated nearly every preemptive attempt in the test call's
			// logs. For a distress line, a reliably complete reply a few
			// hundred ms later beats a faster one that stutters and restarts.
			turnHandling: {
				turnDetection: new inference.TurnDetector(),
				endpointing: { minDelay: 900, maxDelay: 4000 },
				preemptiveGeneration: { enabled: false },
			},
		});

		try {
			await session.start({ agent: createSafetyAgent(callId, (o) => (outcome = o)), room: ctx.room });
			await session.generateReply();

			await new Promise<void>((resolve) => {
				ctx.room.on("disconnected", () => resolve());
			});
		} finally {
			await session.close().catch((err) => console.error("drift-safety-line session.close error:", err));
			const transcript = flattenHistory(session.history as any);
			await endCall({ callId, outcome, transcript }).catch((err) =>
				console.error("drift-safety-line endCall failed for", callId, ":", err),
			);
		}
	},
});

// Fail idle, not crash-looping: docker-compose restarts this service
// unless-stopped, and cli.runApp throws synchronously without LiveKit
// credentials. Until LIVEKIT_URL/API_KEY/API_SECRET are configured (the
// user's own LiveKit account setup, not something buildable ahead of
// time), log once and hold the process open instead of burning restarts.
if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
	console.log("drift-safety-line: LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET not configured -- worker idling, not registering.");
	setInterval(() => {}, 1 << 30);
} else {
	cli.runApp(
		new WorkerOptions({
			agent: __filename,
			agentName: "drift-safety-line",
			wsURL: process.env.LIVEKIT_URL,
			apiKey: process.env.LIVEKIT_API_KEY,
			apiSecret: process.env.LIVEKIT_API_SECRET,
		}),
	);
}
