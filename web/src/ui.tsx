import { autosave, DateField, Field, HoursField, Pills, SaveIndicator, ScoreField, TitleField } from "~/components/form.tsx";
import { Btn, Choice, Panel, Tag, TextArea, TextInput } from "~/components/app.tsx";
import { createEffect, createRoot, createSignal, For, type JSX, on, onCleanup, onMount, Show } from "solid-js";
import { createResource } from "./live.ts";
import * as Drawer from "~/components/ui/drawer";
import { confirmAction } from "~/kit.tsx";
import * as SliderUI from "~/components/ui/slider";

import {
	ago,
	type Comment,
	type CommentEntity,
	fa,
	jalali,
	PRIORITY_FA,
	rpc,
	SCOPE_FA,
	STATUS_FA,
	STATUSES,
	type Task,
	toast,
	version,
} from "./api.ts";

// ── Routing ────────────────────────────────────────────────────────────────

/**
 * The current path, kept in sync by the TanStack router (router.tsx) so
 * components outside the route tree can react to navigation.
 */
const [route, setRoute] = createSignal(location.hash.slice(1).split("?")[0] || "/now");
export { route, setRoute };
let navigateFn: ((path: string) => void) | null = null;
/** Registered by the router; falls back to the hash before it boots. */
export const setNavigator = (fn: (path: string) => void) => {
	navigateFn = fn;
};
export const go = (path: string) => {
	if (navigateFn) navigateFn(path);
	else location.hash = path;
};

// ── Task drawer (global) ───────────────────────────────────────────────────

const [openTaskKey, setOpenTaskKey] = createSignal<string | null>(null);
export const openTask = (key: string) => setOpenTaskKey(key);
createRoot(() => createEffect(on(route, () => setOpenTaskKey(null), { defer: true })));

export function iceColor(ice: number | null) {
	if (ice == null) return "var(--faint)";
	if (ice >= 50) return "var(--green)";
	if (ice >= 25) return "var(--accent)";
	return "var(--muted)";
}

export function Ice(props: { value: number | null }) {
	return (
		<span
			class="ice"
			title="امتیاز ICE = تأثیر × اطمینان × سهولت ÷ ۱۰"
			style={{ color: iceColor(props.value), background: `color-mix(in oklab, ${iceColor(props.value)} 14%, transparent)` }}
		>
			{props.value == null ? "—" : fa(props.value)}
		</span>
	);
}

export async function setStatus(task: Task, status: Task["status"]) {
	await rpc("updateTask", task.key, { status });
	if (status === "done") toast(`✓ ${task.title}`, "win");
}

export function TaskRow(props: { task: Task & { children?: Task[]; project_key?: string | null }; showProject?: boolean; extra?: JSX.Element }) {
	const t = () => props.task;
	return (
		<>
			<div class="task" classList={{ done: t().status === "done" || t().status === "dropped" }}>
				<button
					class="check"
					classList={{ on: t().status === "done", doing: t().status === "doing" }}
					title={STATUS_FA[t().status]}
					onClick={() => setStatus(t(), t().status === "done" ? "todo" : "done")}
				>
					✓
				</button>
				<div class="row" style={{ "min-width": 0 }}>
					<span class="title" onClick={() => openTask(t().key)}>
						{t().title}
					</span>
					<Show
						when={t().external_status}
						fallback={
							<Show when={t().status === "doing" || t().status === "blocked"}>
								<span class={`chip st-${t().status}`}>{STATUS_FA[t().status]}</span>
							</Show>
						}
					>
						<a
							class={`chip ltr st-${t().status}`}
							href={t().external_url ?? "#"}
							target="_blank"
							rel="noreferrer"
							title={t().external_since ? `از ${new Date(t().external_since!).toLocaleDateString("fa-IR")} در این ستون` : "ستون جیرا"}
						>
							{t().external_status}
						</a>
					</Show>
					<Show when={t().due}>
						<Tag classList={{ "st-blocked": t().due! < new Date().toLocaleDateString("en-CA") && t().status !== "done" }}>
							📅 {jalali(t().due!)}
						</Tag>
					</Show>
					<For each={t().tags}>{(tag) => <Tag>#{tag}</Tag>}</For>
				</div>
				<div class="row">
					{props.extra}
					<Show when={props.showProject && t().project_key}>
						<Tag class="accent">{t().project_key}</Tag>
					</Show>
					<Show when={t().priority < 2}>
						<span class={`chip ${PRIORITY_FA[t().priority]}`}>{PRIORITY_FA[t().priority]}</span>
					</Show>
					<Ice value={t().ice} />
					<Tag class="key">{t().key}</Tag>
				</div>
			</div>
			<Show when={t().children?.length}>
				<div class="subtasks">
					<For each={t().children}>{(child) => <TaskRow task={child} />}</For>
				</div>
			</Show>
		</>
	);
}

export function QuickAdd(props: { project?: string | null; parent?: string; placeholder?: string }) {
	let input!: HTMLInputElement;
	const submit = async (e: Event) => {
		e.preventDefault();
		const title = input.value.trim();
		if (!title) return;
		input.value = "";
		await rpc("createTasks", props.project ?? null, [{ title }], props.parent);
	};
	return (
		<form onSubmit={submit} class="row" style={{ "margin-top": "6px" }}>
			<TextInput ref={input} placeholder={props.placeholder ?? "+ تسک جدید… (Enter)"} />
		</form>
	);
}

function Slider(props: { label: string; value: number | null; onChange: (v: number) => void; hint: string }) {
	const [live, setLive] = createSignal<number | null>(null);
	return (
		<SliderUI.Root
			min={1}
			max={10}
			value={[props.value ?? 5]}
			onValueChange={(e) => setLive(e.value[0]!)}
			onValueChangeEnd={(e) => (setLive(null), props.onChange(e.value[0]!))}
			colorPalette="amber"
			size="md"
			title={props.hint}
			style={{ width: "100%" }}
		>
			<div class="row small">
				<SliderUI.Label class="muted">{props.label}</SliderUI.Label>
				<span class="spacer" />
				<b style={{ opacity: props.value == null && live() == null ? 0.4 : 1 }}>{fa(live() ?? props.value ?? 5)}</b>
			</div>
			<SliderUI.Control>
				<SliderUI.Track>
					<SliderUI.Range />
				</SliderUI.Track>
				<SliderUI.Thumb index={0}>
					<SliderUI.HiddenInput />
				</SliderUI.Thumb>
			</SliderUI.Control>
		</SliderUI.Root>
	);
}

export function TaskDrawer() {
	const [data] = createResource(
		() => (openTaskKey() ? [openTaskKey()!, version()] : null),
		([key]) => rpc("taskBundle", key).catch(() => null),
	);
	const [branch, setBranch] = createSignal<string | null>(null);
	const save = (patch: Record<string, unknown>) => autosave(() => rpc("updateTask", openTaskKey(), patch));
	const close = () => {
		setOpenTaskKey(null);
		setBranch(null);
	};

	return (
		<Drawer.Root open={Boolean(openTaskKey())} onOpenChange={(e) => !e.open && close()} size="lg" placement="end">
			<Drawer.Backdrop />
			<Drawer.Positioner>
				<Drawer.Content class="task-drawer">
		<Show when={openTaskKey() && data()}>
			{(bundle) => {
				const t = () => bundle().task as Task;
				return (
					<>
						<Drawer.Body>
							<div class="sheet-top">
								<Tag class="key">{t().key}</Tag>
								<Show when={t().jira_key && t().jira_key !== t().key}>
									<Tag class="key">🔗 {t().jira_key}</Tag>
								</Show>
								<Show when={t().external_status}>
									<a class="chip ltr" href={t().external_url ?? "#"} target="_blank" rel="noreferrer" title="ستون جیرا (فقط خواندنی)">
										Jira · {t().external_status} ↗
									</a>
								</Show>
								<span class="spacer" />
								<SaveIndicator />
								<Btn kind="ghost sm" onClick={close} aria-label="بستن">
									✕
								</Btn>
							</div>

							<TitleField value={t().title} onSave={(v) => save({ title: v })} />

							<div class="sheet-grid">
								<Field label="وضعیت" wide>
									<Pills
										value={t().status}
										options={[
											{ value: "todo", label: "بعدی", icon: "○" },
											{ value: "doing", label: "در حال انجام", icon: "◐", tone: "blue" },
											{ value: "blocked", label: "گیر کرده", icon: "⛔", tone: "red", hint: "یک کامنت بنویس که چه چیزی جلویش را گرفته و چه کسی می‌تواند بازش کند." },
											{ value: "done", label: "انجام شد", icon: "✓", tone: "green" },
											{ value: "dropped", label: "کنار گذاشتم", icon: "✕", hint: "تاریخچه می‌ماند؛ فقط دیگر در لیست‌ها نیست." },
										]}
										onChange={(v) => save({ status: v })}
									/>
								</Field>
								<Field label="کِی باید تمام شود؟">
									<DateField value={t().due} onChange={(v) => save({ due: v })} placeholder="ددلاین ندارد" />
								</Field>
								<Field label="چقدر وقت می‌برد؟" hint={t().actual_h ? `تا الان ${fa(Math.round(t().actual_h * 10) / 10)} ساعت تمرکز ثبت شده` : "تخمین تو؛ بعداً با زمان واقعی مقایسه می‌شود"}>
									<HoursField value={t().estimate_h} onChange={(v) => save({ estimate_h: v })} />
								</Field>
								<Field label="چقدر فوری است؟" wide>
									<Pills
										value={t().priority}
										options={[
											{ value: 0, label: "همین الان", tone: "red", hint: "P0 · اگر انجام نشود چیزی می‌سوزد" },
											{ value: 1, label: "این هفته", tone: "amber", hint: "P1 · مهم و نزدیک" },
											{ value: 2, label: "معمولی", hint: "P2 · پیش‌فرض" },
											{ value: 3, label: "یک روزی", hint: "P3 · اگر وقت شد" },
										]}
										onChange={(v) => save({ priority: v })}
									/>
								</Field>
								<Field
									label="در این نسخه هست؟"
									wide
									help="اسکوپ یعنی تصمیم درباره‌ی این‌که این کار در نسخه‌ی فعلی پروژه هست یا نه. «داخل» = کوچک‌ترین نسخه‌ای که فرضیه را تست می‌کند."
								>
									<Pills
										value={t().scope ?? "none"}
										options={[
											{ value: "in", label: "داخل", tone: "green" },
											{ value: "later", label: "بعداً", tone: "amber" },
											{ value: "out", label: "خارج", tone: "red" },
											{ value: "none", label: "هنوز تصمیم نگرفتم" },
										]}
										onChange={(v) => save({ scope: v === "none" ? null : v })}
									/>
								</Field>
							</div>

							<details class="sheet-section" open={t().ice != null}>
								<summary>
									<span>🎯 ارزشش چقدر است؟ (امتیاز ICE)</span>
									<span class="spacer" />
									<Ice value={t().ice} />
								</summary>
								<div class="ff-helpbox" style={{ margin: "8px 0 12px" }}>
									سه سؤال ساده. امتیاز نهایی = تأثیر × اطمینان × سهولت ÷ ۱۰ (از ۰ تا ۱۰۰). تسک‌های پرامتیازتر بالاتر می‌آیند.
								</div>
								<div class="stack" style={{ gap: "14px" }}>
									<ScoreField kind="impact" value={t().impact} onChange={(v) => save({ impact: v })} />
									<ScoreField kind="confidence" value={t().confidence} onChange={(v) => save({ confidence: v })} />
									<ScoreField kind="ease" value={t().ease} onChange={(v) => save({ ease: v })} />
								</div>
							</details>

							<Field label="جزئیات" hint="Markdown مجاز است. بهترین کار: یک خط «انجام شد یعنی…»">
								<TextArea rows="5" placeholder="انجام شد یعنی… &#10;لینک‌ها، نکته‌ها، معیار پذیرش" value={t().description ?? ""} onChange={(e) => save({ description: e.currentTarget.value })} />
								<Show when={!t().description}>
									<div class="pills sm">
										<button type="button" class="pill" onClick={() => save({ description: "انجام شد یعنی:\n- \n\nنکته‌ها:\n- " })}>
											＋ قالب «انجام شد یعنی…»
										</button>
									</div>
								</Show>
							</Field>

							<div class="sheet-section">
								<div class="ff-label">زیرتسک‌ها</div>
								<For each={bundle().subtasks} fallback={<div class="ff-hint">کار بزرگ است؟ به قدم‌های کمتر از نیم‌روز بشکنش.</div>}>
									{(s: Task) => <TaskRow task={s} />}
								</For>
								<QuickAdd project={t().project_id ? String(t().project_id) : null} parent={t().key} placeholder="＋ یک زیرتسک بنویس و Enter بزن" />
							</div>

							<div class="sheet-actions">
								<Btn onClick={() => rpc("startFocus", t().key).then(close)}>⏱ شروع تمرکز</Btn>
								<Btn onClick={async () => setBranch(await rpc("branchName", t().key))}>⎇ اسم برنچ</Btn>
							</div>
							<Show when={branch()}>
								<pre class="code" onClick={() => navigator.clipboard.writeText(`git switch -c ${branch()}`).then(() => toast("کپی شد"))}>
									git switch -c {branch()}
								</pre>
							</Show>

							<Show when={bundle().links.length}>
								<div class="sheet-section">
									<div class="ff-label">لینک‌ها (کامیت، MR، جیرا)</div>
									<For each={bundle().links}>
										{(l: { kind: string; ref: string; url: string | null; title: string | null }) => (
											<a class="row small" href={l.url ?? "#"} target="_blank" rel="noreferrer" style={{ padding: "3px 0" }}>
												<Tag>{l.kind}</Tag>
												<span class="ltr faint">{l.ref}</span>
												<span>{l.title}</span>
											</a>
										)}
									</For>
								</div>
							</Show>

							<div class="sheet-section">
								<div class="ff-label">گفتگو</div>
								<Thread entity="task" refId={t().key} />
							</div>

							<div class="sheet-danger">
								<button
									type="button"
									onClick={async () => (await confirmAction("این تسک و زیرتسک‌هایش حذف شوند؟", "اگر فقط نمی‌خواهی انجامش بدهی، «کنار گذاشتم» بهتر است؛ تاریخچه می‌ماند.")) && rpc("deleteTask", t().key).then(close)}
								>
									حذف کامل این تسک
								</button>
							</div>
						</Drawer.Body>
					</>
				);
			}}
		</Show>
				</Drawer.Content>
			</Drawer.Positioner>
		</Drawer.Root>
	);
}

// ── Comments ───────────────────────────────────────────────────────────────

export function Thread(props: { entity: CommentEntity; refId: string | number }) {
	const [comments] = createResource(
		() => [props.entity, props.refId, version()] as const,
		([entity, ref]) => rpc<Comment[]>("listComments", entity, ref),
	);
	let input!: HTMLTextAreaElement;
	const send = async () => {
		const body = input.value.trim();
		if (!body) return;
		input.value = "";
		await rpc("comment", props.entity, props.refId, body);
	};
	return (
		<div class="thread">
			<For each={comments()} fallback={<div class="faint small">هنوز کامنتی نیست. از ایجنت‌ها بخواه نظرشان را این‌جا بنویسند.</div>}>
				{(c) => (
					<div class="cmt">
						<div class="avatar" classList={{ agent: c.author !== "me" }}>
							{c.author === "me" ? "🙂" : "🤖"}
						</div>
						<div>
							<div class="small faint">
								<b style={{ color: "var(--text)" }}>{c.author === "me" ? "من" : c.author}</b> · {ago(c.created_at)}
							</div>
							<div class="body">{c.body}</div>
						</div>
					</div>
				)}
			</For>
			<TextArea
				ref={input}
			
				rows="2"
				placeholder="کامنت… (⌘+Enter)"
				onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && send()}
			/>
			<div class="row">
				<span class="spacer" />
				<Btn kind="sm" onClick={send}>
					ارسال
				</Btn>
			</div>
		</div>
	);
}
