import { readFileSync } from "node:fs";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { context, insights, nudges } from "../core/coach.ts";
import { Growth, INTERACTIONS, RELATIONS } from "../core/growth.ts";
import { DOC_KINDS, Knowledge } from "../core/knowledge.ts";
import { standupContext, teamStatus } from "../integrations/standup.ts";
import type { Db } from "../core/db.ts";
import { localDay, Planner, type TaskInput } from "../core/planner.ts";
import {
	ASK_KINDS,
	COMMENT_ENTITIES,
	GOAL_HORIZONS,
	GOAL_STATUSES,
	JOURNAL_KINDS,
	LINK_KINDS,
	MEMORY_TOPICS,
	NODE_KINDS,
	PROJECT_STAGES,
	SCOPES,
	TASK_STATUSES,
} from "../core/types.ts";
import { branchName, gitActivity, gitSync, openReviews } from "../integrations/git.ts";
import { configureBoard, jiraBoardInfo, jiraBoardSync, jiraImport, jiraPull, jiraPush, jiraSearch, savedBoard } from "../integrations/jira.ts";
import { PROMPTS } from "./prompts.ts";

const GUIDE = readFileSync(new URL("../../docs/AGENT_GUIDE.md", import.meta.url), "utf8");

const INSTRUCTIONS = `Gaam (گام) is the user's personal planner and second brain. You are their planning partner.
The full guide — model, lifecycle, ICE scale, ask/memory/comment etiquette, playbooks — is the gaam_guide tool (or gaam://guide). Read it once per conversation.

How to work with it:
- Call gaam_context at the start of every conversation. It returns who the user is (profile memories), active goals, today's plan, work in progress, open questions and coaching nudges. Lead with the nudges that matter.
- The user thinks and writes in Persian; reply in Persian unless they write English. Keep task titles short and concrete.
- When something is unclear or you need data you cannot get (numbers, priorities, constraints, links), do not guess: create asks with ask_user. The user answers them in the Gaam UI and you read the answers via asks_list or gaam_context.
- When you learn something durable about the user (how they work, what they value, constraints, recurring patterns), save it with memory_save. Check memory_list before saving to avoid duplicates.
- Project flow: idea → discovery (mind map: questions, risks, data, options) → scoping (tasks with scope in/later/out, ICE scores) → ready → active → shipped. Move the stage forward with project_save when it is earned.
- Tasks should be completable in at most a day; split bigger ones into subtasks. Score every scoped task with task_score (impact, confidence, ease 1–10).
- Tie work to goals. If an active project has no goal, ask why.
- Leave your reasoning as a comment (comment_add) on the project or task when you make a non-obvious call, so the user can reply.
- Task keys look like SRCH-3 (project tasks) or G-12 (inbox). Use them in branch names and commit messages so git_sync can link the work.`;

type Json = unknown;
type Handler<A> = (args: A, p: Planner) => Json | Promise<Json>;

const ref = z.union([z.string(), z.number()]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const score = z.number().int().min(1).max(10);

const taskFields = {
	description: z.string().nullish().describe("Markdown. What done looks like, acceptance criteria, links."),
	status: z.enum(TASK_STATUSES).optional(),
	scope: z.enum(SCOPES).nullish().describe("in = this version, later = next round, out = explicitly not doing"),
	priority: z.number().int().min(0).max(3).optional().describe("0 = P0 urgent … 3 = P3 someday. Default 2."),
	impact: score.nullish(),
	confidence: score.nullish(),
	ease: score.nullish(),
	estimate_h: z.number().positive().nullish().describe("Estimated hours of focused work."),
	due: day.nullish(),
	tags: z.array(z.string()).optional(),
};

type TaskTree = TaskInput;
const taskInput: z.ZodType<TaskTree> = z.lazy(() =>
	z.object({ title: z.string().min(1), ...taskFields, subtasks: z.array(taskInput).optional() }),
) as z.ZodType<TaskTree>;

interface MindInput {
	text: string;
	kind?: (typeof NODE_KINDS)[number];
	note?: string | null;
	children?: MindInput[];
}
const nodeInput: z.ZodType<MindInput> = z.lazy(() =>
	z.object({
		text: z.string().min(1),
		kind: z.enum(NODE_KINDS).optional().describe("idea, question, risk, decision, insight, data, option, goal"),
		note: z.string().nullish(),
		children: z.array(nodeInput).optional(),
	}),
) as z.ZodType<MindInput>;

/** `actor` names the agent in the activity log when the transport cannot (stateless HTTP). */
export function createMcpServer(db: Db, actor?: string, version = "0.1.0") {
	const server = new McpServer({ name: "gaam", title: "Gaam · گام", version }, { instructions: INSTRUCTIONS });
	const planner = () => new Planner(db, actor ?? server.server.getClientVersion()?.name ?? "agent");

	function tool<S extends z.ZodRawShape>(
		name: string,
		description: string,
		shape: S,
		fn: Handler<z.infer<z.ZodObject<S>>>,
		readOnly = false,
	) {
		server.registerTool(
			name,
			{ description, inputSchema: shape, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } },
			(async (args: z.infer<z.ZodObject<S>>) => {
				try {
					const result = await fn(args, planner());
					const text = typeof result === "string" ? result : JSON.stringify(result, null, 1);
					return { content: [{ type: "text" as const, text }] };
				} catch (error) {
					const code = (error as { code?: string }).code;
					return {
						isError: true,
						content: [{ type: "text" as const, text: `${code ? `${code}: ` : ""}${(error as Error).message}` }],
					};
				}
			}) as never,
		);
	}

	// ── Orientation ─────────────────────────────────────────────────────────

	tool(
		"gaam_context",
		"START HERE. One read with everything you need to be useful: the user's profile (memories), active goals, today's plan and journal, tasks in progress, next up, live projects, open and recently answered asks, coaching nudges and last week's numbers.",
		{},
		(_, p) => context(p),
		true,
	);

	tool(
		"gaam_guide",
		"How to use Gaam well: the data model, project lifecycle, ICE scoring scale, when to ask the user, what to remember, daily/weekly playbooks, coding-session workflow. Read once per conversation, after gaam_context.",
		{},
		() => GUIDE,
		true,
	);

	tool(
		"search",
		"Full-text search across tasks, projects, goals, mind-map nodes, asks, comments, memories and journal. Prefix matching, Persian and English.",
		{ query: z.string().min(1), limit: z.number().int().max(100).optional() },
		({ query, limit }, p) => p.search(query, limit),
		true,
	);

	tool(
		"insights",
		"How the user actually works over the last N days: throughput, focus minutes, estimation ratio (actual ÷ estimate), goal alignment %, energy vs output, streak, plus current nudges. Use for reviews and coaching.",
		{ days: z.number().int().min(1).max(90).optional() },
		({ days }, p) => ({ ...insights(p, days ?? 7), nudges: nudges(p) }),
		true,
	);

	tool(
		"activity",
		"The activity log: what the user and agents changed, newest last. Pass since_id to read only what happened after an event you already saw.",
		{ since_id: z.number().int().optional(), limit: z.number().int().max(500).optional() },
		({ since_id, limit }, p) => p.events(since_id, limit ?? 50),
		true,
	);

	// ── Goals ───────────────────────────────────────────────────────────────

	tool(
		"goal_evidence",
		"Everything that proves progress on a goal: journal entries linked to it (wins, lessons) and finished tasks in its projects. Use it to prepare performance reviews (SFPM) and to spot goals with no progress.",
		{ goal: z.number().int() },
		({ goal }, p) => p.goalEvidence(goal),
		true,
	);

	tool("goal_list", "List goals with linked project counts, evidence counts and metric progress. Goals with source SFPM are the user's company performance-review goals for a cycle.", { status: z.enum(GOAL_STATUSES).optional() }, ({ status }, p) => p.listGoals(status), true);

	tool(
		"goal_save",
		"Create a goal (omit id) or update one (pass id). A good goal has a why and a measurable metric with target; update current as progress happens.",
		{
			id: z.number().int().optional(),
			title: z.string().optional(),
			why: z.string().nullish(),
			horizon: z.enum(GOAL_HORIZONS).optional(),
			status: z.enum(GOAL_STATUSES).optional(),
			metric: z.string().nullish(),
			target: z.number().nullish(),
			current: z.number().nullish(),
			due: day.nullish(),
			source: z.string().nullish().describe('Where the goal comes from, e.g. "SFPM" for company performance-review goals'),
			cycle: z.string().nullish().describe('Review cycle, e.g. "1405-C2"'),
			kind: z.enum(["expectation", "development"]).nullish().describe("For SFPM goals: expectation (role deliverable) or development (personal growth item)"),
		},
		({ id, ...input }, p) => {
			if (id) return p.updateGoal(id, input);
			if (!input.title) throw new Error("title is required to create a goal");
			return p.createGoal({ ...input, title: input.title });
		},
	);

	// ── Projects ────────────────────────────────────────────────────────────

	tool(
		"project_list",
		"List projects (archived hidden unless asked) with task, done, doing, open-ask and mind-map counts.",
		{ stage: z.array(z.enum(PROJECT_STAGES)).optional() },
		({ stage }, p) => p.listProjects(stage),
		true,
	);

	tool(
		"project_get",
		"Everything about one project: fields, goal, task tree (priority order), scope lists (in/later/out/undecided), mind map, asks, comments, recent activity.",
		{ project: ref.describe("Project key (SRCH) or id") },
		({ project }, p) => p.projectBundle(project),
		true,
	);

	tool(
		"project_save",
		"Create a project (omit project) or update one. Projects start as stage 'idea'. Give a short uppercase key (2–5 latin letters) — it prefixes every task key. Fill problem, hypothesis and success_metric during discovery.",
		{
			project: ref.optional().describe("Key or id to update; omit to create"),
			title: z.string().optional(),
			key: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/).optional().describe("Only on create"),
			goal: z.number().int().nullish().describe("Goal id this project serves"),
			stage: z.enum(PROJECT_STAGES).optional(),
			problem: z.string().nullish(),
			hypothesis: z.string().nullish(),
			success_metric: z.string().nullish(),
			description: z.string().nullish(),
			color: z.string().nullish(),
			jira_project: z.string().nullish().describe("Jira project key for jira_push"),
			repo_path: z.string().nullish().describe("Absolute path of the git repository for git_activity/git_sync"),
		},
		({ project, key, ...input }, p) => {
			if (project !== undefined) return p.updateProject(project, input);
			if (!input.title) throw new Error("title is required to create a project");
			return p.createProject({ ...input, title: input.title, key });
		},
	);

	// ── Tasks ───────────────────────────────────────────────────────────────

	tool(
		"task_list",
		"List tasks. Default order is priority (P0 first, then ICE score). Use project 'inbox' for unfiled tasks.",
		{
			project: ref.optional(),
			status: z.array(z.enum(TASK_STATUSES)).optional(),
			scope: z.enum([...SCOPES, "none"]).optional(),
			tag: z.string().optional(),
			due_before: day.optional(),
			roots_only: z.boolean().optional(),
			order: z.enum(["priority", "due", "updated", "manual"]).optional(),
			limit: z.number().int().max(500).optional(),
		},
		({ roots_only, ...filter }, p) => p.listTasks({ ...filter, parent: roots_only ? "root" : undefined }),
		true,
	);

	tool("task_get", "One task with subtasks, comments, links (commits, MRs, Jira), asks and focus time.", { task: ref }, ({ task }, p) => p.taskBundle(task), true);

	tool(
		"task_create",
		"Create one or many tasks, optionally nested via subtasks. Without project they land in the inbox. Pass parent to add subtasks to an existing task.",
		{ project: ref.nullish(), parent: ref.optional(), tasks: z.array(taskInput).min(1) },
		({ project, parent, tasks }, p) => p.createTasks(project ?? null, tasks, parent),
	);

	tool(
		"task_update",
		"Update one or many tasks in one call. Each item is {task, ...fields}. Moving status to done stamps the completion time. Set project to move a task (e.g. out of the inbox).",
		{
			updates: z
				.array(
					z.object({
						task: ref,
						title: z.string().optional(),
						project: ref.nullish(),
						parent: ref.nullish(),
						jira_key: z.string().nullish(),
						branch: z.string().nullish(),
						...taskFields,
					}),
				)
				.min(1),
		},
		({ updates }, p) => updates.map(({ task, ...patch }) => p.updateTask(task, patch)),
	);

	tool(
		"task_score",
		"Prioritise with ICE: impact (how much it moves the goal), confidence (how sure you are), ease (inverse of effort), all 1–10. Score = I×C×E/10 (0–100). Optionally set priority P0–P3 too. Explain non-obvious scores with comment_add.",
		{
			scores: z
				.array(z.object({ task: ref, impact: score, confidence: score, ease: score, priority: z.number().int().min(0).max(3).optional() }))
				.min(1),
		},
		({ scores }, p) =>
			scores.map(({ task, ...s }) => {
				const t = p.updateTask(task, s);
				return { key: t.key, title: t.title, ice: t.ice, priority: t.priority };
			}),
	);

	tool(
		"scope_set",
		"Decide scope in bulk: which tasks are in this version, which are later, which are explicitly out. Produces the scope list the user reviews.",
		{ in: z.array(ref).optional(), later: z.array(ref).optional(), out: z.array(ref).optional() },
		(args, p) => {
			for (const s of SCOPES) for (const t of args[s] ?? []) p.updateTask(t, { scope: s });
			return { in: args.in?.length ?? 0, later: args.later?.length ?? 0, out: args.out?.length ?? 0 };
		},
	);

	tool("task_delete", "Delete a task and its subtasks. Prefer status 'dropped' to keep history; delete only duplicates and mistakes.", { task: ref }, ({ task }, p) =>
		p.deleteTask(task),
	);

	tool(
		"task_link",
		"Attach a commit, merge request, Jira issue or URL to a task.",
		{ task: ref, kind: z.enum(LINK_KINDS), ref: z.string(), url: z.string().nullish(), title: z.string().nullish() },
		({ task, ...link }, p) => p.linkTask(task, link),
	);

	// ── Mind map ────────────────────────────────────────────────────────────

	tool(
		"mindmap_get",
		"A project's mind map as a tree and as an indented outline with node ids (#12) you can attach children to.",
		{ project: ref },
		({ project }, p) => p.mindmap(project),
		true,
	);

	tool(
		"mindmap_add",
		"Grow a project's mind map. Pass a nested tree; omit parent to add at the root. Use kinds deliberately: question (unknowns to research), risk, data (numbers needed), option (alternative approaches), decision, insight.",
		{ project: ref, parent: z.number().int().nullish(), nodes: z.array(nodeInput).min(1) },
		({ project, parent, nodes }, p) => {
			p.addNodes(project, nodes, parent ?? null);
			return p.mindmap(project).outline;
		},
	);

	tool(
		"mindmap_edit",
		"Edit, move (parent), delete, or convert a mind-map node into a task (to_task). Converting keeps the link so the map shows progress.",
		{
			node: z.number().int(),
			action: z.enum(["update", "delete", "to_task"]),
			text: z.string().optional(),
			kind: z.enum(NODE_KINDS).optional(),
			note: z.string().nullish(),
			parent: z.number().int().nullish(),
			task: taskInput.optional().describe("Extra task fields for to_task"),
		},
		({ node, action, task, ...patch }, p) => {
			if (action === "delete") return p.deleteNode(node);
			if (action === "to_task") return p.nodeToTask(node, task ? { ...task, title: task.title } : {});
			return p.updateNode(node, patch);
		},
	);

	// ── Asking the human ────────────────────────────────────────────────────

	tool(
		"ask_user",
		"Ask the user questions or request data you need, asynchronously. They appear in the Gaam UI inbox; answers come back through asks_list and gaam_context. Use kind 'choice' with choices for quick decisions, 'data' when you need numbers or a dataset, 'confirm' for yes/no. Always say why you need it.",
		{
			asks: z
				.array(
					z.object({
						question: z.string().min(1),
						why: z.string().optional(),
						kind: z.enum(ASK_KINDS).optional(),
						choices: z.array(z.string()).optional(),
						project: ref.nullish(),
						task: ref.nullish(),
					}),
				)
				.min(1),
		},
		({ asks }, p) => p.ask(asks),
	);

	tool(
		"asks_list",
		"Questions you or other agents asked the user, with answers.",
		{ status: z.enum(["open", "answered", "skipped"]).optional(), project: ref.optional() },
		(filter, p) => p.listAsks(filter),
		true,
	);

	tool(
		"comment_add",
		"Comment on a goal, project, task or mind-map node. Use it to explain reasoning, flag a concern, or answer the user's comment. Your client name is recorded as the author.",
		{ entity: z.enum(COMMENT_ENTITIES), ref, body: z.string().min(1) },
		({ entity, ref, body }, p) => p.comment(entity, ref, body),
	);

	tool("comment_list", "The comment thread on a goal, project, task or node.", { entity: z.enum(COMMENT_ENTITIES), ref }, ({ entity, ref }, p) => p.listComments(entity, ref), true);

	// ── Days, journal, focus ────────────────────────────────────────────────

	tool("day_get", "A day: intention, top tasks, journal, completed tasks, focus minutes. Defaults to today.", { day: day.optional() }, ({ day }, p) => p.day(day), true);

	tool(
		"day_plan",
		"Set today's (or another day's) intention and top tasks (at most 3, the ones that matter), or close the day with a reflection and 1–5 rating.",
		{
			day: day.optional(),
			intention: z.string().nullish(),
			top: z.array(ref).max(5).optional(),
			reflection: z.string().nullish(),
			rating: z.number().int().min(1).max(5).nullish(),
		},
		({ day, ...input }, p) => p.planDay(day ?? localDay(), input),
	);

	tool(
		"journal_add",
		"Write to the journal: a check-in (energy and mood 1–5), a note, a win, a blocker, a lesson, or a review. Pass goal to record it as evidence for that goal.",
		{
			kind: z.enum(JOURNAL_KINDS),
			body: z.string().nullish(),
			energy: z.number().int().min(1).max(5).nullish(),
			mood: z.number().int().min(1).max(5).nullish(),
			day: day.optional(),
			goal: z.number().int().nullish().describe("Goal id this entry is evidence for (use kind win for achievements)"),
		},
		(input, p) => p.addJournal(input),
	);

	tool(
		"focus",
		"Track focused work. start (optionally on a task, which moves it to doing), stop (adds the minutes to the task's actual hours), or log minutes after the fact.",
		{ action: z.enum(["start", "stop", "log"]), task: ref.nullish(), minutes: z.number().positive().optional(), note: z.string().optional() },
		({ action, task, minutes, note }, p) => {
			if (action === "start") return p.startFocus(task);
			if (action === "stop") return p.stopFocus(note) ?? { stopped: false, reason: "No focus session was running." };
			if (!minutes) throw new Error("minutes is required for log");
			return p.logFocus(task ?? null, minutes, note);
		},
	);

	// ── Memory ──────────────────────────────────────────────────────────────

	tool("memory_list", "What agents have learned about the user, grouped by topic.", { topic: z.enum(MEMORY_TOPICS).optional() }, ({ topic }, p) => p.listMemories(topic), true);

	tool(
		"memory_save",
		"Remember a durable fact about the user (omit id) or revise one (pass id). Topics: preference, pattern (observed behaviour), context (role, team, situation), value, skill, constraint, goal. One fact per memory, written so a future agent can act on it.",
		{ id: z.number().int().optional(), topic: z.enum(MEMORY_TOPICS).optional(), fact: z.string().min(3).optional() },
		({ id, topic, fact }, p) => {
			if (id) return p.updateMemory(id, { topic, fact });
			if (!fact) throw new Error("fact is required");
			return p.remember(topic ?? "context", fact);
		},
	);

	tool("memory_forget", "Delete a memory that is wrong or stale.", { id: z.number().int() }, ({ id }, p) => p.forget(id));

	// ── Growth: people, decisions, stand-ups ────────────────────────────────

	tool(
		"growth_overview",
		"The user's performance cycle at a glance: SFPM expectations and development goals (with evidence counts), cycle timeline, past scores, last cycle's feedback (strengths, growth areas, recommended actions), relationship health, stand-up streak and open decisions. Use it to coach the user toward their review.",
		{},
		(_, p) => new Growth(p).cycle(),
		true,
	);

	tool(
		"people_list",
		"People in the user's work life (manager, reports, peers, product, assessors) with last contact, contact cadence and whether a touch-point is overdue. Building relationships is part of the user's goals.",
		{ relation: z.enum(RELATIONS).optional(), assessor: z.boolean().optional() },
		(filter, p) => new Growth(p).people(filter),
		true,
	);

	tool("person_get", "One person with their interaction history.", { person: ref.describe("Name (partial ok) or id") }, ({ person }, p) => new Growth(p).personBundle(person), true);

	tool(
		"person_save",
		"Add or update a person (matched by name). relation: manager, report, peer, product, stakeholder, other. assessor = they assess the user in SFPM. cadence_days overrides how often the user should touch base. Keep notes about what they care about and how to help them.",
		{
			id: z.number().int().optional(),
			name: z.string().optional(),
			role: z.string().nullish(),
			team: z.string().nullish(),
			relation: z.enum(RELATIONS).optional(),
			assessor: z.boolean().optional(),
			cadence_days: z.number().int().positive().nullish(),
			notes: z.string().nullish(),
			jira_user: z.string().nullish().describe("Jira username, e.g. shaghayegh.ahmadi — lets Gaam follow their board work"),
		},
		(input, p) => new Growth(p).savePerson(input),
	);

	tool(
		"interaction_log",
		"Record a touch-point with a person: one_on_one, help (you unblocked them), feedback_given, feedback_received, review (code review), kudos (thanked/credited them), sync, social. Pass goal to count it as evidence for an SFPM goal (e.g. Leadership).",
		{
			person: ref,
			kind: z.enum(INTERACTIONS),
			note: z.string().nullish(),
			day: day.optional(),
			goal: z.number().int().nullish(),
		},
		(input, p) => new Growth(p).logInteraction(input),
	);

	tool(
		"decision_list",
		"Technical/product decisions with impact, reversibility and the resulting mode: decide (low impact), decide_and_inform (high impact, reversible), align_first (high impact, one-way door).",
		{ status: z.enum(["open", "decided", "revisited"]).optional(), project: ref.optional() },
		(filter, p) => new Growth(p).decisions(filter),
		true,
	);

	tool(
		"decision_save",
		"Open or update a decision record. Always set impact (low/high) and reversible; the response tells the user whether to decide alone, decide and inform, or align first. Record who it was aligned with, and mark status decided with the choice.",
		{
			id: z.number().int().optional(),
			title: z.string().optional(),
			project: ref.nullish(),
			context: z.string().nullish(),
			options: z.string().nullish().describe("The alternatives considered, short"),
			choice: z.string().nullish(),
			impact: z.enum(["low", "high"]).optional(),
			reversible: z.boolean().optional(),
			aligned_with: z.string().nullish(),
			status: z.enum(["open", "decided", "revisited"]).optional(),
		},
		(input, p) => new Growth(p).saveDecision(input),
	);

	tool(
		"standup_save",
		"Save today's structured stand-up and get it formatted for chat. Four short fields: done (yesterday), next (today), blockers, help (decision or help needed, from whom). Be concrete and use task/Jira keys; each field one or two lines.",
		{ day: day.optional(), done: z.string().nullish(), next: z.string().nullish(), blockers: z.string().nullish(), help: z.string().nullish() },
		(input, p) => new Growth(p).saveStandup(input),
	);

	tool(
		"standup_context",
		"Everything for writing an honest, precise stand-up: last stand-up (what was promised and whether it happened), tasks finished and moved on the Jira board since then, in-progress work with days in column, commits, open MRs, today's plan, follow-ups due, the team's status (who is stuck/blocked/idle) and format rules. Call it before standup_save.",
		{ day: day.optional() },
		({ day }, p) => standupContext(p, day),
		true,
	);

	tool(
		"team_status",
		"What each person the user leads (relation report) is doing on Jira, with flags: blocked, stuck in review/QA, idle, past due; plus open follow-ups with them. Use for stand-ups, 1:1 prep and to help the user lead.",
		{},
		(_, p) => teamStatus(p),
		true,
	);

	tool(
		"followup_list",
		"Follow-ups: things the user owes someone (mine) and things they are waiting on from others (theirs), with due dates and overdue flags.",
		{ status: z.enum(["open", "done", "dropped"]).optional(), person: ref.optional(), direction: z.enum(["mine", "theirs"]).optional() },
		(filter, p) => new Growth(p).followups(filter),
		true,
	);

	tool(
		"followup_save",
		"Create or update a follow-up. direction mine = the user promised it; theirs = the user is waiting on that person. Link a task key or doc (e.g. the meeting it came from). Close with status done.",
		{
			id: z.number().int().optional(),
			person: ref.nullish(),
			direction: z.enum(["mine", "theirs"]).optional(),
			text: z.string().optional(),
			due: day.nullish(),
			status: z.enum(["open", "done", "dropped"]).optional(),
			task: z.string().nullish(),
			doc: z.number().int().nullish(),
		},
		(input, p) => new Growth(p).saveFollowup(input),
	);

	tool(
		"doc_list",
		"The user's knowledge base: meeting plans and notes, plans, documents, data and references, newest first, with previews. Use search for full-text lookup across them.",
		{ kind: z.enum(DOC_KINDS).optional(), project: ref.optional(), person: ref.optional(), limit: z.number().int().max(300).optional() },
		(filter, p) => new Knowledge(p).docs(filter),
		true,
	);

	tool("doc_get", "One document with full text, linked people and its follow-ups.", { id: z.number().int() }, ({ id }, p) => new Knowledge(p).doc(id), true);

	tool(
		"doc_save",
		"Save something the user wants remembered: a meeting plan or notes (kind meeting, with day and people), a plan, a doc, data or a reference. Pass body text, or path to a local file (txt/md/csv/json/docx/rtf/html are read; others are stored with a note). Pass id to update, e.g. to add a summary. After saving a meeting, extract action items with followup_save and tasks with task_create.",
		{
			id: z.number().int().optional(),
			title: z.string().optional(),
			kind: z.enum(DOC_KINDS).optional(),
			body: z.string().nullish(),
			summary: z.string().nullish(),
			source: z.string().nullish().describe("URL or where it came from"),
			path: z.string().optional().describe("Absolute or ~ path of a local file to import"),
			day: day.nullish(),
			project: ref.nullish(),
			people: z.array(z.string()).optional().describe("Names of people involved (created if new)"),
			tags: z.array(z.string()).optional(),
		},
		async ({ path, ...input }, p) => {
			const k = new Knowledge(p);
			if (path) return k.ingestPath(path, input);
			return k.save(input);
		},
	);

	tool("doc_delete", "Delete a document from the knowledge base.", { id: z.number().int() }, ({ id }, p) => new Knowledge(p).remove(id));

	tool("standup_get", "A day's stand-up (default today) and the stand-up streak.", { day: day.optional() }, ({ day }, p) => {
		const g = new Growth(p);
		return { ...g.standup(day), stats: g.standupStats() };
	}, true);

	// ── Integrations ────────────────────────────────────────────────────────

	tool("jira_search", "Search Jira with JQL, e.g. 'assignee = currentUser() AND statusCategory != Done'.", { jql: z.string(), limit: z.number().int().max(100).optional() }, ({ jql, limit }) =>
		jiraSearch(jql, limit),
	true);

	tool(
		"jira_push",
		"Create a Jira issue from a Gaam task and link them. Uses the project's jira_project unless you pass one. Ask the user before pushing many tasks.",
		{ task: ref, project: z.string().optional(), issue_type: z.string().optional() },
		({ task, project, issue_type }, p) => jiraPush(p, task, { project, issueType: issue_type }),
	);

	tool(
		"jira_board",
		"The user's main work comes from a Jira board. With no arguments: the saved board config and its columns/quick filters. With sync: true, mirrors the user's board issues into the Gaam project now (Jira keys kept as task keys, Jira column in external_status).",
		{ sync: z.boolean().optional(), board: z.number().int().optional().describe("Inspect another board id") },
		async ({ sync, board }, p) => {
			const saved = savedBoard(p);
			if (sync) {
				if (!saved) throw new Error("No board configured. Call jira_board_configure first.");
				return jiraBoardSync(p, saved);
			}
			const id = board ?? saved?.board;
			if (!id) return { configured: false };
			return { saved, info: await jiraBoardInfo(id) };
		},
		true,
	);

	tool(
		"jira_board_configure",
		"Choose the Jira board the user works from and which of its issues are theirs (a quick filter id or JQL). Creates the Gaam project that mirrors it if needed.",
		{ board: z.number().int(), quick_filter: z.number().int().optional(), jql: z.string().optional(), project: z.string().optional(), goal: z.number().int().nullish() },
		(input, p) => configureBoard(p, input),
	);

	tool("jira_pull", "Sync status from Jira into linked Gaam tasks (one task, or all unfinished linked tasks).", { task: ref.optional() }, ({ task }, p) => jiraPull(p, task));

	tool(
		"jira_import",
		"Import Jira issues matching JQL as Gaam tasks (already linked issues are skipped).",
		{ jql: z.string(), project: ref.nullish(), limit: z.number().int().max(200).optional() },
		({ jql, project, limit }, p) => jiraImport(p, jql, project ?? null, limit),
	);

	tool(
		"git_activity",
		"The user's recent commits across watched repositories, with task keys found in messages. Good for stand-ups and reviews.",
		{ since: z.string().optional().describe("git date, e.g. '3 days ago' or 2026-11-01"), repo: z.string().optional() },
		({ since, repo }, p) => gitActivity(p, { since, repo }),
		true,
	);

	tool("git_reviews", "The user's open merge requests (GitLab) and pull requests (GitHub).", {}, () => openReviews(), true);

	tool("git_sync", "Link commits and MRs that mention task keys or linked Jira keys to their tasks.", { since: z.string().optional() }, ({ since }, p) => gitSync(p, since));

	tool(
		"task_branch",
		"Suggest a branch name carrying the task key, and store it on the task.",
		{ task: ref, type: z.enum(["feat", "fix", "chore", "refactor", "spike", "docs"]).optional() },
		({ task, type }, p) => {
			const name = branchName(p.resolveTask(task), type);
			p.updateTask(task, { branch: name });
			return { branch: name, command: `git switch -c ${name}` };
		},
	);

	// ── Resources ───────────────────────────────────────────────────────────

	const json = (uri: string, data: unknown) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 1) }] });

	server.registerResource("guide", "gaam://guide", { title: "Agent guide", mimeType: "text/markdown" }, (uri) => ({
		contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDE }],
	}));
	server.registerResource("context", "gaam://context", { title: "Planning context", mimeType: "application/json" }, (uri) =>
		json(uri.href, context(planner())),
	);
	server.registerResource("profile", "gaam://profile", { title: "What agents know about the user", mimeType: "application/json" }, (uri) =>
		json(uri.href, planner().listMemories()),
	);
	server.registerResource(
		"project",
		new ResourceTemplate("gaam://project/{key}", {
			list: () => ({
				resources: planner()
					.listProjects()
					.map((pr) => ({ uri: `gaam://project/${pr.key}`, name: `${pr.key} · ${pr.title}`, mimeType: "application/json" })),
			}),
		}),
		{ title: "Project", mimeType: "application/json" },
		(uri, { key }) => json(uri.href, planner().projectBundle(String(key))),
	);

	// ── Prompts ─────────────────────────────────────────────────────────────

	for (const prompt of PROMPTS)
		server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description, argsSchema: prompt.args }, (args: Record<string, unknown>) => ({
			messages: [{ role: "user", content: { type: "text", text: prompt.render(args as Record<string, string>) } }],
		}));

	return server;
}
