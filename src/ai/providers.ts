import { spawn } from "node:child_process";
import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { Db } from "../core/db.ts";
import type { Message, ProviderId } from "../core/types.ts";
import { createMcpServer } from "../mcp/server.ts";

export type RunEvent = { type: "text"; text: string } | { type: "tool"; name: string } | { type: "status"; text: string };

export interface RunInput {
	db: Db;
	prompt: string;
	system: string;
	model?: string | null;
	/** Provider-side conversation id from the previous turn, when the provider can resume. */
	session?: string | null;
	history: Message[];
	signal: AbortSignal;
	onEvent: (event: RunEvent) => void;
}

export interface RunResult {
	text: string;
	session?: string | null;
}

export interface ProviderStatus {
	id: ProviderId;
	label: string;
	available: boolean;
	detail: string;
	models: string[];
	defaultModel: string | null;
}

const ROOT = new URL("../..", import.meta.url).pathname;
const WORKSPACE = join(homedir(), ".gaam", "workspace");
const TOOL_PREFIX = /^mcp__gaam__/;

function which(name: string, extra: string[] = []): string | null {
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

const claudeBin = () => process.env.CLAUDE_BIN ?? which("claude");
const codexBin = () => process.env.CODEX_BIN ?? which("codex", ["/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin", "/Applications/Codex.app/Contents/Resources"]);
const ollamaUrl = () => (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");

/** How a CLI agent launches Gaam's own MCP server, pointed at the same database. */
function gaamServer(db: Db, actor: string) {
	return {
		command: process.execPath,
		args: ["--disable-warning=ExperimentalWarning", `--env-file-if-exists=${ROOT}.env`, `${ROOT}src/mcp/stdio.ts`],
		env: { GAAM_DB: db.location() ?? "", GAAM_ACTOR: actor },
	};
}

/**
 * The environment a CLI agent should see: the user's own, minus variables a host
 * (e.g. a running Claude Code session) injected, so it authenticates with the
 * user's own login.
 */
function cleanEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { NO_COLOR: "1" };
	for (const [k, v] of Object.entries(process.env))
		if (!/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|ANTHROPIC_BASE_URL|CODEX_THREAD|CODEX_SANDBOX)/.test(k)) env[k] = v;
	return env;
}

const AUTH_HINTS: [RegExp, string][] = [
	[/Failed to authenticate|OAuth|not logged in|Invalid API key|\/login/i, "Claude Code لاگین نیست یا نشستش منقضی شده. در ترمینال `claude` را اجرا کن و `/login` بزن، بعد دوباره امتحان کن."],
	[/401|unauthorized|log ?in|auth/i, "Codex لاگین نیست. اپ ChatGPT/Codex را باز کن و وارد شو (یا در ترمینال `codex login`)."],
];

export function friendlyError(provider: string, message: string): string {
	const hint = AUTH_HINTS.find(([re], i) => (provider === "claude" ? i === 0 : i === 1) && re.test(message));
	return hint ? `${hint[1]}\n\n(${message.slice(0, 200)})` : message;
}

/** Runs a CLI and yields its stdout as JSON lines. Rejects with stderr on a non-zero exit. */
function jsonLines(bin: string, args: string[], input: RunInput, stdin: string | null, onLine: (line: Record<string, unknown>) => void) {
	mkdirSync(WORKSPACE, { recursive: true });
	return new Promise<void>((resolve, reject) => {
		const child = spawn(bin, args, { cwd: WORKSPACE, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
		const abort = () => child.kill("SIGTERM");
		input.signal.addEventListener("abort", abort, { once: true });
		let failure: Error | null = null;
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
				failure = error as Error;
			}
		});
		child.on("error", reject);
		child.on("close", (code) => {
			input.signal.removeEventListener("abort", abort);
			if (input.signal.aborted) reject(new Error("Stopped."));
			else if (failure) reject(failure);
			else if (code === 0) resolve();
			else reject(new Error(stderr.trim().split("\n").slice(-3).join("\n") || `${bin} exited with ${code}`));
		});
		if (stdin != null) child.stdin.end(stdin);
		else child.stdin.end();
	});
}

// ── Claude Code (the user's Claude account) ─────────────────────────────────

const claude = {
	id: "claude" as const,
	label: "Claude Code",
	async status(): Promise<ProviderStatus> {
		const bin = claudeBin();
		return {
			id: "claude",
			label: "Claude Code",
			available: Boolean(bin),
			detail: bin ? `با اکانت Claude خودت · ${bin}` : "claude پیدا نشد (npm i -g @anthropic-ai/claude-code)",
			models: ["opus", "sonnet", "haiku"],
			defaultModel: "sonnet",
		};
	},
	async run(input: RunInput): Promise<RunResult> {
		const bin = claudeBin();
		if (!bin) throw new Error("Claude Code is not installed.");
		const args = [
			"-p",
			"--output-format", "stream-json",
			"--verbose",
			"--include-partial-messages",
			"--strict-mcp-config",
			"--mcp-config", JSON.stringify({ mcpServers: { gaam: gaamServer(input.db, "assistant:claude") } }),
			"--allowedTools", "mcp__gaam",
			"--tools", "",
			"--disable-slash-commands",
			"--append-system-prompt", input.system,
		];
		if (input.model) args.push("--model", input.model);
		if (input.session) args.push("--resume", input.session);
		let final = "";
		let streamed = "";
		let session = input.session ?? null;
		await jsonLines(bin, args, input, input.prompt, (line) => {
			if (line.session_id) session = line.session_id as string;
			if (line.type === "stream_event") {
				const event = line.event as { type: string; delta?: { type: string; text?: string } };
				if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
					streamed += event.delta.text;
					input.onEvent({ type: "text", text: event.delta.text });
				}
			} else if (line.type === "assistant") {
				const content = (line.message as { content: { type: string; name?: string }[] }).content ?? [];
				for (const block of content)
					if (block.type === "tool_use") {
						input.onEvent({ type: "tool", name: block.name!.replace(TOOL_PREFIX, "") });
						if (streamed && !streamed.endsWith("\n\n")) {
							streamed += "\n\n";
							input.onEvent({ type: "text", text: "\n\n" });
						}
					}
			} else if (line.type === "result") {
				if (line.is_error) throw new Error(String(line.result ?? "Claude returned an error"));
				final = String(line.result ?? "");
			}
		});
		return { text: final || streamed, session };
	},
};

// ── Codex (the user's ChatGPT account) ──────────────────────────────────────

function tomlString(value: string) {
	return JSON.stringify(value);
}

const codex = {
	id: "codex" as const,
	label: "Codex · ChatGPT",
	async status(): Promise<ProviderStatus> {
		const bin = codexBin();
		return {
			id: "codex",
			label: "Codex · ChatGPT",
			available: Boolean(bin),
			detail: bin ? `با اکانت ChatGPT خودت · ${bin}` : "Codex پیدا نشد (ChatGPT.app یا npm i -g @openai/codex)",
			models: [],
			defaultModel: null,
		};
	},
	async run(input: RunInput): Promise<RunResult> {
		const bin = codexBin();
		if (!bin) throw new Error("Codex is not installed.");
		const server = gaamServer(input.db, "assistant:codex");
		const common = [
			"--json",
			"--skip-git-repo-check",
			"-c", `mcp_servers.gaam.command=${tomlString(server.command)}`,
			"-c", `mcp_servers.gaam.args=[${server.args.map(tomlString).join(",")}]`,
			"-c", `mcp_servers.gaam.env={GAAM_DB=${tomlString(server.env.GAAM_DB)},GAAM_ACTOR="assistant:codex"}`,
			"-c", 'approval_policy="never"',
			"-s", "read-only",
		];
		if (input.model) common.push("-m", input.model);
		const prompt = input.session ? input.prompt : `${input.system}\n\n---\n\n${input.prompt}`;
		const args = input.session ? ["exec", "resume", ...common, input.session, "-"] : ["exec", ...common, "-C", WORKSPACE, "-"];
		let text = "";
		let session = input.session ?? null;
		await jsonLines(bin, args, input, prompt, (line) => {
			if (line.type === "thread.started") session = line.thread_id as string;
			const item = line.item as { type?: string; text?: string; tool?: string; name?: string; server?: string } | undefined;
			if (!item) return;
			if (line.type === "item.started" && item.type?.includes("tool")) input.onEvent({ type: "tool", name: item.tool ?? item.name ?? item.type });
			if (line.type === "item.completed" && item.type === "agent_message" && item.text) {
				text = item.text;
				input.onEvent({ type: "text", text: `${item.text}\n\n` });
			}
			if (line.type === "error" || line.type === "turn.failed") throw new Error(JSON.stringify(line.error ?? line.message ?? line));
		});
		return { text, session };
	},
};

// ── Ollama (local models) ───────────────────────────────────────────────────

/** Small local models do better with a short tool list. */
const OLLAMA_TOOLS = new Set([
	"gaam_context", "search", "goal_list", "project_list", "project_get", "project_save",
	"task_list", "task_get", "task_create", "task_update", "task_score", "scope_set",
	"mindmap_get", "mindmap_add", "ask_user", "comment_add", "day_get", "day_plan", "journal_add",
	"memory_list", "memory_save", "insights",
]);

interface OllamaMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
	tool_name?: string;
}

const ollama = {
	id: "ollama" as const,
	label: "Ollama · لوکال",
	async status(): Promise<ProviderStatus> {
		try {
			const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(1500) });
			const { models } = (await res.json()) as { models: { name: string }[] };
			const names = models.map((m) => m.name);
			const preferred = ["qwen3:14b", "gpt-oss:20b", "qwen3:8b", "llama3.1:8b"].find((m) => names.includes(m)) ?? names[0] ?? null;
			return { id: "ollama", label: "Ollama · لوکال", available: names.length > 0, detail: `${names.length} مدل روی ${ollamaUrl()}`, models: names, defaultModel: preferred };
		} catch {
			return { id: "ollama", label: "Ollama · لوکال", available: false, detail: "Ollama روشن نیست (اپ Ollama را باز کن یا ollama serve)", models: [], defaultModel: null };
		}
	},
	async run(input: RunInput): Promise<RunResult> {
		const status = await ollama.status();
		const model = input.model ?? status.defaultModel;
		if (!status.available || !model) throw new Error(status.detail);
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await createMcpServer(input.db, `assistant:ollama`).connect(serverSide);
		const client = new Client({ name: "gaam-assistant", version: "1" });
		await client.connect(clientSide);
		try {
			const { tools } = await client.listTools();
			const schema = tools
				.filter((t) => OLLAMA_TOOLS.has(t.name))
				.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
			const messages: OllamaMessage[] = [
				{ role: "system", content: input.system },
				...input.history.filter((m) => m.role !== "error").slice(-12).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
				{ role: "user", content: input.prompt },
			];
			for (let step = 0; step < 10; step++) {
				const res = await fetch(`${ollamaUrl()}/api/chat`, {
					method: "POST",
					signal: input.signal,
					body: JSON.stringify({ model, messages, tools: schema, stream: false, think: false, options: { num_ctx: 16384 } }),
				});
				if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
				const { message } = (await res.json()) as { message: OllamaMessage };
				messages.push(message);
				if (!message.tool_calls?.length) {
					input.onEvent({ type: "text", text: message.content });
					return { text: message.content };
				}
				for (const call of message.tool_calls) {
					input.onEvent({ type: "tool", name: call.function.name });
					const result = (await client.callTool({ name: call.function.name, arguments: call.function.arguments ?? {} })) as {
						content: { text?: string }[];
					};
					messages.push({ role: "tool", tool_name: call.function.name, content: (result.content[0]?.text ?? "").slice(0, 8000) });
				}
			}
			throw new Error("The local model kept calling tools without answering.");
		} finally {
			await client.close();
		}
	},
};

export const PROVIDER_IMPLS = { claude, codex, ollama };

export function providerStatus() {
	return Promise.all([claude.status(), codex.status(), ollama.status()]);
}

/** Starts the Ollama desktop app (macOS) so local models become available. */
export function startOllama() {
	spawn("open", ["-a", "Ollama"], { detached: true, stdio: "ignore" }).unref();
	return { starting: true };
}
