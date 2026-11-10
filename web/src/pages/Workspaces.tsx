import { createMemo, createResource, createSignal, For, Show } from "solid-js";

import { Btn, Choice, Panel, Tag, TextInput } from "~/components/app.tsx";
import * as SegmentGroup from "~/components/ui/segment-group";
import { fa, rpc, setWorkspace, STATUS_FA, type Task, toast, version, workspace } from "../api.ts";
import { parseCapture, type Person } from "../capture.ts";
import { ask } from "../kit.tsx";
import { go, openTask, TaskRow } from "../ui.tsx";
import { Board } from "./Projects.tsx";

export interface WorkspaceRow {
	id: number;
	key: string;
	name: string;
	icon: string | null;
	color: string | null;
	kind: "work" | "personal" | "other";
	repos: string[];
	github_user: string | null;
	projects: number;
	open_tasks: number;
	doing: number;
	done_week: number;
	focus_week: number;
	overdue: number;
}

const [list, { refetch: refetchWorkspaces }] = createResource(version, () => rpc<WorkspaceRow[]>("workspaces"));
export { list as workspaces };
export const currentWorkspace = () => list()?.find((w) => w.key === workspace()) ?? null;

async function createWorkspace() {
	const answer = await ask({
		title: "ورک‌اسپیس جدید",
		description: "مثلاً یک پروژه‌ی فریلنس، یک استارتاپ یا زندگی شخصی. داده‌ها جدا می‌مانند و در «نمای کلی» کنار هم دیده می‌شوند.",
		confirm: "بساز",
		fields: [
			{ name: "name", label: "اسم", required: true, placeholder: "مثلاً فریلنس" },
			{ name: "icon", label: "آیکون", value: "✨", suggestions: ["✨", "🚀", "🎨", "📦", "🏠", "🎓"].map((v) => ({ value: v, label: v })) },
			{
				name: "kind",
				label: "نوع",
				type: "select",
				value: "personal",
				options: [
					{ value: "personal", label: "شخصی" },
					{ value: "work", label: "کاری" },
					{ value: "other", label: "دیگر" },
				],
			},
		],
	});
	if (!answer) return;
	const w = await rpc<WorkspaceRow>("saveWorkspace", { name: answer.name, icon: answer.icon, kind: answer.kind });
	refetchWorkspaces();
	setWorkspace(w.key);
	toast(`ورک‌اسپیس «${w.name}» ساخته شد`, "win");
}

/** Sidebar control: pick a workspace, or "all" for the cross-workspace overview. */
export function WorkspaceSwitcher() {
	const options = createMemo(() => [
		{ value: "all", label: "🌐 همه (نمای کلی)" },
		...(list() ?? []).map((w) => ({ value: w.key, label: `${w.icon ?? "•"} ${w.name}` })),
		{ value: "__new__", label: "＋ ورک‌اسپیس جدید" },
	]);
	return (
		<div class="ws-switch">
			<Choice
				width="100%"
				value={workspace()}
				options={options()}
				label="ورک‌اسپیس"
				onChange={(v) => {
					if (v === "__new__") return createWorkspace();
					setWorkspace(v);
					if (v === "all") go("/overview");
				}}
			/>
		</div>
	);
}

// ── Overview across workspaces ─────────────────────────────────────────────

interface Overview {
	days: string[];
	workspaces: (WorkspaceRow & {
		series: { day: string; done: number; commits: number }[];
		commits: number;
		repos_active: { repo: string; commits: number }[];
		in_progress: { key: string; title: string; status: string; column: string | null }[];
		projects_list: { key: string; title: string; stage: string; tasks: number; done: number }[];
	})[];
}

const WS_COLORS = ["var(--accent)", "var(--green)", "var(--violet)", "var(--blue)", "var(--pink)", "var(--cyan)"];

function StackedBars(props: { data: Overview; metric: "done" | "commits" }) {
	const H = 130;
	const totals = () => props.data.days.map((_, i) => props.data.workspaces.reduce((a, w) => a + (w.series[i]?.[props.metric] ?? 0), 0));
	const max = () => Math.max(1, ...totals());
	const bw = () => 600 / props.data.days.length;
	return (
		<svg class="chart" viewBox={`0 0 600 ${H + 22}`} preserveAspectRatio="none">
			<line x1="0" x2="600" y1={H} y2={H} stroke="var(--line)" />
			<For each={props.data.days}>
				{(day, i) => {
					let y = H;
					return (
						<g>
							<For each={props.data.workspaces}>
								{(w, wi) => {
									const v = w.series[i()]?.[props.metric] ?? 0;
									const h = (v / max()) * (H - 8);
									y -= h;
									return v ? (
										<rect x={i() * bw() + bw() * 0.18} width={bw() * 0.64} y={y} height={h} rx="3" fill={WS_COLORS[wi() % WS_COLORS.length]}>
											<title>{`${w.name} · ${day}: ${v}`}</title>
										</rect>
									) : null;
								}}
							</For>
							<text x={i() * bw() + bw() / 2} y={H + 15} text-anchor="middle">
								{new Intl.DateTimeFormat("fa-IR-u-ca-persian", { day: "numeric" }).format(new Date(`${day}T12:00:00`))}
							</text>
						</g>
					);
				}}
			</For>
		</svg>
	);
}

export function OverviewPage() {
	const [data] = createResource(version, () => rpc<Overview>("overview"));
	return (
		<>
			<div class="page-head">
				<div>
					<h1>🌐 نمای کلی</h1>
					<p>کار و زندگی کنار هم: هر ورک‌اسپیس چقدر جلو رفت، کجا گیر است، و گیت‌هایت چه می‌گویند. (۱۴ روز اخیر)</p>
				</div>
				<Btn onClick={createWorkspace}>＋ ورک‌اسپیس جدید</Btn>
			</div>
			<Show when={data()} fallback={<Panel>در حال جمع‌کردن آمار از گیت‌ها…</Panel>}>
				{(d) => (
					<>
						<div class="grid g2" style={{ "margin-bottom": "16px" }}>
							<Panel>
								<h3>
									✅ تسک‌های انجام‌شده <span class="spacer" />
									<For each={d().workspaces}>
										{(w, i) => (
											<span class="legend">
												<i style={{ background: WS_COLORS[i() % WS_COLORS.length] }} />
												{w.name}
											</span>
										)}
									</For>
								</h3>
								<StackedBars data={d()} metric="done" />
							</Panel>
							<Panel>
								<h3>⎇ کامیت‌های خودت</h3>
								<StackedBars data={d()} metric="commits" />
							</Panel>
						</div>
						<div class="grid g2">
							<For each={d().workspaces}>
								{(w, i) => (
									<Panel class="ws-card" style={{ "--wc": WS_COLORS[i() % WS_COLORS.length] }}>
										<div class="row">
											<span style={{ "font-size": "22px" }}>{w.icon}</span>
											<h2 style={{ margin: 0, "font-size": "18px" }}>{w.name}</h2>
											<Tag>{w.kind === "work" ? "کاری" : w.kind === "personal" ? "شخصی" : "دیگر"}</Tag>
											<span class="spacer" />
											<Btn kind="primary sm" onClick={() => (setWorkspace(w.key), go("/today"))}>
												ورود ←
											</Btn>
										</div>
										<div class="grid g4" style={{ margin: "12px 0", gap: "8px" }}>
											<div class="stat">
												<span class="v">{fa(w.open_tasks)}</span>
												<span class="l">باز</span>
											</div>
											<div class="stat">
												<span class="v">{fa(w.doing)}</span>
												<span class="l">در جریان</span>
											</div>
											<div class="stat">
												<span class="v" style={{ color: "var(--green)" }}>
													{fa(w.done_week)}
												</span>
												<span class="l">انجام ۷ روز</span>
											</div>
											<div class="stat">
												<span class="v">{fa(w.commits)}</span>
												<span class="l">کامیت ۱۴ روز</span>
											</div>
										</div>
										<Show when={w.overdue}>
											<div class="nudge warn small">⏰ {fa(w.overdue)} تسک از ددلاین گذشته</div>
										</Show>
										<Show when={w.in_progress.length}>
											<div class="field-label" style={{ "margin-top": "8px" }}>
												در جریان
											</div>
											<For each={w.in_progress}>
												{(t) => (
													<div class="row small" style={{ cursor: "pointer", padding: "2px 0" }} onClick={() => openTask(t.key)}>
														<Tag class="key">{t.key}</Tag>
														<span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{t.title}</span>
														<Show when={t.column}>
															<Tag class="ltr">{t.column}</Tag>
														</Show>
													</div>
												)}
											</For>
										</Show>
										<Show when={w.repos_active.length}>
											<div class="row wrap small" style={{ "margin-top": "10px", gap: "4px" }}>
												<For each={w.repos_active.slice(0, 6)}>
													{(r) => (
														<Tag class="ltr">
															⎇ {r.repo} · {r.commits}
														</Tag>
													)}
												</For>
											</div>
										</Show>
										<Show when={!w.repos.length}>
											<div class="small faint" style={{ "margin-top": "8px" }}>
												گیتی وصل نیست. در «اتصال ← ورک‌اسپیس‌ها» مخزن اضافه کن.
											</div>
										</Show>
									</Panel>
								)}
							</For>
						</div>
					</>
				)}
			</Show>
		</>
	);
}

// ── Task manager ───────────────────────────────────────────────────────────

type View = "open" | "doing" | "done" | "all";
const VIEW_STATUS: Record<View, Task["status"][] | undefined> = {
	open: ["inbox", "todo", "doing", "blocked"],
	doing: ["doing", "blocked"],
	done: ["done"],
	all: undefined,
};

export function TasksPage() {
	const [view, setView] = createSignal<View>("open");
	const [layout, setLayout] = createSignal<"list" | "board">("list");
	const [project, setProject] = createSignal("");
	const [text, setText] = createSignal("");
	const [draft, setDraft] = createSignal("");
	const [projects] = createResource(version, () => rpc<{ key: string; title: string }[]>("listProjects"));
	const [people] = createResource(version, () => rpc<Person[]>("people"));
	const [tasks] = createResource(
		() => [view(), project(), version(), workspace()] as const,
		([v, pr]) =>
			rpc<(Task & { project_key: string | null; project_title: string | null })[]>("listTasks", {
				status: VIEW_STATUS[v],
				project: pr || undefined,
				parent: "root",
				order: v === "done" ? "updated" : "priority",
				limit: 400,
			}),
	);
	const shown = createMemo(() => {
		const q = text().trim().toLowerCase();
		return (tasks() ?? []).filter((t) => !q || t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q) || t.tags.some((g) => g.includes(q)));
	});
	const groups = createMemo(() => {
		const map = new Map<string, typeof shown extends () => infer R ? R : never>();
		for (const t of shown()) {
			const key = t.project_title ?? "📥 بدون پروژه";
			map.set(key, [...(map.get(key) ?? []), t]);
		}
		return [...map.entries()];
	});
	const preview = createMemo(() => (draft().trim() ? parseCapture(draft(), people() ?? []) : null));
	const add = async (e: Event) => {
		e.preventDefault();
		const c = preview();
		if (!c?.text) return;
		const [t] = await rpc<Task[]>("createTasks", c.project ?? (project() || null), [{ title: c.text, due: c.due, priority: c.priority ?? undefined, tags: c.tags }]);
		setDraft("");
		toast(`${t!.key} ساخته شد`, "win");
	};

	return (
		<>
			<div class="page-head">
				<div>
					<h1>📋 تسک‌ها</h1>
					<p>همه‌ی تسک‌های {workspace() === "all" ? "همه‌ی ورک‌اسپیس‌ها" : "این ورک‌اسپیس"} در یک جا. اولویت اول، بعد امتیاز ICE.</p>
				</div>
				<SegmentGroup.Root size="sm" value={layout()} onValueChange={(e) => e.value && setLayout(e.value as "list" | "board")}>
					<SegmentGroup.Indicator />
					<SegmentGroup.Items
						items={[
							{ value: "list", label: "☰ لیست" },
							{ value: "board", label: "▦ بورد" },
						]}
					/>
				</SegmentGroup.Root>
			</div>

			<Panel style={{ "margin-bottom": "14px" }}>
				<form onSubmit={add} class="stack" style={{ gap: "6px" }}>
					<TextInput placeholder="تسک جدید: «fix scroll #bug !p1 فردا» یا «@DISC …»" value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} />
					<Show when={preview()?.text}>
						<div class="row wrap small" style={{ gap: "4px" }}>
							<Tag class="accent">📝 {preview()!.text}</Tag>
							<Show when={preview()!.project || project()}>
								<Tag class="key">@{preview()!.project ?? project()}</Tag>
							</Show>
							<Show when={preview()!.dueLabel}>
								<Tag>📅 {preview()!.dueLabel}</Tag>
							</Show>
							<Show when={preview()!.priority != null}>
								<Tag class="P0">P{preview()!.priority}</Tag>
							</Show>
							<For each={preview()!.tags}>{(t) => <Tag>#{t}</Tag>}</For>
							<span class="faint">Enter برای ساختن</span>
						</div>
					</Show>
				</form>
			</Panel>

			<div class="row wrap" style={{ "margin-bottom": "12px", gap: "8px" }}>
				<SegmentGroup.Root size="sm" value={view()} onValueChange={(e) => e.value && setView(e.value as View)}>
					<SegmentGroup.Indicator />
					<SegmentGroup.Items
						items={[
							{ value: "open", label: "باز" },
							{ value: "doing", label: "در جریان" },
							{ value: "done", label: "انجام‌شده" },
							{ value: "all", label: "همه" },
						]}
					/>
				</SegmentGroup.Root>
				<Choice
					value={project()}
					options={[{ value: "", label: "همه‌ی پروژه‌ها" }, ...(projects() ?? []).map((p) => ({ value: p.key, label: p.title }))]}
					onChange={setProject}
				/>
				<TextInput style={{ width: "220px" }} placeholder="فیلتر: عنوان، کلید، #تگ" value={text()} onInput={(e) => setText(e.currentTarget.value)} />
				<span class="spacer" />
				<span class="small faint">{fa(shown().length)} تسک</span>
			</div>

			<Show
				when={layout() === "list"}
				fallback={<Board tasks={shown()} />}
			>
				<For each={groups()} fallback={<div class="empty">تسکی نیست. بالا یکی بنویس.</div>}>
					{([name, items]) => (
						<Panel style={{ "margin-bottom": "12px" }}>
							<h3>
								{name} <span class="faint small">{fa(items.length)}</span>
								<Show when={items[0]?.project_key}>
									<span class="spacer" />
									<Btn kind="ghost sm" onClick={() => go(`/p/${items[0]!.project_key}`)}>
										پروژه ←
									</Btn>
								</Show>
							</h3>
							<For each={items}>{(t) => <TaskRow task={t} showProject={false} />}</For>
						</Panel>
					)}
				</For>
			</Show>
		</>
	);
}

// ── Settings (Connect page) ────────────────────────────────────────────────

export function WorkspaceSettings() {
	const [detecting, setDetecting] = createSignal(false);
	const save = (id: number, patch: Record<string, unknown>) => rpc("saveWorkspace", { id, ...patch }).then(refetchWorkspaces);
	const detect = async () => {
		setDetecting(true);
		const found = await rpc<{ path: string; workspace: string | null }[]>("detectRepos").finally(() => setDetecting(false));
		refetchWorkspaces();
		toast(`${fa(found.length)} مخزن پیدا و دسته‌بندی شد`, "win");
	};
	return (
		<Panel style={{ "margin-bottom": "16px" }}>
			<h3>
				🗂 ورک‌اسپیس‌ها و گیت
				<span class="spacer" />
				<Btn kind="sm" loading={detecting()} onClick={detect}>
					🔍 پیدا کردن مخزن‌ها
				</Btn>
				<Btn kind="sm" onClick={createWorkspace}>
					＋ جدید
				</Btn>
			</h3>
			<div class="small faint" style={{ "margin-bottom": "10px" }}>
				مخزن‌های ~/development بر اساس remote تقسیم می‌شوند: git.snappfood.ir ← کاری، GitHub ← شخصی. کامیت‌ها با ایمیل گیت خودت فیلتر می‌شوند.
			</div>
			<div class="stack" style={{ gap: "12px" }}>
				<For each={list()}>
					{(w) => (
						<div class="ws-settings">
							<div class="row wrap">
								<span style={{ "font-size": "20px" }}>{w.icon}</span>
								<input class="inline-edit" style={{ width: "160px", "font-weight": 700 }} value={w.name} onChange={(e) => save(w.id, { name: e.currentTarget.value })} />
								<Choice
									size="xs"
									value={w.kind}
									options={[
										{ value: "work", label: "کاری" },
										{ value: "personal", label: "شخصی" },
										{ value: "other", label: "دیگر" },
									]}
									onChange={(v) => save(w.id, { kind: v })}
								/>
								<TextInput
									class="ltr"
									style={{ width: "170px" }}
									placeholder="GitHub user"
									value={w.github_user ?? ""}
									onChange={(e) => save(w.id, { github_user: e.currentTarget.value || null })}
								/>
								<span class="spacer" />
								<span class="small faint">{fa(w.repos.length)} مخزن</span>
							</div>
							<div class="row wrap" style={{ gap: "4px", "margin-top": "6px" }}>
								<For each={w.repos}>
									{(r) => (
										<Tag class="ltr">
											⎇ {r.split("/").pop()}
											<button class="tag-x" title="حذف" onClick={() => save(w.id, { repos: w.repos.filter((x) => x !== r) })}>
												×
											</button>
										</Tag>
									)}
								</For>
								<Btn
									kind="ghost sm"
									onClick={async () => {
										const a = await ask({ title: `مخزن برای «${w.name}»`, fields: [{ name: "path", label: "مسیر کامل", placeholder: "/Users/…/development/my-app", required: true }] });
										if (a) save(w.id, { repos: [...w.repos, a.path.trim()] });
									}}
								>
									＋ مخزن
								</Btn>
							</div>
						</div>
					)}
				</For>
			</div>
		</Panel>
	);
}
