/**
 * A small, safe Markdown renderer for model output. HTML in the source is
 * escaped first; only the markup below is produced. Supports headings, code
 * fences, tables, nested lists, blockquotes, rules, links and clickable task keys.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const KEY = /\b([A-Z][A-Z0-9]{0,9}-\d+)\b/g;

function inline(raw: string): string {
	const codes: string[] = [];
	let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => {
		codes.push(`<code class="ltr">${c}</code>`);
		return `\u0000${codes.length - 1}\u0000`;
	});
	const links: string[] = [];
	s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#\/sources\/[A-Za-z0-9%:_-]+)\)/g, (_, text, url) => {
		links.push(url.startsWith("#/sources/") ? `<a href="${url}" class="md-source">${text}</a>` : `<a href="${url}" target="_blank" rel="noreferrer noopener">${text}</a>`);
		return `\u0001${links.length - 1}\u0001`;
	});
	s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => {
		links.push(`<a href="${url}" target="_blank" rel="noreferrer noopener" class="ltr">${url.replace(/^https?:\/\//, "").slice(0, 60)}</a>`);
		return `${pre}\u0001${links.length - 1}\u0001`;
	});
	s = s
		.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
		.replace(/__([^_]+)__/g, "<b>$1</b>")
		.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
		.replace(/~~([^~]+)~~/g, "<s>$1</s>")
		.replace(KEY, '<button type="button" class="md-key" data-key="$1">$1</button>');
	return s.replace(/\u0001(\d+)\u0001/g, (_, i) => links[Number(i)]!).replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]!);
}

function table(lines: string[]): string {
	const cells = (l: string) =>
		l
			.trim()
			.replace(/^\||\|$/g, "")
			.split("|")
			.map((c) => c.trim());
	const [head, , ...rows] = lines;
	return `<div class="md-table"><table><thead><tr>${cells(head!).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
		.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
		.join("")}</tbody></table></div>`;
}

function list(lines: string[]): string {
	const out: string[] = [];
	const stack: { indent: number; tag: "ul" | "ol" }[] = [];
	for (const line of lines) {
		const m = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
		if (!m) {
			if (out.length) out[out.length - 1] = out.at(-1)!.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
			continue;
		}
		const indent = m[1]!.replace(/\t/g, "  ").length;
		const tag = /\d/.test(m[2]!) ? "ol" : "ul";
		while (stack.length && indent < stack.at(-1)!.indent) out.push(`</${stack.pop()!.tag}>`);
		if (!stack.length || indent > stack.at(-1)!.indent) {
			stack.push({ indent, tag });
			out.push(`<${tag}>`);
		}
		const task = m[3]!.match(/^\[( |x|X)\]\s+(.*)$/);
		out.push(task ? `<li class="md-check">${task[1] === " " ? "☐" : "☑"} ${inline(task[2]!)}</li>` : `<li>${inline(m[3]!)}</li>`);
	}
	while (stack.length) out.push(`</${stack.pop()!.tag}>`);
	return out.join("");
}

export function renderMarkdown(src: string): string {
	const lines = src.replace(/\r\n/g, "\n").split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; ) {
		const line = lines[i]!;
		const fence = line.match(/^\s*```(\w[\w+-]*)?\s*$/);
		if (fence) {
			const body: string[] = [];
			i++;
			while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
			i++;
			out.push(
				`<div class="md-code"><div class="md-code-head"><span>${esc(fence[1] ?? "")}</span><button type="button" class="md-copy">کپی</button></div><pre class="ltr"><code>${esc(body.join("\n"))}</code></pre></div>`,
			);
			continue;
		}
		if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
			const block: string[] = [];
			while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) block.push(lines[i++]!);
			out.push(table(block));
			continue;
		}
		if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
			const block: string[] = [];
			while (i < lines.length && (/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!) || (/^\s{2,}\S/.test(lines[i]!) && block.length))) block.push(lines[i++]!);
			out.push(list(block));
			continue;
		}
		if (/^\s*>/.test(line)) {
			const block: string[] = [];
			while (i < lines.length && /^\s*>/.test(lines[i]!)) block.push(lines[i++]!.replace(/^\s*>\s?/, ""));
			out.push(`<blockquote>${renderMarkdown(block.join("\n"))}</blockquote>`);
			continue;
		}
		const h = line.match(/^(#{1,4})\s+(.*)$/);
		if (h) {
			out.push(`<h${h[1]!.length + 2} class="md-h">${inline(h[2]!)}</h${h[1]!.length + 2}>`);
			i++;
			continue;
		}
		if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
			out.push("<hr />");
			i++;
			continue;
		}
		if (!line.trim()) {
			i++;
			continue;
		}
		const para: string[] = [];
		while (i < lines.length && lines[i]!.trim() && !/^\s*(```|#{1,4}\s|>|([-*•]|\d+[.)])\s|\|.*\|)/.test(lines[i]!)) para.push(lines[i++]!);
		if (!para.length) para.push(lines[i++]!);
		out.push(`<p>${para.map(inline).join("<br />")}</p>`);
	}
	return out.join("");
}
