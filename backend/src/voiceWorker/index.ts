import { defineAgent, cli, WorkerOptions, voice, inference, AgentSessionEventTypes, type JobContext } from "@livekit/agents";
import { ParticipantKind } from "@livekit/rtc-node";
import { LLM as AnthropicLLM } from "@livekit/agents-plugin-anthropic";
import { TTS as ElevenLabsTTS } from "@livekit/agents-plugin-elevenlabs";
import { startCall, endCall, getCallerLastLocation } from "../services/voiceAgent";
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

		const { callId, caller } = await startCall({ callerPhone, platform: "livekit", platformCallId });

		// Best-effort: only present if the caller resolved to a registered
		// user AND that user has a recent Trip Mode ping cached in Redis. A
		// miss here just means the agent falls back to asking, exactly as
		// before this existed -- never blocks call start.
		const knownLocation = caller.userId ? await getCallerLastLocation(caller.userId).catch(() => null) : null;

		let outcome: CallOutcome | null = null;
		const session = new voice.AgentSession({
			stt: new inference.STT({ model: "deepgram/nova-3" }),
			llm: new AnthropicLLM({
				model: process.env.VOICE_AGENT_LLM_MODEL || "claude-sonnet-5",
				apiKey: process.env.ANTHROPIC_API_KEY,
				// The system prompt explicitly wants short turns ("every extra
				// sentence is a sentence the caller isn't using to tell you what's
				// happening") -- capping generation length bounds worst-case
				// latency for the same reason, not just output style.
				maxTokens: 300,
				// Root cause of most of the remaining latency, found by testing
				// this agent's exact tool schemas directly against the Anthropic
				// API: attaching tool definitions makes Claude Sonnet 5 silently
				// engage extended thinking, even though nothing requests it --
				// measured 4.24s vs 1.57s for an identical call with thinking
				// explicitly disabled, a ~63% cut. The plugin's LLMOptions type
				// doesn't expose `thinking` (it only forwards `temperature` this
				// way), so this field only reaches the API because
				// scripts/patchAnthropicPlugin.js (run on every `npm install`
				// via postinstall) patches the plugin to forward it too -- the
				// `as any` below is because the official type doesn't know about
				// the field the patch adds.
				thinking: { type: "disabled" },
			} as any),
			tts: new ElevenLabsTTS({
				apiKey: process.env.ELEVENLABS_API_KEY,
				voiceId: process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID,
				// eleven_flash_v2_5 is ElevenLabs' lowest-latency model,
				// specifically built for real-time conversational use --
				// trades a little naturalness for speed, worth it given how
				// severe the measured end-to-end latency has been.
				model: "eleven_flash_v2_5",
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
			// Verified live against a second real call: the caller answered
			// "Yes" to the opening question and heard nothing back. The
			// transcript showed why -- while the agent's reply was still being
			// generated/spoken, the caller kept talking ("Yes.", "Surplus.",
			// "Too slow.", "No."), and interruption.minWords defaults to 0 --
			// meaning any utterance at all, even a single short word, counts
			// as a genuine interruption and cancels the in-flight response.
			// Each cancellation restarted generation, which the next short
			// utterance cancelled again, forever -- the agent never got a
			// single word out. mode: 'adaptive' uses ML-based detection to
			// tell a real interruption from a brief backchannel-style
			// utterance and let the latter pass without cancelling the
			// agent's turn -- deliberately NOT raising minWords instead,
			// which would risk the opposite failure: a caller's genuinely
			// urgent one-word interruption ("Help!") failing to interrupt.
			turnHandling: {
				turnDetection: new inference.TurnDetector(),
				endpointing: { minDelay: 900, maxDelay: 4000 },
				preemptiveGeneration: { enabled: false },
				interruption: { mode: "adaptive" },
			},
		});

		// Temporary diagnostic instrumentation -- the pipeline's end-to-end
		// latency has been measured at 11-28s per turn in real calls, but a
		// direct Anthropic API call with the real system prompt takes ~2.6s,
		// which rules out prompt length/LLM reasoning time as the dominant
		// cause. This logs the framework's own per-stage metrics (STT
		// duration, LLM time-to-first-token, TTS time-to-first-byte) so the
		// next real call shows exactly which stage the other 10-25s is
		// actually going, instead of guessing further.
		session.on(AgentSessionEventTypes.MetricsCollected, (ev) => {
			console.log("LATENCY_METRIC", JSON.stringify(ev.metrics));
		});

		try {
			await session.start({ agent: createSafetyAgent(callId, (o) => (outcome = o), knownLocation), room: ctx.room });
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
