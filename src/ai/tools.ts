import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { Db } from "../storage/db.ts";
import { createMcpServer } from "../transports/mcp/server.ts";

export interface ToolDef {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	readOnly: boolean;
}

export interface ToolResult {
	ok: boolean;
	/** Parsed JSON when the tool returned JSON, else the raw text. Shown in the UI. */
	output: unknown;
	/** What goes back to the model. */
	text: string;
	ms: number;
}

/** Tools that change or remove data the user may care about; API-driven providers ask before running them. */
const DESTRUCTIVE = new Set(["task_delete", "doc_delete", "memory_forget", "jira_import", "memory_review", "memory_save", "workflow_publish", "graph_publish", "memory_extract"]);

export function needsApproval(name: string, input: unknown): boolean {
	if (DESTRUCTIVE.has(name)) return true;
	return name === "mindmap_edit" && (input as { action?: string } | null)?.action === "delete";
}

export const DESTRUCTIVE_TOOLS = [...DESTRUCTIVE];

const MAX_RESULT_CHARS = 24_000;

/** Gaam's own MCP server, connected in-process, as a set of callable tools for one chat run. */
export class ToolBridge {
	private client: Client;
	tools: ToolDef[] = [];

	private constructor(client: Client) {
		this.client = client;
	}

	static async open(db: Db, actor: string, workspace: string | null): Promise<ToolBridge> {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await createMcpServer(db, actor, undefined, workspace).connect(serverSide);
		const client = new Client({ name: actor, version: "1" });
		await client.connect(clientSide);
		const bridge = new ToolBridge(client);
		const { tools } = await client.listTools();
		bridge.tools = tools
			.map((t) => ({
				name: t.name,
				description: t.description ?? "",
				inputSchema: t.inputSchema as Record<string, unknown>,
				readOnly: Boolean(t.annotations?.readOnlyHint),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		return bridge;
	}

	/** Runs a tool. Gaam's MCP server validates the arguments against the tool's schema and reports failures as errors. */
	async call(name: string, args: unknown): Promise<ToolResult> {
		const started = Date.now();
		if (!this.tools.some((t) => t.name === name)) {
			return { ok: false, output: `Unknown tool ${name}`, text: `Unknown tool ${name}. Available: ${this.tools.map((t) => t.name).join(", ")}`, ms: 0 };
		}
		try {
			const res = (await this.client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> })) as {
				isError?: boolean;
				content: { type: string; text?: string }[];
			};
			const raw = res.content.map((c) => c.text ?? "").join("\n");
			let output: unknown = raw;
			try {
				output = JSON.parse(raw);
			} catch {}
			const text = raw.length > MAX_RESULT_CHARS ? `${raw.slice(0, MAX_RESULT_CHARS)}\n…[truncated ${raw.length - MAX_RESULT_CHARS} chars]` : raw;
			return { ok: !res.isError, output, text, ms: Date.now() - started };
		} catch (error) {
			const message = (error as Error).message;
			return { ok: false, output: message, text: message, ms: Date.now() - started };
		}
	}

	async close() {
		await this.client.close().catch(() => {});
	}
}
