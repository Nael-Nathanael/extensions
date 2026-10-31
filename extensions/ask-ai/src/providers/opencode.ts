import { writeFileSync } from "node:fs";
import { runCli } from "./spawn.ts";
import { type Provider, ProviderError, transcript } from "./types.ts";

const LOGIN_HINT =
	"OpenCode free models need no sign-in. For paid or local models, configure them in OpenCode (`opencode auth`, or set a model in opencode.json) and put the model id here, e.g. ollama/llama3.2.";

/** Per-run permissions: allow tools (web search, shell) but block obviously destructive shell commands. */
const SAFE_PERMISSIONS = {
	permission: {
		bash: {
			"*": "allow",
			"rm *": "deny",
			"rm -rf *": "deny",
			"sudo *": "deny",
			"su *": "deny",
			"dd *": "deny",
			"mkfs*": "deny",
			"shutdown *": "deny",
			"reboot *": "deny",
			"chmod *": "deny",
			"chown *": "deny",
		},
		edit: "allow",
		webfetch: "allow",
		websearch: "allow",
	},
};

/** Maps one `opencode run --format json` line to answer text, or throws on an error event. */
export function opencodeLine(line: string): string | undefined {
	let msg: any;
	try {
		msg = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (msg?.type === "text" && typeof msg.part?.text === "string") return msg.part.text;
	if (msg?.type === "error") {
		const m = msg.error?.message ?? msg.error?.type ?? "error";
		throw new ProviderError(`OpenCode: ${m}\n\n${LOGIN_HINT}`);
	}
	return undefined;
}

export const opencode: Provider = {
	id: "opencode",
	title: "OpenCode",
	async stream(messages, opts) {
		const model = opts.model?.trim() || "opencode/beam-free";
		const agent = opts.agent?.trim() || "build";
		const autoApprove = opts.autoApprove !== false;
		// Scope permissions to this run only: drop a config file into the (deleted) workdir.
		try {
			writeFileSync(`${opts.workdir}/opencode.json`, JSON.stringify(SAFE_PERMISSIONS));
		} catch {
			// Non-fatal: run proceeds with OpenCode defaults.
		}
		const args = [
			"run",
			"--format",
			"json",
			...(autoApprove ? ["--auto"] : []),
			"--agent",
			agent,
			"--model",
			model,
		];
		let failure: unknown;
		let answered = false;
		const run = runCli({
			name: "opencode",
			label: "OpenCode",
			loginHint: LOGIN_HINT,
			args,
			cwd: opts.workdir,
			extraPath: opts.extraPath,
			input: `${opts.systemPrompt}\n\n${transcript(messages)}`,
			signal: opts.signal,
			onLine(line) {
				try {
					const text = opencodeLine(line);
					if (text?.trim()) answered = true;
					if (text) opts.onDelta(text);
				} catch (err) {
					failure ??= err;
				}
			},
		});
		await run.done.catch((err) => {
			throw failure ?? err;
		});
		if (failure) throw failure;
		if (!answered) {
			throw new ProviderError(
				`OpenCode finished without an answer. Free models may have hit the shared usage cap, or the model id \`${model}\` is unavailable. Try another model or a local one (ollama/...).\n\n${LOGIN_HINT}`,
			);
		}
	},
};