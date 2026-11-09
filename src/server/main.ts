import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { Assistant, type LiveEvent } from "../ai/assistant.ts";
import { Scheduler } from "../ai/automations.ts";
import { startOllama } from "../ai/providers.ts";
import { context, insights, nudges } from "../core/coach.ts";
import { openDb } from "../core/db.ts";
import { formatStandup, Growth } from "../core/growth.ts";
import { Knowledge } from "../core/knowledge.ts";
import { standupContext, teamStatus } from "../integrations/standup.ts";
import { Planner } from "../core/planner.ts";
import { GaamError } from "../core/types.ts";
import { branchName, gitActivity, gitSync, integrationStatus, openReviews } from "../integrations/git.ts";
import { configureBoard, jiraBoardInfo, jiraBoardSync, jiraPull, jiraPush, jiraSearch, savedBoard } from "../integrations/jira.ts";
import { createMcpServer } from "../mcp/server.ts";

process.chdir(new URL("../..", import.meta.url).pathname);

const PORT = Number(process.env.GAAM_PORT ?? 4777);
const HOST = process.env.GAAM_HOST ?? "127.0.0.1";
const db = openDb();
const me = new Planner(db, "me");
const growth = new Growth(me);
const knowledge = new Knowledge(me);
const assistant = new Assistant(db);
const scheduler = new Scheduler(assistant).start();

/** Planner methods the web UI may call through /api/rpc. */
const PLANNER_METHODS = new Set([
	"listGoals", "createGoal", "updateGoal", "goalEvidence",
	"listProjects", "createProject", "updateProject", "projectBundle",
	"listTasks", "createTasks", "updateTask", "deleteTask", "taskBundle", "linkTask",
	"addNodes", "updateNode", "deleteNode", "nodeToTask", "mindmap",
	"ask", "answerAsk", "listAsks",
	"comment", "listComments",
	"addJournal", "listJournal", "day", "planDay", "startFocus", "stopFocus", "logFocus",
	"remember", "updateMemory", "forget", "listMemories",
	"search", "events",
]);

const EXTRA: Record<string, (...args: never[]) => unknown> = {
	context: () => context(me),
	insights: (days?: number) => ({ ...insights(me, days ?? 7), nudges: nudges(me) }),
	integrations: () => ({ ...integrationStatus(), mcp: `http://localhost:${PORT}/mcp`, root: process.cwd() }),
	jiraSearch: (jql: string) => jiraSearch(jql),
	jiraPush: (task: string) => jiraPush(me, task),
	jiraPull: () => jiraPull(me),
	jiraBoard: async () => {
		const saved = savedBoard(me);
		return saved ? { saved, info: await jiraBoardInfo(saved.board) } : null;
	},
	jiraBoardSync: () => {
		const saved = savedBoard(me);
		if (!saved) throw new GaamError("INVALID", "No Jira board configured.");
		return jiraBoardSync(me, saved);
	},
	configureBoard: (input: Parameters<typeof configureBoard>[1]) => configureBoard(me, input),
	gitActivity: (since?: string) => gitActivity(me, { since }),
	gitReviews: () => openReviews(),
	gitSync: () => gitSync(me),
	branchName: (task: string) => branchName(me.resolveTask(task)),
	aiStatus: () => assistant.status(),
	setSetting: (key: string, value: string | null) => assistant.store.setSetting(key, value),
	threads: () => assistant.store.threads(),
	thread: (id: number) => ({ ...assistant.store.thread(id), running: assistant.running().includes(id) }),
	deleteThread: (id: number) => assistant.store.deleteThread(id),
	stopThread: (id: number) => assistant.stop(id),
	latestBrief: () => assistant.store.latestFrom("morning-brief"),
	automations: () => scheduler.list(),
	saveAutomation: (input: Parameters<Scheduler["save"]>[0]) => scheduler.save(input),
	deleteAutomation: (id: number) => assistant.store.deleteAutomation(id),
	runAutomation: (id: number) => {
		scheduler.run(id).catch(() => {});
		return { started: id };
	},
	startOllama: () => startOllama(),
	growth: () => growth.cycle(),
	people: (filter?: Parameters<Growth["people"]>[0]) => growth.people(filter),
	person: (ref: string | number) => growth.personBundle(ref),
	savePerson: (input: Parameters<Growth["savePerson"]>[0]) => growth.savePerson(input),
	logInteraction: (input: Parameters<Growth["logInteraction"]>[0]) => growth.logInteraction(input),
	decisions: (filter?: Parameters<Growth["decisions"]>[0]) => growth.decisions(filter),
	saveDecision: (input: Parameters<Growth["saveDecision"]>[0]) => growth.saveDecision(input),
	standup: (day?: string) => ({ ...growth.standup(day), text: formatStandup(growth.standup(day)), stats: growth.standupStats() }),
	saveStandup: (input: Parameters<Growth["saveStandup"]>[0]) => growth.saveStandup(input),
	standups: () => growth.standups(),
	standupContext: () => standupContext(me),
	teamStatus: () => teamStatus(me),
	followups: (filter?: Parameters<Growth["followups"]>[0]) => growth.followups(filter),
	saveFollowup: (input: Parameters<Growth["saveFollowup"]>[0]) => growth.saveFollowup(input),
	docs: (filter?: Parameters<Knowledge["docs"]>[0]) => knowledge.docs(filter),
	doc: (id: number) => knowledge.doc(id),
	saveDoc: (input: Parameters<Knowledge["save"]>[0]) => knowledge.save(input),
	deleteDoc: (id: number) => knowledge.remove(id),
};

const app = new Hono();

/** Only same-machine pages may talk to the API: blocks DNS-rebinding and drive-by requests. */
app.use("*", async (c, next) => {
	const origin = c.req.header("origin");
	if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return c.text("Forbidden origin", 403);
	const token = process.env.GAAM_TOKEN;
	if (token && c.req.path.startsWith("/mcp") && c.req.header("authorization") !== `Bearer ${token}`)
		return c.text("Unauthorized", 401);
	await next();
});

app.post("/api/rpc", async (c) => {
	const { method, args = [] } = await c.req.json<{ method: string; args?: unknown[] }>();
	try {
		let result: unknown;
		if (PLANNER_METHODS.has(method)) result = await (me as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!(...args);
		else if (EXTRA[method]) result = await (EXTRA[method] as (...a: unknown[]) => unknown)(...args);
		else return c.json({ error: { code: "INVALID", message: `Unknown method ${method}` } }, 400);
		return c.json({ data: result ?? null });
	} catch (error) {
		const code = error instanceof GaamError ? error.code : "INTERNAL";
		return c.json({ error: { code, message: (error as Error).message } }, code === "NOT_FOUND" ? 404 : 400);
	}
});

app.post("/api/files", async (c) => {
	const form = await c.req.parseBody({ all: true });
	const files = ([] as unknown[]).concat(form.file ?? []).filter((f): f is File => f instanceof File);
	if (!files.length) return c.json({ error: { code: "INVALID", message: "No file" } }, 400);
	const kind = typeof form.kind === "string" && form.kind ? (form.kind as import("../core/knowledge.ts").DocKind) : undefined;
	const docs = [];
	for (const file of files) docs.push(await knowledge.ingestUpload(file.name, new Uint8Array(await file.arrayBuffer()), { kind }));
	return c.json({ data: docs });
});

app.post("/api/assistant", async (c) => {
	const body = await c.req.json<{ thread?: number; text: string; provider?: string; model?: string | null }>();
	if (!body.text?.trim()) return c.json({ error: { code: "INVALID", message: "Empty message" } }, 400);
	try {
		const { thread } = await assistant.send({ ...body, text: body.text.trim() });
		return c.json({ data: { thread } });
	} catch (error) {
		return c.json({ error: { code: (error as GaamError).code ?? "INTERNAL", message: (error as Error).message } }, 400);
	}
});

/** Streams one assistant turn: a snapshot first, then text and tool events until done. */
app.get("/api/assistant/:id/stream", (c) =>
	streamSSE(c, async (stream) => {
		const id = Number(c.req.param("id"));
		const queue: LiveEvent[] = [];
		let wake: (() => void) | null = null;
		const { snapshot, unsubscribe } = assistant.subscribe(id, (event) => {
			queue.push(event);
			wake?.();
		});
		stream.onAbort(() => {
			unsubscribe();
		});
		await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });
		if (!snapshot.running) {
			unsubscribe();
			return;
		}
		for (;;) {
			while (queue.length) {
				const event = queue.shift()!;
				await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
				if (event.type === "done") {
					unsubscribe();
					return;
				}
			}
			await new Promise<void>((resolve) => {
				wake = resolve;
				setTimeout(resolve, 15e3);
			});
			wake = null;
			if (!queue.length) await stream.writeSSE({ event: "ping", data: "" });
		}
	}),
);

/** Live activity feed. Any process writing to the database (the stdio MCP server included) shows up here. */
app.get("/api/stream", (c) =>
	streamSSE(c, async (stream) => {
		let last = Number(c.req.query("since") ?? me.lastEventId());
		let alive = true;
		stream.onAbort(() => {
			alive = false;
		});
		while (alive) {
			const events = me.events(last, 100);
			for (const event of events) {
				await stream.writeSSE({ data: JSON.stringify(event), event: "change", id: String(event.id) });
				last = event.id;
			}
			if (!events.length) await stream.writeSSE({ data: "", event: "ping" });
			await stream.sleep(events.length ? 50 : 1000);
		}
	}),
);

app.all("/mcp", async (c) => {
	const server = createMcpServer(db, c.req.query("as") ?? c.req.header("x-gaam-actor") ?? "http-agent");
	const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
	await server.connect(transport);
	const response = await transport.handleRequest(c.req.raw);
	void server.close();
	return response;
});

app.use("/*", serveStatic({ root: "./web/dist" }));
app.get("*", serveStatic({ path: "./web/dist/index.html" }));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, ({ port }) => {
	console.log(`گام · Gaam  →  http://localhost:${port}   (MCP: http://localhost:${port}/mcp)`);
});
