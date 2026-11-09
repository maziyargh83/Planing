import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";

import { type Ask, fa, jalali, rpc, type Task, toast, version } from "../api.ts";
import { Ice, openTask, setStatus, TaskRow } from "../ui.tsx";
import { BriefCard } from "./Assistant.tsx";
import { Followups } from "./Growth.tsx";
import { askAssistant } from "./Knowledge.tsx";
import { openPalette } from "../palette.tsx";
import { go as navigate } from "../ui.tsx";

const ENERGY = ["🪫", "😮‍💨", "🙂", "⚡", "🚀"];
const MOOD = ["😞", "😕", "😐", "😊", "🤩"];

function greeting() {
	const h = new Date().getHours();
	if (h < 5) return "شب‌زنده‌داری؟";
	if (h < 12) return "صبح بخیر";
	if (h < 17) return "ظهر بخیر";
	return "عصر بخیر";
}

export function AskCard(props: { ask: Ask }) {
	const [text, setText] = createSignal("");
	const a = () => props.ask;
	const answer = (value: string | null) => rpc("answerAsk", a().id, value).then(() => toast(value == null ? "رد شد" : "جواب ثبت شد ✓"));
	return (
		<div class="ask">
			<div class="row small faint">
				🤖 {a().asked_by}
				<span class="spacer" />
				<Show when={a().kind === "data"}>
					<span class="chip">📊 داده</span>
				</Show>
			</div>
			<div class="q">{a().question}</div>
			<Show when={a().why}>
				<div class="why">چرا: {a().why}</div>
			</Show>
			<Show
				when={a().status === "open"}
				fallback={
					<div class="small" style={{ "margin-top": "6px" }}>
						<span class="faint">جواب: </span>
						{a().answer ?? "رد شد"}
					</div>
				}
			>
				<Show
					when={a().kind === "choice" || a().kind === "confirm"}
					fallback={
						<form
							class="row"
							style={{ "margin-top": "8px" }}
							onSubmit={(e) => {
								e.preventDefault();
								if (text().trim()) answer(text().trim());
							}}
						>
							<Show
								when={a().kind === "data"}
								fallback={<input class="input" type={a().kind === "number" ? "number" : "text"} placeholder="جواب…" value={text()} onInput={(e) => setText(e.currentTarget.value)} />}
							>
								<textarea class="textarea" rows="3" placeholder="داده را این‌جا بچسبان (عدد، جدول، CSV، لینک)…" value={text()} onInput={(e) => setText(e.currentTarget.value)} />
							</Show>
							<button class="btn primary sm">ثبت</button>
							<button type="button" class="btn ghost sm" onClick={() => answer(null)}>
								بعداً نه
							</button>
						</form>
					}
				>
					<div class="row wrap" style={{ "margin-top": "8px" }}>
						<For each={a().kind === "confirm" ? ["بله", "نه"] : a().choices ?? []}>
							{(choice) => (
								<button class="btn sm" onClick={() => answer(choice)}>
									{choice}
								</button>
							)}
						</For>
						<button class="btn ghost sm" onClick={() => answer(null)}>
							رد
						</button>
					</div>
				</Show>
			</Show>
		</div>
	);
}

function FocusTimer(props: { running: { started_at: string; task_key: string | null; task_title: string | null } | null }) {
	const [now, setNow] = createSignal(Date.now());
	const timer = setInterval(() => setNow(Date.now()), 1000);
	onCleanup(() => clearInterval(timer));
	const elapsed = () => {
		if (!props.running) return "00:00";
		const s = Math.max(0, Math.floor((now() - Date.parse(props.running.started_at)) / 1000));
		const mm = String(Math.floor(s / 60)).padStart(2, "0");
		const ss = String(s % 60).padStart(2, "0");
		return `${mm}:${ss}`;
	};
	return (
		<div class="card focus-ring">
			<h3 style={{ "align-self": "stretch" }}>⏱ تمرکز</h3>
			<div class="focus-time" style={{ color: props.running ? "var(--accent)" : "var(--faint)" }}>
				{elapsed()}
			</div>
			<div class="small muted">{props.running ? (props.running.task_title ?? "تمرکز آزاد") : "یک تسک را باز کن و «شروع تمرکز» بزن"}</div>
			<Show when={props.running} fallback={<button class="btn" onClick={() => rpc("startFocus", null)}>شروع تمرکز آزاد</button>}>
				<button class="btn primary" onClick={() => rpc("stopFocus").then((r) => r && toast(`${fa(r.minutes)} دقیقه ثبت شد`, "win"))}>
					پایان
				</button>
			</Show>
		</div>
	);
}

export function Today() {
	const [ctx] = createResource(version, () => rpc("context"));
	const [picking, setPicking] = createSignal(false);
	const day = () => ctx()?.day;
	const topKeys = createMemo(() => new Set<string>((day()?.top ?? []).map((t: Task) => t.key)));
	const checkin = createMemo(() => [...(day()?.journal ?? [])].reverse().find((j: { kind: string }) => j.kind === "checkin"));

	const setTop = (keys: string[]) => rpc("planDay", undefined, { top: keys });
	const toggleTop = (key: string) => {
		const keys = [...topKeys()];
		if (topKeys().has(key)) return setTop(keys.filter((k) => k !== key));
		if (keys.length >= 3) return toast("فقط سه تا. کدام مهم‌تر است؟", "error");
		setTop([...keys, key]);
	};
	const checkIn = (field: "energy" | "mood", value: number) =>
		rpc("addJournal", { kind: "checkin", energy: field === "energy" ? value : checkin()?.energy, mood: field === "mood" ? value : checkin()?.mood });

	return (
		<Show when={ctx()}>
			<div class="page-head">
				<div>
					<h1>
						{greeting()} 👋
					</h1>
					<p>
						{jalali(new Date(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })} ·{" "}
						<Show when={ctx().week.streak > 0} fallback="امروز را شروع کن">
							🔥 {fa(ctx().week.streak)} روز پشت سر هم
						</Show>
					</p>
				</div>
				<div class="row small muted">
					<span class="kbd">⌘K</span> جستجو و ثبت سریع
				</div>
			</div>

			<NextStep nudges={ctx().nudges} />

			<div class="hero">
				<div class="card">
					<h3>🎯 نیت امروز</h3>
					<input
						class="inline-edit intention"
						placeholder="امروز اگر فقط یک کار بشود، چه باشد؟"
						value={day()?.intention ?? ""}
						onChange={(e) => rpc("planDay", undefined, { intention: e.currentTarget.value })}
					/>
					<div class="row" style={{ "margin-top": "16px", "justify-content": "space-between" }}>
						<h3 style={{ margin: 0 }}>سه کار مهم</h3>
						<button class="btn ghost sm" onClick={() => setPicking(!picking())}>
							{picking() ? "بستن" : "انتخاب"}
						</button>
					</div>
					<div class="top3" style={{ "margin-top": "8px" }}>
						<For each={day()?.top} fallback={<div class="empty small">هنوز انتخاب نکردی. از «بعدی‌ها» سه تا را بردار.</div>}>
							{(t: Task) => (
								<div class="slot" classList={{ done: t.status === "done" }}>
									<span style={{ cursor: "pointer" }} onClick={() => openTask(t.key)}>
										{t.title}
										<span class="chip key" style={{ "margin-inline-start": "8px" }}>
											{t.key}
										</span>
									</span>
									<div class="row">
										<button class="btn ghost sm" title="شروع تمرکز" onClick={() => rpc("startFocus", t.key)}>
											▶
										</button>
										<button class="btn sm" onClick={() => setStatus(t, t.status === "done" ? "todo" : "done")}>
											{t.status === "done" ? "↺" : "✓"}
										</button>
									</div>
								</div>
							)}
						</For>
					</div>
					<Show when={picking()}>
						<div class="stack" style={{ "max-height": "260px", overflow: "auto" }}>
							<For each={[...ctx().in_progress, ...ctx().next_up]}>
								{(t: Task & { project_key: string | null }) => (
									<TaskRow
										task={t}
										showProject
										extra={
											<button class="btn sm" classList={{ primary: topKeys().has(t.key) }} onClick={() => toggleTop(t.key)}>
												{topKeys().has(t.key) ? "★" : "☆"}
											</button>
										}
									/>
								)}
							</For>
						</div>
					</Show>
				</div>

				<div class="stack" style={{ gap: "16px" }}>
					<div class="card">
						<h3>حالت چطوره؟</h3>
						<div class="row" style={{ "justify-content": "space-between" }}>
							<span class="muted small">انرژی</span>
							<div class="scale">
								<For each={ENERGY}>
									{(e, i) => (
										<button classList={{ on: checkin()?.energy === i() + 1 }} onClick={() => checkIn("energy", i() + 1)}>
											{e}
										</button>
									)}
								</For>
							</div>
						</div>
						<div class="row" style={{ "justify-content": "space-between", "margin-top": "8px" }}>
							<span class="muted small">حال</span>
							<div class="scale">
								<For each={MOOD}>
									{(e, i) => (
										<button classList={{ on: checkin()?.mood === i() + 1 }} onClick={() => checkIn("mood", i() + 1)}>
											{e}
										</button>
									)}
								</For>
							</div>
						</div>
					</div>
					<FocusTimer running={day()?.running_focus} />
				</div>
			</div>

			<BriefCard />

			<div class="grid g2" style={{ "margin-top": "16px" }}>
				<div class="stack" style={{ gap: "16px" }}>
					<Show when={ctx().nudges.length}>
						<div class="card">
							<h3>🧭 مربی</h3>
							<div class="stack">
								<For each={ctx().nudges}>
									{(n: { level: string; message: string; refs?: string[] }) => (
										<div class={`nudge ${n.level}`}>
											<span>{n.level === "warn" ? "⚠️" : n.level === "win" ? "🎉" : "💡"}</span>
											<div>
												<div>{n.message}</div>
												<Show when={n.refs?.length}>
													<div class="row wrap" style={{ "margin-top": "4px" }}>
														<For each={n.refs!.slice(0, 8)}>
															{(r) => (
																<span class="chip key" style={{ cursor: "pointer" }} onClick={() => (r.includes("-") ? openTask(r) : (location.hash = `/p/${r}`))}>
																	{r}
																</span>
															)}
														</For>
													</div>
												</Show>
											</div>
										</div>
									)}
								</For>
							</div>
						</div>
					</Show>

					<div class="card">
						<h3>
							🔨 در جریان <span class="faint">{fa(ctx().in_progress.length)}</span>
						</h3>
						<For each={ctx().in_progress} fallback={<div class="faint small">چیزی در جریان نیست.</div>}>
							{(t: Task) => <TaskRow task={t} showProject />}
						</For>
						<h3 style={{ "margin-top": "14px" }}>⏭ بعدی‌ها (به ترتیب اولویت)</h3>
						<For each={ctx().next_up.slice(0, 7)}>{(t: Task) => <TaskRow task={t} showProject />}</For>
					</div>
				</div>

				<div class="stack" style={{ gap: "16px" }}>
					<div class="card">
						<h3>
							🤖 سؤال‌های ایجنت‌ها <span class="faint">{fa(ctx().open_asks.length)}</span>
						</h3>
						<div class="stack">
							<For each={ctx().open_asks} fallback={<div class="faint small">ایجنت‌ها فعلاً سؤالی ندارند.</div>}>
								{(a: Ask) => <AskCard ask={a} />}
							</For>
						</div>
					</div>
					<div class="card">
						<h3>✅ امروز انجام شد</h3>
						<For each={day()?.completed} fallback={<div class="faint small">هنوز هیچ. اولین قدم کوچک را بردار.</div>}>
							{(t: Task) => (
								<div class="row small" style={{ padding: "3px 0" }}>
									<span style={{ color: "var(--green)" }}>✓</span>
									<span>{t.title}</span>
									<span class="spacer" />
									<Ice value={t.ice} />
								</div>
							)}
						</For>
						<div class="row small muted" style={{ "margin-top": "10px" }}>
							⏱ {fa(Math.round(day()?.focus_minutes ?? 0))} دقیقه تمرکز
						</div>
					</div>
					<Followups compact />
					<JournalBox />
				</div>
			</div>
		</Show>
	);
}

function JournalBox() {
	const [kind, setKind] = createSignal("note");
	let input!: HTMLTextAreaElement;
	const kinds = [
		["note", "یادداشت"],
		["win", "🏆 برد"],
		["blocker", "🧱 مانع"],
		["lesson", "📚 درس"],
	];
	const save = async () => {
		if (!input.value.trim()) return;
		await rpc("addJournal", { kind: kind(), body: input.value.trim() });
		input.value = "";
		toast("در ژورنال ثبت شد");
	};
	return (
		<div class="card">
			<h3>📓 ژورنال</h3>
			<div class="row wrap" style={{ "margin-bottom": "8px" }}>
				<For each={kinds}>
					{([k, label]) => (
						<button class="btn sm" classList={{ primary: kind() === k }} onClick={() => setKind(k!)}>
							{label}
						</button>
					)}
				</For>
			</div>
			<textarea
				ref={input}
				class="textarea"
				rows="3"
				placeholder="چه فکری توی سرته؟ (Enter ثبت، Shift+Enter خط جدید)"
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						save();
					}
				}}
			/>
			<div class="row" style={{ "margin-top": "6px" }}>
				<span class="spacer" />
				<button class="btn primary sm" onClick={save}>
					ثبت
				</button>
			</div>
		</div>
	);
}

interface Nudge {
	level: string;
	code: string;
	message: string;
	refs?: string[];
}

const ORDER = ["meeting_prep", "standup", "no_plan", "finish_loop", "overdue", "people_close", "decisions", "stale", "wip", "asks", "sfpm_evidence", "unscored", "blocked", "inbox", "assessors", "energy"];
const ICON: Record<string, string> = {
	meeting_prep: "🗓", standup: "🗣", no_plan: "☀️", finish_loop: "🏁", overdue: "⏰", people_close: "☕", decisions: "⚖️", stale: "🐢",
	wip: "🧯", asks: "❓", sfpm_evidence: "🏅", unscored: "🎯", blocked: "🧱", inbox: "📥", assessors: "🤝", energy: "🔋",
};

function actionFor(n: Nudge): { label: string; run: () => unknown } | null {
	const first = n.refs?.[0];
	switch (n.code) {
		case "meeting_prep":
			return { label: "آماده‌سازی جلسه", run: () => navigate("/knowledge") };
		case "standup":
			return {
				label: "✨ پیش‌نویس استندآپ",
				run: () => askAssistant("استندآپ امروزم را با هم بنویسیم: standup_context را بخوان، طبق format_rules کوتاه و دقیق بنویس، قول دیروز را با واقعیت مقایسه کن، با standup_save ذخیره کن و یک خط کوچینگ بده."),
			};
		case "no_plan":
			return { label: "☀️ با دستیار بچین", run: () => askAssistant("برنامه‌ی امروزم را بچین: gaam_context را بخوان، سه کار مهم با دلیل پیشنهاد بده و بعد از تأیید من ذخیره کن.") };
		case "finish_loop":
		case "overdue":
		case "stale":
		case "wip":
		case "blocked":
			return first ? { label: `باز کردن ${first}`, run: () => openTask(first) } : null;
		case "people_close":
			return first ? { label: `☕ ۱:۱ با ${first.split(" ")[0]}`, run: () => openPalette(`۱:۱ با ${first} فردا`) } : null;
		case "decisions":
			return { label: "دفتر تصمیم‌ها", run: () => navigate("/growth") };
		case "sfpm_evidence":
			return { label: "🏅 جمع‌آوری شواهد با دستیار", run: () => askAssistant("برای اهداف SFPM که شاهد ندارند، از کارهای انجام‌شده، گیت و جیرای دو هفته‌ی اخیر شاهد پیدا کن و با journal_add (kind win، goal) ثبت کن. برای هدفی که واقعاً پیشرفتی ندارد یک قدم کوچک پیشنهاد بده.") };
		case "unscored":
			return { label: "🎯 امتیازدهی با دستیار", run: () => askAssistant("تسک‌های بدون امتیاز ICE را (task_list) بخوان و با task_score امتیاز بده. برای امتیازهای غیرواضح یک خط دلیل بنویس. اگر چیزی را نمی‌دانی از من بپرس.") };
		case "inbox":
			return { label: "صندوق را مرتب کن", run: () => navigate("/inbox") };
		case "assessors":
			return { label: "آدم‌ها", run: () => navigate("/people") };
		default:
			return null;
	}
}

/** One clear next step, picked from the coach's nudges, with a single action. */
export function NextStep(props: { nudges: Nudge[] }) {
	const rank = (code: string) => (ORDER.includes(code) ? ORDER.indexOf(code) : ORDER.length);
	const ranked = () => [...props.nudges].filter((n) => n.level !== "win").sort((a, b) => rank(a.code) - rank(b.code));
	const [index, setIndex] = createSignal(0);
	const current = () => ranked()[index() % Math.max(1, ranked().length)];
	return (
		<Show when={current()}>
			{(n) => {
				const action = () => actionFor(n());
				return (
					<div class="next-step">
						<span class="icon">{ICON[n().code] ?? "💡"}</span>
						<div style={{ flex: 1 }}>
							<div class="small faint">قدم بعدی</div>
							<div>{n().message}</div>
						</div>
						<Show when={action()}>
							<button class="btn primary" onClick={() => action()!.run()}>
								{action()!.label}
							</button>
						</Show>
						<Show when={ranked().length > 1}>
							<button class="btn ghost sm" title="پیشنهاد بعدی" onClick={() => setIndex((i) => i + 1)}>
								{fa((index() % ranked().length) + 1)}/{fa(ranked().length)} ←
							</button>
						</Show>
					</div>
				);
			}}
		</Show>
	);
}
