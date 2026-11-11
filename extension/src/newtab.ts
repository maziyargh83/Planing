/**
 * Gaam lite for Chrome's new-tab page: a small daily cockpit. The next step and
 * today's path on one side; what is moving around you (Jira, merge requests,
 * follow-ups, meetings, coaching nudges) on the other; one capture line.
 * Plain DOM on purpose — it has to paint instantly on every tab.
 * Talks to the local server through /api/rpc; the server lets this page in only
 * when GAAM_EXTENSION_ORIGIN names this extension.
 */
import { type Capture, INTENT_FA, parseCapture, type Person } from "../../web/src/capture.ts";

const SERVER = "http://127.0.0.1:4777";
/** The full app: Vite's dev UI when `pnpm dev` runs, otherwise the built one. */
const APPS = ["http://localhost:4778", "http://localhost:4777"];
const WS_KEY = "gaam.workspace";

interface Task {
	key: string;
	title: string;
	status: string;
	due: string | null;
	estimate_h: number | null;
	external_status?: string | null;
	jira_key?: string | null;
	project_title?: string | null;
}

interface Nudge {
	level: "info" | "warn" | "win";
	code: string;
	message: string;
}

interface Ctx {
	goals: { id: number; title: string; progress?: number | null }[];
	day: {
		intention: string | null;
		top: Task[];
		completed: Task[];
		focus_minutes: number;
		running_focus: { started_at: string; task_key: string | null; task_title: string | null } | null;
	};
	in_progress: Task[];
	next_up: Task[];
	open_asks: { id: number; question: string }[];
	nudges: Nudge[];
	week: { streak: number; totals: { done: number; focus_minutes: number } };
}

interface Followup {
	id: number;
	direction: "mine" | "theirs";
	text: string;
	person: string | null;
	due: string | null;
	overdue: boolean;
}

interface Doc {
	id: number;
	title: string;
	day: string | null;
	people: string | null;
}

interface Review {
	ref: string;
	title: string;
	url: string;
	branch: string;
	state: string;
	source: string;
}

interface Workspace {
	key: string;
	name: string;
	icon: string | null;
}

class Offline extends Error {}
class Forbidden extends Error {}

// ── Formatting (same rules as web/src/api.ts) ──────────────────────────────

const faNumber = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 });
const fa = (n: number | null | undefined) => (n == null ? "—" : faNumber.format(n));
const jalali = (date: Date | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) =>
	new Intl.DateTimeFormat("fa-IR-u-ca-persian", opts).format(typeof date === "string" ? new Date(date.length === 10 ? `${date}T12:00:00` : date) : date);
const today = () => new Date().toLocaleDateString("en-CA");

function relativeDay(iso: string) {
	const days = Math.round((Date.parse(`${iso}T12:00:00`) - Date.parse(`${today()}T12:00:00`)) / 864e5);
	if (days === 0) return "امروز";
	if (days === 1) return "فردا";
	if (days === -1) return "دیروز";
	if (days < 0) return `${fa(-days)} روز گذشته`;
	if (days < 7) return `${fa(days)} روز دیگر`;
	return jalali(iso);
}

function minutes(m: number) {
	const n = Math.round(m);
	if (n < 60) return `${fa(n)} دقیقه`;
	return `${fa(Math.round(n / 6) / 10)} ساعت`;
}

function greeting() {
	const h = new Date().getHours();
	if (h < 5) return "شب بخیر";
	if (h < 12) return "صبح بخیر";
	if (h < 17) return "روز بخیر";
	if (h < 20) return "عصر بخیر";
	return "شب بخیر";
}

const MR_STATE: Record<string, string> = {
	mergeable: "آماده‌ی مرج",
	not_approved: "منتظر تأیید",
	draft_status: "پیش‌نویس",
	ci_still_running: "CI در حال اجرا",
	ci_must_pass: "CI رد شده",
	discussions_not_resolved: "بحث باز",
	conflict: "کانفلیکت",
	broken_status: "کانفلیکت",
	need_rebase: "نیاز به ریبیس",
	checking: "در حال بررسی",
	unchecked: "در حال بررسی",
	blocked_status: "مسدود",
	opened: "باز",
	open: "باز",
};
const MR_TONE: Record<string, string> = { mergeable: "good", ci_must_pass: "bad", conflict: "bad", broken_status: "bad", need_rebase: "bad", discussions_not_resolved: "warn" };

// ── Storage (per-viewer conveniences only) ─────────────────────────────────

function load_<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw == null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}
function save_(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {}
}

const workspace = () => load_<string>(WS_KEY, "all");

// ── API ────────────────────────────────────────────────────────────────────

async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (workspace() !== "all") headers["x-gaam-workspace"] = workspace();
	let res: Response;
	try {
		res = await fetch(`${SERVER}/api/rpc`, { method: "POST", headers, body: JSON.stringify({ method, args }) });
	} catch {
		throw new Offline();
	}
	if (res.status === 403) throw new Forbidden();
	const body = (await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))) as { data?: T; error?: { message: string } };
	if (body.error) throw new Error(body.error.message);
	return body.data as T;
}

let app = APPS[1]!;
/** Opaque no-cors probe: resolves only if something listens there. */
async function pickApp() {
	for (const url of APPS) {
		try {
			await fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(700) });
			app = url;
			break;
		} catch {}
	}
	$("open-app").setAttribute("href", `${app}/#/now`);
}
const appLink = (path: string) => `${app}/#${path}`;
const taskLink = (key: string) => `${app}/#/now?task=${encodeURIComponent(key)}`;

// ── Tiny DOM helper ────────────────────────────────────────────────────────

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue;
		if (k.startsWith("on")) el.addEventListener(k.slice(2), v as EventListener);
		else if (k === "class") el.className = String(v);
		else el.setAttribute(k, v === true ? "" : String(v));
	}
	for (const c of children) if (c != null && c !== false) el.append(c);
	return el;
}

const $ = (id: string) => document.getElementById(id)!;
const link = (href: string, text: Child, cls = "") => h("a", { href, class: cls, target: href.startsWith(app) ? null : "_blank", rel: "noreferrer" }, text);

let toastTimer = 0;
function toast(text: string, kind: "win" | "error" = "win") {
	const el = $("toast");
	el.textContent = text;
	el.className = `toast show ${kind}`;
	clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => (el.className = "toast"), 2600);
}

/** A side card: hidden when it has nothing to say. */
function panel(id: string, title: string, rows: Node[], opts: { count?: number; more?: [string, string] } = {}) {
	const box = $(id);
	box.replaceChildren();
	box.hidden = rows.length === 0;
	if (!rows.length) return;
	const head = h("div", { class: "panel-head" }, h("h3", {}, title));
	if (opts.count != null) head.append(h("span", { class: "count" }, fa(opts.count)));
	if (opts.more) head.append(link(opts.more[0], opts.more[1], "more"));
	box.append(head, h("ul", { class: "rows" }, ...rows));
}

// ── State ──────────────────────────────────────────────────────────────────

let ctx: Ctx | null = null;
let people: Person[] = [];
let later: string[] = [];
let focusTimer = 0;
let jiraUrl: string | null = null;
let reviews: Review[] = [];

function queue(c: Ctx): Task[] {
	const seen = new Set<string>();
	const out: Task[] = [];
	for (const t of [...c.day.top, ...c.in_progress, ...c.next_up])
		if (!seen.has(t.key) && t.status !== "done" && t.status !== "dropped") {
			seen.add(t.key);
			out.push(t);
		}
	return out.sort((a, b) => later.indexOf(a.key) - later.indexOf(b.key));
}

const jiraLink = (t: Task) => (jiraUrl && t.jira_key ? `${jiraUrl}/browse/${t.jira_key}` : null);

function taskChips(t: Task): Node[] {
	const out: Node[] = [];
	if (t.external_status) out.push(h("span", { class: "chip ltr" }, t.external_status));
	if (t.due) out.push(h("span", { class: `chip${t.due < today() ? " late" : ""}` }, `📅 ${relativeDay(t.due)}`));
	return out;
}

// ── Main column ────────────────────────────────────────────────────────────

function renderHeader(c: Ctx | null) {
	$("greet").textContent = greeting();
	$("date").textContent = jalali(new Date(), { weekday: "long", day: "numeric", month: "long" });
	const stats = $("stats");
	stats.replaceChildren();
	if (!c) return;
	const bits = [`✓ ${fa(c.week.totals.done)} کار این هفته`, `⏱ ${minutes(c.week.totals.focus_minutes)} تمرکز این هفته`];
	if (c.day.focus_minutes) bits.push(`امروز ${minutes(c.day.focus_minutes)}`);
	if (c.week.streak > 0) bits.push(`🔥 ${fa(c.week.streak)} روز پشت سر هم`);
	stats.append(...bits.map((b) => h("span", {}, b)));
}

function renderIntention(c: Ctx) {
	const box = $("intention");
	box.replaceChildren();
	if (c.day.intention) {
		box.append(h("span", { class: "faint" }, "نیت امروز: "), h("span", {}, c.day.intention));
		return;
	}
	const input = h("input", { type: "text", placeholder: "نیت امروز در یک جمله، مثلاً «فقط روی سرچ تمرکز کنم»", "aria-label": "نیت امروز", dir: "auto" });
	input.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" || !input.value.trim()) return;
		void act(async () => {
			await rpc("planDay", today(), { intention: input.value.trim() });
			toast("نیت امروز ثبت شد");
		});
	});
	box.append(input);
}

const doneNow = (t: Task) =>
	act(async () => {
		await rpc("updateTask", t.key, { status: "done" });
		toast(`✓ ${t.title}`);
	});
const focusNow = (t: Task) => act(() => rpc("startFocus", t.key));
function postpone(c: Ctx, t: Task) {
	if (queue(c).length < 2) return;
	later = [...later.filter((k) => k !== t.key), t.key];
	render();
}

function renderStep(c: Ctx) {
	const card = $("step");
	card.replaceChildren();
	const focus = c.day.running_focus;
	if (focus) {
		const clock = h("div", { class: "clock ltr" });
		const tick = () => {
			const s = Math.max(0, Math.floor((Date.now() - Date.parse(focus.started_at)) / 1000));
			clock.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
		};
		tick();
		clearInterval(focusTimer);
		focusTimer = window.setInterval(tick, 1000);
		const task = queue(c).find((t) => t.key === focus.task_key);
		card.append(
			h("div", { class: "label" }, "در حال تمرکز روی"),
			h("h2", { class: "title" }, focus.task_title ?? "تمرکز آزاد"),
			clock,
			h(
				"div",
				{ class: "actions" },
				task && h("button", { type: "button", class: "btn primary", onclick: () => act(async () => {
					await rpc("stopFocus");
					await rpc("updateTask", task.key, { status: "done" });
					toast(`✓ ${task.title}`);
				}) }, "✓ تمامش کردم"),
				h("button", { type: "button", class: "btn", onclick: () => act(async () => {
					const r = await rpc<{ minutes: number } | null>("stopFocus");
					toast(`${minutes(r?.minutes ?? 0)} تمرکز ثبت شد`);
				}) }, "■ فعلاً بس است"),
			),
		);
		return;
	}
	clearInterval(focusTimer);

	const t = queue(c)[0];
	if (!t) {
		card.append(
			h("div", { class: "emoji" }, "🌄"),
			h("h2", { class: "title" }, "کاری در صف امروز نیست"),
			h("p", { class: "muted" }, "پایین یک قدم تازه بنویس، یا در گام برای امروز برنامه بریز."),
		);
		return;
	}
	const meta = h("div", { class: "meta" }, h("span", { class: "label" }, "قدم بعدی"), link(taskLink(t.key), t.key, "key ltr"));
	if (t.project_title) meta.append(h("span", { class: "faint" }, `· ${t.project_title}`));
	meta.append(...taskChips(t));
	if (t.estimate_h) meta.append(h("span", { class: "chip" }, `⏳ ${fa(t.estimate_h)} ساعت`));
	const jira = jiraLink(t);
	if (jira) meta.append(link(jira, `${t.jira_key} ↗`, "chip ltr"));
	card.append(
		meta,
		h("h2", { class: "title" }, link(taskLink(t.key), t.title)),
		h(
			"div",
			{ class: "actions" },
			h("button", { type: "button", class: "btn", title: "D", onclick: () => doneNow(t) }, "✓ انجامش دادم"),
			h("button", { type: "button", class: "btn primary", title: "F", onclick: () => focusNow(t) }, "شروع تمرکز"),
			h("button", { type: "button", class: "btn ghost", title: "L", disabled: queue(c).length < 2, onclick: () => postpone(c, t) }, "بعداً"),
		),
		h("div", { class: "keys faint" }, "D انجام · F تمرکز · L بعداً · / ثبت سریع"),
	);
}

async function togglePlan(c: Ctx, t: Task) {
	const keys = c.day.top.map((x) => x.key);
	const next = keys.includes(t.key) ? keys.filter((k) => k !== t.key) : [...keys, t.key];
	await act(async () => {
		await rpc("planDay", today(), { top: next });
		toast(keys.includes(t.key) ? "از برنامه‌ی امروز برداشته شد" : "به برنامه‌ی امروز اضافه شد");
	});
}

function renderPath(c: Ctx) {
	const box = $("path");
	box.replaceChildren();
	const rest = queue(c).slice(1, 8);
	if (!rest.length && !c.day.completed.length) return;
	const planned = new Set(c.day.top.map((t) => t.key));
	const head = h("div", { class: "section-title" }, h("span", { class: "faint" }, "مسیر امروز"));
	if (!planned.size) head.append(h("span", { class: "hint" }, "هنوز برنامه نچیدی؛ با ☆ تا سه کار برای امروز انتخاب کن"));
	const list = h("ol", { class: "trail" });
	for (const t of c.day.completed.slice(-3)) list.append(h("li", { class: "done", title: t.title }, h("span", { class: "n" }, "✓"), h("span", { class: "t" }, t.title)));
	rest.forEach((t, i) => {
		const on = planned.has(t.key);
		list.append(
			h(
				"li",
				{},
				h("button", { type: "button", class: "n", title: "اول این را انجام بده", "aria-label": `اول ${t.title}`, onclick: () => {
					later = later.filter((k) => k !== t.key);
					ctx = { ...c, day: { ...c.day, top: [t, ...c.day.top.filter((x) => x.key !== t.key)] } };
					render();
				} }, fa(i + 2)),
				link(taskLink(t.key), t.title, "t"),
				...taskChips(t),
				h("button", { type: "button", class: `star${on ? " on" : ""}`, "aria-pressed": String(on), title: on ? "برداشتن از برنامه‌ی امروز" : "در برنامه‌ی امروز", onclick: () => void togglePlan(c, t) }, on ? "★" : "☆"),
			),
		);
	});
	box.append(head, list);
}

// ── Side column ────────────────────────────────────────────────────────────

const dismissKey = () => `gaam.nudges.${today()}`;

function renderNudges(c: Ctx) {
	const hidden = new Set(load_<string[]>(dismissKey(), []));
	const order = { warn: 0, win: 1, info: 2 };
	const list = c.nudges.filter((n) => !hidden.has(n.code)).sort((a, b) => order[a.level] - order[b.level]).slice(0, 3);
	panel(
		"nudges",
		"یادآوری‌ها",
		list.map((n) =>
			h(
				"li",
				{ class: `nudge ${n.level}` },
				h("span", { class: "grow" }, n.message),
				h("button", { type: "button", class: "x", title: "امروز دیگر نشان نده", "aria-label": "بستن", onclick: () => {
					save_(dismissKey(), [...hidden, n.code]);
					renderNudges(c);
				} }, "×"),
			),
		),
	);
}

function renderAsks(c: Ctx) {
	panel(
		"asks",
		"سؤال ایجنت‌ها",
		c.open_asks.slice(0, 3).map((a) => h("li", {}, link(appLink("/today"), a.question, "grow"))),
		{ count: c.open_asks.length, more: [appLink("/today"), "جواب بده"] },
	);
}

function renderDoing(c: Ctx) {
	panel(
		"doing",
		"در جریان",
		c.in_progress.slice(0, 6).map((t) => {
			const jira = jiraLink(t);
			return h(
				"li",
				{},
				link(taskLink(t.key), t.key, "key ltr"),
				link(taskLink(t.key), t.title, "grow t"),
				t.status === "blocked" ? h("span", { class: "chip bad" }, "گیر کرده") : null,
				t.external_status ? (jira ? link(jira, t.external_status, "chip ltr") : h("span", { class: "chip ltr" }, t.external_status)) : null,
			);
		}),
		{ count: c.in_progress.length },
	);
}

function renderReviews() {
	panel(
		"reviews",
		"مرج‌ریکوئست‌های باز",
		reviews.slice(0, 6).map((r) =>
			h(
				"li",
				{},
				link(r.url, r.title, "grow t"),
				h("span", { class: `chip ${MR_TONE[r.state] ?? ""}` }, MR_STATE[r.state] ?? r.state),
			),
		),
		{ count: reviews.length },
	);
}

function renderFollowups(list: Followup[]) {
	panel(
		"followups",
		"پیگیری‌ها",
		list.slice(0, 6).map((f) =>
			h(
				"li",
				{},
				h("button", { type: "button", class: "check", title: "انجام شد", "aria-label": `انجام شد: ${f.text}`, onclick: () => act(async () => {
					await rpc("saveFollowup", { id: f.id, status: "done" });
					toast("پیگیری بسته شد");
				}) }),
				h("span", { class: "dir", title: f.direction === "mine" ? "قول من" : "منتظرم" }, f.direction === "mine" ? "↗" : "↙"),
				h("span", { class: "grow t" }, f.person ? `${f.person}: ${f.text}` : f.text),
				f.due ? h("span", { class: `chip${f.overdue ? " late" : ""}` }, relativeDay(f.due)) : null,
			),
		),
		{ count: list.length, more: [appLink("/growth"), "همه"] },
	);
}

function renderMeetings(list: Doc[]) {
	panel(
		"meetings",
		"جلسه‌های امروز",
		list.map((d) => h("li", {}, h("span", { class: "dir" }, "🗓"), link(appLink("/knowledge"), d.title, "grow t"), d.people ? h("span", { class: "faint small" }, d.people) : null)),
	);
}

function renderBrief(brief: { created_at: string; parts?: { type: string; text?: string }[]; content?: string } | null) {
	const box = $("brief");
	box.replaceChildren();
	const text = (brief?.parts ?? [])
		.filter((p) => p.type === "text" && p.text)
		.map((p) => p.text!)
		.join("\n")
		.trim() || brief?.content?.trim() || "";
	box.hidden = !brief || !text || new Date(brief.created_at).toLocaleDateString("en-CA") !== today();
	if (box.hidden) return;
	const lines = text
		.replace(/\*\*|__|`/g, "")
		.split("\n")
		.map((l) => l.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "• ").trim())
		.filter(Boolean);
	box.append(h("details", {}, h("summary", {}, h("h3", {}, "خلاصه‌ی صبح"), h("span", { class: "faint small" }, lines[0]?.slice(0, 80) ?? "")), h("div", { class: "brief-body" }, ...lines.slice(0, 40).map((l) => h("p", {}, l)))));
}

function renderFoot() {
	const box = $("foot");
	box.replaceChildren(
		link(appLink("/now"), "↗ باز کردن گام", "pill"),
		link(appLink("/today"), "امروز", "pill"),
		link(appLink("/growth"), "🗣 استندآپ", "pill"),
		link(appLink("/goals"), "🎯 اهداف", "pill"),
	);
}

function render() {
	renderHeader(ctx);
	if (!ctx) return;
	document.body.dataset.state = "ready";
	renderIntention(ctx);
	renderStep(ctx);
	renderPath(ctx);
	renderNudges(ctx);
	renderAsks(ctx);
	renderDoing(ctx);
	renderReviews();
	renderFoot();
}

function showState(state: "offline" | "forbidden") {
	document.body.dataset.state = state;
	renderHeader(null);
	$("forbidden-line").textContent = `GAAM_EXTENSION_ORIGIN=chrome-extension://${location.host}`;
}

function fail(error: unknown) {
	if (error instanceof Offline) return showState("offline");
	if (error instanceof Forbidden) return showState("forbidden");
	toast((error as Error).message, "error");
}

async function act(run: () => Promise<unknown>) {
	try {
		await run();
		await load();
	} catch (error) {
		fail(error);
	}
}

// ── Workspaces ─────────────────────────────────────────────────────────────

async function loadWorkspaces() {
	const list = await rpc<Workspace[]>("workspaces").catch(() => []);
	const box = $("workspaces");
	box.replaceChildren();
	if (list.length < 2) return;
	const choices = [{ key: "all", name: "همه", icon: null } as Workspace, ...list];
	for (const w of choices)
		box.append(
			h("button", { type: "button", class: "ws", "aria-pressed": String(workspace() === w.key), onclick: () => {
				save_(WS_KEY, w.key);
				later = [];
				void loadWorkspaces();
				void load();
				void loadReviews();
			} }, `${w.icon ? `${w.icon} ` : ""}${w.name}`),
		);
}

// ── Capture ────────────────────────────────────────────────────────────────

async function commit(c: Capture) {
	const title = c.text || "(بدون عنوان)";
	switch (c.intent) {
		case "task": {
			const [t] = await rpc<{ key: string }[]>("createTasks", c.project, [{ title, due: c.due, priority: c.priority ?? undefined, tags: c.tags }]);
			return toast(`${t?.key ?? "کار"} ساخته شد`);
		}
		case "followup_mine":
		case "followup_theirs":
			await rpc("saveFollowup", { text: title, person: c.person?.id ?? null, due: c.due, direction: c.intent === "followup_mine" ? "mine" : "theirs" });
			return toast("پیگیری ثبت شد");
		case "meeting":
			await rpc("saveDoc", { title: c.person ? `${title} · ${c.person.name}` : title, kind: "meeting", day: c.due ?? today(), people: c.person ? [c.person.name] : undefined, tags: c.template ? [c.template] : undefined });
			return toast("جلسه ساخته شد؛ آماده‌سازی‌اش را در «دانش» انجام بده");
		case "lesson":
		case "win":
			await rpc("addJournal", { kind: c.intent, body: title });
			return toast(c.intent === "lesson" ? "درس ثبت شد 📚" : "برد ثبت شد 🏆");
		case "decision":
			await rpc("saveDecision", { title, impact: "high", reversible: true });
			return toast("تصمیم ثبت شد");
		case "memory":
			await rpc("remember", "context", title);
			return toast("به خاطر سپردم 🧠");
		case "idea": {
			const p = await rpc<{ key: string }>("createProject", { title });
			return toast(`پروژه‌ی ${p.key} ساخته شد`);
		}
	}
}

function setupCapture() {
	const input = $("capture") as HTMLInputElement;
	const preview = $("capture-preview");
	const update = () => {
		const text = input.value.trim();
		if (!text) return preview.replaceChildren(h("span", { class: "faint" }, "پیشوندها: «درس:»، «برد:»، «تصمیم:»، «ایده:»، «منتظرم از …»، «پیگیری …»، @پروژه، #تگ، فردا، !۱"));
		const c = parseCapture(text, people);
		const bits: string[] = [INTENT_FA[c.intent]];
		if (c.project) bits.push(`@${c.project}`);
		if (c.dueLabel) bits.push(`📅 ${c.dueLabel}`);
		if (c.person) bits.push(`👤 ${c.person.name}`);
		if (c.priority != null) bits.push(`اولویت ${fa(c.priority)}`);
		for (const t of c.tags) bits.push(`#${t}`);
		preview.replaceChildren(...bits.map((b) => h("span", { class: "chip" }, b)), h("span", { class: "faint" }, "↵ ثبت"));
	};
	update();
	input.addEventListener("input", update);
	input.addEventListener("keydown", async (e) => {
		if (e.key === "Escape") return input.blur();
		if (e.key !== "Enter" || e.isComposing || !input.value.trim()) return;
		input.disabled = true;
		try {
			await commit(parseCapture(input.value, people));
			input.value = "";
			update();
			await load();
		} catch (error) {
			fail(error);
		} finally {
			input.disabled = false;
			input.focus();
		}
	});
}

/** The same keys as /now, plus "/" for capture. Persian layout keys work too. */
function setupKeys() {
	window.addEventListener("keydown", (e) => {
		if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return;
		if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
		if (e.key === "/" || e.key === "؟") {
			e.preventDefault();
			return ($("capture") as HTMLInputElement).focus();
		}
		const c = ctx;
		const t = c && !c.day.running_focus ? queue(c)[0] : null;
		if (!c || !t) return;
		if (e.key === "d" || e.key === "ی") void doneNow(t);
		else if (e.key === "f" || e.key === "ب") void focusNow(t);
		else if (e.key === "l" || e.key === "م") postpone(c, t);
	});
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

let retry = 0;
async function load() {
	try {
		const [c, followups, meetings] = await Promise.all([
			rpc<Ctx>("context"),
			rpc<Followup[]>("followups", { status: "open" }).catch(() => []),
			rpc<Doc[]>("docs", { kind: "meeting", limit: 20 }).catch(() => []),
		]);
		ctx = c;
		render();
		renderFollowups(followups);
		renderMeetings(meetings.filter((d) => d.day === today()));
		clearTimeout(retry);
	} catch (error) {
		fail(error);
		if (error instanceof Offline || error instanceof Forbidden) {
			clearTimeout(retry);
			retry = window.setTimeout(() => void boot(), 5000);
		}
	}
}

/** Merge requests come from GitLab/GitHub over the network, so they load on their own clock. */
async function loadReviews() {
	reviews = await rpc<Review[]>("gitReviews").catch(() => []);
	renderReviews();
}

let stream: EventSource | null = null;
/** Writes from the full app or an agent show up here live, as they do in the UI. */
function listen() {
	stream?.close();
	stream = new EventSource(`${SERVER}/api/stream`);
	let pending = 0;
	stream.addEventListener("change", () => {
		clearTimeout(pending);
		pending = window.setTimeout(() => void load(), 250);
	});
	stream.onerror = () => {
		stream?.close();
		stream = null;
		void load();
	};
}

async function boot() {
	await load();
	if (!ctx || document.body.dataset.state !== "ready") return;
	const [ppl, integrations, brief] = await Promise.all([
		rpc<Person[]>("people").catch(() => []),
		rpc<{ jira_url?: string | null }>("integrations").catch(() => null),
		rpc<Parameters<typeof renderBrief>[0]>("latestBrief").catch(() => null),
	]);
	people = ppl;
	jiraUrl = integrations?.jira_url ?? null;
	render();
	renderBrief(brief);
	void loadWorkspaces();
	void loadReviews();
	listen();
}

renderHeader(null);
renderFoot();
setupCapture();
setupKeys();
$("retry").addEventListener("click", () => void boot());
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible" && ctx) void load();
});
// Merge request states change on the remote; refresh them now and then.
setInterval(() => {
	if (document.visibilityState === "visible" && ctx) void loadReviews();
}, 5 * 60_000);
void pickApp().then(() => {
	renderFoot();
	if (ctx) render();
});
void boot();
