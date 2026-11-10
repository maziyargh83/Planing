export const primaryPages = [
	["/now", "◉", "الان"], ["/tasks", "☷", "کارها"], ["/sky", "✦", "کهکشان"],
	["/growth", "🌱", "رشد"], ["/people", "🤝", "آدم‌ها"],
] as const;

export const pageGroups = [
	{ title: "برنامه‌ریزی", pages: [
		["/today", "☀️", "برنامهٔ روز"], ["/projects", "🧩", "پروژه‌ها"],
		["/goals", "🎯", "هدف‌ها"], ["/inbox", "📥", "صندوق ورودی"],
	] },
	{ title: "دانش و گفتگو", pages: [
		["/recall", "🔎", "از سابقه‌ام پیدا کن"], ["/knowledge", "📚", "سندها"],
		["/assistant", "✳️", "گفتگوها"], ["/memory", "🧠", "حافظه"],
	] },
	{ title: "مرور و تنظیمات", pages: [
		["/overview", "🌐", "نمای کلی"], ["/insights", "📈", "بینش‌ها"],
		["/automations", "⚙️", "خودکارسازی"], ["/connect", "🔌", "اتصال‌ها"],
	] },
] as const;
export const allPages = [...primaryPages, ...pageGroups.flatMap((group) => [...group.pages])];
