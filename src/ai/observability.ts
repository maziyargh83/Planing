import { randomUUID } from "node:crypto";
import type { Planner } from "../domain/planner.ts";

/** Local traces always work. Export is opt-in and contains metadata only, never prompts/documents. */
export class RunTrace {
	readonly id = randomUUID().replaceAll("-", "");
	readonly p: Planner;
	readonly thread: number;
	readonly provider: string;
	readonly started = new Date();
	constructor(p: Planner, thread: number, provider: string) {
		this.p = p; this.thread = thread; this.provider = provider;
		p.insert("ai_traces", { id: this.id, thread_id: thread, workspace_id: p.workspace, provider, status: "running" });
	}
	async finish(status: string, detail: Record<string, unknown>) {
		this.p.run("update ai_traces set status=?, detail=? where id=?", status, JSON.stringify(detail), this.id);
		const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey, LANGFUSE_BASE_URL: base } = process.env;
		if (!publicKey || !secretKey || !base) return;
		try {
			const response = await fetch(`${base.replace(/\/$/, "")}/api/public/ingestion`, {
				method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` },
				body: JSON.stringify({ batch: [{ id: randomUUID(), timestamp: new Date().toISOString(), type: "trace-create", body: {
					id: this.id, name: "gaam.assistant", timestamp: this.started.toISOString(), sessionId: `gaam-${this.thread}`,
					metadata: { provider: this.provider, workspace: this.p.workspace, status, ...detail },
				} }] }), signal: AbortSignal.timeout(3000),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
		} catch {
			// Preserve a visible diagnostic without exposing exporter credentials or failing a chat.
			this.p.run("update ai_traces set detail=json_set(detail, '$.export', 'failed') where id=?", this.id);
		}
	}
}
