import { toast } from "./api.ts";
import { renderMarkdown } from "./markdown-core.ts";
import { openTask } from "./ui.tsx";

export { renderMarkdown };

/** Click handling for rendered Markdown: task keys open the task, copy buttons copy their code block. */
export function onMarkdownClick(e: MouseEvent) {
	const target = e.target as HTMLElement;
	const key = target.closest<HTMLElement>(".md-key")?.dataset.key;
	if (key) return openTask(key);
	const copy = target.closest<HTMLElement>(".md-copy");
	if (copy) {
		const code = copy.closest(".md-code")?.querySelector("code")?.textContent ?? "";
		void navigator.clipboard.writeText(code).then(() => toast("کپی شد"));
	}
}

export function Markdown(props: { text: string; class?: string }) {
	return <div class={`md ${props.class ?? ""}`} innerHTML={renderMarkdown(props.text)} onClick={onMarkdownClick} />;
}
