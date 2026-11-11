/**
 * Fills a database with a realistic example: an agent planning "better search
 * and discovery" the way it would over MCP. Run against a scratch database:
 *
 *   GAAM_DB=~/.gaam/demo.db pnpm seed
 */
import { openDb } from "../src/storage/db.ts";
import { localDay, Planner } from "../src/domain/planner.ts";

const db = openDb();
if ((db.prepare("select count(*) as n from projects").get() as { n: number }).n > 0) {
	console.error("This database already has projects; seed only an empty one (set GAAM_DB).");
	process.exit(1);
}
const me = new Planner(db, "me");
const agent = me.as("claude-code");

const goal = me.createGoal({
	title: "سرچ اسنپ‌فود را به بهترین تجربه‌ی پیدا کردن غذا تبدیل کنم",
	why: "بیشتر سفارش‌ها از سرچ شروع می‌شوند؛ هر درصد بهبود مستقیم روی سفارش اثر دارد.",
	horizon: "quarter",
	metric: "Search → order conversion %",
	current: 18,
	target: 24,
});
me.createGoal({ title: "هر هفته یک چیز جدید درباره‌ی AI agents بسازم و منتشر کنم", horizon: "quarter", metric: "posts", current: 3, target: 12 });

const srch = agent.createProject({
	title: "بهبود سرچ و دیسکاوری",
	key: "SRCH",
	goal: goal.id,
	stage: "scoping",
	problem: "کاربرها با غلط تایپی، اسم محلی غذا یا کوئری‌های مبهم به نتیجه‌ی صفر یا نامرتبط می‌رسند و از سرچ خارج می‌شوند.",
	hypothesis: "اگر zero-result را نصف کنیم و رتبه‌بندی را شخصی کنیم، conversion سرچ ۳ واحد بالا می‌رود.",
	success_metric: "zero-result rate < 4٪ و search→order از ۱۸٪ به ۲۱٪",
});

agent.addNodes("SRCH", [
	{
		text: "کاربر چرا سرچ را رها می‌کند؟",
		kind: "question",
		children: [
			{ text: "نتیجه‌ی صفر برای غلط تایپی (پیتزا/پیتza)", kind: "insight" },
			{ text: "سهم کوئری‌های zero-result از کل سرچ؟", kind: "data" },
			{ text: "نتایج دور یا بسته رتبه‌ی بالا دارند", kind: "risk" },
		],
	},
	{
		text: "راه‌حل‌ها",
		kind: "option",
		children: [
			{ text: "Typo tolerance + transliteration فینگلیش", kind: "option" },
			{ text: "دیکشنری مترادف غذاها (ساندویچ ↔ ساندیس)", kind: "option" },
			{ text: "رتبه‌بندی شخصی براساس سفارش‌های قبلی", kind: "option", children: [{ text: "ریسک cold-start کاربران جدید", kind: "risk" }] },
			{ text: "دیسکاوری: «چی بخورم؟» با چند سؤال سریع", kind: "idea" },
		],
	},
	{
		text: "اندازه‌گیری",
		kind: "data",
		children: [
			{ text: "داشبورد zero-result و CTR هر پوزیشن", kind: "data" },
			{ text: "A/B روی ۱۰٪ ترافیک تهران", kind: "decision" },
		],
	},
]);

const tasks = agent.createTasks("SRCH", [
	{
		title: "لاگ کردن کوئری‌های zero-result",
		estimate_h: 6,
		subtasks: [
			{ title: "ایونت search_zero_result در فرانت", estimate_h: 2 },
			{ title: "داشبورد Grafana برای zero-result", estimate_h: 3 },
		],
	},
	{ title: "Typo tolerance در موتور جستجو", estimate_h: 8 },
	{ title: "Transliteration فینگلیش → فارسی", estimate_h: 5 },
	{ title: "دیکشنری مترادف ۲۰۰ غذای پرتکرار", estimate_h: 4 },
	{ title: "رتبه‌بندی شخصی (v1 قانون‌محور)", estimate_h: 16 },
	{ title: "ویجت «چی بخورم؟» در صفحه‌ی خانه", estimate_h: 12 },
	{ title: "طراحی A/B test و معیار توقف", estimate_h: 3 },
]);
const key = (title: string) => tasks.find((t) => t.title.startsWith(title))!.key;

for (const [t, i, c, e, p] of [
	["لاگ کردن", 9, 9, 8, 1],
	["Typo", 8, 7, 6, 1],
	["Transliteration", 7, 6, 7, 2],
	["دیکشنری", 6, 7, 8, 2],
	["رتبه‌بندی", 9, 4, 3, 2],
	["ویجت", 6, 3, 4, 3],
	["طراحی A/B", 7, 8, 9, 1],
] as const)
	agent.updateTask(key(t), { impact: i, confidence: c, ease: e, priority: p });

for (const t of ["لاگ کردن", "Typo", "دیکشنری", "طراحی A/B"]) agent.updateTask(key(t), { scope: "in" });
for (const t of ["Transliteration", "رتبه‌بندی"]) agent.updateTask(key(t), { scope: "later" });
agent.updateTask(key("ویجت"), { scope: "out" });

me.updateTask("SRCH-2", { status: "done" });
me.updateTask("SRCH-1", { status: "doing" });
me.updateTask("SRCH-3", { status: "doing" });

agent.ask([
	{ question: "الان zero-result rate سرچ چند درصد است؟", why: "بدون baseline نمی‌توانیم بگوییم typo tolerance ارزشش را دارد.", kind: "data", project: "SRCH" },
	{ question: "موتور جستجو فعلاً چیست؟", kind: "choice", choices: ["Elasticsearch", "OpenSearch", "Typesense", "سرویس داخلی"], project: "SRCH" },
	{ question: "اجازه‌ی A/B روی ۱۰٪ ترافیک تهران را داریم؟", kind: "confirm", project: "SRCH" },
]);

agent.comment(
	"project",
	"SRCH",
	"اسکوپ v1 را روی «اندازه‌گیری + typo + مترادف» گذاشتم: ارزان‌ترین راه برای تست فرضیه. رتبه‌بندی شخصی ICE بالایی در تأثیر دارد ولی اطمینان پایین است؛ بعد از دیدن داده‌ی zero-result برمی‌گردیم سراغش.",
);

const inbox = me.createTasks(null, [{ title: "جواب ایمیل تیم دیتا درباره‌ی دسترسی ClickHouse" }, { title: "خواندن مقاله‌ی Learning to Rank" }]);
me.planDay(localDay(), { intention: "baseline سرچ را دربیاورم", top: ["SRCH-2", key("طراحی A/B"), inbox[0]!.key] });
me.addJournal({ kind: "checkin", energy: 4, mood: 4 });
me.logFocus("SRCH-2", 95);

agent.remember("context", "فرانت‌اند لید در اسنپ‌فود است؛ روی پلتفرم فرانت و ایجنت‌های AI (دستان) کار می‌کند.");
agent.remember("preference", "پلن‌ها و توضیحات را فارسی می‌خواهد؛ کد، کلید تسک‌ها و اسم برنچ‌ها انگلیسی.");
agent.remember("preference", "ابزار سبک و تایپ‌اسکریپتی دوست دارد: pnpm، SolidJS، Vite، oxlint.");
agent.remember("pattern", "ایده زیاد دارد و شروع سریعی دارد؛ بخش سخت برایش برنامه‌ریزی و اولویت‌بندی است.");

console.log(`Seeded ${db.location()}`);
