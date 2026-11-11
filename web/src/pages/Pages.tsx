import { newGoal } from "../flows.ts";
import { Inline, Stepper } from "~/components/form.tsx";
import { WorkspaceSettings } from "./Workspaces.tsx";
import { Btn, Choice, Panel, Tag, TextInput } from "~/components/app.tsx";
import { createSignal, For, Show } from "solid-js";
import { createResource } from "../live.ts";

import { fa, type Goal, HORIZON_FA, jalali, type Memory, rpc, type Task, toast, TOPIC_FA, version } from "../api.ts";
import { go, QuickAdd, TaskRow } from "../ui.tsx";

// ── Inbox ──────────────────────────────────────────────────────────────────

export function Inbox() {
	const [tasks] = createResource(version, () => rpc<Task[]>("listTasks", { project: "inbox", status: ["inbox", "todo", "doing", "blocked"], order: "updated" }));
	const [projects] = createResource(version, () => rpc("listProjects"));
	return (
		<>
			<div class="page-head">
				<div>
					<h1>صندوق ورودی</h1>
					<p>هر فکری را سریع بریز این‌جا (⌘K). بعد یا به پروژه ببر، یا انجامش بده، یا دورش بینداز.</p>
				</div>
			</div>
			<Panel>
				<QuickAdd placeholder="+ چه چیزی توی ذهنته؟" />
				<div style={{ "margin-top": "10px" }}>
					<For each={tasks()} fallback={<div class="empty">صندوق خالی است. ذهن آزاد ✨</div>}>
						{(t) => (
							<TaskRow
								task={t}
								extra={
									<>
										<Choice
											size="xs"
											value=""
											placeholder="→ پروژه"
											options={[{ value: "", label: "→ پروژه" }, ...(projects() ?? []).map((p: { key: string; title: string }) => ({ value: p.key, label: p.title }))]}
											onChange={(v) => v && rpc("updateTask", t.key, { project: v, status: "todo" })}
										/>
										<Btn kind="ghost sm" title="کنار بگذار" onClick={() => rpc("updateTask", t.key, { status: "dropped" })}>
											🗑
										</Btn>
									</>
								}
							/>
						)}
					</For>
				</div>
			</Panel>
		</>
	);
}

// ── Goals ──────────────────────────────────────────────────────────────────

export function Goals() {
	const [goals] = createResource(version, () => rpc<(Goal & { projects: number; evidence: number; progress: number | null })[]>("listGoals"));
	const [open, setOpen] = createSignal<number | null>(null);
	const [title, setTitle] = createSignal("");
	return (
		<>
			<div class="page-head">
				<div>
					<h1>اهداف</h1>
					<p>هر پروژه باید به یک هدف وصل باشد. هر هدف یک «چرا» و یک عدد دارد.</p>
				</div>
				<Btn kind="primary" onClick={() => newGoal()}>
					＋ هدف تازه
				</Btn>
			</div>
			<div class="grid g2">
				<For each={goals()} fallback={<div class="empty">هدفی تعریف نشده. از ایجنت بخواه با تو هدف‌های این فصل را دربیاورد.</div>}>
					{(g) => {
						const save = (patch: Record<string, unknown>) => rpc("updateGoal", g.id, patch);
						return (
							<Panel class="stack" style={{ opacity: g.status === "active" ? 1 : 0.6 }}>
								<div class="row">
									<Show when={g.source} fallback={<Tag class="accent">{HORIZON_FA[g.horizon]}</Tag>}>
										<Tag class="accent ltr">
											{g.source}
											{g.cycle ? ` · ${g.cycle}` : ""}
										</Tag>
									</Show>
									<Choice
										size="xs"
										value={g.status}
										options={[
											{ value: "active", label: "فعال" },
											{ value: "paused", label: "متوقف" },
											{ value: "achieved", label: "رسیدم 🎉" },
											{ value: "dropped", label: "رها شد" },
										]}
										onChange={(v) => save({ status: v })}
									/>
									<span class="spacer" />
									<Btn kind="ghost sm" onClick={() => setOpen(open() === g.id ? null : g.id)}>
										🏅 {fa(g.evidence)} شاهد
									</Btn>
									<span class="small faint">{fa(g.projects)} پروژه</span>
								</div>
								<Inline size="lg" required label="هدف" value={g.title} onSave={(v) => save({ title: v })} />
								<Inline size="sm" multiline placeholder="＋ چرا این برایم مهم است؟" value={g.why} onSave={(v) => save({ why: v || null })} />
								<div class="goal-metric">
									<div class="ff-label">از کجا بفهمم رسیدم؟</div>
									<Inline size="sm" placeholder="＋ یک معیار بنویس، مثلاً CTR سرچ" value={g.metric} onSave={(v) => save({ metric: v || null })} />
									<div class="row small wrap">
										<span class="faint">الان</span>
										<Stepper label="عدد فعلی" value={g.current} onChange={(v) => save({ current: v })} />
										<span class="faint">از</span>
										<Stepper label="عدد هدف" value={g.target} onChange={(v) => save({ target: v })} />
									</div>
								</div>
								<Show when={g.progress != null}>
									<div class="row">
										<div class="bar" style={{ flex: 1 }}>
											<i style={{ width: `${Math.min(100, g.progress!)}%` }} />
										</div>
										<b class="small">{fa(g.progress)}٪</b>
									</div>
								</Show>
								<Show when={open() === g.id}>
									<Evidence goal={g.id} />
								</Show>
							</Panel>
						);
					}}
				</For>
			</div>
		</>
	);
}

function Evidence(props: { goal: number }) {
	const [data] = createResource(
		() => [props.goal, version()] as const,
		([id]) => rpc<{ entries: { id: number; day: string; kind: string; body: string | null; author: string }[]; finished: Task[] }>("goalEvidence", id),
	);
	let input!: HTMLInputElement;
	const add = (e: Event) => {
		e.preventDefault();
		if (!input.value.trim()) return;
		rpc("addJournal", { kind: "win", body: input.value.trim(), goal: props.goal }).then(() => (input.value = "", toast("شاهد ثبت شد 🏅")));
	};
	return (
		<div class="stack" style={{ "border-top": "1px solid var(--line)", "padding-top": "10px" }}>
			<form class="row" onSubmit={add}>
				<TextInput ref={input} placeholder="یک کار مشخص که این هدف را نشان می‌دهد…" />
				<Btn kind="sm">+ شاهد</Btn>
			</form>
			<For each={data()?.entries} fallback={<div class="faint small">هنوز شاهدی ثبت نشده. اتوماسیون «جمع‌آوری شواهد» هر هفته از کارهایت جمع می‌کند.</div>}>
				{(e) => (
					<div class="small row" style={{ "align-items": "flex-start" }}>
						<span>{e.author === "me" ? "🙂" : "🤖"}</span>
						<span style={{ flex: 1 }}>{e.body}</span>
						<span class="faint">{jalali(e.day)}</span>
					</div>
				)}
			</For>
			<Show when={data()?.finished.length}>
				<div class="small faint">تسک‌های تمام‌شده در پروژه‌های این هدف: {fa(data()!.finished.length)}</div>
			</Show>
		</div>
	);
}

// ── Insights ───────────────────────────────────────────────────────────────

interface Insights {
	totals: { done: number; created: number; focus_minutes: number };
	series: { day: string; done: number; created: number; focus: number; energy: number | null; mood: number | null }[];
	estimation_ratio: number | null;
	estimation_sample: number;
	alignment: number | null;
	streak: number;
	by_project: { key: string | null; title: string | null; done: number }[];
	energy: { avg: number | null; done_on_high_energy_days: number | null; done_on_low_energy_days: number | null };
	nudges: { level: string; message: string }[];
}

function Bars(props: { data: { label: string; a: number; b?: number | null }[]; aColor: string; bColor?: string; bMax?: number }) {
	const H = 150;
	const max = () => Math.max(1, ...props.data.map((d) => d.a));
	const bw = () => 600 / props.data.length;
	return (
		<svg class="chart" viewBox={`0 0 600 ${H + 24}`} preserveAspectRatio="none">
			<line x1="0" x2="600" y1={H} y2={H} stroke="var(--line)" />
			<For each={props.data}>
				{(d, i) => {
					const h = () => (d.a / max()) * (H - 10);
					return (
						<g>
							<rect x={i() * bw() + bw() * 0.2} width={bw() * 0.6} y={H - h()} height={h()} rx="4" fill={props.aColor}>
								<title>{`${d.label}: ${d.a}`}</title>
							</rect>
							<Show when={d.a}>
								<text x={i() * bw() + bw() / 2} y={H - h() - 4} text-anchor="middle">
									{fa(d.a)}
								</text>
							</Show>
							<text x={i() * bw() + bw() / 2} y={H + 16} text-anchor="middle">
								{d.label}
							</text>
						</g>
					);
				}}
			</For>
			<Show when={props.bColor}>
				<polyline
					fill="none"
					stroke={props.bColor}
					stroke-width="2.5"
					stroke-linejoin="round"
					points={props.data
						.map((d, i) => (d.b == null ? null : `${i * bw() + bw() / 2},${H - (d.b / (props.bMax ?? 5)) * (H - 10)}`))
						.filter(Boolean)
						.join(" ")}
				/>
				<For each={props.data}>
					{(d, i) => (
						<Show when={d.b != null}>
							<circle cx={i() * bw() + bw() / 2} cy={H - (d.b! / (props.bMax ?? 5)) * (H - 10)} r="4" fill={props.bColor} />
						</Show>
					)}
				</For>
			</Show>
		</svg>
	);
}

export function InsightsPage() {
	const [days, setDays] = createSignal(14);
	const [data] = createResource(() => [days(), version()] as const, ([d]) => rpc<Insights>("insights", d));
	const short = (day: string) => jalali(day, { day: "numeric" });
	return (
		<Show when={data()}>
			{(d) => (
				<>
					<div class="page-head">
						<div>
							<h1>بینش‌ها</h1>
							<p>آینه‌ی صادق: چطور واقعاً کار می‌کنی، نه چطور فکر می‌کنی کار می‌کنی.</p>
						</div>
						<div class="row">
							<For each={[7, 14, 30, 90]}>
								{(n) => (
									<Btn kind="sm" active={days() === n} onClick={() => setDays(n)}>
										{fa(n)} روز
									</Btn>
								)}
							</For>
						</div>
					</div>
					<div class="grid g4" style={{ "margin-bottom": "16px" }}>
						<Panel class="stat">
							<span class="v">{fa(d().totals.done)}</span>
							<span class="l">تسک انجام شد · {fa(d().totals.created)} ساخته شد</span>
						</Panel>
						<Panel class="stat">
							<span class="v">{fa(Math.round(d().totals.focus_minutes / 60))}h</span>
							<span class="l">تمرکز ثبت‌شده</span>
						</Panel>
						<Panel class="stat">
							<span class="v" style={{ color: d().alignment == null ? undefined : d().alignment! >= 70 ? "var(--green)" : "var(--accent)" }}>
								{d().alignment == null ? "—" : `${fa(d().alignment)}٪`}
							</span>
							<span class="l">هم‌راستایی با اهداف</span>
						</Panel>
						<Panel class="stat">
							<span class="v">{d().estimation_ratio == null ? "—" : `×${fa(d().estimation_ratio)}`}</span>
							<span class="l">
								{d().estimation_ratio == null
									? "تخمین بزن و تمرکز ثبت کن تا این را ببینی"
									: d().estimation_ratio! > 1.2
										? `کارها ${fa(Math.round((d().estimation_ratio! - 1) * 100))}٪ بیشتر از تخمینت طول می‌کشند`
										: d().estimation_ratio! < 0.8
											? "بیش از حد محتاط تخمین می‌زنی"
											: "تخمین‌هایت دقیق است 👌"}
							</span>
						</Panel>
					</div>
					<div class="grid g2">
						<Panel>
							<h3>
								تسک‌های انجام‌شده و انرژی <span class="spacer" />
								<Tag style={{ color: "var(--violet)" }}>— انرژی</Tag>
							</h3>
							<Bars data={d().series.map((s) => ({ label: short(s.day), a: s.done, b: s.energy }))} aColor="var(--accent)" bColor="var(--violet)" />
						</Panel>
						<Panel>
							<h3>دقیقه‌های تمرکز</h3>
							<Bars data={d().series.map((s) => ({ label: short(s.day), a: s.focus }))} aColor="var(--blue)" />
						</Panel>
						<Panel>
							<h3>انرژی و خروجی</h3>
							<Show when={d().energy.avg != null} fallback={<div class="faint small">هر روز چک‌این انرژی بزن تا الگو پیدا شود.</div>}>
								<div class="stack small">
									<div>میانگین انرژی: <b>{fa(Math.round(d().energy.avg! * 10) / 10)}</b> از ۵</div>
									<div>روزهای پرانرژی: <b>{fa(d().energy.done_on_high_energy_days)}</b> تسک در روز</div>
									<div>روزهای کم‌انرژی: <b>{fa(d().energy.done_on_low_energy_days)}</b> تسک در روز</div>
								</div>
							</Show>
						</Panel>
						<Panel>
							<h3>کار به تفکیک پروژه</h3>
							<For each={d().by_project} fallback={<div class="faint small">هنوز چیزی انجام نشده.</div>}>
								{(p) => (
									<div class="row small" style={{ padding: "3px 0", cursor: p.key ? "pointer" : undefined }} onClick={() => p.key && go(`/p/${p.key}`)}>
										<span style={{ "min-width": "120px" }}>{p.title ?? "بدون پروژه"}</span>
										<div class="bar" style={{ flex: 1 }}>
											<i style={{ width: `${(100 * p.done) / Math.max(...d().by_project.map((x) => x.done))}%` }} />
										</div>
										<b>{fa(p.done)}</b>
									</div>
								)}
							</For>
						</Panel>
					</div>
				</>
			)}
		</Show>
	);
}

// ── Memory ─────────────────────────────────────────────────────────────────

export function MemoryPage() {
	const [memories] = createResource(version, () => rpc<Memory[]>("listMemories"));
	const [topic, setTopic] = createSignal("preference");
	const [fact, setFact] = createSignal("");
	const grouped = () => Object.keys(TOPIC_FA).map((t) => ({ topic: t, items: (memories() ?? []).filter((m) => m.topic === t) }));
	return (
		<>
			<div class="page-head">
				<div>
					<h1>حافظه</h1>
					<p>چیزهایی که ایجنت‌ها درباره‌ی تو یاد گرفته‌اند. هر ایجنتی که وصل شود اول این‌ها را می‌خواند.</p>
				</div>
			</div>
			<form
				class="card row wrap"
				style={{ "margin-bottom": "16px" }}
				onSubmit={(e) => {
					e.preventDefault();
					if (fact().trim()) rpc("remember", topic(), fact().trim()).then(() => (setFact(""), toast("یاد گرفتم ✓")));
				}}
			>
				<Choice value={topic()} options={Object.entries(TOPIC_FA).map(([value, label]) => ({ value, label }))} onChange={setTopic} />
				<TextInput style={{ flex: 1 }} placeholder="مثلاً: صبح‌ها بهترین زمان کار عمیق من است" value={fact()} onInput={(e) => setFact(e.currentTarget.value)} />
				<Btn kind="primary">به خاطر بسپار</Btn>
			</form>
			<div class="grid g2">
				<For each={grouped().filter((g) => g.items.length)} fallback={<div class="empty">هنوز چیزی یاد نگرفته‌اند. با ایجنتت حرف بزن؛ خودش یادداشت می‌کند.</div>}>
					{(g) => (
						<Panel>
							<h3>{TOPIC_FA[g.topic]}</h3>
							<For each={g.items}>
								{(m) => (
									<div class="row" style={{ padding: "4px 0", "border-bottom": "1px solid var(--line)" }}>
										<Inline size="sm" multiline required label="حافظه" value={m.fact} onSave={(v) => rpc("updateMemory", m.id, { fact: v })} />
										<Tag class="faint" title="منبع">{m.source === "me" ? "من" : m.source}</Tag>
										<Btn kind="ghost sm danger" onClick={() => rpc("forget", m.id)}>
											✕
										</Btn>
									</div>
								)}
							</For>
						</Panel>
					)}
				</For>
			</div>
		</>
	);
}

// ── Connect ────────────────────────────────────────────────────────────────

export function Connect() {
	const [info] = createResource(() => rpc("integrations"));
	const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast("کپی شد"));
	const Snippet = (props: { title: string; code: string; note?: string }) => (
		<Panel>
			<h3>
				{props.title}
				<span class="spacer" />
				<Btn kind="sm" onClick={() => copy(props.code)}>
					کپی
				</Btn>
			</h3>
			<Show when={props.note}>
				<p class="small muted" style={{ margin: "0 0 8px" }}>
					{props.note}
				</p>
			</Show>
			<pre class="code">{props.code}</pre>
		</Panel>
	);
	return (
		<Show when={info()}>
			{(i) => {
				const stdio = ["--disable-warning=ExperimentalWarning", `--env-file-if-exists=${i().root}/.env`, `${i().root}/src/transports/mcp/stdio.ts`];
				const json = JSON.stringify({ mcpServers: { gaam: { command: "node", args: stdio } } }, null, 2);
				return (
					<>
						<div class="page-head">
							<div>
								<h1>اتصال ایجنت‌ها</h1>
								<p>گام یک سرور MCP است. هر ایجنتی (Claude Code، Claude Desktop، Cursor، Codex، ایجنت‌های دستان) می‌تواند وصل شود.</p>
							</div>
						</div>
						<WorkspaceSettings />
						<AiProviders />
						<JiraBoard />
						<div class="grid g2" style={{ "margin-bottom": "16px" }}>
							<For
								each={[
									["Jira", i().jira, "JIRA_URL, JIRA_TOKEN (+ JIRA_EMAIL برای Cloud)"],
									["GitLab", i().gitlab, "GITLAB_URL, GITLAB_TOKEN"],
									["GitHub", i().github, "GITHUB_TOKEN"],
									["مخزن‌های git", i().repos > 0, "GAAM_REPOS یا repo_path روی پروژه"],
								]}
							>
								{([name, on, env]) => (
									<Panel class="row">
										<span style={{ color: on ? "var(--green)" : "var(--faint)" }}>{on ? "●" : "○"}</span>
										<b>{name as string}</b>
										<span class="spacer" />
										<span class="small faint ltr">{on ? "connected" : (env as string)}</span>
									</Panel>
								)}
							</For>
						</div>
						<div class="grid" style={{ gap: "16px" }}>
							<Snippet title="Claude Code (stdio)" code={`claude mcp add gaam --scope user -- node ${stdio.join(" ")}`} note="بهترین گزینه. بعدش در هر پروژه‌ای بگو «از گام بخوان که امروز چه کار کنم»." />
							<Snippet title="Claude Code / Cursor (HTTP، وقتی سرور گام روشن است)" code={`claude mcp add --transport http gaam "${i().mcp}?as=claude-code"`}
								note="پارامتر as اسم ایجنت را در لاگ فعالیت نشان می‌دهد (مثلاً cursor یا codex)." />
							<Snippet title="Claude Desktop / Cursor (mcp.json)" code={json} />
							<Snippet
								title="پرامپت‌های آماده"
								code={`/mcp__gaam__idea_to_plan   ایده → دیسکاوری، نقشه ذهنی، اسکوپ، تسک
/mcp__gaam__discovery      ادامه‌ی دیسکاوری با جواب‌های تو
/mcp__gaam__plan_my_day    برنامه‌ریزی صبح
/mcp__gaam__close_my_day   جمع‌بندی شب
/mcp__gaam__weekly_review  مرور هفتگی و کوچینگ
/mcp__gaam__break_down     شکستن تسک بزرگ
/mcp__gaam__standup        استندآپ از گام + گیت + جیرا`}
							/>
						</div>
					</>
				);
			}}
		</Show>
	);
}

function AiProviders() {
	const [status, { refetch }] = createResource(() => rpc<{ providers: { id: string; label: string; available: boolean; detail: string; models: string[] }[] }>("aiStatus"));
	return (
		<Panel style={{ "margin-bottom": "16px" }}>
			<h3>
				مغز دستیار و اتوماسیون‌ها <span class="spacer" />
				<Btn kind="ghost sm" onClick={refetch}>
					↻
				</Btn>
			</h3>
			<For each={status()?.providers}>
				{(p) => (
					<div class="row small" style={{ padding: "5px 0", "border-bottom": "1px solid var(--line)" }}>
						<span style={{ color: p.available ? "var(--green)" : "var(--faint)" }}>{p.available ? "●" : "○"}</span>
						<b>{p.label}</b>
						<span class="muted ltr" style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
							{p.detail}
						</span>
						<span class="spacer" />
						<Show when={p.id === "ollama" && !p.available}>
							<Btn kind="sm" onClick={() => rpc("startOllama").then(() => setTimeout(refetch, 4000))}>
								روشن کردن Ollama
							</Btn>
						</Show>
						<Show when={p.models.length}>
							<Tag class="ltr">{p.models.length} models</Tag>
						</Show>
					</div>
				)}
			</For>
		</Panel>
	);
}

function JiraBoard() {
	const [board, { refetch }] = createResource(() =>
		rpc<{ saved: { board: number; jql: string; project: string }; info: { name: string; columns: string[] } } | null>("jiraBoard").catch(() => null),
	);
	const [syncing, setSyncing] = createSignal(false);
	const sync = () => {
		setSyncing(true);
		rpc<{ issues: number; created: string[]; moved: string[] }>("jiraBoardSync")
			.then((r) => toast(`${fa(r.issues)} ایشو · ${fa(r.created.length)} جدید · ${fa(r.moved.length)} جابه‌جایی`, "win"))
			.finally(() => (setSyncing(false), refetch()));
	};
	return (
		<Show when={board()}>
			{(b) => (
				<Panel style={{ "margin-bottom": "16px" }}>
					<h3>
						🗂 برد جیرا: {b().info.name} <Tag class="ltr">#{b().saved.board}</Tag>
						<span class="spacer" />
						<Btn kind="sm" onClick={() => go(`/p/${b().saved.project}`)}>
							پروژه در گام
						</Btn>
						<Btn kind="primary sm" disabled={syncing()} onClick={sync}>
							{syncing() ? "…" : "↻ همگام‌سازی"}
						</Btn>
					</h3>
					<div class="small muted ltr" style={{ "text-align": "right" }}>
						{b().saved.jql}
					</div>
					<div class="row wrap small" style={{ "margin-top": "6px", gap: "4px" }}>
						<For each={b().info.columns}>{(c) => <Tag class="ltr">{c}</Tag>}</For>
					</div>
					<div class="small faint" style={{ "margin-top": "6px" }}>
						هر ۳۰ دقیقه خودکار همگام می‌شود. عنوان، ستون و ددلاین از جیرا می‌آید؛ ICE، اسکوپ، زیرتسک و یادداشت‌ها مال گام است.
					</div>
				</Panel>
			)}
		</Show>
	);
}
