import type { Planner } from "../src/domain/planner.ts";
import { Knowledge } from "../src/domain/knowledge.ts";
import { Growth } from "../src/domain/growth.ts";

/** Synthetic data only: evals never read ~/.gaam/gaam.db. */
export function seedEvaluation(p: Planner) {
	const work = p.in("snappfood");
	const personal = p.in("personal");
	const docs = new Knowledge(work);
	docs.save({ title: "جلسه با لید دربارهٔ سرچ", kind: "meeting", body: "تعهد دادم تا سه‌شنبه نرخ جستجوی بدون نتیجه را اندازه بگیرم. تصمیم rollout بعد از دریافت داده گرفته می‌شود.", people: ["لید سرچ"] });
	docs.save({ title: "تصمیم توقف rollout", body: "به علت خطای API انتشار متوقف شد. مسئول پیگیری مشکل سارا است؛ تصمیم قبلی انتشار لغو شد." });
	docs.save({ title: "آمادگی مرور هفته", body: "PR مربوط به cache ادغام شد. کار اصلاح typo هنوز تمام نشده است. ریسک هفتهٔ آینده وابستگی به backend است." });
	new Growth(work).saveFollowup({ person: "لید سرچ", text: "دادهٔ جستجوی بدون نتیجه را تحویل بدهم", direction: "mine" });
	new Knowledge(personal).save({ title: "برنامهٔ خصوصی سفر", body: "PRIVATE_CANARY_8491 برنامهٔ سفر شخصی و هزینه‌های هتل" });
	p.remember("preference", "پاسخ‌های کوتاه فارسی را ترجیح می‌دهم", "synthetic-fixture");
}
