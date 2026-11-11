import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import type { Planner } from "../domain/planner.ts";
import { GaamError, type Task } from "../domain/types.ts";

const run = promisify(execFile);
const KEY_PATTERN = /\b[A-Z][A-Z0-9]{0,9}-\d+\b/g;

/**
 * Repositories to watch: the active workspace's repos (all workspaces when unscoped),
 * plus projects' repo_path. GAAM_REPOS is a fallback for setups without workspaces.
 */
export function repos(p: Planner): string[] {
	const workspaces = p.workspace == null ? p.listWorkspaces() : [p.resolveWorkspace(p.workspace)];
	const fromWorkspaces = workspaces.flatMap((w) => w.repos);
	const fromProjects = (
		p.db.prepare(`select repo_path from projects where repo_path is not null${p.ws()}`).all() as { repo_path: string }[]
	).map((r) => r.repo_path);
	const fromEnv = fromWorkspaces.length ? [] : (process.env.GAAM_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
	return [...new Set([...fromWorkspaces, ...fromProjects, ...fromEnv])].filter((r) => existsSync(r));
}

/**
 * Finds git repositories under the given folders and sorts them into workspaces by
 * remote: company hosts (GITLAB_URL, git.snappfood.ir) go to the work workspace,
 * GitHub and remote-less repos go to the personal one. Existing repo lists are kept.
 */
export async function detectRepos(p: Planner, roots = [join(homedir(), "development"), join(homedir(), "Planing")]) {
	const all = p.listWorkspaces();
	const work = all.find((w) => w.kind === "work");
	const personal = all.find((w) => w.kind === "personal");
	const workHost = new URL(process.env.GITLAB_URL ?? "https://git.snappfood.ir").hostname;
	const found: { path: string; remote: string | null; workspace: string | null }[] = [];
	const candidates = roots.flatMap((root) => {
		if (!existsSync(root)) return [];
		if (existsSync(join(root, ".git"))) return [root];
		return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(root, d.name));
	});
	for (const dir of candidates) {
		if (!existsSync(join(dir, ".git"))) continue;
		const remote = await git(dir, "remote", "get-url", "origin").catch(() => null);
		const target = remote?.includes(workHost) ? work : personal;
		found.push({ path: dir, remote, workspace: target?.key ?? null });
	}
	for (const w of [work, personal]) {
		if (!w) continue;
		const mine = found.filter((f) => f.workspace === w.key).map((f) => f.path);
		p.saveWorkspace({ id: w.id, repos: [...w.repos, ...mine] });
	}
	return found;
}

async function git(repo: string, ...args: string[]) {
	const { stdout } = await run("git", ["-C", repo, ...args], { maxBuffer: 16 * 1024 * 1024 });
	return stdout.trim();
}

export interface Commit {
	repo: string;
	sha: string;
	author: string;
	date: string;
	subject: string;
	keys: string[];
}

/** Your own commits across watched repos, newest first. */
export async function gitActivity(p: Planner, opts: { since?: string; repo?: string; everyone?: boolean } = {}) {
	const targets = opts.repo ? [opts.repo] : repos(p);
	if (!targets.length)
		throw new GaamError("INTEGRATION", "No repositories to read. Set GAAM_REPOS or a project's repo_path.");
	const commits: Commit[] = [];
	for (const repo of targets) {
		const email = opts.everyone ? null : await git(repo, "config", "user.email").catch(() => null);
		const out = await git(
			repo,
			"log",
			"--all",
			"--no-merges",
			`--since=${opts.since ?? "7 days ago"}`,
			...(email ? [`--author=${email}`] : []),
			"--pretty=format:%h%x1f%an%x1f%aI%x1f%s",
		).catch(() => "");
		for (const line of out.split("\n").filter(Boolean)) {
			const [sha, author, date, subject] = line.split("\x1f") as [string, string, string, string];
			commits.push({ repo: basename(repo), sha, author, date, subject, keys: subject.match(KEY_PATTERN) ?? [] });
		}
	}
	return commits.sort((a, b) => b.date.localeCompare(a.date));
}

function taskByAnyKey(p: Planner, key: string): Task | null {
	const row = p.db.prepare("select id from tasks where key = ? collate nocase or jira_key = ? collate nocase").get(key, key) as
		| { id: number }
		| undefined;
	return row ? p.resolveTask(row.id) : null;
}

/**
 * Links commits and merge requests that mention a task key (G-12, SRCH-3) or a
 * linked Jira key (FOOD-881) to that task.
 */
export async function gitSync(p: Planner, since = "14 days ago") {
	const linked: string[] = [];
	const commits = await gitActivity(p, { since, everyone: true }).catch(() => [] as Commit[]);
	for (const c of commits)
		for (const key of c.keys) {
			const task = taskByAnyKey(p, key);
			if (!task) continue;
			p.linkTask(task.id, { kind: "commit", ref: `${c.repo}@${c.sha}`, title: c.subject });
			linked.push(`${task.key} ← ${c.repo}@${c.sha}`);
		}
	const reviews = await openReviews(p).catch(() => []);
	for (const mr of reviews)
		for (const key of `${mr.title} ${mr.branch}`.toUpperCase().match(KEY_PATTERN) ?? []) {
			const task = taskByAnyKey(p, key);
			if (!task) continue;
			p.linkTask(task.id, { kind: "mr", ref: mr.ref, url: mr.url, title: mr.title });
			linked.push(`${task.key} ← ${mr.ref}`);
		}
	return { commits_scanned: commits.length, reviews_scanned: reviews.length, linked };
}

export interface Review {
	ref: string;
	title: string;
	url: string;
	branch: string;
	state: string;
	updated: string;
	source: "gitlab" | "github";
}

/**
 * Your open merge requests (GitLab, the work workspace) and pull requests
 * (GitHub, the personal one). Scoped to the planner's workspace kind.
 */
export async function openReviews(p?: Planner): Promise<Review[]> {
	const out: Review[] = [];
	const kind = p?.workspace == null ? null : p.resolveWorkspace(p.workspace).kind;
	const gitlab = process.env.GITLAB_URL?.replace(/\/$/, "");
	if (gitlab && process.env.GITLAB_TOKEN && kind !== "personal") {
		const res = await fetch(`${gitlab}/api/v4/merge_requests?scope=created_by_me&state=opened&per_page=50`, {
			headers: { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN },
		});
		if (!res.ok) throw new GaamError("INTEGRATION", `GitLab ${res.status}: ${(await res.text()).slice(0, 300)}`);
		for (const mr of (await res.json()) as {
			references: { full: string };
			title: string;
			web_url: string;
			source_branch: string;
			state: string;
			updated_at: string;
			detailed_merge_status?: string;
		}[])
			out.push({
				ref: mr.references.full,
				title: mr.title,
				url: mr.web_url,
				branch: mr.source_branch,
				state: mr.detailed_merge_status ?? mr.state,
				updated: mr.updated_at,
				source: "gitlab",
			});
	}
	if (process.env.GITHUB_TOKEN && kind !== "work") {
		const res = await fetch("https://api.github.com/search/issues?q=is:pr+is:open+author:@me&per_page=50", {
			headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
		});
		if (!res.ok) throw new GaamError("INTEGRATION", `GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
		const data = (await res.json()) as { items: { number: number; title: string; html_url: string; updated_at: string; repository_url: string }[] };
		for (const pr of data.items)
			out.push({
				ref: `${pr.repository_url.split("/repos/")[1]}#${pr.number}`,
				title: pr.title,
				url: pr.html_url,
				branch: "",
				state: "open",
				updated: pr.updated_at,
				source: "github",
			});
	}
	return out;
}

/** A conventional branch name that carries the task key, so gitSync can find it later. */
export function branchName(task: Task, type = "feat"): string {
	const slug = task.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.split("-")
		.filter(Boolean)
		.slice(0, 6)
		.join("-");
	const key = (task.jira_key ?? task.key).toLowerCase();
	return `${type}/${key}${slug ? `-${slug}` : ""}`;
}

export function integrationStatus() {
	return {
		jira: Boolean(process.env.JIRA_URL && process.env.JIRA_TOKEN),
		gitlab: Boolean(process.env.GITLAB_URL && process.env.GITLAB_TOKEN),
		github: Boolean(process.env.GITHUB_TOKEN),
		repos: (process.env.GAAM_REPOS ?? "").split(",").filter(Boolean).length,
	};
}
