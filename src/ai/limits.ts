import type { Db } from "../core/db.ts";
import { GaamError } from "../core/types.ts";

/**
 * The user's assistant limits: per-response and per-turn caps the providers
 * honour, and spending budgets checked before a turn starts. Stored in the
 * settings table under ai.*; absent keys fall back to DEFAULTS.
 */
export interface AiLimits {
	/** max_tokens per model response (Claude API). */
	maxTokens: number;
	/** Model ↔ tool round trips in one turn (Claude API loop, Claude Code --max-turns). */
	maxSteps: number;
	/** Show a summary of the model's reasoning, or keep it hidden. Thinking itself can't be turned off on current models. */
	thinkingDisplay: "summarized" | "omitted";
	/** Output tokens one turn may generate across all its steps; null = no cap. */
	turnTokens: number | null;
	/** Claude API spend per local day / month in USD; null = no budget. */
	dailyUsd: number | null;
	monthlyUsd: number | null;
	/** Tokens (input + output, every provider) per local day; null = no budget. */
	dailyTokens: number | null;
}

export const DEFAULTS: AiLimits = {
	maxTokens: 64_000,
	maxSteps: 16,
	thinkingDisplay: "summarized",
	turnTokens: null,
	dailyUsd: null,
	monthlyUsd: null,
	dailyTokens: null,
};

const KEYS: Record<keyof AiLimits, string> = {
	maxTokens: "ai.max_tokens",
	maxSteps: "ai.max_steps",
	thinkingDisplay: "ai.thinking_display",
	turnTokens: "ai.turn_tokens",
	dailyUsd: "ai.daily_usd",
	monthlyUsd: "ai.monthly_usd",
	dailyTokens: "ai.daily_tokens",
};

/** Range checks: [min, max] for numbers. Current Claude models allow up to 128K output tokens. */
const RANGES: Partial<Record<keyof AiLimits, [number, number]>> = {
	maxTokens: [1_024, 128_000],
	maxSteps: [1, 50],
	turnTokens: [1_000, 2_000_000],
	dailyUsd: [0.01, 10_000],
	monthlyUsd: [0.01, 100_000],
	dailyTokens: [1_000, 1_000_000_000],
};

const num = (v: string | undefined) => (v == null || v === "" ? null : Number(v));

export function readLimits(settings: Record<string, string>): AiLimits {
	const out = { ...DEFAULTS };
	for (const [field, key] of Object.entries(KEYS) as [keyof AiLimits, string][]) {
		const raw = settings[key];
		if (raw == null) continue;
		if (field === "thinkingDisplay") out.thinkingDisplay = raw === "omitted" ? "omitted" : "summarized";
		else {
			const n = num(raw);
			if (n != null && Number.isFinite(n)) (out as Record<string, unknown>)[field] = n;
		}
	}
	return out;
}

/** Validates a partial update and returns the settings rows to write (null deletes, i.e. back to default/off). */
export function limitRows(patch: Partial<Record<keyof AiLimits, unknown>>): [string, string | null][] {
	const rows: [string, string | null][] = [];
	for (const [field, value] of Object.entries(patch) as [keyof AiLimits, unknown][]) {
		const key = KEYS[field];
		if (!key) throw new GaamError("INVALID", `Unknown assistant setting ${field}.`);
		if (value == null || value === "") {
			rows.push([key, null]);
			continue;
		}
		if (field === "thinkingDisplay") {
			if (value !== "summarized" && value !== "omitted") throw new GaamError("INVALID", "thinkingDisplay must be summarized or omitted.");
			rows.push([key, value]);
			continue;
		}
		const n = Number(value);
		const [min, max] = RANGES[field]!;
		if (!Number.isFinite(n) || n < min || n > max) throw new GaamError("INVALID", `${field} must be between ${min} and ${max}.`);
		rows.push([key, String(field === "dailyUsd" || field === "monthlyUsd" ? Math.round(n * 100) / 100 : Math.round(n))]);
	}
	return rows;
}

export interface UsageTotals {
	turns: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Claude API only: the CLIs report a notional cost that the user's subscription already covers. */
	costUsd: number;
}

export interface AiUsage {
	today: UsageTotals & { byProvider: Record<string, UsageTotals> };
	month: UsageTotals;
}

const empty = (): UsageTotals => ({ turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });

/** Local midnight and the first of the month as UTC ISO strings, comparable with created_at. */
function boundaries(now: Date) {
	const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const month = new Date(now.getFullYear(), now.getMonth(), 1);
	return { day: day.toISOString(), month: month.toISOString() };
}

export function usage(db: Db, now = new Date()): AiUsage {
	const { day, month } = boundaries(now);
	const rows = db
		.prepare(
			`select created_at, json_extract(meta, '$.provider') as provider,
				coalesce(json_extract(meta, '$.usage.input'), 0) as input,
				coalesce(json_extract(meta, '$.usage.output'), 0) as output,
				coalesce(json_extract(meta, '$.usage.cacheRead'), 0) as cache_read,
				coalesce(json_extract(meta, '$.usage.cacheWrite'), 0) as cache_write,
				coalesce(json_extract(meta, '$.usage.costUsd'), 0) as cost
			from messages where role = 'assistant' and created_at >= ?`,
		)
		.all(month) as { created_at: string; provider: string | null; input: number; output: number; cache_read: number; cache_write: number; cost: number }[];
	const out: AiUsage = { today: { ...empty(), byProvider: {} }, month: empty() };
	const add = (t: UsageTotals, r: (typeof rows)[number]) => {
		t.turns++;
		t.input += r.input;
		t.output += r.output;
		t.cacheRead += r.cache_read;
		t.cacheWrite += r.cache_write;
		if (r.provider === "anthropic") t.costUsd += r.cost;
	};
	for (const r of rows) {
		add(out.month, r);
		if (r.created_at < day) continue;
		add(out.today, r);
		const p = r.provider ?? "unknown";
		add((out.today.byProvider[p] ??= empty()), r);
	}
	return out;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Throws before a turn starts if a budget is already used up. Dollar budgets apply to the Claude API only. */
export function assertWithinBudget(limits: AiLimits, used: AiUsage, provider: string) {
	const hint = "می‌توانی سقف را در تنظیمات دستیار (⚙) بالا ببری یا برداری.";
	if (limits.dailyTokens != null) {
		const tokens = used.today.input + used.today.output + used.today.cacheRead + used.today.cacheWrite;
		if (tokens >= limits.dailyTokens) throw new GaamError("LIMIT", `سقف توکن امروز پر شده (${tokens.toLocaleString("fa-IR")} از ${limits.dailyTokens.toLocaleString("fa-IR")}). ${hint}`);
	}
	if (provider !== "anthropic") return;
	if (limits.dailyUsd != null && used.today.costUsd >= limits.dailyUsd)
		throw new GaamError("LIMIT", `بودجه‌ی امروزِ Claude API تمام شده (${usd(used.today.costUsd)} از ${usd(limits.dailyUsd)}). ${hint}`);
	if (limits.monthlyUsd != null && used.month.costUsd >= limits.monthlyUsd)
		throw new GaamError("LIMIT", `بودجه‌ی این ماهِ Claude API تمام شده (${usd(used.month.costUsd)} از ${usd(limits.monthlyUsd)}). ${hint}`);
}
