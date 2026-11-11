import { localDay, type Planner } from "../domain/planner.ts";
import { gitActivity } from "./git.ts";

const DAYS = 14;

/**
 * One view across every workspace: how much moved where, in tasks, focus and
 * commits. Backs the "همه" overview page and the weekly review across work and life.
 */
export async function overview(p: Planner) {
	const all = p.in(null);
	const workspaces = all.listWorkspaces();
	const from = new Date();
	from.setDate(from.getDate() - (DAYS - 1));
	const fromDay = localDay(from);
	const fromIso = new Date(`${fromDay}T00:00:00`).toISOString();
	const days = Array.from({ length: DAYS }, (_, i) => {
		const d = new Date(from);
		d.setDate(d.getDate() + i);
		return localDay(d);
	});

	const result = [];
	for (const w of workspaces) {
		const scoped = all.in(w.id);
		const done = scoped.db
			.prepare("select done_at from tasks where done_at >= ? and workspace_id = ?")
			.all(fromIso, w.id) as { done_at: string }[];
		const commits = await gitActivity(scoped, { since: `${fromDay} 00:00` }).catch(() => []);
		const perDay = days.map((day) => ({
			day,
			done: done.filter((d) => localDay(new Date(d.done_at)) === day).length,
			commits: commits.filter((c) => localDay(new Date(c.date)) === day).length,
		}));
		const repos = new Map<string, number>();
		for (const c of commits) repos.set(c.repo, (repos.get(c.repo) ?? 0) + 1);
		result.push({
			...w,
			series: perDay,
			commits: commits.length,
			repos_active: [...repos.entries()].sort((a, b) => b[1] - a[1]).map(([repo, n]) => ({ repo, commits: n })),
			in_progress: scoped.listTasks({ status: ["doing", "blocked"], limit: 6 }).map((t) => ({ key: t.key, title: t.title, status: t.status, column: t.external_status })),
			projects_list: scoped.listProjects(["idea", "discovery", "scoping", "ready", "active"]).map((pr) => ({ key: pr.key, title: pr.title, stage: pr.stage, tasks: pr.tasks, done: pr.done })),
		});
	}
	return { days, workspaces: result };
}
