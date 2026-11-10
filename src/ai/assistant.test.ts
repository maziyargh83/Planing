import type { RunContext } from "./providers/shared.ts";
import type { Part } from "./protocol.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../core/db.ts";
import { Planner } from "../core/planner.ts";
import { Knowledge } from "../core/knowledge.ts";
import { Assistant } from "./assistant.ts";
import { PROVIDERS } from "./providers/index.ts";

test("assistant delivers, persists and replays grounded sources and rejects cross-workspace continuation", async (t) => {
	const db = openDb(":memory:"); t.after(() => db.close());
	const p = new Planner(db).in("snappfood");
	new Knowledge(p).save({ title: "release", body: "release evidence from the user's meeting" });
	t.mock.method(PROVIDERS.ollama!, "run", async (ctx: RunContext) => {
		assert.match(ctx.prompt, /retrieved_context/);
		assert.match(ctx.prompt, /sources\/docs%3A1/);
		assert.ok(ctx.tools.tools.some((tool: { name: string }) => tool.name === "workflow_create"));
		ctx.emit({ type: "text-delta", id: "a", delta: "Review [source](#/sources/docs%3A1)." });
		return { finish: "stop" };
	});
	const assistant = new Assistant(db);
	const result = await assistant.send({ text: "release", provider: "ollama", workspace: "snappfood" });
	await result.done;
	const message = assistant.store.thread(result.thread).messages.at(-1)!;
	assert.equal((message.parts as Part[])[0]!.type, "sources");
	assert.match(message.content, /source/);
	assert.equal(message.meta.running, false);
	assert.ok(assistant.subscribe(result.thread, 0, () => {}).backlog.some((e) => e.event.type === "sources"));
	assert.equal(p.aiTraces().length, 1);
	await assert.rejects(assistant.send({ thread: result.thread, text: "hello", workspace: "personal" }), /another workspace/);
	assert.equal(assistant.store.thread(result.thread).messages.length, 2);
});
