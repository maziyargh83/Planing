import assert from "node:assert/strict";
import { test } from "node:test";

import { openDb } from "../core/db.ts";
import { assertWithinBudget, DEFAULTS, limitRows, readLimits, usage } from "./limits.ts";
import { AiStore } from "./store.ts";

test("reads defaults and stored limits", () => {
	assert.deepEqual(readLimits({}), DEFAULTS);
	const l = readLimits({ "ai.max_tokens": "16000", "ai.thinking_display": "omitted", "ai.daily_usd": "2.5" });
	assert.equal(l.maxTokens, 16000);
	assert.equal(l.thinkingDisplay, "omitted");
	assert.equal(l.dailyUsd, 2.5);
	assert.equal(l.turnTokens, null);
});

test("validates updates and clears with null", () => {
	assert.deepEqual(limitRows({ maxTokens: 32000, dailyUsd: 1.234, turnTokens: null }), [
		["ai.max_tokens", "32000"],
		["ai.daily_usd", "1.23"],
		["ai.turn_tokens", null],
	]);
	assert.throws(() => limitRows({ maxTokens: 500_000 }), /between/);
	assert.throws(() => limitRows({ thinkingDisplay: "off" }), /summarized/);
	assert.throws(() => limitRows({ nope: 1 } as never), /Unknown/);
});

test("sums today's usage and enforces budgets", () => {
	const db = openDb(":memory:");
	const store = new AiStore(db);
	const t = store.createThread({ title: "t", provider: "anthropic" });
	store.addMessage(t.id, "assistant", "a", [], [], { provider: "anthropic", usage: { input: 1000, output: 500, costUsd: 0.6 } });
	store.addMessage(t.id, "assistant", "b", [], [], { provider: "claude", usage: { input: 2000, output: 100, costUsd: 9 } });
	const u = usage(db);
	assert.equal(u.today.turns, 2);
	assert.equal(u.today.input, 3000);
	// The CLI's notional cost doesn't count as spend.
	assert.equal(u.today.costUsd, 0.6);
	assert.equal(u.today.byProvider.claude!.output, 100);

	const limits = { ...DEFAULTS, dailyUsd: 0.5 };
	assert.throws(() => assertWithinBudget(limits, u, "anthropic"), /بودجه‌ی امروز/);
	assert.doesNotThrow(() => assertWithinBudget(limits, u, "claude"));
	assert.throws(() => assertWithinBudget({ ...DEFAULTS, dailyTokens: 3000 }, u, "claude"), /سقف توکن/);
});
