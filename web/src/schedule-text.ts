/** Human-readable Persian for automation schedule strings. Pure, so it can be tested under Node. */

export const DAY_FA: Record<string, string> = { sat: "شنبه", sun: "یکشنبه", mon: "دوشنبه", tue: "سه‌شنبه", wed: "چهارشنبه", thu: "پنجشنبه", fri: "جمعه" };
const faNum = (s: string) => s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);

/** "weekdays 09:00" → "روزهای کاری، ساعت ۹:۰۰" */
export function scheduleText(schedule: string): string {
	const s = schedule.trim().toLowerCase();
	const every = s.match(/^every\s+(\d+)\s*(m|h)$/);
	if (every) return `هر ${faNum(every[1]!)} ${every[2] === "h" ? "ساعت" : "دقیقه"}`;
	const m = s.match(/^(daily|weekdays|weekly\s+([a-z]{3})|([a-z,]+))\s+(\d{1,2}):(\d{2})$/);
	if (!m) return schedule;
	const time = `ساعت ${faNum(String(Number(m[4])))}:${faNum(m[5]!)}`;
	if (m[1] === "daily") return `هر روز، ${time}`;
	if (m[1] === "weekdays") return `روزهای کاری (شنبه تا چهارشنبه)، ${time}`;
	const days = (m[2] ?? m[3] ?? "").split(",").map((d) => DAY_FA[d] ?? d);
	return `${days.join("، ")}، ${time}`;
}
