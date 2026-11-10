/**
 * A task's details: shown rendered (Markdown, or sanitized HTML from Jira),
 * edited in a plain textarea only when you ask for it.
 */
import { createEffect, createSignal, Show } from "solid-js";

import { Btn } from "~/components/app.tsx";
import { autosave } from "~/components/form.tsx";
import { htmlToText, looksLikeHtml, sanitizeHtml } from "../html.ts";
import { onMarkdownClick, renderMarkdown } from "../markdown.tsx";

const TEMPLATE = "انجام شد یعنی:\n- \n\nنکته‌ها:\n- ";
const TALL = 340;

export function DetailsField(props: { value: string | null | undefined; onSave: (v: string | null) => unknown; base?: string; fromJira?: boolean }) {
	const [editing, setEditing] = createSignal(false);
	const [expanded, setExpanded] = createSignal(false);
	const [tall, setTall] = createSignal(false);
	const html = () => looksLikeHtml(props.value);
	const rendered = () => (html() ? sanitizeHtml(props.value!, props.base) : renderMarkdown(props.value ?? ""));
	let view: HTMLDivElement | undefined;
	let input: HTMLTextAreaElement | undefined;

	createEffect(() => {
		rendered();
		if (view) queueMicrotask(() => setTall((view?.scrollHeight ?? 0) > TALL + 40));
	});

	const edit = (initial?: string) => {
		setEditing(true);
		queueMicrotask(() => {
			if (!input) return;
			input.value = initial ?? (html() ? htmlToText(props.value!) : (props.value ?? ""));
			input.focus();
		});
	};
	const save = async () => {
		const v = input?.value.trim() ?? "";
		const before = html() ? htmlToText(props.value ?? "") : (props.value ?? "").trim();
		if (v !== before) await autosave(async () => props.onSave(v || null));
		setEditing(false);
	};

	return (
		<div class="details">
			<Show
				when={!editing()}
				fallback={
					<div class="details-edit">
						<textarea
							ref={input}
							class="details-input"
							placeholder={"انجام شد یعنی…\nلینک‌ها، نکته‌ها، معیار پذیرش"}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									e.stopPropagation();
									setEditing(false);
								} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
							}}
						/>
						<Show when={html() && props.fromJira}>
							<div class="ff-hint">متن از جیرا آمده. با ذخیره، به متن ساده تبدیل می‌شود و فقط در گام عوض می‌شود؛ جیرا دست نمی‌خورد.</div>
						</Show>
						<div class="row">
							<span class="ff-hint">Markdown مجاز است · ⌘Enter ذخیره · Esc انصراف</span>
							<span class="spacer" />
							<Btn kind="ghost sm" onClick={() => setEditing(false)}>
								انصراف
							</Btn>
							<Btn kind="primary sm" onClick={() => void save()}>
								ذخیره
							</Btn>
						</div>
					</div>
				}
			>
				<Show
					when={props.value?.trim()}
					fallback={
						<div class="details-empty">
							<button type="button" class="details-add" onClick={() => edit()}>
								＋ بنویس «انجام شد یعنی…»، لینک‌ها و نکته‌ها
							</button>
							<div class="pills sm">
								<button type="button" class="pill" onClick={() => edit(TEMPLATE)}>
									＋ قالب «انجام شد یعنی…»
								</button>
							</div>
						</div>
					}
				>
					<div class="details-box" classList={{ clipped: tall() && !expanded() }}>
						<div class="md details-view" ref={view} innerHTML={rendered()} onClick={onMarkdownClick} onDblClick={() => edit()} />
						<button type="button" class="details-pen" onClick={() => edit()} aria-label="ویرایش جزئیات">
							✎ ویرایش
						</button>
					</div>
					<Show when={tall()}>
						<button type="button" class="details-more" onClick={() => setExpanded(!expanded())}>
							{expanded() ? "کمتر" : "نمایش کامل"}
						</button>
					</Show>
				</Show>
			</Show>
		</div>
	);
}
