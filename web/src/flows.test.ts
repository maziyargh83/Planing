import assert from "node:assert/strict";
import { test } from "node:test";

// scheduleText has no DOM dependency; import it through a tiny shim so the dialogs aren't loaded.
const { scheduleText } = await import("./schedule-text.ts");

test("schedules read as Persian", () => {
	assert.equal(scheduleText("every 30m"), "هر ۳۰ دقیقه");
	assert.equal(scheduleText("weekdays 09:00"), "روزهای کاری (شنبه تا چهارشنبه)، ساعت ۹:۰۰");
	assert.equal(scheduleText("weekly wed 17:00"), "چهارشنبه، ساعت ۱۷:۰۰");
	assert.equal(scheduleText("daily 21:30"), "هر روز، ساعت ۲۱:۳۰");
});
