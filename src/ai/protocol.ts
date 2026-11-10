/**
 * The chat stream protocol, shared by the server and the web UI.
 *
 * Every provider (Anthropic API, Claude Code, Codex, Ollama) turns its own
 * stream into these events. A message is the fold of its events into parts,
 * so the server persists exactly what the UI rendered and a reconnecting
 * client can replay from any sequence number. Pure TypeScript: no Node APIs.
 */

export type ToolState = "input-streaming" | "input-available" | "approval-requested" | "output-available" | "output-error" | "denied";

export type Part =
	| { type: "text"; id: string; text: string }
	| { type: "reasoning"; id: string; text: string; ms?: number }
	| {
			type: "tool";
			toolCallId: string;
			name: string;
			state: ToolState;
			inputText?: string;
			input?: unknown;
			output?: unknown;
			error?: string;
			ms?: number;
	  }
	| { type: "step" }
	| { type: "error"; text: string };

export interface Usage {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	costUsd?: number;
}

export type ChatEvent =
	| { type: "start"; messageId: number; provider: string; model: string | null }
	| { type: "text-start"; id: string }
	| { type: "text-delta"; id: string; delta: string }
	| { type: "text-end"; id: string }
	| { type: "reasoning-start"; id: string }
	| { type: "reasoning-delta"; id: string; delta: string }
	| { type: "reasoning-end"; id: string; ms?: number }
	| { type: "tool-input-start"; toolCallId: string; name: string }
	| { type: "tool-input-delta"; toolCallId: string; delta: string }
	| { type: "tool-input-available"; toolCallId: string; name: string; input: unknown }
	| { type: "tool-approval-request"; toolCallId: string }
	| { type: "tool-denied"; toolCallId: string }
	| { type: "tool-output-available"; toolCallId: string; output: unknown; ms?: number }
	| { type: "tool-output-error"; toolCallId: string; error: string; ms?: number }
	| { type: "start-step" }
	| { type: "usage"; usage: Usage }
	| { type: "error"; error: string }
	| { type: "finish"; reason: "stop" | "error" | "aborted" | "max-steps" | "refusal" | "length"; ms: number };

export interface AssistantMessage {
	parts: Part[];
	usage?: Usage;
	provider?: string;
	model?: string | null;
	finish?: Extract<ChatEvent, { type: "finish" }>["reason"];
	ms?: number;
}

function tool(message: AssistantMessage, id: string) {
	return message.parts.find((p): p is Extract<Part, { type: "tool" }> => p.type === "tool" && p.toolCallId === id);
}

/** Folds one event into a message. Mutates and returns it, so it works with Solid stores (via produce) and plain objects. */
export function applyEvent(message: AssistantMessage, event: ChatEvent): AssistantMessage {
	switch (event.type) {
		case "start":
			message.provider = event.provider;
			message.model = event.model;
			break;
		case "text-start":
			message.parts.push({ type: "text", id: event.id, text: "" });
			break;
		case "text-delta": {
			const part = message.parts.findLast((p) => p.type === "text" && p.id === event.id) as Extract<Part, { type: "text" }> | undefined;
			if (part) part.text += event.delta;
			else message.parts.push({ type: "text", id: event.id, text: event.delta });
			break;
		}
		case "reasoning-start":
			message.parts.push({ type: "reasoning", id: event.id, text: "" });
			break;
		case "reasoning-delta": {
			const part = message.parts.findLast((p) => p.type === "reasoning" && p.id === event.id) as Extract<Part, { type: "reasoning" }> | undefined;
			if (part) part.text += event.delta;
			else message.parts.push({ type: "reasoning", id: event.id, text: event.delta });
			break;
		}
		case "reasoning-end": {
			const part = message.parts.findLast((p) => p.type === "reasoning" && p.id === event.id) as Extract<Part, { type: "reasoning" }> | undefined;
			if (part) part.ms = event.ms;
			break;
		}
		case "tool-input-start":
			if (!tool(message, event.toolCallId)) message.parts.push({ type: "tool", toolCallId: event.toolCallId, name: event.name, state: "input-streaming", inputText: "" });
			break;
		case "tool-input-delta": {
			const t = tool(message, event.toolCallId);
			if (t) t.inputText = (t.inputText ?? "") + event.delta;
			break;
		}
		case "tool-input-available": {
			const t = tool(message, event.toolCallId);
			if (t) Object.assign(t, { input: event.input, state: "input-available", inputText: undefined });
			else message.parts.push({ type: "tool", toolCallId: event.toolCallId, name: event.name, state: "input-available", input: event.input });
			break;
		}
		case "tool-approval-request": {
			const t = tool(message, event.toolCallId);
			if (t) t.state = "approval-requested";
			break;
		}
		case "tool-denied": {
			const t = tool(message, event.toolCallId);
			if (t) t.state = "denied";
			break;
		}
		case "tool-output-available": {
			const t = tool(message, event.toolCallId);
			if (t) Object.assign(t, { output: event.output, state: "output-available", ms: event.ms });
			break;
		}
		case "tool-output-error": {
			const t = tool(message, event.toolCallId);
			if (t) Object.assign(t, { error: event.error, state: "output-error", ms: event.ms });
			break;
		}
		case "start-step":
			if (message.parts.length && message.parts.at(-1)?.type !== "step") message.parts.push({ type: "step" });
			break;
		case "usage": {
			const u = message.usage ?? { input: 0, output: 0 };
			message.usage = {
				input: u.input + event.usage.input,
				output: u.output + event.usage.output,
				cacheRead: (u.cacheRead ?? 0) + (event.usage.cacheRead ?? 0),
				cacheWrite: (u.cacheWrite ?? 0) + (event.usage.cacheWrite ?? 0),
				costUsd: u.costUsd != null || event.usage.costUsd != null ? (u.costUsd ?? 0) + (event.usage.costUsd ?? 0) : undefined,
			};
			break;
		}
		case "error":
			message.parts.push({ type: "error", text: event.error });
			break;
		case "finish":
			message.finish = event.reason;
			message.ms = event.ms;
			for (const p of message.parts) if (p.type === "tool" && (p.state === "input-streaming" || p.state === "input-available" || p.state === "approval-requested")) p.state = "denied";
			break;
	}
	return message;
}

/** Plain text of a message, for search, previews and CLI providers that replay text history. */
export function messageText(message: Pick<AssistantMessage, "parts">): string {
	return message.parts
		.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
		.map((p) => p.text)
		.join("\n\n")
		.trim();
}

/** What the user attached to a message: mentioned entities, the page they were on, uploaded docs. */
export type ContextRef =
	| { type: "task"; ref: string; label?: string }
	| { type: "project"; ref: string; label?: string }
	| { type: "person"; ref: string; label?: string }
	| { type: "doc"; ref: number; label?: string }
	| { type: "goal"; ref: number; label?: string }
	| { type: "page"; route: string; label?: string };
