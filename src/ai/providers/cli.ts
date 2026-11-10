import { DESTRUCTIVE_TOOLS } from "../tools.ts";
import { gaamServer, historyPreamble, jsonLines, partId, type Provider, type ProviderStatus, type RunContext, type RunResult, which } from "./shared.ts";

const TOOL_PREFIX = /^mcp__gaam__/;

function parseMaybe(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "")).join("\n");
	return JSON.stringify(content);
}

// ── Claude Code (the user's Claude subscription) ─────────────────────────────

const claudeBin = () => process.env.CLAUDE_BIN ?? which("claude");

export const claudeCode: Provider = {
	id: "claude",
	async status(): Promise<ProviderStatus> {
		const bin = claudeBin();
		return {
			id: "claude",
			label: "Claude Code",
			available: Boolean(bin),
			detail: bin ? "با اکانت Claude خودت (اشتراک)" : "claude پیدا نشد",
			models: [
				{ id: "opus", label: "Opus" },
				{ id: "sonnet", label: "Sonnet" },
				{ id: "haiku", label: "Haiku" },
			],
			defaultModel: "sonnet",
			effort: false,
			toolsInGaam: false,
		};
	},
	async run(ctx: RunContext): Promise<RunResult> {
		const bin = claudeBin();
		if (!bin) throw new Error("Claude Code is not installed.");
		const session = (ctx.native as { session?: string } | null)?.session ?? null;
		const args = [
			"-p",
			"--output-format", "stream-json",
			"--verbose",
			"--include-partial-messages",
			"--strict-mcp-config",
			"--mcp-config", JSON.stringify({ mcpServers: { gaam: gaamServer(ctx.db, "assistant:claude", ctx.workspace) } }),
			"--allowedTools", "mcp__gaam",
			// Claude Code can't pause for Gaam's approval UI, so destructive tools are off here.
			"--disallowedTools", ...DESTRUCTIVE_TOOLS.map((t) => `mcp__gaam__${t}`),
			"--tools", "",
			"--disable-slash-commands",
			"--append-system-prompt", ctx.system,
		];
		if (ctx.model) args.push("--model", ctx.model);
		if (session) args.push("--resume", session);
		const prompt = session ? ctx.prompt : historyPreamble(ctx.history) + ctx.prompt;

		let sessionId = session;
		const open = new Map<string, { kind: "text" | "reasoning" | "tool"; id: string; started: number }>();
		let turn = 0;
		let errored: string | null = null;
		await jsonLines(bin, args, ctx.signal, prompt, (line) => {
			if (typeof line.session_id === "string") sessionId = line.session_id;
			if (line.type === "stream_event") {
				const ev = line.event as { type: string; index?: number; content_block?: { type: string; id?: string; name?: string }; delta?: Record<string, string> };
				if (ev.type === "message_start") {
					if (turn++ > 0) ctx.emit({ type: "start-step" });
					open.clear();
				}
				const key = String(ev.index);
				if (ev.type === "content_block_start" && ev.content_block) {
					const b = ev.content_block;
					if (b.type === "text") {
						const id = partId("t");
						open.set(key, { kind: "text", id, started: Date.now() });
						ctx.emit({ type: "text-start", id });
					} else if (b.type === "thinking") {
						const id = partId("r");
						open.set(key, { kind: "reasoning", id, started: Date.now() });
						ctx.emit({ type: "reasoning-start", id });
					} else if (b.type === "tool_use" && b.id) {
						open.set(key, { kind: "tool", id: b.id, started: Date.now() });
						ctx.emit({ type: "tool-input-start", toolCallId: b.id, name: (b.name ?? "").replace(TOOL_PREFIX, "") });
					}
				} else if (ev.type === "content_block_delta" && ev.delta) {
					const o = open.get(key);
					if (!o) return;
					if (ev.delta.type === "text_delta") ctx.emit({ type: "text-delta", id: o.id, delta: ev.delta.text ?? "" });
					else if (ev.delta.type === "thinking_delta") ctx.emit({ type: "reasoning-delta", id: o.id, delta: ev.delta.thinking ?? "" });
					else if (ev.delta.type === "input_json_delta") ctx.emit({ type: "tool-input-delta", toolCallId: o.id, delta: ev.delta.partial_json ?? "" });
				} else if (ev.type === "content_block_stop") {
					const o = open.get(key);
					if (o?.kind === "text") ctx.emit({ type: "text-end", id: o.id });
					if (o?.kind === "reasoning") ctx.emit({ type: "reasoning-end", id: o.id, ms: Date.now() - o.started });
				}
			} else if (line.type === "assistant") {
				const content = (line.message as { content?: { type: string; id?: string; name?: string; input?: unknown }[] }).content ?? [];
				for (const b of content)
					if (b.type === "tool_use" && b.id) ctx.emit({ type: "tool-input-available", toolCallId: b.id, name: (b.name ?? "").replace(TOOL_PREFIX, ""), input: b.input });
			} else if (line.type === "user") {
				const content = (line.message as { content?: { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[] }).content ?? [];
				for (const b of content) {
					if (b.type !== "tool_result" || !b.tool_use_id) continue;
					const text = resultText(b.content);
					if (b.is_error) ctx.emit({ type: "tool-output-error", toolCallId: b.tool_use_id, error: text });
					else ctx.emit({ type: "tool-output-available", toolCallId: b.tool_use_id, output: parseMaybe(text) });
				}
			} else if (line.type === "result") {
				const usage = (line.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
				ctx.emit({
					type: "usage",
					usage: {
						input: usage.input_tokens ?? 0,
						output: usage.output_tokens ?? 0,
						cacheRead: usage.cache_read_input_tokens ?? 0,
						cacheWrite: usage.cache_creation_input_tokens ?? 0,
						costUsd: typeof line.total_cost_usd === "number" ? line.total_cost_usd : undefined,
					},
				});
				if (line.is_error) errored = String(line.result ?? "Claude Code returned an error");
			}
		});
		if (errored) throw new Error(errored);
		return { native: { session: sessionId } };
	},
};

// ── Codex (the user's ChatGPT account) ───────────────────────────────────────

const codexBin = () =>
	process.env.CODEX_BIN ?? which("codex", ["/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin", "/Applications/Codex.app/Contents/Resources"]);
const toml = (v: string) => JSON.stringify(v);

export const codex: Provider = {
	id: "codex",
	async status(): Promise<ProviderStatus> {
		const bin = codexBin();
		return {
			id: "codex",
			label: "Codex · ChatGPT",
			available: Boolean(bin),
			detail: bin ? "با اکانت ChatGPT خودت" : "Codex پیدا نشد",
			models: [],
			defaultModel: null,
			effort: true,
			toolsInGaam: false,
		};
	},
	async run(ctx: RunContext): Promise<RunResult> {
		const bin = codexBin();
		if (!bin) throw new Error("Codex is not installed.");
		const session = (ctx.native as { session?: string } | null)?.session ?? null;
		const server = gaamServer(ctx.db, "assistant:codex", ctx.workspace);
		const env = Object.entries(server.env)
			.map(([k, v]) => `${k}=${toml(v)}`)
			.join(",");
		const common = [
			"--json",
			"--skip-git-repo-check",
			"-c", `mcp_servers.gaam.command=${toml(server.command)}`,
			"-c", `mcp_servers.gaam.args=[${server.args.map(toml).join(",")}]`,
			"-c", `mcp_servers.gaam.env={${env}}`,
			"-c", `mcp_servers.gaam.disabled_tools=[${DESTRUCTIVE_TOOLS.map(toml).join(",")}]`,
			"-c", 'approval_policy="never"',
			"-s", "read-only",
		];
		if (ctx.model) common.push("-m", ctx.model);
		if (ctx.effort) common.push("-c", `model_reasoning_effort=${toml(ctx.effort === "xhigh" || ctx.effort === "max" ? "high" : ctx.effort)}`);
		const prompt = session ? ctx.prompt : `${ctx.system}\n\n---\n\n${historyPreamble(ctx.history)}${ctx.prompt}`;
		const args = session ? ["exec", "resume", ...common, session, "-"] : ["exec", ...common, "-"];

		let sessionId = session;
		let turnFailed: string | null = null;
		const started = new Map<string, number>();
		await jsonLines(bin, args, ctx.signal, prompt, (line) => {
			if (line.type === "thread.started") sessionId = String(line.thread_id);
			if (line.type === "turn.failed" || line.type === "error") turnFailed = JSON.stringify(line.error ?? line.message ?? line);
			if (line.type === "turn.completed") {
				const u = (line.usage ?? {}) as { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
				ctx.emit({ type: "usage", usage: { input: (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0), output: u.output_tokens ?? 0, cacheRead: u.cached_input_tokens ?? 0 } });
			}
			const item = line.item as
				| { id: string; type: string; text?: string; tool?: string; server?: string; arguments?: unknown; result?: { content?: unknown }; error?: { message?: string } | string; status?: string }
				| undefined;
			if (!item) return;
			if (item.type === "mcp_tool_call") {
				if (line.type === "item.started") {
					started.set(item.id, Date.now());
					ctx.emit({ type: "tool-input-available", toolCallId: item.id, name: item.tool ?? "tool", input: item.arguments });
				} else if (line.type === "item.completed") {
					const ms = Date.now() - (started.get(item.id) ?? Date.now());
					if (!started.has(item.id)) ctx.emit({ type: "tool-input-available", toolCallId: item.id, name: item.tool ?? "tool", input: item.arguments });
					if (item.error || item.status === "failed")
						ctx.emit({ type: "tool-output-error", toolCallId: item.id, error: typeof item.error === "string" ? item.error : (item.error?.message ?? "failed"), ms });
					else ctx.emit({ type: "tool-output-available", toolCallId: item.id, output: parseMaybe(resultText(item.result?.content ?? "")), ms });
				}
			} else if (line.type === "item.completed" && item.text) {
				if (item.type === "agent_message") {
					const id = partId("t");
					ctx.emit({ type: "text-start", id });
					ctx.emit({ type: "text-delta", id, delta: item.text });
					ctx.emit({ type: "text-end", id });
				} else if (item.type === "reasoning") {
					const id = partId("r");
					ctx.emit({ type: "reasoning-start", id });
					ctx.emit({ type: "reasoning-delta", id, delta: item.text });
					ctx.emit({ type: "reasoning-end", id });
				}
			}
		});
		if (turnFailed) throw new Error(turnFailed);
		return { native: { session: sessionId } };
	},
};
