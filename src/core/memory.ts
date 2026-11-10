import type { Planner } from "./planner.ts";
import { tx } from "./db.ts";
import { GaamError, MEMORY_TOPICS, type MemoryTopic } from "./types.ts";
import { normalize } from "../retrieval/text.ts";

export interface MemoryProposal {
	id: number; workspace_id: number | null; topic: MemoryTopic; fact: string; source: string;
	replaces: number | null; status: "pending" | "accepted" | "rejected"; memory_id: number | null; created_at: string;
}

export class MemoryReview {
	readonly p: Planner;
	constructor(p: Planner) { this.p = p; }
	list() {
		return this.p.all<MemoryProposal>(`select * from memory_proposals where status='pending'${this.p.ws()} order by id desc`).map((r) => ({ ...r }));
	}
	propose(input: { topic: MemoryTopic; fact: string; source: string; replaces?: number | null }) {
		if (!MEMORY_TOPICS.includes(input.topic) || !input.fact.trim() || input.fact.length > 4000 || !input.source.trim() || input.source.length > 500)
			throw new GaamError("INVALID", "A valid topic, fact (1–4000 characters) and source (1–500 characters) are required.");
		if (input.replaces != null && !this.p.one("select 1 from memories where id=?", input.replaces)) throw new GaamError("NOT_FOUND", "Memory not found. Call memory_list.");
		const existing = this.list().find((m) => normalize(m.fact) === normalize(input.fact) && m.replaces === (input.replaces ?? null));
		if (existing) return existing;
		const id = this.p.insert("memory_proposals", { ...input, fact: input.fact.trim(), workspace_id: this.p.targetWorkspace() });
		this.p.log("memory.proposed", "memory_proposal", id, input.fact);
		return { ...this.p.one<MemoryProposal>("select * from memory_proposals where id=?", id)! };
	}
	review(id: number, accept: boolean) {
		return tx(this.p.db, () => {
			const m = this.p.one<MemoryProposal>(`select * from memory_proposals where id=?${this.p.ws()}`, id);
			if (!m) throw new GaamError("NOT_FOUND", "Proposal not found in this workspace. Call memory_proposals.");
			if (m.status !== "pending") return { ...m };
			const memory = accept ? (m.replaces == null ? this.p.remember(m.topic, m.fact, m.source) : this.p.updateMemory(m.replaces, { fact: m.fact, topic: m.topic, source: m.source })) : null;
			this.p.run("update memory_proposals set status=?, memory_id=? where id=?", accept ? "accepted" : "rejected", memory?.id ?? null, id);
			this.p.log(accept ? "memory.accepted" : "memory.rejected", "memory_proposal", id, m.fact);
			return { ...this.p.one<MemoryProposal>("select * from memory_proposals where id=?", id)! };
		});
	}
}
