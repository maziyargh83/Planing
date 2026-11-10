/**
 * Guided creation flows. Each one is a short dialog that explains itself and
 * offers the likely answers, so nobody has to know Gaam's data model.
 */
import { rpc, toast } from "./api.ts";
import { ask } from "./kit.tsx";

export async function newGoal() {
	const a = await ask({
		title: "هدف تازه",
		description: "یک نتیجه، نه یک کار. مثلاً «سرچ سریع‌تر و دقیق‌تر» یا «هر هفته یک پست».",
		confirm: "بساز",
		fields: [
			{ name: "title", label: "هدف", required: true, placeholder: "به چه چیزی می‌خواهی برسی؟" },
			{ name: "why", label: "چرا برایت مهم است؟", type: "textarea", placeholder: "اختیاری، ولی روزهای خستگی کمک می‌کند" },
			{
				name: "horizon",
				label: "تا کِی؟",
				type: "pills",
				value: "quarter",
				options: [
					{ value: "week", label: "این هفته" },
					{ value: "month", label: "این ماه" },
					{ value: "quarter", label: "این فصل" },
					{ value: "year", label: "امسال" },
				],
			},
			{ name: "metric", label: "از کجا بفهمم رسیدم؟", placeholder: "مثلاً «conversion سرچ» یا «تعداد پست»", hint: "اختیاری. اگر عددی است، پایین هدفش را بنویس." },
			{ name: "target", label: "عدد هدف", type: "number", placeholder: "مثلاً ۲۴" },
		],
	});
	if (!a) return null;
	const goal = await rpc("createGoal", {
		title: a.title,
		why: a.why || null,
		horizon: a.horizon,
		metric: a.metric || null,
		target: a.target ? Number(a.target) : null,
		current: a.target ? 0 : null,
	});
	toast("هدف روی افق نشست 🏔", "win");
	return goal;
}

const RELATIONS = [
	{ value: "report", label: "عضو تیمم" },
	{ value: "manager", label: "لید / مدیر" },
	{ value: "peer", label: "هم‌تیمی" },
	{ value: "product", label: "پروداکت" },
	{ value: "stakeholder", label: "ذی‌نفع" },
	{ value: "other", label: "دیگر" },
];

export async function newPerson() {
	const a = await ask({
		title: "آدم تازه",
		description: "کسی که می‌خواهی رابطه‌ات با او را آگاهانه نگه داری. گام یادت می‌اندازد کِی وقت یک گپ یا پیگیری است.",
		confirm: "اضافه کن",
		fields: [
			{ name: "name", label: "اسم", required: true, placeholder: "مثلاً Shaghayegh Ahmadi" },
			{ name: "relation", label: "چه نسبتی با تو دارد؟", type: "pills", value: "peer", options: RELATIONS },
			{ name: "jira", label: "یوزر جیرا", placeholder: "مثلاً shaghayegh.ahmadi", hint: "اختیاری. برای عضو تیم، وضعیت تسک‌هایش را از برد می‌خوانیم." },
			{ name: "notes", label: "یادداشت", type: "textarea", placeholder: "به چه چیزی اهمیت می‌دهد؟ چطور کمکش کنم؟" },
		],
	});
	if (!a) return null;
	const p = await rpc("savePerson", { name: a.name.trim(), relation: a.relation, jira_user: a.jira || null, notes: a.notes || null });
	toast(`${a.name} اضافه شد`, "win");
	return p;
}

export async function newFollowup(defaults: { person?: string; text?: string } = {}) {
	const a = await ask({
		title: "پیگیری تازه",
		description: "قولی که دادی یا چیزی که منتظرش هستی. سر موعد یادت می‌اندازیم و در استندآپ می‌آید.",
		confirm: "ثبت کن",
		fields: [
			{
				name: "direction",
				label: "کدام؟",
				type: "pills",
				value: "mine",
				options: [
					{ value: "mine", label: "↗ من قول دادم" },
					{ value: "theirs", label: "↙ منتظر کسی‌ام" },
				],
			},
			{ name: "text", label: "چه چیزی؟", required: true, value: defaults.text, placeholder: "مثلاً «فیدبک کدریویو را بدهم»" },
			{ name: "person", label: "با چه کسی؟", type: "person", value: defaults.person },
			{ name: "due", label: "تا کِی؟", type: "date" },
		],
	});
	if (!a) return null;
	if (a.person) await rpc("savePerson", { name: a.person });
	const f = await rpc("saveFollowup", { direction: a.direction, text: a.text, person: a.person || null, due: a.due || null });
	toast("پیگیری ثبت شد", "win");
	return f;
}

export async function newDecision() {
	const a = await ask({
		title: "یک تصمیم",
		description: "دو سؤال جواب بده تا روشن شود خودت تصمیم بگیری یا اول هماهنگ کنی.",
		confirm: "ثبت کن",
		fields: [
			{ name: "title", label: "چه چیزی را باید تصمیم بگیری؟", required: true, placeholder: "مثلاً «جدا کردن bundle سرچ از اپ اصلی»" },
			{
				name: "impact",
				label: "اگر اشتباه کنی، چقدر اثر دارد؟",
				type: "pills",
				value: "high",
				options: [
					{ value: "low", label: "کم: فقط کار خودم" },
					{ value: "high", label: "زیاد: تیم، کاربر یا زمان‌بندی" },
				],
			},
			{
				name: "reversible",
				label: "می‌شود برگرداندش؟",
				type: "pills",
				value: "1",
				options: [
					{ value: "1", label: "آره، راحت" },
					{ value: "0", label: "نه، برگشتش سخت است" },
				],
				hint: "اثر کم → خودت تصمیم بگیر · اثر زیاد + برگشت‌پذیر → تصمیم بگیر و خبر بده · اثر زیاد + برگشت‌ناپذیر → اول alignment",
			},
			{ name: "options", label: "گزینه‌ها", type: "textarea", placeholder: "اختیاری: چه راه‌هایی داری؟" },
		],
	});
	if (!a) return null;
	const d = await rpc<{ advice: string }>("saveDecision", { title: a.title, impact: a.impact, reversible: a.reversible === "1", options: a.options || null });
	toast(d.advice, "win");
	return d;
}

// ── Schedules ──────────────────────────────────────────────────────────────

import { DAY_FA, scheduleText } from "./schedule-text.ts";

export { scheduleText };

/** A guided editor that writes the schedule string for the user. */
export async function editSchedule(current: string): Promise<string | null> {
	const s = current.trim().toLowerCase();
	const every = s.match(/^every\s+(\d+)\s*(m|h)$/);
	const timed = s.match(/\s(\d{1,2}):(\d{2})$/);
	const kind = every ? "every" : s.startsWith("weekdays") ? "weekdays" : s.startsWith("daily") ? "daily" : "weekly";
	const day = s.match(/^weekly\s+([a-z]{3})/)?.[1] ?? "wed";
	const a = await ask({
		title: "کِی اجرا شود؟",
		confirm: "ذخیره",
		fields: [
			{
				name: "kind",
				label: "تکرار",
				type: "pills",
				value: kind,
				options: [
					{ value: "every", label: "هر چند وقت یک‌بار" },
					{ value: "daily", label: "هر روز" },
					{ value: "weekdays", label: "روزهای کاری" },
					{ value: "weekly", label: "هفته‌ای یک‌بار" },
				],
			},
			{ name: "time", label: "ساعت (برای روزانه و هفتگی)", value: timed ? `${timed[1]!.padStart(2, "0")}:${timed[2]}` : "09:00", placeholder: "09:00", hint: "۲۴ ساعته، مثلاً 09:00 یا 17:30" },
			{
				name: "day",
				label: "کدام روز هفته؟ (برای هفتگی)",
				type: "pills",
				value: day,
				options: Object.entries(DAY_FA).map(([value, label]) => ({ value, label })),
			},
			{
				name: "every",
				label: "فاصله (برای «هر چند وقت»)",
				type: "pills",
				value: every ? `${every[1]}${every[2]}` : "30m",
				options: [
					{ value: "15m", label: "۱۵ دقیقه" },
					{ value: "30m", label: "۳۰ دقیقه" },
					{ value: "60m", label: "یک ساعت" },
					{ value: "3h", label: "۳ ساعت" },
				],
			},
		],
	});
	if (!a) return null;
	const time = /^\d{1,2}:\d{2}$/.test(a.time.trim()) ? a.time.trim() : "09:00";
	if (a.kind === "every") return `every ${a.every}`;
	if (a.kind === "daily") return `daily ${time}`;
	if (a.kind === "weekdays") return `weekdays ${time}`;
	return `weekly ${a.day} ${time}`;
}
