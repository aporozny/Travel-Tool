// Patches @livekit/agents-plugin-anthropic to forward a `thinking` option
// from LLM constructor options into the actual Anthropic API request --
// the plugin only forwards `temperature` this way, nothing else.
//
// Why this exists: attaching tool definitions (this app's voice agent has
// four) makes Claude Sonnet 5 silently engage extended thinking by
// default, even though nothing requests it. Measured directly against
// the real Anthropic API with this agent's actual tool schemas: 4.24s
// with thinking active vs 1.57s with `thinking: {type: "disabled"}` --
// a ~63% latency cut on every single conversational turn. There's no
// documented way to set this through the plugin's exposed options, so
// this patches the two runtime bundles (CJS -- what this CommonJS
// backend actually loads at runtime -- and ESM, patched too so the
// package stays internally consistent) to add the same one-line
// passthrough the plugin already does for `temperature`.
//
// Idempotent (safe to run on every `npm install`, including when
// node_modules already has the patch from a previous install) and fails
// loudly rather than silently if the plugin's internals change in a way
// that makes this patch not apply -- an unpatched plugin is far better
// than a build that silently reverted to the slow path with a false
// "patched" console message.
const fs = require("fs");
const path = require("path");

const TARGETS = [
	"node_modules/@livekit/agents-plugin-anthropic/dist/llm.cjs",
	"node_modules/@livekit/agents-plugin-anthropic/dist/llm.js",
];

const ANCHOR = "if (this.#opts.temperature !== void 0) extras.temperature = this.#opts.temperature;";
const INSERT = "\n    if (this.#opts.thinking !== void 0) extras.thinking = this.#opts.thinking;";

let patchedCount = 0;
let alreadyPatchedCount = 0;

for (const relPath of TARGETS) {
	const filePath = path.join(__dirname, "..", relPath);
	if (!fs.existsSync(filePath)) {
		console.error(`[patchAnthropicPlugin] ${relPath} not found -- @livekit/agents-plugin-anthropic may have changed its build output. Skipping (thinking will NOT be disabled, latency will regress).`);
		continue;
	}
	const content = fs.readFileSync(filePath, "utf8");
	if (content.includes("this.#opts.thinking")) {
		alreadyPatchedCount++;
		continue;
	}
	if (!content.includes(ANCHOR)) {
		console.error(`[patchAnthropicPlugin] Expected anchor line not found in ${relPath} -- the plugin's internals likely changed. Skipping this file (thinking will NOT be disabled there).`);
		continue;
	}
	fs.writeFileSync(filePath, content.replace(ANCHOR, ANCHOR + INSERT), "utf8");
	patchedCount++;
}

if (patchedCount > 0) console.log(`[patchAnthropicPlugin] Patched ${patchedCount} file(s) to forward the thinking option.`);
if (alreadyPatchedCount > 0) console.log(`[patchAnthropicPlugin] ${alreadyPatchedCount} file(s) already patched.`);
if (patchedCount === 0 && alreadyPatchedCount === 0) {
	console.error("[patchAnthropicPlugin] No files were patched. Extended thinking will remain active on every LLM call, adding real latency -- see this script's header comment.");
}
