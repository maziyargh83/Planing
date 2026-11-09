import type { Db } from "../core/db.ts";
import { type Automation, GaamError, type Message, type ProviderId, type Thread } from "../core/types.ts";

type Param = string | number | null;

function plain<T>(row: unknown): T {
	return { ...(row as object) } as T;
}

function hydrateMessage(row: unknown): Message {
	const m = plain<Message & { tools: unknown }>(row);
	m.tools = typeof m.tools === "string" ? JSON.parse(m.tools) : [];
	return m;
}

export interface AutomationInput {
	slug?: string;
	name: string;
	schedule: string;
	kind: Automation["kind"];
	prompt?: string | null;
	provider?: ProviderId | null;
	model?: string | null;
	enabled?: boolean;
}

/** Persistence for assistant threads, automations and settings. */
export class AiStore {
	readonly db: Db;

	constructor(db: Db) {
		this.db = db;
	}

	private one<T>(sql: string, ...params: Param[]) {
		return this.db.prepare(sql).get(...params) as T | undefined;
	}

	private all<T>(sql: string, ...params: Param[]) {
		return this.db.prepare(sql).all(...params) as T[];
	}

	log(actor: string, action: string, summary: string, entityId: number | null = null) {
		this.db
			.prepare("insert into events (actor, action, entity, entity_id, summary) values (?, ?, 'thread', ?, ?)")
			.run(actor, action, entityId, summary);
	}

	// ── Settings ────────────────────────────────────────────────────────────

	settings(): Record<string, string> {
		return Object.fromEntries(this.all<{ key: string; value: string }>("select key, value from settings").map((r) => [r.key, r.value]));
	}

	setSetting(key: string, value: string | null) {
		if (value == null) this.db.prepare("delete from settings where key = ?").run(key);
		else this.db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
		return this.settings();
	}

	// ── Threads ─────────────────────────────────────────────────────────────

	threads(limit = 50): (Thread & { last: string | null; count: number })[] {
		return this.all<Thread & { last: string | null; count: number }>(
			`select t.*, (select content from messages m where m.thread_id = t.id order by id desc limit 1) as last,
				(select count(*) from messages m where m.thread_id = t.id) as count
			from threads t order by t.updated_at desc limit ?`,
			limit,
		).map((t) => plain(t));
	}

	thread(id: number): Thread & { messages: Message[] } {
		const thread = this.one<Thread>("select * from threads where id = ?", id);
		if (!thread) throw new GaamError("NOT_FOUND", `Thread ${id} does not exist.`);
		return { ...plain<Thread>(thread), messages: this.all("select * from messages where thread_id = ? order by id", id).map(hydrateMessage) };
	}

	createThread(input: { title: string; provider: ProviderId; model?: string | null; origin?: string }): Thread {
		const { lastInsertRowid } = this.db
			.prepare("insert into threads (title, provider, model, origin) values (?, ?, ?, ?)")
			.run(input.title.slice(0, 120), input.provider, input.model ?? null, input.origin ?? "chat");
		return this.thread(Number(lastInsertRowid));
	}

	updateThread(id: number, patch: { session?: string | null; provider?: ProviderId; model?: string | null; title?: string }) {
		const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
		if (!entries.length) return;
		this.db
			.prepare(`update threads set ${entries.map(([k]) => `${k} = ?`).join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ') where id = ?`)
			.run(...(entries.map(([, v]) => v) as Param[]), id);
	}

	deleteThread(id: number) {
		this.db.prepare("delete from threads where id = ?").run(id);
		return { deleted: id };
	}

	addMessage(threadId: number, role: Message["role"], content: string, tools: string[] = []): Message {
		const { lastInsertRowid } = this.db
			.prepare("insert into messages (thread_id, role, content, tools) values (?, ?, ?, ?)")
			.run(threadId, role, content, JSON.stringify(tools));
		this.db.prepare("update threads set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ') where id = ?").run(threadId);
		return hydrateMessage(this.one("select * from messages where id = ?", Number(lastInsertRowid)));
	}

	/** The newest assistant message written by an automation, e.g. today's brief. */
	latestFrom(slug: string): (Message & { automation: string; thread_id: number }) | null {
		const row = this.one<Message & { automation: string }>(
			`select m.*, a.name as automation from automations a
			join messages m on m.thread_id = a.thread_id and m.role = 'assistant'
			where a.slug = ? order by m.id desc limit 1`,
			slug,
		);
		return row ? (hydrateMessage(row) as Message & { automation: string; thread_id: number }) : null;
	}

	// ── Automations ─────────────────────────────────────────────────────────

	automations(): Automation[] {
		return this.all<Automation>("select * from automations order by id").map((a) => plain(a));
	}

	automation(id: number): Automation {
		const row = this.one<Automation>("select * from automations where id = ?", id);
		if (!row) throw new GaamError("NOT_FOUND", `Automation ${id} does not exist.`);
		return plain(row);
	}

	saveAutomation(input: Partial<AutomationInput> & { id?: number }): Automation {
		const { id, enabled, ...rest } = input;
		const values: Record<string, Param> = Object.fromEntries(
			Object.entries(rest).filter(([, v]) => v !== undefined) as [string, Param][],
		);
		if (enabled !== undefined) values.enabled = enabled ? 1 : 0;
		if (id) {
			const cols = Object.keys(values);
			if (cols.length) this.db.prepare(`update automations set ${cols.map((c) => `${c} = :${c}`).join(", ")} where id = :id`).run({ ...values, id });
			return this.automation(id);
		}
		if (!values.name || !values.schedule || !values.kind) throw new GaamError("INVALID", "name, schedule and kind are required.");
		const cols = Object.keys(values);
		const { lastInsertRowid } = this.db
			.prepare(`insert into automations (${cols.join(", ")}) values (${cols.map((c) => `:${c}`).join(", ")})`)
			.run(values);
		return this.automation(Number(lastInsertRowid));
	}

	deleteAutomation(id: number) {
		this.db.prepare("delete from automations where id = ?").run(id);
		return { deleted: id };
	}

	markAutomation(id: number, patch: Partial<Pick<Automation, "last_run_at" | "last_status" | "last_output" | "thread_id">>) {
		const entries = Object.entries(patch);
		this.db.prepare(`update automations set ${entries.map(([k]) => `${k} = ?`).join(", ")} where id = ?`).run(...(entries.map(([, v]) => v) as Param[]), id);
	}
}
