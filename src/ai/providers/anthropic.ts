import Anthropic from "@anthropic-ai/sdk";

import { needsApproval } from "../tools.ts";
import { partId, type Provider, type ProviderStatus, type RunContext, type RunResult } from "./shared.ts";

/**
 * Claude through the official Anthropic SDK: a streaming manual tool loop over
 * Gaam's tools, with adaptive thinking (summarized reasoning is shown), effort,
 * prompt caching, eager tool-input streaming and server-side refusal fallbacks.
 */

const MODELS = [
	{ id: "claude-opus-5-5", label: "Claude Opus 5.5" },
	{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
	{ id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
	{ id: "claude-fable-5-1", label: "Claude Fable 5.1" },
];
const DEFAULT_MODEL = "claude-opus-5-5";

/** $/MTok: input, output, cache read. Cache writes bill at 1.25× input. */
const PRICES: Record<string, [number, number, number]> = {
	"claude-opus-5-5": [4, 20, 0.2],
	"claude-sonnet-5-5": [2, 10, 0.2],
	"claude-haiku-5-5": [0.1, 0.5, 0.01],
	"claude-fable-5-1": [10, 50, 0.25],
};

/** Models that accept the "default" server-side fallback chain on the Claude API. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

const MAX_STEPS = 16;
const MAX_JSON_RETRIES = 2;

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

function hasCredentials() {
	return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function client() {
	// A host Claude Code session exports ANTHROPIC_BASE_URL for its own proxy; don't inherit it.
	return new Anthropic({ baseURL: process.env.CLAUDECODE ? "https://api.anthropic.com" : undefined });
}

function cost(model: string, u: Anthropic.Beta.BetaUsage): number | undefined {
	const p = PRICES[model];
	if (!p) return undefined;
	const cacheWrite = u.cache_creation_input_tokens ?? 0;
	const cacheRead = u.cache_read_input_tokens ?? 0;
	return (u.input_tokens * p[0] + cacheWrite * p[0] * 1.25 + cacheRead * p[2] + u.output_tokens * p[1]) / 1e6;
}

export const anthropic: Provider = {
	id: "anthropic",
	async status(): Promise<ProviderStatus> {
		return {
			id: "anthropic",
			label: "Claude API",
			available: hasCredentials(),
			detail: hasCredentials() ? "Anthropic SDK · ابزارها داخل گام، با تأیید کارهای حساس" : "ANTHROPIC_API_KEY در ~/Planing/.env لازم است",
			models: MODELS,
			defaultModel: DEFAULT_MODEL,
			effort: true,
			toolsInGaam: true,
		};
	},

	async run(ctx: RunContext): Promise<RunResult> {
		const api = client();
		const model = ctx.model ?? DEFAULT_MODEL;
		const tools: Anthropic.Beta.BetaTool[] = ctx.tools.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
			eager_input_streaming: true,
		}));
		const messages: MessageParam[] = Array.isArray(ctx.native)
			? [...(ctx.native as MessageParam[])]
			: ctx.history.map((h) => ({ role: h.role, content: h.text }));
		messages.push({ role: "user", content: ctx.prompt });

		let jsonRetries = 0;
		for (let step = 0; step < MAX_STEPS; step++) {
			if (step > 0) ctx.emit({ type: "start-step" });
			const stream = api.beta.messages.stream(
				{
					model,
					max_tokens: 64000,
					system: ctx.system,
					tools,
					messages,
					thinking: { type: "adaptive", display: "summarized" },
					...(ctx.effort ? { output_config: { effort: ctx.effort } } : {}),
					cache_control: { type: "ephemeral" },
					...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
				},
				{ signal: ctx.signal },
			);

			const open = new Map<number, { kind: "text" | "reasoning" | "tool"; id: string; started: number }>();
			let message: Anthropic.Beta.BetaMessage;
			try {
				for await (const event of stream) {
					if (event.type === "content_block_start") {
						const block = event.content_block;
						if (block.type === "text") {
							const id = partId("t");
							open.set(event.index, { kind: "text", id, started: Date.now() });
							ctx.emit({ type: "text-start", id });
						} else if (block.type === "thinking") {
							const id = partId("r");
							open.set(event.index, { kind: "reasoning", id, started: Date.now() });
							ctx.emit({ type: "reasoning-start", id });
						} else if (block.type === "tool_use") {
							open.set(event.index, { kind: "tool", id: block.id, started: Date.now() });
							ctx.emit({ type: "tool-input-start", toolCallId: block.id, name: block.name });
						}
					} else if (event.type === "content_block_delta") {
						const o = open.get(event.index);
						if (!o) continue;
						if (event.delta.type === "text_delta") ctx.emit({ type: "text-delta", id: o.id, delta: event.delta.text });
						else if (event.delta.type === "thinking_delta") ctx.emit({ type: "reasoning-delta", id: o.id, delta: event.delta.thinking });
						else if (event.delta.type === "input_json_delta") ctx.emit({ type: "tool-input-delta", toolCallId: o.id, delta: event.delta.partial_json });
					} else if (event.type === "content_block_stop") {
						const o = open.get(event.index);
						if (o?.kind === "text") ctx.emit({ type: "text-end", id: o.id });
						if (o?.kind === "reasoning") ctx.emit({ type: "reasoning-end", id: o.id, ms: Date.now() - o.started });
					}
				}
				message = await stream.finalMessage();
				jsonRetries = 0;
			} catch (error) {
				// Only an unparseable eager tool input is retried; API errors and aborts surface to the caller.
				if (error instanceof Anthropic.APIError || ctx.signal.aborted || jsonRetries++ >= MAX_JSON_RETRIES) throw error;
				continue;
			}

			ctx.emit({
				type: "usage",
				usage: {
					input: message.usage.input_tokens,
					output: message.usage.output_tokens,
					cacheRead: message.usage.cache_read_input_tokens ?? 0,
					cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
					costUsd: cost(model, message.usage),
				},
			});

			if (message.stop_reason === "refusal") {
				messages.push({ role: "assistant", content: message.content });
				ctx.emit({ type: "error", error: "مدل این درخواست را رد کرد." });
				return { native: messages, finish: "refusal" };
			}
			if (message.stop_reason === "pause_turn") {
				messages.push({ role: "assistant", content: message.content });
				continue;
			}
			const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
			if (message.stop_reason === "max_tokens" && toolUses.length) {
				// A truncated tool input can still parse; never run it.
				ctx.emit({ type: "error", error: "ورودی یک ابزار نصفه ماند (سقف توکن). دوباره بپرس یا کوتاه‌تر بخواه." });
				return { native: messages, finish: "length" };
			}
			messages.push({ role: "assistant", content: message.content });
			if (!toolUses.length) return { native: messages, finish: message.stop_reason === "max_tokens" ? "length" : "stop" };

			const results = await Promise.all(
				toolUses.map(async (use): Promise<ToolResult> => {
					ctx.emit({ type: "tool-input-available", toolCallId: use.id, name: use.name, input: use.input });
					if (needsApproval(use.name, use.input)) {
						ctx.emit({ type: "tool-approval-request", toolCallId: use.id });
						if (!(await ctx.approve(use.id))) {
							ctx.emit({ type: "tool-denied", toolCallId: use.id });
							return { type: "tool_result", tool_use_id: use.id, is_error: true, content: "The user declined this action. Don't retry it; ask what they want instead." };
						}
					}
					const result = await ctx.tools.call(use.name, use.input);
					if (result.ok) ctx.emit({ type: "tool-output-available", toolCallId: use.id, output: result.output, ms: result.ms });
					else ctx.emit({ type: "tool-output-error", toolCallId: use.id, error: result.text, ms: result.ms });
					return { type: "tool_result", tool_use_id: use.id, content: result.text, ...(result.ok ? {} : { is_error: true }) };
				}),
			);
			// All results of one turn go back in a single user message.
			messages.push({ role: "user", content: results });
		}
		ctx.emit({ type: "error", error: "تعداد قدم‌ها به سقف رسید." });
		return { native: messages, finish: "max-steps" };
	},
};
