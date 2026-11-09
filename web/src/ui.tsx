import { createEffect, createResource, createRoot, createSignal, For, type JSX, on, onCleanup, onMount, Show } from "solid-js";
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

const [route, setRoute] = createSignal(location.hash.slice(1) || "/today");
window.addEventListener("hashchange", () => setRoute(location.hash.slice(1) || "/today"));
export { route };
export const go = (path: string) => {
	location.hash = path;
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
						<span class="chip" classList={{ "st-blocked": t().due! < new Date().toLocaleDateString("en-CA") && t().status !== "done" }}>
							📅 {jalali(t().due!)}
						</span>
					</Show>
					<For each={t().tags}>{(tag) => <span class="chip">#{tag}</span>}</For>
				</div>
				<div class="row">
					{props.extra}
					<Show when={props.showProject && t().project_key}>
						<span class="chip accent">{t().project_key}</span>
					</Show>
					<Show when={t().priority < 2}>
						<span class={`chip ${PRIORITY_FA[t().priority]}`}>{PRIORITY_FA[t().priority]}</span>
					</Show>
					<Ice value={t().ice} />
					<span class="chip key">{t().key}</span>
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
			<input ref={input} class="input" placeholder={props.placeholder ?? "+ تسک جدید… (Enter)"} />
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
	const save = (patch: Record<string, unknown>) => rpc("updateTask", openTaskKey(), patch);
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
							<div class="row" style={{ "margin-bottom": "10px" }}>
								<span class="chip key">{t().key}</span>
								<Show when={t().jira_key && t().jira_key !== t().key}>
									<span class="chip key">🔗 {t().jira_key}</span>
								</Show>
								<Show when={t().external_status}>
									<a class="chip ltr" href={t().external_url ?? "#"} target="_blank" rel="noreferrer">
										Jira · {t().external_status} ↗
									</a>
								</Show>
								<span class="spacer" />
								<button class="btn ghost sm" onClick={close}>
									✕
								</button>
							</div>
							<input
								class="inline-edit"
								style={{ "font-size": "20px", "font-weight": 800 }}
								value={t().title}
								onChange={(e) => save({ title: e.currentTarget.value })}
							/>
							<div class="grid g3" style={{ margin: "16px 0" }}>
								<label>
									<div class="field-label">وضعیت</div>
									<select class="input" value={t().status} onChange={(e) => save({ status: e.currentTarget.value })}>
										<For each={STATUSES}>{(s) => <option value={s}>{STATUS_FA[s]}</option>}</For>
									</select>
								</label>
								<label>
									<div class="field-label">اولویت</div>
									<select class="input" value={t().priority} onChange={(e) => save({ priority: Number(e.currentTarget.value) })}>
										<For each={[0, 1, 2, 3]}>{(p) => <option value={p}>{PRIORITY_FA[p]}</option>}</For>
									</select>
								</label>
								<label>
									<div class="field-label">اسکوپ</div>
									<select class="input" value={t().scope ?? ""} onChange={(e) => save({ scope: e.currentTarget.value || null })}>
										<option value="">تصمیم نگرفته</option>
										<For each={["in", "later", "out"]}>{(s) => <option value={s}>{SCOPE_FA[s]}</option>}</For>
									</select>
								</label>
								<label>
									<div class="field-label">تخمین (ساعت)</div>
									<input
										class="input ltr"
										type="number"
										step="0.5"
										value={t().estimate_h ?? ""}
										onChange={(e) => save({ estimate_h: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
									/>
								</label>
								<label>
									<div class="field-label">ددلاین</div>
									<input class="input ltr" type="date" value={t().due ?? ""} onChange={(e) => save({ due: e.currentTarget.value || null })} />
								</label>
								<div>
									<div class="field-label">زمان واقعی</div>
									<div style={{ padding: "7px 0" }}>
										{fa(Math.round(t().actual_h * 10) / 10)} ساعت
									</div>
								</div>
							</div>

							<div class="card" style={{ "margin-bottom": "16px" }}>
								<h3>
									اولویت‌بندی ICE <span class="spacer" /> <Ice value={t().ice} />
								</h3>
								<div class="stack" style={{ gap: "10px" }}>
									<Slider label="تأثیر" hint="چقدر هدف را جلو می‌برد؟" value={t().impact} onChange={(v) => save({ impact: v })} />
									<Slider label="اطمینان" hint="چقدر مطمئنی که جواب می‌دهد؟" value={t().confidence} onChange={(v) => save({ confidence: v })} />
									<Slider label="سهولت" hint="چقدر کم‌هزینه است؟" value={t().ease} onChange={(v) => save({ ease: v })} />
								</div>
							</div>

							<div class="field-label">توضیحات</div>
							<textarea
								class="textarea"
								rows="5"
								placeholder="تعریف «انجام شد» چیست؟"
								value={t().description ?? ""}
								onChange={(e) => save({ description: e.currentTarget.value })}
							/>

							<div class="row wrap" style={{ margin: "14px 0" }}>
								<button class="btn" onClick={() => rpc("startFocus", t().key)}>
									⏱ شروع تمرکز
								</button>
								<button class="btn" onClick={async () => setBranch(await rpc("branchName", t().key))}>
									⎇ اسم برنچ
								</button>
								<Show when={!t().jira_key}>
									<button class="btn" onClick={() => rpc("jiraPush", t().key).then(() => toast("در جیرا ساخته شد", "win"))}>
										↗ ساخت در جیرا
									</button>
								</Show>
								<span class="spacer" />
								<button
									class="btn ghost danger sm"
									onClick={async () => (await confirmAction("این تسک و زیرتسک‌هایش حذف شوند؟", "برای نگه داشتن تاریخچه، «کنار گذاشته» بهتر است.")) && rpc("deleteTask", t().key).then(close)}
								>
									حذف
								</button>
							</div>
							<Show when={branch()}>
								<pre class="code" onClick={() => navigator.clipboard.writeText(`git switch -c ${branch()}`).then(() => toast("کپی شد"))}>
									git switch -c {branch()}
								</pre>
							</Show>

							<h3 style={{ margin: "20px 0 6px" }}>زیرتسک‌ها</h3>
							<For each={bundle().subtasks}>{(s: Task) => <TaskRow task={s} />}</For>
							<QuickAdd project={t().project_id ? String(t().project_id) : null} parent={t().key} placeholder="+ زیرتسک…" />

							<Show when={bundle().links.length}>
								<h3 style={{ margin: "20px 0 6px" }}>لینک‌ها</h3>
								<For each={bundle().links}>
									{(l: { kind: string; ref: string; url: string | null; title: string | null }) => (
										<a class="row small" href={l.url ?? "#"} target="_blank" rel="noreferrer" style={{ padding: "3px 0" }}>
											<span class="chip">{l.kind}</span>
											<span class="ltr faint">{l.ref}</span>
											<span>{l.title}</span>
										</a>
									)}
								</For>
							</Show>

							<h3 style={{ margin: "20px 0 8px" }}>گفتگو</h3>
							<Thread entity="task" refId={t().key} />
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
			<textarea
				ref={input}
				class="textarea"
				rows="2"
				placeholder="کامنت… (⌘+Enter)"
				onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && send()}
			/>
			<div class="row">
				<span class="spacer" />
				<button class="btn sm" onClick={send}>
					ارسال
				</button>
			</div>
		</div>
	);
}
