/**
 * Jira descriptions arrive as HTML. These helpers make them safe to show and
 * turn them into plain text for editing, without adding a sanitizer dependency.
 */

const KEEP = new Set([
	"P", "BR", "B", "STRONG", "I", "EM", "U", "S", "A", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
	"BLOCKQUOTE", "CODE", "PRE", "HR", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD",
]);
// Dropped with everything inside them; any other unknown tag is unwrapped.
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "svg", "MATH", "TEMPLATE", "IMG", "VIDEO", "AUDIO", "LINK", "META"]);
const BLOCK = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "TR", "TABLE", "UL", "OL", "HR"]);

export const looksLikeHtml = (s: string | null | undefined) => Boolean(s && /<\/?(p|br|div|span|a|ul|ol|li|b|strong|em|u|h[1-6]|table)\b[^>]*>/i.test(s));

function clean(node: Node, base: string | undefined, doc: Document) {
	for (const child of [...node.childNodes]) {
		if (child.nodeType === Node.COMMENT_NODE) {
			child.remove();
			continue;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const el = child as Element;
		if (DROP.has(el.tagName) || DROP.has(el.tagName.toUpperCase())) {
			el.remove();
			continue;
		}
		clean(el, base, doc);
		if (!KEEP.has(el.tagName)) {
			// DIVs separate lines; other wrappers (span, font…) just disappear.
			const frag = doc.createDocumentFragment();
			if (el.tagName === "DIV") frag.append(doc.createElement("br"));
			frag.append(...el.childNodes);
			el.replaceWith(frag);
			continue;
		}
		const dir = el.getAttribute("dir");
		const href = el.tagName === "A" ? el.getAttribute("href") : null;
		for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
		if (dir && /^(rtl|ltr|auto)$/i.test(dir)) el.setAttribute("dir", dir.toLowerCase());
		if (href) {
			try {
				const url = new URL(href, base ?? location.href);
				if (/^(https?|mailto):$/.test(url.protocol)) {
					el.setAttribute("href", url.href);
					el.setAttribute("target", "_blank");
					el.setAttribute("rel", "noreferrer noopener");
				}
			} catch {
				// Not a URL: keep the text, drop the link.
			}
		}
	}
}

/** Safe HTML: an allowlist of tags, no attributes except dir and checked links. */
export function sanitizeHtml(html: string, base?: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	clean(doc.body, base, doc);
	// Jira pads with empty &nbsp; paragraphs.
	for (const p of [...doc.body.querySelectorAll("p")]) if (!p.textContent?.replace(/\u00a0/g, "").trim() && !p.querySelector("br,a")) p.remove();
	return doc.body.innerHTML;
}

/** Readable plain text from HTML, keeping line breaks and list bullets, for the editor. */
export function htmlToText(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const out: string[] = [];
	const walk = (node: Node) => {
		for (const child of node.childNodes) {
			if (child.nodeType === Node.TEXT_NODE) out.push((child.textContent ?? "").replace(/\s+/g, " "));
			else if (child.nodeType === Node.ELEMENT_NODE) {
				const el = child as Element;
				if (DROP.has(el.tagName)) continue;
				if (el.tagName === "BR") out.push("\n");
				else if (el.tagName === "LI") out.push("\n- ");
				else if (BLOCK.has(el.tagName)) out.push("\n");
				walk(el);
				// Keep a link's address only when the text doesn't already show it (Jira usually does).
				const href = el.tagName === "A" ? el.getAttribute("href") : null;
				if (href && /^https?:/.test(href) && !doc.body.textContent?.includes(href)) out.push(` (${href})`);
				if (BLOCK.has(el.tagName) && el.tagName !== "LI") out.push("\n");
			}
		}
	};
	walk(doc.body);
	return out
		.join("")
		.replace(/\u00a0/g, " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
