// Patches @livekit/agents-plugin-anthropic's compiled output to forward
// behavior the plugin's exposed options don't cover. Two independent
// patches live here now:
//
// 1. `thinking` passthrough -- forwards an LLM constructor option into
//    the actual Anthropic API request. The plugin only forwards
//    `temperature` this way, nothing else.
//
//    Why this exists: attaching tool definitions (this app's voice agent
//    has four/five) makes Claude Sonnet 5 silently engage extended
//    thinking by default, even though nothing requests it. Measured
//    directly against the real Anthropic API with this agent's actual
//    tool schemas: 4.24s with thinking active vs 1.57s with
//    `thinking: {type: "disabled"}` -- a ~63% latency cut on every
//    single conversational turn.
//
// 2. Prompt caching (`cache_control: { type: "ephemeral" }`) on the
//    system prompt and on the tool definitions -- added 2026-09-15.
//
//    Why this exists: the plugin's `_buildAnthropicContext()` builds the
//    `system` array and the `chat()` method builds `anthropicTools`, but
//    neither ever sets `cache_control` anywhere -- confirmed by reading
//    the plugin's own compiled source. The plugin DOES already track
//    `cacheCreationTokens`/`cacheReadTokens` from the API response (dead
//    code paths until a request actually asks Anthropic to cache
//    something), which is exactly what a real LATENCY_METRIC log from a
//    live Drift Safety Line call showed: `promptCachedTokens: 0` and
//    `cacheCreationTokens: 0` on every single turn, despite ~3,000-3,600
//    prompt tokens per turn -- the entire system prompt + all 5 tool
//    schemas were being reprocessed by Anthropic from scratch on every
//    turn of every call. That same real call showed LLM time-to-first-
//    token spiking to ~2.7-3.0s on 2 of 8 turns (vs. ~1.1-1.6s on the
//    rest) -- the actual source of the "3-4 second delay" Andre reported
//    -- consistent with uncached large prompts being where Anthropic's
//    API shows the most latency variance.
//
//    The Safety Line's system prompt is identical on every turn within
//    one call (only `instructions` at Agent-construction time, never
//    mutated mid-call), and the 5 tool definitions are identical on
//    EVERY call regardless of caller -- both are exactly what Anthropic's
//    prompt-caching prefix model is for. Marking the last system content
//    block and the last tool definition with `cache_control` lets
//    Anthropic reuse the cached prefix starting on a call's 2nd turn,
//    instead of reprocessing it every time.
//
// Both patches are idempotent (safe to run on every `npm install`,
// including when node_modules already has them from a previous install)
// and fail loudly rather than silently if the plugin's internals change
// in a way that makes a patch not apply -- an unpatched plugin is far
// better than a build that silently reverted to the slow/uncached path
// with a false "patched" console message.
const fs = require("fs");
const path = require("path");

const TARGETS = [
	"node_modules/@livekit/agents-plugin-anthropic/dist/llm.cjs",
	"node_modules/@livekit/agents-plugin-anthropic/dist/llm.js",
];

// mode "append" inserts `insert` right after `anchor` (anchor line kept
// intact, immediately followed by the new line). mode "prepend" inserts
// `insert` right before `anchor` instead -- used where the anchor is the
// start of the next statement rather than the end of the one we're
// extending. `marker` is a distinct substring used to detect "already
// applied," so re-running this script is always safe.
const PATCHES = [
	{
		label: "thinking passthrough",
		anchor: "if (this.#opts.temperature !== void 0) extras.temperature = this.#opts.temperature;",
		insert: '\n    if (this.#opts.thinking !== void 0) extras.thinking = this.#opts.thinking;',
		marker: "this.#opts.thinking",
		mode: "append",
	},
	{
		label: "system prompt cache_control",
		anchor: "const { system, messages } = this._buildAnthropicContext(chatCtx);",
		insert: '\n    if (system.length > 0) system[system.length - 1].cache_control = { type: "ephemeral" };',
		marker: "system[system.length - 1].cache_control",
		mode: "append",
	},
	{
		label: "tool definitions cache_control",
		anchor: "const resolvedToolChoice = toolChoice ?? this.#opts.toolChoice;",
		insert: 'if (anthropicTools.length > 0) anthropicTools[anthropicTools.length - 1].cache_control = { type: "ephemeral" };\n    ',
		marker: "anthropicTools[anthropicTools.length - 1].cache_control",
		mode: "prepend",
	},
];

let totalPatched = 0;
let totalAlready = 0;
let totalFailed = 0;

for (const relPath of TARGETS) {
	const filePath = path.join(__dirname, "..", relPath);
	if (!fs.existsSync(filePath)) {
		console.error(`[patchAnthropicPlugin] ${relPath} not found -- @livekit/agents-plugin-anthropic may have changed its build output. Skipping (patches will NOT apply, latency/caching will regress).`);
		continue;
	}
	let content = fs.readFileSync(filePath, "utf8");
	let fileChanged = false;
	for (const patch of PATCHES) {
		if (content.includes(patch.marker)) {
			totalAlready++;
			continue;
		}
		if (!content.includes(patch.anchor)) {
			console.error(`[patchAnthropicPlugin] "${patch.label}" anchor not found in ${relPath} -- the plugin's internals likely changed. Skipping this patch there (it will NOT take effect).`);
			totalFailed++;
			continue;
		}
		const replacement = patch.mode === "prepend" ? patch.insert + patch.anchor : patch.anchor + patch.insert;
		content = content.replace(patch.anchor, replacement);
		fileChanged = true;
		totalPatched++;
	}
	if (fileChanged) fs.writeFileSync(filePath, content, "utf8");
}

if (totalPatched > 0) console.log(`[patchAnthropicPlugin] Applied ${totalPatched} patch(es).`);
if (totalAlready > 0) console.log(`[patchAnthropicPlugin] ${totalAlready} patch(es) already applied.`);
if (totalFailed > 0) console.error(`[patchAnthropicPlugin] ${totalFailed} patch(es) FAILED to apply -- see above, latency/caching will regress until fixed.`);
if (totalPatched === 0 && totalAlready === 0) console.error("[patchAnthropicPlugin] No patches were applied at all.");
