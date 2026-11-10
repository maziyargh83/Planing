import { spawn } from "node:child_process";

import { needsApproval } from "../tools.ts";
import { partId, type Provider, type ProviderStatus, type RunContext, type RunResult } from "./shared.ts";

const url = () => (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");

/** Small local models do better with a focused tool list. */
const TOOLS = new Set([
	"gaam_context", "search", "workspace_list", "goal_list", "project_list", "project_get", "project_save",
	"task_list", "task_get", "task_create", "task_update", "task_score", "scope_set",
	"mindmap_get", "mindmap_add", "ask_user", "comment_add", "day_get", "day_plan", "journal_add",
	"memory_list", "memory_save", "insights", "standup_context", "standup_save", "team_status",
	"followup_list", "followup_save", "doc_list", "doc_get", "doc_save", "people_list", "decision_save",
]);

const MAX_STEPS = 10;

interface OllamaMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	thinking?: string;
	tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
	tool_name?: string;
}

interface Chunk {
	message?: OllamaMessage;
	done?: boolean;
	prompt_eval_count?: number;
	eval_count?: number;
	error?: string;
}

async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<Chunk> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let nl: number;
		while ((nl = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (line) yield JSON.parse(line) as Chunk;
		}
	}
	if (buffer.trim()) yield JSON.parse(buffer) as Chunk;
}

export const ollama: Provider = {
	id: "ollama",
	async status(): Promise<ProviderStatus> {
		try {
			const res = await fetch(`${url()}/api/tags`, { signal: AbortSignal.timeout(1500) });
			const { models } = (await res.json()) as { models: { name: string }[] };
			const names = models.map((m) => m.name);
			const preferred = ["qwen3:14b", "gpt-oss:20b", "qwen3:8b", "llama3.1:8b"].find((m) => names.includes(m)) ?? names[0] ?? null;
			return {
				id: "ollama",
				label: "Ollama · لوکال",
				available: names.length > 0,
				detail: `${names.length} مدل روی ${url()} · آفلاین و رایگان`,
				models: names.map((n) => ({ id: n, label: n })),
				defaultModel: preferred,
				effort: false,
				toolsInGaam: true,
			};
		} catch {
			return { id: "ollama", label: "Ollama · لوکال", available: false, detail: "Ollama روشن نیست", models: [], defaultModel: null, effort: false, toolsInGaam: true };
		}
	},

	async run(ctx: RunContext): Promise<RunResult> {
		const status = await ollama.status();
		const model = ctx.model ?? status.defaultModel;
		if (!status.available || !model) throw new Error("Ollama ECONNREFUSED: not running");
		const tools = ctx.tools.tools
			.filter((t) => TOOLS.has(t.name))
			.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
		const messages: OllamaMessage[] = Array.isArray(ctx.native)
			? [...(ctx.native as OllamaMessage[])]
			: [{ role: "system", content: ctx.system }, ...ctx.history.slice(-12).map((h) => ({ role: h.role, content: h.text }))];
		messages.push({ role: "user", content: ctx.prompt });

		for (let step = 0; step < MAX_STEPS; step++) {
			if (step > 0) ctx.emit({ type: "start-step" });
			const res = await fetch(`${url()}/api/chat`, {
				method: "POST",
				signal: ctx.signal,
				body: JSON.stringify({ model, messages, tools, stream: true, think: true, options: { num_ctx: 16384 } }),
			});
			if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);

			const reply: OllamaMessage = { role: "assistant", content: "", thinking: "" };
			let textId: string | null = null;
			let thinkId: string | null = null;
			let thinkStart = 0;
			for await (const chunk of ndjson(res.body)) {
				if (chunk.error) throw new Error(chunk.error);
				const m = chunk.message;
				if (m?.thinking) {
					if (!thinkId) {
						thinkId = partId("r");
						thinkStart = Date.now();
						ctx.emit({ type: "reasoning-start", id: thinkId });
					}
					reply.thinking += m.thinking;
					ctx.emit({ type: "reasoning-delta", id: thinkId, delta: m.thinking });
				}
				if (m?.content) {
					if (thinkId) {
						ctx.emit({ type: "reasoning-end", id: thinkId, ms: Date.now() - thinkStart });
						thinkId = null;
					}
					if (!textId) {
						textId = partId("t");
						ctx.emit({ type: "text-start", id: textId });
					}
					reply.content += m.content;
					ctx.emit({ type: "text-delta", id: textId, delta: m.content });
				}
				if (m?.tool_calls?.length) reply.tool_calls = [...(reply.tool_calls ?? []), ...m.tool_calls];
				if (chunk.done) ctx.emit({ type: "usage", usage: { input: chunk.prompt_eval_count ?? 0, output: chunk.eval_count ?? 0, costUsd: 0 } });
			}
			if (thinkId) ctx.emit({ type: "reasoning-end", id: thinkId, ms: Date.now() - thinkStart });
			if (textId) ctx.emit({ type: "text-end", id: textId });
			messages.push(reply);
			if (!reply.tool_calls?.length) return { native: messages };

			for (const call of reply.tool_calls) {
				const id = partId("c");
				const name = call.function.name;
				const input = call.function.arguments ?? {};
				ctx.emit({ type: "tool-input-available", toolCallId: id, name, input });
				if (needsApproval(name, input)) {
					ctx.emit({ type: "tool-approval-request", toolCallId: id });
					if (!(await ctx.approve(id))) {
						ctx.emit({ type: "tool-denied", toolCallId: id });
						messages.push({ role: "tool", tool_name: name, content: "The user declined this action." });
						continue;
					}
				}
				const result = await ctx.tools.call(name, input);
				if (result.ok) ctx.emit({ type: "tool-output-available", toolCallId: id, output: result.output, ms: result.ms });
				else ctx.emit({ type: "tool-output-error", toolCallId: id, error: result.text, ms: result.ms });
				messages.push({ role: "tool", tool_name: name, content: result.text.slice(0, 8000) });
			}
		}
		ctx.emit({ type: "error", error: "مدل لوکال بیش از حد ابزار صدا زد." });
		return { native: messages, finish: "max-steps" };
	},
};

/** Starts the Ollama desktop app (macOS) so local models become available. */
export function startOllama() {
	spawn("open", ["-a", "Ollama"], { detached: true, stdio: "ignore" }).unref();
	return { starting: true };
}
