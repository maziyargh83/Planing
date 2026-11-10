import { createHash } from "node:crypto";

export const digest = (s: string) => createHash("sha256").update(s).digest("hex");

export function normalize(s: string): string {
	return s.normalize("NFKC").replace(/[يى]/g, "ی").replace(/ك/g, "ک")
		.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
		.replace(/\u200c/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Prefer paragraph and sentence boundaries; retain overlap for long paragraphs. */
export function chunks(text: string, size = 1400, overlap = 180): string[] {
	if (size < 100 || overlap < 0 || overlap >= size) throw new Error("Invalid chunk size");
	const clean = text.replace(/\r\n/g, "\n").trim();
	const out: string[] = [];
	for (let start = 0; start < clean.length;) {
		let end = Math.min(start + size, clean.length);
		if (end < clean.length) {
			const boundary = Math.max(clean.lastIndexOf("\n", end), clean.lastIndexOf(". ", end));
			if (boundary > start + size / 2) end = boundary + 1;
		}
		out.push(clean.slice(start, end).trim());
		if (end === clean.length) break;
		start = end - overlap;
	}
	return out.filter(Boolean);
}

export function terms(query: string): string[] {
	const stop = new Set(["از", "به", "را", "با", "در", "و", "چه", "برای", "من", "این", "که", "است", "the", "a", "is", "of", "to", "and"]);
	return [...new Set(normalize(query).match(/[\p{L}\p{N}]+/gu) ?? [])].filter((t) => !stop.has(t)).slice(0, 24);
}
