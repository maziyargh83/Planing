/**
 * Which browser origins may call the API. Same-machine pages always may; a
 * Chrome extension may only when its id is named in GAAM_EXTENSION_ORIGIN, so
 * no other extension (or site) can read or write the planner.
 */

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const EXTENSION_ID = /^[a-p]{32}$/;

/** Parses GAAM_EXTENSION_ORIGIN: comma-separated `chrome-extension://<id>` values or bare ids. */
export function extensionOrigins(value: string | undefined): Set<string> {
	const out = new Set<string>();
	for (const raw of (value ?? "").split(",")) {
		const id = raw.trim().replace(/^chrome-extension:\/\//, "").replace(/\/+$/, "");
		if (EXTENSION_ID.test(id)) out.add(`chrome-extension://${id}`);
	}
	return out;
}

export function originAllowed(origin: string | undefined, extensions: Set<string>): boolean {
	if (!origin) return true;
	return LOCAL.test(origin) || extensions.has(origin);
}
