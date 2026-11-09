import { GaamError, type Automation } from "../core/types.ts";
import { Planner } from "../core/planner.ts";
import { gitSync } from "../integrations/git.ts";
import { jiraBoardSync, jiraConfigured, jiraPull, savedBoard } from "../integrations/jira.ts";
import type { Assistant } from "./assistant.ts";
import type { AutomationInput } from "./store.ts";

/** Iranian work week: Saturday to Wednesday. */
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAYS = new Set([6, 0, 1, 2, 3]);
/** A daily slot missed while the app was closed still runs if we are within this window. */
const CATCH_UP_MS = 6 * 3600e3;

type Schedule =
	| { every: number }
	| { at: [number, number]; days: Set<number> | null };

/**
 * Schedules are human-readable:
 *   every 30m · every 2h · daily 09:00 · weekdays 09:00 · weekly wed 17:00 · sat,mon 08:30
 */
export function parseSchedule(text: string): Schedule {
	const s = text.trim().toLowerCase();
	const every = s.match(/^every\s+(\d+)\s*(m|h)$/);
	if (every) return { every: Number(every[1]) * (every[2] === "h" ? 3600e3 : 60e3) };
	const timed = s.match(/^(daily|weekdays|weekly\s+[a-z]{3}|[a-z]{3}(?:,[a-z]{3})*)\s+(\d{1,2}):(\d{2})$/);
	if (!timed) throw new GaamError("INVALID", `Cannot read schedule "${text}". Try "every 30m", "daily 09:00", "weekdays 09:00" or "weekly wed 17:00".`);
	const [, when, hh, mm] = timed as unknown as [string, string, string, string];
	let days: Set<number> | null = null;
	if (when === "weekdays") days = WEEKDAYS;
	else if (when !== "daily") {
		const names = when.replace(/^weekly\s+/, "").split(",");
		days = new Set(names.map((n) => DAYS.indexOf(n as (typeof DAYS)[number])));
		if (days.has(-1)) throw new GaamError("INVALID", `Unknown day in "${text}". Use sat sun mon tue wed thu fri.`);
	}
	return { at: [Number(hh), Number(mm)], days };
}

/** The most recent moment this schedule should have fired, at or before `now`. */
function lastSlot(schedule: Schedule, now: Date): Date | null {
	if ("every" in schedule) return null;
	for (let back = 0; back < 8; back++) {
		const d = new Date(now);
		d.setDate(d.getDate() - back);
		d.setHours(schedule.at[0], schedule.at[1], 0, 0);
		if (d > now) continue;
		if (!schedule.days || schedule.days.has(d.getDay())) return d;
	}
	return null;
}

export function isDue(automation: Pick<Automation, "schedule" | "last_run_at" | "created_at">, now = new Date()): boolean {
	const schedule = parseSchedule(automation.schedule);
	const last = automation.last_run_at ? new Date(automation.last_run_at) : null;
	if ("every" in schedule) return !last || now.getTime() - last.getTime() >= schedule.every;
	const slot = lastSlot(schedule, now);
	if (!slot || now.getTime() - slot.getTime() > CATCH_UP_MS) return false;
	return !last || last < slot;
}

export function nextRun(automation: Pick<Automation, "schedule" | "last_run_at">, now = new Date()): string | null {
	const schedule = parseSchedule(automation.schedule);
	if ("every" in schedule) {
		const last = automation.last_run_at ? new Date(automation.last_run_at).getTime() : now.getTime();
		return new Date(Math.max(now.getTime(), last + schedule.every)).toISOString();
	}
	for (let ahead = 0; ahead < 8; ahead++) {
		const d = new Date(now);
		d.setDate(d.getDate() + ahead);
		d.setHours(schedule.at[0], schedule.at[1], 0, 0);
		if (d > now && (!schedule.days || schedule.days.has(d.getDay()))) return d.toISOString();
	}
	return null;
}

const BRIEF = `Prepare my morning brief for today (unattended).

1. gaam_context. Look at goals (including company/SFPM goals), in-progress work, due dates, open asks, nudges, my memories.
2. If repositories or Jira are configured, glance at git_activity (since "yesterday") and jira_search "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC".
3. Write the brief in Persian, max ~15 lines:
   - 🎯 پیشنهاد سه کار مهم امروز (با کلید تسک و یک جمله «چرا»)، sized to recent energy
   - ⚠️ چیزهایی که گیر کرده یا ددلاینش نزدیک است
   - ❓ سؤال‌هایی که منتظر جواب من است
   - 💡 یک توصیه‌ی کوتاه مربی‌گری بر اساس داده
4. If today's plan is empty, set it with day_plan (intention + those three tasks). Do not change anything else.`;

const WEEKLY = `Run my weekly review (unattended).

Use insights (7 days), goal_list, project_list, git_activity (since "7 days ago") and asks_list. Write in Persian:
- آنچه تحویل شد و پیشرفت هر هدف (به‌خصوص اهداف شرکت/SFPM)
- درصد هم‌راستایی، نسبت تخمین، انرژی در برابر خروجی
- یک نقطه‌ی قوت، یک الگوی بازدارنده (با شواهد عددی)، یک آزمایش برای هفته‌ی بعد
- سه خروجی پیشنهادی برای هفته‌ی بعد
Save durable patterns with memory_save and write the review with journal_add (kind review). Do not delete or drop anything; propose instead.`;

const EVIDENCE = `Collect evidence for my goals (unattended), especially company performance goals (source SFPM).

For each active goal: goal_list, then look at tasks finished this week in its projects (task_list status done), git_activity (since "7 days ago"), jira_search "assignee = currentUser() AND resolved >= -7d" if Jira is configured, and the journal. For each concrete achievement not already recorded, add ONE journal_add entry (kind win, goal = that goal's id) written as a review-ready bullet in Persian: what I did, the impact, and a link/key. If a goal had no progress this week, add an ask_user question about it. End with a short summary per goal.`;

const TRIAGE = `Triage my inbox (unattended). task_list project "inbox". For each item: if it clearly belongs to an existing project, move it there (task_update project) and score it; if it is a tiny one-off, leave it; if it is vague, add a comment suggesting a sharper title. Never drop or delete. Summarise in Persian.`;

const SHUTDOWN = `Close my day (unattended). day_get for today and git_activity (since "today 00:00"). Summarise in Persian what got done vs planned and focus time. Do not change task statuses. If there is a clear lesson or blocker, record it with journal_add. Ask me one reflection question with ask_user.`;

export const DEFAULT_AUTOMATIONS: AutomationInput[] = [
	{ slug: "morning-brief", name: "بریف صبحگاهی", schedule: "weekdays 09:00", kind: "agent", prompt: BRIEF, enabled: true },
	{ slug: "jira-sync", name: "همگام‌سازی وضعیت جیرا", schedule: "every 30m", kind: "jira_pull", enabled: true },
	{ slug: "git-sync", name: "لینک کامیت‌ها و MRها به تسک‌ها", schedule: "every 60m", kind: "git_sync", enabled: true },
	{ slug: "goal-evidence", name: "جمع‌آوری شواهد اهداف (SFPM)", schedule: "weekly wed 16:00", kind: "agent", prompt: EVIDENCE, enabled: true },
	{ slug: "weekly-review", name: "مرور هفتگی و کوچینگ", schedule: "weekly wed 17:00", kind: "agent", prompt: WEEKLY, enabled: true },
	{ slug: "inbox-triage", name: "تریاژ صندوق ورودی", schedule: "daily 21:00", kind: "agent", prompt: TRIAGE, enabled: false },
	{ slug: "day-shutdown", name: "جمع‌بندی پایان روز", schedule: "weekdays 18:30", kind: "agent", prompt: SHUTDOWN, enabled: false },
];

/** Runs due automations once a minute while the Gaam server is up. */
export class Scheduler {
	readonly assistant: Assistant;
	private busy = new Set<number>();
	private timer: NodeJS.Timeout | null = null;

	constructor(assistant: Assistant) {
		this.assistant = assistant;
		const store = assistant.store;
		const known = new Set(store.automations().map((a) => a.slug));
		for (const def of DEFAULT_AUTOMATIONS) if (!known.has(def.slug!)) store.saveAutomation(def);
	}

	start() {
		this.timer = setInterval(() => void this.tick(), 60e3);
		setTimeout(() => void this.tick(), 5e3);
		return this;
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
	}

	list() {
		return this.assistant.store.automations().map((a) => {
			let next: string | null = null;
			let invalid: string | null = null;
			try {
				next = a.enabled ? nextRun(a) : null;
			} catch (error) {
				invalid = (error as Error).message;
			}
			return { ...a, running: this.busy.has(a.id), next_run_at: next, invalid };
		});
	}

	save(input: Partial<AutomationInput> & { id?: number }) {
		if (input.schedule) parseSchedule(input.schedule);
		return this.assistant.store.saveAutomation(input);
	}

	async tick() {
		for (const a of this.assistant.store.automations()) {
			if (!a.enabled || this.busy.has(a.id)) continue;
			if (a.kind === "jira_pull" && !jiraConfigured()) continue;
			try {
				if (isDue(a)) await this.run(a.id);
			} catch {}
		}
	}

	async run(id: number): Promise<string> {
		const store = this.assistant.store;
		const a = store.automation(id);
		if (this.busy.has(id)) throw new GaamError("CONFLICT", `${a.name} is already running.`);
		this.busy.add(id);
		store.markAutomation(id, { last_run_at: new Date().toISOString(), last_status: "running" });
		const actor = `automation:${a.slug ?? a.id}`;
		const planner = new Planner(store.db, actor);
		try {
			let output: string;
			if (a.kind === "jira_pull") {
				const board = savedBoard(planner);
				const synced = board ? await jiraBoardSync(planner, board) : null;
				const r = await jiraPull(planner);
				output = [
					synced && `برد ${synced.board}: ${synced.issues} ایشو، ${synced.created.length} جدید، ${synced.moved.length} جابه‌جایی ستون.`,
					...(synced?.moved ?? []),
					`${r.checked} تسک لینک‌شده‌ی دیگر بررسی شد، ${r.changes.length} تغییر وضعیت.`,
					...r.changes.map((c) => `${c.task}: ${c.from} → ${c.to}`),
				]
					.filter(Boolean)
					.join("\n");
			} else if (a.kind === "git_sync") {
				const r = await gitSync(planner);
				output = `${r.commits_scanned} کامیت و ${r.reviews_scanned} MR بررسی شد، ${r.linked.length} لینک جدید.`;
			} else {
				const { thread, done } = await this.assistant.send({
					thread: null,
					text: a.prompt ?? "",
					provider: a.provider,
					model: a.model,
					origin: "automation",
					title: `⚙️ ${a.name}`,
				});
				store.markAutomation(id, { thread_id: thread });
				output = await done;
			}
			store.markAutomation(id, { last_status: "ok", last_output: output.slice(0, 4000) });
			store.log(actor, "automation.ran", `${a.name}: ${output.replace(/\s+/g, " ").slice(0, 120)}`, a.thread_id);
			return output;
		} catch (error) {
			const message = (error as Error).message;
			store.markAutomation(id, { last_status: "error", last_output: message.slice(0, 4000) });
			store.log(actor, "automation.failed", `${a.name}: ${message.slice(0, 120)}`, a.thread_id);
			throw error;
		} finally {
			this.busy.delete(id);
		}
	}
}
