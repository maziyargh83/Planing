import { batch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";

import { applyEvent, type AssistantMessage, type ChatEvent, type ContextRef, type Part } from "../../src/ai/protocol.ts";
import { rpc, toast, wsHeaders } from "./api.ts";

export type { ContextRef, Part };

export interface UserMessage {
	id: number;
	role: "user";
	text: string;
	context: ContextRef[];
	at: string;
}

export interface BotMessage extends AssistantMessage {
	id: number;
	role: "assistant";
	running: boolean;
	at: string;
}

export type ChatMessage = UserMessage | BotMessage;

export interface ThreadInfo {
	id: number;
	title: string;
	provider: string;
	model: string | null;
	effort: string | null;
	workspace: string | null;
}

interface ServerMessage {
	id: number;
	role: "user" | "assistant" | "error";
	content: string;
	parts: Part[];
	meta: Record<string, unknown>;
	created_at: string;
}

function fromServer(m: ServerMessage): ChatMessage {
	if (m.role === "user") return { id: m.id, role: "user", text: m.content, context: (m.meta.context as ContextRef[]) ?? [], at: m.created_at };
	// Messages from before the structured protocol only have text.
	const parts: Part[] = m.parts?.length ? m.parts : m.content ? [{ type: m.role === "error" ? "error" : "text", id: `legacy${m.id}`, text: m.content } as Part] : [];
	return {
		id: m.id,
		role: "assistant",
		parts,
		usage: m.meta.usage as BotMessage["usage"],
		provider: m.meta.provider as string | undefined,
		model: m.meta.model as string | null | undefined,
		finish: m.meta.finish as BotMessage["finish"],
		ms: m.meta.ms as number | undefined,
		running: Boolean(m.meta.running),
		at: m.created_at,
	};
}

async function post<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(path, { method: "POST", headers: wsHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
	const json = await res.json();
	if (json.error) {
		toast(json.error.message, "error");
		throw new Error(json.error.message);
	}
	return json.data as T;
}

/**
 * One conversation in the UI: loads it, streams live turns with resume-by-sequence,
 * and exposes the chat actions. State is a Solid store, folded with the same
 * applyEvent the server uses to persist.
 */
export function createChat() {
	const [state, setState] = createStore({
		thread: null as ThreadInfo | null,
		messages: [] as ChatMessage[],
		running: false,
		seq: 0,
		loading: false,
		startedAt: 0,
	});
	let source: EventSource | null = null;
	let liveId: number | null = null;
	let retry: number | undefined;

	const close = () => {
		source?.close();
		source = null;
		clearTimeout(retry);
	};

	const connect = (threadId: number) => {
		close();
		source = new EventSource(`/api/assistant/${threadId}/stream?after=${state.seq}`);
		source.addEventListener("state", (e) => {
			const s = JSON.parse((e as MessageEvent).data) as { running: boolean; messageId: number | null };
			if (!s.running && !s.messageId) {
				close();
				setState("running", false);
				return;
			}
			if (s.messageId) liveId = s.messageId;
			setState("running", s.running);
		});
		source.addEventListener("chat", (e) => {
			const { seq, event } = JSON.parse((e as MessageEvent).data) as { seq: number; event: ChatEvent };
			if (seq <= state.seq) return;
			batch(() => {
				setState("seq", seq);
				if (event.type === "start") liveId = event.messageId;
				const index = state.messages.findIndex((m) => m.id === liveId && m.role === "assistant");
				if (index < 0) {
					setState("messages", (list) => [...list, { id: liveId ?? -1, role: "assistant", parts: [], running: true, at: new Date().toISOString() }]);
				}
				const i = state.messages.findIndex((m) => m.id === liveId && m.role === "assistant");
				setState(
					"messages",
					i,
					produce((m) => {
						applyEvent(m as BotMessage, event);
						if (event.type === "finish") (m as BotMessage).running = false;
					}),
				);
				if (event.type === "finish") setState("running", false);
			});
			if (event.type === "finish") {
				close();
				void reload();
			}
		});
		source.onerror = () => {
			close();
			if (state.running) retry = window.setTimeout(() => state.thread && connect(state.thread.id), 1500);
		};
	};

	const reload = async () => {
		if (!state.thread) return;
		const t = await rpc<ThreadInfo & { messages: ServerMessage[]; running: boolean }>("thread", state.thread.id);
		setState("messages", reconcile(t.messages.map(fromServer), { key: "id" }));
		setState("thread", { id: t.id, title: t.title, provider: t.provider, model: t.model, effort: t.effort, workspace: t.workspace });
	};

	return {
		state,
		async open(threadId: number | null) {
			close();
			batch(() => {
				setState({ thread: null, messages: [], running: false, seq: 0, startedAt: 0 });
				liveId = null;
			});
			if (threadId == null) return;
			setState("loading", true);
			try {
				const t = await rpc<ThreadInfo & { messages: ServerMessage[]; running: boolean }>("thread", threadId);
				const messages = t.messages.map(fromServer);
				const live = messages.findLast((m) => m.role === "assistant" && m.running) as BotMessage | undefined;
				batch(() => {
					setState({
						thread: { id: t.id, title: t.title, provider: t.provider, model: t.model, effort: t.effort, workspace: t.workspace },
						// A live reply is rebuilt from the event stream, not from the last periodic save.
						messages: live ? messages.map((m) => (m.id === live.id ? { ...live, parts: [] } : m)) : messages,
						running: t.running,
						startedAt: live ? Date.parse(live.at) : 0,
					});
				});
				if (t.running) connect(threadId);
			} finally {
				setState("loading", false);
			}
		},
		async send(text: string, context: ContextRef[], opts: { provider: string; model: string | null; effort: string | null }) {
			const { thread, messageId } = await post<{ thread: number; messageId: number }>("/api/assistant", {
				thread: state.thread?.id ?? null,
				text,
				context,
				provider: opts.provider,
				model: opts.model,
				effort: opts.effort,
			});
			batch(() => {
				if (!state.thread) setState("thread", { id: thread, title: text.split("\n")[0]!.slice(0, 120), provider: opts.provider, model: opts.model, effort: opts.effort, workspace: null });
				setState("messages", (list) => [
					...list,
					{ id: messageId - 1, role: "user", text, context, at: new Date().toISOString() },
					{ id: messageId, role: "assistant", parts: [], running: true, at: new Date().toISOString() },
				]);
				setState({ running: true, seq: 0, startedAt: Date.now() });
				liveId = messageId;
			});
			connect(thread);
			return thread;
		},
		async regenerate(opts: { provider: string; model: string | null; effort: string | null }) {
			if (!state.thread) return;
			const { messageId } = await post<{ thread: number; messageId: number }>(`/api/assistant/${state.thread.id}/regenerate`, opts);
			const lastUser = state.messages.findLastIndex((m) => m.role === "user");
			batch(() => {
				setState("messages", (list) => [...list.slice(0, lastUser + 1), { id: messageId, role: "assistant", parts: [], running: true, at: new Date().toISOString() }]);
				setState({ running: true, seq: 0, startedAt: Date.now() });
				liveId = messageId;
			});
			connect(state.thread.id);
		},
		fork: (messageId: number) => post<{ thread: number }>(`/api/assistant/${state.thread!.id}/fork`, { messageId }).then((r) => r.thread),
		approve: (toolCallId: string, ok: boolean) => post(`/api/assistant/${state.thread!.id}/approve`, { toolCallId, ok }),
		stop: () => state.thread && post(`/api/assistant/${state.thread.id}/stop`, {}),
		dispose: close,
	};
}

export type Chat = ReturnType<typeof createChat>;
