# Stage Plan — Stage 7: Drift Safety Line (Inbound Voice Agent)

**Approved by Executive:** 2026-08-09 ("voice agent will respond to a distress call... we will have a detailed workflow and prompt, non-negotiable").

## Why this stage

Existing SOS system (`routes/safety.ts`) is button-triggered only — a traveler in distress with only a phone (no working app) has no way to reach help. The non-negotiable requirement: the AI must never claim it can dispatch police/ambulance/rescue, and must never resolve/close a case — only a human can. This rule is enforced in code (`endCall()` can only move an `sos_events` row toward `escalated_at`, never `resolved_at`/`false_alarm_at`), not just the system prompt.

## Platform decision: LiveKit Agents, not a hosted platform

Initially built against a generic webhook contract (Retell-shaped). Pivoted after the user set up a LiveKit account: LiveKit Agents runs as code Drift owns (Node/TypeScript worker in `backend/src/voiceWorker/`), calling `services/voiceAgent.ts` directly, in-process — no webhook hop, no HMAC signature verification, no cross-system correlation-ID guessing. Stack: Claude (native Anthropic plugin) for reasoning, ElevenLabs (`eleven_flash_v2_5`, voice "Sarah") for TTS, LiveKit's own hosted inference for STT/turn-detection. Real number purchased through LiveKit's own Phone Numbers product; SIP trunk + dispatch rule wired via `backend/scripts/setupSip.ts` (idempotent, re-runnable if the number changes).

## Work packages

| WP | Description |
|---|---|
| WP7.1 | `sos_ai_calls` table (030) + `sos_events.user_id` made nullable (031) — an unregistered/borrowed phone calling in is a real scenario, not an edge case. |
| WP7.2 | `voiceAgent.ts` service: caller ID by phone match, emergency-number lookup (fixed a pre-existing bug in the process — `emergency_numbers` table was referenced by an existing route but its migration, 007, had never been applied), `startCall`/`endCall` fail-closed escalation logic. |
| WP7.3 | LiveKit worker (`voiceWorker/`): reads `sip.phoneNumber`/`sip.callID` directly off the SIP participant (deterministic, not a tool call the LLM might skip); four tools (emergency lookup, list contacts, flag contact for reviewer follow-up, record outcome) bound to the call via closure. |
| WP7.4 | Deployment debugging (all found and fixed by actually deploying, not assumed): `cli.runApp()` needs an explicit `start` argv (a full Commander CLI, not an immediate run); `@livekit/local-inference`'s native binary SIGILLs on this VPS's CPU (a QEMU model with no AVX2) — removed, the framework degrades gracefully since local VAD isn't used anyway; `node:24-slim` strips the CA bundle, breaking the Rust TLS client on the first real call; `Dockerfile.voiceWorker` needed its own Node 24 image (voice-worker) separate from the existing Node 20 backend image, to avoid destabilizing the working service. |
| WP7.5 | Live-call tuning, each found via real test calls with metrics instrumentation: endpointing `minDelay` 500ms→900ms (STT/turn-detector kept committing a turn before transcription finished); `preemptiveGeneration` disabled (this agent's 4 tools invalidated nearly every preemptive attempt); `interruption.mode: 'adaptive'` (default `minWords: 0` meant a single backchannel word cancelled an in-flight reply, forever, in a loop) — deliberately not raising `minWords`, which would risk a genuinely urgent one-word interruption failing to interrupt. |
| WP7.6 | Root latency fix: Claude silently engages extended thinking whenever tools are attached, even unrequested (measured 4.24s vs 1.57s identical call, thinking disabled — a ~63% cut). Not exposed by `@livekit/agents-plugin-anthropic`'s options, so patched via `scripts/patchAnthropicPlugin.js` (run on every `npm install` via `postinstall` — durable, not a one-off `node_modules` edit; fails loudly, not silently, if a future plugin version changes shape underneath it). |
| WP7.7 | System prompt restructured under an explicit `# Guardrails` heading (per ElevenLabs' own guardrails research — models are tuned to attend to that heading specifically, a prompting technique, not a platform feature) plus an explicit jailbreak-resistance line. |

## Known, deliberate gap

`offer_contact_bridge` does not perform a live SIP transfer — it flags the contact for a human reviewer to follow up with, and both the tool and the system prompt were worded so the agent never claims a connection it hasn't made. Real transfer is a real LiveKit capability, just not built this pass. **User asked to be reminded to revisit this** — flagged, not started.

## Quality gate
- [x] `sos_ai_calls`/`sos_events` schema applied and verified
- [x] Worker registers with LiveKit Cloud, stable (0 restarts) over live observation
- [x] Real inbound call verified end-to-end through the actual phone number: agent speaks, STT transcribes, tools fire, outcome recorded, reviewer paged
- [x] `decideEscalation()` fail-closed logic unit-tested (unrecognized/null outcome still escalates)
- [ ] `SAFETY_REVIEWER_EMAIL`/`SAFETY_REVIEWER_PHONE` set — currently unset, so escalation logs but pages no one
- [ ] Live SIP contact-transfer (see gap above)
- [ ] Latency: subjectively "better... but still needs work" as of the last real test call after WP7.6 — no further live measurement taken since
