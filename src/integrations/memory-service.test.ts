import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../storage/db.ts";
import { Planner } from "../domain/planner.ts";
import { Knowledge } from "../domain/knowledge.ts";
import { MemoryService } from "./memory-service.ts";
import { RunTrace } from "../ai/observability.ts";

test("Mem0 results stay pending and Graphiti results require current, scoped local provenance", async (t) => {
	const db = openDb(":memory:"); t.after(() => db.close());
	const prior = process.env.GAAM_MEMORY_URL;
	process.env.GAAM_MEMORY_URL = "http://sidecar.test";
	t.after(() => { if (prior === undefined) delete process.env.GAAM_MEMORY_URL; else process.env.GAAM_MEMORY_URL = prior; });
	const requests: { url: string; body: Record<string, unknown> }[] = [];
	t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)); requests.push({ url, body });
		const result = url.endsWith("/extract") ? { facts: [{ fact: "ترجیح فارسی", topic: "preference" }] } :
			url.endsWith("/episodes") ? { episode_id: "episode-1" } : { facts: [{ fact: "historical commitment", episode_ids: ["episode-1"] }, { fact: "unknown", episode_ids: ["untrusted"] }] };
		return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
	});
	const p = new Planner(db).in("snappfood");
	const service = new MemoryService(p);
	const proposals = await service.extract("فارسی را ترجیح می‌دهم", "user:1");
	assert.equal(proposals.length, 1); assert.equal(p.listMemories().length, 0);
	const doc = new Knowledge(p).save({ title: "Commitment", body: "current local source" });
	await service.graphPublish(`docs:${doc.id}`);
	assert.equal(requests[1]!.body.namespace, requests[0]!.body.namespace);
	assert.equal(((await service.graphSearch("commitment")).facts as unknown[]).length, 1);
	assert.equal(((await new MemoryService(p.in("personal")).graphSearch("commitment")).facts as unknown[]).length, 0);
	new Knowledge(p).save({ id: doc.id, body: "changed" });
	assert.equal(((await service.graphSearch("commitment")).facts as unknown[]).length, 0);
});

test("Langfuse export contains diagnostics but never prompts, source bodies or credentials", async (t) => {
	const db = openDb(":memory:"); t.after(() => db.close());
	const keys = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"];
	const prior = keys.map((key) => process.env[key]);
	keys.forEach((key, i) => { process.env[key] = ["public", "secret", "http://langfuse.test"][i]; });
	t.after(() => keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; }));
	let sent = "";
	t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { sent = String(init.body); return new Response("{}", { status: 200 }); });
	const p = new Planner(db);
	const thread = p.insert("threads", { title: "PRIVATE_BODY", provider: "test" });
	const trace = new RunTrace(p, thread, "test");
	await trace.finish("stop", { sourceIds: ["docs:1"], contextTokens: 10 });
	assert.match(sent, /trace-create/); assert.ok(!sent.includes("PRIVATE_BODY")); assert.ok(!sent.includes("secret"));
	assert.equal(p.one<{ status: string }>("select status from ai_traces where id=?", trace.id)!.status, "stop");
});
