import { createResource, createSignal, For, Show } from "solid-js";
import { ask, confirmAction, DATE_SUGGESTIONS, todayIso } from "~/kit.tsx";

import { ago, fa, jalali, rpc, toast, version } from "../api.ts";
import { go } from "../ui.tsx";
import { TEMPLATES } from "../templates.ts";
import { Markdown } from "./Assistant.tsx";

interface DocRow {
	id: number;
	title: string;
	kind: string;
	summary: string | null;
	preview: string | null;
	size: number | null;
	day: string | null;
	people: string | null;
	open_followups: number;
	file_path: string | null;
	author: string;
	created_at: string;
}

export const DOC_KIND_FA: Record<string, string> = {
	meeting: "🗓 جلسه",
	plan: "🧭 پلن",
	doc: "📄 سند",
	data: "📊 داده",
	note: "📝 یادداشت",
	reference: "🔗 مرجع",
};

/** Asks the assistant something and jumps to the conversation. */
export async function askAssistant(text: string) {
	const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then((r) => r.json());
	if (res.error) return toast(res.error.message, "error");
	go(`/assistant/${res.data.thread}`);
}

export function KnowledgePage() {
	const [kind, setKind] = createSignal<string | null>(null);
	const [docs, { refetch }] = createResource(
		() => [kind(), version()] as const,
		([k]) => rpc<DocRow[]>("docs", k ? { kind: k } : {}),
	);
	const [openId, setOpenId] = createSignal<number | null>(null);
	const [dragging, setDragging] = createSignal(false);
	const [uploading, setUploading] = createSignal(false);
	const [title, setTitle] = createSignal("");
	const [body, setBody] = createSignal("");
	const [newKind, setNewKind] = createSignal("meeting");
	const [people, setPeople] = createSignal("");
	let fileInput!: HTMLInputElement;

	const upload = async (files: FileList | File[]) => {
		if (!files.length) return;
		setUploading(true);
		const form = new FormData();
		for (const f of files) form.append("file", f);
		const res = await fetch("/api/files", { method: "POST", body: form }).then((r) => r.json());
		setUploading(false);
		if (res.error) return toast(res.error.message, "error");
		toast(`${fa(res.data.length)} فایل به دانش اضافه شد`, "win");
		refetch();
		if (res.data.length === 1) setOpenId(res.data[0].id);
	};

	const create = async (e: Event) => {
		e.preventDefault();
		if (!title().trim()) return;
		const doc = await rpc("saveDoc", {
			title: title().trim(),
			kind: newKind(),
			body: body().trim() || null,
			people: people()
				.split(/[,،]/)
				.map((s) => s.trim())
				.filter(Boolean),
		});
		setTitle("");
		setBody("");
		setPeople("");
		refetch();
		setOpenId(doc.id);
		toast("ذخیره شد؛ دستیار از این به بعد این را می‌داند", "win");
	};

	return (
		<>
			<div class="page-head">
				<div>
					<h1>دانش</h1>
					<p>پلن جلسه‌ها، صورت‌جلسه‌ها، سندها و داده‌های مهمت. همه جستجوپذیرند و دستیار موقع جواب دادن از آن‌ها استفاده می‌کند.</p>
				</div>
			</div>

			<div class="grid g2" style={{ "margin-bottom": "16px" }}>
				<div
					class="card dropzone"
					classList={{ over: dragging() }}
					onDragOver={(e) => (e.preventDefault(), setDragging(true))}
					onDragLeave={() => setDragging(false)}
					onDrop={(e) => {
						e.preventDefault();
						setDragging(false);
						upload(e.dataTransfer?.files ?? []);
					}}
					onClick={() => fileInput.click()}
				>
					<input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.currentTarget.files ?? [])} />
					<div style={{ "font-size": "30px" }}>{uploading() ? "⏳" : "📥"}</div>
					<b>فایل را این‌جا بینداز یا کلیک کن</b>
					<div class="small muted">md، txt، csv، json، docx، rtf و html خوانده می‌شوند. PDF و تصویر ذخیره می‌شوند و می‌توانی خلاصه‌شان را بنویسی.</div>
				</div>
				<form class="card stack" onSubmit={create}>
					<div class="row">
						<select class="input" style={{ width: "auto" }} onChange={(e) => setNewKind(e.currentTarget.value)}>
							<For each={Object.entries(DOC_KIND_FA)}>
								{([k, v]) => (
									<option value={k} selected={k === newKind()}>
										{v}
									</option>
								)}
							</For>
						</select>
						<input class="input" placeholder="عنوان (مثلاً ۱:۱ با شایان)" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
					</div>
					<input class="input" placeholder="آدم‌ها (با کاما)" value={people()} onInput={(e) => setPeople(e.currentTarget.value)} />
					<textarea class="textarea" rows="3" placeholder="پلن، نکته‌ها یا متن را بچسبان…" value={body()} onInput={(e) => setBody(e.currentTarget.value)} />
					<div class="row">
						<span class="spacer" />
						<button class="btn primary sm">ذخیره</button>
					</div>
				</form>
			</div>

			<div class="card" style={{ "margin-bottom": "16px" }}>
				<h3>🗓 جلسه‌ی بعدی را آماده برو</h3>
				<div class="row wrap">
					<For each={TEMPLATES}>
						{(t) => (
							<button
								class="btn"
								onClick={async () => {
									const people = await rpc<{ name: string; relation: string }[]>("people");
									const order = t.id === "one_on_one_manager" ? ["manager"] : t.id === "one_on_one_report" ? ["report"] : [];
									const picks = [...people].sort((a, b) => Number(order.includes(b.relation)) - Number(order.includes(a.relation))).slice(0, 6);
									const answer = await ask({
										title: t.label,
										description: "قالب آماده‌سازی ساخته می‌شود؛ بعد دستیار می‌تواند از روی داده‌ها پرش کند.",
										confirm: "بساز",
										fields: [
											...(t.id === "retro"
												? []
												: [{ name: "who", label: "با چه کسی؟", required: t.id !== "meeting", suggestions: picks.map((p) => ({ value: p.name, label: p.name })) }]),
											{ name: "day", label: "چه روزی؟", type: "date" as const, value: todayIso(), suggestions: DATE_SUGGESTIONS() },
										],
									});
									if (!answer) return;
									const who = answer.who?.trim() ?? "";
									const day = answer.day;
									const doc = await rpc("saveDoc", {
										title: t.title(who),
										kind: "meeting",
										body: t.body,
										day: day || new Date().toLocaleDateString("en-CA"),
										people: who ? [who] : undefined,
										tags: [t.id],
									});
									refetch();
									setOpenId(doc.id);
								}}
							>
								{t.label}
							</button>
						)}
					</For>
				</div>
				<div class="small faint" style={{ "margin-top": "6px" }}>
					قالب را باز کن و «🎯 آماده‌سازی با دستیار» را بزن تا از جیرا، گیت، پیگیری‌ها و جلسه‌های قبلی پرش کند. بعد از جلسه «🔁 بازبینی» را بزن.
				</div>
			</div>

			<div class="row wrap" style={{ "margin-bottom": "12px" }}>
				<button class="btn sm" classList={{ primary: !kind() }} onClick={() => setKind(null)}>
					همه
				</button>
				<For each={Object.entries(DOC_KIND_FA)}>
					{([k, v]) => (
						<button class="btn sm" classList={{ primary: kind() === k }} onClick={() => setKind(k)}>
							{v}
						</button>
					)}
				</For>
			</div>

			<div class="stack" style={{ gap: "10px" }}>
				<For each={docs()} fallback={<div class="empty">هنوز چیزی ذخیره نکردی. پلن جلسه‌ی بعدی‌ات را اضافه کن.</div>}>
					{(d) => (
						<div class="card">
							<div class="row wrap" style={{ cursor: "pointer" }} onClick={() => setOpenId(openId() === d.id ? null : d.id)}>
								<span class="chip">{DOC_KIND_FA[d.kind]}</span>
								<b>{d.title}</b>
								<Show when={d.people}>
									<span class="chip">👥 {d.people}</span>
								</Show>
								<Show when={d.open_followups}>
									<span class="chip accent">↩ {fa(d.open_followups)} پیگیری</span>
								</Show>
								<span class="spacer" />
								<span class="small faint">{d.day ? jalali(d.day) : ago(d.created_at)}</span>
							</div>
							<Show when={openId() !== d.id && (d.summary || d.preview)}>
								<div class="small muted" style={{ "margin-top": "6px", "white-space": "pre-wrap" }}>
									{(d.summary ?? d.preview ?? "").slice(0, 220)}
								</div>
							</Show>
							<Show when={openId() === d.id}>
								<DocView id={d.id} onChange={refetch} />
							</Show>
						</div>
					)}
				</For>
			</div>
		</>
	);
}

function DocView(props: { id: number; onChange: () => void }) {
	const [doc, { refetch }] = createResource(
		() => [props.id, version()] as const,
		([id]) =>
			rpc<{
				id: number;
				title: string;
				kind: string;
				body: string | null;
				summary: string | null;
				day: string | null;
				people: { name: string }[];
				followups: { id: number; text: string; direction: string; status: string; person: string | null }[];
			}>("doc", id),
	);
	const save = (patch: Record<string, unknown>) => rpc("saveDoc", { id: props.id, ...patch }).then(() => (refetch(), props.onChange()));
	return (
		<Show when={doc()}>
			{(d) => (
				<div class="stack" style={{ "margin-top": "10px" }}>
					<div class="row wrap">
						<button class="btn sm primary" onClick={() => askAssistant(`سند #${d().id} («${d().title}») را با doc_get بخوان. یک خلاصه‌ی سه‌خطی در summary آن ذخیره کن، تصمیم‌ها را با decision_save، پیگیری‌ها را با followup_save (با doc ${d().id}) و کارهای واقعی را با task_create ثبت کن. بعد بگو چه چیزهایی ساختی.`)}>
							✳️ پردازش با دستیار
						</button>
						<Show when={d().kind === "meeting"}>
							<button
								class="btn sm"
								onClick={() =>
									askAssistant(
										`مرا برای جلسه‌ی سند #${d().id} («${d().title}») آماده کن. doc_get را بخوان و بخش «قبل از جلسه» را از روی داده‌ی واقعی پر کن: پیگیری‌های باز با ${d().people.map((p) => p.name).join("، ") || "حاضران"} (followup_list)، team_status، جلسه‌های قبلی با همین آدم‌ها (doc_list)، استندآپ‌ها و تصمیم‌های اخیر و اهداف SFPM. حداقل یک نکته‌ی منفی یا ریسک واقعی و مشخص بنویس (نه «همه‌چیز عالی است»). نتیجه را با doc_save در body همین سند ذخیره کن و خلاصه‌اش را به من بگو.`,
									)
								}
							>
								🎯 آماده‌سازی با دستیار
							</button>
							<button
								class="btn sm"
								onClick={() =>
									askAssistant(
										`جلسه‌ی سند #${d().id} («${d().title}») تمام شد. با doc_get یادداشت‌ها را بخوان. از من بپرس چطور گذشت و چقدر آماده بودم (۱ تا ۵). بعد: خلاصه‌ی سه‌خطی را در summary سند بنویس، تصمیم‌ها را decision_save، پیگیری‌ها را followup_save (doc ${d().id}) و برای هر حاضر interaction_log ثبت کن. یک درس کوتاه درباره‌ی جلسه‌داری‌ام را با journal_add (kind lesson) ذخیره کن.`,
									)
								}
							>
								🔁 بازبینی بعد از جلسه
							</button>
						</Show>
						<span class="spacer" />
						<input class="input ltr" type="date" style={{ width: "auto" }} value={d().day ?? ""} onChange={(e) => save({ day: e.currentTarget.value || null })} />
						<button class="btn ghost sm danger" onClick={async () => (await confirmAction(`«${d().title}» حذف شود؟`)) && rpc("deleteDoc", d().id).then(props.onChange)}>
							حذف
						</button>
					</div>
					<div class="field-label">خلاصه</div>
					<textarea class="textarea" rows="2" value={d().summary ?? ""} placeholder="خلاصه‌ی کوتاه (یا بگذار دستیار بنویسد)" onChange={(e) => save({ summary: e.currentTarget.value || null })} />
					<div class="field-label">متن</div>
					<textarea class="textarea" rows="8" value={d().body ?? ""} onChange={(e) => save({ body: e.currentTarget.value || null })} />
					<Show when={d().followups.length}>
						<div class="field-label">پیگیری‌های این سند</div>
						<For each={d().followups}>
							{(f) => (
								<div class="row small">
									<span>{f.direction === "mine" ? "↗ من باید" : "↙ منتظر"}</span>
									<b>{f.person}</b>
									<span style={{ flex: 1 }}>{f.text}</span>
									<span class="chip">{f.status}</span>
								</div>
							)}
						</For>
					</Show>
				</div>
			)}
		</Show>
	);
}

export { Markdown };
