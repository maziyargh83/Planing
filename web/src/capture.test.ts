import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCapture, skeleton } from "./capture.ts";

const people = [
	{ id: 1, name: "Shaghayegh Ahmadi", relation: "report" },
	{ id: 2, name: "Shayan Mirzaei", relation: "manager" },
	{ id: 3, name: "Sepehr Golpazir", relation: "peer" },
];
const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("en-CA");

test("Persian names match their English spelling", () => {
	assert.equal(skeleton("شقایق"), skeleton("Shaghayegh"));
	assert.equal(skeleton("شایان"), skeleton("Shayan"));
	assert.equal(skeleton("سپهر"), skeleton("Sepehr"));
});

test("a 1:1 with a report for tomorrow", () => {
	const c = parseCapture("فردا ۱:۱ با شقایق", people);
	assert.equal(c.intent, "meeting");
	assert.equal(c.template, "one_on_one_report");
	assert.equal(c.person?.id, 1);
	assert.equal(c.due, tomorrow);
});

test("a 1:1 with the manager picks the manager template", () => {
	const c = parseCapture("1:1 با شایان", people);
	assert.equal(c.template, "one_on_one_manager");
	assert.equal(c.person?.id, 2);
});

test("a follow-up with a person and a weekday", () => {
	const c = parseCapture("پیگیری با شایان: بودجه‌ی مانیتورینگ تا پنجشنبه", people);
	assert.equal(c.intent, "followup_mine");
	assert.equal(c.person?.id, 2);
	assert.equal(c.text, "بودجه‌ی مانیتورینگ");
	assert.equal(new Date(`${c.due}T12:00:00`).getDay(), 4);
});

test("a task with tag, priority, project and date", () => {
	const c = parseCapture("fix scroll bug #bug !p1 @disc فردا", people);
	assert.equal(c.intent, "task");
	assert.equal(c.text, "fix scroll bug");
	assert.deepEqual(c.tags, ["bug"]);
	assert.equal(c.priority, 1);
	assert.equal(c.project, "DISC");
	assert.equal(c.due, tomorrow);
});

test("prefixes route to journal, decisions and memory", () => {
	assert.equal(parseCapture("درس: برای جلسه‌ها آماده‌تر بروم", people).intent, "lesson");
	assert.equal(parseCapture("تصمیم: bundle سرچ جدا شود", people).intent, "decision");
	assert.equal(parseCapture("یادت باشه: شقایق دوست دارد مالک فیچر باشد", people).intent, "memory");
	assert.equal(parseCapture("منتظرم از سپهر: API جدید", people).intent, "followup_theirs");
});
