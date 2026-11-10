/**
 * Assistant limits: how long a reply may be, how many tool steps a turn may
 * take, whether reasoning is shown, and spending budgets with today's usage.
 */
import { createSignal, Show } from "solid-js";

import { autosave, Field, Pills, Stepper } from "~/components/form.tsx";
import * as Popover from "~/components/ui/popover";
import { fa, rpc, version } from "../api.ts";
import { createResource } from "../live.ts";

interface Totals {
	turns: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costUsd: number;
}
interface Limits {
	maxTokens: number;
	maxSteps: number;
	thinkingDisplay: "summarized" | "omitted";
	turnTokens: number | null;
	dailyUsd: number | null;
	monthlyUsd: number | null;
	dailyTokens: number | null;
}
interface LimitsView {
	limits: Limits;
	defaults: Limits;
	usage: { today: Totals & { byProvider: Record<string, Totals> }; month: Totals };
}

/** 12_300 → «۱۲٫۳K» */
const short = (n: number) => (n >= 1e6 ? `${fa(Math.round(n / 1e5) / 10)}M` : n >= 1000 ? `${fa(Math.round(n / 100) / 10)}K` : fa(n));
// fa() rounds to whole numbers; money needs cents.
const money = new Intl.NumberFormat("fa-IR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n: number) => `$${money.format(n)}`;
const tokensOf = (t: Totals) => t.input + t.output + t.cacheRead + t.cacheWrite;

function Meter(props: { label: string; used: number; cap: number | null; format: (n: number) => string }) {
	const pct = () => (props.cap ? Math.min(100, (props.used / props.cap) * 100) : 0);
	return (
		<div class="ai-meter">
			<div class="row small">
				<span class="muted">{props.label}</span>
				<span class="spacer" />
				<b>{props.format(props.used)}</b>
				<Show when={props.cap}>
					<span class="faint">از {props.format(props.cap!)}</span>
				</Show>
			</div>
			<Show when={props.cap}>
				<div class="bar" classList={{ warn: pct() >= 80, full: pct() >= 100 }}>
					<i style={{ width: `${pct()}%` }} />
				</div>
			</Show>
		</div>
	);
}

export function AiSettingsButton() {
	const [open, setOpen] = createSignal(false);
	const [data, { refetch }] = createResource(version, () => rpc<LimitsView>("aiLimits"));
	const save = (patch: Partial<Record<keyof Limits, unknown>>) => autosave(() => rpc("saveAiLimits", patch)).then(() => refetch());
	const l = () => data()?.limits;
	const today = () => data()?.usage.today;

	return (
		<Popover.Root open={open()} onOpenChange={(e) => setOpen(e.open)} positioning={{ placement: "bottom-end" }} lazyMount>
			<Popover.Trigger class="ai-gear" title="تنظیمات و سقف‌های دستیار">
				<span>⚙</span>
				<Show when={today()}>
					<span class="ai-gear-usage">
						{short(tokensOf(today()!))} توکن<Show when={today()!.costUsd >= 0.005}> · {usd(today()!.costUsd)}</Show>
					</span>
				</Show>
			</Popover.Trigger>
			<Popover.Positioner>
				<Popover.Content class="ai-settings">
					<Show when={l()}>
						<div class="ai-section">
							<div class="ai-head">مصرف امروز</div>
							<Meter label="توکن (همه‌ی مدل‌ها)" used={tokensOf(today()!)} cap={l()!.dailyTokens} format={short} />
							<Meter label="هزینه‌ی Claude API" used={today()!.costUsd} cap={l()!.dailyUsd} format={usd} />
							<Meter label="هزینه‌ی این ماه" used={data()!.usage.month.costUsd} cap={l()!.monthlyUsd} format={usd} />
							<div class="ff-hint">
								{fa(today()!.turns)} پاسخ امروز · ورودی {short(today()!.input)} · خروجی {short(today()!.output)} · کش {short(today()!.cacheRead)}. هزینه فقط برای Claude API حساب می‌شود؛ Claude Code و Codex با اشتراک خودت کار می‌کنند.
							</div>
						</div>

						<div class="ai-section">
							<div class="ai-head">هر پاسخ</div>
							<Field label="حداکثر طول یک پاسخ" hint="سقف توکن خروجی هر پاسخ مدل (Claude API). کم باشد، جواب‌های بلند نصفه می‌مانند.">
								<Pills
									size="sm"
									value={l()!.maxTokens}
									options={[8_000, 16_000, 32_000, 64_000, 128_000].map((n) => ({ value: n, label: n === data()!.defaults.maxTokens ? `${short(n)} (پیش‌فرض)` : short(n) }))}
									onChange={(v) => void save({ maxTokens: v })}
								/>
							</Field>
							<Field label="فکر کردن مدل" hint="مدل‌های فعلی همیشه فکر می‌کنند؛ این فقط نمایش خلاصه‌اش را عوض می‌کند. برای ارزان‌تر شدن، «تلاش» را پایین بیاور.">
								<Pills
									size="sm"
									value={l()!.thinkingDisplay}
									options={[
										{ value: "summarized", label: "خلاصه را نشان بده" },
										{ value: "omitted", label: "پنهان" },
									]}
									onChange={(v) => void save({ thinkingDisplay: v })}
								/>
							</Field>
						</div>

						<div class="ai-section">
							<div class="ai-head">هر نوبت</div>
							<Field label="حداکثر قدم" hint="هر قدم یک رفت‌وبرگشت مدل و ابزار است. برای Claude API و Claude Code.">
								<Pills
									size="sm"
									value={l()!.maxSteps}
									options={[4, 8, 16, 32].map((n) => ({ value: n, label: n === data()!.defaults.maxSteps ? `${fa(n)} (پیش‌فرض)` : fa(n) }))}
									onChange={(v) => void save({ maxSteps: v })}
								/>
							</Field>
							<Field label="سقف توکن یک نوبت" hint="جمع خروجی همه‌ی قدم‌ها. از ۲۰K به بالا، مدل خودش هم این سقف را می‌بیند و کارش را جمع می‌کند.">
								<Pills
									size="sm"
									value={l()!.turnTokens ?? 0}
									options={[0, 20_000, 50_000, 100_000, 200_000].map((n) => ({ value: n, label: n ? short(n) : "بدون سقف" }))}
									onChange={(v) => void save({ turnTokens: v || null })}
								/>
							</Field>
						</div>

						<div class="ai-section">
							<div class="ai-head">بودجه</div>
							<Field label="بودجه‌ی روزانه‌ی Claude API (دلار)" hint="وقتی پر شود، نوبت تازه شروع نمی‌شود تا فردا. خالی = بدون بودجه.">
								<Stepper label="بودجه‌ی روزانه" value={l()!.dailyUsd} step={1} min={0} placeholder="بدون" onChange={(v) => save({ dailyUsd: v || null })} />
							</Field>
							<Field label="بودجه‌ی ماهانه‌ی Claude API (دلار)">
								<Stepper label="بودجه‌ی ماهانه" value={l()!.monthlyUsd} step={5} min={0} placeholder="بدون" onChange={(v) => save({ monthlyUsd: v || null })} />
							</Field>
							<Field label="سقف توکن روزانه (همه‌ی مدل‌ها)" hint="برای این‌که اتوماسیون‌ها یا یک گفتگوی طولانی سهمیه‌ی اشتراکت را تمام نکنند.">
								<Pills
									size="sm"
									value={l()!.dailyTokens ?? 0}
									options={[0, 200_000, 1_000_000, 5_000_000, 20_000_000].map((n) => ({ value: n, label: n ? short(n) : "بدون سقف" }))}
									onChange={(v) => void save({ dailyTokens: v || null })}
								/>
							</Field>
						</div>
					</Show>
				</Popover.Content>
			</Popover.Positioner>
		</Popover.Root>
	);
}
