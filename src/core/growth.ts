import { localDay, type Planner } from "./planner.ts";
import { GaamError } from "./types.ts";

export const RELATIONS = ["manager", "report", "peer", "product", "stakeholder", "other"] as const;
export const INTERACTIONS = ["one_on_one", "help", "feedback_given", "feedback_received", "review", "kudos", "sync", "social"] as const;

export interface Person {
	id: number;
	name: string;
	role: string | null;
	team: string | null;
	relation: (typeof RELATIONS)[number];
	assessor: number;
	cadence_days: number | null;
	notes: string | null;
	jira_user: string | null;
	last_contact_at: string | null;
	created_at: string;
}

export interface Followup {
	id: number;
	person_id: number | null;
	person: string | null;
	direction: "mine" | "theirs";
	text: string;
	due: string | null;
	status: "open" | "done" | "dropped";
	doc_id: number | null;
	task_key: string | null;
	author: string;
	created_at: string;
	done_at: string | null;
}

export interface Decision {
	id: number;
	project_id: number | null;
	title: string;
	context: string | null;
	options: string | null;
	choice: string | null;
	impact: "low" | "high";
	reversible: number;
	aligned_with: string | null;
	status: "open" | "decided" | "revisited";
	decided_at: string | null;
	author: string;
	created_at: string;
}

/** Default contact rhythm by relationship, in days. */
const CADENCE: Record<Person["relation"], number> = { manager: 7, report: 7, peer: 21, product: 14, stakeholder: 30, other: 45 };

const plain = <T>(row: unknown) => ({ ...(row as object) }) as T;

/**
 * The rule from the feedback: be clear about when to decide alone and when to align.
 * Impact × reversibility decides it.
 */
export function decisionMode(impact: "low" | "high", reversible: boolean) {
	if (impact === "low") return { mode: "decide", advice: "خودت تصمیم بگیر و فقط ثبتش کن." };
	if (reversible) return { mode: "decide_and_inform", advice: "خودت تصمیم بگیر، ولی همان روز به لید و تیم خبر بده." };
	return { mode: "align_first", advice: "قبل از اجرا alignment بگیر (لید یا ذی‌نفع‌ها): پرهزینه و برگشت‌ناپذیر است." };
}

export class Growth {
	readonly p: Planner;

	constructor(p: Planner) {
		this.p = p;
	}

	// ── People ──────────────────────────────────────────────────────────────

	resolvePerson(ref: string | number): Person {
		const row =
			typeof ref === "number" || /^\d+$/.test(ref)
				? this.p.one<Person>("select * from people where id = ?", Number(ref))
				: (this.p.one<Person>("select * from people where name = ? collate nocase", ref) ??
					this.p.one<Person>("select * from people where name like ? collate nocase order by length(name) limit 1", `%${ref}%`));
		if (!row) throw new GaamError("NOT_FOUND", `Person "${ref}" not found. Call people_list or person_save first.`);
		return plain(row);
	}

	people(filter: { relation?: Person["relation"]; assessor?: boolean } = {}) {
		const rows = this.p.all<Person & { interactions: number; last_kind: string | null }>(
			`select pe.*, (select count(*) from interactions i where i.person_id = pe.id) as interactions,
				(select kind from interactions i where i.person_id = pe.id order by day desc, id desc limit 1) as last_kind
			from people pe where 1 = 1${this.p.ws("pe")} order by case relation when 'manager' then 0 when 'report' then 1 when 'peer' then 2 when 'product' then 3 else 4 end, name`,
		);
		const now = Date.now();
		return rows
			.map((r) => {
				const person = plain<Person & { interactions: number; last_kind: string | null }>(r);
				const cadence = person.cadence_days ?? CADENCE[person.relation];
				const since = person.last_contact_at ? Math.floor((now - Date.parse(person.last_contact_at)) / 864e5) : null;
				return { ...person, cadence, days_since: since, overdue: since == null ? true : since > cadence };
			})
			.filter((r) => (filter.relation ? r.relation === filter.relation : true) && (filter.assessor === undefined ? true : Boolean(r.assessor) === filter.assessor));
	}

	savePerson(input: {
		id?: number;
		name?: string;
		role?: string | null;
		team?: string | null;
		relation?: Person["relation"];
		assessor?: boolean;
		cadence_days?: number | null;
		notes?: string | null;
		jira_user?: string | null;
	}) {
		const { id, assessor, ...rest } = input;
		const values = { ...rest, assessor: assessor === undefined ? undefined : assessor ? 1 : 0 };
		if (id) {
			this.p.patch("people", id, values, false);
			return this.resolvePerson(id);
		}
		if (!input.name) throw new GaamError("INVALID", "name is required");
		const existing = this.p.one<Person>("select * from people where name = ? collate nocase", input.name);
		if (existing) {
			this.p.patch("people", existing.id, values, false);
			return this.resolvePerson(existing.id);
		}
		const newId = this.p.insert("people", { ...values, workspace_id: this.p.targetWorkspace() });
		this.p.log("person.added", "person", newId, input.name);
		return this.resolvePerson(newId);
	}

	logInteraction(input: { person: string | number; kind: (typeof INTERACTIONS)[number]; note?: string | null; day?: string; goal?: number | null }) {
		const person = this.resolvePerson(input.person);
		const day = input.day ?? localDay();
		const id = this.p.insert("interactions", { person_id: person.id, day, kind: input.kind, note: input.note, goal_id: input.goal ?? null, author: this.p.actor });
		const at = new Date(`${day}T12:00:00`).toISOString();
		this.p.run("update people set last_contact_at = max(coalesce(last_contact_at, ''), ?) where id = ?", at, person.id);
		this.p.log(`people.${input.kind}`, "person", person.id, `${person.name}${input.note ? ` · ${input.note.slice(0, 100)}` : ""}`);
		return { id, person: person.name, kind: input.kind, day };
	}

	personBundle(ref: string | number) {
		const person = this.resolvePerson(ref);
		return {
			person,
			interactions: this.p
				.all("select * from interactions where person_id = ? order by day desc, id desc limit 100", person.id)
				.map((r) => plain<Record<string, unknown>>(r)),
		};
	}

	// ── Follow-ups ──────────────────────────────────────────────────────────

	followups(filter: { status?: "open" | "done" | "dropped"; person?: string | number; direction?: "mine" | "theirs" } = {}) {
		const where = [`1 = 1${this.p.ws("f")}`];
		const params: (string | number)[] = [];
		if (filter.status) {
			where.push("f.status = ?");
			params.push(filter.status);
		}
		if (filter.direction) {
			where.push("f.direction = ?");
			params.push(filter.direction);
		}
		if (filter.person !== undefined) {
			where.push("f.person_id = ?");
			params.push(this.resolvePerson(filter.person).id);
		}
		const today = localDay();
		return this.p
			.all<Record<string, unknown>>(
				`select f.*, pe.name as person from followups f left join people pe on pe.id = f.person_id
				where ${where.join(" and ")} order by case f.status when 'open' then 0 else 1 end, f.due is null, f.due, f.id desc limit 300`,
				...params,
			)
			.map((r) => {
				const row = plain<Followup>(r);
				return { ...row, overdue: row.status === "open" && row.due != null && row.due < today };
			});
	}

	saveFollowup(input: {
		id?: number;
		person?: string | number | null;
		direction?: "mine" | "theirs";
		text?: string;
		due?: string | null;
		status?: "open" | "done" | "dropped";
		task?: string | null;
		doc?: number | null;
	}) {
		const values: Record<string, unknown> = {
			direction: input.direction,
			text: input.text,
			due: input.due,
			status: input.status,
			task_key: input.task,
			doc_id: input.doc,
		};
		if (input.person !== undefined) values.person_id = input.person == null ? null : this.resolvePerson(input.person).id;
		if (input.status === "done") values.done_at = new Date().toISOString();
		let id = input.id;
		if (id) this.p.patch("followups", id, values, false);
		else {
			if (!input.text) throw new GaamError("INVALID", "text is required");
			id = this.p.insert("followups", { ...values, direction: input.direction ?? "mine", author: this.p.actor, workspace_id: this.p.targetWorkspace() });
		}
		const row = this.followups().find((f) => f.id === id)!;
		this.p.log(input.id ? `followup.${row.status}` : "followup.added", "followup", id, `${row.person ?? ""} · ${row.text.slice(0, 100)}`);
		return row;
	}

	standups(limit = 14) {
		return this.p.all<Record<string, string | null>>("select * from standups order by day desc limit ?", limit).map((r) => plain<Record<string, string | null>>(r));
	}

	// ── Decisions ───────────────────────────────────────────────────────────

	decisions(filter: { status?: Decision["status"]; project?: string | number } = {}) {
		const where: string[] = this.p.workspace == null ? [] : [`d.workspace_id = ${Number(this.p.workspace)}`];
		const params: (string | number)[] = [];
		if (filter.status) {
			where.push("d.status = ?");
			params.push(filter.status);
		}
		if (filter.project !== undefined) {
			where.push("d.project_id = ?");
			params.push(this.p.resolveProject(filter.project).id);
		}
		return this.p
			.all<Decision & { project_key: string | null }>(
				`select d.*, p.key as project_key from decisions d left join projects p on p.id = d.project_id
				${where.length ? `where ${where.join(" and ")}` : ""} order by case d.status when 'open' then 0 else 1 end, d.id desc limit 200`,
				...params,
			)
			.map((d) => {
				const row = plain<Decision & { project_key: string | null }>(d);
				return { ...row, ...decisionMode(row.impact, Boolean(row.reversible)) };
			});
	}

	saveDecision(input: {
		id?: number;
		title?: string;
		project?: string | number | null;
		context?: string | null;
		options?: string | null;
		choice?: string | null;
		impact?: "low" | "high";
		reversible?: boolean;
		aligned_with?: string | null;
		status?: Decision["status"];
	}) {
		const { id, project, reversible, ...rest } = input;
		const values: Record<string, unknown> = { ...rest };
		if (reversible !== undefined) values.reversible = reversible ? 1 : 0;
		if (project !== undefined) values.project_id = project == null ? null : this.p.resolveProject(project).id;
		if (input.status === "decided") values.decided_at = new Date().toISOString();
		let decisionId = id;
		if (decisionId) this.p.patch("decisions", decisionId, values, false);
		else {
			if (!input.title) throw new GaamError("INVALID", "title is required");
			decisionId = this.p.insert("decisions", { ...values, author: this.p.actor, workspace_id: this.p.targetWorkspace() });
		}
		const d = this.decisions().find((x) => x.id === decisionId)!;
		this.p.log(id ? `decision.${d.status}` : "decision.opened", "decision", d.id, `${d.title} · ${d.mode}`);
		return d;
	}

	// ── Stand-ups ───────────────────────────────────────────────────────────

	standup(day = localDay()) {
		const row = this.p.one<Record<string, string | null>>("select * from standups where day = ?", day);
		return row ? plain<Record<string, string | null>>(row) : { day, done: null, next: null, blockers: null, help: null };
	}

	saveStandup(input: { day?: string; done?: string | null; next?: string | null; blockers?: string | null; help?: string | null }) {
		const day = input.day ?? localDay();
		this.p.run(
			`insert into standups (day, done, next, blockers, help, author) values (?, ?, ?, ?, ?, ?)
			on conflict(day) do update set done = coalesce(excluded.done, done), next = coalesce(excluded.next, next),
				blockers = coalesce(excluded.blockers, blockers), help = coalesce(excluded.help, help),
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ')`,
			day,
			input.done ?? null,
			input.next ?? null,
			input.blockers ?? null,
			input.help ?? null,
			this.p.actor,
		);
		this.p.log("standup.saved", "standup", null, day);
		return { ...this.standup(day), text: formatStandup(this.standup(day)) };
	}

	standupStats() {
		const days = new Set(this.p.all<{ day: string }>("select day from standups").map((r) => r.day));
		let streak = 0;
		const d = new Date();
		if (!days.has(localDay(d))) d.setDate(d.getDate() - 1);
		for (let guard = 0; guard < 400; guard++) {
			const isWorkday = ![4, 5].includes(d.getDay());
			if (days.has(localDay(d))) streak++;
			else if (isWorkday) break;
			d.setDate(d.getDate() - 1);
		}
		return { streak, total: days.size };
	}

	// ── Cycle overview ──────────────────────────────────────────────────────

	cycle() {
		const goals = this.p.listGoals().filter((g) => g.source === "SFPM");
		const cycle = goals.find((g) => g.cycle)?.cycle ?? null;
		const settings = Object.fromEntries(
			this.p.all<{ key: string; value: string }>("select key, value from settings where key like 'sfpm.%'").map((r) => [r.key, r.value]),
		);
		const parse = (k: string) => (settings[k] ? JSON.parse(settings[k]!) : null);
		const people = this.people();
		return {
			cycle,
			timeline: parse("sfpm.timeline") as { stage: string; from: string; to: string }[] | null,
			history: parse("sfpm.history") as { cycle: string; tag: string; self: number; others: number }[] | null,
			feedback: parse("sfpm.feedback") as { strengths: string[]; growth: string[]; actions: string[] } | null,
			expectations: goals.filter((g) => g.kind === "expectation"),
			development: goals.filter((g) => g.kind !== "expectation"),
			people: {
				total: people.length,
				assessors: people.filter((x) => x.assessor).length,
				overdue: people.filter((x) => x.overdue && x.relation !== "other").length,
				contacted_30d: people.filter((x) => x.days_since != null && x.days_since <= 30).length,
			},
			standups: this.standupStats(),
			decisions: {
				open: this.decisions({ status: "open" }).length,
				needs_alignment: this.decisions({ status: "open" }).filter((d) => d.mode === "align_first" && !d.aligned_with).length,
			},
		};
	}
}

export function formatStandup(s: { done?: string | null; next?: string | null; blockers?: string | null; help?: string | null }) {
	return [
		`✅ انجام شد: ${s.done?.trim() || "—"}`,
		`⏭ امروز: ${s.next?.trim() || "—"}`,
		`🧱 مانع: ${s.blockers?.trim() || "ندارم"}`,
		`🙋 تصمیم/کمک لازم: ${s.help?.trim() || "ندارم"}`,
	].join("\n");
}
