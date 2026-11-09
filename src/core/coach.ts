import { Growth } from "./growth.ts";
import { localDay, type Planner } from "./planner.ts";

type Row = Record<string, unknown>;

export interface Nudge {
	level: "info" | "warn" | "win";
	code: string;
	message: string;
	refs?: string[];
}

const WIP_LIMIT = 3;
const STALE_DAYS = 5;

function daysAgo(n: number): string {
	const d = new Date();
	d.setDate(d.getDate() - n);
	return localDay(d);
}

function q<T = Row>(p: Planner, sql: string, ...params: (string | number | null)[]): T[] {
	return p.db.prepare(sql).all(...params).map((r) => ({ ...r }) as T);
}

/**
 * Numbers about how the human actually works, over the last `days` days.
 * Everything here is computed from the log, so it is honest by construction.
 */
export function insights(p: Planner, days = 7) {
	const from = daysAgo(days - 1);
	const fromIso = new Date(`${from}T00:00:00`).toISOString();

	const perDay = new Map<string, { day: string; done: number; created: number; focus: number; energy: number | null; mood: number | null }>();
	for (let i = days - 1; i >= 0; i--) {
		const day = daysAgo(i);
		perDay.set(day, { day, done: 0, created: 0, focus: 0, energy: null, mood: null });
	}
	const bucket = (iso: string) => perDay.get(localDay(new Date(iso)));

	for (const r of q<{ done_at: string }>(p, "select done_at from tasks where done_at >= ?", fromIso)) bucket(r.done_at)!.done++;
	for (const r of q<{ created_at: string }>(p, "select created_at from tasks where created_at >= ?", fromIso))
		bucket(r.created_at)!.created++;
	for (const r of q<{ started_at: string; minutes: number }>(
		p,
		"select started_at, minutes from focus_sessions where started_at >= ? and minutes is not null",
		fromIso,
	)) {
		const b = bucket(r.started_at);
		if (b) b.focus += r.minutes;
	}
	for (const r of q<{ day: string; energy: number | null; mood: number | null }>(
		p,
		"select day, avg(energy) as energy, avg(mood) as mood from journal where day >= ? and (energy is not null or mood is not null) group by day",
		from,
	)) {
		const b = perDay.get(r.day);
		if (b) Object.assign(b, { energy: r.energy, mood: r.mood });
	}
	const series = [...perDay.values()].map((d) => ({ ...d, focus: Math.round(d.focus) }));

	const estimation = q<{ est: number | null; act: number | null; n: number }>(
		p,
		"select sum(estimate_h) as est, sum(actual_h) as act, count(*) as n from tasks where status = 'done' and estimate_h > 0 and actual_h > 0 and done_at >= ?",
		fromIso,
	)[0]!;
	const alignment = q<{ aligned: number; total: number }>(
		p,
		`select count(*) filter (where g.status = 'active') as aligned, count(*) as total
		from tasks t left join projects pr on pr.id = t.project_id left join goals g on g.id = pr.goal_id
		where t.done_at >= ?`,
		fromIso,
	)[0]!;
	const byProject = q<{ key: string | null; title: string | null; done: number }>(
		p,
		`select pr.key, pr.title, count(*) as done from tasks t left join projects pr on pr.id = t.project_id
		where t.done_at >= ? group by t.project_id order by done desc limit 6`,
		fromIso,
	);

	const energyDays = series.filter((d) => d.energy != null);
	const highEnergy = energyDays.filter((d) => d.energy! >= 4);
	const lowEnergy = energyDays.filter((d) => d.energy! <= 2);
	const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

	return {
		range: { from, to: localDay(), days },
		totals: {
			done: series.reduce((a, d) => a + d.done, 0),
			created: series.reduce((a, d) => a + d.created, 0),
			focus_minutes: series.reduce((a, d) => a + d.focus, 0),
		},
		series,
		/** actual ÷ estimate. 1.0 is perfect; 1.5 means things take 50% longer than you think. */
		estimation_ratio: estimation.est && estimation.act ? Math.round((estimation.act / estimation.est) * 100) / 100 : null,
		estimation_sample: estimation.n,
		/** Share of finished work that belongs to a project serving an active goal. */
		alignment: alignment.total ? Math.round((100 * alignment.aligned) / alignment.total) : null,
		by_project: byProject,
		energy: {
			avg: avg(energyDays.map((d) => d.energy!)),
			done_on_high_energy_days: avg(highEnergy.map((d) => d.done)),
			done_on_low_energy_days: avg(lowEnergy.map((d) => d.done)),
		},
		streak: streak(p),
	};
}

/** Consecutive days, ending today or yesterday, with a check-in, a finished task or a focus session. */
function streak(p: Planner): number {
	const active = new Set(
		q<{ day: string }>(
			p,
			`select day from journal
			union select date(done_at, 'localtime') from tasks where done_at is not null
			union select date(started_at, 'localtime') from focus_sessions`,
		).map((r) => r.day),
	);
	let n = 0;
	let i = active.has(localDay()) ? 0 : 1;
	while (active.has(daysAgo(i))) {
		n++;
		i++;
	}
	return n;
}

/** Concrete, actionable observations. An agent should lead with these. */
export function nudges(p: Planner): Nudge[] {
	const out: Nudge[] = [];
	const today = localDay();

	const doing = q<{ key: string; updated_at: string }>(p, "select key, updated_at from tasks where status = 'doing'");
	if (doing.length > WIP_LIMIT)
		out.push({
			level: "warn",
			code: "wip",
			message: `${doing.length} کار هم‌زمان در جریان است (سقف ${WIP_LIMIT}). قبل از شروع کار جدید، چندتا را تمام یا متوقف کن.`,
			refs: doing.map((d) => d.key),
		});
	const stale = doing.filter((d) => d.updated_at < new Date(Date.now() - STALE_DAYS * 864e5).toISOString());
	if (stale.length)
		out.push({
			level: "warn",
			code: "stale",
			message: `${stale.length} کارِ در جریان بیش از ${STALE_DAYS} روز تکان نخورده. بشکنش، گرهش را باز کن، یا رهایش کن.`,
			refs: stale.map((d) => d.key),
		});

	const overdue = q<{ key: string }>(
		p,
		"select key from tasks where due < ? and status not in ('done','dropped') order by due",
		today,
	);
	if (overdue.length)
		out.push({ level: "warn", code: "overdue", message: `${overdue.length} کار از ددلاین گذشته.`, refs: overdue.map((o) => o.key) });

	const blocked = q<{ key: string }>(p, "select key from tasks where status = 'blocked'");
	if (blocked.length)
		out.push({ level: "info", code: "blocked", message: `${blocked.length} کار گیر کرده — چه کسی می‌تواند بازش کند؟`, refs: blocked.map((b) => b.key) });

	const plan = p.db.prepare("select top from day_plans where day = ?").get(today) as { top: string } | undefined;
	if (!plan || plan.top === "[]")
		out.push({ level: "info", code: "no_plan", message: "هنوز برنامه‌ی امروز را نچیدی. حداکثر سه کار انتخاب کن که یک هدف را جلو ببرد." });

	const inbox = q<{ n: number }>(p, "select count(*) as n from tasks where status = 'inbox'")[0]!.n;
	if (inbox >= 7) out.push({ level: "info", code: "inbox", message: `${inbox} مورد در صندوق منتظرند. به پروژه ببرشان یا دورشان بینداز.` });

	const unscored = q<{ key: string }>(
		p,
		`select t.key from tasks t join projects pr on pr.id = t.project_id
		where pr.stage in ('scoping','ready','active') and t.parent_id is null and t.status not in ('done','dropped')
		and (t.impact is null or t.confidence is null or t.ease is null)`,
	);
	if (unscored.length >= 3)
		out.push({
			level: "info",
			code: "unscored",
			message: `${unscored.length} تسک در پروژه‌های اسکوپ‌شده امتیاز ICE ندارند؛ ترتیب اولویت فعلاً حدس است.`,
			refs: unscored.slice(0, 10).map((u) => u.key),
		});

	const oldAsks = q<{ id: number }>(p, "select id from asks where status = 'open' and created_at < ?", new Date(Date.now() - 2 * 864e5).toISOString());
	if (oldAsks.length)
		out.push({ level: "info", code: "asks", message: `${oldAsks.length} سؤال از ایجنت‌ها بیش از دو روز بی‌جواب مانده.` });

	const orphanActive = q<{ key: string }>(p, "select key from projects where stage = 'active' and goal_id is null");
	if (orphanActive.length)
		out.push({
			level: "info",
			code: "orphan",
			message: `پروژه‌ی فعال بدون هدف: ${orphanActive.map((o) => o.key).join("، ")}. چرا داری انجامش می‌دهی؟`,
			refs: orphanActive.map((o) => o.key),
		});

	const energy = q<{ energy: number }>(p, "select energy from journal where energy is not null and day >= ? order by day desc", daysAgo(2));
	if (energy.length >= 3 && energy.every((e) => e.energy <= 2))
		out.push({ level: "warn", code: "energy", message: "سه روز پشت سر هم انرژی‌ات پایین بوده. سبک‌تر برنامه بریز، از خوابت محافظت کن، اسکوپ را کم کن." });

	const stuck = q<{ key: string; external_status: string }>(
		p,
		`select key, external_status from tasks where status = 'doing' and external_since < ?
		and (external_status like '%review%' or external_status like '%QA%' or external_status like '%QC%')`,
		new Date(Date.now() - 2 * 864e5).toISOString(),
	);
	if (stuck.length)
		out.push({
			level: "warn",
			code: "finish_loop",
			message: `${stuck.length} تسک بیش از دو روز در ${[...new Set(stuck.map((s) => s.external_status))].join("/")} مانده. کار وقتی تمام است که مرج و تحویل شود: ریویو را پیگیری کن یا فیدبک را ببند.`,
			refs: stuck.map((s) => s.key),
		});

	const meetings = q<{ id: number; title: string; day: string }>(
		p,
		"select id, title, day from docs where kind = 'meeting' and day between ? and ? and (summary is null or summary = '') order by day",
		today,
		localDay(new Date(Date.now() + 864e5)),
	);
	if (meetings.length)
		out.push({
			level: "info",
			code: "meeting_prep",
			message: `جلسه پیش رو: ${meetings.map((m) => `«${m.title}»${m.day === today ? " (امروز)" : " (فردا)"}`).join("، ")}. ۱۰ دقیقه آماده‌سازی کن: هدف، یک نکته‌ی منفی واقعی، سؤال‌ها.`,
		});

	const growth = new Growth(p);
	const people = growth.people();
	const close = people.filter((x) => (x.relation === "manager" || x.relation === "report") && x.overdue);
	if (close.length)
		out.push({
			level: "warn",
			code: "people_close",
			message: `مدتی است با ${close.map((x) => x.name).join("، ")} حرف نزده‌ای (۱:۱، فیدبک یا کمک). یک وقت کوتاه بگذار.`,
			refs: close.map((x) => x.name),
		});
	const quietAssessors = people.filter((x) => x.assessor && (x.days_since == null || x.days_since > 45));
	if (quietAssessors.length >= 5)
		out.push({
			level: "info",
			code: "assessors",
			message: `${quietAssessors.length} نفر از ارزیاب‌هایت بیش از ۴۵ روز است از کارت خبری نگرفته‌اند. یک آپدیت، کمک یا تشکر کوچک بفرست.`,
		});
	const hour = new Date().getHours();
	const workday = ![4, 5].includes(new Date().getDay());
	if (workday && hour >= 10 && !p.db.prepare("select 1 from standups where day = ?").get(today))
		out.push({ level: "info", code: "standup", message: "استندآپ ساختارمند امروز را ننوشتی: انجام شد / امروز / مانع / تصمیم یا کمک لازم." });
	const unaligned = growth.decisions({ status: "open" }).filter((d) => d.mode === "align_first" && !d.aligned_with);
	if (unaligned.length)
		out.push({
			level: "warn",
			code: "decisions",
			message: `${unaligned.length} تصمیم پراثر و برگشت‌ناپذیر بدون alignment باز است. قبل از اجرا با لید هماهنگ کن.`,
			refs: unaligned.map((d) => d.title),
		});
	const silentGoals = q<{ title: string }>(
		p,
		`select g.title from goals g where g.source = 'SFPM' and g.status = 'active'
		and not exists (select 1 from journal j where j.goal_id = g.id and j.day >= ?)`,
		daysAgo(14),
	);
	if (silentGoals.length)
		out.push({
			level: "info",
			code: "sfpm_evidence",
			message: `${silentGoals.length} هدف SFPM در دو هفته‌ی اخیر هیچ شاهدی ندارد. یک کار کوچک برایشان بردار یا کار انجام‌شده را ثبت کن.`,
			refs: silentGoals.map((g) => g.title.split(" · ")[0]!),
		});

	const wins = q<{ n: number }>(p, "select count(*) as n from tasks where done_at >= ?", new Date(`${today}T00:00:00`).toISOString())[0]!.n;
	if (wins >= 3) out.push({ level: "win", code: "momentum", message: `امروز ${wins} کار تمام کردی. شتاب خوبی داری.` });

	return out;
}

/** The single read an agent should make at the start of every conversation. */
export function context(p: Planner) {
	return {
		today: localDay(),
		now: new Date().toISOString(),
		profile: p.listMemories(),
		goals: p.listGoals("active"),
		day: p.day(),
		in_progress: p.listTasks({ status: ["doing", "blocked"], limit: 20 }),
		next_up: p.listTasks({ status: ["todo"], parent: "root", limit: 10 }),
		projects: p.listProjects(["idea", "discovery", "scoping", "ready", "active"]).map((pr) => ({
			key: pr.key,
			title: pr.title,
			stage: pr.stage,
			goal: pr.goal_title,
			tasks: pr.tasks,
			done: pr.done,
			open_asks: pr.open_asks,
		})),
		open_asks: p.listAsks({ status: "open" }),
		recently_answered: p.listAsks({ status: "answered", since: new Date(Date.now() - 3 * 864e5).toISOString() }),
		nudges: nudges(p),
		growth: new Growth(p).cycle(),
		week: insights(p, 7),
	};
}
