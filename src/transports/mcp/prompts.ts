import { z } from "zod";

interface Prompt {
	name: string;
	title: string;
	description: string;
	args: z.ZodRawShape;
	render: (args: Record<string, string>) => string;
}

/**
 * Reusable workflows any MCP client can start (in Claude Code they show up as
 * /mcp__gaam__<name>). Each one tells the agent which tools to use and when to
 * stop and ask the human.
 */
export const PROMPTS: Prompt[] = [
	{
		name: "idea_to_plan",
		title: "Idea → plan",
		description: "Turn a raw idea into a project: discovery mind map, open questions, scope list and prioritised tasks.",
		args: { idea: z.string().describe("The idea, in your own words") },
		render: ({ idea }) => `I have an idea: «${idea}»

Act as my product partner and turn it into a plan inside Gaam. Work in Persian.

1. Call gaam_context. Check my goals and memories; tell me which goal this serves (or that it serves none).
2. Create the project with project_save (stage "discovery", a short latin key, problem, hypothesis, success_metric). Link the goal.
3. Build a discovery mind map with mindmap_add: the user/problem, current state, questions, risks, data we need, 2–3 solution options. Be specific to my context, not generic.
4. For every unknown only I can resolve — numbers, constraints, priorities, access — create asks with ask_user (choice when possible). Do not invent data.
5. Draft the task list with task_create (each ≤ 1 day, subtasks where needed), score it with task_score, and propose scope with scope_set (in = smallest version that tests the hypothesis).
6. Move the project to "scoping" and summarise: the scope list, top 5 tasks by ICE, the asks waiting for me, and the biggest risk. Leave the summary as comment_add on the project too.`,
	},
	{
		name: "discovery",
		title: "Deepen discovery",
		description: "Push an existing project's discovery further: read answers, update the map, resolve questions.",
		args: { project: z.string().describe("Project key") },
		render: ({ project }) => `Continue discovery on project ${project}.

1. project_get ${project} and asks_list for it. Read every answered ask and fold the answers into the mind map (mindmap_edit / mindmap_add): turn answered questions into insight or decision nodes.
2. Find what is still unknown or risky. Ask me only what you truly need (ask_user), with a why.
3. If the evidence now supports it, update hypothesis/success_metric and propose new tasks or scope changes.
4. Tell me in 5 lines: what we learned, what changed, what's blocking scoping.`,
	},
	{
		name: "plan_my_day",
		title: "Plan my day",
		description: "Morning planning: check-in, pick the top three, set an intention.",
		args: { notes: z.string().optional().describe("Anything on your mind this morning") },
		render: ({ notes }) => `Help me plan today.${notes ? ` On my mind: «${notes}»` : ""}

1. gaam_context. Look at nudges, in-progress work, due dates, open asks and my memories (how I work best).
2. Ask me for a quick check-in (energy and mood 1–5) unless I already gave one today; record it with journal_add.
3. Propose at most 3 top tasks that move an active goal, sized to my energy and calendar. Say why each one. If something in progress is stale, say so.
4. After I agree, save with day_plan (intention + top). Suggest the first focus block.`,
	},
	{
		name: "close_my_day",
		title: "Close my day",
		description: "Evening shutdown: what got done, what didn't, one lesson.",
		args: {},
		render: () => `Help me close the day.

1. day_get and git_activity (since "today 00:00", if repositories are configured). Show what I finished, what I planned but didn't, and focus time.
2. Ask me what got in the way and one thing I learned. Save it with journal_add (kind lesson or blocker) and day_plan (reflection, rating).
3. Move unfinished top tasks forward honestly: keep, reschedule, split or drop.
4. If you notice a pattern across days, save it with memory_save (topic pattern).`,
	},
	{
		name: "weekly_review",
		title: "Weekly review",
		description: "Review the week against goals and coach me on how I work.",
		args: {},
		render: () => `Run my weekly review.

1. insights (7 days), goal_list, project_list, and git_activity (since "7 days ago") if available.
2. Report: what shipped, goal progress (update goal current values with goal_save if I confirm), alignment %, estimation ratio, energy vs output, streak.
3. Be a direct coach: name one thing I did well, one pattern holding me back (with evidence from the numbers), and one concrete experiment for next week. Save durable observations with memory_save.
4. Clean up: triage the inbox, drop dead tasks, check every active project still deserves to be active.
5. Propose next week's three outcomes.`,
	},
	{
		name: "break_down",
		title: "Break down a task",
		description: "Split a big or vague task into concrete subtasks with estimates.",
		args: { task: z.string().describe("Task key, e.g. SRCH-4") },
		render: ({ task }) => `Break down ${task}.

task_get ${task}. Ask me if the outcome is unclear. Then create subtasks (task_create with parent) of at most half a day each, with estimate_h and a definition of done in the description. Flag any subtask that depends on someone else. Suggest a branch name with task_branch.`,
	},
	{
		name: "performance_review",
		title: "Performance review (SFPM)",
		description: "Turn a cycle's evidence into review-ready self-assessment text per goal.",
		args: { cycle: z.string().optional().describe("Cycle, e.g. 1405-C2") },
		render: ({ cycle }) => `Prepare my self-assessment for ${cycle ? `cycle ${cycle}` : "the current cycle"}.

1. goal_list; keep goals with source SFPM${cycle ? ` and cycle ${cycle}` : ""}.
2. For each goal call goal_evidence. Also use git_activity and jira_search (resolved in the cycle) to fill gaps.
3. For each goal write, in English (the review system is English): 2–4 concrete bullets with impact and links/keys, then one honest "next" line. Flag goals with weak evidence and suggest what I can still do before the cycle ends; create tasks for those only if I agree.
4. Show it in Persian-commented form: English text to paste, with a short Persian note per goal.`,
	},
	{
		name: "meeting_prep",
		title: "Prepare a meeting",
		description: "Prepare for a meeting or 1:1: context, open follow-ups, what to raise, questions to ask.",
		args: { with: z.string().describe("Person or meeting name"), topic: z.string().optional() },
		render: (a) => `Prepare me for my meeting with ${a.with}${a.topic ? ` about ${a.topic}` : ""}.

Use person_get / people_list, followup_list for that person, doc_list (person or search) for past meeting notes and plans, team_status if they are on my team, and growth_overview for my goals. Give me, in Persian: 3 bullets of context, open follow-ups both ways, what I should raise (tie to my SFPM goals where natural), and 2–3 good questions. Save it as a meeting doc (doc_save kind meeting, day today, people [${a.with}]).`,
	},
	{
		name: "meeting_notes",
		title: "Process meeting notes",
		description: "Turn raw meeting notes into a summary, decisions, follow-ups and tasks.",
		args: { notes: z.string().describe("Paste the notes"), with: z.string().optional() },
		render: (a) => `Here are my meeting notes${a.with ? ` (with ${a.with})` : ""}:

«${a.notes}»

Save them with doc_save (kind meeting, today, people). Write a 3-line summary into the doc's summary. Record decisions with decision_save, follow-ups both ways with followup_save (with person, due and doc id), and real work as tasks with task_create. Log an interaction for each person involved. Then list what you created.`,
	},
	{
		name: "retro_prep",
		title: "Prepare a retro",
		description: "Find what really went well and badly in the last period, with evidence, so the retro is honest.",
		args: { days: z.string().optional().describe("Look-back window in days, default 14") },
		render: (a) => `Prepare me for the retro (last ${a.days ?? "14"} days), in Persian.

Use insights, recent standups (standup_get / growth_overview), decision_list, the Jira board (jira_board, team_status), git_activity and finished tasks. Then give:
- 2 things that went well, each with evidence (keys, numbers).
- At least 2 things that did not go well — specific, honest, no "everything was great". The user tends to fall into a positive-only loop; push back on that kindly.
- For one problem: the root cause (ask "why" three times) and my own part in it.
- 1–2 small, concrete action proposals with an owner and a date.
Save it as a meeting doc from the retro template (doc_save kind meeting, today, tags ["retro"]).`,
	},
	{
		name: "standup",
		title: "Stand-up notes",
		description: "Yesterday / today / blockers from Gaam, git and Jira.",
		args: {},
		render: () => `Write today's stand-up with me, in Persian, short.

1. Call standup_context. It has my last stand-up, what I promised, what moved on the Jira board, commits, open MRs, team status and follow-ups.
2. My manager's feedback: my updates were sometimes vague. So follow format_rules exactly: outcomes not activity, Jira keys, one or two lines per field, explicit ask (from whom, by when).
3. Compare with promised_last_time: if something slipped, say it plainly with the reason.
4. In "help" or a final team line, mention team members only where something needs attention (stuck in review, blocked, idle) — by name — and add any follow-up I owe.
5. Save with standup_save and show the formatted text to paste. Then give me ONE line of coaching: the vaguest phrase I would have said and the sharper version.`,
	},
];
