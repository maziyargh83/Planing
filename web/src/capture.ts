/**
 * Smart capture: turns one line of casual Persian/English into the right thing
 * in Gaam — a task, follow-up, meeting, lesson, decision, memory or idea —
 * with dates, priority, tags, project and people pulled out of the text.
 */

export type Intent = "task" | "followup_mine" | "followup_theirs" | "meeting" | "lesson" | "win" | "decision" | "memory" | "idea";

export interface Person {
	id: number;
	name: string;
	relation: string;
}

export interface Capture {
	intent: Intent;
	text: string;
	due: string | null;
	dueLabel: string | null;
	priority: number | null;
	tags: string[];
	project: string | null;
	person: Person | null;
	template: "one_on_one_report" | "one_on_one_manager" | "retro" | "meeting" | null;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const toLatinDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

const iso = (d: Date) => d.toLocaleDateString("en-CA");
const addDays = (n: number) => iso(new Date(Date.now() + n * 864e5));

/** JS getDay() numbers for Persian and English weekday names. */
const WEEKDAYS: [RegExp, number][] = [
	[/(^|\s)(شنبه|sat(urday)?)(?=\s|$)/i, 6],
	[/(^|\s)(یکشنبه|یک‌شنبه|sun(day)?)(?=\s|$)/i, 0],
	[/(^|\s)(دوشنبه|mon(day)?)(?=\s|$)/i, 1],
	[/(^|\s)(سه‌شنبه|سه شنبه|سشنبه|tue(sday)?)(?=\s|$)/i, 2],
	[/(^|\s)(چهارشنبه|wed(nesday)?)(?=\s|$)/i, 3],
	[/(^|\s)(پنجشنبه|پنج‌شنبه|thu(rsday)?)(?=\s|$)/i, 4],
	[/(^|\s)(جمعه|fri(day)?)(?=\s|$)/i, 5],
];
const WEEKDAY_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

function takeDate(text: string): { text: string; due: string | null; label: string | null } {
	const rules: [RegExp, () => [string, string]][] = [
		[/(^|\s)(?:تا\s+)?(پس‌فردا|پس فردا|پسفردا)(?=\s|$)/, () => [addDays(2), "پس‌فردا"]],
		[/(^|\s)(?:تا\s+)?(فردا|tomorrow)(?=\s|$)/i, () => [addDays(1), "فردا"]],
		[/(^|\s)(?:تا\s+)?(امروز|today)(?=\s|$)/i, () => [addDays(0), "امروز"]],
		[/(^|\s)(?:تا\s+)?(هفته‌ی بعد|هفته بعد|هفته‌ بعد|next week)(?=\s|$)/i, () => [addDays(7), "هفته‌ی بعد"]],
	];
	for (const [re, fn] of rules) if (re.test(text)) {
		const [due, label] = fn();
		return { text: text.replace(re, " "), due, label };
	}
	const isoMatch = toLatinDigits(text).match(/(^|\s)(?:تا\s+)?(\d{4}-\d{2}-\d{2})(?=\s|$)/);
	if (isoMatch) return { text: text.replace(isoMatch[0], " "), due: isoMatch[2]!, label: isoMatch[2]! };
	for (const [re, day] of WEEKDAYS) {
		const withTa = new RegExp(`(^|\\s)(?:تا\\s+)?${re.source.replace("(^|\\s)", "")}`, "i");
		const m = text.match(withTa);
		if (!m) continue;
		const d = new Date();
		do d.setDate(d.getDate() + 1);
		while (d.getDay() !== day);
		return { text: text.replace(m[0], " "), due: iso(d), label: WEEKDAY_FA[day]! };
	}
	return { text, due: null, label: null };
}

/** Consonant skeleton, so «شقایق» matches "Shaghayegh" and «شایان» matches "Shayan". */
export function skeleton(s: string): string {
	const FA: Record<string, string> = {
		ش: "S", ق: "G", غ: "G", خ: "K", چ: "C", ژ: "Z", ج: "j", س: "s", ص: "s", ث: "s", ز: "z", ذ: "z", ض: "z", ظ: "z",
		ت: "t", ط: "t", د: "d", ر: "r", ل: "l", م: "m", ن: "n", ب: "b", پ: "p", ف: "f", ک: "k", ك: "k", گ: "g", ه: "h", ح: "h", و: "v",
	};
	if (/[؀-ۿ]/.test(s)) return [...s].map((c) => FA[c] ?? "").join("");
	return s
		.toLowerCase()
		.replace(/sh/g, "S")
		.replace(/gh|q/g, "G")
		.replace(/kh/g, "K")
		.replace(/ch/g, "C")
		.replace(/zh/g, "Z")
		.replace(/w/g, "v")
		.replace(/c/g, "k")
		.replace(/[^a-zA-Z]/g, "")
		.replace(/[aeiouy]/g, "");
}

export function findPerson(name: string, people: Person[]): Person | null {
	const q = name.trim().toLowerCase();
	if (!q) return null;
	const direct = people.find((p) => p.name.toLowerCase() === q || p.name.toLowerCase().split(" ")[0] === q);
	if (direct) return direct;
	const sk = skeleton(q.split(/\s+/)[0]!);
	if (sk.length < 2) return null;
	const candidates = people.filter((p) => skeleton(p.name.split(" ")[0]!) === sk);
	if (candidates.length) return candidates.sort((a, b) => Number(b.relation === "report") - Number(a.relation === "report"))[0]!;
	return people.find((p) => skeleton(p.name.split(" ")[0]!).startsWith(sk)) ?? null;
}

const PREFIXES: [RegExp, Intent][] = [
	[/^(درس|lesson)\s*[:：]\s*/i, "lesson"],
	[/^(برد|win|موفقیت)\s*[:：]\s*/i, "win"],
	[/^(تصمیم|decision)\s*[:：]\s*/i, "decision"],
	[/^(یادت باشه|یادت بمونه|حافظه|remember)\s*[:：]\s*/i, "memory"],
	[/^(ایده|پروژه|idea)\s*[:：]\s*/i, "idea"],
	[/^(منتظرم|منتظر|waiting)\s*/i, "followup_theirs"],
	[/^(پیگیری|قول|follow ?up)\s*/i, "followup_mine"],
	[/^(تسک|task|todo)\s*[:：]\s*/i, "task"],
];

export function parseCapture(raw: string, people: Person[]): Capture {
	let text = raw.trim();
	let intent: Intent = "task";
	for (const [re, kind] of PREFIXES)
		if (re.test(text)) {
			intent = kind;
			text = text.replace(re, "");
			break;
		}

	let template: Capture["template"] = null;
	if (intent === "task") {
		if (/(^|\s)(رترو|retro)(?=\s|$)/i.test(text)) {
			intent = "meeting";
			template = "retro";
		} else if (/(^|\s)(۱:۱|1:1|1on1|وان.?آن.?وان|one.on.one)(?=\s|$)/i.test(text)) {
			intent = "meeting";
			template = "one_on_one_report";
		} else if (/^(جلسه|meeting|سینک|sync)(?=\s|$)/i.test(text)) {
			intent = "meeting";
			template = "meeting";
		}
	}

	const tags = [...text.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]!);
	text = text.replace(/#[\p{L}\p{N}_-]+/gu, " ");

	let priority: number | null = null;
	const p = toLatinDigits(text).match(/(^|\s)!p?([0-3])(?=\s|$)/i);
	if (p) {
		priority = Number(p[2]);
		text = text.replace(/(^|\s)!p?[0-3۰-۳](?=\s|$)/i, " ");
	} else if (/(^|\s)(فوری|urgent|!!)(?=\s|$)/i.test(text)) {
		priority = 0;
		text = text.replace(/(^|\s)(فوری|urgent|!!)(?=\s|$)/i, " ");
	}

	let project: string | null = null;
	const pm = text.match(/(^|\s)@([A-Za-z][A-Za-z0-9]{1,9})(?=\s|$)/);
	if (pm) {
		project = pm[2]!.toUpperCase();
		text = text.replace(pm[0], " ");
	}

	const date = takeDate(text);
	text = date.text;

	let person: Person | null = null;
	const withMatch = text.match(/(?:^|\s)(?:با|از|به|with|from|to)\s+([\p{L}]+(?:\s+[\p{L}]+)?)/u);
	if (withMatch) {
		const words = withMatch[1]!.split(/\s+/);
		person = findPerson(words.join(" "), people) ?? findPerson(words[0]!, people);
		if (person) {
			const used = findPerson(words.join(" "), people) ? withMatch[0] : withMatch[0].replace(/\s+[\p{L}]+$/u, "");
			text = text.replace(used, " ");
		}
	}
	if (template === "one_on_one_report" && person?.relation === "manager") template = "one_on_one_manager";

	text = text.replace(/^\s*[:：،,-]\s*/, "").replace(/\s{2,}/g, " ").trim();
	return { intent, text, due: date.due, dueLabel: date.label, priority, tags, project, person, template };
}

export const INTENT_FA: Record<Intent, string> = {
	task: "📝 تسک",
	followup_mine: "↗ پیگیری (قول من)",
	followup_theirs: "↙ منتظرم از…",
	meeting: "🗓 جلسه",
	lesson: "📚 درس در ژورنال",
	win: "🏆 برد در ژورنال",
	decision: "⚖️ تصمیم",
	memory: "🧠 حافظه",
	idea: "💡 ایده‌ی پروژه",
};
