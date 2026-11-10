import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../core/db.ts";
import { Planner } from "../core/planner.ts";
import { Knowledge } from "../core/knowledge.ts";
import { Recall } from "./recall.ts";
import { chunks, normalize } from "./text.ts";
import type { Embeddings } from "./embeddings.ts";

const embeddings: Embeddings = { key: "testvectors", async embed(texts) {
	return texts.map((s) => /leader|لید|جلسه/.test(s) ? [1, 0, 0] : /secret|خصوصی/.test(s) ? [0, 1, 0] : [0, 0, 1]);
} };

test("hybrid retrieval finds synonyms, filters before ranking and rejects changed/deleted vectors", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "gaam-recall-test-"));
	const db = openDb(join(dir, "test.db"));
	t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
	const work = new Planner(db).in("snappfood");
	const personal = work.in("personal");
	const doc = new Knowledge(work).save({ title: "جلسه با لید", body: "تعهد دادم خطای سرچ را بررسی کنم." });
	new Knowledge(personal).save({ title: "secret leader", body: "خصوصی" });
	const recall = new Recall(work, embeddings, true);
	let result = await recall.search("leader");
	assert.equal(result.mode, "hybrid");
	assert.equal(result.hits.length, 1);
	assert.equal(result.hits[0]!.entity_id, doc.id);
	assert.equal(result.hits[0]!.source_id, `docs:${doc.id}`);
	assert.throws(() => new Recall(personal, embeddings, true).source(`docs:${doc.id}`), /workspace/);
	new Knowledge(work).save({ id: doc.id, title: "استقلال", body: "موضوع کاملاً تازه" });
	result = await recall.search("leader");
	assert.equal(result.hits.length, 0, "old vector must not leak changed evidence");
	new Knowledge(work).remove(doc.id);
	assert.equal((await recall.search("leader")).hits.length, 0);
	assert.throws(() => recall.source(`docs:${doc.id}`), /unavailable/);
});

test("rebuilds a missing LanceDB index and separates embedding models", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "gaam-rebuild-test-"));
	const db = openDb(join(dir, "test.db"));
	t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
	const p = new Planner(db).in("snappfood");
	new Knowledge(p).save({ title: "جلسه", body: "بررسی تعهدها" });
	const recall = new Recall(p, embeddings, true);
	assert.equal((await recall.search("leader")).hits.length, 1);
	rmSync(join(dir, "test.db.vectors"), { recursive: true, force: true });
	assert.equal((await recall.search("leader")).hits.length, 1);
	const other = new Recall(p, { ...embeddings, key: "differentmodel" }, true);
	assert.equal(other.status().pending, 1);
	assert.equal((await other.search("leader")).hits.length, 1);
});

test("keyword fallback normalizes Persian and remains useful when the model is unavailable", async (t) => {
	const db = openDb(":memory:"); t.after(() => db.close());
	const p = new Planner(db).in("personal");
	new Knowledge(p).save({ title: "يك كتاب", body: "كتاب‌ها و برنامهٔ فردا" });
	const offline = new Recall(p, { key: "offline", async embed() { throw new Error("offline"); } }, true);
	const result = await offline.search("کتاب");
	assert.equal(result.mode, "keyword"); assert.match(result.warning!, /offline/);
	assert.equal(result.hits.length, 1);
	assert.equal(normalize("مي‌كنم ۱۲"), "می کنم 12");
	assert.equal(chunks("x".repeat(4000)).length, 4);
});
