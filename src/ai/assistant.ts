import type { Db } from "../core/db.ts";
import { localDay } from "../core/planner.ts";
import { GaamError, PROVIDERS, type ProviderId } from "../core/types.ts";
import { friendlyError, PROVIDER_IMPLS, providerStatus, type RunEvent } from "./providers.ts";
import { AiStore } from "./store.ts";

const SYSTEM = (unattended: boolean) => `You are Gaam's built-in assistant, running inside the Gaam (گام) web app. The user is looking at the app right now and sees every change you make live.

- You have the gaam MCP tools: use them to read and change the user's planner. Act, don't just advise — create the tasks, write the mind map, score, scope, plan the day.
- Call gaam_context first when you need the current state, and gaam_guide if you are unsure how Gaam works.
- Reply in Persian, short and concrete, in Markdown (headings, short lists, **bold**). Mention task keys like SRCH-3 so the user can click them.
- Today is ${localDay()} (${new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "full" }).format(new Date())}).
${
	unattended
		? "- This is an UNATTENDED scheduled run. Nobody will answer you now. Never ask questions in your reply; if you need input, create asks with ask_user. End with a short summary of what you did and what needs the user's attention."
		: "- If something important is unclear, ask one short question in your reply, or use ask_user for things the user can answer later."
}`;

interface Live {
	text: string;
	tools: string[];
	running: boolean;
	error: string | null;
	listeners: Set<(event: LiveEvent) => void>;
	controller: AbortController;
}

export type LiveEvent = RunEvent | { type: "done"; error: string | null };

/** Runs conversations with Claude Code, Codex or Ollama and streams them to the UI. */
export class Assistant {
	readonly store: AiStore;
	readonly db: Db;
	private live = new Map<number, Live>();

	constructor(db: Db) {
		this.db = db;
		this.store = new AiStore(db);
	}

	async resolveProvider(requested?: string | null): Promise<ProviderId> {
		const wanted = (requested ?? this.store.settings().provider ?? "claude") as ProviderId;
		if (!PROVIDERS.includes(wanted)) throw new GaamError("INVALID", `Unknown provider ${wanted}`);
		return wanted;
	}

	/** Starts a turn and returns at once; follow it with subscribe(). */
	async send(input: { thread?: number | null; text: string; provider?: string | null; model?: string | null; origin?: string; title?: string }) {
		const provider = await this.resolveProvider(input.provider);
		const settings = this.store.settings();
		const model = input.model !== undefined ? input.model : (settings[`model.${provider}`] ?? null);
		const thread = input.thread
			? this.store.thread(input.thread)
			: this.store.createThread({ title: input.title ?? input.text.split("\n")[0]!, provider, model, origin: input.origin });
		if (this.live.get(thread.id)?.running) throw new GaamError("CONFLICT", "This conversation is still running.");
		const history = this.store.thread(thread.id).messages;
		this.store.addMessage(thread.id, "user", input.text);
		const sameProvider = thread.provider === provider;
		this.store.updateThread(thread.id, { provider, model });
		const done = this.execute(thread.id, {
			provider,
			model,
			prompt: input.text,
			session: sameProvider ? thread.session : null,
			history,
			unattended: input.origin === "automation",
		});
		done.catch(() => {});
		return { thread: thread.id, done };
	}

	private async execute(
		threadId: number,
		run: { provider: ProviderId; model: string | null; prompt: string; session: string | null; history: ReturnType<AiStore["thread"]>["messages"]; unattended: boolean },
	): Promise<string> {
		const live: Live = { text: "", tools: [], running: true, error: null, listeners: new Set(), controller: new AbortController() };
		const previous = this.live.get(threadId);
		previous?.listeners.forEach((l) => live.listeners.add(l));
		this.live.set(threadId, live);
		const emit = (event: LiveEvent) => live.listeners.forEach((l) => l(event));
		const actor = `assistant:${run.provider}`;
		try {
			const result = await PROVIDER_IMPLS[run.provider].run({
				db: this.db,
				prompt: run.prompt,
				system: SYSTEM(run.unattended),
				model: run.model,
				session: run.session,
				history: run.history,
				signal: live.controller.signal,
				onEvent: (event) => {
					if (event.type === "text") live.text += event.text;
					if (event.type === "tool") live.tools.push(event.name);
					emit(event);
				},
			});
			const text = result.text.trim() || live.text.trim() || "(بدون پاسخ متنی)";
			this.store.addMessage(threadId, "assistant", text, live.tools);
			this.store.updateThread(threadId, { session: result.session ?? null });
			this.store.log(actor, "assistant.replied", text.replace(/\s+/g, " ").slice(0, 140), threadId);
			return text;
		} catch (error) {
			live.error = friendlyError(run.provider, (error as Error).message);
			this.store.addMessage(threadId, "error", live.error, live.tools);
			this.store.log(actor, "assistant.failed", live.error.slice(0, 140), threadId);
			throw error;
		} finally {
			live.running = false;
			emit({ type: "done", error: live.error });
		}
	}

	subscribe(threadId: number, listener: (event: LiveEvent) => void) {
		let live = this.live.get(threadId);
		if (!live) {
			live = { text: "", tools: [], running: false, error: null, listeners: new Set(), controller: new AbortController() };
			this.live.set(threadId, live);
		}
		live.listeners.add(listener);
		return {
			snapshot: { text: live.text, tools: live.tools, running: live.running },
			unsubscribe: () => live.listeners.delete(listener),
		};
	}

	stop(threadId: number) {
		this.live.get(threadId)?.controller.abort();
		return { stopped: threadId };
	}

	running(): number[] {
		return [...this.live.entries()].filter(([, l]) => l.running).map(([id]) => id);
	}

	status() {
		return providerStatus().then((providers) => ({ providers, settings: this.store.settings() }));
	}
}
