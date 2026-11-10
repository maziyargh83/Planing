import { Btn, Choice, Panel, Tag, TextInput } from "~/components/app.tsx";
import { Inline } from "~/components/form.tsx";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { createResource } from "../live.ts";
import * as Tabs from "~/components/ui/tabs";

import { type Ask, fa, type Goal, rpc, SCOPE_FA, STAGE_FA, STAGES, STATUS_FA, type Task, version } from "../api.ts";
import { go, Ice, openTask, QuickAdd, setStatus, TaskRow, Thread } from "../ui.tsx";
import { MindMap } from "./MindMap.tsx";
import { AskCard } from "./Today.tsx";

const STAGE_COLOR: Record<string, string> = {
	idea: "var(--faint)",
	discovery: "var(--violet)",
	scoping: "var(--cyan)",
	ready: "var(--blue)",
	active: "var(--accent)",
	shipped: "var(--green)",
	archived: "var(--line-2)",
};

export function Projects() {
	const [projects] = createResource(version, () => rpc("listProjects", STAGES.slice(0, 6)));
	const [title, setTitle] = createSignal("");
	const create = async (e: Event) => {
		e.preventDefault();
		if (!title().trim()) return;
		const p = await rpc("createProject", { title: title().trim() });
		go(`/p/${p.key}`);
	};
	const byStage = createMemo(() => STAGES.slice(0, 6).map((s) => ({ stage: s, items: (projects() ?? []).filter((p: { stage: string }) => p.stage === s) })));

	return (
		<>
			<div class="page-head">
				<div>
					<h1>پروژه‌ها</h1>
					<p>از ایده تا تحویل: دیسکاوری، اسکوپ، اولویت، اجرا.</p>
				</div>
				<form class="row" onSubmit={create}>
					<TextInput style={{ width: "280px" }} placeholder="یک ایده جدید…" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
					<Btn kind="primary">+ ایده</Btn>
				</form>
			</div>
			<For each={byStage().filter((s) => s.items.length)} fallback={<div class="empty">هنوز پروژه‌ای نیست. یک ایده بنویس، یا به ایجنتت بگو: «این ایده را پلن کن».</div>}>
				{(group) => (
					<section style={{ "margin-bottom": "22px" }}>
						<h3 class="row" style={{ color: STAGE_COLOR[group.stage], margin: "0 0 10px" }}>
							● {STAGE_FA[group.stage]} <span class="faint small">{fa(group.items.length)}</span>
						</h3>
						<div class="grid g3">
							<For each={group.items}>
								{(p: { key: string; title: string; stage: string; tasks: number; done: number; doing: number; open_asks: number; nodes: number; goal_title: string | null; problem: string | null; color: string | null }) => (
									<Panel class="pcard" style={{ "--pc": p.color ?? STAGE_COLOR[p.stage] }} onClick={() => go(`/p/${p.key}`)}>
										<div class="row">
											<Tag class="key">{p.key}</Tag>
											<Show when={p.goal_title}>
												<Tag class="accent">🎯 {p.goal_title}</Tag>
											</Show>
										</div>
										<h2>{p.title}</h2>
										<Show when={p.problem}>
											<div class="small muted" style={{ "-webkit-line-clamp": 2, display: "-webkit-box", "-webkit-box-orient": "vertical", overflow: "hidden" }}>
												{p.problem}
											</div>
										</Show>
										<div class="bar">
											<i style={{ width: `${p.tasks ? (100 * p.done) / p.tasks : 0}%` }} />
										</div>
										<div class="row small faint wrap">
											<span>
												{fa(p.done)}/{fa(p.tasks)} تسک
											</span>
											<Show when={p.doing}>· {fa(p.doing)} در جریان</Show>
											<Show when={p.nodes}>· 🧠 {fa(p.nodes)}</Show>
											<Show when={p.open_asks}>
												<Tag style={{ color: "var(--violet)" }}>
													❓ {fa(p.open_asks)}
												</Tag>
											</Show>
										</div>
									</Panel>
								)}
							</For>
						</div>
					</section>
				)}
			</For>
		</>
	);
}

type Tab = "map" | "scope" | "tasks" | "board" | "asks" | "talk" | "activity";

export function ProjectPage(props: { projectKey: string }) {
	const [bundle] = createResource(
		() => [props.projectKey, version()] as const,
		([key]) => rpc("projectBundle", key),
	);
	const [goals] = createResource(version, () => rpc<Goal[]>("listGoals"));
	const [tab, setTab] = createSignal<Tab>("map");
	const save = (patch: Record<string, unknown>) => rpc("updateProject", props.projectKey, patch);
	const flat = createMemo<Task[]>(() => {
		const out: Task[] = [];
		const walk = (ts: (Task & { children?: Task[] })[]) => ts.forEach((t) => (out.push(t), walk(t.children ?? [])));
		walk(bundle()?.tasks ?? []);
		return out;
	});

	return (
		<Show when={bundle()}>
			{(b) => {
				const p = () => b().project;
				const stageIndex = () => STAGES.indexOf(p().stage);
				return (
					<>
						<div class="row small faint" style={{ "margin-bottom": "6px" }}>
							<a href="#/projects">پروژه‌ها</a> / <span class="ltr">{p().key}</span>
						</div>
						<Inline size="xl" required label="نام پروژه" value={p().title} onSave={(v) => save({ title: v })} />
						<div class="row wrap" style={{ margin: "12px 0 18px", gap: "12px" }}>
							<div class="stepper">
								<For each={STAGES}>
									{(s, i) => (
										<button classList={{ on: s === p().stage, past: i() < stageIndex() }} onClick={() => save({ stage: s })}>
											{STAGE_FA[s]}
										</button>
									)}
								</For>
							</div>
							<span class="spacer" />
							<Show when={goals()}>
							<Choice
								value={p().goal_id == null ? "" : String(p().goal_id)}
								options={[{ value: "", label: "🎯 بدون هدف" }, ...(goals() ?? []).map((g) => ({ value: String(g.id), label: `🎯 ${g.title}` }))]}
								onChange={(v) => save({ goal: v ? Number(v) : null })}
								width="min(420px, 100%)"
							/>
							</Show>
						</div>

						<div class="grid g3" style={{ "margin-bottom": "18px" }}>
							<For
								each={[
									["problem", "مسئله", "چه دردی را حل می‌کنیم؟ برای چه کسی؟"],
									["hypothesis", "فرضیه", "اگر … کنیم، آن‌وقت … اتفاق می‌افتد"],
									["success_metric", "معیار موفقیت", "از کجا بفهمیم جواب داده؟"],
								] as const}
							>
								{([field, label, hint]) => (
									<Panel style={{ padding: "12px 14px" }}>
										<div class="field-label">{label}</div>
										<Inline
											multiline
											placeholder={`＋ ${hint}`}
											value={(p() as unknown as Record<string, string | null>)[field]}
											onSave={(v) => save({ [field]: v || null })}
										/>
									</Panel>
								)}
							</For>
						</div>

						<Tabs.Root value={tab()} onValueChange={(e) => setTab(e.value as Tab)} variant="line" size="sm" style={{ "margin-bottom": "16px" }}>
							<Tabs.List>
							<For
								each={
									[
										["map", "🧠 نقشه ذهنی", b().mindmap.length],
										["scope", "📐 اسکوپ", null],
										["tasks", "📋 تسک‌ها", flat().length],
										["board", "🗂 بورد", null],
										["asks", "❓ سؤال‌ها", b().asks.filter((a: Ask) => a.status === "open").length],
										["talk", "💬 گفتگو", b().comments.length],
										["activity", "⚡ فعالیت", null],
									] as [Tab, string, number | null][]
								}
							>
								{([id, label, count]) => (
									<Tabs.Trigger value={id}>
										{label}
										<Show when={count}>
											<span class="count">{fa(count)}</span>
										</Show>
									</Tabs.Trigger>
								)}
							</For>
							<Tabs.Indicator />
							</Tabs.List>
						</Tabs.Root>

						<Switch>
							<Match when={tab() === "map"}>
								<MindMap projectKey={p().key} title={p().title} tree={b().mindmap} />
							</Match>
							<Match when={tab() === "scope"}>
								<ScopeView tasks={b().tasks} />
							</Match>
							<Match when={tab() === "tasks"}>
								<Panel>
									<div class="row small faint" style={{ "margin-bottom": "6px" }}>
										به ترتیب: اولویت، سپس امتیاز ICE
									</div>
									<For each={b().tasks} fallback={<div class="empty">هنوز تسکی نیست.</div>}>
										{(t: Task) => <TaskRow task={t} />}
									</For>
									<QuickAdd project={p().key} />
								</Panel>
							</Match>
							<Match when={tab() === "board"}>
								<Board tasks={flat().filter((t) => !t.parent_id)} />
							</Match>
							<Match when={tab() === "asks"}>
								<div class="grid g2">
									<For each={b().asks} fallback={<div class="empty">سؤالی نیست. از ایجنت بخواه برای دیسکاوری سؤال بپرسد.</div>}>
										{(a: Ask) => <AskCard ask={a} />}
									</For>
								</div>
							</Match>
							<Match when={tab() === "talk"}>
								<Panel style={{ "max-width": "760px" }}>
									<Thread entity="project" refId={p().key} />
								</Panel>
							</Match>
							<Match when={tab() === "activity"}>
								<Panel>
									<For each={b().activity}>
										{(e: { id: number; actor: string; action: string; summary: string; at: string }) => (
											<div class="row small" style={{ padding: "4px 0", "border-bottom": "1px solid var(--line)" }}>
												<span>{e.actor === "me" ? "🙂" : "🤖"}</span>
												<b>{e.actor === "me" ? "من" : e.actor}</b>
												<Tag>{e.action}</Tag>
												<span class="muted">{e.summary}</span>
												<span class="spacer" />
												<span class="faint">{new Date(e.at).toLocaleString("fa-IR")}</span>
											</div>
										)}
									</For>
								</Panel>
							</Match>
						</Switch>
					</>
				);
			}}
		</Show>
	);
}

function ScopeView(props: { tasks: Task[] }) {
	const cols = [
		{ id: null, label: "تصمیم نگرفته", color: "var(--faint)" },
		{ id: "in", label: SCOPE_FA.in, color: "var(--green)" },
		{ id: "later", label: SCOPE_FA.later, color: "var(--accent)" },
		{ id: "out", label: SCOPE_FA.out, color: "var(--red)" },
	] as const;
	const [over, setOver] = createSignal<string | null | undefined>(undefined);
	const totals = (scope: string | null) => {
		const ts = props.tasks.filter((t) => t.scope === scope);
		return { n: ts.length, h: ts.reduce((a, t) => a + (t.estimate_h ?? 0), 0) };
	};
	return (
		<>
			<div class="small muted" style={{ "margin-bottom": "10px" }}>
				کارت‌ها را بین ستون‌ها بکش. «داخل» یعنی کوچک‌ترین نسخه‌ای که فرضیه را تست می‌کند.
			</div>
			<div class="scope-cols">
				<For each={cols}>
					{(col) => (
						<div
							class="col"
							classList={{ over: over() === col.id }}
							onDragOver={(e) => (e.preventDefault(), setOver(col.id))}
							onDragLeave={() => setOver(undefined)}
							onDrop={(e) => {
								e.preventDefault();
								setOver(undefined);
								rpc("updateTask", e.dataTransfer!.getData("text/plain"), { scope: col.id });
							}}
						>
							<h4>
								<span style={{ color: col.color }}>● {col.label}</span>
								<span class="faint">
									{fa(totals(col.id).n)}
									<Show when={totals(col.id).h}> · {fa(totals(col.id).h)}h</Show>
								</span>
							</h4>
							<For each={props.tasks.filter((t) => t.scope === col.id)}>
								{(t) => (
									<div class="tcard" draggable="true" onDragStart={(e) => e.dataTransfer!.setData("text/plain", t.key)} onClick={() => openTask(t.key)}>
										<div>{t.title}</div>
										<div class="row small" style={{ "margin-top": "6px" }}>
											<Tag class="key">{t.key}</Tag>
											<span class="spacer" />
											<Ice value={t.ice} />
										</div>
									</div>
								)}
							</For>
						</div>
					)}
				</For>
			</div>
		</>
	);
}

export function Board(props: { tasks: Task[] }) {
	const cols = ["todo", "doing", "blocked", "done"] as const;
	const [over, setOver] = createSignal<string | null>(null);
	return (
		<div class="board">
			<For each={cols}>
				{(status) => (
					<div
						class="col"
						classList={{ over: over() === status }}
						onDragOver={(e) => (e.preventDefault(), setOver(status))}
						onDragLeave={() => setOver(null)}
						onDrop={(e) => {
							e.preventDefault();
							setOver(null);
							const key = e.dataTransfer!.getData("text/plain");
							const task = props.tasks.find((t) => t.key === key);
							if (task) setStatus(task, status);
						}}
					>
						<h4>
							<span class={`st-${status}`}>{STATUS_FA[status]}</span>
							<span class="faint">{fa(props.tasks.filter((t) => t.status === status || (status === "todo" && t.status === "inbox")).length)}</span>
						</h4>
						<For each={props.tasks.filter((t) => t.status === status || (status === "todo" && t.status === "inbox"))}>
							{(t) => (
								<div class="tcard" draggable="true" onDragStart={(e) => e.dataTransfer!.setData("text/plain", t.key)} onClick={() => openTask(t.key)}>
									<div>{t.title}</div>
									<div class="row small" style={{ "margin-top": "6px" }}>
										<Tag class="key">{t.key}</Tag>
										<Show when={t.scope}>
											<Tag>{SCOPE_FA[t.scope!]}</Tag>
										</Show>
										<span class="spacer" />
										<Ice value={t.ice} />
									</div>
								</div>
							)}
						</For>
					</div>
				)}
			</For>
		</div>
	);
}
