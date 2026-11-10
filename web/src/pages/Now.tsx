import { newGoal } from "../flows.ts";
import { useQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

import { fa, jalali, rpc, type Task, toast, workspace } from "../api.ts";
import { relativeDay } from "../components/form.tsx";
import { openPalette } from "../palette.tsx";
import { go, openTask, setStatus } from "../ui.tsx";
import { askAbout } from "./Chat.tsx";

interface Goal {
	id: number;
	title: string;
	current: number | null;
	target: number | null;
	evidence?: number;
	kind?: string | null;
}

interface Ctx {
	goals: Goal[];
	day: {
		intention: string | null;
		top: Task[];
		completed: Task[];
		journal: { kind: string; energy: number | null; mood: number | null }[];
		running_focus: { started_at: string; task_key: string | null; task_title: string | null } | null;
	};
	in_progress: (Task & { project_key: string | null; project_title: string | null })[];
	next_up: (Task & { project_key: string | null; project_title: string | null })[];
	projects: { key: string }[];
	open_asks: unknown[];
	week: { streak: number; totals: { done: number } };
}

const ENERGY = ["🪫", "😮‍💨", "🙂", "⚡", "🚀"];

function greeting() {
	const h = new Date().getHours();
	if (h < 5) return "شب بخیر";
	if (h < 12) return "صبح بخیر";
	if (h < 17) return "روز بخیر";
	if (h < 20) return "عصر بخیر";
	return "شب بخیر";
}

/** The part of a goal title worth showing: the Persian half of "English · فارسی". */
const goalName = (t: string) => (t.includes(" · ") ? t.split(" · ").at(-1)! : t);

/** Goals as mountains on the horizon; the climber's height is the progress. */
function Horizon(props: { goals: Goal[] }) {
	const W = 1000;
	const H = 150;
	const peaks = createMemo(() => {
		const list = props.goals.slice(0, 7);
		const step = W / (list.length + 1);
		return list.map((g, i) => {
			const progress = g.target ? Math.min(1, (g.current ?? 0) / g.target) : Math.min(1, (g.evidence ?? 0) / 8);
			const h = 70 + ((i * 37) % 45);
			const x = step * (i + 1);
			return { g, x, h, w: step * 0.9, progress };
		});
	});
	return (
		<Show when={peaks().length}>
			<svg class="horizon" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="اهداف">
				<defs>
					<linearGradient id="mtn" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stop-color="var(--mtn-top)" />
						<stop offset="1" stop-color="var(--mtn-base)" />
					</linearGradient>
				</defs>
				<For each={peaks()}>
					{(p) => {
						const top = H - p.h;
						const left = p.x - p.w / 2;
						const cx = left + (p.w / 2) * p.progress;
						const cy = H - p.h * p.progress;
						return (
							<g class="peak" onClick={() => go("/goals")}>
								<title>{`${p.g.title} — ${Math.round(p.progress * 100)}٪`}</title>
								<polygon points={`${left},${H} ${p.x},${top} ${p.x + p.w / 2},${H}`} fill="url(#mtn)" />
								<polyline points={`${left},${H} ${cx},${cy}`} class="peak-path" />
								<circle cx={cx} cy={cy} r="5" class="climber" />
								<Show when={p.progress >= 1}>
									<text x={p.x} y={top - 6} text-anchor="middle" class="flag">
										🚩
									</text>
								</Show>
							</g>
						);
					}}
				</For>
			</svg>
			<div class="horizon-labels">
				<For each={peaks()}>
					{(p) => (
						<span style={{ left: `${(p.x / W) * 100}%` }} title={p.g.title}>
							{goalName(p.g.title).slice(0, 26)}
						</span>
					)}
				</For>
			</div>
		</Show>
	);
}

function FocusMode(props: { task: Task | null; startedAt: string; onExit: () => void }) {
	const [now, setNow] = createSignal(Date.now());
	const t = setInterval(() => setNow(Date.now()), 1000);
	onCleanup(() => clearInterval(t));
	const secs = () => Math.max(0, Math.floor((now() - Date.parse(props.startedAt)) / 1000));
	const mm = () => String(Math.floor(secs() / 60)).padStart(2, "0");
	const ss = () => String(secs() % 60).padStart(2, "0");
	const stop = async (done: boolean) => {
		const r = await rpc<{ minutes: number } | null>("stopFocus");
		if (done && props.task) await setStatus(props.task, "done");
		toast(`${fa(r?.minutes ?? 0)} دقیقه تمرکز ثبت شد`, "win");
		props.onExit();
	};
	return (
		<div class="focus-mode">
			<div class="focus-breath" />
			<div class="focus-inner">
				<div class="faint">در حال تمرکز روی</div>
				<h1>{props.task?.title ?? "تمرکز آزاد"}</h1>
				<div class="focus-clock ltr">
					{mm()}:{ss()}
				</div>
				<div class="row" style={{ "justify-content": "center", gap: "10px" }}>
					<Show when={props.task}>
						<button type="button" class="big-btn primary" onClick={() => stop(true)}>
							✓ تمامش کردم
						</button>
					</Show>
					<button type="button" class="big-btn" onClick={() => stop(false)}>
						■ فعلاً بس است
					</button>
				</div>
				<div class="faint small">نوتیفیکیشن‌ها را ببند. فقط همین یک کار.</div>
			</div>
		</div>
	);
}

/** First run: the path that sets Gaam up, one stone at a time. */
function FirstSteps(props: { ctx: Ctx }) {
	const steps = () => [
		{ done: props.ctx.goals.length > 0, label: "یک هدف بنویس", hint: "چیزی که این فصل می‌خواهی به آن برسی", run: () => newGoal() },
		{ done: props.ctx.projects.length > 0, label: "یک ایده یا پروژه", hint: "مثلاً «بهبود سرچ»", run: () => openPalette("ایده: ") },
		{ done: props.ctx.next_up.length + props.ctx.in_progress.length > 0, label: "اولین قدم را ثبت کن", hint: "یک کار کوچک که امروز می‌شود", run: () => openPalette("") },
		{ done: false, label: "ایجنتت را وصل کن", hint: "Claude Code یا Codex", run: () => go("/connect") },
	];
	return (
		<div class="first-steps">
			<h2>بیا گام را با هم راه بیندازیم</h2>
			<p class="muted">چهار قدم کوچک. هر کدام کمتر از یک دقیقه.</p>
			<div class="trail">
				<For each={steps()}>
					{(s, i) => (
						<button type="button" class="stone big" classList={{ done: s.done }} onClick={s.run}>
							<span class="stone-n">{s.done ? "✓" : fa(i() + 1)}</span>
							<b>{s.label}</b>
							<span class="faint small">{s.hint}</span>
						</button>
					)}
				</For>
			</div>
		</div>
	);
}

export function NowPage() {
	const ctx = useQuery(() => ({ queryKey: ["context", workspace()], queryFn: () => rpc<Ctx>("context") }));
	const [later, setLater] = createSignal<string[]>([]);
	const [pinned, setPinned] = createSignal<string | null>(null);

	const queue = createMemo(() => {
		const c = ctx.data;
		if (!c) return [];
		const seen = new Set<string>();
		const out: (Task & { project_key?: string | null; project_title?: string | null })[] = [];
		for (const t of [...c.day.top.filter((t) => t.status !== "done"), ...c.in_progress, ...c.next_up])
			if (!seen.has(t.key) && t.status !== "done" && t.status !== "dropped") {
				seen.add(t.key);
				out.push(t);
			}
		const skip = later();
		out.sort((a, b) => skip.indexOf(a.key) - skip.indexOf(b.key));
		const p = pinned();
		if (p) out.sort((a, b) => Number(b.key === p) - Number(a.key === p));
		return out;
	});
	const current = () => queue()[0] ?? null;
	const focus = () => ctx.data?.day.running_focus ?? null;
	const checkin = () => [...(ctx.data?.day.journal ?? [])].reverse().find((j) => j.kind === "checkin");

	const postpone = (key: string) => {
		setPinned(null);
		setLater((keys) => [...keys.filter((item) => item !== key), key]);
	};
	const done = async () => {
		const t = current();
		if (!t) return;
		await setStatus(t, "done");
		setPinned(null);
	};
	const startFocus = async () => {
		await rpc("startFocus", current()?.key ?? null);
		void ctx.refetch();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable], [role=dialog]")) return;
		if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || focus() || document.querySelector('[role="dialog"][data-state="open"]')) return;
		if (e.key === "d" || e.key === "ی") void done();
		else if (e.key === "f" || e.key === "ب") void startFocus();
		else if ((e.key === "l" || e.key === "م") && current()) postpone(current()!.key);
	};
	onMount(() => window.addEventListener("keydown", onKey));
	onCleanup(() => window.removeEventListener("keydown", onKey));

	return (
		<Show when={ctx.data} fallback={<div class="now-loading" role="status">در حال دریافت برنامهٔ امروز…</div>}>
			{(c) => (
				<div class="now">
					<Show when={focus()}>
						<FocusMode task={queue().find((t) => t.key === focus()!.task_key) ?? null} startedAt={focus()!.started_at} onExit={() => void ctx.refetch()} />
					</Show>



					<div class="now-greet">
						<h1>{greeting()}</h1>
						<span class="muted">
							{jalali(new Date(), { weekday: "long", day: "numeric", month: "long" })}
							<Show when={c().week.streak > 0}> · 🔥 {fa(c().week.streak)} روز پشت سر هم</Show>
						</span>
						<span class="spacer" />
						<div class="energy" title="انرژی امروز">
							<For each={ENERGY}>
								{(e, i) => (
									<button type="button" aria-label={`انرژی امروز: ${fa(i() + 1)} از ۵`} aria-pressed={checkin()?.energy === i() + 1} classList={{ on: checkin()?.energy === i() + 1 }} onClick={() => rpc("addJournal", { kind: "checkin", energy: i() + 1, mood: checkin()?.mood ?? null })}>
										{e}
									</button>
								)}
							</For>
						</div>
					</div>

					<Show
						when={current()}
						fallback={
							<Show when={c().goals.length || c().projects.length} fallback={<FirstSteps ctx={c()} />}>
								<div class="step-card empty">
									<div class="step-emoji">🌄</div>
									<h2>کاری در صف امروز نیست</h2>
									<p class="muted">برای امروز یک کار ثبت کن یا با دستیار برنامه بریز.</p>
									<div class="row" style={{ "justify-content": "center", gap: "8px" }}>
										<button type="button" class="big-btn primary" onClick={() => openPalette("")}>
											＋ قدم تازه
										</button>
										<button type="button" class="big-btn" onClick={() => askAbout("برنامه‌ی امروزم را بچین: gaam_context را بخوان و سه کار مهم با دلیل پیشنهاد بده.")}>
											✳️ همراه برایم بچیند
										</button>
									</div>
								</div>
							</Show>
						}
					>
						{(t) => (
							<article class="step-card">
								<div class="step-meta">
									<span class="step-label">قدم بعدی</span>
									<button type="button" class="md-key" onClick={() => openTask(t().key)}>
										{t().key}
									</button>
									<Show when={t().project_title}>
										<span class="faint">· {t().project_title}</span>
									</Show>
									<Show when={t().external_status}>
										<span class="step-chip ltr">{t().external_status}</span>
									</Show>
									<Show when={t().due}>
										<span class="step-chip" classList={{ late: t().due! < new Date().toLocaleDateString("en-CA") }}>
											📅 {relativeDay(t().due!)}
										</span>
									</Show>
									<Show when={t().estimate_h}>
										<span class="step-chip">⏳ {fa(t().estimate_h!)} ساعت</span>
									</Show>
								</div>
								<h2 class="step-title"><button class="step-open" onClick={() => openTask(t().key)}>{t().title}</button></h2>
								<Show when={c().day.intention}>
									<div class="step-why">نیت امروز: {c().day.intention}</div>
								</Show>
								<div class="step-actions">
									<button type="button" class="big-btn" onClick={done} title="D">
										✓ انجامش دادم
									</button>
									<button type="button" class="big-btn primary" onClick={startFocus} title="F">
										شروع تمرکز
									</button>
									<button type="button" class="big-btn ghost" disabled={queue().length < 2} onClick={() => postpone(t().key)} title="L">
										↷ بعداً
									</button>
									<button
										type="button"
										class="big-btn ghost"
										onClick={() => askAbout(`${t().key} را به زیرتسک‌های حداکثر نیم‌روزه بشکن (task_create با parent)، برای هرکدام تخمین و تعریف «انجام شد» بنویس.`, [{ type: "task", ref: t().key, label: t().title }])}
									>
										✂︎ بشکنش
									</button>
									<button type="button" class="big-btn ghost" onClick={() => askAbout(`درباره‌ی ${t().key} کمکم کن: از کجا شروع کنم؟`, [{ type: "task", ref: t().key, label: t().title }])}>
										✳️ کمک
									</button>
								</div>
								<div class="step-keys faint small">D انجام · F تمرکز · L بعداً</div>
							</article>
						)}
					</Show>

					<Show when={queue().length > 1 || c().day.completed.length}>
						<div class="trail-wrap">
							<div class="trail-title faint small">مسیر امروز</div>
							<div class="trail">
								<For each={c().day.completed}>
									{(t) => (
										<button type="button" class="stone done" title={t.title} onClick={() => openTask(t.key)}>
											<span class="stone-n">👣</span>
											<span class="stone-t">{t.title}</span>
										</button>
									)}
								</For>
								<For each={queue().slice(0, 8)}>
									{(t, i) => (
										<button type="button" class="stone" classList={{ current: i() === 0, later: later().includes(t.key) }} title={t.title} onClick={() => setPinned(t.key)}>
											<span class="stone-n">{fa(i() + 1)}</span>
											<span class="stone-t">{t.title}</span>
										</button>
									)}
								</For>
								<button type="button" class="stone add" onClick={() => openPalette("")}>
									<span class="stone-n">＋</span>
								</button>
							</div>
						</div>
					</Show>

					<Horizon goals={c().goals} />

					<div class="now-foot">
						<Show when={c().open_asks.length}>
							<button type="button" class="now-pill" onClick={() => go("/today")}>
								❓ {fa(c().open_asks.length)} سؤال از ایجنت‌ها منتظر توست
							</button>
						</Show>
						<button type="button" class="now-pill" onClick={() => go("/growth")}>
							🗣 استندآپ امروز
						</button>
						<button type="button" class="now-pill" onClick={() => go("/sky")}>
							✦ کهکشان اهداف
						</button>
					</div>
				</div>
			)}
		</Show>
	);
}
