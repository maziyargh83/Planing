import { Btn, Choice, Panel, Tag, TextArea, TextInput } from "~/components/app.tsx";
import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { confirmAction } from "~/kit.tsx";
import * as SwitchUI from "~/components/ui/switch";

import { ago, type Automation, fa, type Message, rpc, toast, version } from "../api.ts";
import { Markdown } from "../markdown.tsx";
import { go } from "../ui.tsx";
import { PROVIDER_ICON, type ProviderStatus, providers } from "./Chat.tsx";

export { AssistantPage } from "./Chat.tsx";
export { Markdown, PROVIDER_ICON };

export function useProviders() {
	return { status: providers };
}

export function ProviderPicker(props: { provider: string; model: string | null; onChange: (provider: string, model: string | null) => void; providers: ProviderStatus[] }) {
	const current = () => props.providers.find((p) => p.id === props.provider);
	return (
		<div class="row">
			<Choice
				value={props.provider}
				options={props.providers.map((p) => ({ value: p.id, label: `${PROVIDER_ICON[p.id] ?? ""} ${p.label}${p.available ? "" : " · در دسترس نیست"}`, disabled: !p.available }))}
				onChange={(v) => props.onChange(v, null)}
			/>
			<Show when={current()?.models.length}>
				<Choice
					class="ltr"
					value={props.model ?? ""}
					options={[{ value: "", label: `پیش‌فرض${current()?.defaultModel ? ` (${current()!.defaultModel})` : ""}` }, ...current()!.models.map((m) => ({ value: m.id, label: m.label }))]}
					onChange={(v) => props.onChange(props.provider, v || null)}
				/>
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
				<Btn
				
					onClick={() =>
						rpc("saveAutomation", { name: "اتوماسیون جدید", schedule: "daily 10:00", kind: "agent", prompt: "", enabled: false }).then((a) => (refetch(), setOpen(a.id)))
					}
				>
					+ اتوماسیون
				</Btn>
			</div>
			<div class="small muted" style={{ "margin-bottom": "12px" }}>
				زمان‌بندی: <span class="ltr">every 30m · daily 09:00 · weekdays 09:00 (شنبه تا چهارشنبه) · weekly wed 17:00 · sat,mon 08:30</span>
			</div>
			<div class="stack" style={{ gap: "10px" }}>
				<For each={list()}>
					{(a) => (
						<Panel style={{ opacity: a.enabled ? 1 : 0.65 }}>
							<div class="row wrap">
								<SwitchUI.Root checked={Boolean(a.enabled)} onCheckedChange={(e) => save(a.id, { enabled: e.checked })} colorPalette="green" size="sm">
									<SwitchUI.HiddenInput />
									<SwitchUI.Control>
										<SwitchUI.Thumb />
									</SwitchUI.Control>
								</SwitchUI.Root>
								<b>{a.name}</b>
								<Tag>{KIND_FA[a.kind]}</Tag>
								<Tag class="ltr">{a.schedule}</Tag>
								<Show when={a.kind === "agent"}>
									<Tag>{PROVIDER_ICON[a.provider ?? status()?.settings.provider ?? "claude"]} {a.provider ?? "پیش‌فرض"}</Tag>
								</Show>
								<span class="spacer" />
								<span class="small faint">
									<Show when={a.running} fallback={<>آخرین: {a.last_run_at ? ago(a.last_run_at) : "هرگز"} · بعدی: {when(a.next_run_at)}</>}>
										<span style={{ color: "var(--accent)" }}>● در حال اجرا…</span>
									</Show>
								</span>
								<Tag classList={{ "st-done": a.last_status === "ok", "st-blocked": a.last_status === "error" }}>
									{a.last_status === "ok" ? "✓" : a.last_status === "error" ? "✕" : "·"}
								</Tag>
								<Btn kind="sm" disabled={a.running} onClick={() => rpc("runAutomation", a.id).then(() => (toast(`${a.name} شروع شد`), setTimeout(refetch, 300)))}>
									▶ اجرا
								</Btn>
								<Show when={a.thread_id}>
									<Btn kind="ghost sm" onClick={() => go(`/assistant/${a.thread_id}`)}>
										گفتگو
									</Btn>
								</Show>
								<Btn kind="ghost sm" onClick={() => setOpen(open() === a.id ? null : a.id)}>
									{open() === a.id ? "▲" : "▼"}
								</Btn>
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
										<TextInput value={a.name} onChange={(e) => save(a.id, { name: e.currentTarget.value })} />
									</label>
									<label>
										<div class="field-label">زمان‌بندی</div>
										<TextInput class="ltr" value={a.schedule} onChange={(e) => save(a.id, { schedule: e.currentTarget.value })} />
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
									<TextArea rows="8" value={a.prompt ?? ""} onChange={(e) => save(a.id, { prompt: e.currentTarget.value })} />
								</Show>
								<Show when={a.last_output}>
									<div class="field-label" style={{ "margin-top": "10px" }}>آخرین خروجی</div>
									<Panel style={{ background: "var(--bg-2)" }}>
										<Markdown text={a.last_output!} />
									</Panel>
								</Show>
								<div class="row" style={{ "margin-top": "10px" }}>
									<span class="spacer" />
									<Btn kind="ghost sm danger" onClick={async () => (await confirmAction(`«${a.name}» حذف شود؟`)) && rpc("deleteAutomation", a.id).then(refetch)}>
										حذف
									</Btn>
								</div>
							</Show>
						</Panel>
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
			<Panel class="brief">
				<h3>
					☀️ بریف امروز <span class="faint small">· {ago(brief()!.created_at)}</span>
					<span class="spacer" />
					<Btn kind="ghost sm" onClick={() => go(`/assistant/${brief()!.thread_id}`)}>
						ادامه در گفتگو ←
					</Btn>
				</h3>
				<Markdown text={brief()!.content} />
			</Panel>
		</Show>
	);
}

export { fa };
