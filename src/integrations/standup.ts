import { Growth } from "../core/growth.ts";
import { localDay, type Planner } from "../core/planner.ts";
import { gitActivity, openReviews } from "./git.ts";
import { jiraConfigured, jiraTeamIssues, savedBoard } from "./jira.ts";

const KEY = /\b[A-Z][A-Z0-9]{0,9}-\d+\b/g;
const SLOW_COLUMNS = /review|qa|qc|test/i;

function previousWorkday(day: string): string {
	const d = new Date(`${day}T12:00:00`);
	do d.setDate(d.getDate() - 1);
	while ([4, 5].includes(d.getDay()));
	return localDay(d);
}

const daysSince = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null);

/** What each person the user leads is working on, and where they may need help. */
export async function teamStatus(p: Planner) {
	const growth = new Growth(p);
	const team = growth.people({ relation: "report" });
	const board = savedBoard(p);
	const out = [];
	for (const person of team) {
		const followups = growth.followups({ status: "open", person: person.id });
		if (!person.jira_user || !jiraConfigured()) {
			out.push({ person: person.name, jira_user: person.jira_user, issues: [], flags: [], followups, note: "jira_user not set" });
			continue;
		}
		const issues = (await jiraTeamIssues(person.jira_user, board?.board).catch(() => [])).map((i) => ({
			...i,
			days_in_status: daysSince(i.status_since ?? i.updated),
			days_idle: daysSince(i.updated),
		}));
		const flags: string[] = [];
		for (const i of issues) {
			if (/block|pend/i.test(i.status)) flags.push(`${i.key} blocked (${i.status})`);
			else if (SLOW_COLUMNS.test(i.status) && (i.days_in_status ?? 0) >= 2) flags.push(`${i.key} ${i.days_in_status}d in ${i.status}`);
			else if (i.category === "indeterminate" && (i.days_idle ?? 0) >= 3) flags.push(`${i.key} no update for ${i.days_idle}d`);
			if (i.due && i.due < localDay() && i.category !== "done") flags.push(`${i.key} past due ${i.due}`);
		}
		out.push({ person: person.name, jira_user: person.jira_user, issues, flags, followups, last_contact_days: person.days_since });
	}
	return out;
}

/**
 * Everything needed to write an honest, precise stand-up: what was promised
 * last time, what actually moved (Jira, git, Gaam), what is stuck, the team,
 * and open follow-ups.
 */
export async function standupContext(p: Planner, day = localDay()) {
	const growth = new Growth(p);
	const previous = p.one<Record<string, string | null>>("select * from standups where day < ? order by day desc limit 1", day) ?? null;
	const since = previous?.day ?? previousWorkday(day);
	const sinceIso = new Date(`${since}T00:00:00`).toISOString();

	const promisedKeys = [...new Set(`${previous?.next ?? ""}`.match(KEY) ?? [])];
	const promised = promisedKeys.map((key): { key: string; title: string | null; status: string; column: string | null } => {
		try {
			const t = p.resolveTask(key);
			return { key, title: t.title, status: t.status, column: t.external_status };
		} catch {
			return { key, title: null, status: "unknown", column: null };
		}
	});

	const finished = p.listTasks({ status: ["done"], order: "updated", limit: 50 }).filter((t) => t.done_at && t.done_at >= sinceIso);
	const moved = p
		.listTasks({ order: "updated", limit: 200 })
		.filter((t) => t.external_since && t.external_since >= sinceIso && t.status !== "done")
		.map((t) => ({ key: t.key, title: t.title, column: t.external_status }));
	const inProgress = p.listTasks({ status: ["doing", "blocked"], limit: 30 }).map((t) => ({
		key: t.key,
		title: t.title,
		status: t.status,
		column: t.external_status,
		days_in_column: daysSince(t.external_since),
	}));

	const [commits, reviews, team] = await Promise.all([
		gitActivity(p, { since: `${since} 00:00` }).catch(() => []),
		openReviews().catch(() => []),
		teamStatus(p).catch(() => []),
	]);

	return {
		day,
		since,
		previous_standup: previous,
		promised_last_time: promised,
		finished_since: finished.map((t) => ({ key: t.key, title: t.title })),
		moved_on_board: moved,
		in_progress: inProgress,
		commits: commits.slice(0, 30).map((c) => ({ repo: c.repo, sha: c.sha, subject: c.subject, keys: c.keys })),
		open_reviews: reviews.map((r) => ({ ref: r.ref, title: r.title, state: r.state, days_open: daysSince(r.updated) })),
		today_plan: p.day(day).top.map((t) => ({ key: t.key, title: t.title })),
		followups: {
			mine_due: growth.followups({ status: "open", direction: "mine" }).filter((f) => !f.due || f.due <= day),
			waiting_on_others: growth.followups({ status: "open", direction: "theirs" }),
		},
		team,
		recent_standups: growth.standups(5),
		format_rules: [
			"Each field is one or two lines. Outcomes, not activity: 'CND-674 merged', not 'worked on back button'.",
			"Use Jira keys. Say the column if it matters (in Code Review since 3 days).",
			"Compare with what was promised last time; if something slipped, say so and why in a few words.",
			"Blocker: what, who can unblock, since when. Help: the exact decision or help needed, from whom, by when.",
			"Team: one line per person only when someone is stuck, blocked or needs a decision.",
		],
	};
}
