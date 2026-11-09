import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { Growth } from "./growth.ts";
import { localDay, type Planner } from "./planner.ts";
import { GaamError } from "./types.ts";

const run = promisify(execFile);

export const DOC_KINDS = ["meeting", "plan", "doc", "data", "note", "reference"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface Doc {
	id: number;
	title: string;
	kind: DocKind;
	body: string | null;
	summary: string | null;
	source: string | null;
	file_path: string | null;
	mime: string | null;
	day: string | null;
	project_id: number | null;
	tags: string[];
	author: string;
	created_at: string;
	updated_at: string;
}

const FILES = join(homedir(), ".gaam", "files");
const MAX_BODY = 200_000;
const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".json", ".yaml", ".yml", ".log", ".xml", ".sql", ".ts", ".tsx", ".js", ".css"]);
/** Formats macOS `textutil` can turn into plain text. */
const TEXTUTIL_EXT = new Set([".docx", ".doc", ".rtf", ".rtfd", ".odt", ".html", ".htm", ".webarchive", ".wordml"]);

const plain = <T>(row: unknown) => ({ ...(row as object) }) as T;

function hydrate(row: unknown): Doc {
	const d = plain<Doc & { tags: unknown }>(row);
	d.tags = typeof d.tags === "string" ? JSON.parse(d.tags) : [];
	return d;
}

/** Best-effort text from a file on disk. Returns null when the format can't be read locally. */
export async function extractText(file: string): Promise<string | null> {
	const ext = extname(file).toLowerCase();
	if (TEXT_EXT.has(ext)) return readFileSync(file, "utf8").slice(0, MAX_BODY);
	if (TEXTUTIL_EXT.has(ext) && process.platform === "darwin") {
		const { stdout } = await run("textutil", ["-convert", "txt", "-stdout", file], { maxBuffer: 32 * 1024 * 1024 });
		return stdout.slice(0, MAX_BODY);
	}
	return null;
}

export class Knowledge {
	readonly p: Planner;

	constructor(p: Planner) {
		this.p = p;
	}

	doc(id: number) {
		const row = this.p.one("select * from docs where id = ?", id);
		if (!row) throw new GaamError("NOT_FOUND", `Doc #${id} does not exist. Use doc_list or search.`);
		const doc = hydrate(row);
		return {
			...doc,
			people: this.p.all<{ id: number; name: string }>(
				"select pe.id, pe.name from doc_people dp join people pe on pe.id = dp.person_id where dp.doc_id = ?",
				id,
			).map((r) => plain<{ id: number; name: string }>(r)),
			followups: new Growth(this.p).followups().filter((f) => f.doc_id === id),
		};
	}

	docs(filter: { kind?: DocKind; project?: string | number; person?: string | number; limit?: number } = {}) {
		const where = ["1 = 1"];
		const params: (string | number)[] = [];
		if (filter.kind) {
			where.push("d.kind = ?");
			params.push(filter.kind);
		}
		if (filter.project !== undefined) {
			where.push("d.project_id = ?");
			params.push(this.p.resolveProject(filter.project).id);
		}
		if (filter.person !== undefined) {
			where.push("exists (select 1 from doc_people dp where dp.doc_id = d.id and dp.person_id = ?)");
			params.push(new Growth(this.p).resolvePerson(filter.person).id);
		}
		return this.p
			.all(
				`select d.id, d.title, d.kind, d.summary, d.source, d.file_path, d.day, d.tags, d.author, d.created_at, d.updated_at,
					substr(d.body, 1, 280) as preview, length(d.body) as size,
					(select group_concat(pe.name, '، ') from doc_people dp join people pe on pe.id = dp.person_id where dp.doc_id = d.id) as people,
					(select count(*) from followups f where f.doc_id = d.id and f.status = 'open') as open_followups
				from docs d where ${where.join(" and ")} order by coalesce(d.day, d.created_at) desc, d.id desc limit ?`,
				...params,
				filter.limit ?? 100,
			)
			.map(hydrate);
	}

	save(input: {
		id?: number;
		title?: string;
		kind?: DocKind;
		body?: string | null;
		summary?: string | null;
		source?: string | null;
		day?: string | null;
		project?: string | number | null;
		tags?: string[];
		people?: string[];
		file_path?: string | null;
		mime?: string | null;
	}) {
		const { id, project, tags, people, ...rest } = input;
		const values: Record<string, unknown> = { ...rest, body: rest.body?.slice(0, MAX_BODY) };
		if (tags) values.tags = JSON.stringify(tags);
		if (project !== undefined) values.project_id = project == null ? null : this.p.resolveProject(project).id;
		let docId = id;
		if (docId) this.p.patch("docs", docId, values);
		else {
			if (!input.title) throw new GaamError("INVALID", "title is required");
			docId = this.p.insert("docs", { ...values, day: input.day ?? (input.kind === "meeting" ? localDay() : null), author: this.p.actor });
		}
		if (people) {
			const growth = new Growth(this.p);
			this.p.run("delete from doc_people where doc_id = ?", docId);
			for (const name of people) {
				const person = growth.savePerson({ name });
				this.p.run("insert or ignore into doc_people (doc_id, person_id) values (?, ?)", docId, person.id);
			}
		}
		this.p.log(id ? "doc.updated" : "doc.added", "doc", docId, input.title ?? `#${docId}`);
		return this.doc(docId);
	}

	/** Copies a local file into Gaam's file store and indexes its text. */
	async ingestPath(path: string, meta: { title?: string; kind?: DocKind; project?: string | number | null; people?: string[]; tags?: string[] } = {}) {
		const full = resolve(path.replace(/^~(?=\/)/, homedir()));
		if (!full.startsWith(homedir())) throw new GaamError("INVALID", "Only files inside your home folder can be added.");
		if (!statSync(full).isFile()) throw new GaamError("INVALID", `${path} is not a file.`);
		mkdirSync(FILES, { recursive: true });
		const stored = join(FILES, `${Date.now()}-${basename(full)}`);
		copyFileSync(full, stored);
		return this.fromStoredFile(stored, basename(full), meta, full);
	}

	/** Saves an uploaded file and indexes its text. */
	async ingestUpload(name: string, data: Uint8Array, meta: { title?: string; kind?: DocKind; project?: string | number | null; people?: string[] } = {}) {
		mkdirSync(FILES, { recursive: true });
		const stored = join(FILES, `${Date.now()}-${basename(name).replace(/[^\p{L}\p{N}._ -]/gu, "_")}`);
		writeFileSync(stored, data);
		return this.fromStoredFile(stored, name, meta, `upload:${name}`);
	}

	private async fromStoredFile(stored: string, name: string, meta: { title?: string; kind?: DocKind; project?: string | number | null; people?: string[]; tags?: string[] }, source: string) {
		const text = await extractText(stored).catch(() => null);
		return this.save({
			title: meta.title ?? name.replace(/\.[^.]+$/, ""),
			kind: meta.kind ?? (/meeting|جلسه|1on1|۱:۱|sync/i.test(name) ? "meeting" : extname(name).match(/csv|tsv|json/i) ? "data" : "doc"),
			body: text,
			summary: text ? null : "متن این فایل قابل استخراج نبود (مثلاً PDF یا تصویر). خلاصه‌اش را بنویس یا متنش را بچسبان تا دستیار بتواند از آن استفاده کند.",
			source,
			file_path: stored,
			project: meta.project,
			people: meta.people,
			tags: meta.tags,
		});
	}

	remove(id: number) {
		const doc = this.doc(id);
		this.p.run("delete from docs where id = ?", id);
		this.p.log("doc.deleted", "doc", id, doc.title);
		return { deleted: id };
	}
}
