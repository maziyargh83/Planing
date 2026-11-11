import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { Assistant } from "../../ai/assistant.ts";
import type { ChatEvent } from "../../ai/protocol.ts";
import { Scheduler } from "../../ai/automations.ts";
import { startOllama } from "../../ai/providers/index.ts";
import { context, insights, nudges } from "../../domain/coach.ts";
import { openDb } from "../../storage/db.ts";
import { formatStandup, Growth } from "../../domain/growth.ts";
import { Knowledge } from "../../domain/knowledge.ts";
import { standupContext, teamStatus } from "../../integrations/standup.ts";
import { Planner } from "../../domain/planner.ts";
import { GaamError } from "../../domain/types.ts";
import { branchName, detectRepos, gitActivity, gitSync, integrationStatus, openReviews } from "../../integrations/git.ts";
import { overview } from "../../integrations/overview.ts";
import { configureBoard, jiraBoardInfo, jiraBoardSync, jiraPull, jiraSearch, savedBoard } from "../../integrations/jira.ts";
import { createMcpServer } from "../mcp/server.ts";
import { extensionOrigins, originAllowed } from "./origin.ts";

process.chdir(new URL("../../..", import.meta.url).pathname);

const PORT = Number(process.env.GAAM_PORT ?? 4777);
const HOST = process.env.GAAM_HOST ?? "127.0.0.1";
const db = openDb();
const base = new Planner(db, "me");
const assistant = new Assistant(db);
const scheduler = new Scheduler(assistant);
if (process.env.GAAM_SCHEDULER !== "0") scheduler.start();

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
	"recallSearch", "recallSource", "recallStatus", "recallReindex",
	"memoryPropose", "memoryProposals", "memoryReview", "memoryHistory", "memoryExtract", "memoryServiceStatus",
	"graphPublish", "graphSearch", "workflowCreate", "workflowGet", "workflowList", "workflowAdvance", "aiTraces",
]);

/** RPC methods beyond the Planner, bound to one request's workspace scope. */
function extras(me: Planner): Record<string, (...args: never[]) => unknown> {
	const growth = new Growth(me);
	const knowledge = new Knowledge(me);
	return {
	context: () => context(me),
	insights: (days?: number) => ({ ...insights(me, days ?? 7), nudges: nudges(me) }),
	integrations: () => ({ ...integrationStatus(), jira_url: process.env.JIRA_URL?.replace(/\/$/, "") || null, mcp: `http://localhost:${PORT}/mcp`, root: process.cwd() }),
	jiraSearch: (jql: string) => jiraSearch(jql),
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
	gitReviews: () => openReviews(me),
	gitSync: () => gitSync(me),
	branchName: (task: string) => branchName(me.resolveTask(task)),
	aiStatus: () => assistant.status(),
	setSetting: (key: string, value: string | null) => assistant.store.setSetting(key, value),
	aiLimits: () => assistant.limits(),
	saveAiLimits: (patch: Parameters<Assistant["saveLimits"]>[0]) => assistant.saveLimits(patch),
	threads: () => assistant.store.threads(),
	thread: (id: number) => ({ ...assistant.store.thread(id), running: assistant.running().includes(id) }),
	deleteThread: (id: number) => assistant.store.deleteThread(id),
	stopThread: (id: number) => assistant.stop(id),
	renameThread: (id: number, title: string) => assistant.store.updateThread(id, { title }),
	pinThread: (id: number, pinned: boolean) => assistant.store.updateThread(id, { pinned: pinned ? 1 : 0 }),
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
	workspaces: () => me.listWorkspaces(),
	saveWorkspace: (input: Parameters<Planner["saveWorkspace"]>[0]) => me.saveWorkspace(input),
	detectRepos: () => detectRepos(me),
	overview: () => overview(me),
	};
}


const app = new Hono();

const EXTENSIONS = extensionOrigins(process.env.GAAM_EXTENSION_ORIGIN);

/** Only same-machine pages (and Gaam's own new-tab extension, when named) may talk to the API: blocks DNS-rebinding and drive-by requests. */
app.use("*", async (c, next) => {
	if (!originAllowed(c.req.header("origin"), EXTENSIONS)) return c.text("Forbidden origin", 403);
	const token = process.env.GAAM_TOKEN;
	if (token && c.req.path.startsWith("/mcp") && c.req.header("authorization") !== `Bearer ${token}`)
		return c.text("Unauthorized", 401);
	await next();
});

/** The planner for a request: scoped to the UI's workspace header, or all workspaces. */
function scoped(workspace?: string | null): Planner {
	try {
		return base.in(workspace || null);
	} catch {
		return base;
	}
}

app.post("/api/rpc", async (c) => {
	const { method, args = [] } = await c.req.json<{ method: string; args?: unknown[] }>();
	try {
		const me = scoped(c.req.header("x-gaam-workspace"));
		const extra = extras(me);
		let result: unknown;
		if (PLANNER_METHODS.has(method)) result = await (me as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!(...args);
		else if (extra[method]) result = await (extra[method] as (...a: unknown[]) => unknown)(...args);
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
	const kind = typeof form.kind === "string" && form.kind ? (form.kind as import("../../domain/knowledge.ts").DocKind) : undefined;
	const docs = [];
	const knowledge = new Knowledge(scoped(c.req.header("x-gaam-workspace")));
	for (const file of files) docs.push(await knowledge.ingestUpload(file.name, new Uint8Array(await file.arrayBuffer()), { kind }));
	return c.json({ data: docs });
});

const chatError = (error: unknown) => ({ error: { code: (error as GaamError).code ?? "INTERNAL", message: (error as Error).message } });

app.post("/api/assistant", async (c) => {
	const body = await c.req.json<Parameters<Assistant["send"]>[0]>();
	if (!body.text?.trim()) return c.json({ error: { code: "INVALID", message: "Empty message" } }, 400);
	try {
		const { thread, messageId } = await assistant.send({ ...body, text: body.text.trim(), workspace: c.req.header("x-gaam-workspace") || null });
		return c.json({ data: { thread, messageId } });
	} catch (error) {
		return c.json(chatError(error), 400);
	}
});

app.post("/api/assistant/:id/regenerate", async (c) => {
	const body = await c.req.json<Parameters<Assistant["regenerate"]>[1]>().catch(() => ({}));
	try {
		const { thread, messageId } = await assistant.regenerate(Number(c.req.param("id")), body);
		return c.json({ data: { thread, messageId } });
	} catch (error) {
		return c.json(chatError(error), 400);
	}
});

app.post("/api/assistant/:id/fork", async (c) => {
	const { messageId } = await c.req.json<{ messageId: number }>();
	try {
		return c.json({ data: { thread: assistant.fork(Number(c.req.param("id")), messageId).id } });
	} catch (error) {
		return c.json(chatError(error), 400);
	}
});

app.post("/api/assistant/:id/approve", async (c) => {
	const { toolCallId, ok } = await c.req.json<{ toolCallId: string; ok: boolean }>();
	try {
		return c.json({ data: assistant.approve(Number(c.req.param("id")), toolCallId, ok) });
	} catch (error) {
		return c.json(chatError(error), 404);
	}
});

app.post("/api/assistant/:id/stop", (c) => c.json({ data: assistant.stop(Number(c.req.param("id"))) }));

/**
 * Streams the live turn of a thread as protocol events. `after` resumes from a
 * sequence number, so a reconnecting client misses nothing.
 */
app.get("/api/assistant/:id/stream", (c) =>
	streamSSE(c, async (stream) => {
		const id = Number(c.req.param("id"));
		const after = Number(c.req.query("after") ?? 0);
		const queue: { seq: number; event: ChatEvent }[] = [];
		let wake: (() => void) | null = null;
		const sub = assistant.subscribe(id, after, (seq, event) => {
			queue.push({ seq, event });
			wake?.();
		});
		stream.onAbort(() => {
			sub.unsubscribe();
		});
		await stream.writeSSE({ event: "state", data: JSON.stringify({ running: sub.running, messageId: sub.messageId }) });
		queue.unshift(...sub.backlog);
		if (!sub.running && !queue.length) {
			sub.unsubscribe();
			return;
		}
		for (;;) {
			while (queue.length) {
				const item = queue.shift()!;
				await stream.writeSSE({ event: "chat", id: String(item.seq), data: JSON.stringify(item) });
				if (item.event.type === "finish") {
					sub.unsubscribe();
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
		let last = Number(c.req.query("since") ?? base.lastEventId());
		let alive = true;
		stream.onAbort(() => {
			alive = false;
		});
		while (alive) {
			const events = base.events(last, 100);
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
	const server = createMcpServer(db, c.req.query("as") ?? c.req.header("x-gaam-actor") ?? "http-agent", undefined, c.req.query("ws") ?? null);
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

// Files saved before Gaam could read their format (PDFs, for one) get their text now.
void new Knowledge(base)
	.backfillText()
	.then((ids) => ids.length && console.log(`Extracted text for docs ${ids.map((id) => `#${id}`).join(", ")}`))
	.catch(() => {});
