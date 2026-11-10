import assert from "node:assert/strict";
import { test } from "node:test";

import { applyEvent, type AssistantMessage, type ChatEvent, messageText } from "./protocol.ts";

const fold = (events: ChatEvent[]) => events.reduce((m, e) => applyEvent(m, e), { parts: [] } as AssistantMessage);

test("folds a streamed turn with reasoning, a tool call and text", () => {
	const m = fold([
		{ type: "start", messageId: 1, provider: "anthropic", model: "claude-opus-5-5" },
		{ type: "reasoning-start", id: "r" },
		{ type: "reasoning-delta", id: "r", delta: "plan" },
		{ type: "reasoning-end", id: "r", ms: 900 },
		{ type: "tool-input-start", toolCallId: "c", name: "task_list" },
		{ type: "tool-input-delta", toolCallId: "c", delta: '{"project":' },
		{ type: "tool-input-available", toolCallId: "c", name: "task_list", input: { project: "SRCH" } },
		{ type: "tool-output-available", toolCallId: "c", output: [{ key: "SRCH-1" }], ms: 12 },
		{ type: "start-step" },
		{ type: "text-start", id: "t" },
		{ type: "text-delta", id: "t", delta: "سلام " },
		{ type: "text-delta", id: "t", delta: "SRCH-1" },
		{ type: "usage", usage: { input: 10, output: 5, costUsd: 0.001 } },
		{ type: "usage", usage: { input: 3, output: 2, costUsd: 0.002 } },
		{ type: "finish", reason: "stop", ms: 2000 },
	]);
	assert.deepEqual(
		m.parts.map((p) => p.type),
		["reasoning", "tool", "step", "text"],
	);
	const tool = m.parts[1] as Extract<AssistantMessage["parts"][number], { type: "tool" }>;
	assert.equal(tool.state, "output-available");
	assert.deepEqual(tool.input, { project: "SRCH" });
	assert.equal(tool.inputText, undefined);
	assert.equal(messageText(m), "سلام SRCH-1");
	assert.equal(m.usage?.input, 13);
	assert.equal(m.usage?.costUsd, 0.003);
	assert.equal(m.finish, "stop");
});

test("an unfinished tool call is closed as denied when the turn ends", () => {
	const m = fold([
		{ type: "tool-input-available", toolCallId: "c", name: "task_delete", input: { task: "X-1" } },
		{ type: "tool-approval-request", toolCallId: "c" },
		{ type: "finish", reason: "aborted", ms: 5 },
	]);
	assert.equal((m.parts[0] as { state: string }).state, "denied");
});
