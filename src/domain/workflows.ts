import type { Planner } from "./planner.ts";
import { tx } from "../storage/db.ts";
import { GaamError } from "./types.ts";
import { Knowledge } from "./knowledge.ts";
import { Recall, type Hit } from "../retrieval/recall.ts";

export const WORKFLOW_KINDS = ["meeting", "weekly_review", "idea_to_plan"] as const;
export type WorkflowKind = typeof WORKFLOW_KINDS[number];
export type WorkflowAction = "collect" | "draft" | "revise" | "publish" | "pause" | "resume" | "cancel";
interface Workflow {
	id: number; workspace_id: number; kind: WorkflowKind; title: string; query: string;
	status: string; resume_status: string | null; evidence: string; draft: string | null; doc_id: number | null; updated_at: string;
}
export const WORKFLOW_INSTRUCTIONS: Record<WorkflowKind, string> = {
	meeting: "Prepare an agenda grounded in prior meetings, open follow-ups and decisions. Name commitments, risks, owners and missing information. Cite sources. Do not invent attendee statements.",
	weekly_review: "Review achievements, unfinished promises, blockers and goal alignment for the past week. Separate facts from interpretation. Propose at most three next actions. Cite sources and dates.",
	idea_to_plan: "Describe the problem, assumptions, success metric, options, questions, risks and smallest scope. Propose tasks of at most a day, with explicit estimates and ICE reasoning. Cite sources. Keep unknowns explicit.",
};

export class Workflows {
	readonly p: Planner;
	constructor(p: Planner) { this.p = p; }
	get(id: number) {
		const w = this.p.one<Workflow>(`select * from workflows where id=?${this.p.ws()}`, id);
		if (!w) throw new GaamError("NOT_FOUND", "Workflow not found in this workspace. Call workflow_list.");
		return { ...w, evidence: JSON.parse(w.evidence) as Hit[], instructions: WORKFLOW_INSTRUCTIONS[w.kind],
			steps: this.p.all("select step, payload, actor, created_at from workflow_steps where workflow_id=? order by id", id).map((s) => ({ ...s, payload: JSON.parse(String(s.payload)) })) };
	}
	list() { return this.p.all<Workflow>(`select * from workflows where 1=1${this.p.ws()} order by id desc limit 100`).map((w) => ({ ...w, evidence: JSON.parse(w.evidence) as Hit[] })); }
	create(input: { kind: WorkflowKind; title: string; query: string }) {
		if (!WORKFLOW_KINDS.includes(input.kind) || !input.title.trim() || input.title.length > 300 || !input.query.trim() || input.query.length > 8000) throw new GaamError("INVALID", "A supported kind, title and query are required.");
		return tx(this.p.db, () => {
			const id = this.p.insert("workflows", { ...input, workspace_id: this.p.targetWorkspace() });
			this.step(id, "created", { kind: input.kind });
			return this.get(id);
		});
	}
	private step(id: number, step: string, payload: unknown) {
		this.p.insert("workflow_steps", { workflow_id: id, step, payload: JSON.stringify(payload), actor: this.p.actor });
		this.p.log(`workflow.${step}`, "workflow", id, step);
	}
	async advance(id: number, action: WorkflowAction, draft?: string) {
		const initial = this.get(id);
		let evidence: Hit[] | null = null;
		if (action === "collect") {
			if (!["collect", "draft", "review"].includes(initial.status)) throw new GaamError("CONFLICT", "Resume the workflow before collecting evidence.");
			// Explicit workspace is pinned even when called from an all-workspaces session.
			evidence = (await new Recall(this.p.in(initial.workspace_id)).search(initial.query, 12)).hits;
		}
		return tx(this.p.db, () => {
			const w = this.get(id);
			if (action === "publish" && w.status === "published") return w;
			if (w.updated_at !== initial.updated_at || w.status !== initial.status) throw new GaamError("CONFLICT", "Workflow changed. Call workflow_get before retrying.");
			if (["published", "cancelled"].includes(w.status)) throw new GaamError("CONFLICT", "Workflow is already closed.");
			const patch: Record<string, unknown> = {};
			if (action === "collect") { patch.evidence = JSON.stringify(evidence); patch.status = "draft"; patch.draft = null; }
			else if (action === "draft") {
				if (w.status !== "draft" || !draft?.trim() || draft.length > 100_000) throw new GaamError("INVALID", "Collect evidence first and provide a draft (max 100000 characters).");
				patch.draft = draft.trim(); patch.status = "review";
			} else if (action === "publish") {
				if (w.status !== "review" || !w.draft) throw new GaamError("CONFLICT", "Write a draft and ask the user to review it before publishing.");
				const recall = new Recall(this.p.in(w.workspace_id));
				for (const hit of w.evidence) {
					const source = recall.source(hit.source_id);
					if (source.hash !== hit.source_hash) throw new GaamError("CONFLICT", "Evidence changed. Collect evidence and revise the draft before publishing.");
				}
				const allowed = new Set(w.evidence.map((h) => h.href));
				for (const link of w.draft.matchAll(/\]\((#\/sources\/[^)]+)\)/g)) if (!allowed.has(link[1]!)) throw new GaamError("INVALID", "Draft cites a source outside the collected evidence.");
				const doc = new Knowledge(this.p.in(w.workspace_id)).save({ title: w.title, kind: w.kind === "meeting" ? "meeting" : "plan", body: w.draft, tags: ["workflow", w.kind] });
				patch.doc_id = doc.id; patch.status = "published";
			} else if (action === "revise") {
				if (w.status !== "review") throw new GaamError("CONFLICT", "Only a draft in review can be revised.");
				patch.status = "draft";
			} else if (action === "pause") {
				if (w.status === "paused") return w;
				patch.resume_status = w.status; patch.status = "paused";
			} else if (action === "resume") {
				if (w.status !== "paused") throw new GaamError("CONFLICT", "Workflow is not paused.");
				patch.status = w.resume_status ?? "collect"; patch.resume_status = null;
			} else if (action === "cancel") patch.status = "cancelled";
			else throw new GaamError("INVALID", "Unknown workflow action.");
			this.p.patch("workflows", id, patch);
			this.step(id, action, { status: patch.status });
			return this.get(id);
		});
	}
}
