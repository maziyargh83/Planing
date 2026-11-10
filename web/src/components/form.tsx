/**
 * Friendly form building blocks. Every field says what it is for, offers the
 * likely answers as one-tap choices, and shows dates in the Persian calendar.
 */
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { createResource } from "../live.ts";
import { createStore } from "solid-js/store";

import * as Popover from "~/components/ui/popover";
import { fa, rpc } from "../api.ts";
import { skeleton } from "../capture.ts";

// ── Save feedback ──────────────────────────────────────────────────────────

const [saveState, setSaveState] = createStore({ pending: 0, last: 0, failed: false });
export { saveState };

/** Wraps an autosave call so the UI can show "saving… / saved ✓". */
export async function autosave<T>(run: () => Promise<T>): Promise<T> {
	setSaveState("pending", (n) => n + 1);
	try {
		const r = await run();
		setSaveState({ last: Date.now(), failed: false });
		return r;
	} catch (e) {
		setSaveState("failed", true);
		throw e;
	} finally {
		setSaveState("pending", (n) => n - 1);
	}
}

export function SaveIndicator() {
	const [, tick] = createSignal(0);
	const t = setInterval(() => tick((x) => x + 1), 1500);
	onCleanup(() => clearInterval(t));
	return (
		<span class="save-ind" classList={{ busy: saveState.pending > 0, fail: saveState.failed }}>
			{saveState.pending > 0 ? "در حال ذخیره…" : saveState.failed ? "ذخیره نشد" : saveState.last && Date.now() - saveState.last < 4000 ? "ذخیره شد ✓" : "تغییرها خودکار ذخیره می‌شوند"}
		</span>
	);
}

// ── Field shell ────────────────────────────────────────────────────────────

export function Field(props: { label: string; hint?: string; help?: JSX.Element; children: JSX.Element; class?: string; wide?: boolean }) {
	const [open, setOpen] = createSignal(false);
	return (
		<div class={`ff ${props.class ?? ""}`} classList={{ wide: props.wide }}>
			<div class="ff-label">
				<span>{props.label}</span>
				<Show when={props.help}>
					<button type="button" class="ff-help" title="راهنما" onClick={() => setOpen(!open())}>
						؟
					</button>
				</Show>
			</div>
			<Show when={open() && props.help}>
				<div class="ff-helpbox">{props.help}</div>
			</Show>
			{props.children}
			<Show when={props.hint}>
				<div class="ff-hint">{props.hint}</div>
			</Show>
		</div>
	);
}

// ── Pills: one-tap choices ─────────────────────────────────────────────────

export interface PillOption<T extends string | number> {
	value: T;
	label: string;
	icon?: string;
	hint?: string;
	tone?: "green" | "amber" | "red" | "blue" | "violet" | "gray";
}

export function Pills<T extends string | number>(props: { value: T | null | undefined; options: PillOption<T>[]; onChange: (v: T) => void; size?: "sm" | "md"; label?: string }) {
	const current = () => props.options.find((o) => o.value === props.value);
	return (
		<div>
			<div class="pills" classList={{ sm: props.size === "sm" }} role="radiogroup" aria-label={props.label}>
				<For each={props.options}>
					{(o) => (
						<button
							type="button"
							role="radio"
							aria-checked={o.value === props.value}
							class={`pill tone-${o.tone ?? "gray"}`}
							classList={{ on: o.value === props.value }}
							title={o.hint}
							onClick={() => props.onChange(o.value)}
						>
							<Show when={o.icon}>
								<span>{o.icon}</span>
							</Show>
							{o.label}
						</button>
					)}
				</For>
			</div>
			<Show when={current()?.hint}>
				<div class="ff-hint">{current()!.hint}</div>
			</Show>
		</div>
	);
}

// ── Persian dates ──────────────────────────────────────────────────────────

const PART = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", { year: "numeric", month: "numeric", day: "numeric" });
const MONTH = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "long", year: "numeric" });
const LONG = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "long", day: "numeric", month: "long" });

export const isoOf = (d: Date) => d.toLocaleDateString("en-CA");
const dateOf = (iso: string) => new Date(`${iso}T12:00:00`);
function persian(d: Date) {
	const p = Object.fromEntries(PART.formatToParts(d).map((x) => [x.type, Number(x.value)]));
	return { y: p.year!, m: p.month!, d: p.day! };
}
function addDays(d: Date, n: number) {
	const x = new Date(d);
	x.setDate(x.getDate() + n);
	return x;
}
function nextWeekday(day: number) {
	let d = addDays(new Date(), 1);
	while (d.getDay() !== day) d = addDays(d, 1);
	return d;
}

/** "امروز"، "فردا"، "۳ روز دیگر"، "۲ روز پیش" */
export function relativeDay(iso: string): string {
	const diff = Math.round((dateOf(iso).getTime() - dateOf(isoOf(new Date())).getTime()) / 864e5);
	if (diff === 0) return "امروز";
	if (diff === 1) return "فردا";
	if (diff === -1) return "دیروز";
	if (diff === 2) return "پس‌فردا";
	return diff > 0 ? `${fa(diff)} روز دیگر` : `${fa(-diff)} روز پیش`;
}

export function longDate(iso: string) {
	return LONG.format(dateOf(iso));
}

function MonthGrid(props: { value: string | null; onPick: (iso: string) => void }) {
	const [anchor, setAnchor] = createSignal(props.value ? dateOf(props.value) : new Date());
	const days = createMemo(() => {
		let start = anchor();
		while (persian(start).d > 1) start = addDays(start, -1);
		const month = persian(start).m;
		const out: (Date | null)[] = Array.from({ length: (start.getDay() + 1) % 7 }, () => null);
		for (let d = start; persian(d).m === month; d = addDays(d, 1)) out.push(d);
		return out;
	});
	const today = isoOf(new Date());
	return (
		<div class="mgrid">
			<div class="mgrid-head">
				<button type="button" onClick={() => setAnchor(addDays(days().find(Boolean)!, -3))}>
					›
				</button>
				<b>{MONTH.format(days().find(Boolean)!)}</b>
				<button type="button" onClick={() => setAnchor(addDays(days().find(Boolean)!, 33))}>
					‹
				</button>
			</div>
			<div class="mgrid-days">
				<For each={["ش", "ی", "د", "س", "چ", "پ", "ج"]}>{(w) => <span class="faint">{w}</span>}</For>
				<For each={days()}>
					{(d) =>
						d ? (
							<button type="button" classList={{ on: isoOf(d) === props.value, today: isoOf(d) === today, past: isoOf(d) < today }} onClick={() => props.onPick(isoOf(d))}>
								{fa(persian(d).d)}
							</button>
						) : (
							<span />
						)
					}
				</For>
			</div>
		</div>
	);
}

export function DateField(props: { value: string | null | undefined; onChange: (iso: string | null) => void; placeholder?: string; allowClear?: boolean }) {
	const [open, setOpen] = createSignal(false);
	const quick = () => [
		{ label: "امروز", iso: isoOf(new Date()) },
		{ label: "فردا", iso: isoOf(addDays(new Date(), 1)) },
		{ label: "شنبه", iso: isoOf(nextWeekday(6)) },
		{ label: "چهارشنبه", iso: isoOf(nextWeekday(3)) },
		{ label: "هفته‌ی بعد", iso: isoOf(addDays(new Date(), 7)) },
	];
	const pick = (iso: string | null) => {
		props.onChange(iso);
		setOpen(false);
	};
	const overdue = () => props.value && props.value < isoOf(new Date());
	return (
		<Popover.Root open={open()} onOpenChange={(e) => setOpen(e.open)} positioning={{ placement: "bottom-start" }} lazyMount>
			<Popover.Trigger class="datef" classList={{ empty: !props.value, overdue: Boolean(overdue()) }}>
				<span>📅</span>
				<Show when={props.value} fallback={<span class="faint">{props.placeholder ?? "بدون تاریخ"}</span>}>
					<span>{longDate(props.value!)}</span>
					<span class="datef-rel">{relativeDay(props.value!)}</span>
				</Show>
			</Popover.Trigger>
			<Popover.Positioner>
				<Popover.Content class="datef-pop">
					<div class="pills sm" style={{ "margin-bottom": "8px" }}>
						<For each={quick()}>
							{(q) => (
								<button type="button" class="pill" classList={{ on: q.iso === props.value }} onClick={() => pick(q.iso)}>
									{q.label}
								</button>
							)}
						</For>
						<Show when={props.allowClear !== false && props.value}>
							<button type="button" class="pill tone-red" onClick={() => pick(null)}>
								✕ بدون تاریخ
							</button>
						</Show>
					</div>
					<MonthGrid value={props.value ?? null} onPick={pick} />
				</Popover.Content>
			</Popover.Positioner>
		</Popover.Root>
	);
}

// ── Hours ──────────────────────────────────────────────────────────────────

const HOUR_PRESETS = [
	{ v: 0.5, label: "نیم ساعت" },
	{ v: 1, label: "۱ ساعت" },
	{ v: 2, label: "۲ ساعت" },
	{ v: 4, label: "نصف روز" },
	{ v: 8, label: "یک روز" },
];

export function HoursField(props: { value: number | null | undefined; onChange: (h: number | null) => void }) {
	const custom = () => props.value != null && !HOUR_PRESETS.some((p) => p.v === props.value);
	return (
		<div class="pills sm">
			<For each={HOUR_PRESETS}>
				{(p) => (
					<button type="button" class="pill" classList={{ on: props.value === p.v }} onClick={() => props.onChange(props.value === p.v ? null : p.v)}>
						{p.label}
					</button>
				)}
			</For>
			<label class="pill hours-custom" classList={{ on: custom() }}>
				<input
					type="number"
					min="0"
					step="0.5"
					placeholder="…"
					value={custom() ? String(props.value) : ""}
					onChange={(e) => props.onChange(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
				/>
				ساعت
			</label>
		</div>
	);
}

// ── ICE score ──────────────────────────────────────────────────────────────

const ICE_TEXT: Record<"impact" | "confidence" | "ease", [string, string, string, string]> = {
	impact: ["تأثیر", "چقدر هدف را جلو می‌برد؟", "کم: ظاهری", "زیاد: اهرم اصلی"],
	confidence: ["اطمینان", "چقدر مطمئنی جواب می‌دهد؟", "کم: حدس", "زیاد: داده داریم"],
	ease: ["سهولت", "چقدر کم‌هزینه است؟", "کم: یک ماه کار", "زیاد: کمتر از یک ساعت"],
};

export function ScoreField(props: { kind: "impact" | "confidence" | "ease"; value: number | null; onChange: (v: number) => void }) {
	const t = ICE_TEXT[props.kind];
	return (
		<div class="score">
			<div class="score-head">
				<b>{t[0]}</b>
				<span class="faint small">{t[1]}</span>
				<span class="spacer" />
				<b class="score-v">{props.value == null ? "—" : fa(props.value)}</b>
			</div>
			<div class="score-scale">
				<For each={Array.from({ length: 10 }, (_, i) => i + 1)}>
					{(n) => (
						<button type="button" classList={{ on: props.value != null && n <= props.value, cur: n === props.value }} style={{ "--i": n }} onClick={() => props.onChange(n)} aria-label={`${t[0]} ${n}`}>
							{fa(n)}
						</button>
					)}
				</For>
			</div>
			<div class="score-ends faint small">
				<span>{t[2]}</span>
				<span>{t[3]}</span>
			</div>
		</div>
	);
}

// ── Person picker ──────────────────────────────────────────────────────────

const [people] = createResource(() => rpc<{ id: number; name: string; relation: string }[]>("people").catch(() => []));
export { people };

export function PersonField(props: { value: string | null | undefined; onChange: (name: string | null) => void; placeholder?: string }) {
	const [query, setQuery] = createSignal("");
	const [focus, setFocus] = createSignal(false);
	const matches = createMemo(() => {
		const q = query().trim().toLowerCase();
		const list = people() ?? [];
		if (!q) return list.slice(0, 6);
		const sk = skeleton(q);
		return list.filter((p) => p.name.toLowerCase().includes(q) || (sk.length > 1 && skeleton(p.name.split(" ")[0]!).startsWith(sk))).slice(0, 6);
	});
	return (
		<div class="personf">
			<Show
				when={props.value}
				fallback={
					<input
						class="personf-input"
						placeholder={props.placeholder ?? "اسم را بنویس (فارسی یا انگلیسی)…"}
						value={query()}
						onInput={(e) => setQuery(e.currentTarget.value)}
						onFocus={() => setFocus(true)}
						onBlur={() => setTimeout(() => setFocus(false), 150)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								const first = matches()[0];
								if (first) props.onChange(first.name);
								else if (query().trim()) props.onChange(query().trim());
							}
						}}
					/>
				}
			>
				<span class="personf-chip">
					👤 {props.value}
					<button type="button" onClick={() => (props.onChange(null), setQuery(""))}>
						×
					</button>
				</span>
			</Show>
			<Show when={!props.value && focus()}>
				<div class="personf-pop">
					<For each={matches()}>
						{(p) => (
							<button type="button" onMouseDown={(e) => (e.preventDefault(), props.onChange(p.name))}>
								{p.name}
								<span class="faint small"> · {({ manager: "مدیر", report: "تیم من", peer: "هم‌تیمی", product: "پروداکت" } as Record<string, string>)[p.relation] ?? ""}</span>
							</button>
						)}
					</For>
					<Show when={query().trim() && !matches().some((m) => m.name.toLowerCase() === query().trim().toLowerCase())}>
						<button type="button" onMouseDown={(e) => (e.preventDefault(), props.onChange(query().trim()))}>
							＋ آدم جدید: «{query().trim()}»
						</button>
					</Show>
				</div>
			</Show>
		</div>
	);
}

// ── Inline editing ─────────────────────────────────────────────────────────

/**
 * Text that edits in place: it reads like text, shows a pencil on hover, and
 * saves when you leave it. Enter saves (⌘Enter when multiline), Esc reverts.
 */
export function Inline(props: {
	value: string | null | undefined;
	onSave: (v: string) => unknown;
	placeholder?: string;
	multiline?: boolean;
	size?: "sm" | "md" | "lg" | "xl";
	label?: string;
	ltr?: boolean;
	/** Empty saves are ignored (for titles). */
	required?: boolean;
}) {
	const [flash, setFlash] = createSignal(false);
	const commit = async (el: HTMLTextAreaElement) => {
		const v = el.value.trim();
		if (v === (props.value ?? "").trim()) return;
		if (!v && props.required) return void (el.value = props.value ?? "");
		await autosave(async () => props.onSave(v));
		setFlash(true);
		setTimeout(() => setFlash(false), 900);
	};
	return (
		<div class={`inl inl-${props.size ?? "md"}`} classList={{ multi: props.multiline, ltr: props.ltr, saved: flash() }}>
			<textarea
				rows="1"
				aria-label={props.label ?? props.placeholder}
				placeholder={props.placeholder}
				value={props.value ?? ""}
				onKeyDown={(e) => {
					const el = e.currentTarget;
					if (e.key === "Escape") {
						el.value = props.value ?? "";
						el.blur();
					} else if (e.key === "Enter" && !e.isComposing && (!props.multiline || e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						el.blur();
					}
				}}
				onBlur={(e) => void commit(e.currentTarget)}
			/>
			<span class="inl-pen" aria-hidden="true">
				✎
			</span>
		</div>
	);
}

export function TitleField(props: { value: string; onSave: (v: string) => void; size?: "lg" | "xl" }) {
	return <Inline value={props.value} onSave={props.onSave} size={props.size ?? "lg"} required label="عنوان" />;
}

/** A number with − / + buttons; the middle can also be typed into. */
export function Stepper(props: { value: number | null | undefined; onChange: (v: number | null) => unknown; step?: number; min?: number; label?: string; placeholder?: string }) {
	const step = () => props.step ?? 1;
	const set = (v: number | null) => {
		if (v != null && props.min != null) v = Math.max(props.min, v);
		if (v !== (props.value ?? null)) void autosave(async () => props.onChange(v));
	};
	return (
		<div class="numstep" role="group" aria-label={props.label}>
			<button type="button" aria-label="کمتر" onClick={() => set((props.value ?? 0) - step())}>
				−
			</button>
			<input
				inputmode="decimal"
				aria-label={props.label}
				placeholder={props.placeholder ?? "—"}
				value={props.value == null ? "" : fa(props.value)}
				onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
				onBlur={(e) => {
					// Accept Persian digits too.
					const raw = e.currentTarget.value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٬,]/g, "").replace("٫", ".").trim();
					const n = raw === "" ? null : Number(raw);
					if (n == null || Number.isFinite(n)) set(n);
					e.currentTarget.value = props.value == null ? "" : fa(props.value);
				}}
			/>
			<button type="button" aria-label="بیشتر" onClick={() => set((props.value ?? 0) + step())}>
				+
			</button>
		</div>
	);
}
