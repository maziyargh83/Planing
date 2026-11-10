/** How each Gaam tool shows up in the chat: icon, Persian label, and a one-line summary of its input. */

type Input = Record<string, unknown> | undefined;
const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const fa = (x: number) => x.toLocaleString("fa-IR");
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

const META: Record<string, [string, string, (i: Input) => string]> = {
	gaam_context: ["🧭", "خواندن وضعیت کلی", () => ""],
	gaam_guide: ["📘", "خواندن راهنمای گام", () => ""],
	search: ["🔎", "جستجو", (i) => `«${str(i?.query)}»`],
	insights: ["📈", "بینش‌ها", (i) => (i?.days ? `${fa(Number(i.days))} روز` : "")],
	activity: ["⚡", "لاگ فعالیت", () => ""],
	workspace_list: ["🗂", "ورک‌اسپیس‌ها", () => ""],
	workspace_use: ["🗂", "تغییر ورک‌اسپیس", (i) => str(i?.workspace)],
	workspace_save: ["🗂", "ذخیره‌ی ورک‌اسپیس", (i) => str(i?.name)],
	goal_list: ["🎯", "اهداف", () => ""],
	goal_save: ["🎯", "ذخیره‌ی هدف", (i) => str(i?.title) || `#${str(i?.id)}`],
	goal_evidence: ["🏅", "شواهد هدف", (i) => `#${str(i?.goal)}`],
	project_list: ["🧩", "پروژه‌ها", () => ""],
	project_get: ["🧩", "خواندن پروژه", (i) => str(i?.project)],
	project_save: ["🧩", "ذخیره‌ی پروژه", (i) => str(i?.title) || str(i?.project)],
	task_list: ["📋", "لیست تسک‌ها", (i) => [str(i?.project), Array.isArray(i?.status) ? (i!.status as string[]).join("، ") : ""].filter(Boolean).join(" · ")],
	task_get: ["📋", "خواندن تسک", (i) => str(i?.task)],
	task_create: ["➕", "ساخت تسک", (i) => `${fa(n(i?.tasks))} تسک${i?.project ? ` در ${str(i.project)}` : ""}`],
	task_update: ["✏️", "به‌روزرسانی تسک", (i) => `${fa(n(i?.updates))} تسک`],
	task_score: ["🎯", "امتیاز ICE", (i) => `${fa(n(i?.scores))} تسک`],
	scope_set: ["📐", "تعیین اسکوپ", (i) => `داخل ${fa(n(i?.in))} · بعداً ${fa(n(i?.later))} · خارج ${fa(n(i?.out))}`],
	task_delete: ["🗑", "حذف تسک", (i) => str(i?.task)],
	task_link: ["🔗", "لینک به تسک", (i) => `${str(i?.task)} ↔ ${str(i?.ref)}`],
	task_branch: ["⎇", "اسم برنچ", (i) => str(i?.task)],
	mindmap_get: ["🧠", "نقشه ذهنی", (i) => str(i?.project)],
	mindmap_add: ["🧠", "رشد نقشه ذهنی", (i) => `${str(i?.project)} · ${fa(n(i?.nodes))} شاخه`],
	mindmap_edit: ["🧠", "ویرایش نقشه ذهنی", (i) => `#${str(i?.node)} ${str(i?.action)}`],
	ask_user: ["❓", "سؤال از تو", (i) => `${fa(n(i?.asks))} سؤال`],
	asks_list: ["❓", "سؤال‌ها", () => ""],
	comment_add: ["💬", "کامنت", (i) => `${str(i?.entity)} ${str(i?.ref)}`],
	comment_list: ["💬", "کامنت‌ها", (i) => `${str(i?.entity)} ${str(i?.ref)}`],
	day_get: ["☀️", "خواندن امروز", (i) => str(i?.day)],
	day_plan: ["☀️", "برنامه‌ی روز", (i) => (n(i?.top) ? `${fa(n(i?.top))} کار مهم` : str(i?.intention))],
	journal_add: ["📓", "ژورنال", (i) => str(i?.kind)],
	focus: ["⏱", "تمرکز", (i) => str(i?.action)],
	memory_list: ["🧠", "حافظه", () => ""],
	memory_save: ["🧠", "به خاطر سپردن", (i) => str(i?.fact).slice(0, 60)],
	memory_forget: ["🧽", "فراموش کردن", (i) => `#${str(i?.id)}`],
	growth_overview: ["🌱", "وضعیت رشد و SFPM", () => ""],
	people_list: ["🤝", "آدم‌ها", () => ""],
	person_get: ["🤝", "خواندن آدم", (i) => str(i?.person)],
	person_save: ["🤝", "ذخیره‌ی آدم", (i) => str(i?.name)],
	interaction_log: ["☕", "ثبت تعامل", (i) => `${str(i?.person)} · ${str(i?.kind)}`],
	decision_list: ["⚖️", "تصمیم‌ها", () => ""],
	decision_save: ["⚖️", "ثبت تصمیم", (i) => str(i?.title)],
	standup_context: ["🗣", "جمع‌کردن داده‌ی استندآپ", () => "جیرا · گیت · تاریخچه"],
	standup_save: ["🗣", "ذخیره‌ی استندآپ", () => ""],
	standup_get: ["🗣", "خواندن استندآپ", () => ""],
	team_status: ["👩‍💻", "وضعیت تیم", () => ""],
	followup_list: ["↩", "پیگیری‌ها", () => ""],
	followup_save: ["↩", "ثبت پیگیری", (i) => str(i?.text).slice(0, 60)],
	doc_list: ["📚", "اسناد", (i) => str(i?.kind)],
	doc_get: ["📚", "خواندن سند", (i) => `#${str(i?.id)}`],
	doc_save: ["📚", "ذخیره‌ی سند", (i) => str(i?.title)],
	doc_delete: ["🗑", "حذف سند", (i) => `#${str(i?.id)}`],
	jira_search: ["🔷", "جستجوی جیرا", (i) => str(i?.jql).slice(0, 60)],
	jira_board: ["🔷", "برد جیرا", (i) => (i?.sync ? "همگام‌سازی" : "")],
	jira_board_configure: ["🔷", "تنظیم برد جیرا", (i) => `#${str(i?.board)}`],
	jira_pull: ["🔷", "خواندن وضعیت از جیرا", () => ""],
	jira_import: ["🔷", "وارد کردن از جیرا", (i) => str(i?.jql).slice(0, 60)],
	git_activity: ["⎇", "کامیت‌ها", (i) => str(i?.since)],
	git_reviews: ["⎇", "MRها و PRها", () => ""],
	git_sync: ["⎇", "لینک کامیت‌ها", () => ""],
};

export function toolMeta(name: string, input?: unknown) {
	const m = META[name];
	if (!m) return { icon: "🛠", label: name, summary: "" };
	let summary = "";
	try {
		summary = m[2](input as Input);
	} catch {}
	return { icon: m[0], label: m[1], summary };
}

/** Task keys mentioned in a tool's output, so the card can link to what it touched. */
export function keysIn(value: unknown): string[] {
	const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
	return [...new Set(text.match(/"key":\s*"([A-Z][A-Z0-9]{0,9}-\d+)"/g)?.map((m) => m.split('"')[3]!) ?? [])].slice(0, 12);
}
