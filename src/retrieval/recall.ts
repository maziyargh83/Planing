import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Table } from "@lancedb/lancedb";
import { tx, type Db } from "../storage/db.ts";
import type { Planner } from "../domain/planner.ts";
import { GaamError } from "../domain/types.ts";
import { chunks, digest, normalize, terms } from "./text.ts";
import { ollamaEmbeddings, type Embeddings } from "./embeddings.ts";

export interface Source {
	id: string; entity: string; entity_id: number; workspace_id: number | null;
	title: string; body: string; hash: string; updated_at: string; href: string;
}
export interface Hit {
	id: string; source_id: string; title: string; text: string; href: string;
	entity: string; entity_id: number; source_hash: string; updated_at: string; score: number;
}
export interface SearchResult { hits: Hit[]; mode: "hybrid" | "keyword"; warning: string | null; pending: number }
interface Chunk { id: string; source_id: string; workspace_id: number | null; title: string; body: string; hash: string; ordinal: number }
const tables = ["docs", "tasks", "projects", "goals", "people", "followups", "decisions", "memories", "journal"] as const;
const localPaths = new WeakMap<Db, string>();
const locks = new WeakMap<Db, Promise<unknown>>();
const cooling = new WeakMap<Db, { until: number; reason: string }>();

async function exclusive<T>(db: Db, fn: () => Promise<T>): Promise<T> {
	const before = locks.get(db) ?? Promise.resolve();
	const next = before.catch(() => {}).then(fn);
	locks.set(db, next);
	return next;
}

/** SQLite owns sources and validity; LanceDB is a disposable, local derived index. */
export class Recall {
	readonly p: Planner;
	readonly embeddings: Embeddings;
	readonly semantic: boolean;
	constructor(p: Planner, embeddings = ollamaEmbeddings(), semantic = process.env.GAAM_SEMANTIC !== "0") { this.p = p; this.embeddings = embeddings; this.semantic = semantic; }

	private sources(): Source[] {
		const result: Source[] = [];
		for (const table of tables) {
			const global = table === "memories" || table === "journal";
			const rows = this.p.all<Record<string, unknown>>(`select * from ${table} where 1=1${global ? "" : this.p.ws()}`);
			for (const r of rows) {
				const title = String(r.title ?? r.name ?? r.fact ?? r.text ?? r.kind ?? table);
				const fields = ["key", "description", "problem", "hypothesis", "success_metric", "why", "metric", "body", "summary", "context", "options", "choice", "notes", "role", "fact", "text", "status", "due", "direction", "day", "jira_key"];
				const labels: Record<string, string> = { key: "شناسه", status: "وضعیت", due: "مهلت", day: "تاریخ", direction: "جهت پیگیری", jira_key: "Jira", role: "نقش" };
				const body = fields.filter((k) => r[k] != null).map((k) => labels[k] ? `${labels[k]}: ${r[k]}` : String(r[k])).join("\n\n");
				const id = `${table}:${r.id}`;
				result.push({ id, entity: table, entity_id: Number(r.id), workspace_id: global ? null : Number(r.workspace_id), title,
					body, hash: digest(`${r.workspace_id}|${title}|${body}`), updated_at: String(r.updated_at ?? r.created_at),
					href: `#/sources/${encodeURIComponent(id)}` });
			}
		}
		return result;
	}

	sync() {
		const sources = this.sources();
		const live = new Set(sources.map((s) => s.id));
		tx(this.p.db, () => {
			for (const old of this.p.all<{ id: string }>(`select id from recall_sources where 1=1${this.scope()}`)) {
				if (!live.has(old.id)) this.p.run("delete from recall_sources where id = ?", old.id);
			}
			for (const source of sources) {
				if (this.p.one<{ hash: string }>("select hash from recall_sources where id = ?", source.id)?.hash === source.hash) continue;
				this.p.run("delete from recall_sources where id = ?", source.id);
				this.p.insert("recall_sources", source as unknown as Record<string, unknown>);
				for (const [ordinal, body] of chunks(source.body || source.title).entries()) {
					this.p.insert("recall_chunks", { id: digest(`${source.id}|${source.hash}|${ordinal}`).slice(0, 32), source_id: source.id,
						workspace_id: source.workspace_id, title: source.title, body, hash: digest(body), ordinal });
					this.p.run("update recall_fts set title=?, body=? where id=?", normalize(source.title), normalize(body), digest(`${source.id}|${source.hash}|${ordinal}`).slice(0, 32));
				}
			}
		});
		return sources.length;
	}

	private scope(alias = "") {
		return this.p.workspace == null ? "" : ` and (${alias ? `${alias}.` : ""}workspace_id = ${Number(this.p.workspace)} or ${alias ? `${alias}.` : ""}workspace_id is null)`;
	}

	source(id: string): Source {
		this.sync();
		const row = this.p.one<Source>(`select * from recall_sources where id = ?${this.scope()}`, id);
		if (!row) throw new GaamError("NOT_FOUND", "Source unavailable in this workspace. Call recall_search.");
		return { ...row };
	}

	status() {
		this.sync();
		return {
			sources: this.p.one<{ n: number }>(`select count(*) n from recall_sources where 1=1${this.scope()}`)!.n,
			chunks: this.p.one<{ n: number }>(`select count(*) n from recall_chunks where 1=1${this.scope()}`)!.n,
			pending: this.pending().length, model: process.env.GAAM_EMBEDDINGS_MODEL ?? "bge-m3",
			semantic: this.semantic, warning: cooling.get(this.p.db)?.reason ?? null,
		};
	}

	private pending() {
		return this.p.all<Chunk>(`select c.* from recall_chunks c where not exists
			(select 1 from recall_vectors v where v.chunk_id=c.id and v.model=? and v.hash=c.hash)${this.scope("c")}`, this.embeddings.key);
	}

	private async table(dimension: number): Promise<Table> {
		const { connect } = await import("@lancedb/lancedb");
		let path = localPaths.get(this.p.db);
		if (!path) {
			const file = this.p.one<{ file: string }>("pragma database_list")?.file;
			path = process.env.GAAM_VECTOR_PATH ?? (file ? join(dirname(file), `${basename(file)}.vectors`) : join(tmpdir(), `gaam-vectors-${randomUUID()}`));
			localPaths.set(this.p.db, path);
		}
		const conn = await connect(path);
		const name = `chunks_${this.embeddings.key}_${dimension}`;
		if ((await conn.tableNames()).includes(name)) return conn.openTable(name);
		// Seed establishes Arrow's fixed-size vector schema, then is removed.
		const table = await conn.createTable(name, [{ id: "schema", hash: "", workspace: -1, vector: new Array(dimension).fill(0) }], { mode: "exist_ok" });
		await table.delete("id = 'schema'");
		// A deleted derived index must be rebuilt even when SQLite receipts survived.
		this.p.run("delete from recall_vectors where model = ?", this.embeddings.key);
		return table;
	}

	async reindex(signal?: AbortSignal) {
		return exclusive(this.p.db, async () => {
			this.sync();
			const pending = this.pending().slice(0, 64);
			if (!pending.length) return { indexed: 0, pending: 0 };
			const vectors = await this.embeddings.embed(pending.map((c) => `${c.title}\n${c.body}`), signal);
			const table = await this.table(vectors[0]!.length);
			const valid = pending.map((c, i) => ({ c, vector: vectors[i]! })).filter(({ c }) => this.p.one("select 1 from recall_chunks where id=? and hash=?", c.id, c.hash));
			if (valid.length) {
				await table.mergeInsert("id").whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(valid.map(({ c, vector }) => ({ id: c.id, hash: c.hash, workspace: c.workspace_id ?? -1, vector })));
				for (const { c } of valid) this.p.run("insert or replace into recall_vectors values (?,?,?)", c.id, this.embeddings.key, c.hash);
			}
			return { indexed: valid.length, pending: this.pending().length };
		});
	}

	async search(query: string, limit = 8, signal?: AbortSignal): Promise<SearchResult> {
		if (!query.trim() || query.length > 8000 || !Number.isInteger(limit) || limit < 1 || limit > 30) throw new GaamError("INVALID", "Use a nonempty query (max 8000 characters) and limit 1–30.");
		this.sync();
		const tokens = terms(query);
		const lexical = tokens.length ? this.p.all<{ id: string }>(`select c.id from recall_fts f join recall_chunks c on c.id=f.id
			where recall_fts match ?${this.scope("c")} order by bm25(recall_fts, 0, 3, 1) limit 60`, tokens.map((t) => `"${t}"*`).join(" OR ")) : [];
		const ranks = new Map<string, number>();
		lexical.forEach((r, i) => ranks.set(r.id, 1 / (60 + i + 1)));
		let mode: SearchResult["mode"] = "keyword";
		let warning: string | null = null;
		if (this.semantic) {
			try {
				const cooldown = cooling.get(this.p.db);
				if (cooldown && cooldown.until > Date.now()) throw new Error(cooldown.reason);
				const [vector] = await this.embeddings.embed([query], signal);
				const table = await this.table(vector!.length);
				await this.reindex(signal);
				await table.checkoutLatest();
				const stale = (await table.query().select(["id", "hash"]).toArray()).filter((row) => !this.p.one("select 1 from recall_chunks where id=? and hash=?", String(row.id), String(row.hash)));
				for (let i = 0; i < stale.length; i += 500) await table.delete(`id IN (${stale.slice(i, i + 500).map((row) => `'${String(row.id).replaceAll("'", "''")}'`).join(",")})`);
				let search = table.vectorSearch(vector!).distanceType("cosine");
				if (this.p.workspace != null) search = search.where(`workspace = ${Number(this.p.workspace)} OR workspace = -1`);
				const hits = await search.limit(60).toArray();
				hits.forEach((r, i) => {
					// Validate against SQLite: stale/deleted vectors can never become evidence.
					if (Number(r._distance) <= 0.65 && this.p.one(`select 1 from recall_chunks where id=? and hash=?${this.scope()}`, String(r.id), String(r.hash))) ranks.set(String(r.id), (ranks.get(String(r.id)) ?? 0) + 1 / (61 + i));
				});
				mode = "hybrid";
				cooling.delete(this.p.db);
			} catch (error) {
				if (signal?.aborted) throw error;
				warning = "Semantic retrieval unavailable; using keyword search. " + (error as Error).message;
				cooling.set(this.p.db, { until: Date.now() + 30_000, reason: (error as Error).message });
			}
		}
		const seen = new Set<string>();
		const hits: Hit[] = [];
		for (const [id, score] of [...ranks].sort((a, b) => b[1] - a[1])) {
			const c = this.p.one<Chunk>(`select * from recall_chunks where id=?${this.scope()}`, id);
			if (!c || seen.has(c.source_id)) continue;
			const s = this.p.one<Source>("select * from recall_sources where id=?", c.source_id)!;
			seen.add(c.source_id);
			hits.push({ id, source_id: s.id, title: s.title, text: c.body, href: s.href, entity: s.entity, entity_id: s.entity_id, source_hash: s.hash, updated_at: s.updated_at, score });
			if (hits.length >= limit) break;
		}
		return { hits, mode, warning, pending: this.pending().length };
	}
}
