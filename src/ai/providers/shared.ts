import { spawn } from "node:child_process";
import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

import type { Db } from "../../core/db.ts";
import type { AiLimits } from "../limits.ts";
import type { ChatEvent } from "../protocol.ts";
import type { ToolBridge } from "../tools.ts";

export interface HistoryTurn {
	role: "user" | "assistant";
	text: string;
}

export interface RunContext {
	db: Db;
	workspace: string | null;
	system: string;
	model: string | null;
	effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
	/** The user's caps for this turn (output tokens, steps, reasoning display). */
	limits: AiLimits;
	/** The user's message with its attached context, as the model should read it. */
	prompt: string;
	/** Earlier turns as plain text, for providers without saved native state. */
	history: HistoryTurn[];
	/** Provider-native state saved after the previous turn (transcript or session id). */
	native: unknown;
	tools: ToolBridge;
	emit: (event: ChatEvent) => void;
	/** Resolves when the user approves (true) or denies (false) a tool call. */
	approve: (toolCallId: string) => Promise<boolean>;
	signal: AbortSignal;
}

export interface RunResult {
	native?: unknown;
	finish?: Extract<ChatEvent, { type: "finish" }>["reason"];
}

export interface ProviderStatus {
	id: string;
	label: string;
	available: boolean;
	detail: string;
	models: { id: string; label: string }[];
	defaultModel: string | null;
	/** Whether the provider honours effort levels. */
	effort: boolean;
	/** Whether tool calls run inside Gaam (cards, approvals) or inside the CLI agent. */
	toolsInGaam: boolean;
}

export interface Provider {
	id: string;
	status(): Promise<ProviderStatus>;
	run(ctx: RunContext): Promise<RunResult>;
}

export const ROOT = new URL("../../..", import.meta.url).pathname;
export const AGENT_CWD = join(homedir(), ".gaam", "workspace");

export function which(name: string, extra: string[] = []): string | null {
	const dirs = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", ...extra];
	for (const dir of dirs) {
		const file = join(dir, name);
		try {
			accessSync(file, constants.X_OK);
			return file;
		} catch {}
	}
	return null;
}

/** How a CLI agent launches Gaam's own MCP server against the same database and workspace. */
export function gaamServer(db: Db, actor: string, workspace?: string | null) {
	return {
		command: process.execPath,
		args: ["--disable-warning=ExperimentalWarning", `--env-file-if-exists=${ROOT}.env`, `${ROOT}src/mcp/stdio.ts`],
		env: { GAAM_DB: db.location() ?? "", GAAM_ACTOR: actor, ...(workspace ? { GAAM_WORKSPACE: workspace } : {}) },
	};
}

/**
 * The environment a CLI agent should see: the user's own, minus variables a host
 * (e.g. a running Claude Code session) injected, so it authenticates as the user.
 */
export function cleanEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { NO_COLOR: "1" };
	for (const [k, v] of Object.entries(process.env))
		if (!/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|ANTHROPIC_BASE_URL|CODEX_THREAD|CODEX_SANDBOX)/.test(k)) env[k] = v;
	return env;
}

/** Runs a CLI and hands each JSON line of stdout to onLine. Rejects with the tail of stderr on failure. */
export function jsonLines(bin: string, args: string[], signal: AbortSignal, stdin: string, onLine: (line: Record<string, unknown>) => void, env: Record<string, string> = {}) {
	mkdirSync(AGENT_CWD, { recursive: true });
	return new Promise<void>((resolve, reject) => {
		const child = spawn(bin, args, { cwd: AGENT_CWD, env: { ...cleanEnv(), ...env }, stdio: ["pipe", "pipe", "pipe"] });
		let stderr = "";
		let failure: Error | null = null;
		child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
		const abort = () => child.kill("SIGTERM");
		signal.addEventListener("abort", abort, { once: true });
		createInterface({ input: child.stdout }).on("line", (line) => {
			if (!line.startsWith("{") || failure) return;
			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(line);
			} catch {
				return;
			}
			try {
				onLine(parsed);
			} catch (error) {
				// Stop the agent too: whatever it does next is built on a broken start.
				failure = error as Error;
				child.kill("SIGTERM");
			}
		});
		child.on("error", reject);
		child.on("close", (code) => {
			signal.removeEventListener("abort", abort);
			if (signal.aborted) reject(new DOMException("Stopped", "AbortError"));
			else if (failure) reject(failure);
			else if (code === 0) resolve();
			else reject(new Error(stderr.trim().split("\n").slice(-3).join("\n") || `${bin} exited with ${code}`));
		});
		child.stdin.end(stdin);
	});
}

/** Plain-text transcript for agents that start without memory of this thread. */
export function historyPreamble(history: HistoryTurn[], maxChars = 12_000): string {
	if (!history.length) return "";
	let text = history.map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text}`).join("\n\n");
	if (text.length > maxChars) text = `…${text.slice(-maxChars)}`;
	return `<conversation_so_far>\n${text}\n</conversation_so_far>\n\n`;
}

let counter = 0;
export const partId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

const AUTH_HINTS: Record<string, [RegExp, string]> = {
	claude: [/Failed to authenticate|OAuth|not logged in|Invalid API key|\/login/i, "Claude Code لاگین نیست یا نشستش منقضی شده. در ترمینال `claude` را اجرا کن و `/login` بزن."],
	codex: [/401|unauthorized|log ?in|auth/i, "Codex لاگین نیست. اپ ChatGPT/Codex را باز کن و وارد شو (یا `codex login`)."],
	anthropic: [/authentication|api.key|x-api-key|401/i, "کلید API کلاد تنظیم نیست یا معتبر نیست. ANTHROPIC_API_KEY را در ~/Planing/.env بگذار."],
	ollama: [/ECONNREFUSED|fetch failed/i, "Ollama روشن نیست. اپ Ollama را باز کن (یا در «اتصال» دکمه‌ی روشن کردن را بزن)."],
};

export function friendlyError(provider: string, message: string): string {
	const hint = AUTH_HINTS[provider];
	return hint && hint[0].test(message) ? `${hint[1]}\n\n(${message.slice(0, 240)})` : message;
}
