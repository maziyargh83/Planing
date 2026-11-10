import assert from "node:assert/strict";
import { test } from "node:test";

// Import the pure renderer without the DOM-dependent helpers.
const { renderMarkdown } = await import("./markdown-core.ts");

test("escapes HTML from the model", () => {
	assert.ok(!renderMarkdown("<script>alert(1)</script>").includes("<script>"));
	assert.ok(!renderMarkdown("[x](javascript:alert(1))").includes("href=\"javascript"));
});

test("tables, code fences, nested lists and keys", () => {
	const html = renderMarkdown("| کلید | عنوان |\n|---|---|\n| CND-674 | back |\n\n```ts\nconst a = 1 < 2;\n```\n\n- یک\n  - دو\n- سه");
	assert.match(html, /<table>/);
	assert.match(html, /data-key="CND-674"/);
	assert.match(html, /const a = 1 &lt; 2;/);
	assert.equal((html.match(/<ul>/g) ?? []).length, 2);
});
