import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { openDb } from "../core/db.ts";
import { boardStatus } from "../integrations/jira.ts";
import { createMcpServer } from "./server.ts";

async function connect() {
	const db = openDb(":memory:");
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await createMcpServer(db).connect(serverSide);
	const client = new Client({ name: "test-agent", version: "1" });
	await client.connect(clientSide);
	const call = async (name: string, args: Record<string, unknown> = {}) => {
		const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
		if (res.isError) throw new Error(res.content[0]!.text);
		const text = res.content[0]!.text;
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	};
	return { db, client, call };
}

test("an agent can take an idea from discovery to a scoped, prioritised plan", async () => {
	const { call, client } = await connect();

	const goal = await call("goal_save", { title: "تجربه جستجوی بهتر", metric: "search CTR %", target: 30, current: 22 });
	const project = await call("project_save", {
		title: "بهبود سرچ و دیسکاوری",
		key: "srch",
		goal: goal.id,
		stage: "discovery",
		problem: "کاربرها چیزی که می‌خواهند را پیدا نمی‌کنند",
	});
	assert.equal(project.key, "SRCH");

	const outline = await call("mindmap_add", {
		project: "SRCH",
		nodes: [
			{ text: "مشکل", kind: "question", children: [{ text: "zero-result rate چقدره؟", kind: "data" }] },
			{ text: "راه‌حل‌ها", kind: "option", children: [{ text: "typo tolerance" }, { text: "synonyms" }] },
		],
	});
	assert.match(outline, /typo tolerance/);

	const [asked] = await call("ask_user", { asks: [{ question: "zero-result rate فعلی؟", kind: "data", project: "SRCH" }] });
	assert.equal(asked.asked_by, "test-agent");

	const tasks = await call("task_create", {
		project: "SRCH",
		tasks: [
			{ title: "Log zero-result queries", estimate_h: 4, subtasks: [{ title: "Add event" }, { title: "Dashboard" }] },
			{ title: "Typo tolerance" },
			{ title: "Personalised ranking" },
		],
	});
	assert.deepEqual(
		tasks.map((t: { key: string }) => t.key),
		["SRCH-1", "SRCH-2", "SRCH-3", "SRCH-4", "SRCH-5"],
	);

	const scored = await call("task_score", {
		scores: [
			{ task: "SRCH-1", impact: 8, confidence: 9, ease: 8 },
			{ task: "SRCH-4", impact: 7, confidence: 6, ease: 7 },
			{ task: "SRCH-5", impact: 9, confidence: 3, ease: 2 },
		],
	});
	assert.equal(scored[0].ice, 57.6);

	await call("scope_set", { in: ["SRCH-1", "SRCH-4"], later: ["SRCH-5"] });
	const bundle = await call("project_get", { project: "srch" });
	assert.deepEqual(bundle.scope.in, ["SRCH-1", "SRCH-4"]);
	assert.deepEqual(bundle.scope.later, ["SRCH-5"]);
	assert.equal(bundle.tasks[0].key, "SRCH-1");
	assert.equal(bundle.tasks[0].children.length, 2);

	const node = bundle.mindmap[1].children[0];
	const fromNode = await call("mindmap_edit", { node: node.id, action: "to_task" });
	assert.equal(fromNode.key, "SRCH-6");

	await call("memory_save", { topic: "preference", fact: "Plans in Persian, codes in English" });
	await call("comment_add", { entity: "project", ref: "SRCH", body: "Start with measurement." });
	await call("task_update", { updates: [{ task: "SRCH-2", status: "done" }, { task: "SRCH-3", status: "done" }] });

	const ctx = await call("gaam_context");
	assert.equal(ctx.profile.length, 1);
	assert.equal(ctx.open_asks.length, 1);
	assert.equal(ctx.week.totals.done, 2);
	assert.equal(ctx.week.alignment, 100);

	const hits = await call("search", { query: "typo" });
	assert.ok(hits.some((h: { entity: string }) => h.entity === "tasks"));

	const guide = await client.callTool({ name: "gaam_guide", arguments: {} });
	assert.match((guide as { content: { text: string }[] }).content[0]!.text, /^# Gaam agent guide/);
	const resource = await client.readResource({ uri: "gaam://guide" });
	assert.match(String((resource.contents[0] as { text: string }).text), /ICE/);

	const prompts = await client.listPrompts();
	assert.ok(prompts.prompts.some((p) => p.name === "idea_to_plan"));
});

test("errors are reported to the agent with a code and a hint", async () => {
	const { client } = await connect();
	const res = (await client.callTool({ name: "task_get", arguments: { task: "NOPE-1" } })) as {
		isError: boolean;
		content: { text: string }[];
	};
	assert.equal(res.isError, true);
	assert.match(res.content[0]!.text, /^NOT_FOUND: .*task_list/);
});

test("focus time flows into the task's actual hours and the day", async () => {
	const { call } = await connect();
	const [task] = await call("task_create", { tasks: [{ title: "Inbox thing", estimate_h: 1 }] });
	assert.equal(task.key, "G-1");
	assert.equal(task.status, "inbox");
	await call("focus", { action: "log", task: "G-1", minutes: 90 });
	const got = await call("task_get", { task: "G-1" });
	assert.equal(got.task.actual_h, 1.5);
	const plan = await call("day_plan", { intention: "ship", top: ["G-1"] });
	assert.equal(plan.top[0].key, "G-1");
	assert.equal(plan.focus_minutes, 90);
});

test("growth: decisions say when to align, stand-ups format, people track contact", async () => {
	const { call } = await connect();
	const d = await call("decision_save", { title: "Decouple search bundle", impact: "high", reversible: false });
	assert.equal(d.mode, "align_first");
	const low = await call("decision_save", { title: "Rename hook", impact: "low", reversible: true });
	assert.equal(low.mode, "decide");
	const s = await call("standup_save", { done: "SRCH-4 merged", next: "SRCH-5", help: "Need API from backend by Wed" });
	assert.match(s.text, /SRCH-4 merged/);
	assert.match(s.text, /ندارم/);
	await call("person_save", { name: "Shayan Mirzaei", relation: "manager", assessor: true });
	let [shayan] = await call("people_list", {});
	assert.equal(shayan.overdue, true);
	await call("interaction_log", { person: "shayan", kind: "one_on_one", note: "Cycle goals" });
	[shayan] = await call("people_list", {});
	assert.equal(shayan.overdue, false);
	assert.equal(shayan.interactions, 1);
	const overview = await call("growth_overview", {});
	assert.equal(overview.decisions.needs_alignment, 1);
	assert.equal(overview.standups.total, 1);
});

test("Jira board columns map onto Gaam statuses", () => {
	assert.equal(boardStatus("Backlog", "new"), "todo");
	assert.equal(boardStatus("In progress", "indeterminate"), "doing");
	assert.equal(boardStatus("Code Review", "indeterminate"), "doing");
	assert.equal(boardStatus("Blocked/Pending", "indeterminate"), "blocked");
	assert.equal(boardStatus("Ready To Release", "indeterminate"), "done");
	assert.equal(boardStatus("Released / Done", "done"), "done");
	assert.equal(boardStatus("Cancelled", "done"), "dropped");
});

test("knowledge and follow-ups: meeting docs link people and follow-ups", async () => {
	const { call } = await connect();
	const doc = await call("doc_save", { title: "1:1 Shaghayegh", kind: "meeting", body: "Talk about CND-639 pending", people: ["Shaghayegh Ahmadi"] });
	assert.equal(doc.people[0].name, "Shaghayegh Ahmadi");
	assert.equal(doc.day.length, 10);
	const f = await call("followup_save", { person: "shaghayegh", direction: "theirs", text: "Unblock CND-639 with backend", doc: doc.id, due: "2000-01-01" });
	assert.equal(f.overdue, true);
	const got = await call("doc_get", { id: doc.id });
	assert.equal(got.followups.length, 1);
	const hits = await call("search", { query: "CND-639" });
	assert.ok(hits.some((h: { entity: string }) => h.entity === "docs"));
	const ctx = await call("standup_context", {});
	assert.equal(ctx.followups.waiting_on_others.length, 1);
	assert.ok(Array.isArray(ctx.format_rules));
});

test("workspaces keep work and personal apart, and 'all' sees both", async () => {
	const { call } = await connect();
	await call("project_save", { title: "Search", key: "SRCH" });
	await call("task_create", { project: "SRCH", tasks: [{ title: "work thing" }] });
	await call("workspace_use", { workspace: "personal" });
	const side = await call("project_save", { title: "2048 Drop", key: "DROP" });
	await call("task_create", { project: "DROP", tasks: [{ title: "cat skins" }] });
	await call("task_create", { tasks: [{ title: "buy domain" }] });
	assert.deepEqual(
		(await call("project_list", {})).map((p: { key: string }) => p.key),
		["DROP"],
	);
	assert.equal((await call("task_list", {})).length, 2);
	await call("workspace_use", { workspace: "snappfood" });
	assert.deepEqual(
		(await call("task_list", {})).map((t: { title: string }) => t.title),
		["work thing"],
	);
	await call("workspace_use", { workspace: "all" });
	assert.equal((await call("task_list", {})).length, 3);
	const { workspaces } = await call("workspace_list", {});
	assert.equal(workspaces.find((w: { key: string }) => w.key === "personal").open_tasks, 2);
	assert.equal(side.key, "DROP");
});

test("recall tools scope sources, review memories and preserve correction history", async (t) => {
	const { call, client, db } = await connect();
	t.after(async () => { await client.close(); db.close(); });
	const doc = await call("doc_save", { title: "Work meeting evidence", body: "unique_work_evidence commitment" });
	const result = await call("recall_search", { query: "unique_work_evidence" });
	assert.equal(result.hits[0].source_id, `docs:${doc.id}`);
	assert.match(result.hits[0].href, /^#\/sources\//);
	await call("workspace_use", { workspace: "personal" });
	assert.equal((await call("recall_search", { query: "unique_work_evidence" })).hits.length, 0);
	await assert.rejects(call("recall_source", { id: `docs:${doc.id}` }), /NOT_FOUND/);
	const first = await call("memory_propose", { topic: "preference", fact: "پاسخ کوتاه", source: "user:1" });
	assert.equal((await call("memory_list")).length, 0);
	await call("memory_review", { id: first.id, accept: true });
	const [memory] = await call("memory_list");
	const correction = await call("memory_propose", { topic: "preference", fact: "پاسخ مفصل", source: "user:2", replaces: memory.id });
	await call("memory_review", { id: correction.id, accept: true });
	await call("memory_review", { id: correction.id, accept: true });
	const history = await call("memory_history", { id: memory.id });
	assert.equal(history.length, 2);
	assert.equal(history[0].fact, "پاسخ کوتاه");
	assert.ok(history[0].valid_until);
	assert.equal(history[1].fact, "پاسخ مفصل");
	assert.equal(history[1].valid_until, null);
	const rejected = await call("memory_propose", { topic: "context", fact: "never accepted", source: "user:3" });
	await call("memory_review", { id: rejected.id, accept: false });
	assert.equal((await call("memory_list")).length, 1);
});

test("workflows resume across MCP clients, validate evidence and publish only once", async (t) => {
	const { call, client, db } = await connect();
	t.after(async () => { await client.close(); db.close(); });
	const doc = await call("doc_save", { title: "Meeting commitment", body: "release_evidence scheduled review" });
	const w = await call("workflow_create", { kind: "meeting", title: "Prepare", query: "release_evidence" });
	await assert.rejects(call("workflow_publish", { id: w.id }), /CONFLICT/);
	const collected = await call("workflow_advance", { id: w.id, action: "collect" });
	assert.equal(collected.evidence.length, 1);
	await call("workflow_advance", { id: w.id, action: "pause" });
	assert.equal((await call("workflow_get", { id: w.id })).status, "paused");
	await call("workflow_advance", { id: w.id, action: "resume" });
	await call("workflow_advance", { id: w.id, action: "draft", draft: `Review [evidence](${collected.evidence[0].href}).` });
	await call("doc_save", { id: doc.id, body: "release_evidence changed" });
	await assert.rejects(call("workflow_publish", { id: w.id }), /Evidence changed/);
	await call("workflow_advance", { id: w.id, action: "collect" });
	await call("workflow_advance", { id: w.id, action: "draft", draft: `Review [evidence](${collected.evidence[0].href}).` });
	const published = await call("workflow_publish", { id: w.id });
	assert.equal(published.status, "published");
	assert.equal((await call("workflow_publish", { id: w.id })).doc_id, published.doc_id);
	await call("workspace_use", { workspace: "personal" });
	await assert.rejects(call("workflow_get", { id: w.id }), /NOT_FOUND/);
});
