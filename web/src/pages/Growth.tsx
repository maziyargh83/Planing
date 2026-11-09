import { createResource, createSignal, For, Show } from "solid-js";
import { ask, DATE_SUGGESTIONS, todayIso } from "~/kit.tsx";

import { ago, fa, type Goal, jalali, rpc, toast, version } from "../api.ts";
import { go, openTask } from "../ui.tsx";
import { askAssistant } from "./Knowledge.tsx";

interface Cycle {
	cycle: string | null;
	timeline: { stage: string; from: string; to: string }[] | null;
	history: { cycle: string; tag: string; self: number; others: number }[] | null;
	feedback: { strengths: string[]; growth: string[]; actions: string[] } | null;
	expectations: (Goal & { evidence: number })[];
	development: (Goal & { evidence: number })[];
	people: { total: number; assessors: number; overdue: number; contacted_30d: number };
	standups: { streak: number; total: number };
	decisions: { open: number; needs_alignment: number };
}

interface Decision {
	id: number;
	title: string;
	context: string | null;
	options: string | null;
	choice: string | null;
	impact: "low" | "high";
	reversible: number;
	aligned_with: string | null;
	status: "open" | "decided" | "revisited";
	mode: "decide" | "decide_and_inform" | "align_first";
	advice: string;
	project_key: string | null;
	created_at: string;
}

const MODE_COLOR = { decide: "var(--green)", decide_and_inform: "var(--accent)", align_first: "var(--red)" };
const MODE_FA = { decide: "خودت تصمیم بگیر", decide_and_inform: "تصمیم بگیر + خبر بده", align_first: "اول alignment" };

function Timeline(props: { stages: { stage: string; from: string; to: string }[] }) {
	const start = () => Date.parse(props.stages[0]!.from);
	const end = () => Date.parse(props.stages.at(-1)!.to);
	const pct = (t: number) => Math.min(100, Math.max(0, ((t - start()) / (end() - start())) * 100));
	const now = Date.now();
	const daysToEnd = () => Math.max(0, Math.ceil((Date.parse(props.stages.at(-1)!.from) - now) / 864e5));
	return (
		<div>
			<div class="timeline">
				<For each={props.stages}>
					{(s, i) => {
						const active = () => now >= Date.parse(s.from) && now <= Date.parse(s.to) + 864e5;
						return (
							<div
								class="tl-stage"
								classList={{ on: active() }}
								style={{ "inset-inline-start": `${pct(Date.parse(s.from))}%`, width: `${pct(Date.parse(s.to)) - pct(Date.parse(s.from))}%`, top: `${i() * 26}px` }}
							>
								{s.stage}
							</div>
						);
					}}
				</For>
				<div class="tl-now" style={{ "inset-inline-start": `${pct(now)}%` }} title="امروز" />
			</div>
			<div class="small muted" style={{ "margin-top": "6px" }}>
				⏳ {fa(daysToEnd())} روز تا شروع ارزیابی نهایی. هر هفته شواهد جمع کن، نه شب امتحان.
			</div>
		</div>
	);
}

function GoalLine(props: { goal: Goal & { evidence: number }; index: number }) {
	return (
		<div class="row small" style={{ padding: "5px 0", "border-bottom": "1px solid var(--line)" }}>
			<span class="faint" style={{ width: "18px" }}>
				{fa(props.index + 1)}
			</span>
			<span style={{ flex: 1, cursor: "pointer" }} onClick={() => go("/goals")} title={props.goal.why ?? ""}>
				{props.goal.title}
			</span>
			<span class="chip" style={{ color: props.goal.evidence ? "var(--green)" : "var(--faint)" }}>
				🏅 {fa(props.goal.evidence)}
			</span>
		</div>
	);
}

export function GrowthPage() {
	const [data] = createResource(version, () => rpc<Cycle>("growth"));
	return (
		<Show when={data()}>
			{(c) => (
				<>
					<div class="page-head">
						<div>
							<h1>رشد · {c().cycle ? <span class="ltr">SFPM {c().cycle}</span> : "SFPM"}</h1>
							<p>هر روز یک قدم کوچک به سمت انتظارات نقش و هدف‌های رشدت؛ با شاهد.</p>
						</div>
						<button
							class="btn primary"
							onClick={() =>
								fetch("/api/assistant", {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										text: "growth_overview را بخوان و مثل یک منتور سینیور، با تکیه بر فیدبک سایکل قبل، بگو این هفته روی کدام دو هدف SFPM عقبم و سه قدم کوچک و مشخص پیشنهاد بده. اگر موافق بودم، تسکشان را بساز.",
									}),
								})
									.then((r) => r.json())
									.then((r) => go(`/assistant/${r.data.thread}`))
							}
						>
							✳️ منتور: این هفته روی چه کار کنم؟
						</button>
					</div>

					<div class="grid g4" style={{ "margin-bottom": "16px" }}>
						<div class="card stat">
							<span class="v">🔥 {fa(c().standups.streak)}</span>
							<span class="l">روز استندآپ ساختارمند پشت سر هم</span>
						</div>
						<div class="card stat" style={{ cursor: "pointer" }} onClick={() => go("/people")}>
							<span class="v">{fa(c().people.contacted_30d)}/{fa(c().people.total)}</span>
							<span class="l">آدم‌هایی که در ۳۰ روز اخیر با آن‌ها در تماس بودی</span>
						</div>
						<div class="card stat">
							<span class="v" style={{ color: c().decisions.needs_alignment ? "var(--red)" : undefined }}>{fa(c().decisions.open)}</span>
							<span class="l">تصمیم باز{c().decisions.needs_alignment ? ` · ${fa(c().decisions.needs_alignment)} نیازمند alignment` : ""}</span>
						</div>
						<div class="card stat">
							<span class="v">{fa([...c().expectations, ...c().development].reduce((a, g) => a + g.evidence, 0))}</span>
							<span class="l">شاهد ثبت‌شده برای این سایکل</span>
						</div>
					</div>

					<Show when={c().timeline}>
						<div class="card" style={{ "margin-bottom": "16px" }}>
							<h3>📅 سایکل</h3>
							<Timeline stages={c().timeline!} />
						</div>
					</Show>

					<div class="grid g2" style={{ "margin-bottom": "16px" }}>
						<div class="card">
							<h3>📌 انتظارات نقش</h3>
							<For each={c().expectations} fallback={<div class="faint small">هنوز وارد نشده.</div>}>
								{(g, i) => <GoalLine goal={g} index={i()} />}
							</For>
						</div>
						<div class="card">
							<h3>🌱 اهداف رشد شخصی</h3>
							<For each={c().development}>{(g, i) => <GoalLine goal={g} index={i()} />}</For>
						</div>
					</div>

					<StandupCard />

					<Show when={c().feedback}>
						<div class="grid g3" style={{ margin: "16px 0" }}>
							<div class="card">
								<h3>💪 نقاط قوت (فیدبک سایکل قبل)</h3>
								<ul class="fb">
									<For each={c().feedback!.strengths}>{(x) => <li>{x}</li>}</For>
								</ul>
							</div>
							<div class="card">
								<h3>🎯 جاهای رشد</h3>
								<ul class="fb">
									<For each={c().feedback!.growth}>{(x) => <li>{x}</li>}</For>
								</ul>
							</div>
							<div class="card">
								<h3>🛠 برنامه‌ی عملیاتی پیشنهادی</h3>
								<ul class="fb">
									<For each={c().feedback!.actions}>{(x) => <li>{x}</li>}</For>
								</ul>
							</div>
						</div>
					</Show>

					<Decisions />

					<Show when={c().history?.length}>
						<div class="card" style={{ "margin-top": "16px" }}>
							<h3>📈 سابقه‌ی ارزیابی</h3>
							<For each={c().history!}>
								{(h) => (
									<div class="row small" style={{ padding: "4px 0" }}>
										<span class="chip ltr">{h.cycle}</span>
										<span>{h.tag}</span>
										<span class="spacer" />
										<span class="muted">خودم {fa(h.self)}</span>
										<b>دیگران {fa(h.others)}</b>
									</div>
								)}
							</For>
						</div>
					</Show>
				</>
			)}
		</Show>
	);
}

function StandupCard() {
	const [s, { refetch }] = createResource(version, () =>
		rpc<{ done: string | null; next: string | null; blockers: string | null; help: string | null; text: string; stats: { streak: number } }>("standup"),
	);
	const [history] = createResource(version, () => rpc<{ day: string; done: string | null; next: string | null; blockers: string | null; help: string | null }[]>("standups"));
	const previous = () => history()?.find((h) => h.day < new Date().toLocaleDateString("en-CA"));
	const [showHistory, setShowHistory] = createSignal(false);
	const save = (field: string, value: string) => rpc("saveStandup", { [field]: value }).then(refetch);
	const fields = [
		["done", "✅ دیروز چه تمام شد؟", "نتیجه، نه فعالیت: «SRCH-4 مرج شد، zero-result لاگ می‌شود»"],
		["next", "⏭ امروز چه چیزی تمام می‌شود؟", "یک یا دو خروجی مشخص"],
		["blockers", "🧱 مانع", "چه چیزی جلوی کار را گرفته؟ (یا خالی)"],
		["help", "🙋 تصمیم یا کمک لازم", "از چه کسی، تا کِی؟"],
	] as const;
	return (
		<div class="card">
			<h3>
				🗣 استندآپ امروز <span class="faint small">· کوتاه، دقیق، با درخواست مشخص</span>
				<span class="spacer" />
				<button class="btn primary sm" onClick={() => askAssistant(STANDUP_PROMPT)}>
					✨ پیش‌نویس از جیرا + گیت
				</button>
				<button class="btn sm" onClick={() => navigator.clipboard.writeText(s()!.text).then(() => toast("کپی شد؛ در کانال تیم بفرست"))}>
					کپی متن
				</button>
			</h3>
			<Show when={previous()?.next}>
				<div class="promise">
					<span class="faint small">دفعه‌ی قبل ({jalali(previous()!.day)}) گفتی امروز:</span> {previous()!.next}
				</div>
			</Show>
			<div class="grid g2">
				<For each={fields}>
					{([field, label, hint]) => (
						<label>
							<div class="field-label">{label}</div>
							<textarea class="textarea" rows="2" placeholder={hint} value={(s() as Record<string, string | null> | undefined)?.[field] ?? ""} onChange={(e) => save(field, e.currentTarget.value)} />
						</label>
					)}
				</For>
			</div>
			<div class="row small" style={{ "margin-top": "8px" }}>
				<span class="faint">🔥 {fa(s()?.stats.streak ?? 0)} روز پشت سر هم</span>
				<span class="spacer" />
				<button class="btn ghost sm" onClick={() => setShowHistory(!showHistory())}>
					{showHistory() ? "بستن تاریخچه" : "تاریخچه"}
				</button>
			</div>
			<Show when={showHistory()}>
				<div class="stack" style={{ "margin-top": "8px" }}>
					<For each={history()}>
						{(h) => (
							<div class="small" style={{ "border-top": "1px solid var(--line)", "padding-top": "6px" }}>
								<b>{jalali(h.day, { weekday: "short", day: "numeric", month: "short" })}</b>
								<div class="muted">✅ {h.done ?? "—"} · ⏭ {h.next ?? "—"} · 🧱 {h.blockers ?? "—"} · 🙋 {h.help ?? "—"}</div>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function Decisions() {
	const [list, { refetch }] = createResource(version, () => rpc<Decision[]>("decisions"));
	const [title, setTitle] = createSignal("");
	const [impact, setImpact] = createSignal<"low" | "high">("high");
	const [reversible, setReversible] = createSignal(true);
	const save = (id: number, patch: Record<string, unknown>) => rpc("saveDecision", { id, ...patch }).then(refetch);
	const preview = () =>
		impact() === "low" ? "decide" : reversible() ? "decide_and_inform" : ("align_first" as keyof typeof MODE_FA);
	return (
		<div class="card">
			<h3>⚖️ دفتر تصمیم‌ها · کِی خودم تصمیم بگیرم، کِی escalate کنم؟</h3>
			<form
				class="row wrap"
				onSubmit={(e) => {
					e.preventDefault();
					if (!title().trim()) return;
					rpc("saveDecision", { title: title().trim(), impact: impact(), reversible: reversible() }).then(() => (setTitle(""), refetch()));
				}}
			>
				<input class="input" style={{ flex: 1, "min-width": "220px" }} placeholder="چه چیزی را باید تصمیم بگیرم؟" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
				<select class="input" style={{ width: "auto" }} onChange={(e) => setImpact(e.currentTarget.value as "low" | "high")}>
					<option value="high">اثر زیاد</option>
					<option value="low">اثر کم</option>
				</select>
				<select class="input" style={{ width: "auto" }} onChange={(e) => setReversible(e.currentTarget.value === "1")}>
					<option value="1">برگشت‌پذیر</option>
					<option value="0">برگشت‌ناپذیر</option>
				</select>
				<span class="chip" style={{ color: MODE_COLOR[preview()] }}>
					→ {MODE_FA[preview()]}
				</span>
				<button class="btn primary sm">ثبت</button>
			</form>
			<div class="stack" style={{ "margin-top": "10px" }}>
				<For each={list()} fallback={<div class="faint small">تصمیم‌های فنی را این‌جا ثبت کن تا مرز «مستقل / هماهنگی» برای خودت و لیدت روشن شود.</div>}>
					{(d) => (
						<div class="decision" style={{ "border-inline-start-color": MODE_COLOR[d.mode] }}>
							<div class="row wrap">
								<b>{d.title}</b>
								<Show when={d.project_key}>
									<span class="chip key">{d.project_key}</span>
								</Show>
								<span class="chip" style={{ color: MODE_COLOR[d.mode] }}>
									{MODE_FA[d.mode]}
								</span>
								<span class="spacer" />
								<span class="small faint">{ago(d.created_at)}</span>
								<select class="input" style={{ width: "auto", padding: "0 8px" }} onChange={(e) => save(d.id, { status: e.currentTarget.value })}>
									<For each={["open", "decided", "revisited"] as const}>
										{(st) => (
											<option value={st} selected={st === d.status}>
												{{ open: "باز", decided: "تصمیم گرفته شد", revisited: "بازبینی شد" }[st]}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="small muted">{d.advice}</div>
							<div class="grid g3" style={{ "margin-top": "6px" }}>
								<input class="inline-edit small" placeholder="گزینه‌ها" value={d.options ?? ""} onChange={(e) => save(d.id, { options: e.currentTarget.value })} />
								<input class="inline-edit small" placeholder="انتخاب و دلیل" value={d.choice ?? ""} onChange={(e) => save(d.id, { choice: e.currentTarget.value })} />
								<input
									class="inline-edit small"
									placeholder={d.mode === "align_first" ? "⚠️ با چه کسی هماهنگ شد؟" : "به چه کسی خبر دادی؟"}
									value={d.aligned_with ?? ""}
									onChange={(e) => save(d.id, { aligned_with: e.currentTarget.value })}
								/>
							</div>
						</div>
					)}
				</For>
			</div>
		</div>
	);
}

// ── People ─────────────────────────────────────────────────────────────────

interface PersonRow {
	id: number;
	name: string;
	role: string | null;
	team: string | null;
	relation: string;
	assessor: number;
	notes: string | null;
	cadence: number;
	days_since: number | null;
	overdue: boolean;
	interactions: number;
	last_kind: string | null;
}

const RELATION_FA: Record<string, string> = { manager: "مدیر", report: "تیم من", peer: "هم‌تیمی", product: "پروداکت", stakeholder: "ذی‌نفع", other: "دیگر" };
const ACTIONS = [
	["one_on_one", "☕ ۱:۱"],
	["help", "🛟 کمک کردم"],
	["feedback_given", "💬 فیدبک دادم"],
	["review", "🔍 ریویو"],
	["kudos", "🙏 تشکر"],
	["sync", "🔄 هماهنگی"],
] as const;
export const INTERACTION_FA: Record<string, string> = {
	one_on_one: "۱:۱",
	help: "کمک",
	feedback_given: "فیدبک دادم",
	feedback_received: "فیدبک گرفتم",
	review: "ریویو",
	kudos: "تشکر",
	sync: "هماهنگی",
	social: "گپ",
};

const STANDUP_PROMPT = "استندآپ امروزم را با هم بنویسیم: standup_context را بخوان (استندآپ قبلی و قول\u200cهایم، جابه\u200cجایی\u200cهای برد جیرا، کامیت\u200cها، MRها، وضعیت تیم و پیگیری\u200cها). طبق format_rules کوتاه و دقیق بنویس، اگر چیزی از قول دیروز عقب افتاده صادقانه بگو، فقط جایی که لازم است از اعضای تیم اسم ببر، با standup_save ذخیره کن و متن نهایی را بده. در آخر یک خط کوچینگ: مبهم\u200cترین جمله\u200cای که احتمالاً می\u200cگفتم و نسخه\u200cی دقیقش.";

interface TeamMember {
	person: string;
	jira_user: string | null;
	issues: { key: string; summary: string; status: string; category: string; days_in_status: number | null; url: string }[];
	flags: string[];
	followups: { id: number; text: string; direction: string }[];
	last_contact_days: number | null;
}

function TeamBoard() {
	const [team] = createResource(version, () => rpc<TeamMember[]>("teamStatus"));
	return (
		<Show when={team()?.length}>
			<div class="card" style={{ "margin-bottom": "16px" }}>
				<h3>
					👩‍💻 تیم من <span class="faint small">· از برد جیرا</span>
				</h3>
				<div class="grid g2">
					<For each={team()}>
						{(m) => (
							<div class="stack" style={{ gap: "6px" }}>
								<div class="row">
									<b>{m.person}</b>
									<span class="chip ltr">{m.jira_user ?? "jira_user؟"}</span>
									<span class="spacer" />
									<button class="btn sm" onClick={() => askAssistant(`مرا برای ۱:۱ با ${m.person} آماده کن: team_status، پیگیری‌ها و تاریخچه‌ی تعامل‌مان را ببین. بگو کجا گیر کرده، چه فیدبکی بدهم و چطور کمکش کنم (هدف Leadership).`)}>
										☕ آماده‌سازی ۱:۱
									</button>
								</div>
								<For each={m.flags}>{(f) => <div class="nudge warn small">⚠️ <span class="ltr">{f}</span></div>}</For>
								<For each={m.issues.filter((i) => i.category !== "done").slice(0, 6)}>
									{(i) => (
										<a class="row small" href={i.url} target="_blank" rel="noreferrer">
											<span class="chip key">{i.key}</span>
											<span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{i.summary}</span>
											<span class="chip ltr">{i.status}</span>
										</a>
									)}
								</For>
							</div>
						)}
					</For>
				</div>
			</div>
		</Show>
	);
}

interface FollowupRow {
	id: number;
	person: string | null;
	direction: "mine" | "theirs";
	text: string;
	due: string | null;
	status: string;
	overdue: boolean;
	task_key: string | null;
}

export function Followups(props: { person?: string; compact?: boolean }) {
	const [list, { refetch }] = createResource(version, () => rpc<FollowupRow[]>("followups", { status: "open", ...(props.person ? { person: props.person } : {}) }));
	const [text, setText] = createSignal("");
	const [who, setWho] = createSignal(props.person ?? "");
	const [dir, setDir] = createSignal<"mine" | "theirs">("mine");
	const [due, setDue] = createSignal("");
	const add = (e: Event) => {
		e.preventDefault();
		if (!text().trim()) return;
		rpc("saveFollowup", { text: text().trim(), person: who().trim() || null, direction: dir(), due: due() || null }).then(() => (setText(""), setDue(""), refetch()));
	};
	return (
		<div class="card">
			<h3>↩ پیگیری‌ها <span class="faint small">· قول‌هایم و چیزهایی که منتظرشانم</span></h3>
			<form class="row wrap" onSubmit={add} style={{ "margin-bottom": "8px" }}>
				<select class="input" style={{ width: "auto" }} onChange={(e) => setDir(e.currentTarget.value as "mine" | "theirs")}>
					<option value="mine">من باید…</option>
					<option value="theirs">منتظرم از…</option>
				</select>
				<Show when={!props.person}>
					<input class="input" style={{ width: "140px" }} placeholder="چه کسی" value={who()} onInput={(e) => setWho(e.currentTarget.value)} />
				</Show>
				<input class="input" style={{ flex: 1, "min-width": "160px" }} placeholder="چه چیزی" value={text()} onInput={(e) => setText(e.currentTarget.value)} />
				<input class="input ltr" type="date" style={{ width: "auto" }} value={due()} onInput={(e) => setDue(e.currentTarget.value)} />
				<button class="btn sm">+</button>
			</form>
			<For each={list()} fallback={<div class="faint small">پیگیری بازی نیست.</div>}>
				{(f) => (
					<div class="row small followup" classList={{ overdue: f.overdue }}>
						<button class="check" title="انجام شد" onClick={() => rpc("saveFollowup", { id: f.id, status: "done" }).then(refetch)}>
							✓
						</button>
						<span>{f.direction === "mine" ? "↗" : "↙"}</span>
						<Show when={f.person}>
							<b>{f.person}</b>
						</Show>
						<span style={{ flex: 1 }}>{f.text}</span>
						<Show when={f.task_key}>
							<span class="chip key" style={{ cursor: "pointer" }} onClick={() => openTask(f.task_key!)}>
								{f.task_key}
							</span>
						</Show>
						<Show when={f.due}>
							<span class="chip" classList={{ "st-blocked": f.overdue }}>
								{jalali(f.due!)}
							</span>
						</Show>
					</div>
				)}
			</For>
		</div>
	);
}

export function PeoplePage() {
	const [people, { refetch }] = createResource(version, () => rpc<PersonRow[]>("people"));
	const [filter, setFilter] = createSignal<"all" | "overdue" | "assessors">("all");
	const [name, setName] = createSignal("");
	const shown = () =>
		(people() ?? []).filter((p) => (filter() === "overdue" ? p.overdue : filter() === "assessors" ? p.assessor : true));
	const log = async (p: PersonRow, kind: string) => {
		const answer = await ask({
			title: `${INTERACTION_FA[kind]} با ${p.name}`,
			fields: [
				{ name: "note", label: "یک خط یادداشت", type: "textarea", placeholder: "چه گذشت؟ چه چیزی برای بعد بماند؟" },
				{ name: "day", label: "کِی؟", type: "date", value: todayIso(), suggestions: DATE_SUGGESTIONS().slice(0, 1) },
			],
			confirm: "ثبت",
		});
		if (!answer) return;
		const note = answer.note.trim() || null;
		rpc("logInteraction", { person: p.id, kind, note, day: answer.day || undefined }).then(() => (toast(`ثبت شد: ${INTERACTION_FA[kind]} · ${p.name}`, "win"), refetch()));
	};
	return (
		<>
			<div class="page-head">
				<div>
					<h1>آدم‌ها</h1>
					<p>رابطه‌سازی آگاهانه: تیمت، لیدت، پروداکت و ارزیاب‌هایت. هر کمک، فیدبک و تشکر شاهدی برای Leadership و Communication است.</p>
				</div>
				<form
					class="row"
					onSubmit={(e) => {
						e.preventDefault();
						if (name().trim()) rpc("savePerson", { name: name().trim() }).then(() => (setName(""), refetch()));
					}}
				>
					<input class="input" style={{ width: "220px" }} placeholder="اسم…" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
					<button class="btn primary">+ آدم</button>
				</form>
			</div>
			<TeamBoard />
			<div style={{ "margin-bottom": "16px" }}>
				<Followups />
			</div>
			<div class="row" style={{ "margin-bottom": "12px" }}>
				<For each={[["all", "همه"], ["overdue", "وقت تماس است"], ["assessors", "ارزیاب‌ها"]] as const}>
					{([id, label]) => (
						<button class="btn sm" classList={{ primary: filter() === id }} onClick={() => setFilter(id)}>
							{label}
							{id === "overdue" ? ` (${fa((people() ?? []).filter((p) => p.overdue).length)})` : ""}
						</button>
					)}
				</For>
			</div>
			<div class="grid g3">
				<For each={shown()}>
					{(p) => (
						<div class="card stack person" classList={{ overdue: p.overdue }}>
							<div class="row">
								<div class="avatar">{p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
								<div style={{ flex: 1, "min-width": 0 }}>
									<b>{p.name}</b>
									<div class="small faint">
										{p.role ?? p.team ?? ""}
									</div>
								</div>
								<select class="input" style={{ width: "auto", padding: "0 6px" }} onChange={(e) => rpc("savePerson", { id: p.id, relation: e.currentTarget.value }).then(refetch)}>
									<For each={Object.entries(RELATION_FA)}>
										{([k, v]) => (
											<option value={k} selected={k === p.relation}>
												{v}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="row small wrap">
								<Show when={p.assessor}>
									<span class="chip accent">ارزیاب</span>
								</Show>
								<span class="chip" classList={{ "st-blocked": p.overdue }}>
									{p.days_since == null ? "هنوز تماسی ثبت نشده" : `آخرین: ${fa(p.days_since)} روز پیش`}
								</span>
								<span class="faint">هر {fa(p.cadence)} روز</span>
							</div>
							<input
								class="inline-edit small"
								placeholder="به چه چیزی اهمیت می‌دهد؟ چطور کمکش کنم؟"
								value={p.notes ?? ""}
								onChange={(e) => rpc("savePerson", { id: p.id, notes: e.currentTarget.value })}
							/>
							<div class="row wrap" style={{ gap: "4px" }}>
								<For each={ACTIONS}>
									{([kind, label]) => (
										<button class="btn sm" onClick={() => log(p, kind)}>
											{label}
										</button>
									)}
								</For>
							</div>
						</div>
					)}
				</For>
			</div>
		</>
	);
}

export { jalali };
