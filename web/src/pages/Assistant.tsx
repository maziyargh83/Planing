import { createEffect, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import { confirmAction } from "~/kit.tsx";
import * as SwitchUI from "~/components/ui/switch";

import { ago, type Automation, fa, type Message, rpc, toast, version } from "../api.ts";
import { go, openTask, route } from "../ui.tsx";

interface ProviderStatus {
	id: "claude" | "codex" | "ollama";
	label: string;
	available: boolean;
	detail: string;
	models: string[];
	defaultModel: string | null;
}

export const PROVIDER_ICON: Record<string, string> = { claude: "✳️", codex: "◎", ollama: "🦙" };

const QUICK = [
	["☀️ برنامه‌ی امروزم را بچین", "برنامه‌ی امروزم را بچین: کانتکست گام را بخوان، سه کار مهم پیشنهاد بده و بعد از تأیید من ذخیره کن."],
	["💡 این ایده را پلن کن", "یک ایده دارم و می‌خواهم پلنش کنی (دیسکاوری، نقشه ذهنی، سؤال‌ها، تسک‌ها، اسکوپ). ایده: "],
	["🎯 وضعیت اهداف SFPM", "وضعیت اهداف SFPM چرخه‌ی فعلی را بررسی کن: برای هر هدف شواهد را ببین، بگو کدام عقب است و یک قدم مشخص برای این هفته پیشنهاد بده."],
	["🗣 استندآپ امروز", "استندآپ امروزم را از گام، گیت و جیرا بنویس (دیروز / امروز / مانع)."],
	["📈 مرور هفته", "مرور هفتگی‌ام را انجام بده و صادقانه کوچینگم کن."],
];

/** Tiny, safe Markdown: escapes HTML first, then headings, lists, bold, code and task keys. */
export function markdown(src: string): string {
	const esc = src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const inline = (s: string) =>
		s
			.replace(/`([^`]+)`/g, '<code class="ltr">$1</code>')
			.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
			.replace(/\b([A-Z][A-Z0-9]{0,9}-\d+)\b/g, '<span class="chip key md-key" data-key="$1">$1</span>');
	const out: string[] = [];
	let list: "ul" | "ol" | null = null;
	const close = () => {
		if (list) out.push(`</${list}>`);
		list = null;
	};
	for (const raw of esc.split("\n")) {
		const line = raw.trimEnd();
		const h = line.match(/^(#{1,4})\s+(.*)$/);
		const ul = line.match(/^\s*[-*•]\s+(.*)$/);
		const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
		if (h) {
			close();
			out.push(`<h4>${inline(h[2]!)}</h4>`);
		} else if (ul || ol) {
			const kind = ul ? "ul" : "ol";
			if (list !== kind) {
				close();
				out.push(`<${kind}>`);
				list = kind;
			}
			out.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
		} else if (!line.trim()) {
			close();
		} else {
			close();
			out.push(`<p>${inline(line)}</p>`);
		}
	}
	close();
	return out.join("");
}

export function Markdown(props: { text: string }) {
	return (
		<div
			class="md"
			innerHTML={markdown(props.text)}
			onClick={(e) => {
				const key = (e.target as HTMLElement).closest<HTMLElement>(".md-key")?.dataset.key;
				if (key) openTask(key);
			}}
		/>
	);
}

export function useProviders() {
	const [status, { refetch }] = createResource(() => rpc<{ providers: ProviderStatus[]; settings: Record<string, string> }>("aiStatus"));
	return { status, refetch };
}

export function ProviderPicker(props: { provider: string; model: string | null; onChange: (provider: string, model: string | null) => void; providers: ProviderStatus[] }) {
	const current = () => props.providers.find((p) => p.id === props.provider);
	return (
		<div class="row">
			<select class="input" style={{ width: "auto" }} value={props.provider} onChange={(e) => props.onChange(e.currentTarget.value, null)}>
				<For each={props.providers}>
					{(p) => (
						<option value={p.id} disabled={!p.available} selected={p.id === props.provider}>
							{PROVIDER_ICON[p.id]} {p.label}
							{p.available ? "" : " (در دسترس نیست)"}
						</option>
					)}
				</For>
			</select>
			<Show when={current()?.models.length}>
				<select class="input ltr" style={{ width: "auto" }} onChange={(e) => props.onChange(props.provider, e.currentTarget.value || null)}>
					<option value="" selected={!props.model}>
						default{current()?.defaultModel ? ` (${current()!.defaultModel})` : ""}
					</option>
					<For each={current()!.models}>
						{(m) => (
							<option value={m} selected={m === props.model}>
								{m}
							</option>
						)}
					</For>
				</select>
			</Show>
		</div>
	);
}

export function AssistantPage() {
	const threadId = () => {
		const m = route().match(/^\/assistant\/(\d+)/);
		return m ? Number(m[1]) : null;
	};
	const { status } = useProviders();
	const [threads] = createResource(version, () => rpc<{ id: number; title: string; provider: string; origin: string; updated_at: string; count: number }[]>("threads"));
	const [thread, { mutate, refetch }] = createResource(
		() => threadId(),
		(id) => rpc<{ id: number; title: string; provider: string; model: string | null; messages: Message[]; running: boolean }>("thread", id),
	);
	const [provider, setProvider] = createSignal<string>("claude");
	const [model, setModel] = createSignal<string | null>(null);
	const [draft, setDraft] = createSignal("");
	const [liveText, setLiveText] = createSignal("");
	const [liveTools, setLiveTools] = createSignal<string[]>([]);
	const [running, setRunning] = createSignal(false);
	let source: EventSource | null = null;
	let scroller!: HTMLDivElement;
	let input!: HTMLTextAreaElement;

	createEffect(() => {
		const s = status();
		if (!s || threadId()) return;
		setProvider(s.settings.provider ?? "claude");
		setModel(s.settings[`model.${s.settings.provider ?? "claude"}`] ?? null);
	});
	createEffect(
		on(thread, (t) => {
			if (!t) return;
			setProvider(t.provider);
			setModel(t.model);
			if (t.running && !source) follow(t.id);
			queueMicrotask(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
		}),
	);

	const follow = (id: number) => {
		source?.close();
		setRunning(true);
		setLiveText("");
		setLiveTools([]);
		source = new EventSource(`/api/assistant/${id}/stream`);
		const scroll = () => scroller && (scroller.scrollTop = scroller.scrollHeight);
		source.addEventListener("snapshot", (e) => {
			const snap = JSON.parse((e as MessageEvent).data);
			setLiveText(snap.text);
			setLiveTools(snap.tools);
			if (!snap.running) finish();
		});
		source.addEventListener("text", (e) => {
			setLiveText((t) => t + JSON.parse((e as MessageEvent).data).text);
			scroll();
		});
		source.addEventListener("tool", (e) => {
			setLiveTools((t) => [...t, JSON.parse((e as MessageEvent).data).name]);
			scroll();
		});
		source.addEventListener("done", (e) => {
			const { error } = JSON.parse((e as MessageEvent).data);
			if (error) toast(error, "error");
			finish();
		});
	};
	const finish = () => {
		source?.close();
		source = null;
		setRunning(false);
		refetch();
	};
	onCleanup(() => source?.close());

	const send = async (text = draft().trim()) => {
		if (!text || running()) return;
		setDraft("");
		const res = await fetch("/api/assistant", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ thread: threadId(), text, provider: provider(), model: model() }),
		}).then((r) => r.json());
		if (res.error) return toast(res.error.message, "error");
		const id = res.data.thread as number;
		if (thread())
			mutate({ ...thread()!, messages: [...thread()!.messages, { id: -1, thread_id: id, role: "user", content: text, tools: [], created_at: new Date().toISOString() }] });
		follow(id);
		if (id !== threadId()) go(`/assistant/${id}`);
	};

	const remember = (p: string, m: string | null) => {
		setProvider(p);
		setModel(m);
		rpc("setSetting", "provider", p);
		rpc("setSetting", `model.${p}`, m);
	};

	return (
		<div class="chat-layout">
			<aside class="chat-threads">
				<button class="btn primary" style={{ width: "100%", "justify-content": "center" }} onClick={() => (go("/assistant"), input?.focus())}>
					+ گفتگوی جدید
				</button>
				<div class="stack" style={{ gap: "2px", "margin-top": "10px" }}>
					<For each={threads()}>
						{(t) => (
							<a class="thread-item" classList={{ on: t.id === threadId() }} href={`#/assistant/${t.id}`}>
								<span>{t.origin === "automation" ? "⚙️" : PROVIDER_ICON[t.provider]}</span>
								<span class="thread-title">{t.title.replace(/^⚙️\s*/, "")}</span>
								<span class="faint small">{ago(t.updated_at)}</span>
							</a>
						)}
					</For>
				</div>
			</aside>

			<section class="chat-main">
				<div class="row chat-head">
					<h2 style={{ margin: 0, "font-size": "17px" }}>{thread()?.title ?? "دستیار گام"}</h2>
					<span class="spacer" />
					<Show when={status()}>
						<ProviderPicker provider={provider()} model={model()} providers={status()!.providers} onChange={remember} />
					</Show>
					<Show when={threadId()}>
						<button class="btn ghost sm danger" title="حذف گفتگو" onClick={async () => (await confirmAction("این گفتگو حذف شود؟")) && rpc("deleteThread", threadId()).then(() => go("/assistant"))}>
							🗑
						</button>
					</Show>
				</div>

				<div class="chat-scroll" ref={scroller}>
					<Show when={!threadId()}>
						<div class="chat-empty">
							<div style={{ "font-size": "38px" }}>✳️</div>
							<h2>چه کاری برایت انجام بدهم؟</h2>
							<p class="muted">دستیار به همه‌ی گام دسترسی دارد: تسک می‌سازد، نقشه ذهنی می‌کشد، اولویت می‌دهد، از جیرا و گیت می‌خواند. با اکانت خودت روی Claude Code یا Codex، یا آفلاین روی Ollama.</p>
							<div class="row wrap" style={{ "justify-content": "center", "margin-top": "14px" }}>
								<For each={QUICK}>
									{([label, prompt]) => (
										<button
											class="btn"
											onClick={() => {
												if (prompt!.endsWith(": ")) {
													setDraft(prompt!);
													input.focus();
												} else send(prompt!);
											}}
										>
											{label}
										</button>
									)}
								</For>
							</div>
						</div>
					</Show>
					<For each={thread()?.messages}>
						{(m) => (
							<div class={`msg ${m.role}`}>
								<Show when={m.tools.length}>
									<ToolTrail tools={m.tools} />
								</Show>
								<Show when={m.role === "user"} fallback={<Markdown text={m.content} />}>
									<div style={{ "white-space": "pre-wrap" }}>{m.content}</div>
								</Show>
							</div>
						)}
					</For>
					<Show when={running()}>
						<div class="msg assistant">
							<ToolTrail tools={liveTools()} live />
							<Show when={liveText()} fallback={<div class="typing"><i /><i /><i /></div>}>
								<Markdown text={liveText()} />
							</Show>
						</div>
					</Show>
				</div>

				<div class="composer">
					<textarea
						ref={input}
						rows="2"
						placeholder="بنویس… (Enter ارسال، Shift+Enter خط جدید)"
						value={draft()}
						onInput={(e) => setDraft(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
								e.preventDefault();
								send();
							}
						}}
					/>
					<Show
						when={running()}
						fallback={
							<button class="btn primary" disabled={!draft().trim()} onClick={() => send()}>
								ارسال
							</button>
						}
					>
						<button class="btn" onClick={() => rpc("stopThread", threadId())}>
							■ توقف
						</button>
					</Show>
				</div>
			</section>
		</div>
	);
}

function ToolTrail(props: { tools: string[]; live?: boolean }) {
	const counts = () => {
		const map = new Map<string, number>();
		for (const t of props.tools) map.set(t, (map.get(t) ?? 0) + 1);
		return [...map.entries()];
	};
	return (
		<div class="row wrap tool-trail">
			<For each={counts()}>
				{([name, n]) => (
					<span class="chip ltr">
						🛠 {name}
						{n > 1 ? ` ×${n}` : ""}
					</span>
				)}
			</For>
			<Show when={props.live}>
				<span class="faint small">در حال کار…</span>
			</Show>
		</div>
	);
}

// ── Automations ────────────────────────────────────────────────────────────

type AutomationRow = Automation & { running: boolean; next_run_at: string | null; invalid: string | null };

const KIND_FA: Record<string, string> = { agent: "ایجنت", jira_pull: "جیرا", git_sync: "گیت" };

export function AutomationsPage() {
	const [list, { refetch }] = createResource(version, () => rpc<AutomationRow[]>("automations"));
	const { status } = useProviders();
	const [open, setOpen] = createSignal<number | null>(null);
	const timer = setInterval(refetch, 5000);
	onCleanup(() => clearInterval(timer));
	const save = (id: number, patch: Record<string, unknown>) => rpc("saveAutomation", { id, ...patch }).then(refetch);
	const when = (iso: string | null) =>
		iso ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

	return (
		<>
			<div class="page-head">
				<div>
					<h1>اتوماسیون‌ها</h1>
					<p>کارهایی که گام خودش انجام می‌دهد، وقتی سرور روشن است. ایجنت‌ها بدون نظارت اجرا می‌شوند؛ اگر چیزی لازم داشته باشند از تو سؤال می‌پرسند.</p>
				</div>
				<button
					class="btn"
					onClick={() =>
						rpc("saveAutomation", { name: "اتوماسیون جدید", schedule: "daily 10:00", kind: "agent", prompt: "", enabled: false }).then((a) => (refetch(), setOpen(a.id)))
					}
				>
					+ اتوماسیون
				</button>
			</div>
			<div class="small muted" style={{ "margin-bottom": "12px" }}>
				زمان‌بندی: <span class="ltr">every 30m · daily 09:00 · weekdays 09:00 (شنبه تا چهارشنبه) · weekly wed 17:00 · sat,mon 08:30</span>
			</div>
			<div class="stack" style={{ gap: "10px" }}>
				<For each={list()}>
					{(a) => (
						<div class="card" style={{ opacity: a.enabled ? 1 : 0.65 }}>
							<div class="row wrap">
								<SwitchUI.Root checked={Boolean(a.enabled)} onCheckedChange={(e) => save(a.id, { enabled: e.checked })} colorPalette="green" size="sm">
									<SwitchUI.HiddenInput />
									<SwitchUI.Control>
										<SwitchUI.Thumb />
									</SwitchUI.Control>
								</SwitchUI.Root>
								<b>{a.name}</b>
								<span class="chip">{KIND_FA[a.kind]}</span>
								<span class="chip ltr">{a.schedule}</span>
								<Show when={a.kind === "agent"}>
									<span class="chip">{PROVIDER_ICON[a.provider ?? status()?.settings.provider ?? "claude"]} {a.provider ?? "پیش‌فرض"}</span>
								</Show>
								<span class="spacer" />
								<span class="small faint">
									<Show when={a.running} fallback={<>آخرین: {a.last_run_at ? ago(a.last_run_at) : "هرگز"} · بعدی: {when(a.next_run_at)}</>}>
										<span style={{ color: "var(--accent)" }}>● در حال اجرا…</span>
									</Show>
								</span>
								<span class="chip" classList={{ "st-done": a.last_status === "ok", "st-blocked": a.last_status === "error" }}>
									{a.last_status === "ok" ? "✓" : a.last_status === "error" ? "✕" : "·"}
								</span>
								<button class="btn sm" disabled={a.running} onClick={() => rpc("runAutomation", a.id).then(() => (toast(`${a.name} شروع شد`), setTimeout(refetch, 300)))}>
									▶ اجرا
								</button>
								<Show when={a.thread_id}>
									<button class="btn ghost sm" onClick={() => go(`/assistant/${a.thread_id}`)}>
										گفتگو
									</button>
								</Show>
								<button class="btn ghost sm" onClick={() => setOpen(open() === a.id ? null : a.id)}>
									{open() === a.id ? "▲" : "▼"}
								</button>
							</div>
							<Show when={a.invalid}>
								<div class="small st-blocked">{a.invalid}</div>
							</Show>
							<Show when={a.last_output && open() !== a.id}>
								<div class="small muted automation-output">{a.last_output!.slice(0, 220)}</div>
							</Show>
							<Show when={open() === a.id}>
								<div class="grid g3" style={{ "margin-top": "12px" }}>
									<label>
										<div class="field-label">نام</div>
										<input class="input" value={a.name} onChange={(e) => save(a.id, { name: e.currentTarget.value })} />
									</label>
									<label>
										<div class="field-label">زمان‌بندی</div>
										<input class="input ltr" value={a.schedule} onChange={(e) => save(a.id, { schedule: e.currentTarget.value })} />
									</label>
									<Show when={a.kind === "agent" && status()}>
										<div>
											<div class="field-label">مدل</div>
											<ProviderPicker
												provider={a.provider ?? status()!.settings.provider ?? "claude"}
												model={a.model}
												providers={status()!.providers}
												onChange={(p, m) => save(a.id, { provider: p, model: m })}
											/>
										</div>
									</Show>
								</div>
								<Show when={a.kind === "agent"}>
									<div class="field-label" style={{ "margin-top": "10px" }}>دستور ایجنت</div>
									<textarea class="textarea" rows="8" value={a.prompt ?? ""} onChange={(e) => save(a.id, { prompt: e.currentTarget.value })} />
								</Show>
								<Show when={a.last_output}>
									<div class="field-label" style={{ "margin-top": "10px" }}>آخرین خروجی</div>
									<div class="card" style={{ background: "var(--bg-2)" }}>
										<Markdown text={a.last_output!} />
									</div>
								</Show>
								<div class="row" style={{ "margin-top": "10px" }}>
									<span class="spacer" />
									<button class="btn ghost sm danger" onClick={async () => (await confirmAction(`«${a.name}» حذف شود؟`)) && rpc("deleteAutomation", a.id).then(refetch)}>
										حذف
									</button>
								</div>
							</Show>
						</div>
					)}
				</For>
			</div>
		</>
	);
}

/** Today's brief from the morning automation, shown on the Today page. */
export function BriefCard() {
	const [brief] = createResource(version, () => rpc<(Message & { automation: string; thread_id: number }) | null>("latestBrief"));
	const isToday = () => brief() && new Date(brief()!.created_at).toDateString() === new Date().toDateString();
	return (
		<Show when={isToday()}>
			<div class="card brief">
				<h3>
					☀️ بریف امروز <span class="faint small">· {ago(brief()!.created_at)}</span>
					<span class="spacer" />
					<button class="btn ghost sm" onClick={() => go(`/assistant/${brief()!.thread_id}`)}>
						ادامه در گفتگو ←
					</button>
				</h3>
				<Markdown text={brief()!.content} />
			</div>
		</Show>
	);
}

export { fa };
