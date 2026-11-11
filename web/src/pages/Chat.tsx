import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { createResource } from "../live.ts";

import { Btn, Choice, Tag } from "~/components/app.tsx";
import * as SegmentGroup from "~/components/ui/segment-group";
import { ago, fa, rpc, toast, version, workspace, wsHeaders } from "../api.ts";
import { type BotMessage, type ChatMessage, type ContextRef, createChat, type Part, type UserMessage } from "../chat.ts";
import { keysIn, toolMeta } from "../chat-tools.ts";
import { ask, confirmAction } from "../kit.tsx";
import { AiSettingsButton } from "./AiSettings.tsx";
import { Markdown } from "../markdown.tsx";
import { go, openTask, route } from "../ui.tsx";

export interface ProviderStatus {
	id: string;
	label: string;
	available: boolean;
	detail: string;
	models: { id: string; label: string }[];
	defaultModel: string | null;
	effort: boolean;
	toolsInGaam: boolean;
}

export const PROVIDER_ICON: Record<string, string> = { anthropic: "✳️", claude: "🟠", codex: "◎", ollama: "🦙" };
const EFFORTS = ["low", "medium", "high"] as const;
const EFFORT_FA: Record<string, string> = { low: "سریع", medium: "متعادل", high: "عمیق" };

const SLASH: { cmd: string; label: string; text: string }[] = [
	{ cmd: "/standup", label: "استندآپ امروز", text: "استندآپ امروزم را با هم بنویسیم: standup_context را بخوان، طبق format_rules کوتاه و دقیق بنویس، قول دفعه‌ی قبل را با واقعیت مقایسه کن، فقط جایی که لازم است از اعضای تیم اسم ببر، با standup_save ذخیره کن و یک خط کوچینگ بده." },
	{ cmd: "/plan", label: "برنامه‌ی امروز", text: "برنامه‌ی امروزم را بچین: gaam_context را بخوان، سه کار مهم با دلیل پیشنهاد بده و بعد از تأیید من با day_plan ذخیره کن." },
	{ cmd: "/idea", label: "ایده → پلن", text: "این ایده را پلن کن (دیسکاوری، نقشه ذهنی، سؤال‌ها، تسک‌ها با ICE، اسکوپ): " },
	{ cmd: "/retro", label: "آماده‌سازی رترو", text: "مرا برای رترو (۱۴ روز اخیر) آماده کن: دو چیز خوب با شاهد، حداقل دو چیز بد بی‌تعارف، ریشه‌ی یکی و سهم من، و یک اکشن کوچک با مالک و تاریخ." },
	{ cmd: "/prep", label: "آماده‌سازی جلسه", text: "مرا برای جلسه با این آدم آماده کن (پیگیری‌ها، جلسه‌های قبلی، وضعیت تیم، اهداف SFPM، یک نکته‌ی منفی واقعی، سؤال‌های خوب): " },
	{ cmd: "/week", label: "مرور هفته", text: "مرور هفتگی‌ام را انجام بده و صادقانه کوچینگم کن." },
	{ cmd: "/sfpm", label: "قدم بعدی SFPM", text: "growth_overview را بخوان و بگو این هفته روی کدام دو هدف SFPM عقبم و سه قدم کوچک و مشخص پیشنهاد بده." },
];

const MENTION_ENTITY: Record<string, "task" | "project" | "person" | "doc" | "goal"> = { tasks: "task", projects: "project", people: "person", docs: "doc", goals: "goal" };
const CONTEXT_ICON: Record<string, string> = { task: "📋", project: "🧩", person: "🤝", doc: "📚", goal: "🎯", page: "📍" };

const [providers, { refetch: refetchProviders }] = createResource(() => rpc<{ providers: ProviderStatus[]; settings: Record<string, string> }>("aiStatus"));
export { providers, refetchProviders };

// ── Pieces ─────────────────────────────────────────────────────────────────

function Elapsed(props: { since: number }) {
	const [now, setNow] = createSignal(Date.now());
	const t = setInterval(() => setNow(Date.now()), 1000);
	onCleanup(() => clearInterval(t));
	return <>{fa(Math.max(0, Math.round((now() - props.since) / 1000)))} ثانیه</>;
}

function Reasoning(props: { part: Extract<Part, { type: "reasoning" }>; live: boolean }) {
	const [open, setOpen] = createSignal(false);
	const thinking = () => props.live && props.part.ms == null;
	return (
		<div class="c-reason" classList={{ open: open() || thinking() }}>
			<button type="button" class="c-reason-head" onClick={() => setOpen(!open())}>
				<span classList={{ shimmer: thinking() }}>{thinking() ? "در حال فکر کردن…" : `فکر کرد${props.part.ms ? ` · ${fa(Math.round(props.part.ms / 1000))} ثانیه` : ""}`}</span>
				<span class="faint">{open() ? "▲" : "▼"}</span>
			</button>
			<Show when={(open() || thinking()) && props.part.text}>
				<div class="c-reason-body">{props.part.text}</div>
			</Show>
		</div>
	);
}

function ToolCard(props: { part: Extract<Part, { type: "tool" }>; onApprove: (ok: boolean) => void }) {
	const [open, setOpen] = createSignal(false);
	const meta = () => toolMeta(props.part.name, props.part.input);
	const keys = () => (props.part.state === "output-available" ? keysIn(props.part.output) : []);
	const pretty = (v: unknown) => {
		const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
		return s.length > 6000 ? `${s.slice(0, 6000)}\n…` : s;
	};
	return (
		<div class={`c-tool st-${props.part.state}`}>
			<button type="button" class="c-tool-head" onClick={() => setOpen(!open())}>
				<span class="c-tool-icon">{meta().icon}</span>
				<span class="c-tool-label">{meta().label}</span>
				<Show when={meta().summary}>
					<span class="c-tool-sum">{meta().summary}</span>
				</Show>
				<span class="spacer" />
				<Switch>
					<Match when={props.part.state === "input-streaming" || props.part.state === "input-available"}>
						<span class="spinner" />
					</Match>
					<Match when={props.part.state === "output-available"}>
						<span class="c-ok">✓</span>
					</Match>
					<Match when={props.part.state === "output-error"}>
						<span class="c-err">✕</span>
					</Match>
					<Match when={props.part.state === "denied"}>
						<span class="faint">لغو شد</span>
					</Match>
					<Match when={props.part.state === "approval-requested"}>
						<span class="c-wait">منتظر تأیید</span>
					</Match>
				</Switch>
				<Show when={props.part.ms != null}>
					<span class="faint small ltr">{props.part.ms! < 1000 ? `${props.part.ms}ms` : `${(props.part.ms! / 1000).toFixed(1)}s`}</span>
				</Show>
			</button>
			<Show when={props.part.state === "approval-requested"}>
				<div class="c-approve">
					<span>این کار داده را حذف یا جابه‌جا می‌کند. اجرا شود؟</span>
					<span class="spacer" />
					<Btn kind="primary sm danger" onClick={() => props.onApprove(true)}>
						اجرا کن
					</Btn>
					<Btn kind="sm" onClick={() => props.onApprove(false)}>
						نه
					</Btn>
				</div>
			</Show>
			<Show when={keys().length}>
				<div class="c-tool-keys">
					<For each={keys()}>
						{(k) => (
							<button type="button" class="md-key" onClick={() => openTask(k)}>
								{k}
							</button>
						)}
					</For>
				</div>
			</Show>
			<Show when={open()}>
				<div class="c-tool-body">
					<Show when={props.part.input !== undefined || props.part.inputText}>
						<div class="field-label">ورودی</div>
						<pre class="ltr">{props.part.inputText ?? pretty(props.part.input)}</pre>
					</Show>
					<Show when={props.part.output !== undefined}>
						<div class="field-label">خروجی</div>
						<pre class="ltr">{pretty(props.part.output)}</pre>
					</Show>
					<Show when={props.part.error}>
						<div class="field-label">خطا</div>
						<pre class="ltr c-err">{props.part.error}</pre>
					</Show>
				</div>
			</Show>
		</div>
	);
}

function UserBubble(props: { m: UserMessage; onEdit: () => void }) {
	return (
		<div class="c-msg c-user">
			<Show when={props.m.context.length}>
				<div class="c-ctx-row">
					<For each={props.m.context}>
						{(c) => (
							<Tag>
								{CONTEXT_ICON[c.type]} {c.label ?? ("ref" in c ? String(c.ref) : c.route)}
							</Tag>
						)}
					</For>
				</div>
			</Show>
			<div class="c-user-text">{props.m.text}</div>
			<div class="c-actions">
				<button type="button" title="کپی" onClick={() => navigator.clipboard.writeText(props.m.text).then(() => toast("کپی شد"))}>
					⧉
				</button>
				<button type="button" title="ویرایش و ارسال در شاخه‌ی جدید" onClick={props.onEdit}>
					✎
				</button>
			</div>
		</div>
	);
}

function BotBlock(props: { m: BotMessage; last: boolean; startedAt: number; onApprove: (id: string, ok: boolean) => void; onRegenerate: () => void; onFork: () => void }) {
	const text = () =>
		props.m.parts
			.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
			.map((p) => p.text)
			.join("\n\n");
	const lastPart = () => props.m.parts.at(-1);
	const waiting = () => props.m.running && (!props.m.parts.length || lastPart()?.type === "step" || (lastPart()?.type === "tool" && (lastPart() as { state: string }).state === "output-available"));
	return (
		<div class="c-msg c-bot">
			<For each={props.m.parts}>
				{(part) => (
					<Switch>
						<Match when={part.type === "sources"}>
							<details class="recall-evidence">
								<summary>منابع این پاسخ</summary>
								<For each={(part as Extract<Part, { type: "sources" }>).sources}>
									{(source) => <a class="recall-source-link" href={source.href}>{source.title}</a>}
								</For>
								<Show when={(part as Extract<Part, { type: "sources" }>).degraded}><p class="small faint">جستجوی معنایی در دسترس نبود؛ منابع با جستجوی متنی پیدا شدند.</p></Show>
							</details>
						</Match>
						<Match when={part.type === "text"}>
							<Markdown text={(part as Extract<Part, { type: "text" }>).text} />
						</Match>
						<Match when={part.type === "reasoning"}>
							<Reasoning part={part as Extract<Part, { type: "reasoning" }>} live={props.m.running} />
						</Match>
						<Match when={part.type === "tool"}>
							<ToolCard part={part as Extract<Part, { type: "tool" }>} onApprove={(ok) => props.onApprove((part as { toolCallId: string }).toolCallId, ok)} />
						</Match>
						<Match when={part.type === "error"}>
							<div class="c-error">
								<Markdown text={(part as Extract<Part, { type: "error" }>).text} />
							</div>
						</Match>
					</Switch>
				)}
			</For>
			<Show when={waiting()}>
				<div class="c-working">
					<span class="dots">
						<i />
						<i />
						<i />
					</span>
					<span>{props.m.parts.length ? "ادامه می‌دهد…" : "دارد کار می‌کند…"}</span>
					<Show when={props.startedAt}>
						<span class="faint">
							<Elapsed since={props.startedAt} />
						</span>
					</Show>
				</div>
			</Show>
			<Show when={!props.m.running}>
				<div class="c-foot">
					<Show when={props.m.provider}>
						<span>
							{PROVIDER_ICON[props.m.provider!] ?? "•"} {props.m.model ?? props.m.provider}
						</span>
					</Show>
					<Show when={props.m.usage}>
						<span class="ltr" title={`cache read ${props.m.usage!.cacheRead ?? 0}`}>
							{fa(props.m.usage!.input + (props.m.usage!.cacheRead ?? 0))}↑ {fa(props.m.usage!.output)}↓
						</span>
					</Show>
					<Show when={props.m.usage?.costUsd}>
						<span class="ltr">${props.m.usage!.costUsd!.toFixed(props.m.usage!.costUsd! < 0.01 ? 4 : 3)}</span>
					</Show>
					<Show when={props.m.ms}>
						<span>{fa(Math.round(props.m.ms! / 1000))} ثانیه</span>
					</Show>
					<Show when={props.m.finish === "aborted"}>
						<span class="c-err">متوقف شد</span>
					</Show>
					<span class="spacer" />
					<div class="c-actions always">
						<button type="button" title="کپی" onClick={() => navigator.clipboard.writeText(text()).then(() => toast("کپی شد"))}>
							⧉
						</button>
						<Show when={props.last}>
							<button type="button" title="دوباره بساز" onClick={props.onRegenerate}>
								↻
							</button>
						</Show>
						<button type="button" title="شاخه‌ی جدید از این‌جا" onClick={props.onFork}>
							⑂
						</button>
					</div>
				</div>
			</Show>
		</div>
	);
}

// ── Page ───────────────────────────────────────────────────────────────────

interface ThreadRow {
	id: number;
	title: string;
	provider: string;
	origin: string;
	workspace: string | null;
	pinned: number;
	updated_at: string;
	count: number;
}

export function AssistantPage(props: { initialContext?: ContextRef[]; compact?: boolean }) {
	// In the companion sheet the thread lives in local state, so the page underneath stays put.
	const [localThread, setLocalThread] = createSignal<number | null>(null);
	const threadId = () => {
		if (props.compact) return localThread();
		const m = route().match(/^\/assistant\/(\d+)/);
		return m ? Number(m[1]) : null;
	};
	const openThread = (id: number | null) => (props.compact ? setLocalThread(id) : go(id ? `/assistant/${id}` : "/assistant"));
	const chat = createChat();
	onCleanup(chat.dispose);
	const [threads, { refetch: refetchThreads }] = createResource(version, () => rpc<ThreadRow[]>("threads"));
	const [filter, setFilter] = createSignal("");
	const [provider, setProvider] = createSignal("claude");
	const [model, setModel] = createSignal<string | null>(null);
	const [effort, setEffort] = createSignal<string>("medium");
	const [draft, setDraft] = createSignal("");
	const [context, setContext] = createSignal<ContextRef[]>(props.initialContext ?? []);
	const [mention, setMention] = createSignal<{ query: string; items: { ref: ContextRef; label: string; icon: string }[]; sel: number } | null>(null);
	const [stuck, setStuck] = createSignal(true);
	let scroller!: HTMLDivElement;
	let input!: HTMLTextAreaElement;

	const current = createMemo(() => providers()?.providers.find((p) => p.id === provider()));

	createEffect(on(threadId, (id) => void chat.open(id)));
	createEffect(() => {
		const s = providers();
		if (!s) return;
		const t = chat.state.thread;
		const p = t?.provider ?? s.settings.provider ?? s.providers.find((x) => x.available)?.id ?? "claude";
		setProvider(p);
		setModel(t?.model ?? s.settings[`model.${p}`] ?? null);
		setEffort(t?.effort ?? s.settings.effort ?? "medium");
	});
	// Stick to the bottom while streaming unless the user scrolled up to read.
	// Any upward scroll unsticks at once: a distance threshold alone loses to
	// tokens arriving faster than the user can scroll past it.
	let thread!: HTMLDivElement;
	let lastTop = 0;
	const toBottom = () => {
		if (!scroller) return;
		scroller.scrollTop = scroller.scrollHeight;
		lastTop = scroller.scrollTop;
	};
	const onScroll = () => {
		const top = scroller.scrollTop;
		const gap = scroller.scrollHeight - top - scroller.clientHeight;
		// Content shrinking also lowers scrollTop, but then we are still at the bottom.
		if (top < lastTop - 1 && gap > 2) setStuck(false);
		else if (gap < 24) setStuck(true);
		lastTop = top;
	};
	const unstickUp = (e: WheelEvent) => e.deltaY < 0 && scroller.scrollTop > 0 && setStuck(false);
	createEffect(() => {
		void chat.state.messages.length;
		if (stuck()) queueMicrotask(toBottom);
	});
	// Height changes that are not new events (reasoning collapsing, the footer appearing, images) still follow.
	onMount(() => {
		const ro = new ResizeObserver(() => stuck() && toBottom());
		ro.observe(thread);
		ro.observe(scroller);
		onCleanup(() => ro.disconnect());
	});

	const remember = (p: string, m: string | null) => {
		setProvider(p);
		setModel(m);
		void rpc("setSetting", "provider", p);
		void rpc("setSetting", `model.${p}`, m);
	};

	const autosize = () => {
		input.style.height = "auto";
		input.style.height = `${Math.min(220, input.scrollHeight)}px`;
	};

	const send = async (text = draft().trim()) => {
		if (!text || chat.state.running) return;
		if (!current()?.available) return toast(`${current()?.label ?? provider()} در دسترس نیست: ${current()?.detail ?? ""}`, "error");
		const ctx = context();
		setDraft("");
		setContext([]);
		queueMicrotask(autosize);
		setStuck(true);
		const id = await chat.send(text, ctx, { provider: provider(), model: model(), effort: current()?.effort ? effort() : null }).catch(() => null);
		if (id && id !== threadId()) openThread(id);
		refetchThreads();
	};

	// @mentions: search tasks, projects, people, docs and goals as you type.
	const onInput = async () => {
		autosize();
		const el = input;
		const before = el.value.slice(0, el.selectionStart);
		const m = before.match(/(?:^|\s)@([\p{L}\p{N}_-]{0,30})$/u);
		if (!m) return setMention(null);
		const q = m[1]!;
		if (q.length < 1) return setMention({ query: q, items: [], sel: 0 });
		const hits = await rpc<{ entity: string; entity_id: number; title: string }[]>("search", q, 12).catch(() => []);
		const items = hits
			.filter((h) => MENTION_ENTITY[h.entity])
			.map((h) => {
				const type = MENTION_ENTITY[h.entity]!;
				const key = h.title.split(" ")[0]!;
				const ref: ContextRef =
					type === "task" || type === "project"
						? { type, ref: key, label: h.title.slice(0, 60) }
						: type === "person"
							? { type, ref: h.title, label: h.title }
							: { type: type as "doc" | "goal", ref: h.entity_id, label: h.title.slice(0, 60) };
				return { ref, label: h.title.slice(0, 70), icon: CONTEXT_ICON[type]! };
			});
		setMention({ query: q, items, sel: 0 });
	};
	const pickMention = (item: { ref: ContextRef }) => {
		const el = input;
		const before = el.value.slice(0, el.selectionStart).replace(/@[\p{L}\p{N}_-]*$/u, "");
		setDraft(before + el.value.slice(el.selectionStart));
		setContext((c) => [...c.filter((x) => JSON.stringify(x) !== JSON.stringify(item.ref)), item.ref]);
		setMention(null);
		queueMicrotask(() => input.focus());
	};
	const slash = createMemo(() => {
		const d = draft();
		if (!d.startsWith("/") || d.includes("\n")) return [];
		return SLASH.filter((s) => s.cmd.startsWith(d.split(" ")[0]!));
	});

	const attach = async (files: FileList | null) => {
		if (!files?.length) return;
		const form = new FormData();
		for (const f of files) form.append("file", f);
		const res = await fetch("/api/files", { method: "POST", body: form, headers: wsHeaders() }).then((r) => r.json());
		if (res.error) return toast(res.error.message, "error");
		setContext((c) => [...c, ...res.data.map((d: { id: number; title: string }) => ({ type: "doc" as const, ref: d.id, label: d.title }))]);
		toast(`${fa(res.data.length)} فایل به دانش اضافه و ضمیمه شد`, "win");
	};

	const editAndResend = async (m: UserMessage) => {
		const answer = await ask({ title: "ویرایش پیام", description: "در یک شاخه‌ی جدید ادامه می‌دهد؛ گفتگوی فعلی دست‌نخورده می‌ماند.", fields: [{ name: "text", label: "پیام", type: "textarea", value: m.text }], confirm: "ارسال" });
		if (!answer?.text.trim()) return;
		const prev = chat.state.messages.filter((x) => x.id < m.id).at(-1);
		let target: number | null = null;
		if (prev) target = await chat.fork(prev.id);
		openThread(target);
		setTimeout(() => {
			setContext(m.context);
			void send(answer.text.trim());
		}, 350);
	};

	const shownThreads = createMemo(() => {
		const q = filter().trim();
		const ws = workspace();
		return (threads() ?? []).filter((t) => (!q || t.title.includes(q)) && (ws === "all" || !t.workspace || t.workspace === ws));
	});

	onMount(() => input?.focus());

	return (
		<div class="chat-layout" classList={{ compact: props.compact }}>
			<aside class="chat-threads">
				<Btn kind="primary" style={{ width: "100%" }} onClick={() => (openThread(null), queueMicrotask(() => input?.focus()))}>
					＋ گفتگوی جدید
				</Btn>
				<input class="chat-search" placeholder="جستجوی گفتگوها…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
				<div class="stack" style={{ gap: "2px", "margin-top": "8px" }}>
					<For each={shownThreads()} fallback={<div class="faint small" style={{ padding: "8px" }}>گفتگویی نیست.</div>}>
						{(t) => (
							<a
								class="thread-item"
								classList={{ on: t.id === threadId() }}
								href={`#/assistant/${t.id}`}
								onClick={(e) => {
									if (!props.compact) return;
									e.preventDefault();
									openThread(t.id);
								}}
							>
								<span>{t.pinned ? "📌" : t.origin === "automation" ? "⚙️" : (PROVIDER_ICON[t.provider] ?? "•")}</span>
								<span class="thread-title">{t.title.replace(/^⚙️\s*/, "")}</span>
								<span class="thread-meta faint small">
									{ago(t.updated_at)} · {fa(Math.ceil(t.count / 2))}
									<span class="thread-ops">
										<button
											type="button"
											title="تغییر نام"
											onClick={async (e) => {
												e.preventDefault();
												const a = await ask({ title: "نام گفتگو", fields: [{ name: "title", label: "نام", value: t.title, required: true }] });
												if (a) rpc("renameThread", t.id, a.title).then(refetchThreads);
											}}
										>
											✎
										</button>
										<button
											type="button"
											title={t.pinned ? "برداشتن سنجاق" : "سنجاق"}
											onClick={(e) => {
												e.preventDefault();
												void rpc("pinThread", t.id, !t.pinned).then(refetchThreads);
											}}
										>
											📌
										</button>
										<button
											type="button"
											title="حذف"
											onClick={async (e) => {
												e.preventDefault();
												if (await confirmAction(`«${t.title}» حذف شود؟`)) {
													await rpc("deleteThread", t.id);
													refetchThreads();
													if (t.id === threadId()) openThread(null);
												}
											}}
										>
											🗑
										</button>
									</span>
								</span>
							</a>
						)}
					</For>
				</div>
			</aside>

			<section class="chat-main">
				<div class="chat-head">
					<h2 class="chat-title">{chat.state.thread?.title ?? "دستیار گام"}</h2>
					<span class="spacer" />
					<Show when={providers()}>
						<Choice
							value={provider()}
							options={providers()!.providers.map((p) => ({ value: p.id, label: `${PROVIDER_ICON[p.id] ?? ""} ${p.label}${p.available ? "" : " · در دسترس نیست"}`, disabled: !p.available }))}
							onChange={(v) => remember(v, null)}
						/>
						<Show when={current()?.models.length}>
							<Choice
								class="ltr"
								value={model() ?? ""}
								options={[{ value: "", label: `پیش‌فرض${current()?.defaultModel ? ` (${current()!.defaultModel})` : ""}` }, ...current()!.models.map((m) => ({ value: m.id, label: m.label }))]}
								onChange={(v) => remember(provider(), v || null)}
							/>
						</Show>
						<Show when={current()?.effort}>
							<SegmentGroup.Root size="xs" value={effort()} onValueChange={(e) => e.value && (setEffort(e.value), void rpc("setSetting", "effort", e.value))}>
								<SegmentGroup.Indicator />
								<SegmentGroup.Items items={EFFORTS.map((x) => ({ value: x, label: EFFORT_FA[x] }))} />
							</SegmentGroup.Root>
						</Show>
					</Show>
					<AiSettingsButton />
				</div>
				<Show when={current() && !current()!.toolsInGaam}>
					<div class="chat-note">ابزارها داخل {current()!.label} اجرا می‌شوند؛ کارهای حذفی برایش خاموش است. برای تأیید قدم‌به‌قدم، Claude API را انتخاب کن.</div>
				</Show>

				<div
					class="chat-scroll"
					ref={scroller}
					onScroll={onScroll}
					onWheel={unstickUp}
				>
					<Show when={!threadId() && !chat.state.messages.length}>
						<div class="chat-empty">
							<div class="chat-empty-mark">✳️</div>
							<h2>چه کاری برایت انجام بدهم؟</h2>
							<p class="muted">به همه‌ی گام دسترسی دارم: تسک می‌سازم، نقشه ذهنی می‌کشم، اولویت می‌دهم، از جیرا و گیت می‌خوانم (فقط خواندن). با @ چیزی را ضمیمه کن، با / دستورهای آماده را ببین.</p>
							<div class="chat-suggest">
								<For each={SLASH.slice(0, 6)}>
									{(s) => (
										<button
											type="button"
											onClick={() => {
												if (s.text.endsWith(": ")) {
													setDraft(s.text);
													input.focus();
												} else void send(s.text);
											}}
										>
											<b>{s.label}</b>
											<span class="faint ltr">{s.cmd}</span>
										</button>
									)}
								</For>
							</div>
						</div>
					</Show>
					<div class="chat-thread" ref={thread}>
						<For each={chat.state.messages}>
							{(m: ChatMessage, i) =>
								m.role === "user" ? (
									<UserBubble m={m} onEdit={() => editAndResend(m)} />
								) : (
									<BotBlock
										m={m}
										last={i() === chat.state.messages.length - 1}
										startedAt={chat.state.startedAt}
										onApprove={(id, ok) => void chat.approve(id, ok)}
										onRegenerate={() => void chat.regenerate({ provider: provider(), model: model(), effort: current()?.effort ? effort() : null })}
										onFork={async () => {
											const id = await chat.fork(m.id);
											refetchThreads();
											openThread(id);
										}}
									/>
								)
							}
						</For>
					</div>
				</div>
				<Show when={!stuck()}>
					<button type="button" class="chat-jump" onClick={() => (setStuck(true), toBottom())}>
						↓
					</button>
				</Show>

				<div class="composer2">
					<Show when={mention()}>
						<div class="c-pop">
							<For each={mention()!.items} fallback={<div class="faint small" style={{ padding: "6px 10px" }}>{mention()!.query ? "چیزی پیدا نشد" : "اسم تسک، پروژه، آدم یا سند را بنویس…"}</div>}>
								{(item, i) => (
									<button type="button" classList={{ sel: mention()!.sel === i() }} onMouseDown={(e) => (e.preventDefault(), pickMention(item))}>
										{item.icon} {item.label}
									</button>
								)}
							</For>
						</div>
					</Show>
					<Show when={!mention() && slash().length}>
						<div class="c-pop">
							<For each={slash()}>
								{(s) => (
									<button type="button" onMouseDown={(e) => (e.preventDefault(), setDraft(s.text), input.focus(), queueMicrotask(autosize))}>
										<span class="ltr faint">{s.cmd}</span> {s.label}
									</button>
								)}
							</For>
						</div>
					</Show>
					<Show when={context().length}>
						<div class="c-ctx-row">
							<For each={context()}>
								{(c) => (
									<Tag>
										{CONTEXT_ICON[c.type]} {c.label ?? ("ref" in c ? String(c.ref) : c.route)}
										<button type="button" class="tag-x" onClick={() => setContext((x) => x.filter((y) => y !== c))}>
											×
										</button>
									</Tag>
								)}
							</For>
						</div>
					</Show>
					<div class="composer2-box">
						<label class="c-attach" title="ضمیمه‌ی فایل (به «دانش» اضافه می‌شود)">
							📎
							<input type="file" multiple hidden onChange={(e) => void attach(e.currentTarget.files)} />
						</label>
						<textarea
							ref={input}
							rows="1"
							placeholder="بنویس… (@ برای ضمیمه، / برای دستورها)"
							value={draft()}
							onInput={(e) => (setDraft(e.currentTarget.value), void onInput())}
							onKeyDown={(e) => {
								const mm = mention();
								if (mm && mm.items.length) {
									if (e.key === "ArrowDown") return (e.preventDefault(), setMention({ ...mm, sel: Math.min(mm.sel + 1, mm.items.length - 1) }));
									if (e.key === "ArrowUp") return (e.preventDefault(), setMention({ ...mm, sel: Math.max(mm.sel - 1, 0) }));
									if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), pickMention(mm.items[mm.sel]!));
								}
								if (e.key === "Escape") {
									if (mm) return setMention(null);
									if (chat.state.running) void chat.stop();
								}
								if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
									e.preventDefault();
									void send();
								}
							}}
						/>
						<Show
							when={chat.state.running}
							fallback={
								<Btn kind="primary" disabled={!draft().trim()} onClick={() => void send()}>
									ارسال
								</Btn>
							}
						>
							<Btn onClick={() => void chat.stop()}>■ توقف</Btn>
						</Show>
					</div>
					<div class="composer2-hint faint small">
						Enter ارسال · Shift+Enter خط جدید · Esc توقف · {current() ? `${PROVIDER_ICON[current()!.id] ?? ""} ${current()!.label}` : ""}
						{workspace() !== "all" ? ` · ورک‌اسپیس ${workspace()}` : ""}
					</div>
				</div>
			</section>
		</div>
	);
}

/** Starts a conversation about something on another page, with it attached as context. */
export async function askAbout(text: string, context: ContextRef[] = []) {
	const s = providers();
	const provider = s?.settings.provider ?? s?.providers.find((p) => p.available)?.id ?? "claude";
	const res = await fetch("/api/assistant", {
		method: "POST",
		headers: wsHeaders({ "Content-Type": "application/json" }),
		body: JSON.stringify({ text, context: [{ type: "page", route: route() }, ...context], provider }),
	}).then((r) => r.json());
	if (res.error) return toast(res.error.message, "error");
	go(`/assistant/${res.data.thread}`);
}
