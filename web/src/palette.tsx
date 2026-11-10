import { allPages } from "./navigation.ts";
import { Tag } from "~/components/app.tsx";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, Suspense } from "solid-js";
import { createResource } from "./live.ts";

import * as Dialog from "~/components/ui/dialog";
import { Kbd } from "~/components/ui/kbd";
import { rpc, toast } from "./api.ts";
import { type Capture, INTENT_FA, parseCapture, type Person } from "./capture.ts";
import { askAssistant } from "./pages/Knowledge.tsx";
import { TEMPLATES } from "./templates.ts";
import { setMode } from "./theme-mode.ts";
import { go, openTask } from "./ui.tsx";

interface Item {
	icon: string;
	label: string;
	hint?: string;
	html?: string;
	run: () => unknown;
}

const [open, setOpen] = createSignal(false);
const [searchOnly, setSearchOnly] = createSignal(false);
const [prefill, setPrefill] = createSignal("");
/** Opens the palette, optionally with text already typed (e.g. "۱:۱ با شقایق فردا"). */
export const openPalette = (text = "") => {
	setSearchOnly(false);
	setPrefill(text);
	setOpen(true);
};

const STANDUP =
	"استندآپ امروزم را با هم بنویسیم: standup_context را بخوان، طبق format_rules کوتاه و دقیق بنویس، قول دیروز را با واقعیت مقایسه کن، فقط جایی که لازم است از اعضای تیم اسم ببر، با standup_save ذخیره کن و یک خط کوچینگ بده.";

const COMMANDS: Item[] = [
	{ icon: "✨", label: "استندآپ امروز را بنویس", hint: "دستیار", run: () => askAssistant(STANDUP) },
	{ icon: "☀️", label: "برنامه‌ی امروزم را بچین", hint: "دستیار", run: () => askAssistant("برنامه‌ی امروزم را بچین: gaam_context را بخوان، سه کار مهم با دلیل پیشنهاد بده و بعد از تأیید من ذخیره کن.") },
	{ icon: "🔁", label: "آماده‌سازی رترو", hint: "دستیار", run: () => askAssistant("مرا برای رترو آماده کن (۱۴ روز اخیر) طبق پرامپت retro_prep: دو چیز خوب با شاهد، حداقل دو چیز بد بی‌تعارف، ریشه‌ی یکی و سهم من، و یک اکشن کوچک.") },
	{ icon: "📈", label: "مرور هفته و کوچینگ", hint: "دستیار", run: () => askAssistant("مرور هفتگی‌ام را انجام بده و صادقانه کوچینگم کن.") },
	{ icon: "🎯", label: "این هفته روی کدام هدف SFPM کار کنم؟", hint: "دستیار", run: () => askAssistant("growth_overview را بخوان و بگو این هفته روی کدام دو هدف SFPM عقبم و سه قدم کوچک پیشنهاد بده.") },
	{ icon: "↻", label: "همگام‌سازی برد جیرا", hint: "جیرا", run: () => rpc("jiraBoardSync").then((r) => toast(`${r.issues} ایشو · ${r.moved.length} جابه‌جایی`, "win")) },
	{ icon: "🌙", label: "تم تاریک", hint: "ظاهر", run: () => setMode("dark") },
	{ icon: "☀️", label: "تم روشن", hint: "ظاهر", run: () => setMode("light") },
];

const PAGES: Item[] = [...allPages, ["/p/DISC", "🗂", "برد جیرا (DISC)"] as const]
	.map(([path, icon, label]) => ({ icon, label, hint: "صفحه", run: () => go(path) }));

const ENTITY: Record<string, [string, string]> = {
	tasks: ["📝", "تسک"],
	projects: ["🧩", "پروژه"],
	goals: ["🎯", "هدف"],
	nodes: ["🧠", "نقشه ذهنی"],
	asks: ["❓", "سؤال"],
	comments: ["💬", "کامنت"],
	memories: ["🧠", "حافظه"],
	journal: ["📓", "ژورنال"],
	docs: ["📚", "دانش"],
	people: ["🤝", "آدم"],
	followups: ["↩", "پیگیری"],
	decisions: ["⚖️", "تصمیم"],
};

/** Executes a parsed capture against the API. */
async function commit(c: Capture) {
	const title = c.text || "(بدون عنوان)";
	switch (c.intent) {
		case "task": {
			const [t] = await rpc("createTasks", c.project, [{ title, due: c.due, priority: c.priority ?? undefined, tags: c.tags }]);
			toast(`${t.key} ساخته شد`, "win");
			return;
		}
		case "followup_mine":
		case "followup_theirs":
			await rpc("saveFollowup", { text: title, person: c.person?.id ?? null, due: c.due, direction: c.intent === "followup_mine" ? "mine" : "theirs" });
			return toast("پیگیری ثبت شد", "win");
		case "meeting": {
			const tpl = TEMPLATES.find((t) => t.id === c.template) ?? TEMPLATES[3];
			const who = c.person?.name ?? "";
			const doc = await rpc("saveDoc", {
				title: title && !/^(۱:۱|1:1|رترو|retro|جلسه)$/i.test(title) ? `${tpl.title(who)} · ${title}` : tpl.title(who),
				kind: "meeting",
				body: tpl.body,
				day: c.due ?? new Date().toLocaleDateString("en-CA"),
				people: who ? [who] : undefined,
				tags: [tpl.id],
			});
			toast("جلسه ساخته شد؛ آماده‌سازی‌اش را در «دانش» انجام بده", "win");
			go("/knowledge");
			return doc;
		}
		case "lesson":
		case "win":
			await rpc("addJournal", { kind: c.intent, body: title });
			return toast(c.intent === "lesson" ? "درس ثبت شد 📚" : "برد ثبت شد 🏆", "win");
		case "decision":
			await rpc("saveDecision", { title, impact: "high", reversible: true });
			toast("تصمیم باز شد؛ اثر و برگشت‌پذیری‌اش را در «رشد» مشخص کن", "win");
			return go("/growth");
		case "memory":
			await rpc("remember", "context", title);
			return toast("به خاطر سپردم 🧠", "win");
		case "idea": {
			const p = await rpc("createProject", { title });
			return go(`/p/${p.key}`);
		}
	}
}

export function Palette() {
	const [query, setQuery] = createSignal("");
	const [sel, setSel] = createSignal(0);
	const [found, setFound] = createSignal<Item[]>([]);
	const [people] = createResource(open, () => rpc<Person[]>("people"));
	let input: HTMLInputElement | undefined;

	const capture = createMemo(() => (!searchOnly() && query().trim() ? parseCapture(query(), people() ?? []) : null));
	createEffect(() => {
		if (open() && prefill()) {
			setQuery(prefill());
			setPrefill("");
		}
	});

	createEffect(async () => {
		const q = query().trim();
		setSel(0);
		if (q.length < 2) return setFound([]);
		const hits = await rpc<{ entity: string; entity_id: number; title: string; snippet: string }[]>("search", q, 8).catch(() => []);
		if (q !== query().trim()) return;
		setFound(
			hits.map((h) => {
				const [icon, hint] = ENTITY[h.entity] ?? ["•", h.entity];
				const key = h.title.split(" ")[0]!;
				let run = () => {};
				if (h.entity === "tasks") run = () => openTask(key);
				else if (h.entity === "projects") run = () => go(`/p/${key}`);
				else if (["docs", "people", "followups", "memories", "goals", "decisions", "journal"].includes(h.entity)) run = () => go(`/sources/${h.entity}%3A${h.entity_id}`);
				return {
					icon,
					label: h.title,
					hint,
					html: h.snippet.replace(/</g, "&lt;").replace(/«/g, "<mark>").replace(/»/g, "</mark>"),
					run,
				};
			}),
		);
	});

	const items = createMemo<Item[]>(() => {
		const q = query().trim();
		const c = capture();
		const head: Item[] = c ? [{ icon: INTENT_FA[c.intent].split(" ")[0]!, label: `ثبت: ${c.text || q}`, hint: "Enter", run: () => commit(c) }] : [];
		const match = (i: Item) => !q || i.label.includes(q);
		return [...head, ...found(), ...(searchOnly() ? [] : COMMANDS.filter(match)), ...PAGES.filter(match)];
	});

	const run = async (item?: Item) => {
		if (!item) return;
		setOpen(false);
		setQuery("");
		await item.run();
	};

	const onKey = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			setOpen(!open());
		}
	};
	onMount(() => window.addEventListener("keydown", onKey));
	onCleanup(() => window.removeEventListener("keydown", onKey));

	return (
		<Dialog.Root open={open()} onOpenChange={(e) => setOpen(e.open)} placement="top" size="lg" initialFocusEl={() => input ?? null}>
			<Dialog.Backdrop />
			<Dialog.Positioner>
				<Dialog.Content class="palette2">
					{/* Loading data here must not suspend the router's root boundary: that tears down the dialog's open-state effects (Esc, outside click, focus). */}
					<Suspense>
						<div class="palette-mode" role="group" aria-label="روش استفاده">
							<button type="button" aria-pressed={!searchOnly()} onClick={() => { setSearchOnly(false); setSel(0); input?.focus(); }}>ثبت سریع</button>
							<button type="button" aria-pressed={searchOnly()} onClick={() => { setSearchOnly(true); setSel(0); input?.focus(); }}>جستجو و رفتن به صفحه</button>
						</div>
						<input
							ref={input}
							class="palette-input"
							aria-label={searchOnly() ? "جستجو" : "ثبت سریع"}
							placeholder={searchOnly() ? "نام کار، سند یا صفحه را بنویس…" : "مثلاً پیگیری با شایان تا پنجشنبه…"}
							value={query()}
							onInput={(e) => setQuery(e.currentTarget.value)}
							onKeyDown={(e) => {
								if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, items().length - 1)));
								if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
								if (e.key === "Enter" && !e.isComposing) (e.preventDefault(), run(items()[sel()]));
							}}
						/>
						<Show when={capture()}>
							{(c) => (
								<div class="capture-preview">
									<Tag class="accent">{INTENT_FA[c().intent]}</Tag>
									<Show when={c().text}>
										<b>{c().text}</b>
									</Show>
									<Show when={c().person}>
										<Tag>👤 {c().person!.name}</Tag>
									</Show>
									<Show when={c().dueLabel}>
										<Tag>📅 {c().dueLabel}</Tag>
									</Show>
									<Show when={c().priority != null}>
										<Tag class="P0">P{c().priority}</Tag>
									</Show>
									<Show when={c().project}>
										<Tag class="key">@{c().project}</Tag>
									</Show>
									<For each={c().tags}>{(t) => <Tag>#{t}</Tag>}</For>
								</div>
							)}
						</Show>
						<div class="palette-results">
							<For each={items()} fallback={<p class="muted palette-empty">نتیجه‌ای پیدا نشد.</p>}>
								{(item, i) => (
									<div class="hit" classList={{ sel: sel() === i() }} onMouseEnter={() => setSel(i())} onClick={() => run(item)}>
										<span class="hit-icon">{item.icon}</span>
										<div style={{ flex: 1, "min-width": 0 }}>
											<div class="hit-label">{item.label}</div>
											<Show when={item.html}>
												<div class="small faint" innerHTML={item.html} />
											</Show>
										</div>
										<Tag>{item.hint}</Tag>
									</div>
								)}
							</For>
						</div>
						<div class="palette-foot small faint">
							<Kbd>↵</Kbd> اجرا · <Kbd>↑↓</Kbd> انتخاب · <Kbd>Esc</Kbd> بستن
						</div>
					</Suspense>
				</Dialog.Content>
			</Dialog.Positioner>
		</Dialog.Root>
	);
}
