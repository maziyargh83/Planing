import { openDb } from "../src/core/db.ts";
import { Planner } from "../src/core/planner.ts";
import { Recall } from "../src/retrieval/recall.ts";
import { seedEvaluation } from "./fixtures.ts";

export default class GaamEvaluation {
	constructor(options) { this.config = options.config ?? {}; }
	id() { return this.config.semantic ? "gaam:semantic" : "gaam:retrieval"; }
	async callApi(prompt, context) {
		const db = openDb(":memory:");
		try {
			const p = new Planner(db, "eval");
			seedEvaluation(p);
			const scoped = p.in(context?.vars?.workspace ?? "snappfood");
			const result = await new Recall(scoped, undefined, Boolean(this.config.semantic)).search(prompt, 5);
			if (this.config.semantic && result.mode !== "hybrid") return { error: result.warning ?? "Semantic retrieval did not run" };
			return { output: JSON.stringify({ mode: result.mode, sources: result.hits.map((h) => ({ title: h.title, text: h.text, href: h.href })) }) };
		} catch (error) { return { error: error.message }; }
		finally { db.close(); }
	}
}
