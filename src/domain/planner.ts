import { MemoryService } from "../integrations/memory-service.ts";
import { Recall } from "../retrieval/recall.ts";
import { MemoryReview } from "./memory.ts";
import { Workflows, type WorkflowKind, type WorkflowAction } from "./workflows.ts";
import { type Db, tx } from "../storage/db.ts";
import {
	type Ask,
	type AskKind,
	type Comment,
	type CommentEntity,
	GaamError,
	type GaamEvent,
	type Goal,
	type GoalHorizon,
	type GoalStatus,
	type JournalEntry,
	type JournalKind,
	type Link,
	type LinkKind,
	type Memory,
	type MemoryTopic,
	type MindNode,
	type NodeKind,
	type Project,
	type ProjectStage,
	type Scope,
	type Task,
	type TaskStatus,
} from "./types.ts";

type Row = Record<string, unknown>;
type Param = string | number | null;

export interface Workspace {
	id: number;
	key: string;
	name: string;
	icon: string | null;
	color: string | null;
	kind: "work" | "personal" | "other";
	repos: string[];
	github_user: string | null;
	sort: number;
}

export interface GoalInput {
	title: string;
	workspace?: string | number | null;
	why?: string | null;
	horizon?: GoalHorizon;
	status?: GoalStatus;
	metric?: string | null;
	target?: number | null;
	current?: number | null;
	due?: string | null;
	/** Where the goal comes from, e.g. "SFPM" for company performance goals. */
	source?: string | null;
	/** Review cycle the goal belongs to, e.g. "1405-H1". */
	cycle?: string | null;
	/** SFPM item type: an expectation (what the role must deliver) or a personal-development item. */
	kind?: "expectation" | "development" | null;
}

export interface ProjectInput {
	title: string;
	workspace?: string | number | null;
	key?: string;
	goal?: number | null;
	stage?: ProjectStage;
	problem?: string | null;
	hypothesis?: string | null;
	success_metric?: string | null;
	description?: string | null;
	color?: string | null;
	jira_project?: string | null;
	repo_path?: string | null;
}

export interface TaskInput {
	title: string;
	/** Use an existing key instead of generating one, e.g. the Jira key of an imported issue. */
	key?: string;
	description?: string | null;
	status?: TaskStatus;
	scope?: Scope | null;
	priority?: number;
	impact?: number | null;
	confidence?: number | null;
	ease?: number | null;
	estimate_h?: number | null;
	due?: string | null;
	tags?: string[];
	subtasks?: TaskInput[];
}

export interface TaskPatch extends Partial<Omit<TaskInput, "subtasks" | "key">> {
	external_status?: string | null;
	external_since?: string | null;
	external_url?: string | null;
	project?: string | number | null;
	parent?: string | number | null;
	jira_key?: string | null;
	branch?: string | null;
	actual_h?: number;
	sort?: number;
}

export interface TaskFilter {
	project?: string | number;
	status?: TaskStatus[];
	scope?: Scope | "none";
	tag?: string;
	due_before?: string;
	parent?: string | number | "root";
	limit?: number;
	order?: "priority" | "due" | "updated" | "manual";
}

export interface NodeInput {
	text: string;
	kind?: NodeKind;
	note?: string | null;
	children?: NodeInput[];
}

export interface AskInput {
	question: string;
	why?: string | null;
	kind?: AskKind;
	choices?: string[] | null;
	project?: string | number | null;
	task?: string | number | null;
}

export interface JournalInput {
	day?: string;
	/** Links the entry to a goal as evidence of progress. */
	goal?: number | null;
	kind?: JournalKind;
	energy?: number | null;
	mood?: number | null;
	body?: string | null;
}

export interface DayPlanInput {
	intention?: string | null;
	top?: (string | number)[];
	reflection?: string | null;
	rating?: number | null;
}

const ORDER_BY: Record<NonNullable<TaskFilter["order"]>, string> = {
	priority: "t.priority asc, ice desc nulls last, t.due asc nulls last, t.sort asc, t.id asc",
	due: "t.due asc nulls last, t.priority asc, t.id asc",
	updated: "t.updated_at desc",
	manual: "t.sort asc, t.id asc",
};

const TASK_SELECT = `
	select t.*,
		case when t.impact is not null and t.confidence is not null and t.ease is not null
			then round(t.impact * t.confidence * t.ease / 10.0, 1) end as ice,
		p.key as project_key, p.title as project_title
	from tasks t left join projects p on p.id = t.project_id`;

const NOW = () => new Date().toISOString();

/** Calendar day in the machine's local time zone, YYYY-MM-DD. */
export function localDay(date = new Date()): string {
	return date.toLocaleDateString("en-CA");
}

function addDays(day: string, days: number): string {
	const d = new Date(`${day}T12:00:00`);
	d.setDate(d.getDate() + days);
	return localDay(d);
}

function nullify(values: Row): Record<string, Param> {
	const out: Record<string, Param> = {};
	for (const [k, v] of Object.entries(values)) out[k] = v === undefined ? null : (v as Param);
	return out;
}

function plain<T>(row: unknown): T {
	return { ...(row as object) } as T;
}

function hydrateTask(row: Row): Task {
	const task = plain<Task & { tags: unknown }>(row);
	task.tags = typeof row.tags === "string" ? JSON.parse(row.tags) : [];
	return task;
}

function hydrateAsk(row: Row): Ask {
	const ask = plain<Ask & { choices: unknown }>(row);
	ask.choices = typeof row.choices === "string" ? JSON.parse(row.choices) : null;
	return ask;
}

function deriveKey(title: string): string {
	const words = title.match(/[A-Za-z][A-Za-z0-9]*/g) ?? [];
	if (words.length === 1) return words[0]!.slice(0, 4).toUpperCase();
	return words
		.map((w) => w[0])
		.join("")
		.slice(0, 4)
		.toUpperCase();
}

export function buildTree<T extends { id: number; parent_id: number | null; children?: T[] }>(rows: T[]): T[] {
	const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] as T[] }]));
	const roots: T[] = [];
	for (const node of byId.values()) {
		const parent = node.parent_id == null ? undefined : byId.get(node.parent_id);
		if (parent) parent.children!.push(node);
		else roots.push(node);
	}
	return roots;
}

const NODE_ICON: Record<NodeKind, string> = {
	idea: "💡",
	question: "❓",
	risk: "⚠️",
	decision: "✅",
	insight: "🔎",
	data: "📊",
	option: "🔀",
	goal: "🎯",
};

export function treeToOutline(nodes: MindNode[], depth = 0): string {
	return nodes
		.map((n) => {
			const line = `${"  ".repeat(depth)}- ${NODE_ICON[n.kind]} ${n.text} [#${n.id}${n.task_id ? ` → task ${n.task_id}` : ""}]`;
			const note = n.note ? `\n${"  ".repeat(depth + 1)}> ${n.note}` : "";
			return line + note + (n.children?.length ? `\n${treeToOutline(n.children, depth + 1)}` : "");
		})
		.join("\n");
}

/**
 * The domain layer. Every write goes through here so the web UI, the HTTP API
 * and MCP agents share one set of rules and one activity log.
 */
export class Planner {
	readonly db: Db;
	readonly actor: string;
	/** Active workspace id; null means "all workspaces". */
	readonly workspace: number | null;

	constructor(db: Db, actor = "me", workspace: number | null = null) {
		this.db = db;
		this.actor = actor;
		this.workspace = workspace;
	}

	as(actor: string): Planner {
		return new Planner(this.db, actor, this.workspace);
	}

	/** The same planner scoped to one workspace (key or id), or to all with null / "all". */
	in(ref: string | number | null | undefined): Planner {
		const id = ref == null || ref === "all" || ref === "" ? null : this.resolveWorkspace(ref).id;
		return new Planner(this.db, this.actor, id);
	}

	/** SQL fragment " and <alias>.workspace_id = N" for the active workspace, or "" for all. */
	ws(alias?: string): string {
		return this.workspace == null ? "" : ` and ${alias ? `${alias}.` : ""}workspace_id = ${Number(this.workspace)}`;
	}

	/** Where new records go: an explicit workspace, else the active one, else the default. */
	targetWorkspace(explicit?: string | number | null): number {
		if (explicit != null && explicit !== "") return this.resolveWorkspace(explicit).id;
		if (this.workspace != null) return this.workspace;
		const def = this.one<{ value: string }>("select value from settings where key = 'workspace.default'")?.value;
		return def ? this.resolveWorkspace(def).id : 1;
	}

	// ── Workspaces ───────────────────────────────────────────────────────────

	resolveWorkspace(ref: string | number): Workspace {
		const row =
			typeof ref === "number" || /^\d+$/.test(ref)
				? this.one<Row>("select * from workspaces where id = ?", Number(ref))
				: this.one<Row>("select * from workspaces where key = ? collate nocase or name = ?", ref, ref);
		if (!row) throw new GaamError("NOT_FOUND", `Workspace "${ref}" does not exist. Call workspace_list.`);
		return { ...plain<Workspace>(row), repos: JSON.parse(row.repos as string) };
	}

	listWorkspaces() {
		const since = new Date(Date.now() - 7 * 864e5).toISOString();
		return this.all<Row>(
			`select w.*,
				(select count(*) from projects p where p.workspace_id = w.id and p.stage not in ('archived','shipped')) as projects,
				(select count(*) from tasks t where t.workspace_id = w.id and t.status in ('todo','doing','blocked','inbox') and t.parent_id is null) as open_tasks,
				(select count(*) from tasks t where t.workspace_id = w.id and t.status = 'doing') as doing,
				(select count(*) from tasks t where t.workspace_id = w.id and t.done_at >= ?) as done_week,
				(select coalesce(sum(f.minutes), 0) from focus_sessions f join tasks t on t.id = f.task_id where t.workspace_id = w.id and f.started_at >= ?) as focus_week,
				(select count(*) from tasks t where t.workspace_id = w.id and t.due < date('now','localtime') and t.status not in ('done','dropped')) as overdue
			from workspaces w order by w.sort, w.id`,
			since,
			since,
		).map((r) => ({
			...plain<Workspace & { projects: number; open_tasks: number; doing: number; done_week: number; focus_week: number; overdue: number }>(r),
			repos: JSON.parse(r.repos as string) as string[],
		}));
	}

	saveWorkspace(input: { id?: number; key?: string; name?: string; icon?: string | null; color?: string | null; kind?: Workspace["kind"]; repos?: string[]; github_user?: string | null }) {
		const { id, repos, ...rest } = input;
		const values: Row = { ...rest };
		if (repos) values.repos = JSON.stringify([...new Set(repos)]);
		if (id) {
			this.patch("workspaces", id, values, false);
			this.log("workspace.updated", "workspace", id, input.name ?? "");
			return this.resolveWorkspace(id);
		}
		if (!input.name) throw new GaamError("INVALID", "name is required");
		const key = (input.key ?? input.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `ws${Date.now() % 10000}`;
		const newId = this.insert("workspaces", { ...values, key, sort: this.one<{ n: number }>("select count(*) as n from workspaces")!.n });
		this.log("workspace.created", "workspace", newId, input.name);
		return this.resolveWorkspace(newId);
	}

	all<T = Row>(sql: string, ...params: Param[]): T[] {
		return this.db.prepare(sql).all(...params) as T[];
	}

	one<T = Row>(sql: string, ...params: Param[]): T | undefined {
		return this.db.prepare(sql).get(...params) as T | undefined;
	}

	run(sql: string, ...params: Param[]) {
		return this.db.prepare(sql).run(...params);
	}

	insert(table: string, values: Row): number {
		// Undefined means "use the column default", so leave those columns out.
		const data = nullify(Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)));
		const cols = Object.keys(data);
		const sql = `insert into ${table} (${cols.join(", ")}) values (${cols.map((c) => `:${c}`).join(", ")})`;
		return Number(this.db.prepare(sql).run(data).lastInsertRowid);
	}

	patch(table: string, id: number, values: Row, touch = true) {
		const data = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
		if (touch) data.updated_at = NOW();
		const cols = Object.keys(data);
		if (!cols.length) return;
		this.db
			.prepare(`update ${table} set ${cols.map((c) => `${c} = :${c}`).join(", ")} where id = :id`)
			.run(nullify({ ...data, id }));
	}

	log(action: string, entity: string | null, entityId: number | null, summary: string) {
		this.run(
			"insert into events (actor, action, entity, entity_id, summary) values (?, ?, ?, ?, ?)",
			this.actor,
			action,
			entity,
			entityId,
			summary,
		);
	}

	private nextSeq(name: string): number {
		const row = this.one<{ value: number }>(
			"insert into counters (name, value) values (?, 1) on conflict(name) do update set value = value + 1 returning value",
			name,
		);
		return row!.value;
	}

	// ── Goals ────────────────────────────────────────────────────────────────

	listGoals(status?: GoalStatus): (Goal & { projects: number; evidence: number; progress: number | null })[] {
		return this.all<Goal & { projects: number; evidence: number; progress: number | null }>(
			`select g.*,
				(select count(*) from projects p where p.goal_id = g.id) as projects,
				(select count(*) from journal j where j.goal_id = g.id) as evidence,
				case when g.target > 0 then round(100.0 * coalesce(g.current, 0) / g.target) end as progress
			from goals g where 1 = 1 ${status ? "and g.status = ?" : ""}${this.ws("g")}
			order by case g.status when 'active' then 0 when 'paused' then 1 else 2 end, g.id`,
			...(status ? [status] : []),
		).map((g) => plain(g));
	}

	goal(id: number): Goal {
		const goal = this.one<Goal>("select * from goals where id = ?", id);
		if (!goal) throw new GaamError("NOT_FOUND", `Goal ${id} does not exist.`);
		return plain(goal);
	}

	createGoal(input: GoalInput): Goal {
		const { workspace, ...rest } = input;
		const id = this.insert("goals", { ...rest, workspace_id: this.targetWorkspace(workspace) });
		this.log("goal.created", "goal", id, input.title);
		return this.goal(id);
	}

	updateGoal(id: number, patch: Partial<GoalInput>): Goal {
		const before = this.goal(id);
		this.patch("goals", id, { ...patch });
		const after = this.goal(id);
		const what =
			patch.current !== undefined && before.current !== after.current
				? `${after.title}: ${before.current ?? 0} → ${after.current}`
				: after.title;
		this.log(patch.status && patch.status !== before.status ? `goal.${patch.status}` : "goal.updated", "goal", id, what);
		return after;
	}

	/** Everything that shows progress on a goal: linked journal entries and finished work in its projects. */
	goalEvidence(id: number) {
		const goal = this.goal(id);
		return {
			goal,
			entries: this.all<JournalEntry>("select * from journal where goal_id = ? order by day desc, id desc", id).map((j) =>
				plain<JournalEntry>(j),
			),
			finished: this.all<Row>(
				`${TASK_SELECT} where p.goal_id = ? and t.status = 'done' and t.parent_id is null order by t.done_at desc limit 100`,
				id,
			).map(hydrateTask),
			projects: this.all<Row>("select key, title, stage from projects where goal_id = ?", id).map((r) => plain<Row>(r)),
		};
	}

	// ── Projects ─────────────────────────────────────────────────────────────

	resolveProject(ref: string | number): Project {
		const row =
			typeof ref === "number" || /^\d+$/.test(ref)
				? this.one<Project>("select * from projects where id = ?", Number(ref))
				: this.one<Project>("select * from projects where key = ? collate nocase", ref);
		if (!row) throw new GaamError("NOT_FOUND", `Project "${ref}" does not exist. Call project_list to see keys.`);
		return plain(row);
	}

	listProjects(stage?: ProjectStage[]) {
		const where = (stage?.length ? `where p.stage in (${stage.map(() => "?").join(",")})` : "where p.stage != 'archived'") + this.ws("p");
		return this.all(
			`select p.*, g.title as goal_title,
				count(t.id) filter (where t.parent_id is null and t.status != 'dropped') as tasks,
				count(t.id) filter (where t.parent_id is null and t.status = 'done') as done,
				count(t.id) filter (where t.status = 'doing') as doing,
				(select count(*) from asks a where a.project_id = p.id and a.status = 'open') as open_asks,
				(select count(*) from nodes n where n.project_id = p.id) as nodes
			from projects p
			left join goals g on g.id = p.goal_id
			left join tasks t on t.project_id = p.id
			${where}
			group by p.id
			order by case p.stage when 'active' then 0 when 'ready' then 1 when 'scoping' then 2
				when 'discovery' then 3 when 'idea' then 4 else 5 end, p.updated_at desc`,
			...(stage ?? []),
		).map((r) => plain<Project & Row>(r));
	}

	createProject(input: ProjectInput): Project {
		return tx(this.db, () => {
			let key = (input.key ?? deriveKey(input.title)).toUpperCase().replace(/[^A-Z0-9]/g, "");
			if (!key) key = `P${this.nextSeq("project")}`;
			let unique = key;
			for (let i = 2; this.one("select 1 from projects where key = ?", unique); i++) unique = `${key}${i}`;
			const { goal, workspace, ...rest } = input;
			const id = this.insert("projects", { ...rest, key: unique, goal_id: goal ?? null, workspace_id: this.targetWorkspace(workspace) });
			this.log("project.created", "project", id, `${unique} · ${input.title}`);
			return this.resolveProject(id);
		});
	}

	updateProject(ref: string | number, patch: Partial<Omit<ProjectInput, "key">>): Project {
		const project = this.resolveProject(ref);
		const { goal, workspace, ...rest } = patch;
		const workspaceId = workspace == null ? undefined : this.resolveWorkspace(workspace).id;
		this.patch("projects", project.id, { ...rest, goal_id: goal, workspace_id: workspaceId });
		if (workspaceId) this.run("update tasks set workspace_id = ? where project_id = ?", workspaceId, project.id);
		const summary =
			patch.stage && patch.stage !== project.stage ? `${project.key}: ${project.stage} → ${patch.stage}` : project.key;
		this.log(patch.stage ? "project.stage" : "project.updated", "project", project.id, summary);
		return this.resolveProject(project.id);
	}

	/** Everything about one project in a single read: the agent's working set. */
	projectBundle(ref: string | number) {
		const project = this.resolveProject(ref);
		const tasks = this.listTasks({ project: project.id, order: "priority", limit: 1000 });
		const nodes = this.all<MindNode>("select * from nodes where project_id = ? order by sort, id", project.id).map(
			(n) => plain<MindNode>(n),
		);
		return {
			project,
			goal: project.goal_id ? this.goal(project.goal_id) : null,
			tasks: buildTree(tasks as (Task & { children?: Task[] })[]),
			scope: {
				in: tasks.filter((t) => t.scope === "in" && !t.parent_id).map((t) => t.key),
				later: tasks.filter((t) => t.scope === "later" && !t.parent_id).map((t) => t.key),
				out: tasks.filter((t) => t.scope === "out" && !t.parent_id).map((t) => t.key),
				undecided: tasks.filter((t) => !t.scope && !t.parent_id).map((t) => t.key),
			},
			mindmap: buildTree(nodes),
			asks: this.listAsks({ project: project.id }),
			comments: this.listComments("project", project.id),
			activity: this.all<GaamEvent>(
				`select * from events where (entity = 'project' and entity_id = ?)
					or (entity = 'task' and entity_id in (select id from tasks where project_id = ?))
				order by id desc limit 30`,
				project.id,
				project.id,
			).map((e) => plain<GaamEvent>(e)),
		};
	}

	// ── Tasks ────────────────────────────────────────────────────────────────

	resolveTask(ref: string | number): Task {
		const isId = typeof ref === "number" || /^\d+$/.test(ref);
		const row = this.one<Row>(`${TASK_SELECT} where ${isId ? "t.id = ?" : "t.key = ? collate nocase"}`, isId ? Number(ref) : ref);
		if (!row) throw new GaamError("NOT_FOUND", `Task "${ref}" does not exist. Use task_list or search to find its key.`);
		return hydrateTask(row);
	}

	listTasks(filter: TaskFilter = {}): (Task & { project_key: string | null; project_title: string | null })[] {
		const where: string[] = [];
		const params: Param[] = [];
		if (filter.project !== undefined) {
			if (filter.project === "inbox") where.push("t.project_id is null");
			else {
				where.push("t.project_id = ?");
				params.push(this.resolveProject(filter.project).id);
			}
		}
		if (this.workspace != null) where.push(`t.workspace_id = ${Number(this.workspace)}`);
		if (filter.status?.length) {
			where.push(`t.status in (${filter.status.map(() => "?").join(",")})`);
			params.push(...filter.status);
		}
		if (filter.scope === "none") where.push("t.scope is null");
		else if (filter.scope) {
			where.push("t.scope = ?");
			params.push(filter.scope);
		}
		if (filter.tag) {
			where.push("exists (select 1 from json_each(t.tags) where value = ?)");
			params.push(filter.tag);
		}
		if (filter.due_before) {
			where.push("t.due is not null and t.due <= ?");
			params.push(filter.due_before);
		}
		if (filter.parent === "root") where.push("t.parent_id is null");
		else if (filter.parent !== undefined) {
			where.push("t.parent_id = ?");
			params.push(this.resolveTask(filter.parent).id);
		}
		const sql = `${TASK_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""}
			order by ${ORDER_BY[filter.order ?? "priority"]} limit ?`;
		return this.all(sql, ...params, filter.limit ?? 200).map((r) => hydrateTask(r) as Task & {
			project_key: string | null;
			project_title: string | null;
		});
	}

	createTasks(projectRef: string | number | null, items: TaskInput[], parentRef?: string | number): Task[] {
		return tx(this.db, () => {
			const project = projectRef == null ? null : this.resolveProject(projectRef);
			const parent = parentRef == null ? null : this.resolveTask(parentRef);
			const created: Task[] = [];
			const make = (item: TaskInput, parentId: number | null) => {
				const key =
					item.key ?? (project ? `${project.key}-${this.bumpProjectSeq(project.id)}` : `G-${this.nextSeq("inbox")}`);
				const { subtasks, tags, key: _key, ...rest } = item;
				const id = this.insert("tasks", {
					...rest,
					status: rest.status ?? (project ? "todo" : "inbox"),
					key,
					project_id: project?.id ?? parent?.project_id ?? null,
					workspace_id:
						(project as (Project & { workspace_id?: number }) | null)?.workspace_id ??
						(parent as (Task & { workspace_id?: number }) | null)?.workspace_id ??
						this.targetWorkspace(),
					parent_id: parentId,
					tags: JSON.stringify(tags ?? []),
					sort: Date.now() / 1000 + created.length,
				});
				this.log("task.created", "task", id, `${key} · ${item.title}`);
				created.push(this.resolveTask(id));
				for (const sub of subtasks ?? []) make(sub, id);
			};
			for (const item of items) make(item, parent?.id ?? null);
			return created;
		});
	}

	private bumpProjectSeq(projectId: number): number {
		return this.one<{ seq: number }>("update projects set seq = seq + 1 where id = ? returning seq", projectId)!.seq;
	}

	updateTask(ref: string | number, patch: TaskPatch): Task {
		return tx(this.db, () => {
			const task = this.resolveTask(ref);
			const { project, parent, tags, ...rest } = patch;
			const values: Row = { ...rest };
			if (tags) values.tags = JSON.stringify(tags);
			if (project !== undefined) {
				const target = project == null ? null : (this.resolveProject(project) as Project & { workspace_id: number });
				values.project_id = target?.id ?? null;
				if (target) values.workspace_id = target.workspace_id;
			}
			if (parent !== undefined) values.parent_id = parent == null ? null : this.resolveTask(parent).id;
			if (patch.status && patch.status !== task.status) values.done_at = patch.status === "done" ? NOW() : null;
			this.patch("tasks", task.id, values);
			const after = this.resolveTask(task.id);
			if (patch.status && patch.status !== task.status) {
				this.log(`task.${patch.status}`, "task", task.id, `${task.key} · ${task.title}`);
				if (patch.status === "done") this.completeParentIfDone(after);
			} else if (patch.scope !== undefined && patch.scope !== task.scope) {
				this.log("task.scoped", "task", task.id, `${task.key} → ${patch.scope ?? "undecided"}`);
			} else {
				this.log("task.updated", "task", task.id, `${task.key} · ${Object.keys(patch).join(", ")}`);
			}
			return after;
		});
	}

	private completeParentIfDone(task: Task) {
		if (!task.parent_id) return;
		const open = this.one<{ n: number }>(
			"select count(*) as n from tasks where parent_id = ? and status not in ('done','dropped')",
			task.parent_id,
		)!.n;
		if (open === 0) this.log("task.ready", "task", task.parent_id, "All subtasks done — parent can be closed.");
	}

	deleteTask(ref: string | number) {
		const task = this.resolveTask(ref);
		this.run("delete from tasks where id = ?", task.id);
		this.log("task.deleted", "task", task.id, `${task.key} · ${task.title}`);
		return { deleted: task.key };
	}

	taskBundle(ref: string | number) {
		const task = this.resolveTask(ref);
		return {
			task,
			subtasks: this.listTasks({ parent: task.id, order: "manual" }),
			comments: this.listComments("task", task.id),
			links: this.all<Link>("select * from links where task_id = ? order by created_at desc", task.id).map((l) =>
				plain<Link>(l),
			),
			asks: this.all<Row>("select * from asks where task_id = ? order by id desc", task.id).map(hydrateAsk),
			focus_minutes:
				this.one<{ m: number }>("select coalesce(sum(minutes), 0) as m from focus_sessions where task_id = ?", task.id)
					?.m ?? 0,
		};
	}

	linkTask(ref: string | number, link: { kind: LinkKind; ref: string; url?: string | null; title?: string | null }) {
		const task = this.resolveTask(ref);
		this.run(
			`insert into links (task_id, kind, ref, url, title) values (?, ?, ?, ?, ?)
			on conflict(task_id, kind, ref) do update set url = excluded.url, title = excluded.title`,
			task.id,
			link.kind,
			link.ref,
			link.url ?? null,
			link.title ?? null,
		);
		if (link.kind === "jira" && !task.jira_key) this.patch("tasks", task.id, { jira_key: link.ref });
		this.log("task.linked", "task", task.id, `${task.key} ↔ ${link.kind} ${link.ref}`);
		return this.taskBundle(task.id).links;
	}

	// ── Mind map ─────────────────────────────────────────────────────────────

	addNodes(projectRef: string | number, items: NodeInput[], parentId?: number | null): MindNode[] {
		return tx(this.db, () => {
			const project = this.resolveProject(projectRef);
			if (parentId != null) this.node(parentId, project.id);
			const created: MindNode[] = [];
			const add = (item: NodeInput, parent: number | null, index: number) => {
				const id = this.insert("nodes", {
					project_id: project.id,
					parent_id: parent,
					text: item.text,
					kind: item.kind ?? "idea",
					note: item.note,
					sort: index,
				});
				created.push(this.node(id));
				item.children?.forEach((child, i) => add(child, id, i));
			};
			items.forEach((item, i) => add(item, parentId ?? null, Date.now() / 1000 + i));
			this.log("mindmap.grew", "project", project.id, `${project.key}: +${created.length} nodes`);
			return created;
		});
	}

	node(id: number, projectId?: number): MindNode {
		const node = this.one<MindNode>("select * from nodes where id = ?", id);
		if (!node || (projectId && node.project_id !== projectId))
			throw new GaamError("NOT_FOUND", `Mind map node #${id} does not exist${projectId ? " in this project" : ""}.`);
		return plain(node);
	}

	updateNode(id: number, patch: { text?: string; kind?: NodeKind; note?: string | null; parent?: number | null }) {
		const node = this.node(id);
		if (patch.parent === id) throw new GaamError("INVALID", "A node cannot be its own parent.");
		this.patch("nodes", id, { text: patch.text, kind: patch.kind, note: patch.note, parent_id: patch.parent }, false);
		this.log("mindmap.edited", "project", node.project_id, `#${id} ${patch.text ?? node.text}`);
		return this.node(id);
	}

	deleteNode(id: number) {
		const node = this.node(id);
		this.run("delete from nodes where id = ?", id);
		this.log("mindmap.pruned", "project", node.project_id, `#${id} ${node.text}`);
		return { deleted: id };
	}

	/** Turns a mind-map node into a real task and remembers the link. */
	nodeToTask(id: number, extra: Partial<TaskInput> = {}): Task {
		return tx(this.db, () => {
			const node = this.node(id);
			if (node.task_id) return this.resolveTask(node.task_id);
			const [task] = this.createTasks(node.project_id, [{ title: node.text, description: node.note, ...extra }]);
			this.patch("nodes", id, { task_id: task!.id }, false);
			return task!;
		});
	}

	mindmap(projectRef: string | number) {
		const project = this.resolveProject(projectRef);
		const nodes = this.all<MindNode>("select * from nodes where project_id = ? order by sort, id", project.id).map(
			(n) => plain<MindNode>(n),
		);
		const tree = buildTree(nodes);
		return { project: { key: project.key, title: project.title }, tree, outline: treeToOutline(tree) };
	}

	// ── Asks: questions and data requests for the human ──────────────────────

	ask(items: AskInput[]): Ask[] {
		return tx(this.db, () =>
			items.map((item) => {
				const id = this.insert("asks", {
					question: item.question,
					why: item.why,
					kind: item.kind ?? (item.choices?.length ? "choice" : "text"),
					choices: item.choices?.length ? JSON.stringify(item.choices) : null,
					project_id: item.project == null ? null : this.resolveProject(item.project).id,
					task_id: item.task == null ? null : this.resolveTask(item.task).id,
					asked_by: this.actor,
				});
				this.log("ask.created", "ask", id, item.question);
				return this.getAsk(id);
			}),
		);
	}

	getAsk(id: number): Ask {
		const row = this.one<Row>("select * from asks where id = ?", id);
		if (!row) throw new GaamError("NOT_FOUND", `Ask #${id} does not exist.`);
		return hydrateAsk(row);
	}

	answerAsk(id: number, answer: string | null): Ask {
		this.getAsk(id);
		this.run(
			"update asks set answer = ?, status = ?, answered_at = ? where id = ?",
			answer,
			answer == null ? "skipped" : "answered",
			NOW(),
			id,
		);
		this.log(answer == null ? "ask.skipped" : "ask.answered", "ask", id, answer ?? "");
		return this.getAsk(id);
	}

	listAsks(filter: { status?: Ask["status"]; project?: string | number; since?: string } = {}): Ask[] {
		const where: string[] = [];
		const params: Param[] = [];
		if (filter.status) {
			where.push("status = ?");
			params.push(filter.status);
		}
		if (filter.project !== undefined) {
			where.push("project_id = ?");
			params.push(this.resolveProject(filter.project).id);
		}
		if (filter.since) {
			where.push("coalesce(answered_at, created_at) >= ?");
			params.push(filter.since);
		}
		return this.all<Row>(
			`select * from asks ${where.length ? `where ${where.join(" and ")}` : ""}
			order by case status when 'open' then 0 else 1 end, id desc limit 200`,
			...params,
		).map(hydrateAsk);
	}

	// ── Comments ─────────────────────────────────────────────────────────────

	private entityId(entity: CommentEntity, ref: string | number): number {
		if (entity === "task") return this.resolveTask(ref).id;
		if (entity === "project") return this.resolveProject(ref).id;
		if (entity === "goal") return this.goal(Number(ref)).id;
		return this.node(Number(ref)).id;
	}

	comment(entity: CommentEntity, ref: string | number, body: string): Comment {
		const entityId = this.entityId(entity, ref);
		const id = this.insert("comments", { entity, entity_id: entityId, author: this.actor, body });
		this.log("comment.added", entity, entityId, body.slice(0, 140));
		return plain(this.one("select * from comments where id = ?", id));
	}

	listComments(entity: CommentEntity, ref: string | number): Comment[] {
		return this.all<Comment>(
			"select * from comments where entity = ? and entity_id = ? order by id",
			entity,
			this.entityId(entity, ref),
		).map((c) => plain<Comment>(c));
	}

	// ── Journal, day plans, focus ────────────────────────────────────────────

	addJournal(input: JournalInput): JournalEntry {
		const { goal, ...rest } = input;
		if (goal != null) this.goal(goal);
		const id = this.insert("journal", {
			...rest,
			goal_id: goal ?? null,
			day: input.day ?? localDay(),
			kind: input.kind ?? "note",
			author: this.actor,
		});
		const entry = plain<JournalEntry>(this.one("select * from journal where id = ?", id));
		this.log(`journal.${entry.kind}`, "journal", id, entry.body?.slice(0, 140) ?? `energy ${entry.energy} · mood ${entry.mood}`);
		return entry;
	}

	listJournal(from: string, to = localDay()): JournalEntry[] {
		return this.all<JournalEntry>("select * from journal where day between ? and ? order by day desc, id desc", from, to).map(
			(j) => plain<JournalEntry>(j),
		);
	}

	day(day = localDay()) {
		const plan = this.one<Row>("select * from day_plans where day = ?", day);
		const topIds: number[] = plan ? JSON.parse(plan.top as string) : [];
		const top = topIds.flatMap((id) => {
			try {
				return [this.resolveTask(id)];
			} catch {
				return [];
			}
		});
		return {
			day,
			intention: (plan?.intention as string | null) ?? null,
			reflection: (plan?.reflection as string | null) ?? null,
			rating: (plan?.rating as number | null) ?? null,
			top,
			journal: this.listJournal(day, day),
			completed: this.all<Row>(`${TASK_SELECT} where t.done_at >= ? and t.done_at < ? order by t.done_at`,
				new Date(`${day}T00:00:00`).toISOString(),
				new Date(`${addDays(day, 1)}T00:00:00`).toISOString(),
			).map(hydrateTask),
			focus_minutes:
				this.one<{ m: number }>(
					"select coalesce(sum(minutes), 0) as m from focus_sessions where started_at >= ? and started_at < ?",
					new Date(`${day}T00:00:00`).toISOString(),
					new Date(`${addDays(day, 1)}T00:00:00`).toISOString(),
				)?.m ?? 0,
			running_focus: this.runningFocus(),
		};
	}

	planDay(day: string = localDay(), input: DayPlanInput) {
		const top = input.top?.map((ref) => this.resolveTask(ref).id);
		this.run(
			`insert into day_plans (day, intention, top, reflection, rating) values (?, ?, ?, ?, ?)
			on conflict(day) do update set
				intention = coalesce(excluded.intention, intention),
				top = case when ? then excluded.top else top end,
				reflection = coalesce(excluded.reflection, reflection),
				rating = coalesce(excluded.rating, rating),
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ')`,
			day,
			input.intention ?? null,
			JSON.stringify(top ?? []),
			input.reflection ?? null,
			input.rating ?? null,
			top ? 1 : 0,
		);
		this.log(input.reflection || input.rating ? "day.reviewed" : "day.planned", "day", null, day);
		return this.day(day);
	}

	runningFocus() {
		const row = this.one<Row>(
			`select f.*, t.key as task_key, t.title as task_title from focus_sessions f
			left join tasks t on t.id = f.task_id where f.ended_at is null order by f.id desc limit 1`,
		);
		return row ? plain<Row>(row) : null;
	}

	startFocus(taskRef?: string | number | null) {
		this.stopFocus();
		const task = taskRef == null ? null : this.resolveTask(taskRef);
		const id = this.insert("focus_sessions", { task_id: task?.id ?? null, started_at: NOW() });
		if (task && task.status !== "doing" && task.status !== "done") this.updateTask(task.id, { status: "doing" });
		this.log("focus.started", "task", task?.id ?? null, task ? `${task.key} · ${task.title}` : "free focus");
		return { id, task: task?.key ?? null };
	}

	stopFocus(note?: string) {
		const running = this.runningFocus();
		if (!running) return null;
		const minutes = Math.max(0, (Date.now() - Date.parse(running.started_at as string)) / 60000);
		this.run("update focus_sessions set ended_at = ?, minutes = ?, note = ? where id = ?", NOW(), minutes, note ?? null, running.id as number);
		if (running.task_id) this.run("update tasks set actual_h = actual_h + ? where id = ?", minutes / 60, running.task_id as number);
		this.log("focus.stopped", "task", (running.task_id as number) ?? null, `${Math.round(minutes)} min${running.task_key ? ` on ${running.task_key}` : ""}`);
		return { minutes: Math.round(minutes), task: running.task_key ?? null };
	}

	logFocus(taskRef: string | number | null, minutes: number, note?: string) {
		const task = taskRef == null ? null : this.resolveTask(taskRef);
		const started = new Date(Date.now() - minutes * 60000).toISOString();
		this.insert("focus_sessions", { task_id: task?.id ?? null, started_at: started, ended_at: NOW(), minutes, note });
		if (task) this.run("update tasks set actual_h = actual_h + ? where id = ?", minutes / 60, task.id);
		this.log("focus.logged", "task", task?.id ?? null, `${minutes} min${task ? ` on ${task.key}` : ""}`);
		return { minutes, task: task?.key ?? null };
	}

	// ── Memory: what agents know about the human ─────────────────────────────

	remember(topic: MemoryTopic, fact: string, source?: string): Memory {
		const existing = this.one<Memory>("select * from memories where fact = ? collate nocase", fact);
		if (existing) return plain(existing);
		const id = this.insert("memories", { topic, fact, source: source ?? this.actor });
		this.log("memory.learned", "memory", id, fact);
		return plain(this.one("select * from memories where id = ?", id));
	}

	updateMemory(id: number, patch: { topic?: MemoryTopic; fact?: string; source?: string }): Memory {
		if (!this.one("select 1 from memories where id = ?", id)) throw new GaamError("NOT_FOUND", `Memory #${id} does not exist.`);
		tx(this.db, () => {
			const now = NOW();
			this.run("update memory_history set valid_until=? where memory_id=? and valid_until is null", now, id);
			this.patch("memories", id, { ...patch });
			const revised = this.one<Memory>("select * from memories where id=?", id)!;
			this.insert("memory_history", { memory_id: id, fact: revised.fact, topic: revised.topic, source: revised.source, valid_from: now, actor: this.actor });
			this.log("memory.revised", "memory", id, patch.fact ?? "");
		});
		return plain(this.one("select * from memories where id = ?", id));
	}

	forget(id: number) {
		const memory = this.one<Memory>("select * from memories where id = ?", id);
		if (!memory) throw new GaamError("NOT_FOUND", `Memory #${id} does not exist.`);
		this.run("delete from memories where id = ?", id);
		this.log("memory.forgotten", "memory", id, memory.fact);
		return { forgotten: id };
	}

	listMemories(topic?: MemoryTopic): Memory[] {
		return this.all<Memory>(
			`select * from memories ${topic ? "where topic = ?" : ""} order by topic, updated_at desc`,
			...(topic ? [topic] : []),
		).map((m) => plain<Memory>(m));
	}


	memoryServiceStatus() { return new MemoryService(this).status(); }
	memoryExtract(text: string, source: string) { return new MemoryService(this).extract(text, source); }
	graphPublish(source: string) { return new MemoryService(this).graphPublish(source); }
	graphSearch(query: string) { return new MemoryService(this).graphSearch(query); }
	aiTraces() { return this.all(`select * from ai_traces where 1=1${this.ws()} order by created_at desc limit 30`).map((r) => ({ ...r, detail: JSON.parse(String(r.detail)) })); }

	memoryPropose(input: Parameters<MemoryReview["propose"]>[0]) { return new MemoryReview(this).propose(input); }
	memoryProposals() { return new MemoryReview(this).list(); }
	memoryReview(id: number, accept: boolean) { return new MemoryReview(this).review(id, accept); }
	memoryHistory(id: number) {
		if (!this.one("select 1 from memories where id=?", id)) throw new GaamError("NOT_FOUND", "Memory not found. Call memory_list.");
		return this.all("select * from memory_history where memory_id=? order by id", id).map((r) => ({ ...r }));
	}
	recallSearch(query: string, limit = 8) { return new Recall(this).search(query, limit); }
	recallSource(id: string) { return new Recall(this).source(id); }
	recallStatus() { return new Recall(this).status(); }
	recallReindex() { return new Recall(this).reindex(); }
	workflowCreate(input: { kind: WorkflowKind; title: string; query: string }) { return new Workflows(this).create(input); }
	workflowGet(id: number) { return new Workflows(this).get(id); }
	workflowList() { return new Workflows(this).list(); }
	workflowAdvance(id: number, action: WorkflowAction, draft?: string) { return new Workflows(this).advance(id, action, draft); }

	// ── Search and activity ──────────────────────────────────────────────────

	search(query: string, limit = 20) {
		const terms = query
			.replace(/["*():^]/g, " ")
			.split(/\s+/)
			.filter(Boolean)
			.map((t) => `"${t}"*`);
		if (!terms.length) return [];
		return this.all<Row>(
			`select entity, entity_id, title, snippet(search, 3, '«', '»', '…', 12) as snippet
			from search where search match ? order by rank limit ?`,
			terms.join(" "),
			limit,
		).map((r) => plain<{ entity: string; entity_id: number; title: string; snippet: string }>(r));
	}

	events(sinceId = 0, limit = 50): GaamEvent[] {
		return this.all<GaamEvent>(
			sinceId ? "select * from events where id > ? order by id asc limit ?" : "select * from (select * from events order by id desc limit ?) order by id asc",
			...(sinceId ? [sinceId, limit] : [limit]),
		).map((e) => plain<GaamEvent>(e));
	}

	lastEventId(): number {
		return this.one<{ id: number }>("select coalesce(max(id), 0) as id from events")!.id;
	}
}
