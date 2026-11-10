import { createSignal, For, Show } from "solid-js";
import { useQuery } from "@tanstack/solid-query";
import { useParams } from "@tanstack/solid-router";
import { Btn, Panel, TextInput } from "~/components/app.tsx";
import { Field } from "~/components/form.tsx";
import { fa, jalali, rpc, workspace, toast } from "../api.ts";
import { newRecallWorkflow } from "../flows.ts";
import { confirmAction } from "../kit.tsx";
import { askAssistant } from "./Knowledge.tsx";
import { go } from "../ui.tsx";
import type { SearchResult, Source } from "../../../src/retrieval/recall.ts";

interface Proposal { id: number; fact: string; source: string; replaces: number | null }
interface Workflow { id: number; title: string; status: string; draft: string | null; doc_id: number | null }
const STAGE: Record<string, string> = { collect: "جمع‌آوری منابع", draft: "آمادهٔ نوشتن", review: "منتظر بررسی تو", paused: "متوقف", published: "ذخیره شد", cancelled: "لغو شد" };

export function RecallPage() {
	const [query, setQuery] = createSignal("");
	const [submitted, setSubmitted] = createSignal("");
	const results = useQuery(() => ({ queryKey: ["recall", workspace(), submitted()], enabled: Boolean(submitted()), queryFn: () => rpc<SearchResult>("recallSearch", submitted()) }));
	const proposals = useQuery(() => ({ queryKey: ["memory-proposals", workspace()], queryFn: () => rpc<Proposal[]>("memoryProposals") }));
	const workflows = useQuery(() => ({ queryKey: ["workflows", workspace()], queryFn: () => rpc<Workflow[]>("workflowList") }));
	const status = useQuery(() => ({ queryKey: ["recall-status", workspace()], queryFn: () => rpc<{ sources: number; pending: number; model: string }>("recallStatus") }));
	const [busy, setBusy] = createSignal(false);
	const mutate = async (fn: () => Promise<unknown>) => {
		if (busy()) return;
		setBusy(true);
		try { await fn(); await Promise.all([proposals.refetch(), workflows.refetch(), status.refetch()]); }
		catch { /* RPC already displays the error. */ }
		finally { setBusy(false); }
	};
	return <div class="recall-page stack">
		<h1>از سابقه‌ام پیدا کن</h1>
		<p class="muted">جلسه‌ها، تصمیم‌ها و تعهدهای قبلی را با منبع پیدا کن.</p>
		<form class="stack" onSubmit={(e) => { e.preventDefault(); if (query().trim()) setSubmitted(query().trim()); }}>
			<Field label="دنبال چه چیزی می‌گردی؟" hint="مثلاً «برای جلسه با لید، چه تعهدهایی باز مانده؟»">
				<TextInput value={query()} onInput={(e) => setQuery(e.currentTarget.value)} maxlength={8000} placeholder="موضوع، شخص یا تصمیمی که یادت مانده…" required />
			</Field>
			<div class="row wrap"><Btn type="submit" kind="primary" disabled={results.isFetching}>پیدا کن</Btn>
				<Btn type="button" disabled={busy()} onClick={() => mutate(async () => { await newRecallWorkflow(query()); })}>برای جلسه یا مرور آماده شو</Btn></div>
		</form>
		<Show when={results.isFetching}><p role="status">در حال بررسی سابقه…</p></Show>
		<Show when={results.data}>{(data) => <section class="stack" aria-label="نتیجهٔ جستجو">
			<Show when={data().warning}><p class="small muted">جستجوی معنایی در دسترس نیست؛ نتیجه‌های جستجوی متنی نمایش داده می‌شوند.</p></Show>
			<For each={data().hits} fallback={<p class="muted">منبع مرتبطی پیدا نشد. نام شخص یا موضوع دقیق‌تری بنویس.</p>}>{(hit) => <Panel>
				<a href={hit.href}><b>{hit.title}</b></a><span class="small faint">{jalali(hit.updated_at)}</span>
				<p class="recall-excerpt">{hit.text}</p>
			</Panel>}</For>
			<Show when={data().hits.length}><Btn onClick={() => askAssistant(`با recall_search دربارهٔ این سؤال منابع را بخوان و با لینک منبع پاسخ بده. اگر شواهد کافی نیست صریح بگو: ${submitted()}`)}>با این منابع پاسخ بده</Btn></Show>
		</section>}</Show>
		<Show when={proposals.data?.length}><section class="stack"><h2>این را درباره‌ات به خاطر بسپارم؟</h2>
			<p class="small muted">فقط مواردی که تأیید می‌کنی وارد حافظهٔ شخصی مشترک بین محیط‌ها می‌شوند.</p>
			<For each={proposals.data}>{(m) => <Panel><p>{m.fact}</p><small class="faint">منبع: <bdi>{m.source}</bdi></small>
				<Show when={m.replaces}><p class="small">این مورد، حافظهٔ شمارهٔ {fa(m.replaces)} را اصلاح می‌کند؛ سابقه حفظ می‌شود.</p></Show>
				<div class="row wrap"><Btn disabled={busy()} onClick={() => mutate(() => rpc("memoryReview", m.id, true))}>به خاطر بسپار</Btn>
				<Btn kind="ghost" disabled={busy()} onClick={() => mutate(() => rpc("memoryReview", m.id, false))}>ذخیره نکن</Btn></div>
			</Panel>}</For>
		</section></Show>
		<Show when={workflows.data?.length}><section class="stack"><h2>کارهای در حال آماده‌سازی</h2>
			<For each={workflows.data}>{(w) => <Panel><b>{w.title}</b><p class="small faint">{STAGE[w.status] ?? w.status}</p>
				<Show when={w.draft}><details><summary>پیش‌نویس را بخوان</summary><pre class="recall-excerpt">{w.draft}</pre></details></Show>
				<div class="row wrap">
					<Show when={["collect", "draft", "review"].includes(w.status)}><Btn onClick={() => askAssistant(`گردش کار #${w.id} را با workflow_get بخوان. اگر مرحله collect است منابع را جمع کن، اگر draft است طبق instructions با ارجاع به evidence پیش‌نویس بساز و با workflow_advance draft ثبت کن. در مرحله review نظر من را بپرس؛ بدون تأیید من منتشر نکن.`)}>با دستیار ادامه بده</Btn></Show>
					<Show when={w.status === "review"}><Btn kind="primary" disabled={busy()} onClick={() => mutate(async () => { if (await confirmAction(`پیش‌نویس «${w.title}» به‌عنوان سند ذخیره شود؟`)) { await rpc("workflowAdvance", w.id, "publish"); toast("سند ذخیره شد", "win"); } })}>تأیید و ذخیرهٔ سند</Btn>
						<Btn disabled={busy()} onClick={() => mutate(() => rpc("workflowAdvance", w.id, "revise"))}>نیاز به اصلاح دارد</Btn></Show>
					<Show when={["collect", "draft", "review", "paused"].includes(w.status)}><Btn kind="ghost" disabled={busy()} onClick={() => mutate(() => rpc("workflowAdvance", w.id, w.status === "paused" ? "resume" : "pause"))}>{w.status === "paused" ? "ادامه" : "فعلاً متوقف کن"}</Btn></Show>
					<Show when={w.status === "published"}><Btn kind="ghost" onClick={() => go("/knowledge")}>سندهای من</Btn></Show>
				</div>
			</Panel>}</For>
		</section></Show>
		<details><summary>وضعیت منابع</summary><p class="small">{fa(status.data?.sources)} منبع؛ {fa(status.data?.pending)} بخش در انتظار جستجوی معنایی.</p>
			<Btn disabled={busy()} onClick={() => mutate(async () => { const r = await rpc<{ indexed: number }>("recallReindex"); toast(`${fa(r.indexed)} بخش آماده شد`); })}>آماده‌سازی بخش بعدی</Btn>
		</details>
	</div>;
}

export function RecallSourcePage() {
	const params = useParams({ strict: false });
	const source = useQuery(() => ({ queryKey: ["recall-source", workspace(), (params() as { id: string }).id], queryFn: () => rpc<Source>("recallSource", (params() as { id: string }).id) }));
	return <div class="recall-page stack"><Btn kind="ghost" onClick={() => go("/recall")}>بازگشت به جستجو</Btn>
		<Show when={source.isError}><p role="alert">این منبع حذف شده یا در محیط فعلی در دسترس نیست.</p></Show>
		<Show when={source.data}>{(s) => <><h1>{s().title}</h1><p class="small faint">آخرین تغییر: {jalali(s().updated_at)}</p><pre class="recall-full-source">{s().body}</pre></>}</Show>
	</div>;
}
