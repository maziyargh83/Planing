export const GOAL_HORIZONS = ["week", "month", "quarter", "year", "life"] as const;
export const GOAL_STATUSES = ["active", "paused", "achieved", "dropped"] as const;
export const PROJECT_STAGES = ["idea", "discovery", "scoping", "ready", "active", "shipped", "archived"] as const;
export const TASK_STATUSES = ["inbox", "todo", "doing", "blocked", "done", "dropped"] as const;
export const SCOPES = ["in", "out", "later"] as const;
export const NODE_KINDS = ["idea", "question", "risk", "decision", "insight", "data", "option", "goal"] as const;
export const ASK_KINDS = ["text", "number", "choice", "data", "confirm"] as const;
export const JOURNAL_KINDS = ["checkin", "note", "win", "blocker", "lesson", "review"] as const;
export const MEMORY_TOPICS = ["preference", "pattern", "context", "value", "skill", "constraint", "goal"] as const;
export const LINK_KINDS = ["commit", "mr", "jira", "url"] as const;
export const COMMENT_ENTITIES = ["goal", "project", "task", "node"] as const;

export type GoalHorizon = (typeof GOAL_HORIZONS)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type ProjectStage = (typeof PROJECT_STAGES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Scope = (typeof SCOPES)[number];
export type NodeKind = (typeof NODE_KINDS)[number];
export type AskKind = (typeof ASK_KINDS)[number];
export type JournalKind = (typeof JOURNAL_KINDS)[number];
export type MemoryTopic = (typeof MEMORY_TOPICS)[number];
export type LinkKind = (typeof LINK_KINDS)[number];
export type CommentEntity = (typeof COMMENT_ENTITIES)[number];

export interface Goal {
	id: number;
	title: string;
	why: string | null;
	horizon: GoalHorizon;
	status: GoalStatus;
	metric: string | null;
	target: number | null;
	current: number | null;
	due: string | null;
	source: string | null;
	cycle: string | null;
	kind: "expectation" | "development" | null;
	created_at: string;
	updated_at: string;
}

export interface Project {
	id: number;
	key: string;
	title: string;
	goal_id: number | null;
	stage: ProjectStage;
	problem: string | null;
	hypothesis: string | null;
	success_metric: string | null;
	description: string | null;
	color: string | null;
	jira_project: string | null;
	repo_path: string | null;
	created_at: string;
	updated_at: string;
}

export interface Task {
	id: number;
	key: string;
	project_id: number | null;
	parent_id: number | null;
	title: string;
	description: string | null;
	status: TaskStatus;
	scope: Scope | null;
	priority: number;
	impact: number | null;
	confidence: number | null;
	ease: number | null;
	/** ICE score 0–100, null until impact, confidence and ease are all set. */
	ice: number | null;
	estimate_h: number | null;
	actual_h: number;
	due: string | null;
	tags: string[];
	jira_key: string | null;
	branch: string | null;
	/** Column on the external board (Jira), e.g. "Code Review". */
	external_status: string | null;
	external_since: string | null;
	external_url: string | null;
	sort: number;
	done_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface MindNode {
	id: number;
	project_id: number;
	parent_id: number | null;
	text: string;
	kind: NodeKind;
	note: string | null;
	task_id: number | null;
	sort: number;
	children?: MindNode[];
}

export interface Ask {
	id: number;
	project_id: number | null;
	task_id: number | null;
	question: string;
	why: string | null;
	kind: AskKind;
	choices: string[] | null;
	answer: string | null;
	status: "open" | "answered" | "skipped";
	asked_by: string;
	created_at: string;
	answered_at: string | null;
}

export interface Comment {
	id: number;
	entity: CommentEntity;
	entity_id: number;
	author: string;
	body: string;
	created_at: string;
}

export interface JournalEntry {
	id: number;
	day: string;
	kind: JournalKind;
	energy: number | null;
	mood: number | null;
	body: string | null;
	author: string;
	goal_id: number | null;
	created_at: string;
}

export interface Memory {
	id: number;
	topic: MemoryTopic;
	fact: string;
	source: string | null;
	created_at: string;
	updated_at: string;
}

export interface Link {
	id: number;
	task_id: number;
	kind: LinkKind;
	ref: string;
	url: string | null;
	title: string | null;
	created_at: string;
}

export interface GaamEvent {
	id: number;
	at: string;
	actor: string;
	action: string;
	entity: string | null;
	entity_id: number | null;
	summary: string | null;
}

export class GaamError extends Error {
	code: "NOT_FOUND" | "INVALID" | "CONFLICT" | "INTEGRATION";
	constructor(code: GaamError["code"], message: string) {
		super(message);
		this.code = code;
	}
}

export const PROVIDERS = ["anthropic", "claude", "codex", "ollama"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface Thread {
	id: number;
	title: string;
	provider: ProviderId;
	model: string | null;
	origin: string;
	session: string | null;
	workspace: string | null;
	effort: string | null;
	pinned: number;
	created_at: string;
	updated_at: string;
}

export interface Message {
	id: number;
	thread_id: number;
	role: "user" | "assistant" | "error";
	content: string;
	tools: string[];
	/** Assistant messages: the folded stream (text, reasoning, tool calls). See src/ai/protocol.ts. */
	parts: unknown[];
	meta: Record<string, unknown>;
	created_at: string;
}

export interface Automation {
	id: number;
	slug: string | null;
	name: string;
	schedule: string;
	kind: "agent" | "jira_pull" | "git_sync";
	prompt: string | null;
	provider: ProviderId | null;
	model: string | null;
	enabled: number;
	thread_id: number | null;
	last_run_at: string | null;
	last_status: "ok" | "error" | "running" | null;
	last_output: string | null;
	created_at: string;
}
