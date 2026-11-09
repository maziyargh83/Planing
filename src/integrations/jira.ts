import type { Planner } from "../core/planner.ts";
import { GaamError, type Task, type TaskStatus } from "../core/types.ts";

/**
 * Jira Cloud (JIRA_EMAIL + API token, basic auth) or Jira Server/Data Center
 * (personal access token, bearer auth). Only JIRA_URL and JIRA_TOKEN are required.
 */
function config() {
	const url = process.env.JIRA_URL?.replace(/\/$/, "");
	const token = process.env.JIRA_TOKEN;
	if (!url || !token)
		throw new GaamError("INTEGRATION", "Jira is not configured. Set JIRA_URL and JIRA_TOKEN (plus JIRA_EMAIL for Jira Cloud).");
	const email = process.env.JIRA_EMAIL;
	const auth = email ? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` : `Bearer ${token}`;
	return { url, auth, cloud: Boolean(email), defaultProject: process.env.JIRA_PROJECT };
}

export function jiraConfigured(): boolean {
	return Boolean(process.env.JIRA_URL && process.env.JIRA_TOKEN);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
	const { url, auth } = config();
	const res = await fetch(`${url}${path}`, {
		...init,
		headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json", ...init.headers },
	});
	if (!res.ok) throw new GaamError("INTEGRATION", `Jira ${res.status} on ${path}: ${(await res.text()).slice(0, 400)}`);
	return (res.status === 204 ? null : await res.json()) as T;
}

interface JiraIssue {
	key: string;
	fields: {
		summary: string;
		status: { name: string; statusCategory: { key: "new" | "indeterminate" | "done" } };
		assignee?: { displayName: string } | null;
		priority?: { name: string } | null;
		issuetype?: { name: string };
		duedate?: string | null;
		description?: unknown;
	};
}

const FIELDS = "summary,status,assignee,priority,issuetype,duedate";

function slim(issue: JiraIssue) {
	const { url } = config();
	return {
		key: issue.key,
		summary: issue.fields.summary,
		status: issue.fields.status.name,
		category: issue.fields.status.statusCategory.key,
		assignee: issue.fields.assignee?.displayName ?? null,
		priority: issue.fields.priority?.name ?? null,
		type: issue.fields.issuetype?.name ?? null,
		due: issue.fields.duedate ?? null,
		url: `${url}/browse/${issue.key}`,
	};
}

export async function jiraSearch(jql: string, limit = 25) {
	const { cloud } = config();
	const params = new URLSearchParams({ jql, maxResults: String(limit), fields: FIELDS });
	const data = await call<{ issues: JiraIssue[] }>(`${cloud ? "/rest/api/3/search/jql" : "/rest/api/2/search"}?${params}`);
	return data.issues.map(slim);
}

export async function jiraIssue(key: string) {
	return slim(await call<JiraIssue>(`/rest/api/2/issue/${encodeURIComponent(key)}?fields=${FIELDS}`));
}

const PRIORITY_NAMES = ["Highest", "High", "Medium", "Low"];

/** Creates a Jira issue from a Gaam task and links them. Idempotent: an already linked task is returned as is. */
export async function jiraPush(p: Planner, ref: string | number, opts: { project?: string; issueType?: string } = {}) {
	const task = p.resolveTask(ref);
	if (task.jira_key) return { task: task.key, issue: await jiraIssue(task.jira_key), created: false };
	const projectKey =
		opts.project ??
		(task.project_id ? p.resolveProject(task.project_id).jira_project : null) ??
		config().defaultProject;
	if (!projectKey)
		throw new GaamError("INVALID", "No Jira project. Pass project, set jira_project on the Gaam project, or set JIRA_PROJECT.");
	const description = [task.description ?? "", "", `— created from Gaam ${task.key}`].join("\n").trim();
	const created = await call<{ key: string }>("/rest/api/2/issue", {
		method: "POST",
		body: JSON.stringify({
			fields: {
				project: { key: projectKey },
				summary: task.title,
				description,
				issuetype: { name: opts.issueType ?? "Task" },
				...(task.due ? { duedate: task.due } : {}),
				priority: { name: PRIORITY_NAMES[task.priority] },
			},
		}),
	}).catch(async (error: GaamError) => {
		// Some schemes reject priority or duedate on create; retry with the bare minimum.
		if (!/priority|duedate/i.test(error.message)) throw error;
		return call<{ key: string }>("/rest/api/2/issue", {
			method: "POST",
			body: JSON.stringify({
				fields: { project: { key: projectKey }, summary: task.title, description, issuetype: { name: opts.issueType ?? "Task" } },
			}),
		});
	});
	const issue = await jiraIssue(created.key);
	p.linkTask(task.id, { kind: "jira", ref: issue.key, url: issue.url, title: issue.summary });
	return { task: task.key, issue, created: true };
}

const CATEGORY_TO_STATUS: Record<string, TaskStatus> = { new: "todo", indeterminate: "doing", done: "done" };

/** Pulls status from Jira into every linked, unfinished task (or just one). */
export async function jiraPull(p: Planner, ref?: string | number) {
	const tasks: Task[] = ref
		? [p.resolveTask(ref)]
		: p.listTasks({ status: ["inbox", "todo", "doing", "blocked"], limit: 500 }).filter((t) => t.jira_key && !t.external_status);
	const changes: { task: string; jira: string; from: TaskStatus; to: TaskStatus }[] = [];
	for (const task of tasks) {
		if (!task.jira_key) continue;
		const issue = await jiraIssue(task.jira_key);
		const to = /block/i.test(issue.status) ? "blocked" : CATEGORY_TO_STATUS[issue.category]!;
		if (to !== task.status) {
			p.updateTask(task.id, { status: to });
			changes.push({ task: task.key, jira: issue.key, from: task.status, to });
		}
	}
	return { checked: tasks.filter((t) => t.jira_key).length, changes };
}

/** Imports Jira issues as Gaam tasks. Issues already linked to a task are skipped. */
export async function jiraImport(p: Planner, jql: string, projectRef: string | number | null, limit = 50) {
	const issues = await jiraSearch(jql, limit);
	const known = new Set(
		(p.db.prepare("select jira_key from tasks where jira_key is not null").all() as { jira_key: string }[]).map((r) => r.jira_key),
	);
	const fresh = issues.filter((i) => !known.has(i.key));
	const tasks = p.createTasks(
		projectRef,
		fresh.map((i) => ({
			title: i.summary,
			status: CATEGORY_TO_STATUS[i.category],
			due: i.due,
			priority: Math.max(0, Math.min(3, PRIORITY_NAMES.indexOf(i.priority ?? "Medium"))),
			tags: ["jira"],
		})),
	);
	tasks.forEach((t, idx) => p.linkTask(t.id, { kind: "jira", ref: fresh[idx]!.key, url: fresh[idx]!.url, title: fresh[idx]!.summary }));
	return { imported: tasks.map((t, idx) => `${t.key} ← ${fresh[idx]!.key}`), skipped: issues.length - fresh.length };
}

// ── Board sync ──────────────────────────────────────────────────────────────

export interface BoardConfig {
	board: number;
	/** JQL narrowing the board to the user's issues, usually the board's own quick filter. */
	jql: string;
	/** Gaam project the issues live in. */
	project: string;
}

/** Columns that mean the work has left engineering's hands. */
const DONE_COLUMNS = /ready to freeze|freeze|ready to release|released|done|closed|resolved/i;
const BLOCKED_COLUMNS = /block|pend/i;
const DROPPED_STATUSES = /cancel|reject|won'?t/i;
const NOT_STARTED_COLUMNS = /backlog|to ?do|open|selected/i;

export function boardStatus(column: string, category: string): TaskStatus {
	if (DROPPED_STATUSES.test(column)) return "dropped";
	if (category === "done" || DONE_COLUMNS.test(column)) return "done";
	if (BLOCKED_COLUMNS.test(column)) return "blocked";
	if (category === "new" || NOT_STARTED_COLUMNS.test(column)) return "todo";
	return "doing";
}

/** Reads a board: name, columns and quick filters, so the user can pick theirs. */
export async function jiraBoardInfo(board: number) {
	const [info, conf, edit] = await Promise.all([
		call<{ id: number; name: string; type: string }>(`/rest/agile/1.0/board/${board}`),
		call<{ columnConfig: { columns: { name: string }[] }; filter: { id: string } }>(`/rest/agile/1.0/board/${board}/configuration`),
		call<{ quickFilterConfig?: { quickFilters: { id: number; name: string; query: string }[] } }>(
			`/rest/greenhopper/1.0/rapidviewconfig/editmodel.json?rapidViewId=${board}`,
		).catch(() => ({ quickFilterConfig: { quickFilters: [] } })),
	]);
	return {
		id: info.id,
		name: info.name,
		type: info.type,
		columns: conf.columnConfig.columns.map((c) => c.name),
		quickFilters: edit.quickFilterConfig?.quickFilters.map((f) => ({ id: f.id, name: f.name, query: f.query.trim() })) ?? [],
	};
}

interface BoardIssue {
	key: string;
	fields: {
		summary: string;
		status: { name: string; statusCategory: { key: string } };
		priority?: { name: string } | null;
		issuetype?: { name: string } | null;
		duedate?: string | null;
		labels?: string[];
		description?: string | null;
		updated: string;
		resolutiondate?: string | null;
	};
}

/**
 * Mirrors the user's issues on a Jira board into a Gaam project. Jira stays the
 * source of truth for title, column, due date and priority; Gaam keeps its own
 * ICE scores, scope, notes and subtasks. Tasks keep their Jira key as Gaam key.
 */
export async function jiraBoardSync(p: Planner, cfg: BoardConfig) {
	const { url } = config();
	const project = p.resolveProject(cfg.project);
	const jql = `(${cfg.jql}) AND (statusCategory != Done OR updated >= -21d) ORDER BY Rank ASC`;
	const issues: BoardIssue[] = [];
	for (let startAt = 0; startAt < 500; startAt += 100) {
		const params = new URLSearchParams({
			jql,
			startAt: String(startAt),
			maxResults: "100",
			fields: "summary,status,priority,issuetype,duedate,labels,description,updated,resolutiondate",
		});
		const page = await call<{ issues: BoardIssue[]; total: number }>(`/rest/agile/1.0/board/${cfg.board}/issue?${params}`);
		issues.push(...page.issues);
		if (startAt + 100 >= page.total) break;
	}

	const created: string[] = [];
	const moved: string[] = [];
	const now = new Date().toISOString();
	for (const issue of issues) {
		const f = issue.fields;
		const column = f.status.name;
		const status = boardStatus(column, f.status.statusCategory.key);
		const priority = Math.max(0, Math.min(3, PRIORITY_NAMES.indexOf(f.priority?.name ?? "Medium")));
		const link = `${url}/browse/${issue.key}`;
		const existing = p.one<{ id: number }>("select id from tasks where jira_key = ? or key = ?", issue.key, issue.key);
		if (!existing) {
			const [task] = p.createTasks(project.id, [
				{
					key: issue.key,
					title: f.summary,
					description: f.description?.slice(0, 4000) ?? null,
					status,
					priority,
					due: f.duedate ?? null,
					tags: [f.issuetype?.name ?? "jira", ...(f.labels ?? [])].map((t) => t.toLowerCase()),
				},
			]);
			p.updateTask(task!.id, { jira_key: issue.key, external_status: column, external_since: now, external_url: link });
			created.push(`${issue.key} · ${column}`);
			continue;
		}
		const task = p.resolveTask(existing.id);
		const patch: Record<string, unknown> = {};
		if (task.title !== f.summary) patch.title = f.summary;
		if ((task.due ?? null) !== (f.duedate ?? null)) patch.due = f.duedate ?? null;
		if (task.external_status !== column) {
			patch.external_status = column;
			patch.external_since = now;
			if (task.status !== status) patch.status = status;
			moved.push(`${issue.key}: ${task.external_status ?? "—"} → ${column}`);
		}
		if (!task.jira_key) patch.jira_key = issue.key;
		if (!task.external_url) patch.external_url = link;
		if (Object.keys(patch).length) p.updateTask(task.id, patch);
	}
	return { board: cfg.board, issues: issues.length, created, moved };
}

/** The board the user works from, saved in settings by jira_board_configure. */
export function savedBoard(p: Planner): BoardConfig | null {
	const get = (k: string) => p.one<{ value: string }>("select value from settings where key = ?", k)?.value;
	const board = get("jira.board");
	const jql = get("jira.board_jql");
	const project = get("jira.board_project");
	return board && jql && project ? { board: Number(board), jql, project } : null;
}

export async function configureBoard(p: Planner, input: { board: number; quick_filter?: number; jql?: string; project?: string; title?: string; goal?: number | null }) {
	const info = await jiraBoardInfo(input.board);
	const jql = input.jql ?? info.quickFilters.find((f) => f.id === input.quick_filter)?.query;
	if (!jql) throw new GaamError("INVALID", `Pass jql or a quick_filter id. Quick filters on this board: ${info.quickFilters.map((f) => `${f.id} ${f.name}`).join(", ")}`);
	let projectKey = input.project;
	if (!projectKey) {
		const existing = p.one<{ key: string }>("select key from projects where jira_project is not null and title = ?", input.title ?? info.name);
		projectKey =
			existing?.key ??
			p.createProject({ title: input.title ?? info.name, key: "DISC", stage: "active", goal: input.goal ?? null, description: `Mirrors Jira board ${info.id} (${info.name}) filtered by: ${jql}` }).key;
	}
	const set = p.db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value");
	set.run("jira.board", String(input.board));
	set.run("jira.board_jql", jql);
	set.run("jira.board_project", projectKey);
	p.log("jira.board", "project", p.resolveProject(projectKey).id, `${info.name} · ${jql}`);
	return { board: info, jql, project: projectKey };
}

/** Open issues of one Jira user, on a board when given (so the board's filter applies). */
export async function jiraTeamIssues(user: string, board?: number) {
	const jql = `assignee = "${user.replace(/"/g, "")}" AND (statusCategory != Done OR updated >= -2d) ORDER BY updated DESC`;
	const params = new URLSearchParams({ jql, maxResults: "30", fields: "summary,status,updated,duedate,priority,statuscategorychangedate" });
	const path = board ? `/rest/agile/1.0/board/${board}/issue?${params}` : `/rest/api/2/search?${params}`;
	const data = await call<{
		issues: {
			key: string;
			fields: { summary: string; status: { name: string; statusCategory: { key: string } }; updated: string; duedate?: string | null; statuscategorychangedate?: string | null };
		}[];
	}>(path);
	const { url } = config();
	return data.issues.map((i) => ({
		key: i.key,
		summary: i.fields.summary,
		status: i.fields.status.name,
		category: i.fields.status.statusCategory.key,
		updated: i.fields.updated,
		status_since: i.fields.statuscategorychangedate ?? null,
		due: i.fields.duedate ?? null,
		url: `${url}/browse/${i.key}`,
	}));
}
