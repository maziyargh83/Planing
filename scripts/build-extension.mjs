// Builds the new-tab extension in place: strips types from extension/src/newtab.ts
// and web/src/capture.ts (Node's own stripper, no bundler) and copies the font.
// Chrome then loads extension/ unpacked.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const root = new URL("..", import.meta.url);
const at = (p) => new URL(p, root);
const strip = (from, to, rewrite = (s) => s) => {
	const out = stripTypeScriptTypes(readFileSync(at(from), "utf8"), { mode: "strip" });
	writeFileSync(at(to), `// Generated from ${from} by scripts/build-extension.mjs. Do not edit.\n${rewrite(out)}`);
};

mkdirSync(at("extension/lib"), { recursive: true });
mkdirSync(at("extension/fonts"), { recursive: true });
strip("web/src/capture.ts", "extension/lib/capture.js");
strip("extension/src/newtab.ts", "extension/lib/newtab.js", (s) => s.replace('"../../web/src/capture.ts"', '"./capture.js"'));
copyFileSync(at("node_modules/@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2"), at("extension/fonts/vazirmatn.woff2"));
console.log("extension/ is ready: load it unpacked from chrome://extensions");
