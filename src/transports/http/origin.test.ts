import assert from "node:assert/strict";
import { test } from "node:test";

import { extensionOrigins, originAllowed } from "./origin.ts";

const ID = "koooklfhdmodkbadchkeaddcpcomjafp";

test("only local pages pass the origin check by default", () => {
	const none = extensionOrigins(undefined);
	assert.equal(originAllowed(undefined, none), true);
	assert.equal(originAllowed("http://localhost:4778", none), true);
	assert.equal(originAllowed("http://127.0.0.1:4777", none), true);
	assert.equal(originAllowed("http://[::1]:4777", none), true);
	assert.equal(originAllowed("https://evil.example", none), false);
	assert.equal(originAllowed("http://localhost.evil.example", none), false);
	assert.equal(originAllowed(`chrome-extension://${ID}`, none), false);
});

test("GAAM_EXTENSION_ORIGIN lets exactly the named extension in", () => {
	const allowed = extensionOrigins(`chrome-extension://${ID}/`);
	assert.equal(originAllowed(`chrome-extension://${ID}`, allowed), true);
	assert.equal(originAllowed("chrome-extension://abcdefghijklmnopabcdefghijklmnop", allowed), false);
	assert.equal(originAllowed(`moz-extension://${ID}`, allowed), false);
	assert.equal(originAllowed("https://evil.example", allowed), false);

	assert.deepEqual([...extensionOrigins(` ${ID} , abcdefghijklmnopabcdefghijklmnop`)], [`chrome-extension://${ID}`, "chrome-extension://abcdefghijklmnopabcdefghijklmnop"]);
	// Anything that is not a well-formed extension id is ignored rather than widening the check.
	assert.equal(extensionOrigins("*").size, 0);
	assert.equal(extensionOrigins("chrome-extension://*").size, 0);
	assert.equal(extensionOrigins("https://evil.example").size, 0);
});
