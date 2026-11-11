import { tx } from "../storage/db.ts";
import { digest } from "../retrieval/text.ts";
import type { Planner } from "../domain/planner.ts";
import { GaamError, MEMORY_TOPICS, type MemoryTopic } from "../domain/types.ts";

/** Optional local Mem0/Graphiti sidecar. Its output is always a proposal, never an accepted fact. */
export class MemoryService {
	readonly p: Planner;
	constructor(p: Planner) { this.p = p; }
	status() { return { configured: Boolean(process.env.GAAM_MEMORY_URL), automatic: process.env.GAAM_MEMORY_AUTO === "1" }; }
	private async request(path: string, body: unknown, signal?: AbortSignal) {
		const base = process.env.GAAM_MEMORY_URL;
		if (!base) throw new GaamError("INVALID", "Memory sidecar is not configured. Set GAAM_MEMORY_URL; see docs/AI_MEMORY.md.");
		const response = await fetch(`${base.replace(/\/$/, "")}${path}`, { method: "POST", headers: {
			"Content-Type": "application/json", ...(process.env.GAAM_MEMORY_TOKEN ? { Authorization: `Bearer ${process.env.GAAM_MEMORY_TOKEN}` } : {}),
		}, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(path === "/graph/episodes" ? 180_000 : 90_000), ...(signal ? [signal] : [])]) });
		if (!response.ok) throw new Error(`Memory sidecar: HTTP ${response.status}`);
		return response.json() as Promise<Record<string, unknown>>;
	}
	private namespace(workspace?: number) {
		const file = this.p.one<{ file: string }>("pragma database_list")?.file ?? "memory";
		return `gaam-${digest(file).slice(0, 16)}-ws-${workspace ?? this.p.workspace ?? this.p.targetWorkspace()}`;
	}
	async extract(text: string, source: string, signal?: AbortSignal) {
		if (!text.trim() || text.length > 30_000 || !source.trim()) throw new GaamError("INVALID", "Text (max 30000 characters) and source are required.");
		const result = await this.request("/extract", { text, namespace: this.namespace() }, signal);
		if (!Array.isArray(result.facts)) throw new Error("Invalid memory extraction response");
		const candidates = result.facts.slice(0, 12).map((item: unknown) => {
			const fact = item as { fact: string; topic?: MemoryTopic };
			if (typeof fact.fact !== "string") throw new Error("Invalid extracted fact");
			return { fact: fact.fact, topic: MEMORY_TOPICS.includes(fact.topic!) ? fact.topic! : "context" as MemoryTopic, source };
		});
		return tx(this.p.db, () => candidates.map((candidate) => this.p.memoryPropose(candidate)));
	}
	async graphPublish(source: string, signal?: AbortSignal) {
		const item = this.p.recallSource(source);
		if (item.workspace_id == null) throw new GaamError("INVALID", "Graph episodes must belong to a workspace; global personal memories stay local.");
		const known = this.p.one<{ episode_id: string }>("select episode_id from graph_exports where source_id=? and hash=?", item.id, item.hash);
		if (known) return { episode_id: known.episode_id, source_id: item.id };
		const result = await this.request("/graph/episodes", { namespace: this.namespace(item.workspace_id), name: item.title, text: item.body,
			source_id: item.id, reference_time: item.updated_at }, signal);
		if (typeof result.episode_id !== "string") throw new Error("Invalid graph episode response");
		this.p.run("insert or replace into graph_exports values (?,?,?,?)", item.id, item.hash, item.workspace_id, result.episode_id);
		this.p.log("knowledge.graph_published", "knowledge", item.entity_id, item.id);
		return result;
	}
	async graphSearch(query: string, signal?: AbortSignal) {
		if (this.p.workspace == null) throw new GaamError("INVALID", "Choose a workspace with workspace_use before graph_search.");
		if (!query.trim() || query.length > 8000) throw new GaamError("INVALID", "A query is required (max 8000 characters).");
		const result = await this.request("/graph/search", { namespace: this.namespace(), query }, signal);
		if (!Array.isArray(result.facts)) throw new Error("Invalid graph search response");
		const facts = [];
		for (const fact of result.facts as { fact: string; episode_ids: string[]; valid_at?: string; invalid_at?: string }[]) {
			if (!Array.isArray(fact.episode_ids) || typeof fact.fact !== "string") continue;
			const sources = [];
			for (const episode of fact.episode_ids) {
				const receipt = this.p.one<{ source_id: string; hash: string }>(`select source_id, hash from graph_exports where episode_id=?${this.p.ws()}`, episode);
				if (!receipt) continue;
				try { const source = this.p.recallSource(receipt.source_id); if (source.hash === receipt.hash) sources.push({ id: source.id, href: source.href }); } catch { /* Deleted or moved source. */ }
			}
			if (sources.length) facts.push({ fact: fact.fact, valid_at: fact.valid_at, invalid_at: fact.invalid_at, sources });
		}
		return { facts };
	}
}
